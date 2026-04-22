// pages/api/generate-tasks.js
// This file ONLY generates tasks via OpenRouter and returns them to the frontend.
// Persisting tasks to Google Sheets is handled by [id].js → handleTasksPanelChange
// which calls updateMeeting (lib/api.js → Apps Script updateMeeting action).

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { actionPoints } = req.body;

    if (!actionPoints || !actionPoints.length) {
        return res.status(400).json({ success: false, error: 'No action points provided' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'OPENROUTER_API_KEY not set' });
    }

    const apsText = actionPoints
        .map((ap, i) =>
            `${i + 1}. [${(ap.priority || 'medium').toUpperCase()}] ${ap.task || ''}` +
            ` (Owner: ${ap.owner || 'Unassigned'}, Due: ${ap.dueDate || 'TBD'})`
        )
        .join('\n');

    const prompt = `You are a senior project manager converting meeting action points into a precise, structured Task List.

ACTION POINTS:
${apsText}

RULES YOU MUST FOLLOW:
1. Read ALL action points together holistically before creating any tasks.
2. Merge related action points into ONE task when they form a single coherent workstream.
3. A single task may reference multiple action points — record their 0-based indices in sourceActionPoints.
4. Each task must be STANDALONE and self-contained: capture who, what, and expected output.
5. Use the "details" array for acceptance criteria, dependencies, or blockers — at least 2 sub-bullets per task.
6. You MAY create tasks implied by the action points even if not explicitly stated.
7. Do NOT copy-paste the action point text verbatim — synthesise and distil.
8. Priority must be exactly one of: "critical" | "high" | "medium" | "low"
9. Title must start with an imperative verb and be 12 words or fewer.

Return ONLY a valid JSON array. Each element must have EXACTLY this shape:
{
  "title": "Imperative verb headline, max 12 words",
  "priority": "high",
  "owner": "Person name or Unassigned",
  "dueDate": "Specific date or Not specified",
  "details": [
    "Acceptance criteria or specific deliverable",
    "Dependency, blocker, or deadline urgency"
  ],
  "sourceActionPoints": [0, 2]
}

If there are no actionable tasks, return [].
Return ONLY the JSON array. No markdown fences, no explanation, no preamble.`;

    try {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 3000,
            }),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`OpenRouter error ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content || '[]';

        // Strip markdown fences if model wraps in them anyway
        const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

        let tasks = [];
        const arrayMatch = clean.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                tasks = JSON.parse(arrayMatch[0]);
            } catch {
                tasks = [];
            }
        }

        if (!Array.isArray(tasks)) tasks = [];

        // Normalise every task to guarantee shape + add unique id
        tasks = tasks.map(t => ({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            title: t.title || 'Untitled Task',
            priority: t.priority || 'medium',
            owner: t.owner || 'Unassigned',
            dueDate: t.dueDate || 'Not specified',
            details: Array.isArray(t.details) ? t.details : [],
            sourceActionPoints: Array.isArray(t.sourceActionPoints) ? t.sourceActionPoints : [],
        }));

        return res.status(200).json({ success: true, tasks });

    } catch (err) {
        console.error('[generate-tasks]', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}