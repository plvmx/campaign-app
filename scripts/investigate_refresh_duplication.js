/* Investigate why a manual weekly refresh created 13 unexpected new records
 * shortly after an automatic refresh. Reads weekly_refresh_log history and
 * inspects campaigns created around that time via the service role. */
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
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    console.error('ERROR', pathAndQuery, res.status, await res.text());
    return [];
  }
  return res.json();
}

(async () => {
  console.log('=== weekly_refresh_log (last 10) ===');
  const logs = await rest('weekly_refresh_log?select=*&order=completed_at.desc&limit=10');
  console.table(logs);

  console.log('\n=== campaigns created via RUL source, most recent 40, with created_at if present ===');
  const rul = await rest('campaigns?select=id,date,state,place,site,time,leader,source,created_at&source=eq.RUL&order=created_at.desc&limit=40');
  console.table(rul);
})();
