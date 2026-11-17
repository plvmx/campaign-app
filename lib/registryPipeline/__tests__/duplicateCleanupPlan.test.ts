import { describe, it, expect } from 'vitest';
import {
  cleanRegistrantEmail,
  nameKey,
  planDuplicateCleanup,
  type DedupRegistrant,
} from '../duplicateCleanupPlan';

let seq = 0;
function reg(over: Partial<DedupRegistrant>): DedupRegistrant {
  seq += 1;
  return {
    id: `id-${String(seq).padStart(3, '0')}`,
    first_name: null, last_name: null, email: null, phone: null, phone_raw: null,
    ac_contact_id: null, registered_at: null, state: null, postcode: null,
    church_name: null, church_leader: null, interested_in_training: null,
    webinar_session_at: null, webinar_attended: null, code_of_conduct_agreed: null,
    code_of_conduct_agreed_at: null, unsubscribed: null, nfc: null,
    ...over,
  };
}

describe('cleanRegistrantEmail', () => {
  it('leaves a clean address alone', () => {
    expect(cleanRegistrantEmail('a@b.com')).toEqual({ email: 'a@b.com', kind: 'unchanged' });
  });
  it('strips the spreadsheet footnote digit', () => {
    expect(cleanRegistrantEmail('kifinti52@hotmail.com    1')).toEqual({ email: 'kifinti52@hotmail.com', kind: 'footnote_removed' });
  });
  it('lower-cases and trims', () => {
    expect(cleanRegistrantEmail(' A@B.com ')).toEqual({ email: 'a@b.com', kind: 'tidied' });
  });
  it('removes spaces inside the address but flags it as a guess', () => {
    expect(cleanRegistrantEmail('shippys @iinet.net.au')).toEqual({ email: 'shippys@iinet.net.au', kind: 'inner_space_removed' });
  });
  it('does not mistake digits that are part of the address for a footnote', () => {
    expect(cleanRegistrantEmail('graeme.hunter87@gmail.com').kind).toBe('unchanged');
  });
  it('reports an address that is still invalid after cleaning', () => {
    expect(cleanRegistrantEmail('not an email')).toEqual({ email: null, kind: 'invalid' });
  });
  it('treats null/blank as no email', () => {
    expect(cleanRegistrantEmail(null).email).toBeNull();
    expect(cleanRegistrantEmail('  ').email).toBeNull();
  });
});

describe('nameKey', () => {
  it('needs both names and ignores case and spacing', () => {
    expect(nameKey({ first_name: 'Jill ', last_name: 'SHIPWAY' })).toBe('jill shipway');
    expect(nameKey({ first_name: 'Jill', last_name: null })).toBeNull();
  });
});

describe('planDuplicateCleanup', () => {
  it('merges the same person whose second row has a garbled email', () => {
    const a = reg({ first_name: 'Jill', last_name: 'Shipway', email: 'shippys@iinet.net.au', registered_at: '2017-05-05T00:00:00Z', phone: '+61265621684' });
    const b = reg({ first_name: 'Jill', last_name: 'Shipway', email: 'shippys @iinet.net.au', registered_at: '2017-05-05T00:00:00Z', state: 'NSW' });
    const plan = planDuplicateCleanup([a, b]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].survivorId).toBe(a.id);
    expect(plan.merges[0].loserIds).toEqual([b.id]);
    expect(plan.merges[0].updates).toEqual({ state: 'NSW' });
    expect(plan.merges[0].emailChange).toBeNull();
    expect(plan.emailFixes).toEqual([]);
  });

  it('prefers the row with an AC contact id as survivor and gives it the clean email', () => {
    const a = reg({ first_name: 'A', last_name: 'B', email: 'ab@x.com   1', ac_contact_id: '77' });
    const b = reg({ first_name: 'A', last_name: 'B', email: 'ab@x.com' });
    const [m] = planDuplicateCleanup([a, b]).merges;
    expect(m.survivorId).toBe(a.id);
    expect(m.emailChange).toEqual({ from: 'ab@x.com   1', to: 'ab@x.com' });
  });

  it('never merges a couple sharing an address, and leaves the second partner dirty', () => {
    const alan = reg({ first_name: 'Alan', last_name: 'Flynn', email: 'kifinti52@hotmail.com' });
    const rita = reg({ first_name: 'Rita', last_name: 'Flynn', email: 'kifinti52@hotmail.com    1' });
    const plan = planDuplicateCleanup([alan, rita]);
    expect(plan.merges).toEqual([]);
    expect(plan.emailFixes).toEqual([]);
    expect(plan.sharedEmailLeftAlone).toEqual([
      { registrantId: rita.id, name: 'rita flynn', rawEmail: 'kifinti52@hotmail.com    1', cleanedEmail: 'kifinti52@hotmail.com' },
    ]);
  });

  it('fixes a dirty email nobody else holds; spaces inside the address are marked review', () => {
    const safe = reg({ first_name: 'A', last_name: 'B', email: 'solo@x.com  1' });
    const guess = reg({ first_name: 'C', last_name: 'D', email: 'laurie. msc@gmail.com' });
    const plan = planDuplicateCleanup([safe, guess]);
    expect(plan.emailFixes).toEqual([
      { registrantId: safe.id, from: 'solo@x.com  1', to: 'solo@x.com', kind: 'footnote_removed', risk: 'safe' },
      { registrantId: guess.id, from: 'laurie. msc@gmail.com', to: 'laurie.msc@gmail.com', kind: 'inner_space_removed', risk: 'review' },
    ]);
  });

  it('reports an email that cannot be repaired', () => {
    const r = reg({ first_name: 'A', last_name: 'B', email: 'no at sign' });
    expect(planDuplicateCleanup([r]).unfixable).toEqual([{ registrantId: r.id, rawEmail: 'no at sign' }]);
  });

  it('merges an email-less row into the single email row with the same phone and name', () => {
    const withEmail = reg({ first_name: 'Micah', last_name: 'Cooke', email: 'djecooke@gmail.com', phone: '+61435069702', ac_contact_id: '13895' });
    const without = reg({ first_name: 'Micah', last_name: 'Cooke', phone: '+61435069702', postcode: '3000' });
    const [m] = planDuplicateCleanup([without, withEmail]).merges;
    expect(m.reason).toBe('same_phone_and_name_no_email');
    expect(m.survivorId).toBe(withEmail.id);
    expect(m.loserIds).toEqual([without.id]);
    expect(m.updates).toEqual({ postcode: '3000' });
  });

  it('keeps the email-bearing row as survivor even when the email-less row has the AC id', () => {
    const withEmail = reg({ first_name: 'M', last_name: 'C', email: 'm@c.com', phone: '+61400000001' });
    const without = reg({ first_name: 'M', last_name: 'C', phone: '+61400000001', ac_contact_id: '5' });
    const [m] = planDuplicateCleanup([without, withEmail]).merges;
    expect(m.survivorId).toBe(withEmail.id);
    expect(m.updates).toEqual({ ac_contact_id: '5' });
  });

  it('merges two email-less rows with the same phone and name', () => {
    const a = reg({ first_name: 'Peter', last_name: 'Yip (Ps)', phone: '+61411461833', registered_at: '2026-04-25T01:00:00Z' });
    const b = reg({ first_name: 'Peter', last_name: 'Yip (Ps)', phone: '+61411461833', registered_at: '2026-04-25T02:00:00Z' });
    const [m] = planDuplicateCleanup([b, a]).merges;
    expect(m.survivorId).toBe(a.id);
    expect(m.loserIds).toEqual([b.id]);
  });

  it('does not merge an email-less row when two email rows share its phone and name (ambiguous)', () => {
    const e1 = reg({ first_name: 'T', last_name: 'L', email: 'a@x.com', phone: '+61403920927' });
    const e2 = reg({ first_name: 'T', last_name: 'L', email: 'b@x.com', phone: '+61403920927' });
    const none = reg({ first_name: 'T', last_name: 'L', phone: '+61403920927' });
    const plan = planDuplicateCleanup([e1, e2, none]);
    expect(plan.merges).toEqual([]);
    expect(plan.reviewPairs).toHaveLength(1);
    expect(plan.reviewPairs[0].rows).toHaveLength(3);
  });

  it('never loses an unsubscribe or No-Further-Contact flag, and keeps the earliest registration date', () => {
    const a = reg({ first_name: 'A', last_name: 'B', email: 'ab@x.com', registered_at: '2020-01-01T00:00:00Z' });
    const b = reg({ first_name: 'A', last_name: 'B', email: 'ab@x.com  1', registered_at: '2017-01-01T00:00:00Z', unsubscribed: 'Yes', nfc: 'Yes' });
    const [m] = planDuplicateCleanup([a, b]).merges;
    expect(m.updates).toEqual({ unsubscribed: 'Yes', nfc: 'Yes', registered_at: '2017-01-01T00:00:00Z' });
  });

  it('keeps the survivor\'s value and reports a conflict when both rows differ', () => {
    const a = reg({ first_name: 'A', last_name: 'B', email: 'ab@x.com', state: 'VIC', ac_contact_id: '1' });
    const b = reg({ first_name: 'A', last_name: 'B', email: 'ab@x.com 1', state: 'NSW' });
    const [m] = planDuplicateCleanup([a, b]).merges;
    expect(m.updates).toEqual({});
    expect(m.conflicts).toEqual(['state: kept "VIC", other row had "NSW"']);
  });

  it('reports same name + same phone with different emails for review only', () => {
    const a = reg({ first_name: 'Tonya', last_name: 'Lee', email: 'tonya@live.com.au', phone: '+61403920927' });
    const b = reg({ first_name: 'Tonya', last_name: 'Lee', email: 'tonya@livecom.au', phone: '+61403920927' });
    const plan = planDuplicateCleanup([a, b]);
    expect(plan.merges).toEqual([]);
    expect(plan.reviewPairs.map((p) => p.name)).toEqual(['tonya lee']);
  });

  it('does not treat people sharing only a phone (a household) as duplicates', () => {
    const a = reg({ first_name: 'Diana', last_name: 'Angel', phone: '+61432641564' });
    const b = reg({ first_name: 'Peter', last_name: 'Angel', phone: '+61432641564' });
    const plan = planDuplicateCleanup([a, b]);
    expect(plan.merges).toEqual([]);
    expect(plan.reviewPairs).toEqual([]);
  });

  it('plans nothing for a clean registry', () => {
    const plan = planDuplicateCleanup([reg({ first_name: 'A', last_name: 'B', email: 'a@b.com' }), reg({ first_name: 'C', last_name: 'D', email: 'c@d.com' })]);
    expect(plan).toEqual({ merges: [], emailFixes: [], sharedEmailLeftAlone: [], unfixable: [], reviewPairs: [] });
  });

  it('does not change a survivor\'s email to an address another person already holds', () => {
    const a = reg({ first_name: 'A', last_name: 'B', email: 'x@y.com   1' });
    const b = reg({ first_name: 'A', last_name: 'B', email: 'x@y.com  1' });
    const partner = reg({ first_name: 'C', last_name: 'B', email: 'x@y.com' });
    const plan = planDuplicateCleanup([a, b, partner]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].emailChange).toBeNull();
  });

  it('does not report a case-only name difference as a conflict', () => {
    const a = reg({ first_name: 'charlotte', last_name: 'clado', email: 'c@x.com', ac_contact_id: '1' });
    const b = reg({ first_name: 'Charlotte', last_name: 'Clado', email: 'c@x.com 1' });
    expect(planDuplicateCleanup([a, b]).merges[0].conflicts).toEqual([]);
  });
});
