// ============================================================
// pages/api/aai-token.js — serverless (no body, just a GET)
//
// Returns a one-time AssemblyAI upload URL to the browser so it
// can PUT audio directly to AssemblyAI without routing through Vercel.
// The ASSEMBLYAI_API_KEY never reaches the browser.
// ============================================================

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });

    try {
        // Ask AssemblyAI to provision a one-time presigned upload URL.
        const upstream = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
                Authorization: apiKey,
                'Content-Type': 'application/json',
            },
            // Empty body — this tells AssemblyAI to return a presigned URL
            // rather than accepting a blob directly.
            body: JSON.stringify({}),
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            return res.status(502).json({
                error: `AssemblyAI token request failed (${upstream.status}): ${errText.slice(0, 200)}`,
            });
        }

        const data = await upstream.json();

        if (!data.upload_url) {
            return res.status(502).json({ error: 'AssemblyAI did not return an upload_url' });
        }

        // Return only the upload URL — API key is never included
        return res.status(200).json({ upload_url: data.upload_url });
    } catch (err) {
        return res.status(500).json({ error: `Token fetch error: ${err.message}` });
    }
}