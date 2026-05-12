# KoeScope Project Notes

## Project

Local DLsite helper app at `E:\DL Manager\KoeScope`.

It is a Node.js 20 + Express 5 app with a React/Next.js static-export frontend in `web/`, SQLite persistence via `better-sqlite3`, DLsite/Bangumi scraping via `fetch` + `cheerio`, and a Chrome companion extension in `extension/`. Legacy `public/*.html/js/css` files are kept as rollback/static-resource fallbacks during the migration.

## Commands

- Install: `npm install`
- Start: `npm start`
- Default app: `http://localhost:5178`
- Monitor dashboard: `http://localhost:5178/dashboard.html`
- Tests: `npm test`
- Next frontend build: `npm run web:build`
- Next frontend tests: `npm run web:test`

## Worktree Protocol

- Read this file before making project changes.
- Check `git status --short` before editing and preserve unrelated local changes.
- Before future optimization or feature work, read `docs/remaining-roadmap.md` and align the work with the next relevant unchecked item.
- After completing an optimization or feature item, update `docs/remaining-roadmap.md` in the same change set by marking the item complete or deleting the completed note.
- For every feature or optimization task, create a new git branch before editing code or tests. Use a short descriptive branch name such as `feature/dark-mode` or `optimize/snapshot-cleanup`.
- Do not merge a feature or optimization branch into `main` until both checks have happened: Codex has run the relevant automated tests and smoke checks, and the user has personally tested and approved the result.
- Do not run `git add`, `git commit`, or merge into `main` for feature or optimization work unless the user explicitly asks after the dual-testing step. Documentation-only planning edits may stay unstaged unless the user asks to commit them.
- Prefer narrow patches that follow existing React/Next.js, Express, and SQLite patterns. Keep frontend changes in `web/` unless intentionally updating static assets or rollback files under `public/`.
- Use `apply_patch` for manual edits.
- Prefer `rg` for searching code and tests.
- If the app is already running on port `5178` and current code must be verified, stop the old listener and restart on `5178`; do not switch to another port unless the user asks.
- Keep `DLSITE_MONITOR_AUTO_SYNC=0` and/or `DLSITE_ACTIVITY_AUTO_SYNC=0` for UI-only verification when background sync would obscure the test.

## Testing Standards

- Run full `npm test` before code changes when the user explicitly asks for a baseline test gate, or when the change depends on recent uncommitted monitor/activity work.
- Run full `npm test` after every implementation that touches backend behavior, persistence, dashboard rendering, extension behavior, or tests.
- Run `npm run web:build` after frontend changes that touch Next pages, shared React components, frontend API clients, or routing/static export behavior.
- Do not treat a unit test pass as enough for dashboard-facing monitor work. Also verify the live API and dashboard path when practical.
- For monitor/dashboard changes, verify at least:
  - `GET /api/health`
  - the affected sync/status API, such as `/api/activities/status`
  - the affected data API, such as `/api/activities?...`
  - `http://localhost:5178/dashboard.html` after a browser reload
- In browser verification, check DOM state and console errors. Screenshot capture can fail in this environment, so DOM/API/console checks are acceptable evidence.
- When changing parsers, add or update fixture-based unit tests. Avoid relying only on live remote pages.
- When changing SQLite schema or stored payload shape, add repository tests that prove migration/storage/readback behavior.
- When adding failure tolerance, add a fallback test that proves the list or dashboard still renders when the fetch/parse step fails.

## Important Files

- `src/server.js`: Express API routes and static serving.
- `src/lib/monitor/service.js`: monitor orchestration, schedulers, ranking sync, activity sync.
- `src/lib/monitor/repository.js`: SQLite migrations, persistence, summaries, alerts.
- `src/lib/monitor/dlsiteRanking.js`: DLsite ranking fetch/parse/enrich logic.
- `src/lib/monitor/dlsiteActivities.js`: DLsite activity/campaign fetch/parse/classify logic.
- `src/lib/dlsiteAccount.js`: account points, wishlist, purchased works import/sync.
- `web/src/app/`: React/Next.js pages for search, person detail, Dashboard, and activity center.
- `web/src/lib/`: frontend API clients, view helpers, and tests.
- `public/dashboard.html`, `public/dashboard.js`, `public/dashboard.css`: legacy rollback UI and shared static CSS resources.
- `extension/`: Chrome extension that captures logged-in DLsite account pages.

## Current Features

- Search DLsite works by voice actor / alias data resolved from Bangumi.
- Sync DLsite rankings and store work price/rank snapshots.
- Maintain watchlist and price/target-price alerts.
- Sync DLsite account points, wishlist, and purchased works through the Chrome extension.
- Recommend affordable works using synced account points.
- Show DLsite activities/campaigns in the dashboard.

## DLsite Activities Module

The activity module fetches official DLsite campaign banner JSON, stores normalized activities, cautiously enriches public detail pages, and shows activities in the dashboard with benefit type, image, external link, start/end time, countdown, compact detail/fallback state, and unread alerts.

Primary official sources:

- `https://media.vivion-bcs.com/data/dlsite/jajp/maniax/top/pc/campaign/data.json`
- `https://media.vivion-bcs.com/data/dlsite/jajp/maniax/top/pc/campaign-mini/data.json`

Fallback source:

- legacy BCS JSON at `https://www.eisys-bcs.jp/data.json` with allcampaign keys.

Activity benefit types:

- `point`
- `coupon`
- `discount`
- `free`
- `bonus`
- `info`

Activity APIs:

- `POST /api/sync/dlsite-activities`
- `GET /api/activities?status=active|all&benefit=all|point|coupon|discount|free|bonus|info`
- `GET /api/activities/status`
- `POST /api/activity-alerts/:id/read`
- `GET /api/dashboard/summary` includes `activeActivities`, `endingSoonActivities`, `unreadActivityAlerts`.

Activity scheduling:

- Default interval: 6 hours.
- Disable with `DLSITE_ACTIVITY_AUTO_SYNC=0`.
- Override interval with `DLSITE_ACTIVITY_SYNC_INTERVAL_MS`.

Activity detail parsing rules:

- Reuse `politeFetch` and keep request pacing conservative.
- Cache detail results; avoid refetching the same public page repeatedly during a sync.
- Parse only public DLsite campaign/discount/bulkbuy-style pages. Do not bypass login, use private account pages, or import private data.
- External topic links, login/account paths, unknown paths, and FSR search-result pages must degrade to `external`, `skipped`, or `fallback` detail states without breaking the activity list.
- Detail fetch or parse failures must not prevent banner activities from being stored or displayed.
- Prefer structured public fields when reliably present: claim condition, applicable scope, detail end time, requires-login signal, and limited-quantity signal.
- If structured fields are not reliable, store a short summary or fallback status instead of noisy page text.
- Live DLsite pages can contain product-list and navigation noise; filter obvious search/result/list UI text from detail summaries.

Activity detail test coverage should include:

- HTML fixture parsing for structured fields.
- Fetch failure fallback behavior.
- External/FSR/unsupported link tolerance.
- Repository storage and readback of detail fields.
- Dashboard rendering of compact detail/fallback information.

Dashboard activity UI rules:

- Keep activity cards scan-friendly; do not add dense always-open text panels.
- Show detail enrichment inside a collapsed `<details>` block by default.
- Avoid repeating point/account/activity summary information when it already appears in the metric strip or account line.
- Related-work matches and unread activity alerts may stay inline, but should remain compact and collapsible when they can grow.
- Text must wrap or truncate cleanly inside cards and buttons on desktop and mobile.

## Recent Verification

- `npm test` passed: 52/52 after activity detail parsing and dashboard compact-detail changes.
- React/Next.js static export build passed and Express serves `web/out` before legacy `public/*.html` when the build output exists.
- Dashboard/activity API and static-page smoke checks passed on `localhost:5178` with schedulers disabled.

## Notes For Future Agents

- Prefer `rg` for repo search.
- Use `apply_patch` for edits.
- Do not overwrite unrelated local changes.
- The project may already have a running server on port `5178`; stop and restart that listener for live verification instead of opening a second local port.
- Explain operational monitor behavior in Chinese when reporting to the user.
