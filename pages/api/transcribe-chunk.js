export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
};

const POLL_INTERVAL_MS = 3000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readRequestBuffer(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function formatSrtTime(ms) {
    const totalMs = Math.max(0, Math.floor(ms));
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const mil = totalMs % 1000;
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mil, 3)}`;
}

function speakerPrefix(speaker) {
    if (speaker === undefined || speaker === null || speaker === '') return '';
    const n = Number(speaker);
    return Number.isFinite(n) ? `Speaker ${n + 1}: ` : `Speaker ${String(speaker)}: `;
}

function buildCuesFromUtterances(utterances, offsetMs) {
    if (!Array.isArray(utterances) || !utterances.length) return [];
    return utterances
        .filter(u => u && typeof u.text === 'string' && u.text.trim())
        .map(u => {
            const startMs = (Number(u.start) || 0) + offsetMs;
            const endMs = (Number(u.end) || Number(u.start) || 0) + offsetMs;
            return {
                startMs,
                endMs: Math.max(endMs, startMs + 800),
                text: `${speakerPrefix(u.speaker)}${u.text.trim()}`,
            };
        });
}

function buildCuesFromWords(words, offsetMs) {
    if (!Array.isArray(words) || !words.length) return [];
    const cues = [];
    let buffer = [], cueStart = null, cueEnd = null;

    const flush = () => {
        if (!buffer.length || cueStart === null) return;
        cues.push({
            startMs: cueStart,
            endMs: Math.max(cueEnd, cueStart + 800),
            text: buffer.join(' ').trim(),
        });
        buffer = [];
        cueStart = null;
        cueEnd = null;
    };

    for (const w of words) {
        const text = String(w.text || '').trim();
        if (!text) continue;
        const startMs = (Number(w.start) || 0) + offsetMs;
        const endMs = (Number(w.end) || Number(w.start) || 0) + offsetMs;
        if (cueStart === null) cueStart = startMs;
        cueEnd = endMs;
        buffer.push(text);
        if (/[.?!]$/.test(text) || buffer.length >= 12 || cueEnd - cueStart >= 4500) flush();
    }
    flush();
    return cues;
}

function buildSrtFromChunks(chunkResults) {
    const cues = [];
    for (const chunk of chunkResults) {
        const offsetMs = Number(chunk.offsetMs) || 0;
        const utterances = Array.isArray(chunk.utterances) ? chunk.utterances : [];
        const words = Array.isArray(chunk.words) ? chunk.words : [];

        if (utterances.length) {
            cues.push(...buildCuesFromUtterances(utterances, offsetMs));
        } else if (words.length) {
            cues.push(...buildCuesFromWords(words, offsetMs));
        } else if (chunk.text?.trim()) {
            cues.push({
                startMs: offsetMs,
                endMs: offsetMs + 180000,
                text: chunk.text.trim(),
            });
        }
    }
    cues.sort((a, b) => a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs);
    return (
        cues
            .map((c, i) => `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${c.text}`)
            .join('\n\n') + (cues.length ? '\n' : '')
    );
}

async function startTranscriptJob(upload_url, apiKey) {
    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            audio_url: upload_url,
            speaker_labels: true,
            punctuate: true,
            format_text: true,
            disfluencies: false,
        }),
    });
    if (!transcriptRes.ok) {
        throw new Error(`Job start failed (${transcriptRes.status}): ${await transcriptRes.text()}`);
    }
    const { id } = await transcriptRes.json();
    return id;
}

async function waitForTranscript(transcriptId, apiKey) {
    while (true) {
        const res = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            headers: { Authorization: apiKey },
        });
        if (!res.ok) throw new Error(`Poll failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        if (data.status === 'completed') return data;
        if (data.status === 'error') throw new Error(data.error || 'AssemblyAI transcription error');
        await sleep(POLL_INTERVAL_MS);
    }
}

function buildResponse(data) {
    const singleChunk = {
        offsetMs: 0,
        text: String(data.text || '').trim(),
        utterances: Array.isArray(data.utterances) ? data.utterances : [],
        words: Array.isArray(data.words) ? data.words : [],
    };
    const srt = buildSrtFromChunks([singleChunk]);
    return {
        text: singleChunk.text,
        transcript: singleChunk.text,   // ← add this alias
        utterances: singleChunk.utterances,
        words: singleChunk.words,
        srt,
    };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });

    try {
        const contentType = (req.headers['content-type'] || '').toLowerCase();

        let upload_url;

        if (contentType.includes('application/json')) {
            // ── Mode A: client already has an upload_url from /api/aai-upload ──
            const rawBuffer = await readRequestBuffer(req);
            const body = JSON.parse(rawBuffer.toString('utf8'));
            if (!body.upload_url) {
                return res.status(400).json({ error: 'Missing upload_url in JSON body' });
            }
            upload_url = body.upload_url;

        } else {
            // ── Mode B: raw audio bytes — upload them first ──────────────────
            const audioBuffer = await readRequestBuffer(req);
            if (!audioBuffer.length) {
                return res.status(400).json({ error: 'No audio data received' });
            }

            const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
                method: 'POST',
                headers: {
                    Authorization: apiKey,
                    'Content-Type': 'application/octet-stream',
                },
                body: audioBuffer,
            });
            if (!uploadRes.ok) {
                throw new Error(`Upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
            }
            ({ upload_url } = await uploadRes.json());
        }

        // ── Shared: start job → poll → respond ───────────────────────────────
        const id = await startTranscriptJob(upload_url, apiKey);
        const data = await waitForTranscript(id, apiKey);
        return res.status(200).json(buildResponse(data));

    } catch (error) {
        return res.status(500).json({ error: `Transcription chunk failed: ${error.message}` });
    }
}