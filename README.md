# Campaign Management App

A mobile-first campaign management application built with Next.js, TypeScript, Tailwind CSS, and Supabase.

For the full architecture, page-by-page route map, database schema, testing policy, and the exact git workflow to ship a change, see **[TECHNICAL_DOCS.md](./TECHNICAL_DOCS.md)** — that document is the source of truth and is kept current; this README only covers getting a local environment running.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS v4 |
| Database | Supabase (Postgres), Row Level Security enabled |
| Auth | Supabase Anonymous Auth — sign-in is by mobile number + first name, matched against the `state_leaders` table (no passwords, no email) |
| Testing | Vitest + React Testing Library |
| Deployment | Vercel — `main` auto-deploys to production |
| Scheduled Jobs | Vercel Cron — weekly campaign refresh, Sundays 01:00 UTC |

## Getting Started

### Prerequisites

- Node.js 20+ and npm 10+
- Access to the project's Supabase credentials (ask Peter — this is an internal tool, not something you self-host from scratch)

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` in the project root:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   CRON_SECRET=any-random-string-for-local-testing
   ```

   - `SUPABASE_SERVICE_ROLE_KEY` is required for the server-side leader-lookup and cron API routes (`app/api/auth/validate-leader`, `app/api/cron/weekly-refresh`) — keep it out of anything committed.
   - `CRON_SECRET` just needs to match what you send when hitting the cron route manually in dev; it doesn't need to be the real production value.

3. Database: the schema has grown through many incremental SQL scripts in [`scripts/`](./scripts) and [`docs/migrations/`](./docs/migrations) rather than one canonical setup file. There's no supported "create every table from scratch" path — for a new environment, get a schema clone or a data export from Peter (see `/admin/backup` for exporting/restoring the admin-curated tables once you have access to a running instance). [`supabase/rls-policies.sql`](./supabase/rls-policies.sql) has the current Row Level Security policies for reference.

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

### Before Committing

```bash
npx tsc --noEmit   # type-check
npm run lint       # eslint
npm test           # vitest
npm run build      # production build
```

These are the same four checks CI runs on every push. See [TECHNICAL_DOCS.md §13, Testing Policy](./TECHNICAL_DOCS.md#13-testing-policy) for what a passing test suite doesn't tell you — every bug fix needs a regression test proven to fail on the pre-fix code, and every new `lib/`/`lib/services/` function ships with a test in the same PR.

## Auth & Roles

There's no sign-up flow and no passwords. A user signs in with a mobile number + first name, which is matched against the `state_leaders` table. Their role is resolved from that same row's `admin` column:

- `admin = 'AD'` — full admin, sees everything
- `admin = 'SR'` — state reporter, sees their own state only
- anything else — team leader, sees only their own campaigns (plus any explicitly shared with them)

Full detail in [TECHNICAL_DOCS.md §6–7](./TECHNICAL_DOCS.md#6-authentication--session-flow).

## Project Structure

```
/app        Next.js pages (App Router) — main feed, admin panel, public no-login pages, API routes
/lib        Business logic, utilities, and the database service layer (lib/services/)
/components Shared React components
/contexts   Global state (UserContext, CampaignDatesContext)
/scripts    One-off and incremental SQL/JS migration and maintenance scripts
```

See [TECHNICAL_DOCS.md §4](./TECHNICAL_DOCS.md#4-folder-structure) for the full file-by-file breakdown, and [§8](./TECHNICAL_DOCS.md#8-page-map--every-route-explained) for every route.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) — an interactive Next.js tutorial.

## Deploy on Vercel

`main` auto-deploys to production on every merge. See [CLAUDE.md](./CLAUDE.md) for the branch/PR workflow — merging to `main` always needs Peter's approval.
