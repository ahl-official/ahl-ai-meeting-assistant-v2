export const config = {
    api: {
        bodyParser: false,
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

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });
    }

    try {
        const audioBuffer = await readRequestBuffer(req);
        if (!audioBuffer.length) {
            return res.status(400).json({ error: 'No audio data received' });
        }

        // 1. Upload chunk to AssemblyAI
        const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/octet-stream',
            },
            body: audioBuffer,
        });

        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`AssemblyAI upload failed (${uploadRes.status}): ${errText}`);
        }

        const uploadData = await uploadRes.json();
        const uploadUrl = uploadData.upload_url;

        // 2. Start transcription job
        const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                audio_url: uploadUrl,
                speaker_labels: true,
                punctuate: true,
                format_text: true,
                disfluencies: false,
            }),
        });

        if (!transcriptRes.ok) {
            const errText = await transcriptRes.text();
            throw new Error(`AssemblyAI transcript start failed (${transcriptRes.status}): ${errText}`);
        }

        const transcriptData = await transcriptRes.json();
        return res.status(200).json({
            id: transcriptData.id,
        });

    } catch (error) {
        return res.status(500).json({
            error: `Transcription chunk failed: ${error.message}`,
        });
    }
}
