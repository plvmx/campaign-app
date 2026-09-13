// Supabase adapter — implements lib/registryPipeline's DbPort against the
// staging.* / registry.* schemas (scripts/create_registry_pipeline_schema.sql),
// using the service role client (the only role permitted to touch these
// tables directly — see that script's REVOKE statements).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getErrorMessage } from '../../../lib/errorUtils.ts';
import type { DbPort, StagingEventRow } from '../../../lib/registryPipeline/ports.ts';
import type { KnownSourceTag } from '../../../lib/registryPipeline/types.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function createServiceClient(): SupabaseClient {
  // Supabase auto-injects these into every Edge Function's environment —
  // no separate secret needs to be set for them.
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

function assertNoError(error: { message: string; code?: string; details?: string; hint?: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${getErrorMessage(error)}`);
}

export function createDb(client: SupabaseClient = createServiceClient()): DbPort {
  return {
    async startSyncLog() {
      const { data, error } = await client
        .schema('registry')
        .from('sync_log')
        .insert({ run_type: 'sync', started_at: new Date().toISOString() })
        .select('id')
        .single();
      assertNoError(error, 'startSyncLog');
      return (data as { id: number }).id;
    },

    async getLastCompletedSyncTimestamp() {
      // status = 'success' only, NOT `completed_at IS NOT NULL` — failSyncLog
      // also sets completed_at (on any thrown error), so that check alone
      // let a failed run's timestamp masquerade as a trustworthy incremental
      // cursor. Confirmed via live data 2026-09-01: the cursor was silently
      // stuck on a 2026-08-27 failure this whole backfill. See
      // scripts/add_status_to_sync_log.sql and docs/registry-pipeline/OPERATIONS.md.
      const { data, error } = await client
        .schema('registry')
        .from('sync_log')
        .select('completed_at')
        .eq('run_type', 'sync')
        .eq('status', 'success')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assertNoError(error, 'getLastCompletedSyncTimestamp');
      return (data as { completed_at: string } | null)?.completed_at ?? null;
    },

    async insertStagingEvent(input) {
      const { error } = await client.schema('staging').from('ac_events').insert({
        source_list_id: input.sourceListId,
        ac_contact_id: input.acContactId,
        event_type: input.eventType,
        raw_payload: input.rawPayload,
      });
      assertNoError(error, 'insertStagingEvent');
    },

    async completeSyncLog(id, result) {
      const { error } = await client
        .schema('registry')
        .from('sync_log')
        .update({
          completed_at: new Date().toISOString(),
          records_in: result.recordsIn,
          records_upserted: result.recordsUpserted,
          errors: result.errors,
          status: 'success',
        })
        .eq('id', id);
      assertNoError(error, 'completeSyncLog');
    },

    async failSyncLog(id, errorMessage) {
      const { error } = await client
        .schema('registry')
        .from('sync_log')
        .update({ completed_at: new Date().toISOString(), errors: 1, notes: errorMessage, status: 'failed' })
        .eq('id', id);
      assertNoError(error, 'failSyncLog');
    },

    async getPendingStagingEvents(limit) {
      const { data, error } = await client
        .schema('staging')
        .from('ac_events')
        .select('id, raw_payload')
        .is('processed_at', null)
        .order('id', { ascending: true })
        .limit(limit);
      assertNoError(error, 'getPendingStagingEvents');
      return (data ?? []) as StagingEventRow[];
    },

    async getKnownSourceTags() {
      const { data, error } = await client.schema('registry').from('known_source_tags').select('*');
      assertNoError(error, 'getKnownSourceTags');
      return (data ?? []) as KnownSourceTag[];
    },

    // Keyed on email, not ac_contact_id, since 2026-09-07 (see
    // docs/registry-pipeline/OPERATIONS.md's identity-redesign entry):
    // the same real person can plausibly hold more than one AC contact
    // ID across different registration forms, so ac_contact_id was never
    // a reliable one-row-per-person guarantee. email is lower-cased here
    // because the unique index it conflicts on (idx_registrants_email_unique,
    // see scripts/prepare_registrants_for_csv_reload.sql) is a plain
    // column index, not an expression index on lower(email) — PostgREST's
    // upsert on_conflict parameter can only target a real column, so
    // case-insensitivity is enforced by always writing lower-case here
    // instead.
    async upsertRegistrant(input) {
      const email = input.email ? input.email.trim().toLowerCase() : null;
      const fields = {
        ac_contact_id: input.acContactId,
        first_name: input.firstName,
        last_name: input.lastName,
        email,
        phone: input.phone,
        phone_raw: input.phoneRaw,
        state: input.state,
        postcode: input.postcode,
        registered_at: input.registeredAt,
        interested_in_training: input.interestedInTraining,
        church_leader: input.churchLeader,
        church_name: input.churchName,
        last_updated_at: new Date().toISOString(),
      };

      if (email) {
        // Existence pre-check, purely to answer "did this INSERT a new row
        // or update one that was already there" for the caller (transform.ts
        // uses this to decide whether to send the WhatsApp invite email —
        // without it, every subsequent re-sync of an existing registrant
        // would look identical to their first-ever registration). Not
        // needed for correctness of the upsert itself, which would work
        // the same either way.
        const { data: existing, error: findError } = await client
          .schema('registry')
          .from('registrants')
          .select('id')
          .eq('email', email)
          .maybeSingle();
        assertNoError(findError, 'upsertRegistrant (email existence check)');

        const { data, error } = await client
          .schema('registry')
          .from('registrants')
          .upsert(fields, { onConflict: 'email' })
          .select('id')
          .single();
        assertNoError(error, 'upsertRegistrant');
        return { id: (data as { id: string }).id, isNew: !existing };
      }

      // No email on this contact — fall back to matching by phone, but
      // only against other email-less registrants (a bare phone number
      // is too weak a key to match against an email-bearing row;
      // households share phones — see OPERATIONS.md). No unique index
      // enforces this at the DB level, so it's an explicit look-up then
      // write rather than a single atomic upsert.
      if (input.phone) {
        const { data: existing, error: findError } = await client
          .schema('registry')
          .from('registrants')
          .select('id')
          .is('email', null)
          .eq('phone', input.phone)
          .maybeSingle();
        assertNoError(findError, 'upsertRegistrant (phone lookup)');

        if (existing) {
          const { data, error } = await client
            .schema('registry')
            .from('registrants')
            .update(fields)
            .eq('id', (existing as { id: string }).id)
            .select('id')
            .single();
          assertNoError(error, 'upsertRegistrant (phone match update)');
          return { id: (data as { id: string }).id, isNew: false };
        }
      }

      const { data, error } = await client
        .schema('registry')
        .from('registrants')
        .insert(fields)
        .select('id')
        .single();
      assertNoError(error, 'upsertRegistrant (insert, no email/phone match)');
      return { id: (data as { id: string }).id, isNew: true };
    },

    async insertRegistrationEvent(input) {
      const { error } = await client.schema('registry').from('registration_events').insert({
        registrant_id: input.registrantId,
        source_list_id: input.sourceListId,
        source_tag: input.sourceTag,
        event_type: input.eventType,
        raw_staging_id: input.rawStagingId,
      });
      assertNoError(error, 'insertRegistrationEvent');
    },

    async markStagingProcessed(id, skipReason) {
      const { error } = await client
        .schema('staging')
        .from('ac_events')
        .update({ processed_at: new Date().toISOString(), processing_error: skipReason })
        .eq('id', id);
      assertNoError(error, 'markStagingProcessed');
    },

    async markStagingError(id, errorMessage) {
      const { error } = await client
        .schema('staging')
        .from('ac_events')
        .update({ processing_error: errorMessage })
        .eq('id', id);
      assertNoError(error, 'markStagingError');
    },

    async getSyncProgress(key) {
      const { data, error } = await client
        .schema('registry')
        .from('sync_progress')
        .select('next_offset')
        .eq('list_id', key)
        .maybeSingle();
      assertNoError(error, 'getSyncProgress');
      return (data as { next_offset: number } | null)?.next_offset ?? null;
    },

    async saveSyncProgress(key, nextOffset) {
      const { error } = await client
        .schema('registry')
        .from('sync_progress')
        .upsert({ list_id: key, next_offset: nextOffset, updated_at: new Date().toISOString() }, { onConflict: 'list_id' });
      assertNoError(error, 'saveSyncProgress');
    },

    async clearSyncProgress(key) {
      const { error } = await client.schema('registry').from('sync_progress').delete().eq('list_id', key);
      assertNoError(error, 'clearSyncProgress');
    },

    async recordPartialSync(id, counts) {
      const { error } = await client
        .schema('registry')
        .from('sync_log')
        .update({
          records_in: counts.recordsIn,
          records_upserted: counts.recordsUpserted,
          errors: counts.errors,
          notes: 'partial: time budget reached, resuming next invocation',
          status: 'partial',
        })
        .eq('id', id);
      assertNoError(error, 'recordPartialSync');
    },

    async getWhatsAppGroupLink(groupKey) {
      const { data, error } = await client
        .schema('registry')
        .from('whatsapp_group_links')
        .select('invite_url')
        .eq('group_key', groupKey)
        .maybeSingle();
      assertNoError(error, 'getWhatsAppGroupLink');
      return (data as { invite_url: string } | null)?.invite_url ?? null;
    },
  };
}
