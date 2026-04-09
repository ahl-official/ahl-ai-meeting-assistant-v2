export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });

    const chunks = [];
    await new Promise((resolve, reject) => {
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', resolve);
        req.on('error', reject);
    });

    const audioBuffer = Buffer.concat(chunks);

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/octet-stream',
        },
        body: audioBuffer,
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) {
        return res.status(500).json({ error: 'Upload to AssemblyAI failed', detail: uploadData });
    }

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            audio_url: uploadData.upload_url,
            punctuate: true,
            format_text: true,
        }),
    });

    const transcriptData = await transcriptRes.json();
    if (!transcriptData.id) {
        return res.status(500).json({ error: 'Failed to submit transcription job', detail: transcriptData });
    }

    res.json({ id: transcriptData.id });
}