# Database backup and restore

Weekly backups run automatically **every Sunday at 06:00 UTC** via GitHub Actions. You can also run a backup manually or restore from a backup file.

## One-time setup

### 1. Add the database URL as a GitHub secret

**Use the Session (pooler) connection, not Direct.** GitHub’s runners don’t support IPv6, and Supabase’s Direct connection is IPv6-only, so the backup would fail with “Network unreachable”. The Session pooler works over IPv4.

1. In **Supabase**: open your project, then click the **Connect** button at the top of the dashboard.
2. In the Connect panel, select **Session** (or “Session mode” / pooler), **not** Direct or Transaction. Copy the **URI** and replace `[YOUR-PASSWORD]` with your database password. It looks like:
   `postgresql://postgres.xxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
3. In **GitHub**: repo → **Settings** → **Secrets and variables** → **Actions**.
4. **New repository secret**: name `SUPABASE_DB_URL`, value = the full URI (including your password).

After this, the scheduled workflow will run every Sunday and produce a backup artifact.

### 2. (Optional) Change backup time

Edit `.github/workflows/backup-database.yml` and change the cron expression:

- `0 6 * * 0` = Sunday 06:00 UTC  
- `0 8 * * 0` = Sunday 08:00 UTC  
- [Cron format](https://crontab.guru): minute hour day-of-month month day-of-week

## Running a backup manually

**From your machine** (requires PostgreSQL client tools, e.g. `brew install libpq` on macOS):

Use the same Session pooler URI as in the GitHub secret, or the Direct URI if your network has IPv6:

```bash
export SUPABASE_DB_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres'
./scripts/backup-database.sh
# Writes backup-YYYY-MM-DD.sql.gz to current directory
```

**From GitHub**: **Actions → Weekly database backup → Run workflow**.

## Restoring from a backup

1. Get the backup file:
   - From GitHub: **Actions** → open a completed backup run → **Artifacts** → download the backup.
   - Or use a backup file you created locally.
2. Decompress and restore (replace the connection string with your Supabase Direct URI):

```bash
gunzip -c backup-2025-02-09.sql.gz | psql "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres" -f -
```

To restore into a **new** Supabase project (e.g. after a disaster), create the project first, then use that project’s Direct connection URI in the `psql` command above.

**Note:** Backups are created with `--no-owner --no-acl`, so restored objects are owned by the user you connect as (usually `postgres`), which is what Supabase expects.

## Retention

- GitHub keeps workflow artifacts for **90 days** on the free tier. For longer retention, download backups periodically or add a step to upload to your own storage (e.g. S3, Backblaze B2).
