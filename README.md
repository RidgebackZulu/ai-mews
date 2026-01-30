# AI Mews

A tiny, mobile-first cyberpunk daily AI link with a summary + a pragmatic/salty take.

## Deploy (GitHub Pages)

1. Create a new GitHub repo (public is easiest for Pages).
2. Push this code to `main`.
3. In GitHub:
   - **Settings → Pages**
   - Source: **GitHub Actions**

4. Add repo secrets (**Settings → Secrets and variables → Actions → New repository secret**):
   - `BRAVE_API_KEY` (Brave Search API key)
   - `OPENAI_API_KEY` (used to write the summary + “take”)
   - Optional: `OPENAI_MODEL` (e.g. `gpt-4o-mini`)

5. Run once:
   - **Actions → Daily AI Mews → Run workflow**

## Local dev

```bash
npm ci
npm run dev
```

## Notes

- The scheduled workflow is set to 14:00 UTC (08:00 CST). If you’re on CDT, change the cron.
- Posts are stored as `src/posts/YYYY-MM-DD.md`.
- The share link is always the post permalink on this site; the original article is credited as Source.
