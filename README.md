# Rhinoceros DH Project — Live API Ready Version

This folder contains the updated interactive webpage and a Vercel serverless endpoint for live LLM analysis.

## Files

- `index.html`: updated DH webpage. It keeps safe Demo Mode and adds a separate **Analyze with Live API** button.
- `api/analyze.js`: backend endpoint at `/api/analyze`. It hides API keys and calls GPT/OpenAI, Claude/Anthropic, or Gemini/Google depending on the selected model.
- `.env.example`: example environment variables.
- `vercel.json`: function duration setting.

## Recommended use

For presentation, use **Show Demo Analysis**. It is stable and works offline.

For live analysis, deploy to Vercel and add at least one API key in the Vercel project environment variables:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
```

At least one provider is enough. If a selected provider has no key or fails, the frontend falls back to demo results and displays a warning.

## Local test

Install Vercel CLI if needed:

```bash
npm i -g vercel
```

Then run:

```bash
vercel dev
```

Open the local URL, paste/select text, and try **Analyze with Live API**.

## API safety

Do not put API keys in `index.html` or any frontend JavaScript. Keys belong only in environment variables used by `api/analyze.js`.
