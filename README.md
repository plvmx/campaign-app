# Campaign Management App

A mobile-friendly campaign management application built with Next.js, TypeScript, Tailwind CSS, and Supabase.

## Project Structure

```
/app
  /login              - Authentication page
  /app                - Main dashboard with upcoming campaigns
  /capture            - Create new campaigns
  /record-results     - Record campaign results (initial screen)
  /record-results/detail - Record campaign results (detail screen)
  /results            - View campaign results
  /admin              - Admin panel (requires admin permissions)
    /state-places     - Manage state-place combinations
    /state-leaders    - Manage state-leader combinations
    /generate-report  - Generate campaign results report (JPEG)
    /generate-slides  - Generate campaign slides (JPEG)
  /auth/callback      - Email confirmation callback handler

/lib
  supabaseClient.ts   - Supabase client configuration
  auth.ts             - Authentication utilities
  permissions.ts      - Permission management system
  location.ts         - Location-based state detection utilities
  campaignDates.ts    - Campaign date calculation utilities

/components
  MobileLayout.tsx    - Mobile-optimized layout with bottom navigation
  CampaignForm.tsx    - Reusable campaign creation/edit form with smart defaults

/contexts
  CampaignDatesContext.tsx - Campaign date period context provider
```

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Supabase account and project

### Setup

1. Install dependencies:

```bash
npm install
```

**Note**: This project uses `jszip` for generating ZIP files of campaign slides and `html2canvas` for report generation. These dependencies are included in the package.json.

2. Set up environment variables:

Create a `.env.local` file in the root directory with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Optional: Set admin emails (comma-separated) for development
NEXT_PUBLIC_ADMIN_EMAILS=admin@example.com,another@example.com
```

3. Configure Supabase for localhost development:

To enable email confirmation links to work with localhost, you need to add redirect URLs in your Supabase dashboard:

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **URL Configuration**
3. Add these URLs to **Redirect URLs**:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/app`
4. Add `http://localhost:3000` to **Site URL**

**Note:** Magic links work for both new and existing users. No separate sign-up process is needed - users simply enter their email and receive a magic link to sign in.

4. Set up Supabase database:

Create the `campaigns` table:

```sql
CREATE TABLE campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  state TEXT NOT NULL,
  place TEXT NOT NULL,
  time TIME NOT NULL,
  leader TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id)
);
```

Create the `results` table for recording campaign results:

```sql
CREATE TABLE results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  first_name TEXT NOT NULL,
  category_code TEXT NOT NULL CHECK (category_code IN ('P', 'F', 'SP', 'IR')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),
  UNIQUE(campaign_id, first_name, category_code)
);
```

-- Create index for faster lookups on campaign results
CREATE INDEX idx_results_campaign_id ON results(campaign_id);
CREATE INDEX idx_results_user_id ON results(user_id);
```

**Note**: The `results` table allows the same first name to be recorded against multiple category codes for the same campaign. The UNIQUE constraint ensures no duplicate name-code combinations per campaign.

Create the `state_places` lookup table:

```sql
CREATE TABLE IF NOT EXISTS state_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL,
  place TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(state, place)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_state_places_state ON state_places(state);
CREATE INDEX IF NOT EXISTS idx_state_places_place ON state_places(place);
```

To load the state_places data from the CSV file:

1. Run the SQL script to create the table (in Supabase SQL Editor):
   - Copy and paste the SQL from `scripts/create_state_places_table.sql` or run it directly

2. Load the data using the Node.js script:
   ```bash
   node scripts/load_state_places.js
   ```

   **Note**: For the data loading script, you may want to use the Supabase Service Role Key (instead of the anon key) to bypass Row Level Security policies. Add it to your `.env.local` file:
   ```
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```
   
   You can find your service role key in Supabase Dashboard → Settings → API → service_role key (keep this secret!)

Create the `state_leaders` lookup table:

```sql
CREATE TABLE IF NOT EXISTS state_leaders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL,
  leader TEXT NOT NULL,
  mobile TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(state, leader)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_state_leaders_state ON state_leaders(state);
CREATE INDEX IF NOT EXISTS idx_state_leaders_leader ON state_leaders(leader);
```

To load the state_leaders data from the CSV file:

1. Run the SQL script to create the table (in Supabase SQL Editor):
   - Copy and paste the SQL from `scripts/create_state_leaders_table.sql` or run it directly

2. Load the data using the Node.js script:
   ```bash
   node scripts/load_state_leaders.js
   ```

   **Note**: The script will normalize state codes (e.g., "Qld" → "QLD", "Vic" → "VIC") and clean mobile numbers (removes "?" and "-" values, setting them to NULL).

3. (Optional) Add last sign-in tracking and weekly refresh log: run `scripts/add_last_sign_in_and_weekly_refresh_log.sql` in the Supabase SQL Editor. This adds `last_sign_in_at` to `state_leaders` and creates the `weekly_refresh_log` table so admins can see which leaders have not signed in since the last Weekly Refresh.

**Database Relationships**:
- `campaigns.user_id` → Links campaigns to users
- `results.campaign_id` → Links results to specific campaigns (CASCADE delete)
- `results.user_id` → Tracks who recorded each result
- `user_roles.user_id` → Links user roles to authenticated users

Create the `user_roles` table for permission management:

```sql
CREATE TABLE user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
```

Create the `user_profiles` table to store additional user information:

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  name TEXT,
  state TEXT,
  regular_place TEXT,
  regular_time TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_state ON user_profiles(state);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update updated_at on row updates
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own profile
CREATE POLICY "Users can delete own profile"
  ON user_profiles FOR DELETE
  USING (auth.uid() = user_id);
```

**Note**: You can also run the SQL script from `scripts/create_user_profiles_table.sql` directly in the Supabase SQL Editor.

**To grant admin access**, you have two options:

**Option A: Via Environment Variable (Quick for Development)**
Add your email to `.env.local`:
```env
NEXT_PUBLIC_ADMIN_EMAILS=your-email@example.com
```

**Option B: Via Database (Recommended for Production)**
After signing up, run this SQL in Supabase SQL Editor (replace `YOUR_USER_EMAIL` with your actual email):
```sql
INSERT INTO user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'YOUR_USER_EMAIL'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

4. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Form Features

### Create Campaign Form (`/capture`)
- **Date**: Dropdown with 2-week period starting on calculated Monday
- **State**: Dropdown with Australian state codes (VIC, NSW, QLD, SA, WA, TAS, NT, ACT), defaults to user's location
- **Place**: Dropdown filtered by selected state, populated from `state_places` table
- **Time**: Dropdown with half-hour intervals from 8:00 AM to 9:00 PM
- **Leader**: Dropdown filtered by selected state, populated from `state_leaders` table

### Record Results Form (`/record-results`)
- Same fields as Create Campaign form
- **Date**: Defaults to current date (today)
- **State**: Defaults to user's detected location
- Navigates to detail screen on submit

## Location Detection

The app uses browser geolocation API to detect the user's location and convert it to Australian state codes:
- Automatically requests location permission on first use
- Caches state code in localStorage for 24 hours
- Falls back gracefully if location is denied or unavailable
- Uses OpenStreetMap Nominatim API for reverse geocoding (free, no API key required)

## Features

- **Mobile-First Design**: Optimized for mobile devices with a bottom navigation bar
- **Authentication**: Secure passwordless login with magic links via Supabase Auth (users receive an email link to sign in)
- **Persistent Sessions**: Users stay signed in across app sessions (sessions stored in browser localStorage)
- **Location-Based State Detection**: Automatically detects user's state (VIC, NSW, QLD, etc.) from GPS location
- **Smart Form Defaults**: 
  - State field defaults to user's detected location
  - Date field defaults to current date (with 2-week period dropdown)
  - Place dropdown filtered by selected state
  - Leader dropdown filtered by state and place
  - Time dropdown with half-hour intervals (8:00 AM - 9:00 PM)
  - Auto-population of Time and Leader when unique record found
- **Campaign Management**: 
  - Create new campaigns with validated dropdown fields
  - View upcoming campaigns on main dashboard
  - Record campaign results with category codes (P, F, SP, IR)
- **Results Dashboard**: View and analyze campaign performance
- **Campaign Slides Generation**: 
  - Generate professional JPEG slides for upcoming campaigns
  - Automatic two-week period calculation
  - Color-coded by state with formatted date headers
  - Portrait format (7.5" × 10" at 300 DPI)
  - Downloads as ZIP file with multiple slides
  - Matches format from legacy Python application
- **Campaign Results Report**: 
  - Generate comprehensive results report in landscape JPEG format
  - Customizable date range selection
  - Categorizes results by FP & SP, FP only, and PP
- **Permission System**: Role-based access control for admin features
- **Dark Mode Support**: Automatic dark mode based on system preferences

## Routes

- `/login` - Sign in with email (magic link sent to email)
- `/app` - Main dashboard showing upcoming campaigns and quick actions
- `/capture` - Create new campaigns with smart form defaults
- `/record-results` - Initial screen to select campaign for recording results
- `/record-results/detail` - Detail screen for recording campaign results (first names and category codes)
- `/results` - View all campaigns and their results
- `/admin` - Admin panel (requires admin permissions)
- `/admin/state-places` - Manage state-place combinations (requires admin permissions)
- `/admin/state-leaders` - Manage state-leader combinations with mobile numbers (requires admin permissions)
- `/admin/generate-report` - Generate campaign results report in JPEG format (requires admin permissions)
- `/admin/generate-slides` - Generate campaign slides in JPEG format for upcoming campaigns (requires admin permissions)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
