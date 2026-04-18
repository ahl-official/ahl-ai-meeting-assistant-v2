// ============================================================
// pages/api/aai-upload.js — Edge function (no body size limit)
// Streams audio directly to AssemblyAI, returns upload_url.
// Used by LiveRecorder when blob > 4 MB to bypass Vercel's
// 4.5 MB serverless body limit.
// ============================================================

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
        return json({ error: 'ASSEMBLYAI_API_KEY not set' }, 500);
    }

    try {
        // Pipe the incoming body stream straight to AssemblyAI — no buffering,
        // no Vercel body-size limit applies to Edge functions.
        const upstream = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
                Authorization: apiKey,
                'Content-Type': 'application/octet-stream',
            },
            body: req.body,   // ReadableStream — streamed, not buffered
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore  duplex is required by some runtimes for streaming request bodies
            duplex: 'half',
        });

        const data = await upstream.json();

        if (!upstream.ok || !data.upload_url) {
            return json(
                { error: `AssemblyAI upload failed (${upstream.status})` },
                upstream.status,
            );
        }

        return json({ upload_url: data.upload_url }, 200);
    } catch (err) {
        return json({ error: err.message || 'Upload proxy error' }, 500);
    }
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}