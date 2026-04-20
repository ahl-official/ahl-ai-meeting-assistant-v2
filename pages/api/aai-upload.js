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

    try {
        const upstream = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
                Authorization: apiKey,
                'Content-Type': 'application/octet-stream',
            },
            body: req,
            duplex: 'half',
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            return res.status(502).json({
                error: `AssemblyAI upload failed (${upstream.status}): ${errText.slice(0, 200)}`,
            });
        }

        const data = await upstream.json();
        if (!data.upload_url) {
            return res.status(502).json({ error: 'AssemblyAI did not return an upload_url' });
        }

        return res.status(200).json({ upload_url: data.upload_url });
    } catch (err) {
        return res.status(500).json({ error: `Upload error: ${err.message}` });
    }
}