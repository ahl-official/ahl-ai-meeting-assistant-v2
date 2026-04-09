// pages/api/deepgram-token.js
// Simply returns the API key from server env to the browser.
// Keeps the key out of your frontend bundle while still working on free tier.

export default function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'DEEPGRAM_API_KEY not set in .env.local' });
    }

    // Return the key directly — token grant API requires paid Deepgram plan
    return res.json({ key: apiKey });
}