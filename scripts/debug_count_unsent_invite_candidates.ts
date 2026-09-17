/**
 * One-off diagnostic — sizes up how many registrants have never received
 * the WhatsApp invite email (any registrant with an email, not
 * unsubscribed, with no 'sent' row in registry.whatsapp_invite_log),
 * before deciding scope for a manual backfill-send tool. Not part of the app.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const { count: totalWithEmail, error: e1 } = await supabase
    .schema('registry').from('registrants').select('id', { count: 'exact', head: true })
    .not('email', 'is', null);
  if (e1) throw e1;

  const { count: totalWithEmailNotUnsub, error: e2 } = await supabase
    .schema('registry').from('registrants').select('id', { count: 'exact', head: true })
    .not('email', 'is', null)
    .neq('unsubscribed', 'Yes')
    .is('unsubscribed', null); // registrants doesn't support OR easily via builder chaining; see note below
  if (e2) console.log('(combined filter query failed, will do it differently):', e2.message);

  const { count: unsubCount, error: e3 } = await supabase
    .schema('registry').from('registrants').select('id', { count: 'exact', head: true })
    .eq('unsubscribed', 'Yes');
  if (e3) throw e3;

  const { count: sentCount, error: e4 } = await supabase
    .schema('registry').from('whatsapp_invite_log').select('id', { count: 'exact', head: true })
    .eq('status', 'sent');
  if (e4) throw e4;

  // Earliest/oldest registered_at on file, for context on how far back "everyone" would reach.
  const { data: oldest, error: e5 } = await supabase
    .schema('registry').from('registrants').select('registered_at').not('registered_at', 'is', null)
    .order('registered_at', { ascending: true }).limit(1).maybeSingle();
  if (e5) throw e5;

  console.log('Registrants with an email on file:', totalWithEmail);
  console.log('Of those, flagged unsubscribed:', unsubCount);
  console.log('Rows already logged as "sent" in whatsapp_invite_log:', sentCount);
  console.log('Oldest registered_at on file:', oldest?.registered_at);
  console.log('\n=> Rough upper bound of "never got the invite" population:', (totalWithEmail ?? 0) - (unsubCount ?? 0) - (sentCount ?? 0));
}

main().catch((err) => { console.error(err); process.exit(1); });
