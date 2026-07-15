# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

### Autonomous (no approval needed)
- Create feature branches (`git checkout -b <branch>`)
- Stage and commit changes — always with a clear message summarising *why*
- Push feature branches to origin (`git push origin <feature-branch>`)
- Create PRs (`gh pr create`) — include summary, test plan, and link to any related task
- Check CI status (`gh run list`, `gh run view`)
- Fix CI failures and push follow-up commits to the same branch

### Always pause and wait for explicit "go ahead"
- **Merging a PR to main** (`gh pr merge`) — main auto-deploys to production
- **Pushing directly to main** — blocked in settings; if ever needed, ask first
- **Force-pushing anything** — blocked in settings; never bypass without discussion

### Communication
- After every commit, state: branch name, commit hash (short), and one-line summary
- After every push, confirm where it went and whether CI was triggered
- When creating a PR, share the URL so Peter can review before approving the merge
- If CI fails, diagnose and fix without asking — then report what was wrong and what changed

## Branch naming
`<type>/<short-description>` — e.g. `fix/campaign-date-filter`, `feat/pagination`, `chore/update-actions`

## Code quality (standing rule)
Every change must pass all four CI jobs: **Lint · Type-check · Unit tests · Build**.  
Never suppress lint errors with disable comments unless there is no correct refactor — always prefer fixing the root cause.

## Testing policy
- Every bug-fix PR includes a regression test that fails on the pre-fix code and passes on the post-fix code, in the same PR. If the bug is purely visual/CSS/copy and genuinely can't be captured in a test, say so explicitly in the PR description rather than silently skipping it.
- Every new function added to `lib/` or `lib/services/` ships with a test in the same PR.
- Before calling a fix "done," verify red→green: run the new/updated test against the pre-fix code (e.g. `git stash`, or check out the parent commit for a specific file) to confirm it actually fails, then against the fix to confirm it passes. A test that currently passes is not sufficient on its own — it must be shown to have caught the original bug.
- Mock the Supabase client with the shared builder in `lib/services/__tests__/supabaseMock.ts` rather than hand-rolling `vi.mock` chains per test file.
- If a production incident is investigated with a one-off script in `scripts/`, the investigation isn't closed until the root cause is captured as a permanent test in `lib/__tests__/` (or `lib/services/__tests__/`) — the script is evidence, not the fix's safety net.
- Role/status checks against `state_leaders.admin` must go through `isRecognizedAdminStatus()` in `lib/campaignFilter.ts` — never re-implement `=== 'AD' || === 'SR'` inline. See #78 (login role bug) for why: a truthy check in one call site silently misrouted leaders with junk data in that column.

## Deployment
- `main` branch → auto-deploys to production via Vercel/hosting
- Do not merge until CI is green and Peter has approved the PR

---

## Commands

```bash
npm run dev        # Start Next.js dev server
npm run build      # Production build
npm run lint       # ESLint across app/, components/, lib/
npx tsc --noEmit   # Type-check without emitting
npm test           # Run all Vitest unit tests (vitest run)
npx vitest run lib/__tests__/auth.test.ts   # Run a single test file
```

---

## Architecture

### Stack
- **Next.js 16 App Router** — all pages live under `app/`. No Pages Router.
- **React 19** with client components (`'use client'`) for all interactive UI.
- **Supabase** (`@supabase/supabase-js`) — Postgres database + auth. Two clients:
  - `lib/supabaseClient.ts` — browser client, used everywhere in the frontend.
  - `lib/supabaseAdmin.ts` — service-role client, used only in API routes.
- **Tailwind CSS v4** — utility-first styling, dark-mode via `dark:` variants.
- **Vitest + jsdom + React Testing Library** — unit tests in `lib/__tests__/`.

### Auth & roles
- Login is mobile-number + name via `lib/auth.ts` (`signInWithMobileAndName`).
- Role is resolved at runtime from the `state_leaders` table:
  - `admin = 'AD'` → full admin
  - `admin = 'SR'` → state reporter (can only see/edit their own state)
  - Otherwise → regular user
- `contexts/UserContext.tsx` (`useUser()`) is the single source of truth for the current user, profile, role (`isAdmin`, `adminStatus`), state, and leader. Pages read from this context rather than querying auth themselves.
- Role checking is done inline: compare `adminStatus === 'AD'` (full admin) or `adminStatus === 'SR'` (state reporter). No permissions module — role logic lives in `UserContext` and `campaignFilter.ts`.

### Data layer
All database access goes through service modules in `lib/services/`. Pages and components must not import `supabase` directly for CRUD operations.

- **`lib/services/campaignService.ts`** — all CRUD for the `campaigns` table: `getCampaignById`, `createCampaign`, `updateCampaign`, `deleteCampaign`, `getCampaignsByDateRange`, `findCampaign`, `getCampaignsForUser` (role-aware fetch + shared-leader merge for the main feed).
- **`lib/services/dropdownService.ts`** — `getPlacesForState` (returns `PlaceOption[]`, each with `place`/`site`/a combined `label` like "Orange 1"), `getLeadersForState`, `getLeaderMobile`. Single source of truth for dropdowns that appear on multiple pages.
- **`lib/services/placeService.ts`** — `addNewPlaceForState` — inserts into `state_places`; silently ignores duplicate (23505). Used when a user types a new place in a campaign form.
- **`lib/services/stateLeadersService.ts`** — CRUD for the `state_leaders` table: `getStateLeaders`, `createStateLeader`, `updateStateLeader`, `deleteStateLeader`. Exports the `StateLeader` interface.
- **`lib/services/statePlacesService.ts`** — CRUD for the `state_places` table: `getStatePlaces`, `createStatePlace`, `updateStatePlace`, `deleteStatePlace`. Exports the `StatePlace` interface (includes `site`; the table's uniqueness key is `state`+`place`+`site`).
- **`lib/placeSite.ts`** — `splitPlaceAndSite()`/`combinePlaceAndSite()`. The single source of truth for parsing/joining the numeric site suffix (e.g. "Orange 1" ⇄ `{ place: "Orange", site: "1" }`); used by the migration script and every place selector/display.
- **`lib/campaignLog.ts`** — fire-and-forget audit logging to `campaign_changes_log`. Skips automatically on admin routes and when logging is toggled off via `lib/appSettings.ts`. `fetchCampaignData` returns `Campaign | null`.

### Key shared libraries
| File | Purpose |
|------|---------|
| `lib/types.ts` | Shared TypeScript interfaces (`Campaign` and others) |
| `lib/constants.ts` | `AUSTRALIAN_STATES` array + `AustralianState` type; `DATABASE_TABLES` array used by the metrics dashboard |
| `lib/slideLayout.ts` | Slide/list formatting: state colors, date/time formatters, `getSlideDateHeadings()` |
| `lib/campaignRules.ts` | Rules engine — evaluates recurring campaign scheduling rules |
| `lib/campaignFilter.ts` | `getUserAdminStatusAndMobile()` — resolves the current user's admin level and state from `state_leaders` |
| `lib/errorUtils.ts` | `getErrorMessage()` — safe error-to-string coercion |
| `lib/ariseLayout.ts` | Canvas dimension constants (WIDTH=4200 px, HEIGHT=3000 px), font sizes, spacing constants, `AriseCampaign` interface, `apx()` helper, `simulateColumnCount()`, `computeColLayout()` |
| `lib/ariseCanvas.ts` | Canvas draw helpers (`drawBannerAndKey`, `drawDateHeader`, `drawCampaignLine`, `drawWeekSeparator`) and `renderAriseCanvas()` — the main rendering function |
| `lib/ariseGenerator.ts` | Public API only: `fetchCampaignsForDate()` (data fetching) + `generateAndDownloadAriseList()` (orchestrates render + JPEG download). Delegates drawing to `ariseCanvas.ts` |

### Component structure
- `components/MobileLayout.tsx` — shared shell (header, bottom nav) wrapping every page. Resolves admin status via `getUserAdminStatusAndMobile()`.
- `components/CampaignForm.tsx` — reusable add/edit form used by the admin panel; `CampaignData` interface includes `botj` field.
- `components/ErrorBoundary.tsx` — global React error boundary.
- `contexts/CampaignDatesContext.tsx` — shared date-range state for campaign views.
- `app/app/components/useCampaignForm.ts` — unified form hook shared by `CampaignCreateForm` and `InlineEditForm`. Owns all form state (date, state, place, time, leader, mobile, category, tl_ok, sr_ok), place creation, leader mobile auto-fill, and submit orchestration. `handleSubmit` accepts both `FormEvent` and `MouseEvent`.
- `app/app/components/useStateDropdowns.ts` — fetches and caches state-scoped place and leader lists. All `setState` calls are routed through Promise chains to satisfy the `react-hooks/set-state-in-effect` rule.

### Page map
| Route | Description |
|-------|-------------|
| `/login` | Mobile + name login |
| `/app` | Main campaign feed (home screen) |
| `/campaign-list` | Week-by-week slide-style campaign list |
| `/capture` | Geolocation capture for campaigns |
| `/record-results` | Record campaign results |
| `/results` | JPEG slide viewer |
| `/admin` | Admin panel hub |
| `/admin/state-leaders` | Manage leaders per state |
| `/admin/state-places` | Manage places per state |
| `/admin/campaign-rules` | Manage recurring campaign rules |
| `/admin/campaign-messages` | Manage per-date banner messages |
| `/admin/campaign-logs` | View audit log (paginated) |
| `/admin/generate-slides` | Generate JPEG slide ZIP |
| `/admin/generate-report` | Generate campaign report |
| `/admin/leader-shares` | Leader share links |

### Database tables (key ones)
- `campaigns` — core records; `botj` column is the campaign category flag; `place`+`site` together identify the location
- `state_leaders` — leaders per state; `admin` column drives role ('AD' / 'SR' / null)
- `state_places` — valid places per state; keyed on `state`+`place`+`site` (`site` holds a numeric sub-location suffix, e.g. "1" for "Orange 1")
- `campaign_rules` — recurring scheduling rules; also carries `place`+`site`
- `campaign_messages` — per-date banner messages
- `campaign_changes_log` — audit trail

### Slide generation
The arise (Week 1 Campaigns) list generator is split across three modules:
- `lib/ariseLayout.ts` — constants, types, and column simulation (no canvas ops)
- `lib/ariseCanvas.ts` — all drawing primitives and `renderAriseCanvas()`
- `lib/ariseGenerator.ts` — data fetching and the public `generateAndDownloadAriseList()` entry point

Canvas is 4200×3000 px (14"×10" at 300 DPI). Column layout constants (`PLACE_COLS`, `TIME_COLS`, `LEADER_COLS`) control field widths; a dynamic `campaignScaleX` compresses text horizontally to fill the available width.

`app/admin/generate-slides/page.tsx` renders a separate JPEG slide (2250×3000 px, 300 DPI) using a different Canvas pipeline. `PLACE_COLS`, `TIME_COLS`, `LEADER_COLS`, `MOBILE_MAX_COLS` constants control field widths there.
