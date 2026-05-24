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
12. [Weekly Refresh Automation](#12-weekly-refresh-automation)
13. [Common Change Recipes](#13-common-change-recipes)
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
│  │  campaignService  authService  dropdownService  rulesService│   │
│  │  resultsService  weeklyRefreshService                       │    │
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
│   │   ├── sr-admin/page.tsx   # Route: /app/sr-admin
│   │   ├── tl-admin/page.tsx   # Route: /app/tl-admin
│   │   └── components/         # Components used ONLY by /app pages
│   │       ├── AdminQuickActions.tsx
│   │       ├── CampaignCard.tsx
│   │       ├── CampaignCreateForm.tsx
│   │       ├── CampaignFilters.tsx
│   │       ├── CampaignList.tsx
│   │       ├── DeleteConfirmModal.tsx
│   │       ├── InlineEditForm.tsx
│   │       ├── timeOptions.ts
│   │       └── types.ts
│   │
│   ├── admin/                  # Admin-only pages
│   │   ├── page.tsx            # Route: /admin (admin hub)
│   │   ├── campaign-rules/     # Route: /admin/campaign-rules
│   │   ├── campaign-logs/      # Route: /admin/campaign-logs
│   │   ├── campaign-messages/  # Route: /admin/campaign-messages
│   │   ├── campaign-categories/
│   │   ├── state-leaders/      # Route: /admin/state-leaders
│   │   ├── state-places/       # Route: /admin/state-places
│   │   ├── leader-shares/      # Route: /admin/leader-shares
│   │   ├── generate-slides/    # Route: /admin/generate-slides
│   │   ├── generate-report/    # Route: /admin/generate-report
│   │   ├── metrics/            # Route: /admin/metrics
│   │   └── backup/             # Route: /admin/backup
│   │
│   ├── record-results/
│   │   ├── page.tsx            # Route: /record-results
│   │   └── detail/page.tsx     # Route: /record-results/detail
│   │
│   ├── results/page.tsx        # Route: /results
│   ├── capture/page.tsx        # Route: /capture
│   ├── view-slides/page.tsx    # Route: /view-slides
│   └── api/                    # Server-side API routes
│       ├── auth/validate-leader/route.ts
│       └── cron/weekly-refresh/route.ts
│
├── components/                 # Shared components (used across multiple pages)
│   ├── CampaignForm.tsx        # Generic campaign add/edit form
│   ├── ErrorBoundary.tsx       # React error boundary
│   ├── LoadingSpinner.tsx      # Loading indicator
│   ├── MobileLayout.tsx        # Page shell: header + bottom nav + content
│   └── Modal.tsx               # Modal overlay wrapper
│
├── contexts/                   # React Contexts (global state)
│   ├── UserContext.tsx         # Auth state: user, role, state, leader
│   └── CampaignDatesContext.tsx# Campaign date window state
│
├── lib/                        # Pure business logic & utilities
│   ├── types.ts                # ALL shared TypeScript interfaces
│   ├── constants.ts            # AUSTRALIAN_STATES array
│   ├── supabaseClient.ts       # Browser Supabase client
│   ├── supabaseAdmin.ts        # Server-only Supabase admin client
│   ├── auth.ts                 # Login, sign-out, session helpers
│   ├── permissions.ts          # Permission enum + role checks
│   ├── userProfile.ts          # user_profiles table CRUD
│   ├── campaignFilter.ts       # getUserAdminStatusAndMobile()
│   ├── campaignRules.ts        # Rules evaluation engine
│   ├── campaignDates.ts        # Date window calculations
│   ├── campaignLog.ts          # Audit logging helpers
│   ├── campaignUtils.ts        # Time formatting, date helpers
│   ├── stateColors.ts          # State → Tailwind CSS colour mapping
│   ├── slideLayout.ts          # Slide generation layout helpers
│   ├── slideGenerator.ts       # Canvas-based JPEG slide generation
│   ├── ariseGenerator.ts       # Canvas-based landscape list generation
│   ├── reportGenerator.ts      # Canvas-based PDF report generation
│   ├── reportCanvas.ts         # Canvas drawing helpers for reports
│   ├── leaderShares.ts         # Campaign sharing logic
│   ├── location.ts             # Geolocation → state code
│   ├── errorUtils.ts           # Error message extraction helper
│   ├── analytics.ts            # Fire-and-forget event tracking
│   ├── appSettings.ts          # App-level toggles (logging on/off)
│   ├── weeklyRefresh.ts        # (legacy — logic moved to services/)
│   └── services/               # Database service layer
│       ├── authService.ts      # getAuthenticatedUser() (all auth in one query)
│       ├── campaignService.ts  # campaigns table CRUD
│       ├── dropdownService.ts  # Form dropdown data
│       ├── resultsService.ts   # results table CRUD
│       ├── rulesService.ts     # campaign_rules table CRUD
│       └── weeklyRefreshService.ts # Weekly campaign generation logic
│
└── lib/__tests__/              # Vitest unit tests
    ├── auth.test.ts
    ├── campaignDates.test.ts
    ├── campaignRules.test.ts
    └── permissions.test.ts
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
  category_code  'partial' | 'full' | 'full_sinners' | 'information'
  UNIQUE(campaign_id, first_name, category_code)     │
                                                     │
state_places ──────────────────────────────────────┐│
  id (PK)                                          ││
  state                                            ││
  place                                            ││
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

### 7.4 Permission Enum

Defined in `lib/permissions.ts`. Only used for the `ADMIN_ACCESS` check.

| Permission | Who has it |
|-----------|-----------|
| `VIEW_CAMPAIGNS` | Everyone |
| `CREATE_CAMPAIGN` | Everyone |
| `EDIT_CAMPAIGN` | Everyone |
| `DELETE_CAMPAIGN` | Campaign owners only (enforced in UI) |
| `VIEW_RESULTS` | Everyone |
| `ADMIN_ACCESS` | Full Admins only (`AD`) |

---

## 8. Page Map — Every Route Explained

### 8.1 Route Overview

```
/                         Auth guard — redirects to /app or /login
/login                    Sign in with mobile + name
/app                      Main campaign feed (home screen)
/app/sr-admin             State Reporter dashboard
/app/tl-admin             Team Leader dashboard
/record-results           Select a campaign to record results for
/record-results/detail    Enter result names + counts
/results                  View result summaries
/capture                  Geolocation-based campaign capture
/view-slides              Browse generated presentation slides
/debug                    Development debugging tools
/admin                    Admin hub (full admin only)
/admin/campaign-rules     Manage recurring scheduling rules
/admin/state-leaders      Manage the state_leaders master list
/admin/state-places       Manage valid place/suburb names per state
/admin/campaign-categories Manage campaign type codes
/admin/campaign-messages  Manage date-specific banner messages
/admin/campaign-logs      View campaign change audit log
/admin/leader-shares      Manage campaign sharing between leaders
/admin/generate-slides    Generate downloadable presentation slides
/admin/generate-report    Generate downloadable campaign reports
/admin/metrics            Admin analytics dashboard
/admin/backup             Export/restore JSON backup
```

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

Use this section to quickly find **which files to edit** for any given type of change.

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

**Step 2**: Add state to the form component
- File: `app/app/components/CampaignCreateForm.tsx`
- Add `const [newOptions, setNewOptions] = useState<string[]>([]);`
- Fetch inside a `useEffect`

**Step 3**: Add the dropdown JSX
- In the same file, add a `<select>` with `newOptions.map(...)` inside the form

**Step 4**: Include in the submit call
- Pass the selected value into the `createCampaign()` call

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
| Arise list (JPEG, landscape) | `lib/ariseGenerator.ts` | `WIDTH`, `HEIGHT` |
| Campaign report (JPEG pages) | `lib/reportGenerator.ts` | — |

To change font size, column widths, or colors: edit the constants at the top of the relevant generator file.

---

## 13. Environment Variables

### 13.1 All Variables

| Variable | Where Used | Required |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabaseClient.ts`, `lib/supabaseAdmin.ts` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabaseClient.ts` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabaseAdmin.ts` (server-only API routes) | Yes |
| `CRON_SECRET` | `app/api/cron/weekly-refresh/route.ts` | Yes (production) |
| `NEXT_PUBLIC_ADMIN_EMAILS` | Referenced but not actively enforced | No |

### 13.2 Where to Set Them

- **Local development**: Create `.env.local` in the project root (never commit this file)
- **Production (Vercel)**: Vercel Dashboard → Project Settings → Environment Variables

---

## 14. Running the App Locally

### 14.1 Prerequisites

- Node.js 20+
- npm 10+
- Access to the Supabase project credentials

### 14.2 First-Time Setup

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

### 14.3 Daily Development

```bash
# Start the development server (hot reload)
npm run dev
# Opens at http://localhost:3000
```

### 14.4 Before Committing

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

---

## 15. Change Management — Git Workflow

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

*Last updated: May 2026*
