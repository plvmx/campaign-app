# Campaign Management App - Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Quick Reference](#quick-reference)
3. [Architecture](#architecture)
4. [Module Reference](#module-reference)
5. [Data Flow](#data-flow)
6. [Key Concepts](#key-concepts)
7. [Database Schema](#database-schema)
8. [Authentication & Authorization](#authentication--authorization)
9. [Common Patterns](#common-patterns)

---

## Quick Reference

### Core Modules

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `lib/auth.ts` | Authentication | `signInWithMobileAndName()`, `getCurrentUser()`, `normalizeMobile()` |
| `lib/permissions.ts` | Authorization | `getUserRole()`, `hasPermission()`, `requirePermission()` |
| `lib/campaignFilter.ts` | Campaign Filtering | `getUserAdminStatus()`, `getUserMobileAndLeader()` |
| `lib/campaignDates.ts` | Date Calculations | `calculateCampaignDates()`, `formatDateForDb()` |
| `lib/location.ts` | Location Detection | `getUserStateCode()`, `getCachedStateCode()` |
| `lib/campaignLog.ts` | Change Logging | `logCampaignChange()`, `fetchCampaignData()` |
| `lib/userProfile.ts` | User Profiles | `getUserProfile()`, `upsertUserProfile()` |

### Main Pages

| Route | Purpose | Key Features |
|-------|---------|--------------|
| `/login` | Authentication | Mobile + first name validation |
| `/app` | Main Dashboard | Campaign list, filtering, inline editing |
| `/capture` | Create Campaign | Campaign creation form |
| `/record-results` | Record Results (Initial) | Campaign selection |
| `/record-results/detail` | Record Results (Detail) | Results entry with auto-save |
| `/admin` | Admin Panel | Admin functions (requires permission) |

### User Roles

1. **AD (Administrator)**: Full access, no filtering
2. **SR (State Reporter)**: Access to all campaigns in their state
3. **Regular User**: Access only to campaigns matching leader + mobile

### Key Database Tables

- `campaigns`: Campaign records
- `results`: Campaign results (people presented to)
- `state_leaders`: Leader lookup with admin status
- `state_places`: State-place combinations
- `user_profiles`: User information
- `campaign_changes_log`: Audit trail

---

## Overview

The Campaign Management App is a mobile-first Next.js application built with TypeScript, React, and Supabase. It enables users to create, manage, and track campaign activities across Australian states, with role-based access control and comprehensive logging.

### Technology Stack
- **Framework**: Next.js 16.1.1 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4.x
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (Anonymous sessions)
- **UI Libraries**: React 19.2.3, html2canvas, jszip

---

## Architecture

### Application Structure

```
/app                    # Next.js App Router pages
  /login               # Authentication page
  /app                 # Main dashboard (campaign list)
  /capture             # Create new campaigns
  /record-results      # Record campaign results (initial)
  /record-results/detail # Record campaign results (detail)
  /results             # View campaign results
  /admin               # Admin panel (multiple sub-pages)
  /auth/callback       # OAuth callback handler
  layout.tsx           # Root layout with providers
  providers.tsx        # React context providers
  page.tsx             # Root redirect handler

/lib                   # Core business logic modules
  supabaseClient.ts    # Supabase client configuration
  auth.ts              # Authentication utilities
  permissions.ts       # Permission management
  location.ts          # Location detection & state mapping
  campaignDates.ts     # Campaign date calculations
  campaignFilter.ts    # Campaign filtering logic
  campaignLog.ts       # Change logging system
  userProfile.ts       # User profile management
  appSettings.ts       # Application settings
  stateColors.ts       # State-based color coding

/components            # Reusable React components
  MobileLayout.tsx     # Mobile-optimized layout wrapper
  CampaignForm.tsx     # Campaign creation/edit form

/contexts              # React Context providers
  CampaignDatesContext.tsx # Campaign date period context
```

### Request Flow

1. **User Request** → Next.js App Router
2. **Authentication Check** → `lib/auth.ts` → Supabase Auth
3. **Permission Check** → `lib/permissions.ts` → Database lookup
4. **Data Fetching** → `lib/supabaseClient.ts` → Supabase Database
5. **UI Rendering** → React Components → User

---

## Module Reference

### `/app` Directory - Pages

#### `app/page.tsx` (Root Page)
**Purpose**: Entry point that redirects users based on authentication status.

**Functions**:
- `checkAuth()`: Checks for existing session using `getSession()`
- Redirects authenticated users to `/app`
- Redirects unauthenticated users to `/login`

**Dependencies**:
- `lib/auth.ts` → `getSession()`

---

#### `app/login/page.tsx` (Login Page)
**Purpose**: Handles user authentication via mobile number and first name.

**Functions**:
- `checkExistingSession()`: Checks if user is already signed in
- `handleSubmit()`: Validates input and calls `signInWithMobileAndName()`
- Validates mobile number and first name are provided
- Redirects to `/app` on successful authentication

**Key State**:
- `mobile`: User's mobile number input
- `firstName`: User's first name input
- `error`: Error message display
- `isLoading`: Loading state during authentication

**Dependencies**:
- `lib/auth.ts` → `getSession()`, `signInWithMobileAndName()`

**Data Flow**:
1. User enters mobile + first name
2. `signInWithMobileAndName()` validates against `state_leaders` table
3. Creates anonymous Supabase session
4. Creates/updates `user_profiles` record
5. Grants admin role if `admin` field is 'AD' in `state_leaders`

---

#### `app/app/page.tsx` (Main Dashboard)
**Purpose**: Primary dashboard showing campaigns with filtering, editing, and management capabilities.

**Key Functions**:
- `checkAuthAndLoadCampaigns()`: Loads campaigns based on user permissions
- `applyDateFilter()`: Filters campaigns by date (today/past/upcoming)
- `handleSubmit()`: Creates new campaign
- `handleEdit()`: Initiates inline editing mode
- `handleSaveInlineEdit()`: Saves inline edits
- `handleDelete()`: Deletes campaign
- `handleToggleCheckbox()`: Toggles `tl_ok` or `sr_ok` flags
- `updateInlineEditField()`: Updates individual fields during inline edit

**Campaign Filtering Logic**:
1. **AD (Admin)**: No filtering - sees all campaigns
2. **SR (State Reporter)**: Filtered by state from `state_leaders` table
3. **Regular User**: Filtered by leader name AND mobile number match

**Key State**:
- `campaigns`: Filtered campaign list
- `allCampaigns`: Unfiltered campaign list (for re-filtering)
- `inlineEditingId`: ID of campaign being edited inline
- `inlineEditState`: State for inline editing form
- `dateFilter`: Current date filter ('today' | 'past' | 'upcoming')
- `filterState`: State filter (admin only)

**Dependencies**:
- `lib/auth.ts` → `getCurrentUser()`, `normalizeMobile()`
- `lib/permissions.ts` → `hasPermission()`, `Permission`
- `lib/campaignFilter.ts` → `getUserAdminStatus()`, `getUserMobileAndLeader()`
- `lib/campaignDates.ts` → `formatDateForDb()`
- `lib/campaignLog.ts` → `logCampaignChange()`, `fetchCampaignData()`
- `lib/stateColors.ts` → `getStateColor()`
- `contexts/CampaignDatesContext.tsx` → `useCampaignDates()`

**Data Flow**:
1. Check authentication
2. Get user profile and admin status
3. Build filtered query based on admin status
4. Fetch campaigns from Supabase
5. Apply additional mobile filtering for regular users
6. Apply state and date filters
7. Render grouped by date → state → place

---

#### `app/capture/page.tsx` (Create Campaign)
**Purpose**: Dedicated page for creating new campaigns.

**Functions**:
- `checkAuthAndGetState()`: Authenticates and gets default state from location
- `handleSubmit()`: Creates new campaign and logs change

**Key Features**:
- Defaults state to user's detected location
- Auto-populates mobile from `state_leaders` if leader selected
- Logs campaign creation to `campaign_changes_log`

**Dependencies**:
- `lib/auth.ts` → `getCurrentUser()`
- `lib/location.ts` → `getUserStateCode()`, `getCachedStateCode()`
- `lib/campaignFilter.ts` → `getUserMobileAndLeader()`
- `lib/campaignLog.ts` → `logCampaignChange()`
- `components/CampaignForm.tsx`

---

#### `app/record-results/page.tsx` (Record Results - Initial)
**Purpose**: Initial screen for selecting a campaign to record results for.

**Functions**:
- `checkAuthAndGetDefaults()`: Sets default date (today) and state
- `handleSubmit()`: Validates campaign exists and navigates to detail page

**Campaign Matching Logic**:
- Admins: Can access any matching campaign
- Regular users: Must match by leader name AND mobile number

**Dependencies**:
- `lib/auth.ts` → `getCurrentUser()`, `normalizeMobile()`
- `lib/location.ts` → `getUserStateCode()`, `getCachedStateCode()`
- `lib/permissions.ts` → `hasPermission()`, `Permission`
- `lib/campaignFilter.ts` → `getUserMobileAndLeader()`
- `components/CampaignForm.tsx`

---

#### `app/record-results/detail/page.tsx` (Record Results - Detail)
**Purpose**: Detail screen for recording campaign results (first names and category codes).

**Key Functions**:
- `checkAuth()`: Authenticates and loads campaign data from query params
- `loadExistingResults()`: Loads existing results for the campaign
- `addRow()`: Adds new input row to a section
- `removeRow()`: Removes input row from a section
- `handleSave()`: Saves all results to database
- `handleFieldChange()`: Updates field value in a row
- Auto-saves results as user types (debounced)

**Sections**:
- **Partial (P)**: Partial presentations
- **Full (F)**: Full presentations
- **Full Sinners (SP)**: Full presentations to sinners
- **Information (IR)**: Information requests

**Features**:
- Multiple input rows per section
- Auto-save on field change (debounced)
- Counts displayed for each category
- Team size tracking
- Preserves data on navigation away (cleanup on unmount)

**Category Codes**:
- `P`: Partial presentation
- `F`: Full presentation
- `SP`: Full presentation to sinner
- `IR`: Information request

**Dependencies**:
- `lib/auth.ts` → `getCurrentUser()`
- `lib/supabaseClient.ts`
- `lib/campaignLog.ts` → `logCampaignChange()`, `fetchCampaignData()`

---

#### `app/results/page.tsx` (View Results)
**Purpose**: View all campaigns and their results.

**Note**: This page exists but functionality may vary. Refer to source code for current implementation.

---

#### `app/admin/page.tsx` (Admin Dashboard)
**Purpose**: Admin panel landing page with navigation to admin functions.

**Note**: Admin pages require `ADMIN_ACCESS` permission. Refer to individual admin page implementations for details.

---

### `/lib` Directory - Core Modules

#### `lib/supabaseClient.ts`
**Purpose**: Configures and exports the Supabase client instance.

**Exports**:
- `supabase`: Configured Supabase client

**Configuration**:
- Uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Enables session persistence in localStorage
- Auto-refreshes tokens
- Detects sessions from URL (for OAuth)

**Usage**: Imported by all modules that need database access.

---

#### `lib/auth.ts`
**Purpose**: Authentication and user management utilities.

**Key Functions**:

**`normalizeMobile(mobile: string): string`**
- Normalizes mobile numbers for consistent comparison
- Handles country codes (+61), spaces, dashes
- Adds leading 0 for Australian numbers if missing
- Example: "+61 0429028464" → "0429028464"

**`normalizeName(name: string): string`**
- Normalizes names for case-insensitive comparison
- Trims whitespace and converts to lowercase

**`validateStateLeader(mobile: string, firstName: string): Promise<StateLeaderMatch | null>`**
- Validates mobile + first name against `state_leaders` table
- Uses normalized comparison for both fields
- Returns matching record or null

**`signInWithMobileAndName(mobile: string, firstName: string): Promise<{ user, stateLeader }>`**
- Main authentication function
- Validates credentials against `state_leaders`
- Creates anonymous Supabase session
- Creates/updates `user_profiles` record
- Grants admin role if `admin` field is 'AD'

**`getCurrentUser(): Promise<User | null>`**
- Gets current authenticated user from Supabase
- Returns user object with `id` and optional `email`

**`getSession()`**
- Gets current session from Supabase
- Used for checking authentication status

**`signOut()`**
- Signs out current user
- Clears Supabase session

**Dependencies**:
- `lib/supabaseClient.ts`

**Used By**: All pages requiring authentication

---

#### `lib/permissions.ts`
**Purpose**: Role-based permission management system.

**Permission Enum**:
- `VIEW_CAMPAIGNS`
- `CREATE_CAMPAIGN`
- `EDIT_CAMPAIGN`
- `DELETE_CAMPAIGN`
- `VIEW_RESULTS`
- `ADMIN_ACCESS`

**Key Functions**:

**`getUserRole(): Promise<UserRole>`**
- Determines user's role based on `state_leaders` table
- Checks if user's name matches a leader with `admin = 'AD'`
- Returns role ('admin' | 'user' | 'viewer') with permissions array

**`hasPermission(permission: Permission): Promise<boolean>`**
- Checks if current user has specific permission
- Returns true/false

**`requirePermission(permission: Permission): Promise<void>`**
- Throws error if user doesn't have permission
- Used for protecting routes/actions

**Role Permissions**:
- **admin**: All permissions
- **user**: View, create, edit campaigns; view results
- **viewer**: View campaigns and results only

**Dependencies**:
- `lib/auth.ts` → `getCurrentUser()`
- `lib/supabaseClient.ts`
- `lib/userProfile.ts` → `getUserProfile()`

**Used By**: Admin pages, protected routes

---

#### `lib/location.ts`
**Purpose**: Location detection and Australian state code mapping.

**Key Functions**:

**`getUserLocation(): Promise<Coordinates | null>`**
- Uses browser Geolocation API
- Returns latitude/longitude or null
- Handles permission denial gracefully

**`getStateFromLocation(latitude: number, longitude: number): Promise<StateCode | null>`**
- Converts coordinates to Australian state code
- Uses OpenStreetMap Nominatim API (free, no key required)
- Maps state names to codes (VIC, NSW, QLD, etc.)

**`getUserStateCode(): Promise<StateCode | null>`**
- Main function to get user's state
- Caches result in localStorage for 24 hours
- Returns cached value if available and fresh
- Falls back to API if cache expired or missing

**`getCachedStateCode(): StateCode | null`**
- Returns cached state code without API call
- Used for fast initial load

**State Codes**: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT'

**Dependencies**: None (uses browser APIs and external geocoding service)

**Used By**: Pages that need default state (capture, record-results)

---

#### `lib/campaignDates.ts`
**Purpose**: Campaign date period calculation and management.

**Key Functions**:

**`calculateCampaignDates(referenceDate?: Date): CampaignDates`**
- Calculates campaign date periods based on day of week
- **Past Campaign Start**:
  - Thursday-Sunday: Monday of current week
  - Monday-Wednesday: Monday of previous week
- **Upcoming Campaign Start**:
  - Monday-Wednesday: Monday of current week
  - Thursday-Sunday: Monday of next week
- **Second Week Start**: Monday after Upcoming Campaign Start

**`formatDateForDb(date: Date): string`**
- Formats date as YYYY-MM-DD for database storage

**`formatDateReadable(date: Date): string`**
- Formats date as readable string (e.g., "Mon, Jan 15, 2026")

**`isInPastPeriod(campaignDate: Date | string): boolean`**
- Checks if date is in past campaigns period

**`isInUpcomingPeriod(campaignDate: Date | string): boolean`**
- Checks if date is in upcoming campaigns period (2-week window)

**Helper Functions**:
- `getMondayOfWeek(date: Date, weeksOffset: number)`: Gets Monday of a given week

**Dependencies**: None

**Used By**: Campaign form date dropdowns, date filtering

---

#### `lib/campaignFilter.ts`
**Purpose**: Campaign filtering logic based on user roles and state_leaders table.

**Key Functions**:

**`getUserAdminStatus(): Promise<{ admin: string | null; state: string | null }>`**
- Looks up user's admin status from `state_leaders` table
- Matches user profile name (case-insensitive) to leader name
- Returns:
  - `admin`: 'AD' (admin), 'SR' (state reporter), or null
  - `state`: State code from matched record

**`getUserMobileAndLeader(): Promise<{ mobile: string | null; leader: string | null } | null>`**
- Gets user's mobile and leader name from `state_leaders` table
- Used for filtering campaigns by mobile number
- Returns null if no match found

**`getFilteredCampaignsQuery()`**
- Returns Supabase query builder filtered by user's mobile/leader
- Used for building filtered campaign queries

**Dependencies**:
- `lib/supabaseClient.ts`
- `lib/userProfile.ts` → `getUserProfile()`
- `lib/auth.ts` → `normalizeMobile()`, `normalizeName()`

**Used By**: Main dashboard, record-results pages

---

#### `lib/campaignLog.ts`
**Purpose**: Change logging system for campaign modifications.

**Key Functions**:

**`logCampaignChange(campaignId, changeType, oldData, newData): Promise<void>`**
- Logs campaign changes to `campaign_changes_log` table
- Automatically skips logging for admin routes
- Checks if logging is enabled via `appSettings`
- Determines changed fields for UPDATE operations
- Logs asynchronously (doesn't block main operation)

**`fetchCampaignData(campaignId): Promise<Record<string, any> | null>`**
- Fetches current campaign data before update
- Used to get old data for logging UPDATE operations

**Change Types**: 'INSERT', 'UPDATE', 'DELETE'

**Logged Information**:
- Campaign ID
- User ID, name, email
- Change type
- Old data (for UPDATE/DELETE)
- New data (for INSERT/UPDATE)
- Changed fields array (for UPDATE)

**Dependencies**:
- `lib/supabaseClient.ts`
- `lib/auth.ts` → `getCurrentUser()`
- `lib/userProfile.ts` → `getUserProfile()`
- `lib/appSettings.ts` → `isCampaignLoggingEnabled()`

**Used By**: Campaign create, update, delete operations

---

#### `lib/appSettings.ts`
**Purpose**: Application settings management from `app_settings` table.

**Key Functions**:

**`getSetting(key: string): Promise<string | null>`**
- Gets a setting value by key
- Returns null if setting doesn't exist

**`getBooleanSetting(key: string, defaultValue?: boolean): Promise<boolean>`**
- Gets a boolean setting value
- Returns true if value is 'true', false otherwise
- Uses default value if setting not found

**`setSetting(key: string, value: string, description?: string): Promise<void>`**
- Creates or updates a setting
- Uses `setting_key` as conflict key

**`setBooleanSetting(key: string, value: boolean, description?: string): Promise<void>`**
- Sets a boolean setting value
- Converts boolean to 'true'/'false' string

**`isCampaignLoggingEnabled(): Promise<boolean>`**
- Checks if campaign logging is enabled
- Defaults to true if setting not found

**`setCampaignLoggingEnabled(enabled: boolean): Promise<void>`**
- Enables or disables campaign logging

**Dependencies**:
- `lib/supabaseClient.ts`

**Used By**: `lib/campaignLog.ts` for checking if logging is enabled

---

#### `lib/stateColors.ts`
**Purpose**: State-based color coding for UI elements.

**Key Functions**:

**`getStateColor(state: string): { bg: string; text: string }`**
- Returns Tailwind CSS classes for background and text colors
- Maps Australian states to color schemes:
  - NSW: Gray
  - QLD: Red
  - SA: Green
  - VIC: Orange
  - WA: Purple
  - ACT: Blue
  - TAS: Amber
  - NT: Slate
- Returns default gray if state not found

**Dependencies**: None

**Used By**: Main dashboard for color-coding campaign cards by state

---

#### `lib/userProfile.ts`
**Purpose**: User profile management.

**Key Functions**:

**`getUserProfile(): Promise<UserProfile | null>`**
- Gets current user's profile from `user_profiles` table
- Returns null if profile doesn't exist

**`upsertUserProfile(profile): Promise<UserProfile>`**
- Creates or updates user profile
- Uses `user_id` as conflict key

**`updateUserProfile(updates): Promise<UserProfile>`**
- Updates specific fields in user profile

**Profile Fields**:
- `name`: User's first name
- `state`: User's state code
- `regular_place`: User's regular campaign place
- `regular_time`: User's regular campaign time

**Dependencies**:
- `lib/supabaseClient.ts`
- `lib/auth.ts` → `getCurrentUser()`

**Used By**: Authentication, profile management, filtering

---

### `/components` Directory

#### `components/MobileLayout.tsx`
**Purpose**: Mobile-optimized layout wrapper with bottom navigation.

**Features**:
- Sticky header with app title and sign-out button
- Bottom navigation bar with:
  - Home (`/app`)
  - Campaigns (`/results`)
  - Admin (`/admin`)
- Responsive design with dark mode support
- Fixed bottom nav (doesn't scroll)

**Props**:
- `children`: ReactNode to render as main content

**Dependencies**:
- `lib/auth.ts` → `signOut()`
- Next.js `usePathname()` for active route highlighting

**Used By**: All authenticated pages

---

#### `components/CampaignForm.tsx`
**Purpose**: Reusable form component for creating/editing campaigns.

**Features**:
- Date dropdown (2-week period starting on calculated Monday)
- State dropdown (Australian states)
- Place dropdown (filtered by selected state from `state_places` table)
- Time dropdown (half-hour intervals, 8:00 AM - 9:00 PM)
- Leader dropdown (filtered by selected state from `state_leaders` table)
- Mobile input (optional, auto-populated when leader selected)
- BOTJ dropdown (Yes/No)

**Props**:
- `onSubmit`: Callback function with form data
- `initialData`: Optional initial form values
- `submitLabel`: Custom submit button text

**State Management**:
- `formData`: Current form values
- `places`: Available places for selected state
- `leaders`: Available leaders for selected state
- `availableDates`: Calculated date options
- `timeOptions`: Time slot options

**Smart Features**:
- Auto-clears place/leader when state changes
- Auto-populates mobile when leader selected (from `state_leaders`)
- Validates place/leader exist in filtered lists

**Dependencies**:
- `lib/supabaseClient.ts` for fetching places/leaders
- `lib/campaignDates.ts` for date calculations

**Used By**: `/capture`, `/record-results` pages

---

### `/contexts` Directory

#### `contexts/CampaignDatesContext.tsx`
**Purpose**: React Context provider for campaign date periods.

**Features**:
- Provides campaign dates to all child components
- Auto-refreshes dates every hour
- Calculates dates on mount

**Context Value**:
- `dates`: Current `CampaignDates` object
- `refreshDates()`: Function to manually refresh dates

**Hook**: `useCampaignDates()` - Access campaign dates in components

**Dependencies**:
- `lib/campaignDates.ts` → `calculateCampaignDates()`

**Used By**: Main dashboard, date-dependent components

---

## Data Flow

### Authentication Flow

```
1. User enters mobile + first name on /login
2. signInWithMobileAndName() called
3. validateStateLeader() checks state_leaders table
4. If match found:
   - Create anonymous Supabase session
   - Create/update user_profiles record
   - Grant admin role if admin = 'AD'
5. Redirect to /app
```

### Campaign Creation Flow

```
1. User fills CampaignForm
2. Form validates all required fields
3. handleSubmit() called
4. Get user's mobile from state_leaders (if not provided)
5. Insert campaign into campaigns table
6. logCampaignChange() logs INSERT operation
7. Redirect to /app with success message
```

### Campaign Filtering Flow

```
1. User loads /app
2. getUserAdminStatus() determines user role:
   - AD: No filter
   - SR: Filter by state
   - Regular: Filter by leader name
3. Query campaigns from Supabase
4. For regular users: Additional mobile number filtering
5. Apply state filter (if admin)
6. Apply date filter (today/past/upcoming)
7. Group by date → state → place
8. Render campaign list
```

### Campaign Update Flow

```
1. User clicks Edit on campaign
2. handleEdit() loads campaign data
3. Fetch places/leaders for campaign's state
4. Enter inline editing mode
5. User modifies fields
6. handleSaveInlineEdit() called
7. fetchCampaignData() gets old data
8. Update campaign in database
9. logCampaignChange() logs UPDATE with changed fields
10. Reload campaigns list
```

---

## Key Concepts

### Admin Status Levels

1. **AD (Administrator)**
   - Full access to all campaigns
   - Can manage state_places and state_leaders
   - Can generate reports and slides
   - No filtering applied

2. **SR (State Reporter)**
   - Access to all campaigns in their state
   - Can verify campaigns with `sr_ok` checkbox
   - Filtered by state from `state_leaders` table

3. **Regular User (Team Leader)**
   - Access only to campaigns matching their leader name AND mobile
   - Can verify campaigns with `tl_ok` checkbox
   - Filtered by leader name and mobile number

### Campaign Verification

- **tl_ok**: Team Leader verification checkbox
  - Shown to regular users and admins
  - Hidden for SR users
  - Only shown for future campaigns (unless admin)

- **sr_ok**: State Reporter verification checkbox
  - Shown to SR users and admins
  - Only shown for future campaigns (unless admin)

### Date Filtering

- **Today**: Campaigns with date = today
- **Past**: Campaigns with date < today
- **Upcoming**: Campaigns with date > today

Default filter:
- AD/SR users: 'upcoming'
- Regular users: 'today'

### Mobile Number Normalization

Mobile numbers are normalized for consistent matching:
- Removes spaces, dashes, parentheses
- Handles country codes (+61)
- Adds leading 0 for Australian numbers if missing
- Example: "+61 0429 028 464" → "0429028464"

### Name Normalization

Names are normalized for case-insensitive matching:
- Trims whitespace
- Converts to lowercase
- Used for matching user names to leader names

---

## Database Schema

### Tables

#### `campaigns`
Primary table storing campaign records.

**Fields**:
- `id` (UUID, PK)
- `date` (DATE, NOT NULL)
- `state` (TEXT, NOT NULL)
- `place` (TEXT, NOT NULL)
- `time` (TIME, NOT NULL)
- `leader` (TEXT, NOT NULL)
- `mobile` (TEXT, nullable)
- `botj` (TEXT, default 'No')
- `tl_ok` (BOOLEAN, default false)
- `sr_ok` (BOOLEAN, default false)
- `user_id` (UUID, FK to auth.users)
- `created_at` (TIMESTAMP)

**Indexes**:
- `idx_campaigns_mobile_leader` on (mobile, leader)

#### `results`
Stores campaign results (people presented to).

**Fields**:
- `id` (UUID, PK)
- `campaign_id` (UUID, FK to campaigns, CASCADE DELETE)
- `first_name` (TEXT, NOT NULL)
- `category_code` (TEXT, CHECK: 'P', 'F', 'SP', 'IR')
- `user_id` (UUID, FK to auth.users)
- `created_at` (TIMESTAMP)

**Constraints**:
- UNIQUE(campaign_id, first_name, category_code)

**Indexes**:
- `idx_results_campaign_id`
- `idx_results_user_id`

#### `state_places`
Lookup table for valid state-place combinations.

**Fields**:
- `id` (UUID, PK)
- `state` (TEXT, NOT NULL)
- `place` (TEXT, NOT NULL)
- `created_at` (TIMESTAMP)

**Constraints**:
- UNIQUE(state, place)

**Indexes**:
- `idx_state_places_state`
- `idx_state_places_place`

#### `state_leaders`
Lookup table for state leaders with mobile numbers and admin status.

**Fields**:
- `id` (UUID, PK)
- `state` (TEXT, NOT NULL)
- `leader` (TEXT, NOT NULL)
- `mobile` (TEXT, nullable)
- `admin` (TEXT, nullable) - 'AD' for admin, 'SR' for state reporter
- `created_at` (TIMESTAMP)

**Constraints**:
- UNIQUE(state, leader)

**Indexes**:
- `idx_state_leaders_state`
- `idx_state_leaders_leader`

#### `user_profiles`
Stores additional user information.

**Fields**:
- `id` (UUID, PK)
- `user_id` (UUID, FK to auth.users, UNIQUE, CASCADE DELETE)
- `name` (TEXT, nullable)
- `state` (TEXT, nullable)
- `regular_place` (TEXT, nullable)
- `regular_time` (TEXT, nullable)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP, auto-updated)

**Indexes**:
- `idx_user_profiles_user_id`
- `idx_user_profiles_state`

#### `user_roles`
Stores user roles for permission management.

**Fields**:
- `id` (UUID, PK)
- `user_id` (UUID, FK to auth.users, UNIQUE)
- `role` (TEXT, CHECK: 'admin', 'user', 'viewer')
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

**Indexes**:
- `idx_user_roles_user_id`

#### `campaign_changes_log`
Logs all campaign changes for audit trail.

**Fields**:
- `id` (UUID, PK)
- `campaign_id` (UUID, FK to campaigns, nullable)
- `user_id` (UUID, FK to auth.users)
- `change_type` (TEXT: 'INSERT', 'UPDATE', 'DELETE')
- `old_data` (JSONB, nullable)
- `new_data` (JSONB, nullable)
- `changed_fields` (TEXT[], nullable)
- `user_email` (TEXT, nullable)
- `user_name` (TEXT, nullable)
- `created_at` (TIMESTAMP)

---

## Authentication & Authorization

### Authentication Method

The app uses **anonymous authentication** via Supabase:
- Users sign in with mobile number + first name
- Credentials validated against `state_leaders` table
- Anonymous session created (no email required)
- Session persisted in localStorage

### Authorization Levels

1. **Public Routes**: `/login`, `/` (redirect)
2. **Authenticated Routes**: All `/app/*` routes
3. **Admin Routes**: `/admin/*` (requires `ADMIN_ACCESS` permission)

### Permission Checking

- `hasPermission()`: Checks if user has specific permission
- `requirePermission()`: Throws error if permission denied
- Used in:
  - Admin pages (check `ADMIN_ACCESS`)
  - Protected actions (create, edit, delete)

### Admin Status Determination

Admin status is determined from `state_leaders` table:
1. Get user profile (name, state)
2. Look up matching leader in `state_leaders` by name (case-insensitive) and state
3. Check `admin` field:
   - 'AD' → Full admin access
   - 'SR' → State reporter access
   - null/empty → Regular user

---

## Common Patterns

### Error Handling

```typescript
try {
  const result = await someAsyncOperation();
} catch (error: any) {
  setError(error.message || 'Operation failed');
  console.error('Error:', error);
}
```

### Loading States

```typescript
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  async function loadData() {
    try {
      setIsLoading(true);
      // ... load data
    } finally {
      setIsLoading(false);
    }
  }
  loadData();
}, []);
```

### Authentication Guards

```typescript
useEffect(() => {
  async function checkAuth() {
    const user = await getCurrentUser();
    if (!user) {
      router.push('/login');
    }
  }
  checkAuth();
}, [router]);
```

### Permission Guards

```typescript
const isAdmin = await hasPermission(Permission.ADMIN_ACCESS);
if (!isAdmin) {
  router.push('/app');
  return;
}
```

### Form Submission Pattern

```typescript
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();
  setError(null);
  setIsSubmitting(true);
  
  try {
    await onSubmit(formData);
    // Success handling
  } catch (err: any) {
    setError(err.message || 'Failed to submit');
  } finally {
    setIsSubmitting(false);
  }
};
```

### Change Logging Pattern

```typescript
// Before update
const oldData = await fetchCampaignData(campaignId);

// Perform update
await supabase.from('campaigns').update(newData).eq('id', campaignId);

// Log change (async, non-blocking)
logCampaignChange(campaignId, 'UPDATE', oldData, newData);
```

---

## Maintenance Guide

### Adding a New Page

1. Create page file in `/app/[route]/page.tsx`
2. Add authentication check
3. Wrap in `MobileLayout` if needed
4. Add route to `MobileLayout` navigation if appropriate

### Adding a New Permission

1. Add to `Permission` enum in `lib/permissions.ts`
2. Add to appropriate role in `rolePermissions` object
3. Use `hasPermission()` or `requirePermission()` in code

### Adding a New Database Field

1. Add field to table (via migration or SQL)
2. Update TypeScript interfaces
3. Update forms/components that use the field
4. Update change logging if needed

### Debugging Authentication Issues

1. Check `state_leaders` table for matching record
2. Verify mobile number normalization
3. Check name matching (case-insensitive)
4. Verify `user_profiles` record exists
5. Check browser console for errors

### Debugging Filtering Issues

1. Check `getUserAdminStatus()` return value
2. Verify `getUserMobileAndLeader()` returns correct data
3. Check mobile number normalization
4. Verify state code normalization (uppercase)
5. Check Supabase query filters

---

## Conclusion

This documentation provides a comprehensive overview of the Campaign Management App's architecture, modules, and patterns. For specific implementation details, refer to the source code and inline comments.

**Key Takeaways**:
- Authentication is anonymous-based with mobile + name validation
- Admin status comes from `state_leaders` table
- Campaign filtering is role-based (AD/SR/Regular)
- All changes are logged to `campaign_changes_log`
- Mobile-first design with responsive components
- Date periods are calculated dynamically based on day of week

For questions or clarifications, refer to the code comments or contact the development team.
