const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

function looksLikeHtml(text) {
    return /<!doctype html>|<html[\s>]/i.test(String(text || ''));
}

function appsScriptUrlHint() {
    return 'Apps Script endpoint is unreachable. Verify NEXT_PUBLIC_APPS_SCRIPT_URL uses the deployed Web App /exec URL and deployment access is set to Anyone.';
}

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    if (!APPS_SCRIPT_URL) {
        return res.status(500).json({
            success: false,
            error: 'NEXT_PUBLIC_APPS_SCRIPT_URL is not set',
        });
    }

    const action = String(req.query.action || '');
    if (!action) {
        return res.status(400).json({ success: false, error: 'Missing action' });
    }

    try {
        const body = await readRawBody(req);
        const url = new URL(APPS_SCRIPT_URL);
        url.searchParams.set('action', action);

        const upstream = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });

        const text = await upstream.text();
        const contentType = upstream.headers.get('content-type') || '';

        if (looksLikeHtml(text)) {
            console.error(`[apps-script] HTML response (status ${upstream.status}):`, text.slice(0, 200));
            return res.status(502).json({
                success: false,
                error: appsScriptUrlHint(),
                detail: `Upstream status ${upstream.status}, received HTML instead of JSON`,
            });
        }

        if (!contentType.includes('application/json') && text.trim()) {
            console.error(`[apps-script] Non-JSON response: ${contentType}`);
            return res.status(502).json({
                success: false,
                error: appsScriptUrlHint(),
                detail: `Expected JSON, got ${contentType || 'unknown content-type'}`,
            });
        }

        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/json');
        return res.send(text);
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || 'Proxy request failed',
        });
    }
}