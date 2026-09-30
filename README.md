# prompt_to_production

## StudentAI Navigator

A student-focused guide to choosing AI tools, learning them responsibly, preparing for interviews, and practicing communication. No account is required; checklists and practice history stay in browser `localStorage`.

## Run locally

Requirements: Node.js 20.10 or newer and npm.

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173` and proxies `/api` to the local Express server on port `8787`. AI routes work without a key using local fallbacks.

For Gemini-backed recommendations, generated guides, original interview practice and coaching, copy `.env.example` to `.env` and set `GEMINI_API_KEY`. The key is read only by the Node server. Never add a `VITE_` prefix or commit `.env`.

Voice input requires Chrome or Edge, microphone permission, and `localhost` or HTTPS. The browser's speech-recognition service may require an internet connection. When it is unavailable, recorded audio is sent to `/api/transcribe`; that fallback requires the server-side `GEMINI_API_KEY`. Firefox and some Brave configurations may not expose native speech recognition, so text entry remains available.

## Features

- Tool finder with stage, category and pricing filters, prompt copying, compare mode and task recommendations.
- How to Use AI lessons and tool guides with persisted try-it checklists. Unknown tools can receive a Gemini-generated guide.
- Interview roadmap data for eight domains, curated channel links, generated YouTube searches, company practice, thinking feedback and local score history.
- Communication practice with text or browser speech, structured feedback, a five-minute daily streak and local history.
- Light/dark themes, responsive layouts and deterministic fallbacks for unavailable or invalid AI responses.

## Extend the data

- Edit `src/data/tools.json` to add tools. Preserve unique `id` values and the current field shapes (`category`, `url`, `pricing`, `stages`, `bestFor`, `howToUse`, `samplePrompt`, `tags`, `learnGuide`).
- Edit `src/data/interviews.json` to add domains, stages, resources, companies or original practice exercises. Resource videos link to verified channels and generated YouTube searches rather than invented video IDs.
- Server response validators live in `server/app.js`; browser fallback behavior lives in `src/lib/fallbacks.js`.

## Checks

```bash
npm test
npm run lint
npm run build
npm run preview
```

## Deploy

### Vercel

Import the repository as a Vite project and set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in the project environment variables. Vercel builds the static client with `npm run build`; `api/index.js` serves the Express API through the rewrite in `vercel.json`. Keep the environment variable server-only and redeploy after changing it.

### Netlify

Import the repository. `netlify.toml` sets the build command, `dist` publish directory, API function and SPA fallback. Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in Site configuration > Environment variables. Deploy again after changing environment variables.

Without a configured key, both deployments continue to serve the deterministic local fallbacks. Pricing, company interview formats and learning resources can change; check official sites. AI feedback is guidance, not a guarantee.

Voice answers use the browser microphone only after a user action. Deploy behind HTTPS so browsers allow microphone access. Gemini audio transcription runs on the server; never put the API key in client-side or `VITE_` environment variables.
