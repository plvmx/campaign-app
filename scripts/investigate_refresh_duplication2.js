const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(pathAndQuery) {
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error('ERROR', pathAndQuery, res.status, await res.text());
    return [];
  }
  return res.json();
}

(async () => {
  console.log('=== Created in AUTO run 2026-07-19 ===');
  const auto = await rest("campaigns?select=date,state,place,site,time,leader&source=eq.RUL&created_at=gte.2026-07-19T01:00:00&created_at=lt.2026-07-19T02:00:00&order=state,place,leader");
  console.table(auto);
  console.log('count:', auto.length);

  console.log('\n=== Created in MANUAL run 2026-07-21 ===');
  const manual = await rest("campaigns?select=date,state,place,site,time,leader&source=eq.RUL&created_at=gte.2026-07-21T11:00:00&created_at=lt.2026-07-21T12:00:00&order=state,place,leader");
  console.table(manual);
  console.log('count:', manual.length);

  const key1 = (c) => `${c.state}_${c.place}_${c.site}_${c.time}_${c.leader}`;
  const autoKeys = new Set(auto.map(key1));
  console.log('\n=== Manual-run rows whose rule-slot (ignoring date) ALSO got a row in the auto run ===');
  const overlap = manual.filter((c) => autoKeys.has(key1(c)));
  console.table(overlap);
  console.log('overlap count:', overlap.length, 'of', manual.length);
})();
