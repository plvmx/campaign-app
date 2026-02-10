#!/usr/bin/env bash
# Backup Supabase (PostgreSQL) database using pg_dump.
# Requires: SUPABASE_DB_URL (Direct connection URI from Supabase Dashboard → Settings → Database)
# Usage: ./scripts/backup-database.sh [output-file]
# If no output file is given, writes to backup-YYYY-MM-DD.sql.gz in current directory.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Error: SUPABASE_DB_URL is not set." >&2
  echo "Get the Direct connection URI from: Supabase Dashboard → Project Settings → Database → Connection string (URI)." >&2
  exit 1
fi

OUTPUT="${1:-backup-$(date +%Y-%m-%d).sql.gz}"
echo "Starting backup to $OUTPUT ..."
pg_dump "$SUPABASE_DB_URL" --no-owner --no-acl | gzip > "$OUTPUT"
echo "Backup written to $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
