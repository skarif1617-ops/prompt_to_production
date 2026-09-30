# StudentAI Navigator project notes

- This is a React 19, Vite, Tailwind CSS v4 and Express app using JavaScript modules.
- Keep editable catalog and interview content in `src/data/*.json`; preserve existing field shapes and unique tool IDs.
- All Gemini access belongs in `server/app.js`. Never expose `GEMINI_API_KEY` through client code or a `VITE_` variable.
- Validate AI responses before rendering and keep deterministic client/server fallbacks for every AI feature.
- User progress, checklists, scores and streaks are local-only in `localStorage`; do not add login or remote student tracking.
- Use `npm run dev` for local development, `npm test` for route/data contracts, `npm run lint` for ESLint, and `npm run build` for production validation.
- Preserve accessible controls, responsive layouts and the existing light/dark design tokens when extending the UI.
