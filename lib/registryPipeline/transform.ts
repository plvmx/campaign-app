// Transform step of the registry pipeline. See
// docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md Section 6.2.
//
// Reads pending rows from staging.ac_events, applies the field-inclusion
// whitelist and phone normalization, resolves source attribution by tag,
// excludes anyone whose only signal is an excluded source tag
// (tagExclusion.ts — a contact with no genuine registration-funnel
// attribution, e.g. a historical bulk import), and upserts everyone else
// into registry.registrants / registry.registration_events — via the
// injected DbPort, so this has no direct database dependency.
//
// Time-budgeted like sync.ts's AC-pull loop, for the same reason: a real
// invocation against a ~180-row backlog hit Supabase's hard per-invocation
// resource limit (WORKER_RESOURCE_LIMIT / HTTP 546) processing this loop
// alone, each row costing a couple of sequential DB round-trips. Unlike
// the AC-pull loop, this needs no separate persisted resume cursor: a row
// is only ever marked done (markStagingProcessed/markStagingError) once
// its own work has actually completed, so stopping partway through simply
// leaves the rest with processed_at still null — getPendingStagingEvents()
// naturally picks them back up next time, in whatever order the query
// returns them.

import { getErrorMessage } from '../errorUtils.ts';
import { mapAcFields } from './fieldMap.ts';
import { isActiveListStatus } from './listFilter.ts';
import { normalizePhone } from './phone.ts';
import type { DbPort } from './ports.ts';
import { matchSourceTag } from './sourceAttribution.ts';
import { isExcludedSourceOnly } from './tagExclusion.ts';

/**
 * Caps the initial query too, so a large backlog is never pulled into
 * memory in one go. Halved from 200 to 100 on the Free plan, alongside the
 * tighter time budgets in sync.ts, after a real invocation hit a hard
 * WORKER_RESOURCE_LIMIT kill on roughly 1 in 20 attempts at the looser
 * settings. Raised to 300 after upgrading to Pro (2026-08-31) and raising
 * DEFAULT_TRANSFORM_BUDGET_MS to 100s — at ~1 row/second, the batch limit
 * would otherwise become the binding constraint before the time budget
 * ever did, capping throughput for no reason on the new plan.
 */
export const TRANSFORM_BATCH_LIMIT = 300;

export interface TransformResult {
  recordsUpserted: number;
  errors: number;
  /** True if the time budget ran out before every pending row was processed — call again to continue. */
  partial: boolean;
}

export interface TransformOptions {
  /** Epoch ms after which this call stops processing further rows, leaving them pending. Defaults to no limit. */
  deadline?: number;
  /** Injectable clock, defaulting to Date.now — lets tests control elapsed time deterministically without real timers. */
  now?: () => number;
}

export async function transformPendingStagingEvents(db: DbPort, options: TransformOptions = {}): Promise<TransformResult> {
  const now = options.now ?? Date.now;
  const deadline = options.deadline ?? Infinity;

  const [events, knownTags] = await Promise.all([
    db.getPendingStagingEvents(TRANSFORM_BATCH_LIMIT),
    db.getKnownSourceTags(),
  ]);

  let recordsUpserted = 0;
  let errors = 0;
  let partial = false;

  for (const event of events) {
    if (now() >= deadline) {
      partial = true;
      break;
    }

    try {
      const payload = event.raw_payload;

      // List-status check: contactLists status can be non-active (e.g.
      // bounced) — skip anything not actively subscribed rather than
      // assuming every list-membership record is an active registrant
      // (plan Section 6.2 / 10).
      if (!isActiveListStatus(payload.listMembership.status)) {
        await db.markStagingProcessed(event.id, 'skipped: list status not active');
        continue;
      }

      // Source attribution: match tags against known_source_tags, NOT
      // source_list_id — List 1 is a catch-all and cannot distinguish
      // sources on its own (plan Section 3.3/6.2).
      const matchedTag = matchSourceTag(payload.tags, knownTags);

      // Tag-based exclusion (tagExclusion.ts): a contact whose only signal
      // is an excluded source tag (e.g. a MailChimp bulk import) never
      // becomes a registrant at all — checked before upsertRegistrant, not
      // after, so no registrant row is ever created for them in the first
      // place.
      if (isExcludedSourceOnly(payload.tags, matchedTag !== null)) {
        await db.markStagingProcessed(event.id, 'skipped: excluded source tag only (no recognized registration funnel)');
        continue;
      }

      const fields = mapAcFields(payload);
      const phoneNormalized = normalizePhone(fields.phoneRaw);

      const registrant = await db.upsertRegistrant({
        acContactId: payload.contact.id,
        firstName: fields.firstName,
        lastName: fields.lastName,
        email: fields.email,
        phone: phoneNormalized,
        phoneRaw: fields.phoneRaw,
        state: fields.state,
        postcode: fields.postcode,
        registeredAt: fields.registeredAt,
        interestedInTraining: fields.interestedInTraining,
      });

      await db.insertRegistrationEvent({
        registrantId: registrant.id,
        sourceListId: payload.listMembership.list,
        sourceTag: matchedTag?.tag_name ?? null,
        eventType: 'new_registration',
        rawStagingId: event.id,
      });

      await db.markStagingProcessed(event.id, null);
      recordsUpserted++;
    } catch (err) {
      errors++;
      await db.markStagingError(event.id, getErrorMessage(err));
    }
  }

  // Even if we didn't run out of time ourselves, a full batch means there
  // may be more pending rows beyond TRANSFORM_BATCH_LIMIT we never fetched —
  // report partial so the caller doesn't mark the overall sync complete.
  if (!partial && events.length === TRANSFORM_BATCH_LIMIT) {
    partial = true;
  }

  return { recordsUpserted, errors, partial };
}
