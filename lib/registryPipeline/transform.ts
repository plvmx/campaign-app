// Transform step of the registry pipeline. See
// docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md Section 6.2.
//
// Reads pending rows from staging.ac_events, applies the field-inclusion
// whitelist and phone normalization, resolves source attribution by tag,
// and upserts into registry.registrants / registry.registration_events —
// via the injected DbPort, so this has no direct database dependency.

import { getErrorMessage } from '../errorUtils.ts';
import { mapAcFields } from './fieldMap.ts';
import { isActiveListStatus } from './listFilter.ts';
import { normalizePhone } from './phone.ts';
import type { DbPort } from './ports.ts';
import { matchSourceTag } from './sourceAttribution.ts';

export interface TransformResult {
  recordsUpserted: number;
  errors: number;
}

export async function transformPendingStagingEvents(db: DbPort): Promise<TransformResult> {
  const [events, knownTags] = await Promise.all([db.getPendingStagingEvents(), db.getKnownSourceTags()]);

  let recordsUpserted = 0;
  let errors = 0;

  for (const event of events) {
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

      const fields = mapAcFields(payload);
      const phoneNormalized = normalizePhone(fields.phoneRaw);

      const registrant = await db.upsertRegistrant({
        acContactId: payload.contact.id,
        fullName: fields.fullName,
        email: fields.email,
        phone: phoneNormalized,
        phoneRaw: fields.phoneRaw,
        state: fields.state,
      });

      // Source attribution: match tags against known_source_tags, NOT
      // source_list_id — List 1 is a catch-all and cannot distinguish
      // sources on its own (plan Section 3.3/6.2).
      const matchedTag = matchSourceTag(payload.tags, knownTags);

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

  return { recordsUpserted, errors };
}
