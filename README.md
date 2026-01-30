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
   - `OPENAI_API_KEY` (used to write the summaries + “take”)
   - Optional: `OPENAI_MODEL` (e.g. `gpt-4o-mini`)
   - `TELEGRAM_BOT_TOKEN` (Telegram bot token)
   - `TELEGRAM_CHAT_ID` (channel/group id, e.g. `-1001234567890`)

5. Run once:
   - **Actions → Daily AI Mews → Run workflow**

## Local dev

```bash
npm ci
npm run dev
```

## Notes

- The scheduled workflow runs at both 13:00 and 14:00 UTC (covers 08:00 CDT/CST). The script only posts at 08:00 America/Chicago.
- For manual testing, you can set repo secrets `FORCE_RUN=1` and (if you need to regenerate today's post) `FORCE_OVERWRITE=1`.
- Posts are stored as `src/posts/YYYY-MM-DD.md`.
- The share link is always the post permalink on this site; the original article is credited as Source.
