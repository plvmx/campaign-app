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
17. [Registry Pipeline — Separate Subsystem](#17-registry-pipeline--separate-subsystem)
18. [Public Links, Member Interest & Leader Tools](#18-public-links-member-interest--leader-tools)
19. [Slide & Report Generation, Campaign Reports](#19-slide--report-generation-campaign-reports)
20. [UI Conventions](#20-ui-conventions)
21. [Operational Scripts & Deploy-Order Notes](#21-operational-scripts--deploy-order-notes)
22. [Keeping This Document Current](#22-keeping-this-document-current)

---

## 1. Project Overview

The Campaign App is an internal tool used by state-level campaign leaders to:

- **Plan** upcoming campaigns (date, location, leader, time)
- **Track** attendance and results (participant counts, name lists)
- **Automate** weekly scheduling via recurring campaign rules
- **Report** on campaign activity via downloadable slides and reports
- **Capture interest** from the public (register for campaigns and training sessions) and notify the owning leader
- **Secure access** — admins must sign in with email + an authenticator-app code; leaders may add 2FA to view members' personal details (§6)

Alongside the campaign app, a separate **registry pipeline** consolidates AFJ's ActiveCampaign registration data into the same Supabase project (§17).

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
| Auth | Supabase Anonymous Auth (plain leaders) + Supabase Auth magic link + TOTP MFA (admins; optional for leaders) | — |
| Testing | Vitest + React Testing Library | — |
| Deployment | Vercel | — |
| Scheduled Jobs | Vercel Cron | Every Sunday 01:00 UTC |

**Key NPM packages:**
- `@supabase/supabase-js` — Database queries and auth sessions
- `jszip` — ZIP file creation for slide/report downloads
- `pdfjs-dist` (pinned 5.4.x) — in-app User Guide viewer (§18.4)
- Leaflet — maps (§18.1)
- External services: Resend (registry WhatsApp-invite email), ClickSend (leader SMS), ActiveCampaign API (registry sync), Nominatim (geocoding)

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
│   │   ├── page.tsx            # Route: /login (mobile+name; email-capture / 2FA-setup steps — see §6)
│   │   └── mfa/                # Route: /login/mfa (email sign-in) + /login/mfa/callback (magic link → TOTP → role picker)
│   ├── confirm-email/          # Route: /confirm-email — leader email-confirmation magic-link landing page
│   ├── setup-mfa/              # Route: /setup-mfa — authenticator-app (TOTP) enrolment landing page
│   ├── help/2fa/               # Route: /help/2fa — public, printable step-by-step setup guide
│   ├── campaign-interest/      # Route: /campaign-interest — leader view of people who registered interest (2FA-gated)
│   ├── training-interest/      # Route: /training-interest (+ /[campaignId]) — leader view of training-session interest
│   │
│   ├── app/                    # Route group: main app pages
│   │   ├── page.tsx            # Route: /app (main campaign feed)
│   │   ├── sr-admin/page.tsx   # Route: /app/sr-admin (State Reporter dashboard)
│   │   ├── tl-admin/page.tsx   # Route: /app/tl-admin ("My Admin" for plain team leaders)
│   │   ├── guide/page.tsx      # Route: /app/guide — in-app CAS User Guide PDF viewer (OPEN GUIDE)
│   │   ├── check-registration/ # Route: /app/check-registration — leader "is this person registered?" check
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
│   │   ├── campaign-messages/      # Route: /admin/campaign-messages — per-date banner text
│   │   ├── campaign-rules/         # Route: /admin/campaign-rules — recurring scheduling rules
│   │   ├── campaigns-near-me/      # Route: /admin/campaigns-near-me — geolocation-filtered map
│   │   ├── campaign-reports-cleanup/ # Route: /admin/campaign-reports-cleanup — fill State/Place/Leader on campaign_reports
│   │   ├── check-registration/     # Route: /admin/check-registration — registry lookup by mobile/email (AD + 2FA)
│   │   ├── generate-week-campaigns/ # Route: /admin/generate-week-campaigns — "Single Week Campaigns" JPEG
│   │   ├── registered-interest/    # Route: /admin/registered-interest — everyone who registered interest
│   │   ├── stuck-leaders/          # Route: /admin/stuck-leaders — leaders stuck on email/2FA setup
│   │   ├── components/             # Admin hub cards: UserGuideUploadCard, TechInsightsSettingsCard
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
│   │   ├── layout.tsx          # Applies large-text; shows "← Back to app" bar when ?from=app
│   │   ├── week1-campaigns/page.tsx
│   │   ├── temporary-upcoming-campaigns/page.tsx
│   │   ├── final-campaign-lists/page.tsx
│   │   ├── campaign-results/page.tsx
│   │   ├── register-interest/page.tsx
│   │   ├── upcoming-campaigns/page.tsx
│   │   ├── campaigns-near-me/page.tsx   # personalised per registry registrant (?r=<id>)
│   │   └── training/[campaignId]/page.tsx
│   │
│   ├── auth/callback/route.ts  # Route: /auth/callback — Supabase OAuth code exchange, then redirects
│   │
│   └── api/                    # Server-side API routes
│       ├── auth/                                  # validate-leader, grant-session-access, revoke-session-access,
│       │                                          #   propose-email, confirm-email, request-mfa-setup, complete-mfa-setup
│       ├── leader/                                # check-registration, interest-counts (signed-in leaders)
│       ├── registry/                              # manage-summary, manage-record, manage-edit-log, manage-whatsapp-invite-log (§17)
│       ├── admin/{check-registration,stuck-leaders,tech-insights,reset-mfa,user-guide/upload-url,campaign-reports/derived-fields}
│       ├── admin/geocode-address/route.ts
│       ├── admin/geocode-place/route.ts
│       ├── admin/invalidate-user-session/route.ts
│       ├── admin/settings/route.ts
│       ├── public/*/route.ts                      # One data route per /public page (+ geocode-postcode, user-guide)
│       ├── tiles/[z]/[x]/[y]/route.ts             # Server-side map tile proxy
│       └── cron/weekly-refresh/route.ts           # Called by Vercel Cron
│
├── components/                 # Shared components (used across multiple pages)
│   ├── CampaignForm.tsx        # Generic campaign add/edit form
│   ├── CampaignMap.tsx         # Leaflet map used by /public/upcoming-campaigns, /admin/state-places-map
│   ├── auth/                   # Sign-in / 2FA setup building blocks (CodeEntryScreen, MfaEnrollmentFlow,
│   │                           #   TapToContinue, EmailAndCodeFallback, SigningInStuck, GetHelp, SetupStep,
│   │                           #   RequireTwoFactorForMemberDetails, …) — see §6
│   ├── ErrorBoundary.tsx       # React error boundary
│   ├── GuideScreen.tsx         # Full-screen CAS User Guide viewer (uses PdfGuideViewer.tsx / pdf.js)
│   ├── LoadingSpinner.tsx      # Loading indicator
│   ├── MapPopupActions.tsx     # RSVP buttons shown inside map popups
│   ├── MobileLayout.tsx        # Page shell: header + bottom nav + content
│   ├── Modal.tsx               # Modal overlay wrapper
│   ├── NearbyCampaignsMap.tsx  # Map for /admin/campaigns-near-me
│   ├── PWAInstallPrompt.tsx    # Install-banner prompt (hidden on /public/* pages; renders nothing until after mount so SSR/hydration match, then detects platform)
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
│   ├── userProfile.ts          # user_profiles reads (profile writes are server-only since 2026-10 — see §6.5)
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

user_roles  (written server-side only; not read by any RLS policy)
  user_id (FK → auth.users), role 'admin' | 'user' | 'viewer'
```

### 5.1a Later additions

Each has a SQL script in `scripts/`; RLS mirrors live in `supabase/rls-policies.sql`.

```
state_leaders  (new columns)
  email, pending_email        ← confirmed / proposed address. NOT unique (one person, many rows)
  email_confirmed_at          ← set when the address is confirmed
  user_id                     ← auth.users id of that address's sign-in account
  mfa_enrolled_at             ← set when a TOTP factor is verified (see §6.5)

state_leader_email_changes  (audit; append-only)
  state_leader_id, source 'self-serve' | 'admin', old/new value, created_at

state_leader_mfa_resets  (audit of admin "Reset 2FA")
  leader, actor user + label, created_at

campaign_interest
  id, campaign_id (FK → campaigns), first_name, mobile, email  (CHECK: mobile OR email)
  interest_type 'in' | 'more'    ("Yes I'm In" / "Tell Me More")
  contacted, contacted_at
  RLS: admin, or owning/shared leader via join through campaigns — AND aal2 session

training_interest
  same shape for BOTJ/TLT sessions (per-campaign public link); same RLS

campaign_interest_sms_log
  campaign_ids[], leader, status 'sent' | 'failed' | 'skipped_no_mobile', error
  admin SELECT only; writes via service role

campaign_reports  (Campaign Report project, §19.2)
  tallies + paired *_raw columns, needs_review, submitted_at UNIQUE,
  derived_state / derived_place / derived_leader. Admin-only RLS

user_profiles
  now server-written only: INSERT/UPDATE revoked from authenticated/anon (§6.4)

results_changes_log, campaign_messages, app_settings …  (see their create_*.sql scripts)
```

The registry data lives in separate `staging` and `registry` schemas (§17.1).

**Backups.** `BACKUP_TABLE_CONFIG` in `lib/services/backupService.ts` is the single source of truth for what `/admin/backup` exports and in what order — FK-safe (a table appears only after every table it references), because "replace" restore inserts top-to-bottom but deletes bottom-to-top. Bump the export format `version` (see the comment above it) when adding/renaming a table or a backed-up column. Log/audit tables (`campaign_changes_log`, `state_leader_email_changes`, `state_leader_mfa_resets`, `campaign_interest_sms_log`) are excluded.


### 5.2 Key Naming Conventions

- **State codes**: Always 2–3 letter uppercase — `VIC`, `NSW`, `QLD`, `SA`, `WA`, `TAS`, `NT`, `ACT`
- **Category codes**: Uppercase short codes — `TWOL` (Two Weekly), `BOTJ` (Book of Judgement), `TLT`
- **Campaign source**: `MAN` (manually created), `CFP` (copied from past), `RUL` (generated from rule)
- **Admin roles**: `AD` = full admin, `SR` = state reporter (can see one state only), `null` = team leader

---

## 6. Authentication & Session Flow

The app has **two sign-in paths**, both ending in a Supabase session plus an `app_session` cookie:

1. **Mobile + first name (anonymous auth)** — the original path. Users never set a password; they prove identity by matching mobile number + first name against `state_leaders`. Now available to **plain team leaders only**.
2. **Email + magic link + authenticator-app code (real Supabase Auth, MFA)** — required for **admins (AD and SR)** since 2026-10-12, optional for plain leaders (needed only to view members' personal details). See §6.4–§6.12.

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
                    │  2. POST /api/auth/grant-session-    │
                    │     access (server re-verifies and  │
                    │     writes user_profiles/user_roles)│
                    │  3. Update last_sign_in_at          │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  Redirect to /app             │
                    │  UserContext loads via        │
                    │  getAuthenticatedUser()       │
                    └──────────────────────────────┘
```

> The diagram above is the **plain-leader** path. For an AD/SR match, `getAdminLoginGate()` (`lib/adminLoginGate.ts`) stops the flow: an enrolled admin is pointed at `/login/mfa`; an unenrolled one is walked through email confirmation and 2FA setup with no "Skip".

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
| `lib/auth.ts` (also) | `completeLeaderAuthSignIn()` (email+2FA path), `signOutClearingAccess()`, `getVerifiedSession()` |
| `lib/services/leaderVerificationService.ts` | `findVerifiedStateLeaders(mobile, firstName)` — the one mobile+name matcher shared by every auth route |
| `lib/adminLoginGate.ts` | `getAdminLoginGate()` — what the mobile+name form must do for an admin / 2FA-required leader |
| `lib/supabaseLock.ts` | `createNonBlockingAuthLock()` — stops a stuck browser tab freezing every other tab |

### 6.4 Server-Side Session Grant (why browsers can't write profiles)

**The problem it solves.** `public.is_admin()` (used by RLS) decides admin access from the caller's `user_profiles` row — name + state matched against an `AD` row in `state_leaders`. It does **not** read `user_roles` (nothing does). Originally any signed-in session — including a bare anonymous one (anyone holding the public anon key) — could write its own `user_profiles` row, so admin access was effectively self-assertable; the login screen was the only gate.

**The fix (2026-10-11).** Browsers no longer write `user_profiles`/`user_roles`:

1. `completeSignIn()` (mobile+name) and `completeLeaderAuthSignIn()` (email+2FA) in `lib/auth.ts` call `POST /api/auth/grant-session-access`.
2. The route calls `sessionAccessService.grantSessionAccess(client, { userId, aal, request })` with `supabaseAdmin`, which re-verifies on the server:
   - `method: 'mobile-name'` — the typed mobile + first name match the chosen `leaderId` (via `findVerifiedStateLeaders`);
   - `method: 'real-auth'` — the session's user is that row's bound `user_id` **and** the JWT's `aal` claim is `aal2` (`getAalFromJwt()`).
3. Only then are `user_profiles` and `user_roles` written with the service role. A refused grant signs the half-created anonymous session back out and the login screen shows an error.
4. A `mobile-name` grant for any AD/SR row is refused with `403 { code: 'mfa_required' }` (§6.7).
5. A non-admin pick on a later email+2FA login explicitly `DELETE`s any previous `user_roles.role = 'admin'` row, because the real `user_id` persists across logins (unlike a fresh anonymous user each time).

**Sign-out.** `signOutClearingAccess()` (`lib/auth.ts`) calls `POST /api/auth/revoke-session-access` (`revokeSessionAccess`, Bearer token → can only clear *its own* session's rows) before `supabase.auth.signOut()`. It is used by the Sign Out button, by `completeSignIn()` when a new login replaces an existing session, and by the MFA-challenge Cancel on `/login/mfa/callback`. Best-effort: a failed delete never blocks sign-out. A session that is simply abandoned keeps its rows until that device's next login.

**Rules for developers.** Never add a browser-side write to `user_profiles` or `user_roles`. The dead first-login onboarding code and the helpers `upsertUserProfile`/`updateUserProfile` were deleted for this reason.

**Database lock-down.** `scripts/lock_down_user_profiles_and_roles.sql` revokes `INSERT`/`UPDATE` on `user_profiles` from `authenticated`/`anon` and drops the open `user_roles` policies. *Deploy order:* ship the code first, wait ≥ 1 day for cached app copies to refresh, **then** run the SQL (running it first breaks sign-in). Applied to production 2026-10-13 and verified from a throwaway anonymous session. `scripts/enable_rls_all_tables.sql` carries a warning not to re-run its `user_roles` section.

### 6.5 Leader Email Capture & 2FA Enrolment

State leaders can attach an email address and (optionally, or compulsorily for admins) set up an authenticator-app (TOTP) second factor. This is a staged rollout toward real Supabase Auth for every leader.

**Columns on `state_leaders`:** `email`, `pending_email`, `user_id`, `email_confirmed_at`, `mfa_enrolled_at`. `email` has **no** unique constraint (dropped in `scripts/drop_state_leaders_email_unique_index.sql`) because one real person commonly has several rows (an AD row, an SR row and a plain row, across or within states) that must share one address. Because of that, every confirmation is scoped to a specific `leaderId` + matching `pending_email`, never to the email string alone — otherwise two leaders proposing the same address would silently attach one identity to the other's row.

**The steps**

| Step | Page / route | Detail |
|---|---|---|
| Suggest an email | `/login` → `registrantEmailSuggestionService.getSuggestedEmailByMobile()` | Pre-fill from `pending_email` or a `registry.registrants` phone match. A suggestion only — never written to `state_leaders` directly (no reliable identity key; see `lib/registryPipeline/leaderMatch.ts`) |
| Propose email | `POST /api/auth/propose-email` | Re-verifies mobile+name server-side (a bare leader id is never trusted), writes `pending_email`, sends a Supabase magic link whose redirect carries `?leaderId=` |
| Confirm email | `/confirm-email` → `POST /api/auth/confirm-email` | Page uses the isolated client; route trusts only `supabaseAdmin.auth.getUser(token)` for the confirmed address and commits for that one leader row. Logged to `state_leader_email_changes` |
| Request 2FA setup | `POST /api/auth/request-mfa-setup` `{leaderId, mobile, firstName}` | Re-verifies mobile+name, confirms *that row* has a confirmed email, sends a plain magic link to `/setup-mfa`. Uses `shouldCreateUser: true` (verified mobile+name+leaderId plus the row's own email is sufficient authority; an admin-typed email may have no auth account yet) |
| Enrol TOTP | `/setup-mfa`, or straight from `/confirm-email` | `components/auth/MfaEnrollmentFlow.tsx` (below) |
| Finish | `POST /api/auth/complete-mfa-setup` → `mfaEnrollmentService.completeMfaEnrollment()` | Bearer token only, and only if `supabaseAdmin.auth.getUser(token).user.factors` shows a verified factor (a token alone isn't proof the code was verified). Binds `user_id` (+ `email_confirmed_at`) on every still-**unbound** row whose `email` matches the proven address (LIKE wildcards escaped; never touches a row bound to another account), then stamps `mfa_enrolled_at` on all rows bound to the account |

Admins can also set a leader's `email` directly on `/admin/state-leaders` with no click-verification (a stronger trust bar than self-serve). **If an admin changes or removes an email**, `updateStateLeader()` also nulls `email_confirmed_at`, `user_id` and `mfa_enrolled_at` for that row — otherwise the row would stay bound to the old address's account and its owner could still sign in as that leader. (Skipped if the pre-fetch failed; other rows sharing the old account keep theirs.)

**Isolated client.** `/confirm-email` and `/setup-mfa` use `lib/emailConfirmSupabaseClient.ts` — a second Supabase client with its own localStorage key, so detecting/signing out of this proof-of-identity session never collides with the leader's real app session. It is signed out on failure immediately; on success when the leader skips, finishes, cancels, or leaves the choice screen idle for `MFA_ABANDON_AFTER_MS` (15 min — once 5, which timed out leaders who left the page to add the key). This matters because `state_leaders` RLS grants *any* authenticated session read access to every leader's row.

**`MfaEnrollmentFlow`** (shared by `/setup-mfa` and `/confirm-email`):
- AAL2 step-up first if the account already has a verified factor (Supabase refuses to enrol another factor below AAL2, regardless of `friendlyName`). The shared Supabase user pool means a leader may already have a `/registry` TOTP factor. Cancelling shows a "2FA **was not set up**" screen.
- A successful step-up goes straight to completion — the existing verified factor already satisfies MFA, and a second QR code would only confuse.
- Stale unverified factors are cleaned up (scoped by `factor_type`) before a fresh `enroll()`; `enroll()` passes `friendlyName` "AFJ Campaign App (Authenticator)" to avoid a name collision.
- The QR is rendered client-side from `data.totp.uri`. Two boxed options: **Way 1 — on your phone** (an "Add to my authenticator app" `otpauth://` link, phone only) and **Way 2 — on a computer: scan the square code**; plus a **Copy key** button and "pick *Time based*" guidance for manual entry. A collapsed "I don't have an authenticator app yet" lists the store links in `lib/authenticatorApps.ts`.
- The unfinished factor survives a page reload: `lib/pendingTotpEnrollment.ts` stores `{factorId, uri, secret}` for 15 minutes and reuses it **only if** `listFactors()` still shows it as an unverified TOTP on the signed-in account. (Previously a reload — which iPhones do when you switch to copy the key — created a *new* secret and every typed code failed.)
- A rejected code is explained by `lib/mfaErrors.ts`'s `describeMfaVerifyError()` (stale "AFJ Campaign App" entry in the phone app, phone clock not automatic, code changed while typing; also expired-challenge, rate-limit, missing-factor).

SMS/phone MFA was built then removed before it was ever enabled (Peter chose authenticator-app only). `lib/clickSendClient.ts`'s unrelated "text the leader" SMS is untouched.

### 6.6 Email + 2FA Sign-In (`/login/mfa`)

A leader with a confirmed `email` and `mfa_enrolled_at` signs in with email + magic link + TOTP code instead of mobile+name. It is a *hybrid* rollout: everyone else keeps mobile+name unchanged.

1. `/login/mfa` — email entry; sends the magic link (`emailRedirectTo` = `/login/mfa/callback?via=email`).
2. `/login/mfa/callback` — uses the **main** `lib/supabaseClient.ts` client (not an isolated one) because this session is *meant* to become the leader's persistent identity. Resolves every `state_leaders` row sharing the signed-in `user_id`, runs the AAL2 TOTP challenge (shared `CodeEntryScreen`), shows a **role picker** when there are several rows (labels from `lib/leaderRoleLabel.ts`'s `getLeaderRoleLabel()`: `AD` → "Admin", `SR` → "State Reporter — VIC", plain → "Leader — VIC"), then `completeLeaderAuthSignIn()`.
3. The `app_session` cookie gets a 30-day expiry (the underlying refresh token supports it), unlike mobile+name's session cookie.

Notable behaviours:
- **Switch Role** — `MobileLayout` shows a button (only when `session.user.is_anonymous === false`) that returns to `/login/mfa/callback`; its existing `getSession()` branch re-shows the picker with no new link or TOTP prompt, since AAL2 already holds.
- **Returning-device redirect** — `lib/emailLoginPreference.ts` stores `PREFERS_EMAIL_MFA_LOGIN_KEY` in `localStorage` (never cleared on sign-out). Two strengths: `'always'` for an admin (AD/SR — they can't use mobile+name) and `'when-required'` for anyone else (only redirected when they arrive via `/login?require2fa=1`). `rememberEmailLogin(admin)` never downgrades an `'always'` device; the legacy value `'1'` reads as `'when-required'`. It is per *browser*, not per person, so a browser ever used for an admin sign-in stays `'always'` for everyone. The way out is `/login?mode=mobile` (bypasses the redirect once, preference untouched — without it the "back to mobile+name" link would loop). The "Not set up yet" screen (shown e.g. after a 2FA reset) links there.
- **RLS deliberately unchanged** — policies still key off `user_profiles`; the new flow just writes those rows for a real, persistent identity (§6.4). A later phase may key RLS directly off `state_leaders.user_id`. Not changed by this: `lib/campaignFilter.ts`, `authService.ts`, `UserContext.tsx`, `middleware.ts` (`/login/mfa*` already sits outside every protected prefix).

### 6.7 Mandatory 2FA for Admins (AD and SR)

Since 2026-10-12 (no deadline, state reporters included): **admins cannot get an app session from mobile+name.**

- `grantSessionAccess` refuses a `mobile-name` grant for any row where `isRecognizedAdminStatus(admin)` (403 `mfa_required`). Only `real-auth` at `aal2` can yield an AD/SR identity. This is real enforcement — identity rows are server-written (§6.4) — not just a login-screen rule.
- `lib/adminLoginGate.ts`'s `getAdminLoginGate(match, { requireTwoFactor })` decides what `/login` shows for a matched leader: `'sign-in-with-email'` (enrolled AD/SR → "Sign in with your email", pointing at `/login/mfa`), `'set-up-2fa'` (unenrolled AD/SR, or a plain leader with `?require2fa=1`) or `null` (plain leader signs in as before). The unenrolled flow reuses the email-confirm and MFA-setup steps with **no "Skip for now"** (`emailStepMandatory`/`mfaStepMandatory` in `app/login/page.tsx`); since no session exists on this path, an "I've confirmed my email — continue" button re-validates against the server (`handleAdminProgressCheck`), ending at a "Sign in with email" button.
- **Existing sessions** weren't signed out by switching this on. `scripts/revoke_admin_app_sessions.ts` (dry run by default, `--apply`) deletes the `user_profiles`/`user_roles` rows of — and reversibly bans — every *anonymous* account carrying an AD/SR identity (1,458 on 2026-10-12). Real-auth accounts are never touched; nothing is deleted from `auth`.
- **Reset 2FA.** `/admin/state-leaders` shows "Reset 2FA" on any row with `mfa_enrolled_at` → `POST /api/admin/reset-mfa` → `mfaResetService.resetLeaderMfa(client, { leaderId, actorUserId, actorLabel })`: deletes every Supabase MFA factor on the leader's auth account, nulls `mfa_enrolled_at` on all rows bound to it, deletes its `user_profiles`/`user_roles` (so any live session loses access immediately), and best-effort logs to `state_leader_mfa_resets` (`scripts/create_state_leader_mfa_resets_table.sql`). The caller must be an AD at aal2 (`verifyAdminCaller`); an admin cannot reset their own 2FA; a leader with no `user_id` has nothing to reset.

### 6.8 2FA to See Members' Personal Details (plain leaders)

All leaders can see names/mobiles/emails of people who register interest in their campaigns, and insurance requirements drive 2FA — but forcing every leader to set it up at every sign-in was the wrong lever (most have no registrations to protect). So:

1. **The database enforces it.** `scripts/require_mfa_for_member_details.sql` (mirrored in `supabase/rls-policies.sql`) adds `(auth.jwt() ->> 'aal') = 'aal2'` to the SELECT/UPDATE policies on `campaign_interest` and `training_interest`. A mobile+name (anonymous, aal1) session simply cannot read those rows. Applied live 2026-10-15; deploy order was code first, SQL second (SQL first makes counts read zero for everyone not at aal2). Rollback: re-run the pre-change policy blocks.
2. The pages showing them (`/campaign-interest`, `/training-interest/[campaignId]`) are wrapped in `components/auth/RequireTwoFactorForMemberDetails.tsx`, which checks the session AAL and otherwise explains why and calls `lib/twoFactorSetup.ts`'s `startTwoFactorSignIn()` (sign out → `/login?require2fa=1`).
3. `/login?require2fa=1` gates a plain leader exactly like an admin (no mobile+name session; no-skip email + 2FA; an enrolled leader is pointed at `/login/mfa`). At a normal sign-in plain leaders get **no** email/2FA prompt. My Admin (`/app/tl-admin`) has an optional "Extra Security" card using the same entry point.
4. Leaders still see *how many* people registered via `POST /api/leader/interest-counts` (`interestCountsService.getVisibleInterestCounts(userClient, adminClient, campaignIds)`: numbers only, service role, restricted to campaigns the caller's own JWT can read from `campaigns`). Browser wrapper: `interestCountsClient.fetchInterestCounts`, used by `campaignInterestService.getCampaignInterestCounts`/`hasCampaignInterestForLeader` and `trainingInterestService.getTrainingInterestCounts`.

Only the *viewing leader's* session level matters; members/registrants are never Supabase users. Admins are unaffected (already mandatory).

### 6.9 Magic-Link Robustness

**Problem.** Supabase's `{{ .ConfirmationURL }}` is a `/verify` URL consumed by *any* GET. Apple Mail Privacy Protection and Outlook/Microsoft link checkers pre-fetch links, so the one-time token is spent before the leader taps it. 38 of 173 leaders were authenticating at Supabase on every attempt while the app-side confirmation never ran (zero requests reached `/api/auth/confirm-email`). They landed on an "expired link" screen whose "back to sign in" link dropped an already-signed-in leader into the app with no sign anything failed.

**Layer 1 — scanner-proof links.** The Magic Link template links to *our* page with the token in the query string: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">CONFIRM NOW</a>`. The page calls `verifyOtp({ token_hash, type: 'email' })` only when the person **taps a button** (`components/auth/TapToContinue.tsx`; helpers `lib/magicLinkToken.ts`'s `readTokenHashFromUrl()`/`stripTokenHashFromUrl()`; the token is stripped from the address bar on tap). A scanner never taps. Supported by `/confirm-email`, `/setup-mfa`, `/login/mfa/callback` **and** `/registry/auth/callback` (all share the one template — changing it without updating the registry page would break registry sign-in). `{{ .RedirectTo }}` is each sender's `emailRedirectTo`, so **every one must already contain a `?`**: `propose-email` has `?leaderId=`; `request-mfa-setup`, `/login/mfa` and `/registry/login` carry `?via=email`. Old hash-token links keep working. The 8-second "give up" clock starts after the tap; a tap on an already-used token falls back to the email + code form. A copy of the (large-text) template is in `docs/email-templates/magic-link.html` (+ README) — **the Supabase dashboard is what is live**. `lib/auth.ts`'s `sendMagicLink` (→ the dead `/auth/callback`) is unused.

*Template switch order:* deploy the code, wait ≈1 day for cached app copies to pick up the `?via=email` URLs, edit the template, then test one email of each kind (confirm email, 2FA setup, `/login/mfa`, `/registry/login`).

**Supabase URL Configuration.** If a sender's `emailRedirectTo` isn't on the **Redirect URLs allow-list**, `{{ .RedirectTo }}` silently becomes the **Site URL** and the link breaks (a leader's link read `http://afj-campaign-app.vercel.app&token_hash=…` — her host wasn't allow-listed and the Site URL was `http://`). Every host leaders use (`https://afj-campaign-app.vercel.app`, `https://campaign.afj.org.au`) must be listed as `https://<host>/**` and the Site URL must be `https`. With the old template the same misconfiguration sent people to the Site URL's root with tokens in the `#hash`, where the root page signed them straight into the app — a plausible cause of "straight into the app instead of the QR code" reports.

**Layer 2 — typed-code fallback.** Supabase already generates a code per `signInWithOtp()`; the template must include `{{ .Token }}`.
- `components/auth/InlineCodeFallback.tsx` — collapsed "If the link is not working, **Click Here** to enter the code" on the three "check your inbox" screens (`/login`'s `emailStep`/`mfaStep` phase `'sent'`, and `/login/mfa`'s `sent` state). Calls `verifyOtp({ email, token, type: 'email' })` on the client that page's landing page expects (isolated for email-capture and MFA-setup; main for sign-in), then either calls `/api/auth/confirm-email` directly or `router.push()`s to the landing page, whose existing `getSession()` race-cover picks up the session.
- `components/auth/EmailAndCodeFallback.tsx` — shown directly (not collapsed) on the "That link has already been used" screens of `/confirm-email`, `/setup-mfa`, `/login/mfa/callback`, leading with the email + code form and demoting "Back to sign in" to a link. It asks for the email too, since those pages only ever had the link. Mechanically the page's `onAuthStateChange` listener stays subscribed for the component's lifetime and the failed attempt never set `handledRef`, so the handler only needs `verifyOtp()`; success fires the same `SIGNED_IN` the link would have.
- `lib/otpInput.ts` — `normalizeOtpInput()` strips non-digits and caps length on every change (no `maxLength`: a paste with a leading space/label was being truncated *before* cleaning). Emailed codes may be 6–10 digits (Supabase "Email OTP Length"; `EMAIL_OTP_MIN_LENGTH`/`EMAIL_OTP_MAX_LENGTH`); `CodeEntryScreen` stays at 6 (TOTP always is). Code expiry is a dashboard setting (default 1 hour).
- The prominent "Continue" button on the "check your inbox" screens was renamed **"Skip for now"** and restyled as a subdued link — it called the same handler as the earlier "Skip for now" and leaders read it as "proceed", never opening their inbox. Copy tells them to open the email and click the **CONFIRM NOW** link (the label must match the template's link text; update both together).

**Layer 3 — resilience.**
- `components/auth/SigningInStuck.tsx` (`useStuckWatchdog`, `SigningInStuck`, `STUCK_AFTER_MS` = 20 s) — a "This is taking too long — Start again" screen on all three landing pages. Each also has an `awaitingTapRef` guard so an older session already on the device can't claim the sign-in before the tap (which previously froze "Signing you in…").
- `lib/pendingLoginStep.ts` — remembers the "check your inbox" screen in `localStorage` (leader row + email only, 30-minute expiry) so an iPhone reload while the leader fetches the code from Mail doesn't bounce them to `/app`. Cleared when they move past it, start a new sign-in, or reach `/setup-mfa`.
- `lib/auth.ts` `getVerifiedSession()` — `/login` verifies with the server (`getUser()`), not just the device's copy; a rejected session (e.g. a banned anonymous Peter_AD one) is cleared locally and the cookie removed instead of looping `/login` ⇄ `/app`. A network failure shows the form without clearing anything.
- `lib/supabaseLock.ts` — supabase-js's default auth lock is a Navigator lock shared by every tab, with **no time limit**; a tab the phone froze in the background while holding it blocked every other tab's `getSession()`/queries. All three browser clients (`supabaseClient.ts`, `emailConfirmSupabaseClient.ts`, `registrySupabaseClient.ts`) pass `lock: createNonBlockingAuthLock()`: same lock, but an unlimited wait becomes `AUTH_LOCK_WAIT_MS` (5 s) and is then taken over (`steal`); "only if free" calls are unchanged and errors from the locked work never re-run it.

### 6.10 Setup Help for Non-Technical Leaders

Many leaders are elderly or not computer-literate (funnel on 2026-10-13: of ~138 people ~31 had confirmed an email and ~12 enrolled 2FA; 32 of 66 sign-in emails were never used). Help is on-screen rather than extra screens:
- `components/auth/SetupStep.tsx` — "Step 1 of 3: Confirm your email / 2: authenticator / 3: sign in".
- `components/auth/GetHelp.tsx` — "Stuck? Open the step-by-step guide" plus the bold line to ask on the **AFJ TWOL Leaders WhatsApp group** (replaced a pre-filled `sms:` link that did nothing on a PC and sent every problem to one phone).
- `/help/2fa` — public, printable, plain-language guide whose words match the screens exactly; links the four free authenticator apps (`lib/authenticatorApps.ts`); shows the support number when `NEXT_PUBLIC_SUPPORT_MOBILE` is set (`lib/supportContact.ts`'s `toSupportNumber()`, `HELP_GUIDE_PATH`).
- Unmistakable code labels — "6-digit code from your authenticator app (**not from the email**)" vs "Code from the email (the long number under CONFIRM NOW)".
- **`/admin/stuck-leaders`** — `GET /api/admin/stuck-leaders` → `stuckLeadersService`. Per *person* (rows grouped by normalised mobile — one person can have nine rows) it shows the step they're stuck on, last activity, a suggested next step, and **Call** / **Text a reminder** links (text pre-filled, links to `/help/2fa`). `classifyStuckLeaders(rows, authByEmail)` is pure; `getStuckLeaders(client)` loads `state_leaders` plus each address's auth account (latest email sent = newest of `recovery_sent_at`/`confirmation_sent_at`; latest use = `last_sign_in_at`). A link used *before* the newest email was sent counts as unused; an email sent before the address was confirmed is the confirmation email, not the 2FA one. Stages: not started · entered an email but none sent · confirmation sent, link unused · opened the link but didn't finish · email confirmed, 2FA not started · 2FA email sent, link unused · opened 2FA setup but didn't finish. Admins are listed at every stage until enrolled; plain leaders only if they started and didn't finish. Enrolled anyone is omitted.

### 6.11 Large-Text Rules for Setup Screens

For older leaders with reading difficulties, the constants in `components/auth/CodeEntryScreen.tsx` define body 20 px (`text-xl`, darker grey), headings 30 px (`headingClass`), buttons 20 px, typed boxes 24 px, labels/links/errors 18 px, card `max-w-xl`, secondary links underlined. Every setup screen uses those constants (`/login`'s email-confirm / 2FA / admin steps, `/confirm-email`, `/setup-mfa`, `/login/mfa`, `/login/mfa/callback`, `MfaEnrollmentFlow`, `TapToContinue`, `GetHelp`, `SetupStep`, `RequireTwoFactorForMemberDetails`), so one edit changes all. `components/auth/__tests__/setupScreenText.test.ts` fails if a constant shrinks. Don't wrap these screens in the app-wide `large-text` class (§20) — they'd scale twice. `components/auth/CodeEntryScreen.tsx` is also shared by `/setup-mfa` and the callback's TOTP step so both code screens stay identical.

### 6.12 Troubleshooting Sign-In Reports

| Symptom | Likely cause / where to look |
|---|---|
| "Link already used" right after clicking | A mail client/scanner opened it first. Use the emailed code; confirm the scanner-proof template is live (§6.9). Supabase Dashboard → Logs → Auth shows the caller of a `login` event |
| Authenticator code rejected | Old "AFJ Campaign App" entry in the phone app, clock not automatic, code changed while typing (`describeMfaVerifyError`). Exact failure is in Dashboard → Logs → Auth (`/factors/<id>/verify`) |
| Taken "straight into the app" instead of QR screen | Pressed Cancel (then "Back to sign in" lands in the still-signed-in main session); link never opened; or a non-allow-listed redirect host (§6.9) |
| Stuck on "Loading…" / "Checking sign-in status…" | Stuck tab holding the auth lock (fixed by `supabaseLock.ts`) or a server-rejected session (fixed by `getVerifiedSession()`) |
| Admin can't sign in with mobile+name | Intended — mandatory 2FA (§6.7). Unenrolled admins complete the no-skip steps; "Reset 2FA" is for a lost authenticator |
| Sent to email sign-in on every sign-out | The browser has the `'always'` marker from an admin use; use `/login?mode=mobile` |
| Supabase admin API shows no MFA factors | It never returns factors at all (`listUsers`/`getUserById`) — "no factor" proves nothing; rely on `user.factors` from `getUser(token)` |

Known gaps: a leader already MFA-enrolled who re-confirms a changed email is still offered setup (they just step up with their existing factor); two different leaders sharing one admin-entered email both bind to the one account; notifying a leader's *old* email on change is deferred (no transactional-email capability outside Supabase's template, and `email`/`user_id` aren't privileged credentials until RLS is rewritten).

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

> **Admin identity is server-written.** `user_profiles`/`user_roles` are only ever written by `grantSessionAccess()` (§6.4); an AD/SR identity can only come from an email + 2FA (`aal2`) sign-in.

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
- **Never** write `=== 'AD' || === 'SR'` inline — use `isRecognizedAdminStatus()` from `lib/campaignFilter.ts`

### 7.5 Admin API Routes and 2FA-Gated Data

- **Shared gate.** Every admin-only route under `app/api/admin/*` calls `verifyAdminCaller(client, token)` (`lib/services/adminCallerService.ts`): Bearer token → `{ userId, label }` only for a full admin (AD) whose JWT is `aal2`, using an **exact normalised** name match (never `ILIKE`, where `_` is a wildcard). Older routes (`settings`, `geocode-address`, `geocode-place`, `campaign-reports/derived-fields`, `invalidate-user-session`) used to copy-paste their own check — an `ILIKE` match with no 2FA requirement — and now all use it; `invalidate-user-session` also matches the target leader's profiles exactly. `app/api/admin/__tests__/adminRoutesRequireAdmin.test.ts` pins this. **New admin-only routes must use `verifyAdminCaller`.**
- **Role/status checks** on `state_leaders.admin` go through `isRecognizedAdminStatus()` in `lib/campaignFilter.ts`, never inline (a truthy check in one call site once silently misrouted leaders with junk data in that column — the "#78 login role bug").
- **Reset 2FA** — §6.7. AD at aal2 only; cannot reset yourself.
- **Members' personal details** — §6.8: `campaign_interest`/`training_interest` need aal2 at the database; the pages are wrapped in `RequireTwoFactorForMemberDetails`; leaders get numbers via `/api/leader/interest-counts`.
- **Registry** — `/api/registry/*` routes independently re-check `isNationalRegistryAdmin()` server-side (§17.3).
- **Practical consequence:** an admin has only their *plain* rows' access until they enrol 2FA, since an AD/SR identity can only come from an email + 2FA sign-in.

---

## 8. Page Map — Every Route Explained

### 8.1 Route Overview

```
/                                     Auth guard — redirects to /app or /login
/login                                Sign in with mobile + name (plain leaders); email/2FA steps for admins
/login/mfa                            Email sign-in (real auth + 2FA)
/login/mfa/callback                   Magic-link landing: TOTP challenge, role picker
/confirm-email                        Leader email-confirmation landing page
/setup-mfa                            Authenticator-app enrolment landing page
/help/2fa                             Public printable 2FA setup guide
/app                                  Main campaign feed (home screen)
/app/sr-admin                         State Reporter dashboard
/app/tl-admin                         "My Admin" for plain team leaders (campaign rules, check registration, extra security)
/app/guide                            OPEN GUIDE — CAS User Guide PDF, full screen
/app/check-registration               Leader check: is this person registered? (no registry data shown)
/campaign-interest                    People who registered interest in my campaigns (2FA required)
/training-interest                    My BOTJ/TLT sessions and their interest counts
/training-interest/[campaignId]       Who registered interest in one training session (2FA required)
/record-results                       Select a campaign to record results for
/record-results/detail                Enter result names + counts
/results                              View result summaries (signed-in JPEG slide viewer)
/capture                              Geolocation-based campaign capture
/view-slides                          Public, no-login JPEG slide viewer

/public/week1-campaigns               Public, no-login "Week 1 Campaigns" link (shareable)
/public/temporary-upcoming-campaigns  Public, no-login temporary-upcoming-campaigns link
/public/upcoming-campaigns            Public, no-login map of upcoming campaigns, all states (replaces the former /admin/campaign-map)
/public/final-campaign-lists          Public read-only fortnight list (download only)
/public/campaign-results              Public campaign results for the last-refreshed week
/public/register-interest             Public: tick campaigns, "Yes I'm In" / "Tell Me More"
/public/campaigns-near-me             Public: personalised map for a registry registrant (?r=<id>)
/public/training/[campaignId]         Public: one training session + interest form
/registry/*                           Registry portal (own auth + MFA) — see §17
/auth/callback                        Supabase OAuth code-exchange handler, not user-facing

/admin                                Admin hub (full admin only)
/admin/campaign-rules                 Manage recurring scheduling rules
/admin/state-leaders                  Manage the state_leaders master list
/admin/state-places                   Manage valid place/suburb names per state
/admin/state-places-map               Map of every valid place, by state
/admin/campaign-categories            Manage campaign type codes (TWOL, BOTJ, TLT, …)
/admin/campaign-messages              Manage date-specific banner messages
/admin/campaign-logs                  View campaign change audit log
/admin/campaigns-near-me              Upcoming campaigns near the admin's current location
/admin/register-interest              Tick upcoming campaigns, RSVP ("Yes I'm In" / "Tell Me More")
/admin/member-activity                Active member counts, by total/state/place/campaign
/admin/leader-shares                  Manage campaign sharing between leaders
/admin/public-links                   Edit title/description shown on /public/* link previews
/admin/generate-slides                Generate downloadable presentation slides (JPEG ZIP)
/admin/generate-report                Generate downloadable campaign reports
/admin/metrics                        Admin analytics dashboard (usage, active users, row counts)
/admin/results-metrics                Names recorded per category (TM/P/F/SP), by state/place/campaign
/admin/check-registration            Registry lookup by mobile/email (AD + 2FA)
/admin/stuck-leaders                  Leaders stuck on email sign-in / 2FA setup
/admin/registered-interest            Everyone who registered interest, with Contacted checkbox
/admin/generate-week-campaigns        "Single Week Campaigns" JPEG for a chosen date range/state
/admin/campaign-reports-cleanup       Fill missing State/Place/Leader on campaign_reports rows
/admin/backup                         Export/restore JSON backup of every admin-curated table
```

> There is no `/debug` route in the current codebase — if you find a reference to one elsewhere, it's stale.

### 8.2 Main App Page (`/app`) — Most Important Page

**File**: `app/app/page.tsx`

This page is the core of the application. Here is what each part does:

```
┌─────────────────────────────────────────────────────┐
│  AdminQuickActions (admin only)                      │
│  — Button: Check if a Person is Registered           │
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
| `CampaignForm` | `components/CampaignForm.tsx` | Reusable add/edit form; `CampaignData` includes a `category` field |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Root layout |
| `CampaignMap` / `NearbyCampaignsMap` | `components/` | Public & admin maps (§18.1); `renderActions` prop swaps popup actions |
| `PublicMapRegisterInterestActions`, `PublicCampaignInterestActions` | `components/` | Popup actions for the two public maps (consent modal, then POST) |
| `registerInterest/*` | `components/registerInterest/` | Register Interest screen for `/public/…` and `/admin/register-interest` |
| `CampaignInterestEntryList` | `components/` | Registration rows for `/admin/registered-interest` and `/campaign-interest` |
| `GuideScreen`, `PdfGuideViewer`, `OpenGuideLabel` | `components/` | CAS User Guide (§18.4) |
| `BackToAppBar` | `components/` | "← Back to app" bar on public pages opened with `?from=app` |
| `auth/*` | `components/auth/` | Sign-in and 2FA setup blocks: `CodeEntryScreen` (+ large-text constants), `MfaEnrollmentFlow`, `TapToContinue`, `InlineCodeFallback`, `EmailAndCodeFallback`, `SigningInStuck`, `SetupStep`, `GetHelp`, `RequireTwoFactorForMemberDetails`, `BusyChoiceButtons` (§6) |

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

#### Auth and security services (added Sept–Oct 2026)

All take an **injected Supabase client** (always `supabaseAdmin` in practice) so they test with `supabaseMock.ts`. They back API routes under `app/api/auth|admin|leader`, never the browser client.

| Module | Function | Description |
|--------|----------|-------------|
| `sessionAccessService.ts` | `grantSessionAccess(client, { userId, aal, request })` | Server-side verification + `user_profiles`/`user_roles` writes for a sign-in (§6.4). Refuses mobile+name for AD/SR |
| | `revokeSessionAccess(client, userId)` | Deletes that session's identity rows on sign-out |
| | `getAalFromJwt(token)` | Reads the `aal` claim |
| `adminCallerService.ts` | `verifyAdminCaller(client, token)` | AD at aal2 → `{ userId, label }`; the one admin-route gate |
| `leaderVerificationService.ts` | `findVerifiedStateLeaders(mobile, firstName)` | The single mobile+name matcher shared by `validate-leader`, `propose-email`, `request-mfa-setup` (extracted so those can't drift) |
| `mfaEnrollmentService.ts` | `completeMfaEnrollment(client, { userId, email })`, `escapeLikePattern()` | Bind `user_id`, stamp `mfa_enrolled_at` (§6.5) |
| `mfaResetService.ts` | `resetLeaderMfa(client, { leaderId, actorUserId, actorLabel })` | Admin Reset 2FA (§6.7). Client wrapper: `mfaResetClient.requestMfaReset()` |
| `stuckLeadersService.ts` | `classifyStuckLeaders(rows, authByEmail)` (pure), `getStuckLeaders(client)` | Stuck-leaders list (§6.10). Client: `fetchStuckLeaders()` |
| `registrationCheckService.ts` | `parseRegistrationCheckInput`, `checkRegistration`, `normalizeNameForMatch`, `isSessionForStateLeader`, `parseContactLookupInput`, `lookupRegistrationByContact` | §18.3. Clients: `requestRegistrationCheck`, `requestAdminRegistrationLookup` |
| `registrantEmailSuggestionService.ts` | `getSuggestedEmailByMobile(mobile)` | Best-effort registry phone match; `null` on no match or any error, never throws |
| `interestCountsService.ts` | `getVisibleInterestCounts(userClient, adminClient, campaignIds)` | Numbers only (§6.8). Client: `fetchInterestCounts` |
| `userGuideService.ts` | `getUserGuideView(client)`, `createUserGuideUploadTarget(client)` | Private bucket `user-guide` (§18.4). Client: `uploadUserGuide` |
| `stateLeadersService.ts` (also) | `updateStateLeader` | Logs email changes to `state_leader_email_changes` (best-effort) and resets confirmation/`user_id`/`mfa_enrolled_at` when the email changes (§6.5) |

#### Interest, public pages and reports

| Module | Purpose |
|--------|---------|
| `campaignInterestService.ts`, `trainingInterestService.ts` | Leader/admin views of registered interest; `TRAINING_CATEGORIES` / `isTrainingCategory()` |
| `campaignInterestSmsService.ts` | One combined ClickSend text per owning leader; logs to `campaign_interest_sms_log`; never throws |
| `publicCampaignListService.ts`, `publicCampaignResultsService.ts`, `publicCampaignsNearMeService.ts`, `publicUpcomingCampaignsService.ts` | Data/grouping logic behind the `/public/*` pages (cached coordinates only, no on-demand geocoding) |
| `campaignReportsService.ts` | Campaign Report cleanup |
| `backupService.ts` | `exportBackup`/`restoreBackup`; see §5.1a |
| `placeService.ts` (also) | `addNewPlaceForState()` best-effort geocodes the new place immediately (`lib/geocoding.ts`) |

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
| `getMapData(options)` | Campaigns in a date range (optionally by state), grouped by place, with coordinates resolved from `state_places` or on-demand geocoding — used by `getNearbyCampaigns()` below (`/admin/campaigns-near-me`) |
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
- That is only the *screen* guard. Anything the page reads through an API route must also be allowed there: admin routes call `verifyAdminCaller()`, which accepts **AD only, at aal2** — widening it to SR means changing that shared service (and its test), not copying a check into the route. Data read through RLS follows the table's policy (`is_admin()`), so check `supabase/rls-policies.sql` too.
- Use `isRecognizedAdminStatus()` rather than writing `=== 'AD' || === 'SR'` inline.

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

- File: `lib/services/leaderVerificationService.ts` → `findVerifiedStateLeaders()` — the **one** mobile+name matcher, shared by `validate-leader`, `propose-email`, `request-mfa-setup` and `grant-session-access`. Change it there, never in a single route.
- File: `lib/auth.ts` → `normalizeName()` (normalisation before comparison)
- Remember `grantSessionAccess` (§6.4) re-verifies the same pair server-side, so a loosened match changes what a sign-in is *granted*, not just what the form accepts. Admin rows are never grantable by mobile+name (§6.7).

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
| `components/__tests__/` | Tests for shared components in `components/` (e.g. `largeText.test.tsx`) |
| `components/auth/__tests__/` | Sign-in / 2FA setup components (e.g. `setupScreenText.test.ts` pins the large-text constants) |
| `app/**/__tests__/` | Page and API-route tests (e.g. `app/api/admin/__tests__/adminRoutesRequireAdmin.test.ts`; `/login`, `/setup-mfa` page tests) |

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
| `NEXT_PUBLIC_SITE_URL` | `lib/siteUrl.ts` — absolute links in emails/SMS/OG tags (falls back to Vercel's production URL, then localhost) | Production |
| `NEXT_PUBLIC_SUPPORT_MOBILE` | `lib/supportContact.ts` — support number on `/help/2fa` and the stuck-leaders Call/Text links | No |
| `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY` | `lib/clickSendClient.ts` — "text the leader" SMS; missing config makes sends fail (logged, never blocks the registrant) | For SMS |
| `VERCEL_PROJECT_PRODUCTION_URL` | Auto-injected by Vercel; `siteUrl.ts` fallback | Auto |

Supabase dashboard settings that the code depends on (not env vars): the **Magic Link email template** (`docs/email-templates/`), the **Redirect URLs allow-list** (every sign-in host as `https://<host>/**`, Site URL `https`), and **Email OTP length/expiry**.

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

`npm run dev` and `npm run build` first run `npm run tech-insights` (regenerates the gitignored Tech Insights manifest, a couple of seconds — see §20). Re-run it by hand to refresh the panel's data while `next dev` is already running.

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

## 17. Registry Pipeline — Separate Subsystem

Everything above this section describes the campaign app proper. `lib/registryPipeline/` and `supabase/functions/ac-sync/` are a deliberately separate subsystem — an ActiveCampaign → Supabase registration data pipeline for AFJ leadership, living in its own `staging`/`registry` Postgres schemas in the same Supabase project, not `public`. It does not share the campaign app's service layer, roles, or page map, and no client (browser) ever queries its tables directly.

It also uses a different toolchain: the Supabase CLI, Edge Functions (Deno), and `pg_cron`/`pg_net`, rather than this app's Next.js API routes + Vercel Cron. `supabase/functions/` is excluded from the root `tsconfig.json` for this reason (Deno-only syntax) and isn't covered by this app's four CI jobs — see `docs/registry-pipeline/OPERATIONS.md`.

Full design: `docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md`. Session scope: `docs/registry-pipeline/BRIEF.md`. Deploy/run steps: `docs/registry-pipeline/OPERATIONS.md`. Architecture summary: `CLAUDE.md`'s "Registry pipeline" section.

---

### 17.1 Data model

- **`staging.ac_events`** — append-only, untransformed landing zone for raw ActiveCampaign (AC) contact payloads (`scripts/create_registry_pipeline_schema.sql`).
- **`registry.registrants`** — one row per person, deduplicated on **email** (changed 2026-09-08; `ac_contact_id` is nullable/informational because one person can hold several AC ids; email-less rows fall back to phone matching in application code). Also carries `unsubscribed`/`nfc` (`'Yes'`/null flags), `postcode`, and four fields added 2026-09-15 that turned out *not* to be simple AC custom fields: `webinar_session_at` (AC field `[24]` BOTJ Webinar Session — *not* `[23]` Rego Date, which stays unpromoted), `webinar_attended` (`'Yes'`/`'No'`/null from AC tags `60`/`56`; `56` "Missed" is name-inferred and may be unused, so a live sync likely only yields `'Yes'`/null), `code_of_conduct_agreed` (`'Yes'`/null when tag `48` — the `/thewayoflife/` funnel tag — is present) and `code_of_conduct_agreed_at` (that tag's own `cdate`, not the contact's `registered_at`, which differs by months). Derivation: `lib/registryPipeline/tagDerivedFields.ts` (raw tag presence — *not* `sourceAttribution.matchSourceTag`, whose first-match-wins is wrong for a multi-funnel contact). Pre-reload registrants got these via the one-off `backfill_webinar_and_code_fields_from_csv.ts`.
- **`registry.registration_events`** — one row per form/list submission.
- **`registry.twol_respondents`** — one row per AC List `[2]` (`/wayoflife-responder/`) submission: someone a TWOL presenter *reported* presenting to, not a self-registration. Kept entirely separate from registrants (never counted, never sent the WhatsApp invite), append-only, no dedup.
- **`registry.known_source_tags`** — AC tag id → source label. AC List `[1]` is a catch-all for three of four funnels, so the **tag**, not the list, identifies the source.
- **`registry.sync_log`** — audit of every ingestion run (also `status`; plus `sync_progress` table for resumable runs).
- **`registry.registrant_edits`** — audit of manual corrections from `/registry/manage` Edit mode (`registrant_id`, `field`, `old_value`/`new_value`, `edited_by`/`edited_by_email`); append-only.
- **`registry.leader_roles`** — maps `auth.uid()` to a role/state scope. `national_admin`/`whatsapp_admin` are high-privilege and MFA-gated via `registry.has_required_mfa()`.
- **`registry.whatsapp_group_links`** — `group_key`/`group_level`/`invite_url`; only a single `'national'` row is used.
- **`registry.whatsapp_invite_log`** — one row per invite attempt: `status` `'sent'` / `'failed'` (+ `error`) / `'skipped_no_link'`, `resend_message_id`, `included_campaigns_near_me_link`.

No client ever queries these tables directly. Only the service role (used by the Edge Function and the `/api/registry/*` routes) can; RLS is enabled with no policies (default-deny) plus an explicit `REVOKE` from `anon`/`authenticated`, except `leader_roles`, where an authenticated leader may `SELECT` their own row. Needs `scripts/grant_registry_authenticated_schema_usage.sql` (schema `USAGE` for `authenticated`) and `grant_registry_pipeline_service_role.sql`.

### 17.2 `supabase/functions/ac-sync` and `lib/registryPipeline/`

`ac-sync` is the scheduled polling Edge Function (Deno): the same function handles first-ever backfill and every incremental sync (they differ only by the timestamp filtered from). It contains **thin adapters only** — `acClient.ts` (AC REST), `db.ts` (staging/registry via the service role), `emailClient.ts` (Resend's HTTP API) — while all logic lives in `lib/registryPipeline/` so it unit-tests under Vitest without Deno. Scheduled by `pg_cron` + `pg_net` (`scripts/schedule_ac_sync_cron.sql`) **every 4 hours** (00/04/08/12/16/20 UTC; was daily, then 6-hourly). The job keeps its original name `ac-sync-daily` for run-history continuity.

| Module | Role |
|---|---|
| `sync.ts` | `runSync` — Section 6.1 of the design |
| `transform.ts` | `transformPendingStagingEvents` — Section 6.2. Order matters: the tag-exclusion check runs **before** List `[2]` routing; List `[2]` events go to `DbPort.insertTwolRespondent()`; a status change of an existing registrant to unsubscribed calls `DbPort.markRegistrantUnsubscribedByEmail()`; then `upsertRegistrant()` and the WhatsApp-invite decision |
| `fieldMap.ts` | Whitelist-only AC field mapping — enforces the inclusion/exclusion decisions in plan Section 3.4. Never add a field id without checking that section |
| `phone.ts` | E.164 normalisation |
| `sourceAttribution.ts` | Tag-based source matching |
| `tagExclusion.ts` | `EXCLUDED_SOURCE_TAG_IDS` — `[11]`, `[40]`/`[41]` (donation forms), `[8]`/`[9]` (near-blank "Explore More"), `[6]` ("TWOL Video: Requested"). A would-be-excluded contact is excluded regardless of list |
| `listFilter.ts` | Permanent List 3/5 exclusion + list-status active check (`isActiveListStatus()` rejects any non-`'1'` status, so unsubscribed contacts never become registrants — 29% of staging events are correctly skipped) |
| `rateLimiter.ts` | 429 backoff + pacing against AC's shared 5 req/sec limit |
| `ports.ts` | `AcPort`/`DbPort`/`EmailPort` interfaces. `upsertRegistrant` returns `isNew` and the row's pre-existing `unsubscribed`; `EmailPort.sendWhatsAppInviteEmail` **always throws on failure** (including missing `RESEND_API_KEY`) and resolves with the Resend message id + whether the Near-Me link was included |
| `whatsappInvite.ts` | `shouldSendWhatsAppInvite` (genuinely new row, usable email, not already unsubscribed) / `buildWhatsAppInviteEmail` |
| `registrantNameGuard.ts` | `protectExistingRegistrantName()` — see §17.5 |
| `mfaGate.ts` | `evaluateMfaGate` routing for the portal; `isNationalRegistryAdmin()` — single source of truth for "national_admin/whatsapp_admin vs state_leader" (used by the Manage button and `/api/registry/manage-summary`) |
| `csvParse.ts`, `csvRegistrantTransform.ts` | The registrations-reload rules (`parseAuDateTime()` for the Webinar column, `parseYesNo()` for W/Done and Code) |
| `registrantCounts.ts` | Date-window + per-state tallies for `/registry/manage` (`countAllRegistrants`, `countRegistrantsForPeriod`, `filterRegistrantsForCell`, and the category equivalents `countRegistrantsByCategory`/`filterRegistrantsByCategoryForCell`) — all client-side against one fetched list |
| `registrantValidation.ts` | `EDITABLE_REGISTRANT_FIELDS`/`EDITABLE_FIELD_COLUMNS`/`EDITABLE_FIELD_LABELS`, `isValidAustralianPostcode`, `isValidRegistrantState` — shared by the page and the PATCH route's server-side re-validation. Email/phone/registered_at are deliberately not editable |
| `registrantLookupFilters.ts` | `getLookupOptions`/`filterByLookups` for the pane's five lookup dropdowns |
| `leaderMatch.ts` | `matchRegistrantsToLeaders` — cross-references registrants with `public.state_leaders` by normalised phone (no email column to match on), computed live on each request |
| `manageSummaryTypes.ts` | Response shapes shared by Manage routes and pages |

`supabase/functions/` is excluded from the root `tsconfig.json` (Deno-only syntax) and is not covered by the app's four CI jobs. Deploy/run steps: `docs/registry-pipeline/OPERATIONS.md`; design: `AFJ_PII_Technical_Implementation_Plan.md`; scope: `BRIEF.md`.

### 17.3 The `/registry` portal

Real Supabase Auth (magic link) + MFA for `registry.leader_roles`, independent of the main app's login and deliberately not under `/admin` (a `national_admin` needn't be a `state_leaders` row). `lib/registrySupabaseClient.ts` is a second client with its own localStorage key so both sessions coexist.

Flow: `/registry/login` (invite-only, `shouldCreateUser: false`) → magic link → `/registry/auth/callback` (client-side exchange — must run in-browser so the session can persist) → `lib/registryAuth.ts`'s `getRegistryAccessState()` reads the caller's own `leader_roles` row + AAL/factors and routes via `evaluateMfaGate()` to `/registry/mfa/enroll`, `/registry/mfa/challenge`, `/registry/no-access`, or `/registry` (landing page; links to `/registry/manage` for national/whatsapp admins). `middleware.ts` guards `/registry/*` with two **plain session cookies** — `registry_auth` once a session exists, `registry_session` once the MFA gate clears. They are a UX guard only; the real boundary is RLS + `has_required_mfa()`. Because they have no `max-age` they can vanish before the real session does, so `/registry/login` checks `getRegistryAccessState()` on mount and carries a still-signed-in leader through instead of showing a blank form. Access is seeded by `scripts/seed_registry_leader_roles.ts`. `/registry/recent-registrations` was retired 2026-09-14 (a live per-contact AC walk that kept exceeding the 60 s `maxDuration`; `/registry/manage` is DB-backed and covers it).

### 17.4 `/registry/manage` and its logs

`national_admin`/`whatsapp_admin` only — hidden from a `state_leader` *and* rejected server-side by `/api/registry/manage-summary` and `manage-record`. It shows:

- the latest `registry.sync_log` row (when the cron last ran, status, counts);
- a grid of registrant counts by state — **All AFJ Registrations**, a **Primary Filter** row (period dropdown: last 24 h … a calendar year) and an **Other Filters** row that isolates one category, *Unsubscribed* or *No Further Contact* (not date-based, so a flagged registrant with no `registered_at` still counts). State columns are shaded with `getSlideStateShade()`;
- clicking any non-zero count opens a **record pane** below listing the matching registrants, with that cell's shading boosted. The pane stays pinned to the cell's row+column identity, so changing that row's dropdown re-filters live;
- two checkboxes — **Exclude unsubscribed** and **Exclude No Further Contact** — filter the underlying list, so every count, lookup option and the pane update together; the "Counts are based on N registrants" line reflects the filtered count;
- five type-to-filter lookup comboboxes (`LookupSelect`) for First name / Last name / Email / Mobile / Postcode; options are the distinct values among the selected cell's records plus "(blank)", reset when the cell changes;
- a **View/Edit toggle**: First name, Last name, State (dropdown of `AUSTRALIAN_STATES`), Postcode (4-digit validated) and NFC (Yes/blank, never "No") become inline-editable. Each field saves independently via `PATCH /api/registry/manage-record` (whitelisted + re-validated server-side, written with the service role since there's no authenticated write policy), is logged to `registry.registrant_edits`, and patches the in-memory list so counts re-tally immediately (correcting a state moves the person to the right column);
- the summary API returns every registrant's full record plus a live `isLeader`/`leaderName` cross-reference (shown as a small icon by the last name, tooltip = leader name; no state) in one paginated fetch; all tallying is client-side;
- after "Registered" (date only, `formatDateOnly()`) come four read-only columns — Webinar session (`formatDateTime()`), Webinar attended, Code agreed, Date agreed; the First name / Last name / Postcode / Registered headers sort (Registered defaults newest-first; sort is local view state not reset when a cell changes).

**`/registry/manage/edit-log`** — paginated (50/page, newest first, `/api/registry/manage-edit-log`) listing `registry.registrant_edits` joined to the registrant (name/email, state for row shading), field labels via `EDITABLE_FIELD_LABELS`. **`/registry/manage/whatsapp-invite-log`** — same pattern (`/api/registry/manage-whatsapp-invite-log`): status (`Sent`/`Failed`/`Skipped (no invite link configured)`, colour-coded), detail (error or Resend id), and whether the Near-Me section was included.

### 17.5 WhatsApp invite email

Skipping WhatsApp's Communities feature (AFJ's ~100 groups/9,000+ subscribers exceed its limits), Peter chose **one national group link**. On each sync, right after `upsertRegistrant()`, `transform.ts` checks `shouldSendWhatsAppInvite()` and, if the `'national'` link row exists, sends via `ac-sync/emailClient.ts` (Resend, separate `RESEND_API_KEY` Edge secret since it calls Resend directly rather than through Supabase Auth). A failed send is logged and **never** fails the sync or is retried (a retry would re-upsert an existing registrant forever and `isNew` would be false). Every outcome — sent, failed, or skipped for no link — is logged to `registry.whatsapp_invite_log` inside its own try/catch so a logging failure can't affect the staging event. Missing link or missing key both fail safe (log-and-skip).

The email's second section is a personalised **Campaigns Near Me** link (§18.1), built by `emailClient.ts` from the registrant id + `NEXT_PUBLIC_SITE_URL` (omitted rather than shipping a localhost link when unset), followed by "Keep this link safe and click on it anytime…". Requires the SQL migrations, a real invite URL in `whatsapp_group_links`, `RESEND_API_KEY`, `NEXT_PUBLIC_SITE_URL` in the Edge environment, and an `ac-sync` redeploy. **Live since 2026-09-15.** Not built: state/city links, and an RLS-scoped `registry.v_leader_registrants` view / export RPC.

### 17.6 Incident history worth knowing

- **TWOL responders in registrants (2026-09-14).** A missing-postcode report traced to List `[2]` submissions (a presenter's report, no postcode field) being upserted like registrations and made eligible for the invite. Fixed by `twol_respondents` + routing in `transform.ts`; `scripts/migrate_wayoflife_responders_to_twol_respondents.ts` moved 46 rows (those whose *only* events were List `[2]`; people with a genuine List-1 event stayed).
- **Tag audit (2026-09-14).** 57 distinct tags audited; donation/near-blank/video-request tags added to `EXCLUDED_SOURCE_TAG_IDS`; `scripts/cleanup_excluded_tag_only_records.ts` removed the affected rows (1 registrant, 3 respondents) by re-checking each contact's *full* tag history.
- **Unsubscribe tracking (2026-09-14).** An existing registrant who later unsubscribed in AC had the change silently skipped; now `markRegistrantUnsubscribedByEmail()`. A one-off cross-check against Jordan's separate Unsubscribes sheet flagged 540 more (`scripts/mark_unsubscribed_from_jordan_sheet.ts`). `shouldSendWhatsAppInvite` also checks the pre-existing `unsubscribed` value explicitly. *Known limitation:* a first-time, AC-active contact who is only on Jordan's sheet isn't protected — that sheet isn't a live source.
- **Invite log silently failing (2026-09-17).** `whatsapp_invite_log.id` was `BIGSERIAL`, unlike the `GENERATED ALWAYS AS IDENTITY` ids elsewhere; a `SERIAL` sequence is a separate grantable object not covered by `service_role`'s table grants, so every log insert failed with `permission denied for sequence …_id_seq` (caught and console-logged; sends were unaffected). Fixed by `fix_whatsapp_invite_log_sequence_grant.sql` (also `ALTER DEFAULT PRIVILEGES … ON SEQUENCES`). Two sends in the gap were back-filled as `sent` (`backfill_log_confirmed_sent_pre_fix.ts`, a hardcoded list).
- **Manual invite backfill.** ~6,301 registrants with an email have never received the invite (back to 2017) — a full historical send is a separate decision. `scripts/backfill_whatsapp_invite_manual.ts` sends to a recent window (default last 14 days, `--since=YYYY-MM-DD`; dry run unless `--apply`), logs with `raw_staging_id: null`, skips anyone already logged `sent`. It once returned zero candidates because `.neq('unsubscribed','Yes')` excludes NULLs (three-valued logic) — filter that in JS.
- **Name overwrite (2026-09-17).** A sync under a shared email replaced a real name with "Test"/"Testing". No content-based test detection is reliable (shared household emails and leader test submissions are both real), so the fix is at the overwrite: `db.ts`'s `upsertRegistrant` runs updates through `protectExistingRegistrantName()` — once `first_name`/`last_name` is non-blank, no sync can replace it (a blank can still be filled). Genuine corrections go through the audited Edit mode. An audit against the CSV baseline found 4 more affected registrants and no email shared by two distinct AC ids; `scripts/fix_test_data_overwritten_names.ts` restored the five names with `registrant_edits` rows.
- **Registrations reload (2026-09-08/09).** `registry.registrants` was fully replaced from Lorraine's CSV (9,128 rows, via `reload_registrants_from_csv.ts`, which is a truncate+reload tool and refuses a non-empty table). Two real issues hit: a multi-table `TRUNCATE` FK rule and a Podman+SELinux bind-mount problem on Fedora.

---

## 18. Public Links, Member Interest & Leader Tools

### 18.1 Public links (`/public/*`)

No-login pages, each registered in `lib/publicLinks.ts` (single source of truth for slug/title/description/path). That registry drives both each page's own `<title>`/Open Graph metadata and the admin-managed list at `/admin/public-links`, where an admin can override a link's title/description without a redeploy (stored via `appSettings`). `middleware.ts`'s `PROTECTED_PREFIXES` doesn't include `/public`, so these are open by default. Each is backed by a matching `/api/public/*` route using `supabaseAdmin`, because anonymous visitors have no RLS access. Every `/api/public/*` route calls `enforceOrigin()` and a per-IP `createRateLimiter()` (`lib/corsUtils.ts`, `lib/rateLimit.ts`); GETs are briefly cached in memory since the response is identical for every caller.

`app/public/layout.tsx` applies the `large-text` class (§20) and, when the URL has `?from=app`, a "← Back to app" bar (`components/BackToAppBar.tsx`'s `withBackToApp()` adds it; members opening a shared link never see it).

| Path | What it does |
|---|---|
| `/public/week1-campaigns` | Always-current Week 1 Campaigns list, all states |
| `/public/temporary-upcoming-campaigns` | Leader-facing fortnight list — check / edit-redirect / download |
| `/public/final-campaign-lists` | Read-only version of the same list once leaders are done editing (Download only). Same data source (`publicCampaignListService`: `getUpcomingFortnightDateStrings()` — also a cache key — and `fetchFortnightCampaignDays()`) |
| `/public/campaign-results` | Results for the week the last Weekly Refresh *kept*, shown until the next refresh (`publicCampaignResultsService`: `getLastSuccessfulWeeklyRefreshAt()` + pure `getDisplayedResultsWeekStart()`). Per-page JPEG downloads. An "IMPORTANT NOTICE" says first names are for prayer only and won't be kept beyond a named Sunday — deliberately one week *after* the actual deletion (`lib/campaignDates.ts`'s `getCampaignResultsNoticeDate()`), giving people time to delete downloaded copies. Names are really removed by the Sunday weekly refresh deleting past campaigns (their `results` rows go too); `lib/resultsLog.ts` logs category codes only, never first names, so the log can't outlive them |
| `/public/register-interest` | Tick upcoming campaigns and register "Yes I'm In" / "Tell Me More" with first name + validated mobile and/or email (`lib/validation.ts`). The only `/public/*` page with a POST |
| `/public/upcoming-campaigns` | Public map of upcoming campaigns, all states, This Week / Next Week toggle (replaced the admin-only `/admin/campaign-map`). Groups by place using cached `state_places` coordinates only. A postcode box (`/api/public/geocode-postcode`) recentres the map. Marker actions collect name + mobile/email inline (`PublicMapRegisterInterestActions`). Usability pass 2026-10-17: a 3-step instruction strip, week buttons showing their dates (`formatShortWeekRange`), a full-width Map / List toggle, a "N campaigns in M places" summary, larger markers (30 px / 0.5 opacity), a "Find campaigns near me" box above the map (postcode **or** a "Use my location" button — browser geolocation, never sent anywhere), the map auto-framing the markers (`CampaignMap`'s `fitToMarkers`, off once a postcode/location target is set), a **Full screen** button on the map (fixed overlay, Escape or ✕ exits; `CampaignMap`'s `resizeKey` makes Leaflet re-measure) — the page is now scrollable (`min-h-[100dvh]`, map `65dvh`/min 360 px) rather than a fixed-height column that squeezed the map on phones — a dismissible first-visit "Tap a circle" hint (hidden on first marker click via `onMarkerOpen`, or after 12 s), and a popup that lists **every** campaign at a place (earliest first, each with its own buttons — it used to show only the earliest) |
| `/public/campaigns-near-me?r=<registrantId>` | Personalised map for one registry registrant, reached from their WhatsApp-invite email. Centres on their postcode (state fallback) for 7 days from today within 60 km. The URL carries only the opaque id — never name/email/mobile. Tapping a marker action (`PublicCampaignInterestActions`) shows the consent modal then POSTs `{registrantId, campaignId, interestType}`; the route re-derives name/mobile/email from `registry.registrants` server-side. Not in `publicLinks.ts` and not cached (personalised) |
| `/public/training/[campaignId]` | One BOTJ/TLT training session's details with an interest form → `training_interest`. Dynamic, so *not* in `publicLinks.ts` (metadata from the campaign record in `generateMetadata()`); GET not cached (single indexed lookup). GET+POST in `app/api/public/training-interest/[campaignId]/route.ts` |

**No on-demand geocoding on public pages.** The admin equivalents geocode via the admin-only `geocode-place` route, which anonymous visitors can't call, so public services (`publicCampaignsNearMeService.buildNearbyMarkers()`, `publicUpcomingCampaignsService.buildUpcomingCampaignMarkers()`) are pure functions over already-fetched campaign rows + cached coordinates, unit tested with no mocks. They share `campaignMapService.placeKey()` so place matching is normalised identically. A place missing coordinates is invisible on those maps with no warning — `addNewPlaceForState()` therefore best-effort geocodes new places (`lib/geocoding.ts`'s `geocodePlace()`) and `/admin/state-places` flags any place without coordinates.

**Maps.** `components/CampaignMap.tsx` (every upcoming campaign, no radius — public `/public/upcoming-campaigns` and admin `/admin/state-places-map`) and `components/NearbyCampaignsMap.tsx` (within a radius — admin and public near-me) take a `renderActions` prop so each screen supplies its own popup actions (default: the admin `MapPopupActions` stub). Marker/campaign types are minimal local interfaces rather than the admin `Campaign` type so a public caller's leaner rows fit. `CampaignMap`'s popup lists every campaign at a place via `sortCampaignsChronologically()` (`lib/campaignUtils.ts`), and takes a `markerStyle` prop. `NearbyCampaignsMap`'s popup does the same. Near-me markers are larger/darker (30 px, 0.5 fill-opacity) than the default (22 px, 0.35) via `lib/leafletMarkerIcon.ts`'s `getStateMarkerIcon({ size, fillOpacity })` — the icon cache key includes those options. `components/Modal.tsx` portals to `document.body` because a modal opened from a Leaflet popup would otherwise position itself inside the map's CSS-transformed pane.

### 18.2 Registering interest and following up

- **Tables:** `campaign_interest` (one row per campaign+person; `mobile` and/or `email`, DB `CHECK` requires one; `interest_type` `'in' | 'more'`; `contacted`/`contacted_at`) and `training_interest` (same shape). RLS lets an admin, or the campaign's owning/shared leader, read/update via a join through `campaigns`, **and** now requires an aal2 session (§6.8). Public inserts go through the service role in the API routes (`register-interest`, `campaigns-near-me`), never the browser client.
- **UI:** `components/registerInterest/` (`RegisterInterestClient`, `CampaignCheckboxList`, `InterestSummaryModal`) is the screen shared by `/public/register-interest` (current fortnight) and `/admin/register-interest` (`nextPeriod` prop → `?period=next`). `CampaignCheckboxList` is a responsive grid so names don't truncate at large text. `components/CampaignInterestEntryList.tsx` is the registration-row list shared by `/admin/registered-interest` (admin-wide) and `/campaign-interest` (leader-scoped; optional `?campaignId=` filters to one campaign — linked from the "N people interested" callout on `CampaignCard`). `/training-interest` lists the user's BOTJ/TLT campaigns (own, shared, admin: all) with interest counts and a Copy Link action.
- **Services:** `campaignInterestService` (`getCampaignInterestList`, `getCampaignInterestForLeader` — built on `campaignService.getCampaignsForUser`, not re-implementing role filtering —, `getCampaignInterestCounts`, `setCampaignInterestContacted`); `trainingInterestService` (`getTrainingCampaigns`, `getTrainingInterestCounts`, `getTrainingInterestForCampaign`, `setTrainingInterestContacted`, plus `TRAINING_CATEGORIES`/`isTrainingCategory()` — the single source of truth for which category codes `BOTJ`/`TLT` count as training, used by services and UI alike).
- **Texting the leader.** After a successful insert, both public routes call `campaignInterestSmsService.notifyLeadersOfCampaignInterest(client, { campaignIds, registrantFirstName, interestType })` — injected `supabaseAdmin` (a leader's mobile isn't readable by an anonymous visitor). It texts only the campaign's *owning* leader (never a shared one), groups ticked campaigns by owning `(state, leader)` and sends **one combined text per leader**, never throws (one leader's failure can't block another or the registrant), and logs every outcome (`sent` / `failed` / `skipped_no_mobile`) to `campaign_interest_sms_log` — learning from the registry WhatsApp invite log's silent-failure gap. Pure helpers `toE164AuMobile`/`groupCampaignsByLeader`/`buildLeaderSmsMessage` are fully unit tested. The ClickSend adapter `lib/clickSendClient.ts` (`sendSms`) always throws on failure, including missing `CLICKSEND_USERNAME`/`CLICKSEND_API_KEY`.

### 18.3 Registration checks (leader and admin)

- **Leader check** — `/app/check-registration` → `POST /api/leader/check-registration` (rate-limited per IP and per user; `isSessionForStateLeader()` — the session's profile name+state must match any `state_leaders` row). `parseRegistrationCheckInput()` requires first + last name and at least one of email/mobile (a name alone never searches). `checkRegistration()` exact-matches lower-cased email and/or `normalizePhone()`'d mobile against `registry.registrants`, compares names case/accent/spacing-insensitively → `registered` / `name_mismatch` / `not_registered`, and reports which of the caller's own typed details matched. It throws on a query error rather than answering "not registered". **It never returns anything stored in the registry** — not even selecting name/state/flags — because a plain leader has no other access to that data. Keep it that way when extending it.
- **Admin lookup** — `/admin/check-registration` → `POST /api/admin/check-registration`, gated by `verifyAdminCaller`. `parseContactLookupInput()` + `lookupRegistrationByContact()`: mobile and/or email only; returns `{ registered, matchedOn, registrants }` **including the matching records** (name, email, phone, state, postcode, registered date, webinar/Code-of-Conduct fields, unsubscribed/NFC — what `/registry/manage` shows), deduplicated by id with a per-record `matchedOn`. Never call it from a route with a weaker gate. Browser wrappers in `registrationCheckClient.ts`.
- `AdminQuickActions` (top of `/app`, AD only) holds a "Check if a Person is Registered" button plus **Week 1 Campaigns** and **Campaign Results** buttons that open those public links with `?from=app`. Its older download buttons were retired; the same outputs live on `/admin/generate-slides`, `/admin/generate-report`, `/admin/generate-week-campaigns`.

### 18.4 CAS User Guide (OPEN GUIDE)

A PDF guide for leaders, stored in a **private** Supabase Storage bucket `user-guide` (created automatically on first admin upload; PDF-only, 20 MB; never a public URL because it carries screenshots and support numbers).
- Each upload is a new `guide-<timestamp>.pdf`; the newest is current (so a replaced guide is never served from a stale CDN cache); before each upload all but the current file are deleted.
- `userGuideService.getUserGuideView(client)` → a 4-hour signed URL, backing `GET /api/public/user-guide` (**no sign-in** — the guide is also offered on the sign-in screen for new leaders; not cached, so a new guide shows straight away). `createUserGuideUploadTarget(client)` → a one-time signed upload target behind `POST /api/admin/user-guide/upload-url` (`verifyAdminCaller`); the browser then uploads straight to Storage (`userGuideClient.uploadUserGuide`), so a large PDF never hits Vercel's ~4.5 MB request limit. Admin upload card: `app/admin/components/UserGuideUploadCard.tsx` on `/admin`.
- Shown by `components/GuideScreen.tsx` (full screen + ✕ Close): as the `/app/guide` page (plain leaders' bottom-bar OPEN GUIDE button) and **in place** (`showGuide` state) from the buttons on `/login`'s sign-in form and action chooser — in place so Close returns to exactly where they were (going back to `/login` with a session would jump to `/app`). `components/OpenGuideLabel.tsx` keeps the discreet button styling identical across places.
- `components/PdfGuideViewer.tsx` draws each page with pdf.js (`pdfjs-dist` pinned to 5.4.x — 6.x needs Node 22 and CI runs 20; the *legacy* build for older phones; loaded only when the guide opens), because browser PDF viewers can't be embedded reliably on phones. Canvas sharpness is capped at 2× (`lib/pdfRenderScale.ts`). pdf.js pauses drawing in a hidden tab, so when testing in a background preview only page 1 appears until visible. Falls back to a plain link if the viewer fails. Not part of `/admin/backup` (a file, not a table) — keep the source PDF.

---

## 19. Slide & Report Generation, Campaign Reports

### 19.1 Arise (Week 1 Campaigns) list

Three modules: `lib/ariseLayout.ts` (constants, `AriseCampaign`, `apx()`, `simulateColumnCount()`, `computeColLayout()` — no canvas ops), `lib/ariseCanvas.ts` (`drawBannerAndKey`, `drawDateHeader`, `drawCampaignLine`, `drawWeekSeparator`, `renderAriseCanvas()`), `lib/ariseGenerator.ts` (`fetchCampaignsForDate()` + `generateAndDownloadAriseList()`). The canvas is 4200×3000 px (14″×10″ at 300 DPI); `PLACE_COLS`/`TIME_COLS`/`LEADER_COLS` set field widths and a dynamic `campaignScaleX` compresses text horizontally to fill the width.

`/admin/generate-slides` renders a separate 2250×3000 px JPEG per slide via a different pipeline (`slideGenerator.ts`, `slideLayout.ts`; `PLACE_COLS`, `TIME_COLS`, `LEADER_COLS`, `MOBILE_MAX_COLS` there). It defaults to the upcoming fortnight, all states. `/admin/generate-week-campaigns` ("Single Week Campaigns") produces the landscape "A.F.J UPCOMING CAMPAIGNS" JPEG for an explicit start date, end date and state. `lib/slideLayout.ts` also exports `getSlideStateShade(state, alpha)`, shared with the registry manage grid.

### 19.2 Campaign Report project (on hold)

Aggregate per-campaign tallies (Partial/Full Presentations, Sinner's Prayer, Information Requests) from an external Google Sheet, in `campaign_reports`. `lib/campaignReportParser.ts` (`parseTallyValue`, `parseCampaignDate`, `normalizeCampaignReportRow`) owns the messy-data parsing rules, shared by the initial load (`scripts/campaign_reports_xlsx_to_json.py` + `scripts/import_campaign_reports.ts`) and the incremental catch-up import. `location_raw`/`leader_raw` are free text with no FK; every tally/date column has a paired `*_raw` and `needs_review` flags rows the parser couldn't resolve; `submitted_at` is unique (the de-dup key for re-imports); `campaign_id` is a nullable unenforced best-effort link. `derived_state`/`derived_place`/`derived_leader` are populated only for rows submitted on/after 2026-05-06 by `lib/campaignReportMatcher.ts` (`scripts/derive_campaign_reports_fields.ts`), null when not confidently resolvable — never guessed. `/admin/campaign-reports-cleanup` (`campaignReportsService.getCampaignReportsNeedingReview` / `updateCampaignReportDerivedFields` via `POST /api/admin/campaign-reports/derived-fields`, service role) lets an admin fill the rest. Admin-only RLS. See `docs/campaign-report/BRIEF.md`.

---

## 20. UI Conventions

- **App-wide large text.** A `large-text` CSS class in `app/globals.css` — deliberately **unlayered**, so it beats Tailwind's layered utilities and `sm:` variants without editing class lists — raises every `text-xs…text-3xl` inside it by ≈4 px (xs 16, sm 18, base 20, lg 22, xl 24, 2xl 28, 3xl 34). Applied to `MobileLayout`'s `<main>` (campaign feed, results, capture, training/campaign-interest, My Admin, … — **but not under `/admin`**, dense tables), `app/public/layout.tsx`, `components/Modal.tsx` (modals portal outside the page scope), and `/login`'s credentials form / action chooser. **Left alone on purpose:** `MobileLayout`'s fixed-height header and bottom nav, the setup screens (explicit sizes, §6.11), canvas/slide output, `/registry`. `components/__tests__/largeText.test.tsx` pins where it applies. `app/layout.tsx`'s viewport no longer sets `maximumScale: 1`, so people can pinch-zoom. If a screen looks cramped, drop `large-text` from it or fix its layout.
- **Tech Insights (admin-only technical panel).** Press a configurable shortcut (default `Ctrl+Alt+I`) on any screen, on a desktop device, as a full admin (AD) signed in with 2FA, to open a side panel describing that screen: URL pattern → page file and layouts, a drop-down of every file reachable from the page (components, services, libraries, API routes — grouped by kind), the shortest import chain from the page to the selected file, its exports with line numbers, imports / imported-by / tests, the database tables, RPCs, API routes and assets it touches, and its source code (exports jump to and highlight their lines). **Visible components (Phase 2).** Components opt in by carrying `data-ti="<their own repo-relative file path>"` on their root element — attribute only, no wrapper or extra render, so it survives minification and costs nothing at runtime (≈45 components are tagged; add the attribute to a new component's root to include it; `LoadingSpinner`, `MobileLayout`, `Modal`, the campaign cards/forms/lists, the public-page clients, the auth setup pieces, the maps — a `MapContainer` can't take `data-*`, so `components/techInsights/TechInsightsMapTag.tsx` sets it on the map's container — and so on). While the panel is open it scans the DOM (`lib/techInsights/domScan.ts`): the drop-down gets a **"Visible on this screen"** group first (with ×N counts), the screen overview lists them, **Pick on screen** lets you click any component on the page (hover outlines the nearest tagged one; the click is swallowed so the page does nothing; Esc cancels), the chosen component is outlined on the page, and a "Where it appears" line shows its tagged ancestors (`MobileLayout › CampaignCard › …`). `lib/techInsights/__tests__/tagsMatchSourceFiles.test.ts` fails if any tag names a file other than the one it is written in. Not tagged on purpose: hooks/types, the Tech Insights panel itself, `ErrorBoundary`/`Providers`/`ServiceWorkerRegistration` (render nothing), and `MfaEnrollmentFlow` (its root is `CodeEntryScreen`, which is tagged). **Note:** the tag values are file paths in the page HTML for every user (not secret, but visible via view-source). Moving parts:
  - **Manifest generator** — `scripts/build-tech-insights.ts` (run by `predev`/`prebuild`, or `npm run tech-insights`) feeds every `.ts/.tsx/.css` under `app/ components/ contexts/ lib/` (+ `middleware.ts`) to the pure `lib/techInsights/buildManifest.ts` (TypeScript parser only, ≈2 s), writing `generated/tech-insights/{manifest,sources}.json` (**gitignored**). Static analysis only: literal `.from('table')`/`.rpc()`/`'/api/…'` strings are found; values built from variables are not (and are never guessed).
  - **Serving** — `GET /api/admin/tech-insights` (`verifyAdminCaller`: AD + aal2) returns the manifest, or one file's source with `?file=<path>` — only for paths the manifest lists (`lib/techInsights/manifestStore.ts`), never an arbitrary filesystem path. The data is deliberately **not** in `public/` or the client bundle (it is the app's source code). `next.config.ts`'s `outputFileTracingIncludes` ships the generated files with that one function.
  - **Settings** — `app_settings` keys `tech_insights_enabled` (off by default) and `tech_insights_hotkey` (validated server-side in `/api/admin/settings`), edited from the Tech Insights card on `/admin` (`TechInsightsSettingsCard`; click the box and press the keys).
  - **Zero cost for everyone else** — `components/techInsights/TechInsightsLoader.tsx` is mounted in `app/providers.tsx`; for a non-admin or a phone/touch device it makes no request and registers no listener. For an eligible admin it reads the two settings once per page load; the panel (`TechInsightsPanel`, loaded with `next/dynamic`) and the manifest are only fetched the first time the shortcut is pressed.
  - Pure helpers in `lib/techInsights/` (`routeMatch.ts` URL↔file, `hotkey.ts`, `graph.ts` reachability/path/summary, `types.ts`) are unit tested; `app/api/admin/__tests__/adminRoutesRequireAdmin.test.ts` pins that the route refuses non-admins.
- **Role picker busy state.** `components/auth/BusyChoiceButtons.tsx` — only the tapped role button shows as loading.
- **Sign Out / Switch Role** live in `MobileLayout`; Switch Role shows only for real (non-anonymous) sessions.
- Shared forms/hooks: `app/app/components/useCampaignForm.ts` (all form state, place creation, leader mobile auto-fill, submit; `handleSubmit` accepts `FormEvent` and `MouseEvent`) and `useStateDropdowns.ts` (state-scoped place/leader lists, with all `setState` routed through Promise chains to satisfy the `react-hooks/set-state-in-effect` lint rule).
- `/admin/state-leaders` filters by state, role (`lib/stateLeaderRoleFilter.ts` — e.g. "Admins only (AD & SR)"), name and mobile, shows each admin's 2FA status and a "Reset 2FA" button.

---

## 21. Operational Scripts & Deploy-Order Notes

`scripts/` holds SQL migrations (`create_*`, `add_*`, `fix_*`) and one-off TypeScript/JS tools. Conventions:

- SQL migrations are run by hand in the Supabase SQL editor; mirrors of policies live in `supabase/rls-policies.sql`.
- Destructive/bulk tools are **dry-run by default** with `--apply`, back up affected rows to `backups/` first, and re-verify each row before touching it (e.g. `revoke_admin_app_sessions.ts`, `fix_test_data_overwritten_names.ts`, `backfill_whatsapp_invite_manual.ts`). Secrets such as `RESEND_API_KEY` are passed inline, never via `.env.local`.
- A production incident investigated with a one-off script isn't closed until its root cause is a permanent test (`lib/__tests__/` or `lib/services/__tests__/`).
- **Code-first deploy order** applies whenever a SQL change would break the old client: session-grant lock-down (§6.4), aal2 on interest tables (§6.8), the magic-link template (§6.9). Ship code, wait ≈1 day for cached PWA copies, then change the database / dashboard.
- `docs/` — `email-templates/` (Magic Link copy), `registry-pipeline/` (design, operations log), `campaign-report/`, `migrations/`, `archive/`.

---

## 22. Keeping This Document Current

**Standing rule:** every PR that changes code must also update this file when it touches anything described here, and the PR description must say what was updated — or "TECHNICAL_DOCS: N/A" with a reason. Update `CLAUDE.md` in the same PR (its Architecture section carries the long-form history and rationale; this file is the junior-developer overview).

Check against this list:

- New/renamed/removed route or page → §4, §8.1
- New service module or exported function → §10
- New table/column or RLS change → §5 (and `BACKUP_TABLE_CONFIG` in `backupService.ts` if admin-curated)
- Auth, role or session change → §6, §7
- New env var or Supabase dashboard dependency → §14
- Public page / interest feature → §18; slide/report change → §19; shared UI convention (incl. Tech Insights) → §20
- New script or deploy-order constraint → §21
- Registry pipeline change → §17 (and `docs/registry-pipeline/OPERATIONS.md`)
- New test convention → §13

---

*Last updated: 16 October 2026*
