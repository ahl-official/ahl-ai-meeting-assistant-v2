// ============================================================
// pages/api/analyze.js — Next.js serverless route
// Pipeline: transcript → OpenRouter → structured JSON → Sheets
// Every step is logged back to Apps Script's LOGS tab.
// ============================================================

const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

/**
 * Fire-and-forget log to Apps Script LOGS tab.
 * We do NOT await most of these — they must never block the main pipeline.
 */
async function remoteLog(username, step, level, message, detail, latencyMs) {
  if (!APPS_SCRIPT_URL) return;
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', 'pipelineLog');
    await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ username, action: 'analyze', step, level, message, detail, latencyMs }),
    });
  } catch { /* never block */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { transcript, username, meetingId, title, duration, type } = req.body;

  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  const t0 = Date.now();
  const user = username || 'unknown';

  // ── Step 1: Log pipeline start ────────────────────────────
  remoteLog(user, 'OPENROUTER_START', 'INFO',
    'Sending transcript to OpenRouter for analysis',
    { meetingId, chars: transcript.length }
  );

  // ── Step 2: Build prompt ──────────────────────────────────
  const prompt = `You are a meeting intelligence assistant. Analyze the following meeting transcript and extract structured information.

TRANSCRIPT:
${transcript}

Respond ONLY with valid JSON — no markdown, no backticks, no extra text — in exactly this format:
{
  "summary": "2-3 sentence executive summary of what was discussed and decided",
  "actionPoints": [
    {
      "id": "1",
      "task": "Clear, specific action item",
      "owner": "Person name, or 'Team' if unspecified",
      "priority": "high|medium|low",
      "dueDate": "specific date if mentioned, otherwise 'TBD'"
    }
  ],
  "decisions": [
    "Key decision 1 made during the meeting",
    "Key decision 2 made during the meeting"
  ],
  "nextSteps": "Brief paragraph describing what happens after this meeting"
}

Rules:
- Extract ONLY what was explicitly said in the transcript
- If no action points are mentioned, return an empty array
- Priority: high = urgent/blocking, medium = important, low = nice-to-have
- Be specific with owners — use names from the transcript`;

  // ── Step 3: Call OpenRouter ───────────────────────────────
  let raw = '';
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'AI Meeting Assistant',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1500,
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      remoteLog(user, 'OPENROUTER_ERROR', 'ERROR',
        `OpenRouter returned ${orRes.status}`, errText, Date.now() - t0
      );
      return res.status(502).json({ success: false, error: `OpenRouter error: ${orRes.status}`, detail: errText });
    }

    const orData = await orRes.json();
    raw = orData.choices?.[0]?.message?.content || '';

    remoteLog(user, 'OPENROUTER_OK', 'INFO',
      'OpenRouter response received',
      { tokens: orData.usage?.total_tokens, rawLength: raw.length },
      Date.now() - t0
    );
  } catch (ex) {
    remoteLog(user, 'OPENROUTER_EXCEPTION', 'ERROR',
      'OpenRouter fetch threw', ex.message, Date.now() - t0
    );
    return res.status(500).json({ success: false, error: 'OpenRouter call failed: ' + ex.message });
  }

  // ── Step 4: Parse JSON response ───────────────────────────
  let parsed;
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (ex) {
    remoteLog(user, 'JSON_PARSE_ERROR', 'ERROR',
      'Failed to parse OpenRouter JSON response', { raw: raw.slice(0, 500) }, Date.now() - t0
    );
    // Graceful fallback
    parsed = {
      summary: 'AI analysis complete. Review the transcript for details.',
      actionPoints: [],
      decisions: [],
      nextSteps: raw,
    };
  }

  // ── Step 5: Write analysis back to Sheets via Apps Script ─
  if (meetingId && username && APPS_SCRIPT_URL) {
    try {
      const t1 = Date.now();
      const url = new URL(APPS_SCRIPT_URL);
      url.searchParams.set('action', 'saveAnalysis');
      const saveRes = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ username, meetingId, analysis: parsed }),
      });
      const saveData = await saveRes.json();

      if (saveData.success) {
        remoteLog(user, 'SHEETS_WRITE_OK', 'INFO',
          'Analysis written to Sheets', { meetingId }, Date.now() - t1
        );
      } else {
        remoteLog(user, 'SHEETS_WRITE_FAIL', 'WARN',
          'Sheets write returned error', saveData.error, Date.now() - t1
        );
      }
    } catch (ex) {
      remoteLog(user, 'SHEETS_WRITE_EXCEPTION', 'ERROR',
        'Sheets saveAnalysis threw', ex.message
      );
    }
  }

  remoteLog(user, 'PIPELINE_COMPLETE', 'INFO',
    'Full pipeline done',
    {
      meetingId,
      actionPoints: parsed.actionPoints?.length || 0,
      decisions: parsed.decisions?.length || 0,
    },
    Date.now() - t0
  );

  return res.json({ success: true, result: parsed });
}