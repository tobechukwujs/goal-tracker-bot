// --- KEEP ALIVE SERVER (For Render/Cloud) ---
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive! 🤖');
});
server.listen(process.env.PORT || 8080, () => {
    console.log("Keep-alive server is running.");
});
// --------------------------------------------
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pool } = require('pg');
const cron = require('node-cron');

// CONFIGURATION
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// User states for conversation flows
const userStates = new Map();

console.log(" Bot is starting...");

// HELPER FUNCTIONS

// Register user (FIXED: Now sends telegram_id)
async function registerUser(chatId, username) {
    try {
        // We use chatId as telegram_id for private chats
        await pool.query(
            'INSERT INTO users (chat_id, telegram_id, username) VALUES ($1, $1, $2) ON CONFLICT (chat_id) DO NOTHING',
            [chatId, username]
        );
    } catch (err) {
        console.error("Error registering user:", err.message);
    }
}

// Generate and send daily plan
async function generateAndSendDailyPlan(chatId, userId) {
    try {
        // Fetch user's goals with deadlines
        const res = await pool.query(
            'SELECT description, deadline FROM goals WHERE user_id = $1 ORDER BY priority DESC, id ASC', 
            [userId]
        );
        const goals = res.rows;

        if (goals.length === 0) {
            bot.sendMessage(chatId, "🌅 Good morning! You have no active goals. Use /addgoal to start.");
            return;
        }

        bot.sendMessage(chatId, "🤖 Generating your daily activity plan...");

        // Build prompt with deadlines
        const goalsText = goals.map(g => {
            if (g.deadline) {
                return `- ${g.description} (Deadline: ${g.deadline})`;
            }
            return `- ${g.description}`;
        }).join('\n');

        const prompt = `
        I have the following goals for this year:
        ${goalsText}

        Please generate a daily activity list for TODAY to help me move towards these goals.
        - Create exactly ONE actionable task for EACH goal.
        - Prioritize goals with closer deadlines (if mentioned).
        - Each task should be achievable in 30-60 minutes.
        - Be specific and actionable (not vague like "work on X" but "complete Y for X").
        - Format the output as a numbered list (1., 2., 3.).
        - Add a short motivational quote at the end.
        - Do not use markdown bolding (**) just plain text is fine.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Save to DB
        await pool.query(
            'INSERT INTO daily_activities (user_id, content) VALUES ($1, $2) ON CONFLICT (user_id, activity_date) DO UPDATE SET content = $2',
            [userId, text]
        );

        bot.sendMessage(chatId, `🌞 *Here is your plan for today:* \n\n${text}`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error("Error generating plan:", error);
        bot.sendMessage(chatId, "⚠️ I tried to generate your plan but hit a snag. Please try again later.");
    }
}

// TELEGRAM COMMANDS

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await registerUser(chatId, msg.from.username);
    bot.sendMessage(chatId, 
        "👋 Welcome to your AI Goal Tracker!\n\n" +
        "Tell me your goals, and I'll generate a daily plan for you every morning at 6 AM.\n\n" +
        "👇 **Commands:**\n" +
        "/addgoal [goal] - Add a single goal\n" +
        "/addmany - Add multiple goals at once\n" +
        "/mygoals - View your goals list\n" +
        "/delete [number] - Delete a specific goal (e.g., /delete 1)\n" +
        "/clear - Delete ALL goals\n" +
        "/generate - Generate today's plan now\n" +
        "/help - Show help"
    );
});

// /addgoal - Now asks for deadline
bot.onText(/\/addgoal (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const goalText = match[1];

    try {
        await registerUser(chatId, msg.from.username);
        
        // Save goal text temporarily and ask for deadline
        userStates.set(chatId, { 
            state: 'awaiting_deadline', 
            tempGoal: goalText 
        });
        
        bot.sendMessage(chatId,
            `📅 Great! When do you want to achieve this goal?\n\n` +
            `💡 Examples:\n` +
            `• Before March 2026\n` +
            `• End of semester\n` +
            `• April 2026\n` +
            `• This month\n` +
            `• No deadline\n\n` +
            `Or type "skip" for no deadline.`
        );
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error. Please try again.");
    }
});

// /addmany - Add multiple goals at once
bot.onText(/\/addmany/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        "📝 *Add Multiple Goals with Deadlines*\n\n" +
        "Send your goals, one per line.\n\n" +
        "*Format Options:*\n" +
        "• `Goal text` (no deadline)\n" +
        "• `Goal text | Deadline`\n\n" +
        "*Examples:*\n" +
        "Win 4 hackathons | End of year\n" +
        "Achieve 4.75 GPA | First semester\n" +
        "Read Bible daily\n\n" +
        "I'll add all of them at once! 🚀",
        { parse_mode: 'Markdown' }
    );
    
    userStates.set(chatId, { state: 'awaiting_multiple_goals' });
});

// Handle multiple goals input
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);
    
    // Skip if it's a command
    if (msg.text?.startsWith('/')) return;
    
    // Handle deadline input for single goal
    if (state && state.state === 'awaiting_deadline') {
        try {
            // Ensure user exists first
            await registerUser(chatId, msg.from.username);
            const userIdRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
            
            if (userIdRes.rows.length === 0) {
                throw new Error("User registration failed");
            }
            const userId = userIdRes.rows[0].id;
            
            let deadline = msg.text.trim().toLowerCase() === 'skip' ? null : msg.text.trim();
            
            await pool.query(
                'INSERT INTO goals (user_id, description, deadline) VALUES ($1, $2, $3)', 
                [userId, state.tempGoal, deadline]
            );
            
            userStates.delete(chatId);
            
            if (deadline) {
                bot.sendMessage(chatId,
                    `✅ Goal added!\n\n` +
                    `🎯 Goal: "${state.tempGoal}"\n` +
                    `📅 Deadline: ${deadline}\n\n` +
                    `Use /generate to create today's plan!`
                );
            } else {
                bot.sendMessage(chatId,
                    `✅ Goal added: "${state.tempGoal}"\n\n` +
                    `Use /generate to create today's plan!`
                );
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, "❌ Error saving goal.");
            userStates.delete(chatId);
        }
        return;
    }
    
    // Check if user is adding multiple goals
    if (state && state.state === 'awaiting_multiple_goals') {
        try {
            // Ensure user exists first
            await registerUser(chatId, msg.from.username);
            const userIdRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
            
            if (userIdRes.rows.length === 0) {
                throw new Error("User registration failed");
            }
            const userId = userIdRes.rows[0].id;
            
            // Parse goals with optional deadlines
            const lines = msg.text.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0);
            
            if (lines.length === 0) {
                bot.sendMessage(chatId, "❌ No valid goals found. Please try again.");
                userStates.delete(chatId);
                return;
            }
            
            let addedCount = 0;
            for (const line of lines) {
                // Check if line has deadline (format: "goal | deadline")
                if (line.includes('|')) {
                    const parts = line.split('|');
                    const goal = parts[0].trim();
                    const deadline = parts.slice(1).join('|').trim(); // Handle multiple | just in case

                    await pool.query(
                        'INSERT INTO goals (user_id, description, deadline) VALUES ($1, $2, $3)', 
                        [userId, goal, deadline]
                    );
                } else {
                    await pool.query(
                        'INSERT INTO goals (user_id, description) VALUES ($1, $2)', 
                        [userId, line]
                    );
                }
                addedCount++;
            }
            
            userStates.delete(chatId);
            
            bot.sendMessage(chatId,
                `✅ Successfully added ${addedCount} goal${addedCount > 1 ? 's' : ''}!\n\n` +
                `Use /mygoals to view them all.\n` +
                `Use /generate to create your daily plan! 🚀`
            );
            
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, "❌ Error saving goals. Please try again.");
            userStates.delete(chatId);
        }
    }
});

// /mygoals - Now shows deadlines
bot.onText(/\/mygoals/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const res = await pool.query(
            'SELECT g.description, g.deadline FROM goals g JOIN users u ON g.user_id = u.id WHERE u.chat_id = $1 ORDER BY g.priority DESC, g.id ASC', 
            [chatId]
        );
        
        if (res.rows.length > 0) {
            const list = res.rows.map((r, i) => {
                if (r.deadline) {
                    return `${i + 1}. ${r.description}\n   📅 ${r.deadline}`;
                }
                return `${i + 1}. ${r.description}`;
            }).join('\n\n');
            
            bot.sendMessage(chatId, 
                `🎯 *Your Goals:*\n\n${list}\n\n` +
                `💡 To delete: /delete [number]\n` +
                `📝 Generate plan: /generate`, 
                {parse_mode: 'Markdown'}
            );
        } else {
            bot.sendMessage(chatId, "📭 You have no goals set.\n\nUse /addgoal [your goal] to add one!");
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error fetching goals.");
    }
});

// /delete [number]
bot.onText(/\/delete (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const numberToDelete = parseInt(match[1]);

    try {
        const userRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
        if (userRes.rows.length === 0) {
            return bot.sendMessage(chatId, "❌ Please start the bot first with /start");
        }
        
        const userId = userRes.rows[0].id;

        // Fetch all goals in order
        const goalsRes = await pool.query('SELECT id, description FROM goals WHERE user_id = $1 ORDER BY id ASC', [userId]);
        const goals = goalsRes.rows;

        // Validate number
        if (numberToDelete < 1 || numberToDelete > goals.length) {
            return bot.sendMessage(chatId, `❌ Invalid number. You have ${goals.length} goal(s).\n\nUse /mygoals to see your goals.`);
        }

        // Delete the goal
        const goalToDelete = goals[numberToDelete - 1]; 
        await pool.query('DELETE FROM goals WHERE id = $1', [goalToDelete.id]);

        bot.sendMessage(chatId, 
            `🗑️ Deleted goal: "${goalToDelete.description}"\n\n` +
            `Use /mygoals to see remaining goals.`
        );

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error deleting goal.");
    }
});

// /clear (Delete ALL goals)
bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const result = await pool.query(
            'DELETE FROM goals WHERE user_id IN (SELECT id FROM users WHERE chat_id = $1)', 
            [chatId]
        );
        
        const deletedCount = result.rowCount;
        
        bot.sendMessage(chatId, 
            `🗑️ All goals deleted! (${deletedCount} goal${deletedCount !== 1 ? 's' : ''})\n\n` +
            `Ready for a fresh start! Use /addgoal to begin.`
        );
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error deleting goals.");
    }
});

// /generate (Manual trigger)
bot.onText(/\/generate/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const userRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
        if (userRes.rows.length > 0) {
            await generateAndSendDailyPlan(chatId, userRes.rows[0].id);
        } else {
            bot.sendMessage(chatId, "❌ Please start the bot first with /start");
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error generating plan.");
    }
});

// /help
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
        "📚 *How to Use Goal Tracker Bot:*\n\n" +
        "1️⃣ Add goals:\n" +
        "   • Single: /addgoal [goal]\n" +
        "   • Multiple: /addmany (then paste goals, one per line)\n\n" +
        "2️⃣ View all goals with /mygoals\n\n" +
        "3️⃣ Generate daily plan with /generate\n" +
        "   The bot will create ONE task for EACH goal\n\n" +
        "4️⃣ Receive activities at 6:00 AM daily\n\n" +
        "5️⃣ Get reminders at 9 AM, 12 PM, 3 PM, 6 PM\n\n" +
        "🗑️ Delete a specific goal: /delete [number]\n" +
        "🗑️ Delete all goals: /clear\n\n" +
        "💡 Tip: Start with 2-3 goals for best results!",
        { parse_mode: 'Markdown' }
    );
});

// SCHEDULERS

// 6:00 AM - Generate daily activities
cron.schedule('0 6 * * *', async () => {
    console.log('⏰ Running 6:00 AM Scheduler...');
    try {
        const users = await pool.query('SELECT id, chat_id FROM users');
        
        for (const user of users.rows) {
            await generateAndSendDailyPlan(user.chat_id, user.id);
            // Small delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000)); 
        }
        
        console.log(`✅ Sent daily plans to ${users.rows.length} user(s)`);
    } catch (err) {
        console.error('❌ Error in 6 AM scheduler:', err);
    }
});

// Reminders at 9 AM, 12 PM, 3 PM, 6 PM, and 9 PM
cron.schedule('0 9,12,15,18,21 * * *', async () => {
    const currentHour = new Date().getHours();
    console.log(`🔔 Running ${currentHour}:00 Reminder...`);
    
    try {
        const users = await pool.query('SELECT chat_id FROM users');
        
        let msgText = "🔔 Reminder: Check your daily goals!";
        
        // Custom messages for each time
        if (currentHour === 9)  msgText = "🕘 9 AM Check-in: Have you started your first task yet?";
        if (currentHour === 12) msgText = "🕛 12 PM Reminder: How's your progress going?";
        if (currentHour === 15) msgText = "🕒 3 PM Boost: Keep pushing! You're doing great!";
        if (currentHour === 18) msgText = "🕕 6 PM Review: Time to wrap up. How much did you finish?";
        if (currentHour === 21) msgText = "🌙 9 PM End of Day: Great work today! Get some rest. 😴";

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.chat_id, msgText);
            } catch (err) {
                console.error(`Error sending to ${user.chat_id}:`, err.message);
            }
        }
        
        console.log(`✅ Sent reminders to ${users.rows.length} user(s)`);
    } catch (err) {
        console.error(' Error in reminder scheduler:', err);
    }
});

// IMPROVED ERROR HANDLING
bot.on('polling_error', (error) => {
    if (['EFATAL', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) {
        console.log(" Network unstable... waiting for connection.");
    } else {
        console.error(' Telegram error:', error.code || error.message);
    }
});

console.log("Bot is ready to receive messages!");
console.log(" Scheduled: 6 AM (daily plan), 9 AM, 12 PM, 3 PM, 6 PM (reminders)");