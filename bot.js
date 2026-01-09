const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!');
});
server.listen(process.env.PORT || 8080, () => {
    console.log("Keep-alive server is running.");
});

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

const userStates = new Map();

console.log("🤖 Bot is starting...");

// --- HELPER FUNCTIONS ---

async function registerUser(chatId, username) {
    try {
        await pool.query(
            'INSERT INTO users (chat_id, username) VALUES ($1, $2) ON CONFLICT (chat_id) DO NOTHING',
            [chatId, username]
        );
    } catch (err) {
        console.error("Error registering user:", err.message);
    }
}

// --- CORE FUNCTION: GENERATE PLAN (With Carry-Over & Checkboxes) ---
// --- FUNCTION: Generate Plan with Robust Parsing ---
async function generateAndSendDailyPlan(chatId, userId) {
    try {
        bot.sendMessage(chatId, "🤖 Checking yesterday's progress and generating today's plan...");

        // 1. Check Yesterday's Unfinished Tasks
        const lagosTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" });
        const todayDate = new Date(lagosTime);
        const yesterdayDate = new Date(todayDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        const yesterdayRes = await pool.query(
            'SELECT tasks FROM daily_activities WHERE user_id = $1 AND activity_date = $2',
            [userId, yesterdayStr]
        );

        let unfinishedTasks = [];
        if (yesterdayRes.rows.length > 0 && yesterdayRes.rows[0].tasks) {
            unfinishedTasks = yesterdayRes.rows[0].tasks.filter(t => !t.done).map(t => t.text);
        }

        // 2. Fetch Active Goals
        const goalsRes = await pool.query(
            'SELECT description, deadline FROM goals WHERE user_id = $1 ORDER BY priority DESC, id ASC', 
            [userId]
        );
        const goals = goalsRes.rows;

        if (goals.length === 0 && unfinishedTasks.length === 0) {
            bot.sendMessage(chatId, "🌅 Good morning! You have no active goals. Use /addgoal to start.");
            return;
        }

        // 3. Prepare Prompt
        const goalsText = goals.map(g => g.deadline ? `- ${g.description} (Deadline: ${g.deadline})` : `- ${g.description}`).join('\n');

        let prompt = `
            Context: The user has the following long-term goals:\n${goalsText}
            
            Instructions: Generate a strictly numbered daily to-do list for TODAY.
            - Create exactly ONE actionable task for EACH long-term goal.
            - Format output exactly like:
              1. Task text here
              2. Task text here
            - Do not use markdown bolding on the numbers.
            - Add a short motivational quote at the very end.
        `;

        if (unfinishedTasks.length > 0) {
            prompt += `\nIMPORTANT: Include these unfinished tasks from yesterday first:\n${unfinishedTasks.join("\n")}`;
        }

        // 4. AI Generation
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        
        // --- DEBUGGING LOG (Check Render Logs if buttons fail) ---
        console.log("📝 AI RAW OUTPUT:\n", text); 

        // 5. ROBUST PARSING (The Fix)
        const tasksArray = [];
        const lines = text.split('\n');
        
        lines.forEach(line => {
            // A. Clean the line (remove * for bolding, trim spaces)
            const cleanLine = line.replace(/\*/g, '').trim();
            
            // B. Flexible Regex: Matches "1.", "1)", "1:", "1 "
            const match = cleanLine.match(/^(\d+)[\.\)\:\s]\s*(.*)/);
            
            if (match) {
                tasksArray.push({
                    id: parseInt(match[1]), 
                    text: match[2].trim(),
                    done: false
                });
            }
        });

        console.log(`✅ Parsed ${tasksArray.length} tasks.`); // Debug log

        // 6. Save to DB
        await pool.query(`
            INSERT INTO daily_activities (user_id, content, tasks, activity_date)
            VALUES ($1, $2, $3, CURRENT_DATE)
            ON CONFLICT (user_id, activity_date) 
            DO UPDATE SET content = EXCLUDED.content, tasks = EXCLUDED.tasks;
        `, [userId, text, JSON.stringify(tasksArray)]);

        // 7. Create Buttons
        const buttons = [];
        let row = [];
        tasksArray.forEach(task => {
            row.push({ text: `${task.id} ⬜`, callback_data: `check_task_${task.id}` });
            if (row.length === 5) { buttons.push(row); row = []; }
        });
        if (row.length > 0) buttons.push(row);

        // 8. Send Message
        let msgHeader = "🌞 **Here is your plan for today:**";
        if (unfinishedTasks.length > 0) msgHeader = "⚠️ **Carried over unfinished tasks!** \n\n" + msgHeader;

        await bot.sendMessage(chatId, `${msgHeader}\n\n${text}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (error) {
        console.error("Error generating plan:", error);
        bot.sendMessage(chatId, "⚠️ I tried to generate your plan but hit a snag. Please try /generate again.");
    }
}

// --- CALLBACK QUERY HANDLER (Buttons Logic) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data;
    
    // Fetch User ID
    const userRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
    if (userRes.rows.length === 0) return;
    const userId = userRes.rows[0].id;

    // 1. HANDLE CHECKLIST CLICKS
    if (data.startsWith('check_task_')) {
        const taskNum = parseInt(data.split('_')[2]);
        
        try {
            // Fetch current tasks
            const dbRes = await pool.query(
                'SELECT tasks FROM daily_activities WHERE user_id = $1 AND activity_date = CURRENT_DATE',
                [userId]
            );

            if (dbRes.rows.length > 0) {
                let tasks = dbRes.rows[0].tasks || [];
                let taskFound = false;

                // Toggle Status
                tasks = tasks.map(t => {
                    if (t.id === taskNum) {
                        t.done = !t.done;
                        taskFound = true;
                    }
                    return t;
                });

                if (taskFound) {
                    // Save back to DB
                    await pool.query(
                        'UPDATE daily_activities SET tasks = $1 WHERE user_id = $2 AND activity_date = CURRENT_DATE',
                        [JSON.stringify(tasks), userId]
                    );

                    // Rebuild Message Text (Visual Checkmarks)
                    let newText = "";
                    tasks.forEach(t => {
                        newText += t.done ? `✅ ~${t.id}. ${t.text}~\n` : `${t.id}. ${t.text}\n`;
                    });

                    // Add Quote back if it exists in original message (simple heuristic)
                    const originalLines = query.message.text.split('\n');
                    const quote = originalLines[originalLines.length - 1]; 
                    if (!quote.match(/^\d+\./)) newText += `\n${quote}`;

                    // Rebuild Buttons
                    const buttons = [];
                    let row = [];
                    tasks.forEach(t => {
                        const icon = t.done ? "✅" : "⬜";
                        row.push({ text: `${t.id} ${icon}`, callback_data: `check_task_${t.id}` });
                        if (row.length === 5) { buttons.push(row); row = []; }
                    });
                    if (row.length > 0) buttons.push(row);

                    await bot.editMessageText(newText, {
                        chat_id: chatId,
                        message_id: msgId,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: buttons }
                    });
                }
            }
        } catch (err) {
            console.error("Error updating task:", err);
        }
    }

    // 2. HANDLE GOAL DELETION
    if (data.startsWith('delete_goal_')) {
        const goalId = data.split('_')[2];
        try {
            await pool.query('DELETE FROM goals WHERE id = $1', [goalId]);
            await bot.deleteMessage(chatId, msgId);
            await bot.sendMessage(chatId, "✅ Goal deleted.");
        } catch (err) {
            console.error(err);
        }
    }

    bot.answerCallbackQuery(query.id);
});

// --- TELEGRAM COMMANDS ---

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await registerUser(chatId, msg.from.username);
    bot.sendMessage(chatId, 
        "👋 Welcome to your AI Goal Tracker!\n\n" +
        "Tell me your goals, and I'll generate a daily plan for you every morning at 6 AM.\n\n" +
        "👇 **Commands:**\n" +
        "/addgoal [goal] - Add a single goal\n" +
        "/addmany - Add multiple goals\n" +
        "/mygoals - View & Delete goals\n" +
        "/generate - Generate today's plan now\n" +
        "/clear - Delete ALL goals"
    );
});

bot.onText(/\/addgoal (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const goalText = match[1];
    try {
        await registerUser(chatId, msg.from.username);
        userStates.set(chatId, { state: 'awaiting_deadline', tempGoal: goalText });
        bot.sendMessage(chatId, 
            `📅 When do you want to achieve this?\n(Type a date, "End of year", or "skip")`
        );
    } catch (err) {
        console.error(err);
    }
});

bot.onText(/\/addmany/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        "📝 Send your goals, one per line.\nFormat: `Goal | Deadline` (optional)",
        { parse_mode: 'Markdown' }
    );
    userStates.set(chatId, { state: 'awaiting_multiple_goals' });
});

// Message Handler for States (Add Goal / Add Many)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);
    if (!state || msg.text?.startsWith('/')) return;

    try {
        await registerUser(chatId, msg.from.username);
        const userIdRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
        const userId = userIdRes.rows[0].id;

        if (state.state === 'awaiting_deadline') {
            let deadline = msg.text.trim().toLowerCase() === 'skip' ? null : msg.text.trim();
            await pool.query('INSERT INTO goals (user_id, description, deadline) VALUES ($1, $2, $3)', [userId, state.tempGoal, deadline]);
            bot.sendMessage(chatId, "✅ Goal added! Use /generate to start.");
            userStates.delete(chatId);
        }
        else if (state.state === 'awaiting_multiple_goals') {
            const lines = msg.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (const line of lines) {
                const parts = line.split('|');
                const goal = parts[0].trim();
                const deadline = parts.length > 1 ? parts[1].trim() : null;
                await pool.query('INSERT INTO goals (user_id, description, deadline) VALUES ($1, $2, $3)', [userId, goal, deadline]);
            }
            bot.sendMessage(chatId, `✅ Added ${lines.length} goals!`);
            userStates.delete(chatId);
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error saving data.");
        userStates.delete(chatId);
    }
});

// /mygoals - Interactive (View & Delete)
bot.onText(/\/mygoals/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const res = await pool.query(
            'SELECT g.id, g.description, g.deadline FROM goals g JOIN users u ON g.user_id = u.id WHERE u.chat_id = $1 ORDER BY g.id ASC', 
            [chatId]
        );
        
        if (res.rows.length === 0) {
            return bot.sendMessage(chatId, "📭 No goals set yet.");
        }

        bot.sendMessage(chatId, "🎯 **Your Current Goals:**", { parse_mode: 'Markdown' });
        
        // Send each goal as a separate message with a delete button
        for (const goal of res.rows) {
            const text = goal.deadline ? `📌 ${goal.description}\n📅 ${goal.deadline}` : `📌 ${goal.description}`;
            await bot.sendMessage(chatId, text, {
                reply_markup: {
                    inline_keyboard: [[ { text: "❌ Delete", callback_data: `delete_goal_${goal.id}` } ]]
                }
            });
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Error fetching goals.");
    }
});

// /delete [number] (Legacy support)
bot.onText(/\/delete (\d+)/, async (msg, match) => {
    bot.sendMessage(msg.chat.id, "💡 Tip: Use /mygoals to see buttons for deleting goals easier!");
});

// /clear
bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        await pool.query('DELETE FROM goals WHERE user_id IN (SELECT id FROM users WHERE chat_id = $1)', [chatId]);
        bot.sendMessage(chatId, "🗑️ All goals deleted.");
    } catch (err) { console.error(err); }
});

// /generate
bot.onText(/\/generate/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const userRes = await pool.query('SELECT id FROM users WHERE chat_id = $1', [chatId]);
        if (userRes.rows.length > 0) {
            await generateAndSendDailyPlan(chatId, userRes.rows[0].id);
        } else {
            bot.sendMessage(chatId, "❌ Please /start first.");
        }
    } catch (err) { console.error(err); }
});

// --- SCHEDULERS (Lagos Time) ---

// 1. Generate Plans at 6:00 AM
cron.schedule('0 6 * * *', async () => {
    console.log('🌞 6 AM: Generating daily plans...');
    const users = await pool.query('SELECT * FROM users');
    for (const user of users.rows) {
        await generateAndSendDailyPlan(user.chat_id, user.id);
    }
}, { timezone: "Africa/Lagos" });

// 2. Reminders at 9, 12, 3, 6, 9 PM Lagos Time
cron.schedule('0 9,12,15,18,21 * * *', async () => {
    // Get the current hour in Lagos Time explicitly
    const lagosTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" });
    const currentHour = new Date(lagosTime).getHours();
    
    console.log(`🔔 Running Reminder for Hour: ${currentHour}`);
    
    try {
        // --- UPDATED QUERY: Only fetch users who have at least one goal ---
        // We use "DISTINCT" so if a user has 10 goals, we don't message them 10 times.
        const users = await pool.query(`
            SELECT DISTINCT u.chat_id 
            FROM users u
            INNER JOIN goals g ON u.id = g.user_id
        `);
        
        if (users.rows.length === 0) {
            console.log("No users with active goals to remind.");
            return;
        }

        let msgText = "🔔 Reminder: Check your daily goals!";
        
        // Exact Lagos hours
        if (currentHour === 9)  msgText = "🕘 9 AM Check-in: Have you started your first task yet?";
        if (currentHour === 12) msgText = "🕛 12 PM Reminder: How's your progress going?";
        if (currentHour === 15) msgText = "🕒 3 PM Boost: Keep pushing! You're doing great!";
        if (currentHour === 18) msgText = "🕕 6 PM Review: Time to wrap up. How much did you finish?";
        if (currentHour === 21) msgText = "🌙 9 PM End of Day: Great work today! Get some rest. 😴";

        console.log(`Sending reminders to ${users.rows.length} active users...`);

        for (const user of users.rows) {
            // Add a tiny delay between messages to prevent "Snags"
            await new Promise(resolve => setTimeout(resolve, 200)); 
            await bot.sendMessage(user.chat_id, msgText);
        }
    } catch (err) {
        console.error('❌ Error in reminder scheduler:', err);
    }
}, {
    timezone: "Africa/Lagos"
});

bot.on('polling_error', (error) => console.log(`Telegram Error: ${error.code}`));