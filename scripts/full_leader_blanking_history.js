const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  let all = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('campaign_changes_log')
      .select('*')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
  }
  console.log(`Total log rows fetched: ${all.length}`);

  const blanked = all.filter(r => r.new_data && (r.new_data.leader === '' || r.new_data.leader === null));
  console.log(`Total historical blank-leader edits: ${blanked.length}`);
  for (const b of blanked) {
    console.log(`\ncampaign_id=${b.campaign_id} at=${b.created_at} by=${b.user_name} place=${b.new_data.place} date=${b.new_data.date}`);
  }

  console.log('\n=== Current leader value for each affected campaign ===');
  const ids = [...new Set(blanked.map(b => b.campaign_id))];
  for (const id of ids) {
    const { data: c } = await supabase.from('campaigns').select('id, date, place, leader').eq('id', id).maybeSingle();
    console.log(`${id}: ${c ? `leader="${c.leader}" (place=${c.place}, date=${c.date})` : 'ROW NO LONGER EXISTS (deleted)'}`);
  }
})();
