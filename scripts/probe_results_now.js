const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...rest] = t.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  });
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1. Is the unique constraint actually dropped?
  const { data: existing } = await supabase.from('results').select('*').limit(1);
  if (existing && existing.length) {
    const r = existing[0];
    const { data, error } = await supabase.from('results').insert({
      campaign_id: r.campaign_id,
      first_name: r.first_name,
      category_code: r.category_code,
      user_id: r.user_id,
    }).select();
    if (error) {
      console.log('Duplicate-name INSERT still rejected:', error.code, '-', error.message);
    } else {
      console.log('Duplicate-name INSERT succeeded (constraint dropped). Cleaning up.');
      if (data && data[0]) await supabase.from('results').delete().eq('id', data[0].id);
    }
  }

  // 2. Recent successes in results_changes_log
  const { data: recent } = await supabase
    .from('results_changes_log')
    .select('status, user_name, attempted_upserts, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  console.log('\nMost recent 30 results_changes_log entries:');
  (recent || []).forEach((l) => {
    const summary = (l.attempted_upserts || []).slice(0, 3).map((u) => `${u.first_name}/${u.category_code}`).join(', ');
    const more = (l.attempted_upserts || []).length > 3 ? `+${(l.attempted_upserts || []).length - 3}` : '';
    console.log(`  ${l.created_at}  ${l.status.padEnd(7)} user=${(l.user_name || '?').padEnd(15)} [${summary}${more}] ${l.error_message || ''}`);
  });

  // 3. SUCCESS rate by day
  const { data: all } = await supabase
    .from('results_changes_log')
    .select('status, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  const buckets = {};
  (all || []).forEach((l) => {
    const day = l.created_at.slice(0, 10);
    if (!buckets[day]) buckets[day] = { s: 0, e: 0 };
    if (l.status === 'SUCCESS') buckets[day].s++; else buckets[day].e++;
  });
  console.log('\nSUCCESS vs ERROR by day:');
  Object.keys(buckets).sort().forEach((d) => {
    console.log(`  ${d}: success=${buckets[d].s}  error=${buckets[d].e}`);
  });

  // 4. Distinct errors (to confirm the "An unexpected error occurred" pattern)
  const errs = {};
  (all || []).forEach((l) => {
    if (l.status === 'ERROR') {
      const k = l.error_message || '(none)';
      errs[k] = (errs[k] || 0) + 1;
    }
  });
  console.log('\nDistinct error messages and counts:');
  Object.entries(errs).sort((a, b) => b[1] - a[1]).forEach(([m, n]) => console.log(`  ${n}x   ${m}`));
})();
