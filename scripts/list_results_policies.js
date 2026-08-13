/* List the current RLS policies on the `results` table via the service role,
 * by querying pg_policies through the Supabase Studio meta API. */
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

(async () => {
  // Supabase PG meta endpoint — works with service role on hosted projects.
  const res = await fetch(`${url}/rest/v1/rpc/pg_get_policies`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  }).catch((e) => ({ ok: false, text: async () => String(e) }));
  if (res.ok) {
    const j = await res.json();
    console.log('pg_get_policies result:', JSON.stringify(j, null, 2));
  } else {
    // RPC doesn't exist — that's fine, fall through.
    console.log('pg_get_policies RPC not available:', res.status, await res.text());
  }

  // Try the platform API alternative.
  const r2 = await fetch(`${url.replace('.supabase.co', '.supabase.co')}/pg-meta/default/policies?table=results`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
  }).catch((e) => ({ ok: false, text: async () => String(e) }));
  if (r2.ok) {
    console.log('\npg-meta policies:', JSON.stringify(await r2.json(), null, 2));
  } else {
    console.log('\npg-meta endpoint not available:', r2.status, await r2.text().catch(() => ''));
  }
})();
