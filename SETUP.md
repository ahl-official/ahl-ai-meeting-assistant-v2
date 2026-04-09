# AI Meeting Assistant — Full Setup Guide

## Overview

This app has 3 layers:
1. **Google Sheets** — database (AUTH tab + per-user tabs)
2. **Google Apps Script** — REST API layer
3. **Next.js on Vercel** — frontend

---

## Step 1 — Create Your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → create a **New Spreadsheet**
2. Name it: `AI Meeting Assistant DB`
3. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
   ```
4. Leave the sheet empty — the Apps Script will create tabs automatically

---

## Step 2 — Deploy Google Apps Script

1. Go to [script.google.com](https://script.google.com) → **New Project**
2. Name it: `AMA API`
3. Delete the default `myFunction` code
4. Copy the full contents of `apps-script/Code.gs` and paste it
5. On **line 16**, replace `YOUR_GOOGLE_SHEET_ID_HERE` with your actual Sheet ID:
   ```js
   const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
   ```
6. Click **Deploy** → **New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy** → copy the **Web App URL** (looks like `https://script.google.com/macros/s/AKfy.../exec`)

> ⚠️ Every time you change the Apps Script code, you must create a **New Deployment** (not edit existing) for changes to take effect.

---

## Step 3 — Get Your API Keys

### Deepgram (live audio transcription)
1. Sign up at [deepgram.com](https://deepgram.com) — free tier includes 200 hours/month
2. Console → **API Keys** → **Create API Key**
3. Copy the key

### OpenRouter (AI analysis)
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. **Keys** → **Create Key**
3. Copy the key
4. Add a small credit ($5 is plenty — Mistral 7B costs ~$0.0002/1K tokens)

---

## Step 4 — Configure Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
```

---

## Step 5 — Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Step 6 — Deploy to Vercel

### Option A: GitHub → Vercel (recommended)

1. Push your project to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/ai-meeting-assistant.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo

3. In **Environment Variables**, add all three:
   - `NEXT_PUBLIC_APPS_SCRIPT_URL`
   - `NEXT_PUBLIC_DEEPGRAM_API_KEY`
   - `OPENROUTER_API_KEY`

4. Click **Deploy** — done! ✓

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel --prod
```

---

## Google Sheets Structure (auto-created)

After first use, your Sheet will have:

### `AUTH` tab
| email | username | password_hash | created_at |
|-------|----------|---------------|------------|

### `user_name_example_com` tab (one per user)
| id | title | transcript | summary | action_points | decisions | next_steps | duration | type | created_at | updated_at |
|----|-------|------------|---------|---------------|-----------|------------|----------|------|------------|------------|

---

## How It All Works

```
Browser mic → Deepgram WebSocket → live transcript text
Transcript → /api/analyze (Next.js) → OpenRouter (Mistral 7B) → structured JSON
Structured JSON → Apps Script Web App → Google Sheets row
```

---

## Security Notes

- Passwords are SHA-256 hashed before storage (not bcrypt, but adequate for MVP)
- For production, migrate auth to Supabase, Clerk, or NextAuth
- The Apps Script URL is public — add a secret token header if needed

---

## Troubleshooting

**"Network error" when logging in**
→ Check your `NEXT_PUBLIC_APPS_SCRIPT_URL` is correct and the deployment is live

**Deepgram not transcribing**
→ Browser needs HTTPS (works on localhost and Vercel, not HTTP)
→ Check microphone permissions in browser settings

**AI analysis returning empty**
→ Verify `OPENROUTER_API_KEY` is set as a server-side env var (no `NEXT_PUBLIC_` prefix)
→ Check OpenRouter account has credits

**Apps Script CORS errors**
→ Ensure deployment is set to "Anyone" access, not "Anyone with Google account"

---

## Project Structure

```
ai-meeting-assistant/
├── pages/
│   ├── index.js          ← Login / Register
│   ├── dashboard.js      ← All meetings
│   ├── meeting/
│   │   ├── new.js        ← Record + create meeting
│   │   └── [id].js       ← View + edit meeting
│   └── api/
│       └── analyze.js    ← OpenRouter AI endpoint
├── components/
│   ├── Navbar.js
│   └── LiveRecorder.js   ← Deepgram WebSocket recorder
├── lib/
│   ├── api.js            ← Apps Script API calls
│   └── auth.js           ← Auth context + cookie session
├── styles/               ← CSS modules per page
├── apps-script/
│   └── Code.gs           ← Full Google Apps Script backend
└── .env.local.example    ← Environment variable template
```
