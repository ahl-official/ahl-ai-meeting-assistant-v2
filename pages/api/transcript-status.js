export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const { id } = req.query;
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });
    if (!id) return res.status(400).json({ error: 'Missing transcript ID' });

    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { 'Authorization': apiKey },
    });

    const data = await pollRes.json();
    res.json({
        status: data.status,
        transcript: data.text || '',
        error: data.error || null,
    });
}