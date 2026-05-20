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
- `lib/permissions.ts` defines the `Permission` enum and `hasPermission()` helper (used for coarse-grained checks).

### Data layer
- **`lib/services/campaignService.ts`** — all CRUD for the `campaigns` table: `getCampaignById`, `createCampaign`, `updateCampaign`, `deleteCampaign`, `getCampaignsByDateRange`, `findCampaign`.
- **`lib/services/dropdownService.ts`** — `getPlacesForState`, `getLeadersForState`, `getLeaderMobile`. Single source of truth for dropdowns that appear on multiple pages.
- **`lib/campaignLog.ts`** — fire-and-forget audit logging to `campaign_changes_log`. Skips automatically on admin routes and when logging is toggled off via `lib/appSettings.ts`.
- Pages that still query Supabase directly (without going through a service) should be refactored to use the service layer.

### Key shared libraries
| File | Purpose |
|------|---------|
| `lib/types.ts` | Shared TypeScript interfaces (`Campaign` and others) |
| `lib/constants.ts` | `AUSTRALIAN_STATES` array + `AustralianState` type |
| `lib/slideLayout.ts` | Slide/list formatting: state colors, date/time formatters, `getSlideDateHeadings()` |
| `lib/campaignRules.ts` | Rules engine — evaluates recurring campaign scheduling rules |
| `lib/campaignFilter.ts` | `getUserAdminStatusAndMobile()` — resolves the current user's admin level and state from `state_leaders` |
| `lib/errorUtils.ts` | `getErrorMessage()` — safe error-to-string coercion |

### Component structure
- `components/MobileLayout.tsx` — shared shell (header, bottom nav) wrapping every page.
- `components/CampaignForm.tsx` — reusable add/edit form; `CampaignData` interface includes `botj` field.
- `components/ErrorBoundary.tsx` — global React error boundary.
- `contexts/CampaignDatesContext.tsx` — shared date-range state for campaign views.

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
- `campaigns` — core records; `botj` column is the campaign category flag
- `state_leaders` — leaders per state; `admin` column drives role ('AD' / 'SR' / null)
- `state_places` — valid places per state
- `campaign_rules` — recurring scheduling rules
- `campaign_messages` — per-date banner messages
- `campaign_changes_log` — audit trail

### Slide generation
`app/admin/generate-slides/page.tsx` renders JPEG slides entirely on an HTML Canvas (2250×3000 px, 300 DPI). Column layout constants (`PLACE_COLS`, `TIME_COLS`, `LEADER_COLS`, `MOBILE_MAX_COLS`) control field widths; a dynamic `campaignScaleX` compresses text horizontally to fill the available width with exactly one character of margin on each side.
