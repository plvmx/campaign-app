# Database backup and restore

Weekly backups run automatically **every Sunday at 06:00 UTC** via GitHub Actions. Backups are pushed
straight to the private [plvmx/campaign-app-backups](https://github.com/plvmx/campaign-app-backups)
repo — **not** uploaded as a GitHub Actions artifact on this repo. Public-repo Actions artifacts are
downloadable by anyone with no repo access required, so keeping backups in a dedicated private repo
means they stay protected even if `campaign-app` itself is ever made public.

You can also run a backup manually or restore from a backup file.

## One-time setup

### 1. Add the database URL as a GitHub secret

**Use the Session (pooler) connection, not Direct.** GitHub’s runners don’t support IPv6, and Supabase’s Direct connection is IPv6-only, so the backup would fail with “Network unreachable”. The Session pooler works over IPv4.

1. In **Supabase**: open your project, then click the **Connect** button at the top of the dashboard.
2. In the Connect panel, select **Session** (or “Session mode” / pooler), **not** Direct or Transaction. Copy the **URI** and replace `[YOUR-PASSWORD]` with your database password. It looks like:
   `postgresql://postgres.xxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
3. In **GitHub**: repo → **Settings** → **Secrets and variables** → **Actions**.
4. **New repository secret**: name `SUPABASE_DB_URL`, value = the full URI (including your password).

### 2. Add a token so the workflow can push to campaign-app-backups

The backup job needs permission to push to the separate private `campaign-app-backups` repo — the
default `GITHUB_TOKEN` only has access to the repo the workflow runs in, so a personal access token
is required for this cross-repo push.

1. On GitHub: **Settings** (your account, not the repo) → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner**: your account. **Repository access**: "Only select repositories" → `campaign-app-backups` only (do not grant access to `campaign-app` itself — this token only needs to write backups).
3. **Permissions** → **Repository permissions** → **Contents**: **Read and write**. Leave everything else as "No access".
4. Generate the token and copy it.
5. In `campaign-app`'s repo settings → **Secrets and variables** → **Actions** → **New repository secret**: name `BACKUP_REPO_TOKEN`, value = the token.
   - Prefer running `gh secret set BACKUP_REPO_TOKEN --repo plvmx/campaign-app` in your own terminal (it reads the token from stdin/prompt, so it never appears in shell history or anywhere else) rather than pasting the token value into any chat or document.

After both secrets are set, the scheduled workflow will run every Sunday and push the backup straight
to `campaign-app-backups`.

### 3. (Optional) Change backup time

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
   - From the private [campaign-app-backups](https://github.com/plvmx/campaign-app-backups) repo: `backups/backup-YYYY-MM-DD.sql.gz`.
   - Or use a backup file you created locally.
2. Decompress and restore (replace the connection string with your Supabase Direct URI):

```bash
gunzip -c backup-2025-02-09.sql.gz | psql "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres" -f -
```

To restore into a **new** Supabase project (e.g. after a disaster), create the project first, then use that project’s Direct connection URI in the `psql` command above.

**Note:** Backups are created with `--no-owner --no-acl`, so restored objects are owned by the user you connect as (usually `postgres`), which is what Supabase expects.

## Retention

- Backups accumulate indefinitely as commits in `campaign-app-backups` (no automatic pruning yet). At roughly one ~1MB file per week, that's ~50MB/year — not a practical concern for a long time, but worth revisiting if that repo grows large.
