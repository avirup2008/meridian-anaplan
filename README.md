# Meridian · Deployment Guide

## Files in this package

```
meridian/
├── index.html          ← The complete app (all CSS, JS, HTML)
├── api/
│   └── generate.js     ← Vercel serverless function (Gemini proxy)
├── vercel.json         ← Vercel routing config
└── README.md           ← This file
```

---

## Step 1 — Get your Gemini API key

1. Go to **https://aistudio.google.com/app/apikey**
2. Click **Create API key**
3. Copy the key (starts with `AIza...`)
4. Free tier: 1,500 requests/day · 15 RPM · Gemini 2.0 Flash

---

## Step 2 — Push to GitHub

Create a new **private** repository on GitHub and push these files:

```bash
git init
git add .
git commit -m "Initial Meridian deployment"
git remote add origin https://github.com/YOUR_USERNAME/meridian-eyeon.git
git push -u origin main
```

---

## Step 3 — Deploy to Vercel

1. Go to **https://vercel.com** and sign in
2. Click **Add New → Project**
3. Import your GitHub repository
4. Leave all build settings as default
5. Click **Deploy**

Vercel will detect `vercel.json` automatically and configure routing.

---

## Step 4 — Add your Gemini API key

**This step is critical — the app will use fallback text without it.**

1. In your Vercel project, go to **Settings → Environment Variables**
2. Click **Add New**
3. Set:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your key from Step 1
   - **Environment:** Production, Preview, Development (tick all three)
4. Click **Save**
5. Go to **Deployments** and click **Redeploy** on your latest deployment

The key is stored securely server-side and never exposed to the browser.

---

## Step 5 — (Optional) Custom domain

1. In Vercel → Settings → Domains
2. Add `meridian.eyeon.com` or similar
3. Follow Vercel's DNS instructions for your domain registrar

---

## How it works

```
Browser                    Vercel                      Google
  │                           │                           │
  │  POST /api/generate       │                           │
  │  { prompt: "..." }   ───► │                           │
  │                           │  POST Gemini API     ───► │
  │                           │  Authorization: key        │
  │                           │ ◄───  { text: "..." }      │
  │ ◄───  { text: "..." }     │                           │
```

The Gemini API key never leaves Vercel's servers.
Blueprint CSV files are processed entirely in the browser — they never leave the user's machine.
Only the structured prompt text (module names, line item names, inferred types) is sent to Gemini.

---

## Fallback behaviour

If the Gemini API is unavailable or the key is not set, the app falls back to deterministic rule-based narratives automatically. The Intelligence Report is entirely rule-based and works with no API key at all.

---

## Updating the app

Push a new commit to GitHub — Vercel auto-deploys on every push to `main`.

```bash
# After making changes to index.html
git add index.html
git commit -m "Update report layout"
git push
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Documentation shows generic text | GEMINI_API_KEY not set or not redeployed after adding |
| Upload button doesn't work | Make sure you're testing on Vercel, not opening index.html directly as a local file |
| API errors in browser console | Check Vercel function logs: Project → Functions → generate |
| 429 Too Many Requests | Hit Gemini free tier rate limit — wait 60s and retry |
