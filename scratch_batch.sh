#!/bin/bash
set -a
source .env.local
set +a

LOG=/tmp/ac_sync_batch.log
: > "$LOG"

for i in $(seq 1 60); do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  resp=$(curl -s -X POST "https://vzyoxmfjlwbfqrwiirld.supabase.co/functions/v1/ac-sync" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  echo "[$ts] run $i: $resp" | tee -a "$LOG"

  # Stop early if a run reports a real error (non-200 body won't parse as expected keys)
  if ! echo "$resp" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'recordsIn' in d" 2>/dev/null; then
    echo "[$ts] run $i: UNEXPECTED RESPONSE, stopping batch" | tee -a "$LOG"
    break
  fi

  sleep 5
done
echo "batch done"
