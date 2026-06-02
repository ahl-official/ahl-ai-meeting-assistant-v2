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

/**
 * Robustly extract JSON from model output.
 * Handles: thinking blocks, markdown fences, leading/trailing text.
 */
function extractJSON(raw) {
  if (!raw) throw new Error('Empty response from model');

  // 1. Strip <think>...</think> blocks (Qwen3, DeepSeek, etc.)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip markdown fences
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  // 3. Try parsing directly
  try {
    return JSON.parse(cleaned);
  } catch { }

  // 4. Extract first {...} block — greedy to get the full object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { }

    // 5. If still failing, the JSON is truncated — try to salvage by closing open structures
    let partial = match[0];
    // Count open braces/brackets to close them
    let braces = 0, brackets = 0;
    for (const ch of partial) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }
    // Remove trailing incomplete string/value
    partial = partial.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
    // Close open arrays then objects
    partial += ']'.repeat(Math.max(0, brackets));
    partial += '}'.repeat(Math.max(0, braces));
    try {
      return JSON.parse(partial);
    } catch { }
  }

  throw new Error('No valid JSON found in model response. Raw: ' + raw.slice(0, 300));
}

// pages/api/analyze.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { transcript } = req.body;
  if (!transcript?.trim()) return res.status(400).json({ error: 'No transcript' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'OPENROUTER_API_KEY not set' });
  }

  // ── Chunk the transcript ──────────────────────────────────
  // Split on sentence boundaries every ~3000 chars so nothing is dropped
  const CHUNK_SIZE = 3000;
  const chunks = [];
  let start = 0;
  while (start < transcript.length) {
    let end = Math.min(start + CHUNK_SIZE, transcript.length);
    // Try to break at a sentence boundary
    if (end < transcript.length) {
      const boundary = transcript.lastIndexOf('. ', end);
      if (boundary > start + 1000) end = boundary + 2;
    }
    chunks.push(transcript.slice(start, end).trim());
    start = end;
  }

  // ── Extract action points from each chunk ─────────────────
  const chunkPrompt = (chunk, i, total) => `
You are extracting action items from part ${i + 1} of ${total} of a meeting transcript.

TRANSCRIPT SEGMENT:
${chunk}

Return ONLY a JSON array of action items found in this segment. Each item:
{
  "task": "specific task description",
  "owner": "person name or 'Unassigned'",
  "dueDate": "date mentioned or 'Not specified'",
  "priority": "high" | "medium" | "low"
}

If no action items in this segment, return [].
Return ONLY the JSON array. No explanation, no markdown.`;

  let allActionPoints = [];

  try {
    // Process chunks in parallel (max 3 at a time to avoid rate limits)
    for (let i = 0; i < chunks.length; i += 3) {
      const batch = chunks.slice(i, i + 3);
      const results = await Promise.all(batch.map(async (chunk, j) => {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [{ role: 'user', content: chunkPrompt(chunk, i + j, chunks.length) }],
            temperature: 0.1,
            max_tokens: 2000,
          }),
        });
        if (!resp.ok) {
          throw new Error(`OpenRouter chunk request failed (${resp.status}): ${await resp.text()}`);
        }
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || '[]';
        try {
          const clean = text.replace(/```json|```/g, '').trim();
          return JSON.parse(clean);
        } catch { return []; }
      }));
      allActionPoints.push(...results.flat());
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Chunk extraction failed: ' + err.message });
  }

  // ── Dedup action points ───────────────────────────────────
  // Merge near-duplicate tasks (same owner + similar task wording)
  const seen = new Set();
  const deduped = allActionPoints.filter(ap => {
    const key = (ap.owner + ap.task).toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Single pass for summary + tasks using full transcript ────
  // If transcript is very long, use first+last 3000 chars for context
  const summaryContext = transcript.length > 6000
    ? transcript.slice(0, 3000) + '\n[...middle truncated...]\n' + transcript.slice(-3000)
    : transcript;

  const summaryPrompt = `Summarize this meeting transcript. Return ONLY JSON, no markdown:
{
  "summary": "2-4 sentence overview of what was discussed and decided",
  "decisions": ["decision 1", "decision 2"],
  "nextSteps": "1-2 sentence description of immediate next steps"
}

TRANSCRIPT:
${summaryContext}`;

  // ── TASKS PROMPT — strict, project-manager grade ──────────────
  const tasksPrompt = `You are a senior project manager distilling a meeting transcript into a precise, actionable Task List.

RULES YOU MUST FOLLOW:
1. Each task is a STANDALONE, self-contained unit of work — not a paraphrase of the transcript.
2. Be PRECISE: capture who, what, expected output, and any constraints or dependencies.
3. Use "details" as sub-bullets for acceptance criteria, context, or dependencies.
4. You MAY merge several related action items into ONE task if they form a single coherent workstream.
5. You MAY also create tasks that have NO direct action point if the transcript implies critical follow-ups.
6. Do NOT copy-paste sentences from the transcript. Synthesise and distil.
7. Priority must be one of: "critical" | "high" | "medium" | "low"

Return ONLY a JSON array. Each element must have EXACTLY this shape:
{
  "title": "Imperative verb headline, max 12 words",
  "priority": "high",
  "owner": "Person name or 'Unassigned'",
  "dueDate": "Specific date mentioned or 'Not specified'",
  "details": [
    "Sub-bullet: specific acceptance criteria, context, or dependency",
    "Sub-bullet: deadline urgency or blocker if mentioned"
  ],
  "sourceActionPoints": []
}

If the meeting has no actionable work, return [].
Return ONLY the JSON array. No markdown fences, no explanation, no preamble.

TRANSCRIPT:
${summaryContext}`;

  // ── Run summary + tasks in parallel ──────────────────────────
  let summary = '', decisions = [], nextSteps = '', tasks = [];

  try {
    const [summaryResp, tasksResp] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [{ role: 'user', content: summaryPrompt }],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      }),
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [{ role: 'user', content: tasksPrompt }],
          temperature: 0.1,
          max_tokens: 3000,
        }),
      }),
    ]);

    if (!summaryResp.ok) {
      throw new Error(`OpenRouter summary request failed (${summaryResp.status}): ${await summaryResp.text()}`);
    }
    if (!tasksResp.ok) {
      throw new Error(`OpenRouter tasks request failed (${tasksResp.status}): ${await tasksResp.text()}`);
    }

    // Parse summary
    try {
      const summaryData = await summaryResp.json();
      const summaryText = summaryData.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(summaryText.replace(/```json|```/g, '').trim());
      summary   = parsed.summary   || '';
      decisions = parsed.decisions || [];
      nextSteps = parsed.nextSteps || '';
    } catch {
      summary = 'Summary generation failed.';
    }

    // Parse tasks
    try {
      const tasksData = await tasksResp.json();
      const tasksText = tasksData.choices?.[0]?.message?.content || '[]';
      const extracted = extractJSON(tasksText);
      tasks = Array.isArray(extracted) ? extracted : [];
      // Normalise each task to guarantee shape
      tasks = tasks.map(t => ({
        title:              t.title              || 'Untitled Task',
        priority:           t.priority           || 'medium',
        owner:              t.owner              || 'Unassigned',
        dueDate:            t.dueDate            || 'Not specified',
        details:            Array.isArray(t.details) ? t.details : [],
        sourceActionPoints: Array.isArray(t.sourceActionPoints) ? t.sourceActionPoints : [],
      }));
    } catch {
      tasks = [];
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Analysis failed: ' + err.message });
  }

  return res.json({
    success: true,
    result: {
      summary,
      actionPoints: deduped,
      tasks,
      decisions,
      nextSteps,
    },
  });
}
