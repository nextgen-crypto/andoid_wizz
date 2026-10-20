# WIZZ — Overnight Report (night of 2026‑10‑19 → 2026‑10‑20)

Everything below ran autonomously per your "super access" instruction. No
questions were asked; every decision is reversible and none rewrote published
git history.

---

## TL;DR

| | Before | After |
|---|---|---|
| Tests | 183 (1 file tautological — asserted nothing) | **4,070 passing** (19 files), honest |
| Lint / type errors | 176 lint, 4 type | **0 / 0** |
| Unindexed foreign keys | 14 | **0** |
| RLS policies re‑evaluating `auth.uid()` per row | 60 | **0** |
| SECURITY DEFINER functions callable by anon | 9 | **5** (the 5 are required by RLS itself) |
| Search‑path‑mutable functions | 1 | **0** |
| Android package id | `buzz.com` (placeholder) | **`com.wizz.app`** |
| Release signing | none (debug only) | **release keystore wired, AAB built** |
| Admin panel gating | two contradicting answers (client email list vs server) | **single server source of truth** |
| Broken admin features | news/trending writes, report "hide content" no‑op, cache bust admin‑locked | **all fixed and wired** |

**Deliverables**
- Release AAB (Play‑uploadable): `android/app/build/outputs/bundle/release/app-release.aab`
- Release APK (sideload/testing, release‑signed): `android/app/build/outputs/apk/release/app-release.apk`
- Debug APK (fast iteration): `android/app/build/outputs/apk/debug/app-debug.apk`
- Keystore (**back this up**): `~/Desktop/wizz-release.keystore` + `android/app/keystore.properties` (passwords inside; both outside git)

**Production**: https://wizz-kohl.vercel.app — deployment `dpl_45Xn8U8m8xapHjz1HNw82K7HV4fr`, commit `b1b45db`, state READY, verified serving the real feed.

---

## 1. Git — 8 commits pushed to `main` (all build, all green)

| Commit | What |
|---|---|
| `175d940` | Capacitor: bundle assets locally, core plugin set |
| `93012e2` | Capacitor: forward server functions to the deployed backend |
| `89932a6` | Continue‑watching driven by real per‑user watch history (localStorage store, no mock rows) |
| `8271cf7` | Repo hygiene: 176 lint errors → 0, 4 type errors → 0 |
| `04c0d96` | Migrate all 19 server functions off deprecated `inputValidator()` |
| `34cadf4` | **Overnight audit batch** (see §3) |
| `b1b45db` | **Test expansion 183 → 4,070** + honest RLS engine + Play Store identity |
| `33d82de` | Drop stale `bun.lock` (npm is the real package manager) |

---

## 2. Database (Supabase `beyacqhxpbniodbxyetw`) — one atomic migration applied

Migration `wizz_health_indexes_rls_initplan_definer_hardening`:

1. **14 covering indexes** for every foreign key that lacked a leading‑column
   index (ad_exposures, blocks, comments, conversations ×2, follow_requests,
   news_comments ×2, notifications, reports, saves, story_follows, story_posts,
   story_relevant_people). These speed deletes/cascades and "my list" lookups.
2. **RLS initplan fix** — all 74 policies programmatically rewritten so
   `auth.uid()/role()/jwt()/email()` are wrapped as `(select auth.uid())`.
   Postgres now evaluates them **once per query** instead of once per row.
   Verified: policy count unchanged (74), anon read paths re‑tested live under
   `SET ROLE anon`, all good.
3. **SECURITY DEFINER hardening** — `posts_classify_video` search_path pinned;
   EXECUTE revoked from anon/PUBLIC on `admin_metrics` (kept for
   authenticated + service_role), `publish_due_posts`,
   `posting_integrity_ready`, `ad_event_validate` (all four are server/cron/
   trigger‑only — verified no policy and no client call site depended on anon
   access; the cron job runs as `postgres`, unaffected).

Advisors after: performance findings **0** (was 14 FK + 60 initplan),
security: mutable search_path **0** (was 1), anon‑executable definer
functions **5** (was 9 — the remaining five are the documented RLS helper
functions policies must call).

### ⚠️ One dashboard action only you can do
**Auth → Settings → Enable "Leaked password protection"** (HaveIBeenPwned
check on sign‑up/reset). It is not settable via SQL or the management API —
one toggle in the Supabase dashboard.

---

## 3. Code audit — everything found, everything fixed (details)

**Admin (the biggest cluster)**
- **Split‑brain gating fixed**: UI used a client‑side `VITE_ADMIN_EMAILS`
  check while the server used `admin_roles` + a *different*, prod‑disabled
  allowlist — and `admin_roles` was **empty**, so in production the server
  rejected everyone the UI let in. Now one source of truth: UI asks
  `fetchAdminIdentity` (server fn), server checks `admin_roles` (authoritative)
  with the email allowlist kept only as a bootstrap until roles exist. Admin
  emails no longer ship in the JS bundle.
- **Roles panel is real**: was localStorage theater + a fake permission
  matrix. Now lists `admin_roles` rows, grants (resolves the email against
  auth users server‑side, so only real accounts can be added) and revokes.
- **News/trending moderation worked for nobody**: `news_stories` and
  `trending_topics` ship **SELECT‑only RLS**, so every admin console write
  failed with an RLS violation. New server functions (`adminSaveNewsStory`,
  `adminDeleteNewsStory`, `adminCreateTrendingTopic`,
  `adminDeleteTrendingTopic`) behind `requireAdmin` + service role.
- **Report resolution lied**: `remove_content` marked the report resolved
  without touching the content. Now archives the post / tombstones the comment
  for real; report ids are UUID‑validated.

**Feed / API**
- `fetchHome`/`fetchFeedPage` switched GET→POST — a large `InterestProfile`
  (heavy accounts) could exceed proxy request‑line limits as a query string
  and431 the feed.
- `invalidateHomeCache` was admin‑gated even though publishers are ordinary
  users — now auth‑gated + 10s throttled (can't be used as a recompute lever).
- GNews responses cached (public, quota‑bound endpoint).
- Blend invites: target must be a UUID + 50/day per‑actor cap (was an
  authenticated inbox‑flood primitive).
- Campaign pause/resume/stop is now a state machine — advertisers can no
  longer revive a rejected/completed campaign.
- Telemetry flush on page unload: `sendBeacon` silently 401s (no headers), so
  the last chunk of every session was dropped — now keepalive `fetch`.
- Search boxes sanitize PostgREST filter metacharacters (a `)` in a search
  box could otherwise restructure the query).

**Settings / profile**
- "Private account" now persists to `profiles.is_private` (optimistic UI,
  device‑only fallback on error) — previously a device‑local toggle nothing
  read.
- Settings → Archive now drives real `posts.status` via the same server fn the
  profile Manage sheet uses (was a separate device list nothing else saw).
- Sign‑out navigates even if the network call fails; unblock surfaces errors.
- Missing `posts` table now renders the empty state, not the root error page.

**Repo hygiene**
- 9 duplicated `timeAgo` implementations → one `frontend/lib/format.ts`
  (with the SSR‑stable reference‑clock variant preserved for feed cards).
- Seed‑map non‑null assertions replaced with a non‑nullable demo fallback — a
  seed edit can no longer crash every fallback path.
- Stale comments fixed (`vite.config.ts` SSR claim, `auth-attacher.ts` path).
- `bun.lock` removed.

---

## 4. Tests — 183 → 4,070, and the fake one killed

The old `src/tests/security/rls.test.ts` derived its expected results from the
same matrix it was checking (`simulate()` looked up the expectation) — it could
never fail. Replaced with:

- **`policyEngine.ts`** — an independent evaluator that re‑implements the
  app's Supabase policies as code, read from the real migrations (permissive
  policies OR together; `TO authenticated` never applies to anon; no applicable
  policy = deny; `service_role` bypasses; posts/profiles/comments/follows/blocks/
  DMs/admin semantics all encoded).
- **`rls-matrix.ts`**: 137 → **475 cases** (31 tables × roles × actions),
  frozen at runtime.
- Three suites (**1,648 tests**): per‑case engine↔matrix agreement,
  security invariants ("anon can never insert into `admin_roles`", "service_role
  bypasses everything", …), and a 620‑combination exhaustive sweep.
- **Nine new matrix suites (2,376 tests)**: admin/news validators, `format.ts`,
  media URLs, native bridge URL logic, `redisCache` (memory + Upstash),
  `gnewsService`, structural checks on the RLS matrix itself.

The engine found and documented two genuine policy quirks worth knowing:
the `follows` SELECT policy's private‑profile probe is itself RLS‑filtered
(third parties effectively see all follow rows), and `messages` UPDATE is
"recipients only" by convention, not by a strict sender‑exclusion predicate.
Both are described inline in the matrix.

Full run: `npm run test` → **19 files, 4,070 passed**. Lint 0 errors, typecheck
0 errors, production build green (also verified on Vercel).

---

## 5. Android / Play Store

- **Package id `buzz.com` → `com.wizz.app`** (capacitor.config.ts,
  build.gradle namespace + applicationId, strings.xml incl. custom URL
  scheme). App label `wizz.app` → **WIZZ**.
  ⚠️ Changing the id means any previously installed build must be
  **uninstalled** before installing these (no in‑place upgrade).
- `versionName 1.0 → 1.0.0`, `versionCode 1`.
- **Release signing**: keystore generated at `~/Desktop/wizz-release.keystore`
  (30‑year validity, RSA 2048). `android/app/keystore.properties` (gitignored)
  points Gradle at it; `assembleRelease` still falls back to the debug key if
  that file is absent so the build never hard‑fails.
- Release bundle + APK built (see TL;DR for paths). Assets are fully local —
  no `server.url`, the WebView boots from the packaged files and only reaches
  out for data via the server‑fn bridge to `https://wizz-kohl.vercel.app`.
**Before you publish to Play**: back up the keystore (losing it = you can never
update the app), and in the Play Console set the version/label from the AAB.
Consider Play App Signing (upload key vs. app signing key) — the console will
walk you through exporting the upload certificate from this keystore.

---

## 6. Known issues / recommendations (honest list, ordered)

1. **Leaked password protection** — dashboard toggle (see §2). The only item
   on this list I could not do myself.
2. **Admin bootstrap** — `admin_roles` is still empty. Open Admin → Roles in
   the deployed app and grant your account (or add your email to
   `ADMIN_EMAILS` in Vercel). Until then only the bootstrap allowlist works.
3. **Mute is split across three stores** (profile‑visit, settings list, feed
   prefs) — they don't share state. Needs one account‑scoped mute table; not
   done because it needs a schema migration + UX pass.
4. **Realtime channels subscribe with only a partial policy guarantee** — fine
   today (chat realtime paths go through service‑role writes), but if you add
   new realtime surfaces, review channel auth first.
5. **No server‑side rate limiting on write endpoints** (invite cap and
   campaign state machine are app‑level guards). Add Supabase network‑limits or
   an edge rate limiter before large public launch.
6. **`logAdEvent` counter increment is not atomic** under concurrent writes —
   cosmetic for stats; fix with a small RPC (`count+1` in SQL) when convenient.
7. **Admin "App config / maintenance mode" toggles** are recorded in the
   session log but change nothing server‑side — labeled as demo in the UI.
8. **Health check false‑alarm**: the client‑side health probe reads
   `count(*)` through the anon key, which RLS makes 0 — misleading but
   non‑breaking; prefer the `fetchCacheStats` admin path for truth.
9. **`admin_metrics` client fallback** fabricates the overview chart from seed
   rows when the RPC is unreachable — acceptable for graceful degradation, but
   the numbers are demo when you see them.

---

## 7. How to reproduce / verify everything

```bash
npm ci                 # clean install (single lockfile now)
npm run lint           # 0 errors
npx tsc --noEmit       # 0 errors
npm run test           # 19 files, 4070 tests
npm run build          # web/production build (this is what Vercel runs)
npm run build:app && npx cap copy android   # native bundle staging
cd android && ./gradlew bundleRelease assembleRelease
```

DB state is reproducible from the Supabase migration history (migration
`wizz_health_indexes_rls_initplan_definer_hardening` is recorded).

---

*Generated overnight by the coding agent. Every claim above was verified
against the live systems (Supabase advisors, Vercel deployment state, local
lint/typecheck/test/build runs) before being written down.*
