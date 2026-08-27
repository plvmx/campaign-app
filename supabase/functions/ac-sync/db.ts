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
      const { data, error } = await client
        .schema('registry')
        .from('sync_log')
        .select('completed_at')
        .eq('run_type', 'sync')
        .not('completed_at', 'is', null)
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
        })
        .eq('id', id);
      assertNoError(error, 'completeSyncLog');
    },

    async failSyncLog(id, errorMessage) {
      const { error } = await client
        .schema('registry')
        .from('sync_log')
        .update({ completed_at: new Date().toISOString(), errors: 1, notes: errorMessage })
        .eq('id', id);
      assertNoError(error, 'failSyncLog');
    },

    async getPendingStagingEvents() {
      const { data, error } = await client
        .schema('staging')
        .from('ac_events')
        .select('id, raw_payload')
        .is('processed_at', null);
      assertNoError(error, 'getPendingStagingEvents');
      return (data ?? []) as StagingEventRow[];
    },

    async getKnownSourceTags() {
      const { data, error } = await client.schema('registry').from('known_source_tags').select('*');
      assertNoError(error, 'getKnownSourceTags');
      return (data ?? []) as KnownSourceTag[];
    },

    async upsertRegistrant(input) {
      const { data, error } = await client
        .schema('registry')
        .from('registrants')
        .upsert(
          {
            ac_contact_id: input.acContactId,
            full_name: input.fullName,
            email: input.email,
            phone: input.phone,
            phone_raw: input.phoneRaw,
            state: input.state,
            last_updated_at: new Date().toISOString(),
          },
          { onConflict: 'ac_contact_id' }
        )
        .select('id')
        .single();
      assertNoError(error, 'upsertRegistrant');
      return { id: (data as { id: string }).id };
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
  };
}
