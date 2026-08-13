# Campaign App — Technical Documentation

> **Audience**: Junior developers joining the project.  
> **Purpose**: Understand the architecture, locate any piece of code quickly, and follow the correct workflow to ship a change safely.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Folder Structure](#4-folder-structure)
5. [Database Schema](#5-database-schema)
6. [Authentication & Session Flow](#6-authentication--session-flow)
7. [Role & Permission System](#7-role--permission-system)
8. [Page Map — Every Route Explained](#8-page-map--every-route-explained)
9. [Component Hierarchy](#9-component-hierarchy)
10. [Service Layer](#10-service-layer)
11. [Campaign Rules Engine](#11-campaign-rules-engine)
12. [Common Change Recipes](#12-common-change-recipes)
13. [Testing Policy](#13-testing-policy)
14. [Environment Variables](#14-environment-variables)
15. [Running the App Locally](#15-running-the-app-locally)
16. [Change Management — Git Workflow](#16-change-management--git-workflow)

---

## 1. Project Overview

The Campaign App is an internal tool used by state-level campaign leaders to:

- **Plan** upcoming campaigns (date, location, leader, time)
- **Track** attendance and results (participant counts, name lists)
- **Automate** weekly scheduling via recurring campaign rules
- **Report** on campaign activity via downloadable slides and reports

It is a **mobile-first** web application (designed for phones, works on desktop) deployed at a single URL via Vercel. All data is stored in Supabase (hosted Postgres).

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js App Router | 16.1.1 |
| Language | TypeScript | Strict mode |
| UI | React | 19.x |
| Styling | Tailwind CSS | v4 |
| Database | Supabase (Postgres) | — |
| Auth | Supabase Anonymous Auth | — |
| Testing | Vitest + React Testing Library | — |
| Deployment | Vercel | — |
| Scheduled Jobs | Vercel Cron | Every Sunday 01:00 UTC |

**Key NPM packages:**
- `@supabase/supabase-js` — Database queries and auth sessions
- `jszip` — ZIP file creation for slide/report downloads

---

## 3. High-Level Architecture

### 3.1 System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser (User)                         │
│  Campaign App (Next.js SPA served from Vercel)                  │
└───────────────────┬─────────────────────────────────────────────┘
                    │  HTTPS
        ┌───────────┴────────────┐
        │                        │
        ▼                        ▼
┌──────────────┐        ┌───────────────────┐
│  Vercel Edge │        │  Supabase (Cloud)  │
│  (Hosting +  │        │                    │
│  Cron Jobs)  │        │  ┌──────────────┐  │
└──────────────┘        │  │   Postgres   │  │
                        │  │  (Database)  │  │
                        │  └──────────────┘  │
                        │  ┌──────────────┐  │
                        │  │  Auth API    │  │
                        │  │ (Anonymous)  │  │
                        │  └──────────────┘  │
                        └───────────────────┘
```

### 3.2 Application Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Next.js App (Browser)                         │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     React Context Layer                      │  │
│  │   UserContext (auth, role, state)  │  CampaignDatesContext   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                               │                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │                          Pages                             │    │
│  │  /app  /login  /record-results  /results  /admin/*  ...   │    │
│  └─────────────────┬─────────────────────────────────────────┘    │
│                    │ uses                                           │
│  ┌─────────────────▼─────────────────────────────────────────┐    │
│  │                    Shared Components                        │    │
│  │  MobileLayout  Modal  LoadingSpinner  CampaignForm  ...    │    │
│  └─────────────────┬─────────────────────────────────────────┘    │
│                    │ calls                                          │
│  ┌─────────────────▼─────────────────────────────────────────┐    │
│  │                    Service Layer (lib/services/)            │    │
│  │  campaignService  dropdownService  placeService              │    │
│  │  stateLeadersService  statePlacesService  rulesService      │    │
│  │  authService  resultsService  weeklyRefreshService          │    │
│  └─────────────────┬─────────────────────────────────────────┘    │
│                    │ queries via                                    │
│  ┌─────────────────▼─────────────────────────────────────────┐    │
│  │              Supabase Client (lib/supabaseClient.ts)        │    │
│  └─────────────────┬─────────────────────────────────────────┘    │
└────────────────────┼───────────────────────────────────────────────┘
                     │  Supabase JS SDK
                     ▼
             ┌───────────────┐
             │ Supabase Cloud │
             │  (Postgres +   │
             │   Auth API)    │
             └───────────────┘
```

### 3.3 Request Data Flow

```
User Action (e.g. clicks "Add Campaign")
         │
         ▼
   Page Component (app/app/page.tsx)
         │ calls
         ▼
   Service Function (lib/services/campaignService.ts → createCampaign())
         │ calls
         ▼
   Supabase Client (lib/supabaseClient.ts → supabase.from('campaigns').insert())
         │ HTTP
         ▼
   Supabase API → Postgres Database
         │
         ▼
   Returns data → Service → Component → UI updates
```

### 3.4 Server-Side vs. Client-Side

Most of the app runs entirely **in the browser** (client components). The two exceptions are:

| File | Type | Why Server-Side? |
|------|------|-----------------|
| `app/api/auth/validate-leader/route.ts` | API Route | Needs service-role key (bypasses RLS) to look up leaders without exposing the key to browsers |
| `app/api/cron/weekly-refresh/route.ts` | API Route | Called by Vercel Cron; validates a secret token |

Everything else — including all database queries — runs **in the browser** using the anonymous Supabase client, protected by Supabase Row Level Security (RLS) policies.

---

## 4. Folder Structure

```
campaign-app/
│
├── app/                        # All Next.js pages (App Router)
│   ├── layout.tsx              # Root layout: wraps every page with providers
│   ├── page.tsx                # Route: / (auth redirect guard)
│   │
│   ├── login/
│   │   └── page.tsx            # Route: /login
│   │
│   ├── app/                    # Route group: main app pages
│   │   ├── page.tsx            # Route: /app (main campaign feed)
│   │   ├── sr-admin/page.tsx   # Route: /app/sr-admin (State Reporter dashboard)
│   │   ├── tl-admin/page.tsx   # Route: /app/tl-admin (Team Leader dashboard)
│   │   └── components/         # Components used ONLY by /app pages
│   │       ├── AdminQuickActions.tsx
│   │       ├── CampaignCard.tsx
│   │       ├── CampaignCreateForm.tsx
│   │       ├── CampaignFilters.tsx
│   │       ├── CampaignList.tsx
│   │       ├── CampaignSlideView.tsx
│   │       ├── DeleteConfirmModal.tsx
│   │       ├── InlineEditForm.tsx
│   │       ├── useCampaignForm.ts  # Unified form logic hook (shared by Create + InlineEdit)
│   │       ├── useStateDropdowns.ts # State-scoped place/leader dropdowns with caching
│   │       ├── timeOptions.ts
│   │       ├── types.ts
│   │       └── __tests__/      # useCampaignForm.test.ts, useStateDropdowns.test.ts
│   │
│   ├── admin/                  # Admin-only pages (full admin, some also allow SR — see §7)
│   │   ├── page.tsx                # Route: /admin (admin hub)
│   │   ├── backup/                 # Route: /admin/backup — export/restore JSON snapshot
│   │   ├── campaign-categories/    # Route: /admin/campaign-categories — manage TWOL/BOTJ/TLT etc.
│   │   ├── campaign-logs/          # Route: /admin/campaign-logs — audit log, paginated
│   │   ├── campaign-map/           # Route: /admin/campaign-map — map of upcoming campaigns
│   │   ├── campaign-messages/      # Route: /admin/campaign-messages — per-date banner text
│   │   ├── campaign-rules/         # Route: /admin/campaign-rules — recurring scheduling rules
│   │   ├── campaigns-near-me/      # Route: /admin/campaigns-near-me — geolocation-filtered map
│   │   ├── generate-report/        # Route: /admin/generate-report — canvas-based PDF report
│   │   ├── generate-slides/        # Route: /admin/generate-slides — JPEG slide ZIP download
│   │   ├── leader-shares/          # Route: /admin/leader-shares — leader-to-leader sharing links
│   │   ├── member-activity/        # Route: /admin/member-activity — active member counts
│   │   ├── metrics/                # Route: /admin/metrics — usage analytics, row counts
│   │   ├── public-links/           # Route: /admin/public-links — title/description for /public/* pages
│   │   ├── register-interest/      # Route: /admin/register-interest — RSVP ("Yes I'm In")
│   │   ├── results-metrics/        # Route: /admin/results-metrics — names recorded by category
│   │   ├── state-leaders/          # Route: /admin/state-leaders — manage leaders per state
│   │   ├── state-places/           # Route: /admin/state-places — manage places per state
│   │   └── state-places-map/       # Route: /admin/state-places-map — map of all valid places
│   │
│   ├── record-results/
│   │   ├── page.tsx            # Route: /record-results
│   │   └── detail/page.tsx     # Route: /record-results/detail
│   │
│   ├── results/page.tsx        # Route: /results (signed-in JPEG slide viewer)
│   ├── capture/page.tsx        # Route: /capture
│   ├── view-slides/page.tsx    # Route: /view-slides (public, no-login JPEG slide viewer)
│   │
│   ├── public/                 # No-login pages, server-rendered for link-preview metadata
│   │   ├── week1-campaigns/page.tsx
│   │   └── temporary-upcoming-campaigns/page.tsx
│   │
│   ├── auth/callback/route.ts  # Route: /auth/callback — Supabase OAuth code exchange, then redirects
│   │
│   └── api/                    # Server-side API routes
│       ├── auth/validate-leader/route.ts          # Service-role leader lookup on sign-in
│       ├── admin/geocode-address/route.ts
│       ├── admin/geocode-place/route.ts
│       ├── admin/invalidate-user-session/route.ts
│       ├── admin/settings/route.ts
│       ├── public/week1-campaigns/route.ts        # Data route backing /public/week1-campaigns
│       ├── public/temporary-upcoming-campaigns/route.ts
│       ├── tiles/[z]/[x]/[y]/route.ts             # Server-side map tile proxy
│       └── cron/weekly-refresh/route.ts           # Called by Vercel Cron
│
├── components/                 # Shared components (used across multiple pages)
│   ├── CampaignForm.tsx        # Generic campaign add/edit form
│   ├── CampaignMap.tsx         # Leaflet map used by /admin/campaign-map, /admin/state-places-map
│   ├── ErrorBoundary.tsx       # React error boundary
│   ├── LoadingSpinner.tsx      # Loading indicator
│   ├── MapPopupActions.tsx     # RSVP buttons shown inside map popups
│   ├── MobileLayout.tsx        # Page shell: header + bottom nav + content
│   ├── Modal.tsx               # Modal overlay wrapper
│   ├── NearbyCampaignsMap.tsx  # Map for /admin/campaigns-near-me
│   ├── PWAInstallPrompt.tsx    # Install-banner prompt (hidden on /public/* pages)
│   ├── PublicCampaignList.tsx  # Shared list rendering for /public/* pages
│   ├── ServiceWorkerRegistration.tsx
│   └── __tests__/
│
├── contexts/                   # React Contexts (global state)
│   ├── UserContext.tsx         # Auth state: user, role, state, leader
│   └── CampaignDatesContext.tsx# Campaign date window state
│
├── lib/                        # Pure business logic & utilities
│   ├── types.ts                # ALL shared TypeScript interfaces
│   ├── constants.ts            # AUSTRALIAN_STATES + DATABASE_TABLES
│   ├── supabaseClient.ts       # Browser Supabase client
│   ├── supabaseAdmin.ts        # Server-only Supabase admin client
│   ├── auth.ts                 # Login, sign-out, session helpers
│   ├── userProfile.ts          # user_profiles table CRUD
│   ├── campaignFilter.ts       # getUserAdminStatusAndMobile(), isRecognizedAdminStatus()
│   ├── campaignRules.ts        # Rules evaluation engine
│   ├── campaignDates.ts        # Date window calculations
│   ├── campaignLog.ts          # Audit logging (fetchCampaignData → Campaign | null)
│   ├── campaignUtils.ts        # Time formatting, date helpers
│   ├── stateColors.ts          # State → Tailwind CSS colour mapping
│   ├── slideLayout.ts          # Slide generation layout helpers
│   ├── slideGenerator.ts       # Canvas-based JPEG slide generation
│   ├── ariseLayout.ts          # Arise canvas constants, types, column simulation
│   ├── ariseCanvas.ts          # Arise canvas draw helpers + renderAriseCanvas()
│   ├── ariseGenerator.ts       # Arise public API: fetchCampaignsForDate() + generateAndDownloadAriseList()
│   ├── reportGenerator.ts      # Canvas-based PDF report generation
│   ├── reportCanvas.ts         # Canvas drawing helpers for reports
│   ├── leaderShares.ts         # Campaign sharing logic
│   ├── location.ts             # Geolocation → state code
│   ├── geocoding.ts            # Nominatim (OpenStreetMap) address/place → lat-lon
│   ├── placeSite.ts            # splitPlaceAndSite()/combinePlaceAndSite()
│   ├── publicLinks.ts          # Registry of /public/* pages: slug, default title/description
│   ├── rateLimit.ts            # Shared in-memory per-IP rate limiter for public API routes
│   ├── corsUtils.ts            # Origin enforcement for internal API routes
│   ├── siteUrl.ts              # Absolute site origin (for OG tags, canonical URLs)
│   ├── leafletMarkerIcon.ts    # State-tinted map pin icons (shared by every map)
│   ├── recordResultsDraft.ts   # Local-only draft recovery for /record-results/detail
│   ├── resultsLog.ts           # Audit logging for results changes
│   ├── resultsMetrics.ts       # Aggregation for /admin/results-metrics
│   ├── stateRefreshSettings.ts # Per-state weekly-refresh mode ('copy' | 'rules' | 'both' | 'either')
│   ├── errorUtils.ts           # getErrorMessage() — safe error-to-string coercion
│   ├── analytics.ts            # Fire-and-forget event tracking
│   ├── appSettings.ts          # App-level toggles (logging on/off, public link overrides)
│   ├── weeklyRefresh.ts        # getLeadersNotSignedInSinceRefreshByState() + legacy helpers
│   └── services/               # Database service layer — see §10
│
└── lib/__tests__/              # Vitest unit tests — see §13 for the testing policy behind these
    ├── (17 files covering auth, campaignDates, campaignRules, campaignFilter, campaignLog,
    │    campaignUtils, appSettings, ariseLayout, errorUtils, leaderShares, placeSite,
    │    publicLinks, rateLimit, recordResultsDraft, resultsLog, resultsMetrics,
    │    stateRefreshSettings, weeklyRefresh)
    └── lib/services/__tests__/ (13 files, one per service — see §10 — plus supabaseMock.ts,
         the shared Supabase-client mock builder every service test should use)
```

---

## 5. Database Schema

All tables live in the `public` schema of the Supabase Postgres database. Row Level Security (RLS) is enabled.

### 5.1 Table Relationships

```
state_leaders ──────────────────────────────────────┐
  id (PK)                                            │
  state           ←── Used to scope campaigns        │
  leader          ←── Matched on sign-in             │
  mobile          ←── Matched on sign-in             │
  admin           ←── 'AD' | 'SR' | null             │
  last_sign_in_at                                    │
                                                     │
user_profiles ─────────────────────────────────────┐│
  user_id (PK, FK → auth.users)                    ││
  name     ← matches state_leaders.leader           ││
  state    ← matches state_leaders.state            ││
  regular_place                                     ││
  regular_time                                      ││
                                                    ││
campaigns ──────────────────────────────────────────┘┘
  id (PK)
  date
  state
  place
  time
  leader        ← matches state_leaders.leader
  mobile
  category      ← FK → campaign_categories.code
  tl_ok
  sr_ok
  source        'MAN' | 'CFP' | 'RUL'
  user_id       ← who created it
  team_size, pp_cnt, fp_cnt, fpsp_cnt, ir_cnt  ← results summary

results ────────────────────────────────────────────┐
  campaign_id (FK → campaigns.id)                   │
  first_name                                         │
  category_code  'TM' | 'P' | 'F' | 'SP' | 'IR'
    (Team Member / Partial / Full / Full+Sinner's Prayer / Information Request)
  UNIQUE(campaign_id, first_name, category_code)     │
                                                     │
state_places ──────────────────────────────────────┐│
  id (PK)                                          ││
  state                                            ││
  place                                            ││
  site        '' | '1' | '2' | ...                 ││
  UNIQUE(state, place, site)                       ││
                                                   ││
campaign_categories ───────────────────────────────┘│
  code (PK)   'TWOL' | 'BOTJ' | 'TLT' | ...        │
  name                                               │
                                                     │
campaign_rules ─────────────────────────────────────┘
  id (PK)
  name
  leader, state, place, time, mobile
  frequency_type  'weekly' | 'biweekly' | 'monthly'
  frequency_value (for biweekly: number of weeks)
  day_of_week     0=Sun … 6=Sat
  month_week_number  1–4 or -1 (last)
  month_day_of_week  0=Sun … 6=Sat
  start_date, end_date
  is_active, priority
  rule_config  (JSONB: reference_date, exceptions[], override_fields)
  notes

leader_shares
  id (PK)
  owner_state, owner_leader
  shared_with_state, shared_with_leader

campaign_changes_log  (audit trail, 90-day rolling retention)
  id, campaign_id, user_id, change_type  INSERT|UPDATE|DELETE
  old_data (JSONB), new_data (JSONB), changed_fields
  user_email, user_name, created_at

weekly_refresh_log  (cron job audit)
  id, completed_at, created_by, triggered_by
  campaigns_created, campaigns_skipped, campaigns_deleted
  error_message

app_events  (analytics)
  user_id, user_name, user_state, event_type, event_data (JSONB)

app_settings  (feature toggles)
  key, value  (e.g. 'campaign_logging_enabled' = 'true')

user_roles  (redundant, kept for legacy)
  user_id (FK → auth.users), role 'admin' | 'user' | 'viewer'
```

### 5.2 Key Naming Conventions

- **State codes**: Always 2–3 letter uppercase — `VIC`, `NSW`, `QLD`, `SA`, `WA`, `TAS`, `NT`, `ACT`
- **Category codes**: Uppercase short codes — `TWOL` (Two Weekly), `BOTJ` (Book of Judgement), `TLT`
- **Campaign source**: `MAN` (manually created), `CFP` (copied from past), `RUL` (generated from rule)
- **Admin roles**: `AD` = full admin, `SR` = state reporter (can see one state only), `null` = team leader

---

## 6. Authentication & Session Flow

The app uses **Supabase Anonymous Auth** — users never set a password. Instead, they prove identity by matching their mobile number + first name against the `state_leaders` table.

### 6.1 Sign-In Flow

```
                    ┌──────────────────────────────┐
                    │  User visits /login           │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Enter mobile + first name     │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  POST /api/auth/validate-leader│
                    │  (server-side, service role)  │
                    │  • Query state_leaders table  │
                    │  • Match mobile + name        │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼──────────────────────┐
              │                    │                       │
              ▼                    ▼                       ▼
        0 matches             1 match              2+ matches
      Show error         Auto sign-in         Show state picker
                               │               User picks state
                               │                     │
                    ┌──────────▼─────────────────────▼───┐
                    │  completeSignIn(stateLeaderMatch)   │
                    │  1. supabase.auth.signInAnonymously()│
                    │  2. Write user_profiles row         │
                    │  3. Write user_roles (if admin)     │
                    │  4. Update last_sign_in_at          │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  Redirect to /app             │
                    │  UserContext loads via        │
                    │  getAuthenticatedUser()       │
                    └──────────────────────────────┘
```

### 6.2 Session Persistence

- Supabase SDK stores the session token in `localStorage` automatically.
- On every page load, `UserContext` calls `getAuthenticatedUser()` to verify and restore the session.
- If the session expires or is revoked, `onAuthStateChange` fires `SIGNED_OUT`, and `UserContext` clears all state — the user is redirected to `/login`.

### 6.3 Key Auth Files

| File | What it does |
|------|-------------|
| `lib/auth.ts` | `validateStateLeader()`, `completeSignIn()`, `signOut()`, `getCurrentUser()` |
| `lib/services/authService.ts` | `getAuthenticatedUser()` — single DB round-trip resolving user + role |
| `contexts/UserContext.tsx` | Global auth state provider, used by every page via `useUser()` |
| `app/api/auth/validate-leader/route.ts` | Server-side leader lookup (uses service role) |

---

## 7. Role & Permission System

### 7.1 Roles

Roles are determined at runtime from the `state_leaders` table — there is no separate roles table that needs updating.

| Role | `state_leaders.admin` value | What they can see |
|------|----------------------------|-------------------|
| **Full Admin** | `'AD'` | All campaigns for all states |
| **State Reporter** | `'SR'` | All campaigns for their own state only |
| **Team Leader** | `null` (any other value) | Only their own campaigns + campaigns shared with them |

### 7.2 How the Role is Resolved

```
User Signs In
     │
     ▼
getAuthenticatedUser()    (lib/services/authService.ts)
     │
     ├── 1. supabase.auth.getUser()          → get session user ID
     ├── 2. SELECT * FROM user_profiles      → get name + state
     └── 3. SELECT FROM state_leaders        → match on state + ilike(leader, name)
                │
                ├── match.admin === 'AD'  →  isAdmin = true,  adminStatus = 'AD'
                ├── match.admin === 'SR'  →  isAdmin = false, adminStatus = 'SR'
                └── match.admin === null  →  isAdmin = false, adminStatus = null
```

### 7.3 Access Control in Pages

Every protected page checks the role early:

```typescript
// Typical pattern at top of a page's useEffect:
useEffect(() => {
  if (isUserLoading) return;                    // Wait for context
  if (!user) { router.push('/login'); return; } // Not logged in
  if (!isAdmin) { router.push('/app'); return; } // Wrong role
}, [isUserLoading, user, isAdmin, router]);
```

### 7.4 Role Checking in Practice

There is no separate permissions module. Role logic is kept inline wherever it is needed:

- `adminStatus === 'AD'` — full admin check (all states, all admin pages)
- `adminStatus === 'SR'` — state reporter check (own state only)
- `!isAdmin && adminStatus !== 'SR'` — deny both admin-only pages to team leaders
- Role resolution lives in `UserContext` and `lib/campaignFilter.ts` (`getUserAdminStatusAndMobile()`)

---

## 8. Page Map — Every Route Explained

### 8.1 Route Overview

```
/                                     Auth guard — redirects to /app or /login
/login                                Sign in with mobile + name
/app                                  Main campaign feed (home screen)
/app/sr-admin                         State Reporter dashboard
/app/tl-admin                         Team Leader dashboard
/record-results                       Select a campaign to record results for
/record-results/detail                Enter result names + counts
/results                              View result summaries (signed-in JPEG slide viewer)
/capture                              Geolocation-based campaign capture
/view-slides                          Public, no-login JPEG slide viewer

/public/week1-campaigns               Public, no-login "Week 1 Campaigns" link (shareable)
/public/temporary-upcoming-campaigns  Public, no-login temporary-upcoming-campaigns link
/auth/callback                        Supabase OAuth code-exchange handler, not user-facing

/admin                                Admin hub (full admin only)
/admin/campaign-rules                 Manage recurring scheduling rules
/admin/state-leaders                  Manage the state_leaders master list
/admin/state-places                   Manage valid place/suburb names per state
/admin/state-places-map               Map of every valid place, by state
/admin/campaign-categories            Manage campaign type codes (TWOL, BOTJ, TLT, …)
/admin/campaign-messages              Manage date-specific banner messages
/admin/campaign-logs                  View campaign change audit log
/admin/campaign-map                   Interactive map of upcoming campaigns
/admin/campaigns-near-me              Upcoming campaigns near the admin's current location
/admin/register-interest              Tick upcoming campaigns, RSVP ("Yes I'm In" / "Tell Me More")
/admin/member-activity                Active member counts, by total/state/place/campaign
/admin/leader-shares                  Manage campaign sharing between leaders
/admin/public-links                   Edit title/description shown on /public/* link previews
/admin/generate-slides                Generate downloadable presentation slides (JPEG ZIP)
/admin/generate-report                Generate downloadable campaign reports
/admin/metrics                        Admin analytics dashboard (usage, active users, row counts)
/admin/results-metrics                Names recorded per category (TM/P/F/SP), by state/place/campaign
/admin/backup                         Export/restore JSON backup of every admin-curated table
```

> There is no `/debug` route in the current codebase — if you find a reference to one elsewhere, it's stale.

### 8.2 Main App Page (`/app`) — Most Important Page

**File**: `app/app/page.tsx`

This page is the core of the application. Here is what each part does:

```
┌─────────────────────────────────────────────────────┐
│  AdminQuickActions (admin only)                      │
│  — Buttons: Generate Slides, Report, Arise, Refresh  │
├─────────────────────────────────────────────────────┤
│  Expand/Collapse: [+ Add New Campaign]               │
│  └── CampaignCreateForm (when expanded)              │
├─────────────────────────────────────────────────────┤
│  CampaignFilters                                     │
│  — State dropdown │ Place │ Leader │ Mobile │ Past/Future │
├─────────────────────────────────────────────────────┤
│  CampaignList                                        │
│  ┌─── Date header (yellow band) ──────────────────┐ │
│  │  CampaignCard  or  InlineEditForm               │ │
│  │  CampaignCard  or  InlineEditForm               │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─── Next date header ───────────────────────────┐  │
│  │  ...                                            │  │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Key state variables in `app/app/page.tsx`:**

| Variable | Type | Purpose |
|----------|------|---------|
| `allCampaigns` | `Campaign[]` | All fetched campaigns (before filters) |
| `filteredCampaigns` | `Campaign[]` | After state/place/leader/mobile + date filters |
| `filterState` etc. | `string` | Current filter values |
| `dateFilter` | `'past' \| 'future'` | Show past or upcoming campaigns |
| `editingId` | `string \| null` | Campaign currently being edited inline |
| `deleteConfirmCampaign` | `Campaign \| null` | Campaign pending deletion confirmation |
| `adminStatus` | `string \| null` | `'AD'`, `'SR'`, or `null` |
| `sharedWithMeOwners` | `LeaderShareOwner[]` | Leaders who shared campaigns with me |

---

## 9. Component Hierarchy

### 9.1 Full Component Tree for `/app`

```
AppPageContent (app/app/page.tsx)
│
├── MobileLayout (components/MobileLayout.tsx)
│   ├── [Header: app title + sign-out button]
│   ├── [Main content area]
│   │   ├── AdminQuickActions (app/app/components/AdminQuickActions.tsx)
│   │   │   └── [Generate Slides / Report / Arise buttons]
│   │   │
│   │   ├── CampaignCreateForm (app/app/components/CampaignCreateForm.tsx)
│   │   │   └── CampaignForm (components/CampaignForm.tsx)
│   │   │
│   │   ├── CampaignFilters (app/app/components/CampaignFilters.tsx)
│   │   │   └── [4 select dropdowns + date toggle]
│   │   │
│   │   └── CampaignList (app/app/components/CampaignList.tsx)
│   │       ├── [Date header divs]
│   │       ├── CampaignCard (app/app/components/CampaignCard.tsx)
│   │       │   └── [State badge, time, leader, action buttons]
│   │       └── InlineEditForm (app/app/components/InlineEditForm.tsx)
│   │           └── [Edit fields, Save/Cancel buttons]
│   │
│   └── [Bottom navigation bar]
│
└── DeleteConfirmModal (app/app/components/DeleteConfirmModal.tsx)
    └── Modal (components/Modal.tsx)
```

### 9.2 Shared Components (used across multiple pages)

| Component | File | Used By |
|-----------|------|---------|
| `MobileLayout` | `components/MobileLayout.tsx` | Every page |
| `Modal` | `components/Modal.tsx` | DeleteConfirmModal, MobileLayout, campaign-rules page |
| `LoadingSpinner` | `components/LoadingSpinner.tsx` | Every page (loading states) |
| `CampaignForm` | `components/CampaignForm.tsx` | `/record-results` and others |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Root layout |

### 9.3 Component Props Quick Reference

**`CampaignCard`** props (`app/app/components/CampaignCard.tsx`):
```typescript
{
  campaign: Campaign;
  dateFilter: 'past' | 'future';
  isAdmin: boolean;
  adminStatus: string | null;
  userState: string | null;
  userMobileAndLeader: { mobile: string | null; leader: string | null } | null;
  sharedWithMeOwners: LeaderShareOwner[];
  savedCheckboxId: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onToggleCheckbox: (field: 'tl_ok' | 'sr_ok', currentValue: boolean) => void;
  onRecordResults: () => void;
}
```

**`CampaignFilters`** props (`app/app/components/CampaignFilters.tsx`):
```typescript
{
  filterState: string; filterPlace: string;
  filterLeader: string; filterMobile: string;
  dateFilter: 'past' | 'future';
  placeOptions: string[]; leaderOptions: string[]; mobileOptions: string[];
  onChange: (field: 'state' | 'place' | 'leader' | 'mobile', value: string) => void;
  onDateFilterChange: (value: 'past' | 'future') => void;
  onClear: () => void;
}
```

**`MobileLayout`** props (`components/MobileLayout.tsx`):
```typescript
{ children: ReactNode }
```

**`Modal`** props (`components/Modal.tsx`):
```typescript
{
  onClose?: () => void;         // Optional: called on Escape or backdrop click
  children: ReactNode;
  position?: 'center' | 'bottom'; // 'bottom' = slide-up sheet on mobile
}
```

---

## 10. Service Layer

The **service layer** (`lib/services/`) is the **only place** that should directly query the database. Pages and components call service functions — they do not import `supabase` directly.

### 10.1 Service Layer Overview

```
Pages / Components
       │
       │  call
       ▼
lib/services/*.ts          ← THE ONLY PLACE FOR DB QUERIES
       │
       │  use
       ▼
lib/supabaseClient.ts      ← Browser Supabase client
       │
       │  HTTP
       ▼
Supabase Postgres
```

### 10.2 Service Functions Reference

#### `lib/services/campaignService.ts`

| Function | Description |
|----------|-------------|
| `createCampaign(data)` | Insert new campaign + auto-log to audit trail |
| `updateCampaign(id, updates, oldData?)` | Update campaign fields + auto-log |
| `deleteCampaign(id, oldData?)` | Delete campaign + auto-log |
| `getCampaignById(id)` | Fetch single campaign by ID |
| `getCampaignsByDateRange(options)` | Fetch campaigns in a date window |
| `getCampaignsForUser(params)` | Role-aware fetch + shared-leader merge for the main feed |
| `findCampaign(criteria)` | Find by natural key (date + state + place + time + leader) |
| `findCampaignsByKey(criteria)` | Find all matching natural key (returns minimal fields) |

#### `lib/services/dropdownService.ts`

| Function | Description |
|----------|-------------|
| `getPlacesForState(state)` | Sorted place names for a state (for dropdown) |
| `getLeadersForState(state)` | Sorted leader names for a state (for dropdown) |
| `getLeaderMobile(state, leader)` | Mobile number for a specific leader |
| `getCampaignCategories()` | All active campaign category codes + names |

#### `lib/services/rulesService.ts`

| Function | Description |
|----------|-------------|
| `getRules({ adminStatus, userState, userLeader })` | Role-filtered list of campaign rules |
| `createRule(ruleData, createdBy)` | Insert new campaign rule |
| `updateRule(id, ruleData)` | Update rule fields |
| `deleteRule(id)` | Delete rule |
| `setRuleActive(id, isActive)` | Toggle rule's is_active flag |

#### `lib/services/placeService.ts`

| Function | Description |
|----------|-------------|
| `addNewPlaceForState(state, place)` | Insert a new place for a state; silently ignores duplicate (23505) |

#### `lib/services/stateLeadersService.ts`

| Function | Description |
|----------|-------------|
| `getStateLeaders(filterState?)` | All leaders, optionally filtered by state |
| `createStateLeader(input)` | Insert new leader; throws on duplicate |
| `updateStateLeader(id, input)` | Update leader record |
| `deleteStateLeader(id)` | Delete leader record |

#### `lib/services/statePlacesService.ts`

| Function | Description |
|----------|-------------|
| `getStatePlaces(filterState?)` | All places, optionally filtered by state |
| `createStatePlace(input)` | Insert new place; throws on duplicate |
| `updateStatePlace(id, input)` | Update place record |
| `deleteStatePlace(id)` | Delete place record |

#### `lib/services/resultsService.ts`

| Function | Description |
|----------|-------------|
| `getResultsByCampaignId(campaignId)` | All result rows for a campaign |
| `upsertResults(rows)` | Insert or update result name entries |
| `deleteResult(campaignId, firstName, categoryCode)` | Remove a specific result row |

#### `lib/services/authService.ts`

| Function | Description |
|----------|-------------|
| `getAuthenticatedUser()` | One call: auth check + profile + admin status (3 DB round-trips total) |

#### `lib/services/weeklyRefreshService.ts`

| Function | Description |
|----------|-------------|
| `runWeeklyRefresh(supabaseClient, userId)` | Run the full weekly campaign generation pipeline |

#### `lib/services/leaderSharesService.ts`

| Function | Description |
|----------|-------------|
| `getLeaderShares()` | All leader-share rows (owner → shared_with) |
| `createLeaderShare(input)` | Insert a new share; throws on duplicate |
| `deleteLeaderShare(id)` | Delete a share |

#### `lib/services/campaignMapService.ts`

| Function | Description |
|----------|-------------|
| `getMapData(options)` | Campaigns in a date range (optionally by state), grouped by place, with coordinates resolved from `state_places` or on-demand geocoding — backs `/admin/campaign-map` |
| `getStatePlacesMapData(options)` | Same coordinate-resolution pipeline for every valid place — backs `/admin/state-places-map` |
| `fetchPlaceCoordinates(state, place, force?)` | Look up (or force-refresh) one place's lat/lon |

#### `lib/services/nearbyCampaignsService.ts`

| Function | Description |
|----------|-------------|
| `getNearbyCampaigns(...)` | Campaigns within a radius (km) of a centre point, reusing `getMapData()` — backs `/admin/campaigns-near-me` |
| `haversineKm(...)` | Distance-between-two-coordinates helper |

---

## 11. Campaign Rules Engine

The rules engine (`lib/campaignRules.ts`) automatically generates campaign records from scheduling rules stored in the `campaign_rules` table.

### 11.1 How It Works

```
campaign_rules table
  (frequency_type, day_of_week, etc.)
           │
           ▼
  evaluateRule(rule, startDate, endDate)
           │
           ├── 'weekly'  → findWeeklyOccurrences()
           ├── 'biweekly' → findBiweeklyOccurrences()
           └── 'monthly' → findMonthlyOccurrences()
                              │
                              ▼
                    List of matching dates
                              │
                    Filter by: is_active, start_date, end_date, exceptions[]
                              │
                              ▼
                    GeneratedCampaign[] objects
```

### 11.2 Rule Types

| Type | Fields Used | Description |
|------|------------|-------------|
| `weekly` | `day_of_week` | Every week on the same day (e.g., every Saturday) |
| `biweekly` | `day_of_week`, `frequency_value`, `rule_config.reference_date` | Every N weeks (default 2); anchored to a known past date |
| `monthly` | `month_week_number`, `month_day_of_week` | Nth occurrence of a weekday per month (e.g., 2nd Saturday) |

### 11.3 The Weekly Refresh Cycle

Every Sunday at 01:00 UTC, Vercel Cron calls `/api/cron/weekly-refresh`. This triggers:

```
runWeeklyRefresh()  (lib/services/weeklyRefreshService.ts)

Step 1: Calculate target date window (the upcoming second week)
Step 2: Fetch all active rules from campaign_rules
Step 3: Fetch existing campaigns in that window (for deduplication)
Step 4: Back-fill any missing biweekly reference_dates
Step 5: Call evaluateRules() for all rules
Step 6: Insert new campaigns (skip if identical already exists)
Step 7: Update biweekly reference_dates for next cycle
Step 8: Delete old campaigns (before past campaign window)
Step 9: Prune campaign_changes_log (keep 90 days)
Step 10: Log result to weekly_refresh_log
```

---

## 12. Common Change Recipes

Use this section to quickly find **which files to edit** for any given type of change. Once you're done editing, see [§13 Testing Policy](#13-testing-policy) before you commit — a bug fix isn't finished until you have a test that fails on the old code and passes on the new code.

---

### Recipe 1: Add a New Field to a Campaign

**Example**: Add an "attendance_count" field to campaigns.

**Step 1**: Add the column in Supabase
- Go to Supabase Dashboard → Table Editor → `campaigns` table → Add Column
- Name: `attendance_count`, Type: `int4` (nullable)

**Step 2**: Update the TypeScript type
- File: `lib/types.ts`, interface `Campaign` (around line 5)
- Add: `attendance_count?: number | null;`

**Step 3**: Update the create form
- File: `app/app/components/CampaignCreateForm.tsx`
- Add to `formState` initial value
- Add a `<input>` or `<select>` field in the JSX
- Include in the `createCampaign()` call data

**Step 4**: Update the campaign card display
- File: `app/app/components/CampaignCard.tsx`
- Add the field to the rendered output where appropriate

**Step 5**: Update the edit form
- File: `app/app/components/InlineEditForm.tsx`
- Add to form state and JSX

**Step 6**: Update the `EditUpdates` type
- File: `app/app/components/types.ts`
- Add the field to `interface EditUpdates`

**Step 7**: Update the save handler
- File: `app/app/page.tsx`, function `handleSaveEdit`
- Include the new field in the `updates` object passed to `updateCampaign()`

---

### Recipe 2: Add a New Admin Page

**Example**: Add `/admin/notifications` page.

**Step 1**: Create the page file
```
app/admin/notifications/page.tsx
```

**Step 2**: Start with this template:
```typescript
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';

export default function NotificationsPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) { router.push('/admin'); return; }
  }, [isUserLoading, user, isAdmin, router]);

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="p-4 text-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {/* Your page content here */}
      </div>
    </MobileLayout>
  );
}
```

**Step 3**: Add a link from the admin hub
- File: `app/admin/page.tsx`
- Add a `<Link href="/admin/notifications">` entry in the navigation cards section

---

### Recipe 3: Add a New Dropdown to the Campaign Create Form

**Example**: Add a "category" dropdown populated from the database.

**Step 1**: Add data fetching to the dropdown service (if not already there)
- File: `lib/services/dropdownService.ts`
- Add a new async function, e.g., `getNewCategoryOptions()`

**Step 2**: Add state to the form hook
- File: `app/app/components/useCampaignForm.ts`
- Add a new state field and a `useEffect` to fetch the options

**Step 3**: Expose the value from the hook's return object
- In `useCampaignForm.ts`, add the new options array to the return value

**Step 4**: Add the dropdown JSX to the form components
- File: `app/app/components/CampaignCreateForm.tsx` and/or `InlineEditForm.tsx`
- Destructure the new options from `useCampaignForm(...)` and render a `<select>`

**Step 5**: Include in the submit call
- In `useCampaignForm.ts`, include the selected value in the data passed to `createCampaign()` / `updateCampaign()`

---

### Recipe 4: Change How Campaigns Are Filtered

**Example**: Add a "source" filter (MAN / CFP / RUL).

**Step 1**: Add filter state to the main page
- File: `app/app/page.tsx`
- Add: `const [filterSource, setFilterSource] = useState('');`

**Step 2**: Update the `filteredCampaigns` memo
- In the same file, in the `useMemo` block that builds `filteredCampaigns`
- Add: `if (filterSource) filtered = filtered.filter(c => c.source === filterSource);`

**Step 3**: Pass the new filter to `CampaignFilters`
- File: `app/app/components/CampaignFilters.tsx`
- Add the new prop to the component interface and render a new `<select>`

---

### Recipe 5: Change Which Role Can Access a Page

**Example**: Allow State Reporters (SR) to view `/admin/metrics`.

- File: `app/admin/metrics/page.tsx`
- Find the `useEffect` guard (typically lines 1-10 of the component)
- Change: `if (!isAdmin)` to `if (!isAdmin && adminStatus !== 'SR')`

---

### Recipe 6: Add a New Campaign Rule Frequency Type

**Example**: Add a "quarterly" frequency.

**Step 1**: Update the type definition
- File: `lib/types.ts`, interface `CampaignRule`
- Change: `frequency_type: 'weekly' | 'biweekly' | 'monthly' | 'custom'`
- To: `frequency_type: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'custom'`

**Step 2**: Add evaluation logic
- File: `lib/campaignRules.ts`, inside `evaluateRule()`
- Add a new `case 'quarterly':` in the `switch` statement
- Implement `findQuarterlyOccurrences()` (similar pattern to `findMonthlyOccurrences`)

**Step 3**: Update the campaign rules form
- File: `app/admin/campaign-rules/page.tsx`
- Add `'quarterly'` to the frequency type `<select>` options
- Show/hide the appropriate sub-fields

---

### Recipe 7: Modify the Sign-In Validation

**Example**: Change the name-matching logic.

- File: `app/api/auth/validate-leader/route.ts` (server-side validation logic)
- File: `lib/auth.ts` → `normalizeName()` function (normalisation before comparison)

> **Important**: The sign-in API route uses the **service role** (`supabaseAdmin`), not the browser client. This is intentional — it bypasses Row Level Security to query leader records.

---

### Recipe 8: Add a New State to Australia

**Example**: Add "JBT" (hypothetical new territory).

**Step 1**: Update the constants
- File: `lib/constants.ts`
- Add `'JBT'` to `AUSTRALIAN_STATES` array

**Step 2**: Add a state color
- File: `lib/stateColors.ts`
- Add `JBT: { bg: 'bg-teal-100', text: 'text-teal-900' }`

**Step 3**: Add a slide color
- File: `lib/slideLayout.ts`, `SLIDE_STATE_COLORS` object
- Add `JBT: 'rgb(0, 128, 128)'`

**Step 4**: Add places to database
- In Supabase: Insert rows into `state_places` table for the new state

---

### Recipe 9: Change the Bottom Navigation

The bottom nav bar lives entirely in `components/MobileLayout.tsx`. There is a `navItems` array computed from the user's role.

- **To add a nav item**: Find the `navItems` array assignment and add an entry: `{ href: '/new-route', label: 'Label', icon: <SvgIcon /> }`
- **To change icons**: The icons are inline SVG paths in the `navItems` array
- **To change which roles see which items**: Edit the conditional logic that builds the `navItems` array

---

### Recipe 10: Change the Slide or Report Output

The slides and reports are generated client-side using the HTML Canvas API.

| Output | File | Key Constants |
|--------|------|---------------|
| Campaign slides (JPEG, portrait) | `lib/slideGenerator.ts` | `SLIDE_WIDTH`, `SLIDE_HEIGHT`, `FONT_SIZES`, `PLACE_COLS`, `TIME_COLS`, `LEADER_COLS` |
| Arise list (JPEG, landscape) | `lib/ariseLayout.ts` (constants), `lib/ariseCanvas.ts` (drawing), `lib/ariseGenerator.ts` (entry point) | `WIDTH`, `HEIGHT`, `PLACE_COLS`, `TIME_COLS`, `LEADER_COLS` |
| Campaign report (JPEG pages) | `lib/reportGenerator.ts` | — |

To change font size, column widths, or colors for the Arise list: edit the constants in `lib/ariseLayout.ts`. For slides, edit `lib/slideGenerator.ts`.

---

## 13. Testing Policy

These rules apply to **every** change, not just the recipes above. They come from [CLAUDE.md](../CLAUDE.md) and CI enforces the first four automatically (see §15) — but only a human (or an AI assistant) reviewing the diff enforces "does the test actually prove the fix."

### 13.1 The Rules

1. **Every bug-fix PR includes a regression test that fails on the pre-fix code and passes on the post-fix code, in the same PR.** If the bug is purely visual/CSS/copy and genuinely can't be captured in a test, say so explicitly in the PR description instead of silently skipping it.
2. **Every new function added to `lib/` or `lib/services/` ships with a test in the same PR.**
3. **Prove red → green before calling a fix "done."** Run the new/updated test against the pre-fix code first (see §13.3 below) to confirm it actually fails, then against the fix to confirm it passes. A test that currently passes is not sufficient on its own — it must be shown to have caught the original bug.
4. **Mock the Supabase client with the shared builder** in `lib/services/__tests__/supabaseMock.ts` rather than hand-rolling `vi.mock` chains per test file. Every file in `lib/services/__tests__/` already does this — copy the pattern from the closest existing test rather than inventing a new one.
5. **If you're investigating a production incident with a one-off script in `scripts/`, the investigation isn't closed until the root cause is captured as a permanent test** in `lib/__tests__/` or `lib/services/__tests__/` — the script is evidence, not the fix's safety net.
6. **Role/status checks against `state_leaders.admin` must go through `isRecognizedAdminStatus()`** in `lib/campaignFilter.ts` — never re-implement `=== 'AD' || === 'SR'` inline. A past bug (a truthy check at one call site silently misrouted leaders with junk data in that column) is exactly why this rule exists.

### 13.2 Where Tests Live

| Directory | What goes here |
|-----------|-----------------|
| `lib/__tests__/` | Tests for pure logic in `lib/*.ts` (dates, rules, filters, formatting, etc.) |
| `lib/services/__tests__/` | Tests for every `lib/services/*.ts` file, using `supabaseMock.ts` |
| `app/app/components/__tests__/` | Tests for the hooks in `app/app/components/` (`useCampaignForm`, `useStateDropdowns`) |
| `components/__tests__/` | Tests for shared components in `components/` |

Run one file directly with:

```bash
npx vitest run lib/__tests__/campaignFilter.test.ts
```

### 13.3 How to Prove Red → Green

For a bug fix, before you consider it done:

```bash
# 1. Write the regression test against the FIXED code first, then confirm
#    it currently passes (sanity check the test itself isn't broken).
npx vitest run lib/__tests__/yourNewTest.test.ts

# 2. Stash your fix (keep the test) and re-run — it MUST fail now.
git stash push -- lib/theFileYouFixed.ts
npx vitest run lib/__tests__/yourNewTest.test.ts   # expect: FAIL

# 3. Restore your fix and confirm green again.
git stash pop
npx vitest run lib/__tests__/yourNewTest.test.ts   # expect: PASS
```

If the fix and the test live in the same file (rare), use `git show HEAD~1:path/to/file.ts > /tmp/old.ts` and diff manually, or check out the parent commit for that one file instead of stashing.

---

## 14. Environment Variables

### 14.1 All Variables

| Variable | Where Used | Required |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabaseClient.ts`, `lib/supabaseAdmin.ts` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabaseClient.ts` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabaseAdmin.ts` (server-only API routes) | Yes |
| `CRON_SECRET` | `app/api/cron/weekly-refresh/route.ts` | Yes (production) |
| `NEXT_PUBLIC_ADMIN_EMAILS` | Referenced but not actively enforced | No |

### 14.2 Where to Set Them

- **Local development**: Create `.env.local` in the project root (never commit this file)
- **Production (Vercel)**: Vercel Dashboard → Project Settings → Environment Variables

---

## 15. Running the App Locally

### 15.1 Prerequisites

- Node.js 20+
- npm 10+
- Access to the Supabase project credentials

### 15.2 First-Time Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd campaign-app

# 2. Install dependencies
npm install

# 3. Create environment variables
cp .env.example .env.local   # or create manually

# 4. Edit .env.local and fill in:
#    NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
#    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
#    CRON_SECRET=any-random-string-for-local-testing
```

### 15.3 Daily Development

```bash
# Start the development server (hot reload)
npm run dev
# Opens at http://localhost:3000
```

### 15.4 Before Committing

Always run all four checks locally before pushing:

```bash
# 1. Type checking (catches TypeScript errors)
npx tsc --noEmit

# 2. Linting (catches code style issues)
npm run lint

# 3. Unit tests
npm test

# 4. Production build (catches build-only errors)
npm run build
```

These are the same four jobs CI runs on every push (Lint · Type-check · Unit tests · Build). Before you get here, make sure you've actually followed the [Testing Policy](#13-testing-policy) above — `npm test` passing is not the bar; a regression test that's been proven to fail on the pre-fix code is.

---

## 16. Change Management — Git Workflow

This section gives exact git commands to follow for every change. The rule is simple: **every change goes through a feature branch and passes CI before merging**.

> `main` branch auto-deploys to production. Never push directly to `main`.

---

### Step 1: Start From a Clean Main

Before starting any new work, make sure you are on `main` and it is up to date:

```bash
# Switch to main
git checkout main

# Pull the latest changes from the remote
git pull origin main

# Confirm you are on main and it is up to date
git status
# Expected output:
#   On branch main
#   Your branch is up to date with 'origin/main'.
#   nothing to commit, working tree clean
```

---

### Step 2: Create a Feature Branch

Branch names follow the pattern: `<type>/<short-description>`

| Type | When to use |
|------|------------|
| `feat/` | Adding new functionality |
| `fix/` | Fixing a bug |
| `refactor/` | Restructuring code without changing behaviour |
| `chore/` | Tooling, config, dependency updates |
| `docs/` | Documentation only |

```bash
# Create and switch to a new branch
git checkout -b feat/add-attendance-count

# Or for a bug fix:
git checkout -b fix/campaign-date-filter
```

---

### Step 3: Make Your Changes

Edit the relevant files. Use the [Common Change Recipes](#13-common-change-recipes) section above to find the right files.

After editing, verify your changes work:

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Check for lint errors
npm run lint

# Run unit tests
npm test

# Optionally: Start the dev server and test manually
npm run dev
```

---

### Step 4: Stage and Commit Your Changes

```bash
# See what files changed
git status

# Stage specific files (preferred — avoids accidentally including .env files)
git add lib/types.ts app/app/components/CampaignCard.tsx

# OR stage all changed files (use with care)
git add -A

# Commit with a clear message explaining WHY the change was made
git commit -m "feat: add attendance_count field to campaigns

Captures total attendees per campaign to support weekly reporting.
Includes DB type update, form field, card display, and inline edit."
```

**Good commit message rules:**
- Start with `feat:`, `fix:`, `refactor:`, `chore:`, or `docs:`
- First line: 72 characters max, imperative tense ("add", "fix", "update" not "added")
- After a blank line: add more detail if the change is complex

---

### Step 5: Push Your Branch

```bash
# Push your branch to GitHub (first time pushing this branch)
git push -u origin feat/add-attendance-count

# Subsequent pushes to the same branch
git push
```

This triggers the CI pipeline (Lint + Type-check + Unit tests + Build). Wait for it to pass.

---

### Step 6: Check CI Status

```bash
# List recent CI runs
gh run list --limit 5

# Watch the latest run in real time
gh run watch

# If CI fails — view the specific error
gh run view --log-failed
```

If CI fails, fix the issue, commit, and push again. The PR can only be merged after CI is green.

---

### Step 7: Create a Pull Request

```bash
# Create a PR via GitHub CLI
gh pr create \
  --title "feat: add attendance_count field to campaigns" \
  --body "## Summary
- Added attendance_count column to campaigns table
- Updated Campaign type in lib/types.ts
- Added input field to CampaignCreateForm and InlineEditForm
- Displays on CampaignCard

## Test plan
- [ ] Create a campaign with attendance count — verify it saves
- [ ] Edit a campaign — verify count loads and saves
- [ ] Verify existing campaigns without count display correctly (null → empty)"
```

This outputs a PR URL. Share it with Peter for review.

---

### Step 8: Handle Review Feedback

If Peter requests changes:

```bash
# Make the requested changes to your files
# Then commit and push:
git add <changed-files>
git commit -m "fix: address review feedback — use nullable int not text"
git push
```

The PR automatically updates. CI re-runs.

---

### Step 9: Merge (Peter's Approval Required)

**Peter approves and merges the PR via GitHub.** This is the only way to get code into `main`. Once merged:

- Vercel detects the push to `main` and automatically starts a production deployment
- The deployment usually completes within 2–3 minutes

---

### Step 10: Clean Up After Merge

```bash
# Switch back to main
git checkout main

# Pull the merged changes
git pull origin main

# Delete the local feature branch (it's now in main)
git branch -d feat/add-attendance-count

# Optionally delete the remote branch too
git push origin --delete feat/add-attendance-count
```

---

### Quick Reference: All Git Commands

```bash
# ── Starting work ────────────────────────────────────────────────
git checkout main
git pull origin main
git checkout -b feat/my-feature

# ── During work ──────────────────────────────────────────────────
git status                    # See what changed
git diff                      # See exact changes
git add path/to/file.ts       # Stage a specific file
git add -A                    # Stage everything (careful!)
git commit -m "feat: ..."     # Commit with a message

# ── Pushing ──────────────────────────────────────────────────────
git push -u origin feat/my-feature  # First push (creates remote branch)
git push                             # Subsequent pushes

# ── CI & PR ──────────────────────────────────────────────────────
gh run list --limit 5         # List CI runs
gh run watch                  # Watch current run
gh run view --log-failed      # See failure details
gh pr create ...              # Create pull request
gh pr view --web              # Open PR in browser

# ── Incorporating upstream changes into your branch ───────────────
git fetch origin
git rebase origin/main        # Replay your commits on top of latest main

# ── Reverting a file to its last committed state ──────────────────
git checkout -- path/to/file.ts

# ── Viewing history ──────────────────────────────────────────────
git log --oneline -10         # Last 10 commits, compact
git log --oneline origin/main..HEAD  # Commits on this branch not yet in main

# ── After PR is merged ───────────────────────────────────────────
git checkout main
git pull origin main
git branch -d feat/my-feature
```

---

### Common Mistakes to Avoid

| Mistake | Consequence | How to avoid |
|---------|------------|-------------|
| Pushing directly to `main` | Blocked by branch protection (or goes straight to production) | Always create a feature branch |
| Committing `.env.local` | Exposes database credentials publicly | Check `git status` before committing; `.env.local` is in `.gitignore` |
| Skipping CI checks locally | PR fails CI, slows review cycle | Run `npx tsc --noEmit && npm run lint && npm test` before pushing |
| Force-pushing to `main` | Can overwrite others' work | Never use `git push --force` on `main` |
| Merging without Peter's approval | Bypasses quality review | `main` has branch protection — requires review approval |

---

---

## Regenerating this document as a PDF

The PDF version (`TECHNICAL_DOCS.pdf`) is not committed to the repository. To regenerate it locally, run the following single command from the project root (requires macOS with Google Chrome installed):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --print-to-pdf="$(pwd)/TECHNICAL_DOCS.pdf" \
  <(node -e "
    const {readFileSync,writeFileSync}=require('fs');
    const {marked}=require('marked');
    const md=readFileSync('TECHNICAL_DOCS.md','utf8');
    const html='<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>body{font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.65;color:#1a1a2e;max-width:900px;margin:0 auto}h1{font-size:22pt;border-bottom:3px solid #2563eb;padding-bottom:6pt}h2{font-size:14pt;color:#1e3a5f;border-bottom:1.5px solid #93c5fd;padding-bottom:4pt;margin-top:24pt}h3{font-size:11.5pt;color:#1e40af}pre{background:#0f172a;color:#e2e8f0;border-radius:5pt;padding:11pt;font-size:8pt;white-space:pre;page-break-inside:avoid}pre:not([class*=language]){background:#f8fafc;color:#0f172a;border:1px solid #cbd5e1;font-size:7.4pt}code{font-family:monospace;background:#f1f5f9;border:1px solid #e2e8f0;padding:1pt 4pt;font-size:8.8pt}pre code{background:transparent;border:none}table{border-collapse:collapse;width:100%;font-size:9.2pt}thead tr{background:#1e3a5f;color:#fff}thead th,tbody td{padding:5pt 9pt;border:1px solid #d1d5db}tbody tr:nth-child(even){background:#f0f7ff}blockquote{background:#eff6ff;border-left:4px solid #3b82f6;padding:8pt 14pt;font-style:italic}</style></head><body>'+marked.parse(md)+'</body></html>';
    const tmp=require('os').tmpdir()+'/techdocs.html';
    writeFileSync(tmp,html);
    console.log(tmp);
  ")
```

Or use the simpler two-step approach:

```bash
# Step 1 — convert markdown to HTML
node -e "
  const {readFileSync,writeFileSync}=require('fs');
  const {marked}=require('marked');
  const md=readFileSync('TECHNICAL_DOCS.md','utf8');
  const html='<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><title>Campaign App Docs</title></head><body>'+marked.parse(md)+'</body></html>';
  writeFileSync('/tmp/techdocs.html',html);
  console.log('HTML written to /tmp/techdocs.html');
"

# Step 2 — print to PDF with Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --print-to-pdf="$(pwd)/TECHNICAL_DOCS.pdf" \
  "file:///tmp/techdocs.html"

echo "PDF saved to $(pwd)/TECHNICAL_DOCS.pdf"
```

The generated PDF is listed in `.gitignore` and should not be committed to the repository.

---

*Last updated: June 2026*
