// ============================================================
// pages/api/transcribe.js
// ============================================================

export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
};

/**
 * Convert Gemini's plain timestamped text into SRT format.
 * Filters out filler-only entries (Hmm, Uh, Um etc.) that
 * Gemini hallucinates during silence.
 */
function toSRT(text) {
    const regex = /\((\d+:\d{2}(?::\d{2})?)\)\s*(.*?)(?=\(\d|$)/gs;
    const entries = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        const timeStr = match[1];
        const content = match[2].trim();
        if (!content) continue;

        const parts = timeStr.split(':').map(Number);
        const seconds = parts.length === 3
            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
            : parts[0] * 60 + parts[1];

        entries.push({ seconds, content });
    }

    // ── FIX: drop filler-only lines Gemini hallucinates for silence ──
    const FILLER = /^(hmm+|uh+|um+|ah+|oh+|huh|mm+|err+|hm+)\.?$/i;
    const filtered = entries.filter(e => !FILLER.test(e.content.trim()));

    if (!filtered.length) {
        // No real content found at all — return single block
        const cleanText = text
            .replace(/\(\d+:\d{2}(?::\d{2})?\)\s*/g, '')  // strip timestamps
            .replace(FILLER, '')                             // strip fillers
            .trim();
        if (!cleanText) return '';
        return `1\n00:00:00,000 --> 00:00:10,000\n${cleanText}\n`;
    }

    const toSRTTime = (s) => {
        const h = Math.floor(s / 3600).toString().padStart(2, '0');
        const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${h}:${m}:${sec},000`;
    };

    return filtered.map((entry, i) => {
        const start = toSRTTime(entry.seconds);
        const endSec = filtered[i + 1] ? filtered[i + 1].seconds : entry.seconds + 5;
        const end = toSRTTime(endSec);
        return `${i + 1}\n${start} --> ${end}\n${entry.content}`;
    }).join('\n\n') + '\n';
}

/**
 * Clean raw transcript by removing filler-only timestamp lines.
 * Keeps the timestamped format but strips the noise.
 */
function cleanTranscript(text) {
    const FILLER = /^(hmm+|uh+|um+|ah+|oh+|huh|mm+|err+|hm+)\.?$/i;
    // Remove entire "(m:ss) Hmm." lines
    return text
        .replace(/\(\d+:\d{2}(?::\d{2})?\)\s*(hmm+|uh+|um+|ah+|oh+|huh|mm+|err+|hm+)\.?\s*/gi, '')
        .replace(/\n{3,}/g, '\n')  // collapse multiple blank lines
        .trim();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

    // ── Read raw audio buffer ─────────────────────────────────
    const chunks = [];
    await new Promise((resolve, reject) => {
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', resolve);
        req.on('error', reject);
    });

    const audioBuffer = Buffer.concat(chunks);
    if (!audioBuffer.length) {
        return res.status(400).json({ error: 'No audio data received' });
    }

    // Detect MIME type from file header bytes
    const header = audioBuffer.slice(0, 12);
    let mimeType = 'audio/mpeg';
    if (header[0] === 0x1A && header[1] === 0x45) mimeType = 'audio/webm';
    else if (header.toString('ascii', 0, 4) === 'RIFF') mimeType = 'audio/wav';
    else if (header.toString('ascii', 4, 8) === 'ftyp') mimeType = 'audio/mp4';
    else if (header[0] === 0x4F && header[1] === 0x67) mimeType = 'audio/ogg';
    else if (header[0] === 0x66 && header[1] === 0x4C) mimeType = 'audio/flac';

    const base64Audio = audioBuffer.toString('base64');

    // ── FIX: improved prompt that stops Gemini hallucinating ──
    const prompt = `Transcribe this audio exactly as spoken.

Rules:
- Add a timestamp only at the start of each new sentence or meaningful spoken phrase, in format (m:ss) e.g. (0:00) or (1:23)
- Do NOT add a timestamp for every second — only when someone actually says something new
- If there is silence, background noise, or very short filler sounds (like breathing, brief "hmm", ambient noise) with no real words — skip them entirely, leave them out
- Only transcribe actual words and sentences that carry meaning
- If multiple speakers are clearly distinguishable, prefix lines with Speaker 1: or Speaker 2: etc.
- Keep all actual spoken words exactly as said — do not summarise, paraphrase or clean up
- Output plain text only, no markdown, no bullet points`;

    let raw = '';
    try {
        const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
                'X-Title': 'AI Meeting Assistant',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_audio',
                                input_audio: {
                                    data: base64Audio,
                                    format: mimeType,
                                },
                            },
                            {
                                type: 'text',
                                text: prompt,
                            },
                        ],
                    },
                ],
                temperature: 0.1,
                max_tokens: 8000,
            }),
        });

        if (!orRes.ok) {
            const errText = await orRes.text();
            return res.status(502).json({
                error: `OpenRouter error: ${orRes.status}`,
                detail: errText,
            });
        }

        const orData = await orRes.json();
        raw = orData.choices?.[0]?.message?.content || '';

        if (!raw) {
            return res.status(500).json({ error: 'Gemini returned empty transcription' });
        }

    } catch (ex) {
        return res.status(500).json({ error: 'Transcription failed: ' + ex.message });
    }

    // ── Clean raw transcript and build SRT ────────────────────
    const transcript = cleanTranscript(raw);
    const srt = toSRT(raw);

    return res.json({
        status: 'completed',
        transcript,
        srt,
    });
}