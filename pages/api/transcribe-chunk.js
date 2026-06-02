export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
};

function readRequestBuffer(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
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
            language_detection: true,
            speaker_labels: true,
            punctuate: true,
            format_text: true,
            disfluencies: false,
        }),
    });

    if (!transcriptRes.ok) {
        throw new Error(`Job start failed (${transcriptRes.status}): ${await transcriptRes.text()}`);
    }

    const data = await transcriptRes.json();
    if (!data.id) throw new Error('AssemblyAI did not return a transcript id');
    return data.id;
}

async function uploadAudioBuffer(audioBuffer, apiKey) {
    if (!audioBuffer.length) {
        throw new Error('No audio data received');
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

    const data = await uploadRes.json();
    if (!data.upload_url) throw new Error('AssemblyAI did not return an upload URL');
    return data.upload_url;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });

    try {
        const contentType = (req.headers['content-type'] || '').toLowerCase();
        let upload_url;

        if (contentType.includes('application/json')) {
            const rawBuffer = await readRequestBuffer(req);
            const body = JSON.parse(rawBuffer.toString('utf8'));
            if (!body.upload_url) {
                return res.status(400).json({ error: 'Missing upload_url in JSON body' });
            }
            upload_url = body.upload_url;
        } else {
            const audioBuffer = await readRequestBuffer(req);
            upload_url = await uploadAudioBuffer(audioBuffer, apiKey);
        }

        const id = await startTranscriptJob(upload_url, apiKey);
        return res.status(200).json({ status: 'queued', id });
    } catch (error) {
        return res.status(500).json({ error: `Transcription chunk failed: ${error.message}` });
    }
}
