// ============================================================
// pages/api/send-whatsapp.js
// Sends meeting action plan via WAHA (WhatsApp HTTP API)
// to the user and optionally a process coordinator.
// Credentials are loaded from .env.local — never hardcoded.
// ============================================================

const WAHA_BASE_URL = process.env.WAHA_BASE_URL;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const WAHA_SESSION = process.env.WAHA_SESSION;

// ── Helpers (module-level, not nested inside handler) ────────

/**
 * Normalise a phone number to the WAHA chatId format: <digits>@c.us
 * Accepts:  +91 98765 43210  |  919876543210  |  9876543210
 */
function toChatId(raw) {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    if (digits.length < 7) return null;
    return digits + '@c.us';
}

/**
 * Build the WhatsApp message text from meeting data.
 */
function buildMessage(meeting) {
    const PRIORITY_EMOJI = { high: '🔴', medium: '🟡', low: '🟢' };
    const lines = [];

    lines.push(`📋 *Meeting: ${meeting.title || 'Untitled Meeting'}*`);
    lines.push(`🗓 ${new Date(meeting.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push('');

    // Summary
    if (meeting.summary) {
        lines.push('*Summary*');
        lines.push(meeting.summary);
        lines.push('');
    }

    // Action Points
    const aps = meeting.actionPoints || [];
    if (aps.length > 0) {
        lines.push(`*Action Points (${aps.length})*`);
        aps.forEach((ap, i) => {
            const emoji = PRIORITY_EMOJI[ap.priority] || '⚪';
            lines.push(`${i + 1}. ${emoji} *${ap.task}*`);
            lines.push(`   👤 ${ap.owner || 'Unassigned'}  📅 ${ap.dueDate || 'No date'}`);
        });
        lines.push('');
    }

    // Decisions
    const decisions = meeting.decisions || [];
    if (decisions.length > 0) {
        lines.push('*Decisions Made*');
        decisions.forEach(d => lines.push(`• ${d}`));
        lines.push('');
    }

    // Next Steps
    if (meeting.nextSteps) {
        lines.push('*Next Steps*');
        lines.push(meeting.nextSteps);
        lines.push('');
    }

    lines.push('_Sent via AI Meeting Assistant_');
    return lines.join('\n');
}

/**
 * Send a single WhatsApp message via WAHA.
 */
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
        try { detail = JSON.parse(body)?.message || detail; } catch { }
        throw new Error(`WAHA error (${response.status}): ${detail}`);
    }

    return true;
}

// ── Route handler ────────────────────────────────────────────

export default async function handler(req, res) {
    // Guard: ensure env vars are set
    if (!WAHA_BASE_URL || !WAHA_API_KEY || !WAHA_SESSION) {
        return res.status(500).json({ success: false, error: 'WAHA environment variables not configured.' });
    }

    if (req.method !== 'POST') return res.status(405).end();

    const { meeting, userPhone, coordinatorPhone } = req.body || {};

    if (!meeting) {
        return res.status(400).json({ success: false, error: 'Missing meeting data' });
    }

    const userChatId = toChatId(userPhone);
    const coordChatId = toChatId(coordinatorPhone);

    if (!userChatId && !coordChatId) {
        return res.status(400).json({ success: false, error: 'No valid phone numbers provided' });
    }

    const message = buildMessage(meeting);
    const results = { user: null, coordinator: null };
    const errors = [];

    // Send to user
    if (userChatId) {
        try {
            await sendMessage(userChatId, message);
            results.user = 'sent';
        } catch (err) {
            results.user = 'failed';
            errors.push(`User (${userPhone}): ${err.message}`);
        }
    }

    // Send to coordinator
    if (coordChatId) {
        try {
            await sendMessage(coordChatId, message);
            results.coordinator = 'sent';
        } catch (err) {
            results.coordinator = 'failed';
            errors.push(`Coordinator (${coordinatorPhone}): ${err.message}`);
        }
    }

    // All attempts failed
    if (errors.length > 0 && results.user !== 'sent' && results.coordinator !== 'sent') {
        return res.status(500).json({ success: false, error: errors.join(' | '), results });
    }

    return res.status(200).json({ success: true, results, errors });
}