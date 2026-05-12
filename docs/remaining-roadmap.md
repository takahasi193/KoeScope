# KoeScope Remaining Roadmap

This document is the source of truth for future KoeScope optimization and feature work after the completed Phase 1/2 batch.

Completed baseline:
- Phase 1/2 data and dashboard work landed in `39156b1`: SQLite performance indexes, historical-low signals, local Chart.js serving, and history trend charts.

## Maintenance Rule

- Before starting any future optimization or feature task, read this document and pick the next unchecked item that matches the user's request.
- After finishing an item, edit this document in the same change set:
  - Mark the item as done with `[x]` and add the completion commit/date, or
  - Delete the item if the implementation fully replaces the need for the note.
- Keep public DLsite campaign, coupon, final-price, and VA matching wording conservative. Do not claim account eligibility, coupon ownership, or definitive new-work identity unless the app has direct evidence.
- Use a feature branch for new feature development. Merge back to `main` only after tests and practical dashboard/API verification pass.

## Phase 3: UI Theme And Asset Caching

- [x] Dark mode: convert remaining page colors in `public/styles.css` and `public/dashboard.css` to shared CSS variables, then add a `data-theme="light|dark"` switch persisted in `localStorage`. Done 2026-05-12 on branch `feature/phase-3-theme-cache`.
- [x] Theme entrypoints: expose the theme toggle in the shared top navigation areas for search, person detail, Dashboard, and activity center; default to current light theme when no saved preference exists. Done 2026-05-12 on branch `feature/phase-3-theme-cache`.
- [x] Asset cache foundation: create a local image cache under `public/cache/` for activity banners and work covers, with safe filenames and remote URL to local path mapping. Done 2026-05-12 on branch `feature/phase-3-theme-cache`.
- [x] Cached image fallback: prefer local cached image URLs in API/UI payloads, but fall back to the original remote `imageUrl` when cache download, lookup, or file serving fails. Done 2026-05-12 on branch `feature/phase-3-theme-cache`.
- [x] Phase 3 verification: prove theme persistence after reload, cached image fallback on failure, and no sync breakage when image caching fails. Done 2026-05-12 on branch `feature/phase-3-theme-cache`.

## Phase 4: Local Personalization

- [x] Local tags and notes: add a local-only annotation table for work `note`, `tags`, and `status` values such as `绁炰綔`, `宸插叆`, and `寰呰喘`. Done 2026-05-12 on branch `feature/phase-3-theme-cache`; backed by `work_annotations` CRUD and local-only API routes.
- [x] Annotation UI: expose editing from the work history panel and watchlist items without writing anything back to DLsite account data. Done 2026-05-12 on branch `feature/phase-3-theme-cache`; Dashboard history panel saves annotations and watchlist/person work rows render local summaries.
- [x] VA subscriptions: add subscribed voice actor records from the person detail page, then reuse the existing alias/search flow for low-frequency possible-new-work checks. Done 2026-05-12 on branch `feature/phase-4-subscriptions`; person detail page can now save, update, cancel, and manually check subscriptions.
- [x] New-work reminders: create reminders without duplicating the same product/person pair, and phrase results as `可能的新作` unless identity evidence is definitive. Done 2026-05-12 on branch `feature/phase-4-subscriptions`; reminders now reuse the existing alert list with person-linked context.
- [x] Phase 4 verification: cover annotation CRUD, subscription dedupe, and failure-tolerant scheduled checks. Done 2026-05-12 on branch `feature/phase-4-subscriptions`; full `node --test` passed with new repository, service, server, dashboard, and person-page coverage.

## Phase 5: Proactive Notifications And Buying Advice

- [x] Extension notifications: add Chrome `notifications` permission and let the Companion extension poll local price/activity reminder APIs for unread alerts. Done 2026-05-12 on branch `feature/phase-5-notifications`; background polling uses local alert/activity APIs.
- [x] Notification dedupe: prevent repeated notifications for the same unread alert, and degrade quietly when the local backend is unavailable. Done 2026-05-12 on branch `feature/phase-5-notifications`; notification keys are stored locally and backend failures are recorded without surfacing noisy alerts.
- [x] Dashboard notifications: optionally use Browser Notification API only while Dashboard is open; do not rely on it for long-running background reminders. Done 2026-05-12 on branch `feature/phase-5-notifications`; Dashboard only emits session-deduped notifications when browser permission is already granted.
- [x] Bundle analysis v1: aggregate same-circle promotion candidates and suggest budget-aware combinations, without claiming final checkout optimization. Done 2026-05-12 on branch `feature/phase-5-notifications`; `/api/recommendations/bundles` returns same-circle public-price bundles with `claimsCheckoutOptimization: false`.
- [x] Phase 5 verification: cover backend-unavailable extension behavior, notification dedupe, and explainable bundle recommendation output. Done 2026-05-12 on branch `feature/phase-5-notifications`; targeted extension, repository, server, and dashboard tests passed before full verification.

## Phase 6: Data Maintenance

- [ ] Snapshot cleanup dry-run: add a maintenance API/tool that reports redundant snapshots older than one year before deleting anything.
- [ ] Safe cleanup execution: preserve latest snapshots, historical-low snapshots, and snapshots referenced by alerts; block cleanup while sync is running.
- [ ] SQLite optimization: run `PRAGMA optimize` after cleanup, and use `VACUUM` only when needed after larger deletes.
- [ ] Maintenance UI or command: expose a clear local-only control path for dry-run and execution.
- [ ] Phase 6 verification: prove dry-run counts match execution counts and Dashboard/history/alerts still read correctly after cleanup.
