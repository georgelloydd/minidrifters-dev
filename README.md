# Mini Drifters · Dev

Private tools for Mini Drifters: track builder, player key lookup, leaderboard moderation and game deploys.

- Unlocking needs the admin secret. Supabase checks it on the server (see `supabase-admin.sql`), so player keys and moderation are never exposed by this public code.
- Publishing tracks and deploying the game need a GitHub token, pasted into the top bar. It is kept in the tab's memory only.
- Published tracks go to `tracks.json` in the game repo. Tracks are never deleted, only hidden, so leaderboard ids stay stable.
