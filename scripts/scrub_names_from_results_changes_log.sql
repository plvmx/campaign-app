-- One-off: remove every recorded first name already stored in results_changes_log.
--
-- lib/resultsLog.ts stopped logging names (category codes only) so that a
-- recorded first name is never kept beyond the campaign week it belongs to —
-- see the notice on /public/campaign-results. This scrubs the rows written
-- before that change, rewriting each JSONB array element from
-- { first_name, category_code } to { category_code }. Row counts, timestamps,
-- status, and per-category counts are all preserved.
--
-- Irreversible. Safe to re-run (already-scrubbed rows are left untouched).
-- Run in the Supabase SQL Editor AFTER the app change is deployed, otherwise
-- saves made in between will log names again.

UPDATE results_changes_log
SET
  attempted_upserts = (
    SELECT COALESCE(jsonb_agg(elem - 'first_name'), '[]'::jsonb)
    FROM jsonb_array_elements(attempted_upserts) AS elem
  ),
  attempted_deletes = (
    SELECT COALESCE(jsonb_agg(elem - 'first_name'), '[]'::jsonb)
    FROM jsonb_array_elements(attempted_deletes) AS elem
  )
WHERE jsonb_typeof(attempted_upserts) = 'array'
  AND jsonb_typeof(attempted_deletes) = 'array'
  AND (attempted_upserts @? '$[*].first_name' OR attempted_deletes @? '$[*].first_name');

-- Verify: should return 0.
SELECT count(*) AS rows_still_containing_names
FROM results_changes_log
WHERE attempted_upserts @? '$[*].first_name' OR attempted_deletes @? '$[*].first_name';
