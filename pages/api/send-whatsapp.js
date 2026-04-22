// ============================================================
// pages/api/send-whatsapp.js
// Sends meeting action plan via WAHA (WhatsApp HTTP API)
// ============================================================

const WAHA_BASE_URL = process.env.WAHA_BASE_URL;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const WAHA_SESSION = process.env.WAHA_SESSION;

// Hardcoded coordinator number
const COORDINATOR_PHONE = '919987921288';

// ── Helpers ──────────────────────────────────────────────────

function toChatId(raw) {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    if (digits.length < 7) return null;
    return digits + '@c.us';
}

// ── USER MESSAGE (FULL) ───────────────────────────────────────

function buildUserMessage(meeting, username) {
    const PRIORITY_EMOJI = { high: '🔴', medium: '🟡', low: '🟢' };
    const lines = [];

    if (username) {
        lines.push(`👋 Hi *${username}*,`);
        lines.push(`Here's your meeting summary and action plan:`);
        lines.push('');
    }

    lines.push(`📋 *${meeting.title || 'Untitled Meeting'}*`);
    lines.push(`🗓 ${new Date(meeting.createdAt).toLocaleDateString('en-GB')}`);
    if (meeting.duration > 0) lines.push(`⏱ Duration: ${meeting.duration} min`);
    lines.push('');

    if (meeting.summary) {
        lines.push('📝 *Summary*');
        lines.push(meeting.summary);
        lines.push('');
    }

    const aps = meeting.actionPoints || [];
    if (aps.length > 0) {
        lines.push(`✅ *Action Points (${aps.length})*`);
        aps.forEach((ap, i) => {
            const emoji = PRIORITY_EMOJI[ap.priority] || '⚪';
            lines.push(`${i + 1}. ${emoji} *${ap.task}*`);
            lines.push(`   👤 ${ap.owner || 'Unassigned'}  📅 ${ap.dueDate || 'No date'}`);
        });
        lines.push('');
    }

    const tasks = meeting.tasks || [];
    if (tasks.length > 0) {
        lines.push(`📌 *Tasks (${tasks.length})*`);
        tasks.forEach((task, i) => {
            const statusEmoji =
                task.status === 'done' ? '✅' :
                    task.status === 'in_progress' ? '🔄' : '⬜';

            lines.push(`${i + 1}. ${statusEmoji} *${task.title || task.task || task.name || 'Untitled task'}*`);

            if (task.assignee || task.owner)
                lines.push(`   👤 ${task.assignee || task.owner}`);

            if (task.dueDate)
                lines.push(`   📅 ${task.dueDate}`);

            if (task.notes || task.note)
                lines.push(`   📎 ${task.notes || task.note}`);
        });
        lines.push('');
    }

    const decisions = meeting.decisions || [];
    if (decisions.length > 0) {
        lines.push('🏛 *Decisions Made*');
        decisions.forEach(d => lines.push(`• ${d}`));
        lines.push('');
    }

    if (meeting.nextSteps) {
        lines.push('🚀 *Next Steps*');
        lines.push(meeting.nextSteps);
        lines.push('');
    }

    lines.push('_Sent via AI Meeting Assistant_ 🤖');

    return lines.join('\n');
}

// ── COORDINATOR MESSAGE (FIXED) ───────────────────────────────

function buildCoordinatorMessage(meeting, username) {
    const lines = [];

    lines.push(`📋 *${meeting.title || 'Untitled Meeting'}*`);
    lines.push(`🗓 ${new Date(meeting.createdAt).toLocaleDateString('en-GB')}`);
    lines.push('');

    if (username) {
        lines.push(`👤 For *${username}*`);
        lines.push('');
    }

    const tasks = meeting.tasks || [];

    if (tasks.length > 0) {
        lines.push(`📌 *Tasks for Coordination (${tasks.length})*`);

        tasks.forEach((task, i) => {
            const statusEmoji =
                task.status === 'done' ? '✅' :
                    task.status === 'in_progress' ? '🔄' : '⬜';

            lines.push(`${i + 1}. ${statusEmoji} *${task.title || task.task || task.name || 'Untitled task'}*`);

            if (task.assignee || task.owner)
                lines.push(`   👤 ${task.assignee || task.owner}`);

            if (task.dueDate)
                lines.push(`   📅 ${task.dueDate}`);

            if (task.notes || task.note)
                lines.push(`   📎 ${task.notes || task.note}`);
        });

    } else {
        lines.push('_No tasks assigned for this meeting._');
    }

    lines.push('');
    lines.push('_Sent via AI Meeting Assistant_ 🤖');

    return lines.join('\n');
}

// ── SEND MESSAGE ─────────────────────────────────────────────

async function sendMessage(chatId, text) {
    const url = `${WAHA_BASE_URL}/api/sendText`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': WAHA_API_KEY,
        },
        body: JSON.stringify({
            chatId,
            text,
            session: WAHA_SESSION,
        }),
    });

    const body = await response.text();

    if (!response.ok) {
        let detail = body;
        try {
            detail = JSON.parse(body)?.message || detail;
        } catch { }

        throw new Error(`WAHA error (${response.status}): ${detail}`);
    }

    return true;
}

// ── API HANDLER ─────────────────────────────────────────────

export default async function handler(req, res) {
    if (!WAHA_BASE_URL || !WAHA_API_KEY || !WAHA_SESSION) {
        return res.status(500).json({
            success: false,
            error: 'WAHA environment variables not configured.',
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).end();
    }

    const { meeting, userPhone, username } = req.body || {};

    if (!meeting) {
        return res.status(400).json({
            success: false,
            error: 'Missing meeting data',
        });
    }

    const userChatId = toChatId(userPhone);
    const coordChatId = toChatId(COORDINATOR_PHONE);

    if (!userChatId) {
        return res.status(400).json({
            success: false,
            error: 'No valid phone number provided',
        });
    }

    const results = { user: null, coordinator: null };
    const errors = [];

    // Send to user
    try {
        await sendMessage(userChatId, buildUserMessage(meeting, username));
        results.user = 'sent';
    } catch (err) {
        results.user = 'failed';
        errors.push(`User (${userPhone}): ${err.message}`);
    }

    // Send to coordinator (FIXED)
    try {
        await sendMessage(coordChatId, buildCoordinatorMessage(meeting, username));
        results.coordinator = 'sent';
    } catch (err) {
        results.coordinator = 'failed';
        errors.push(`Coordinator: ${err.message}`);
    }

    if (results.user !== 'sent' && results.coordinator !== 'sent') {
        return res.status(500).json({
            success: false,
            error: errors.join(' | '),
            results,
        });
    }

    return res.status(200).json({
        success: true,
        results,
        errors,
    });
}