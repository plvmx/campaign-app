import { describe, it, expect } from 'vitest';
import {
  excelSerialToAuText,
  cleanSheetEmail,
  cleanSheetPhone,
  phoneKey,
  sheetRowToRaw,
  planSheetRestore,
  planNameCorrections,
  toRegistrantInsertRow,
  type ExistingRegistrant,
  type TwolRespondentRef,
} from '../sheetRestorePlan';
import type { RawCsvRow } from '../csvRegistrantTransform';

// All people below are synthetic (example.com addresses, 0400 test-range
// numbers) — never put real registrants' details in a committed test.

function sheetRow(overrides: Partial<RawCsvRow> = {}, lineNumber = 1): RawCsvRow {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '0400 111 222',
    state: 'WA',
    postcode: '6000',
    church: 'Some Church',
    regd: '43030',
    webinar: '',
    webinarDone: '',
    code: '',
    dateAgreed: '',
    lineNumber,
    ...overrides,
  };
}

function registrant(overrides: Partial<ExistingRegistrant> = {}): ExistingRegistrant {
  return {
    id: 'r1',
    first_name: 'Someone',
    last_name: 'Else',
    email: 'someone@example.com',
    phone: '+61400000000',
    ac_contact_id: null,
    ...overrides,
  };
}

describe('excelSerialToAuText', () => {
  it('converts a date-only serial', () => {
    expect(excelSerialToAuText('43030', false)).toBe('22/10/2017');
  });

  it('converts a serial with a time-of-day (a webinar session at 23/11/2023 11:00)', () => {
    expect(excelSerialToAuText('45253.458333333336', true)).toBe('23/11/2023 11:00');
  });

  it('drops the time when only a date is wanted', () => {
    expect(excelSerialToAuText('45248.561064814814', false)).toBe('18/11/2023');
  });

  it('leaves non-numeric text alone so the existing parsers still reject it', () => {
    expect(excelSerialToAuText('Emailed 14 Sept', false)).toBe('Emailed 14 Sept');
    expect(excelSerialToAuText('', true)).toBe('');
  });
});

describe('cleanSheetEmail / cleanSheetPhone / phoneKey', () => {
  it('strips a trailing footnote digit', () => {
    expect(cleanSheetEmail('pat@example.com  1')).toBe('pat@example.com');
  });

  it('closes a stray space inside the address', () => {
    expect(cleanSheetEmail('pat@example. com')).toBe('pat@example.com');
  });

  it('returns empty for anything that is not an address', () => {
    expect(cleanSheetEmail('patexample')).toBe('');
    expect(cleanSheetEmail('https;/www.example com/pat/')).toBe('');
  });

  it('rejects free text in the phone column but keeps real numbers', () => {
    expect(cleanSheetPhone('Emailed 14 Sept')).toBe('');
    expect(cleanSheetPhone('0400 111 222')).toBe('0400 111 222');
    expect(cleanSheetPhone('08 9000 0000')).toBe('08 9000 0000');
  });

  it('compares phones across formats by their last nine digits', () => {
    expect(phoneKey('0400 111 222')).toBe(phoneKey('+61400111222'));
    expect(phoneKey('400111222')).toBe(phoneKey('61400111222'));
    expect(phoneKey('')).toBe('');
  });
});

describe('sheetRowToRaw', () => {
  it('turns serial dates into the text the CSV parsers expect', () => {
    const raw = sheetRowToRaw(sheetRow({ regd: '45248.561064814814', webinar: '45253.458333333336', dateAgreed: '45300' }));
    expect(raw.regd).toBe('18/11/2023');
    expect(raw.webinar).toBe('23/11/2023 11:00');
    expect(raw.dateAgreed).toBe('9/1/2024');
  });
});

describe('planSheetRestore', () => {
  it('restores a sheet person who was moved into twol_respondents, keeping their sheet details', () => {
    const person = sheetRow(
      {
        firstName: 'Casey ',
        lastName: 'Sample ',
        email: 'casey.sample@example.com',
        phone: '0400 333 444',
        postcode: '6061',
        church: 'Some Ctr UNSUBSCRIBED',
        regd: '45248.561064814814',
        webinar: '45253.458333333336',
      },
      1550,
    );
    const twol: TwolRespondentRef[] = [
      { first_name: 'Casey', last_name: 'Sample', email: 'casey.sample@example.com', phone: '+61400333444' },
    ];

    const plan = planSheetRestore([person], [], twol);

    expect(plan.inserts).toHaveLength(1);
    const [insert] = plan.inserts;
    expect(insert.kind).toBe('restore');
    expect(insert.registrant).toMatchObject({
      firstName: 'Casey',
      lastName: 'Sample',
      email: 'casey.sample@example.com',
      state: 'WA',
      postcode: '6061',
      churchName: 'Some Ctr',
      unsubscribed: 'Yes',
      registeredAt: '2023-11-18T00:00:00Z',
      webinarSessionAt: '2023-11-23T11:00:00Z',
    });
  });

  it('restores a twol match found by phone only (no email on the sheet)', () => {
    const person = sheetRow({ firstName: 'Val', lastName: 'Bell', email: '', phone: '0400 555 666' }, 9031);
    const twol: TwolRespondentRef[] = [{ first_name: 'Val', last_name: 'Bell', email: null, phone: '+61400555666' }];
    const plan = planSheetRestore([person], [], twol);
    expect(plan.inserts.map((i) => i.kind)).toEqual(['restore']);
  });

  it('imports a sheet-only Australian person that exists nowhere in the registry', () => {
    const plan = planSheetRestore([sheetRow({}, 462)], [registrant()], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].kind).toBe('import');
    expect(plan.inserts[0].sourceLines).toEqual([462]);
  });

  it('skips someone already in the registry, matched by email regardless of case', () => {
    const plan = planSheetRestore([sheetRow({ email: 'JANE@Example.com' })], [registrant({ email: 'jane@example.com' })], []);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['already_in_registry']);
  });

  it('skips someone already in the registry, matched by phone plus the same last name', () => {
    const existing = registrant({ first_name: 'Janet', last_name: 'Doe', email: null, phone: '+61400111222' });
    const plan = planSheetRestore([sheetRow({ email: '' })], [existing], []);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['already_in_registry']);
  });

  it('does NOT treat a phone shared with a different person as "already registered" (families share a mobile)', () => {
    const first = registrant({ first_name: 'Mel', last_name: 'Camp', email: 'mel@example.com', phone: '+61400777888' });
    const second = sheetRow({ firstName: 'Shelley', lastName: 'Hill', email: 'shelley@example.com', phone: '0400 777 888' });
    const plan = planSheetRestore([second], [first], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].notes.join(' ')).toMatch(/shared with a different registrant/);
  });

  it('skips overseas people (the reload excluded OS/NZ/UK on purpose)', () => {
    const plan = planSheetRestore([sheetRow({ state: 'OS' }), sheetRow({ state: 'NZ' }, 2), sheetRow({ state: 'UK' }, 3)], [], []);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['overseas', 'overseas', 'overseas']);
  });

  it('skips the sheet\'s repeated header rows and silently ignores empty rows', () => {
    const header = sheetRow({ firstName: 'First Name', lastName: 'Last Name', email: 'Email Address', phone: 'Phone', state: 'Place' });
    const empty = sheetRow({ firstName: '', lastName: '', email: '', phone: '', state: '' }, 9328);
    const plan = planSheetRestore([header, empty], [], []);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('blank_or_header');
  });

  it('skips a row with a name but neither email nor phone', () => {
    const plan = planSheetRestore([sheetRow({ email: '', phone: '' })], [], []);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['no_contact_details']);
  });

  it('treats free text in the phone column as no phone (but keeps the email) and flags a blank state', () => {
    const noPhone = sheetRow({ firstName: 'Ash', lastName: 'Lane', email: 'ash@example.com', phone: 'Emailed 14 Sept', state: '', postcode: '' });
    const plan = planSheetRestore([noPhone], [], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].registrant.phoneRaw).toBeNull();
    expect(plan.inserts[0].notes).toContain('no state on the sheet');
  });

  it('skips a would-be import whose exact name is already in the registry under other details (possible duplicate)', () => {
    const existing = registrant({ first_name: 'Toni', last_name: 'Park', email: 'toni@example.com', phone: null });
    const sheet = sheetRow({ firstName: 'Toni', lastName: 'Park', email: '', phone: '0400 999 000' });
    const plan = planSheetRestore([sheet], [existing], []);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['same_name_in_registry']);
  });

  it('keeps a shared email on one of two differently-named people only', () => {
    const one = sheetRow({ firstName: 'Rex', lastName: 'Gray', email: 'couple@example.com', phone: '' }, 7300);
    const two = sheetRow({ firstName: 'Faye', lastName: 'Gray', email: 'couple@example.com  1', phone: '' }, 2729);
    const plan = planSheetRestore([two, one], [], []);
    expect(plan.inserts).toHaveLength(2);
    expect(plan.inserts.filter((i) => i.registrant.email).length).toBe(1);
    expect(plan.inserts.some((i) => i.notes.join(' ').includes('shares an email'))).toBe(true);
  });

  it('does not also insert the sheet row that corrects a placeholder-email registrant (no duplicate person)', () => {
    const placeholder = registrant({ id: 'p1', first_name: 'Testing', last_name: 'Person', email: 'noemail@noemail.com', phone: '+61400222333', ac_contact_id: '6609' });
    const twol: TwolRespondentRef[] = [{ first_name: 'Real', last_name: 'Name', email: 'noemail@noemail.com', phone: '+61400222333' }];
    const sheet = sheetRow({ firstName: 'Real', lastName: 'Name', email: 'real-name@example.com', phone: '0400 222 333' }, 9267);

    const plan = planSheetRestore([sheet], [placeholder], twol);

    expect(plan.inserts).toHaveLength(0);
    expect(plan.nameCorrections).toHaveLength(1);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['handled_by_name_correction']);
  });

  it('is idempotent: once the people are in the registry a second plan has nothing to insert', () => {
    const rows = [sheetRow({}, 1), sheetRow({ firstName: 'Amy', lastName: 'Lee', email: 'amy@example.com', phone: '0400 123 456' }, 2)];
    const first = planSheetRestore(rows, [], []);
    expect(first.inserts).toHaveLength(2);
    const nowInRegistry = first.inserts.map((i, n) =>
      registrant({ id: `n${n}`, first_name: i.registrant.firstName, last_name: i.registrant.lastName, email: i.registrant.email, phone: toRegistrantInsertRow(i.registrant).phone }),
    );
    const second = planSheetRestore(rows, nowInRegistry, []);
    expect(second.inserts).toHaveLength(0);
  });
});

describe('planNameCorrections', () => {
  const placeholder = registrant({
    id: 'ab126d23',
    first_name: 'Testing',
    last_name: 'Person',
    email: 'noemail@noemail.com',
    phone: '+61400222333',
    ac_contact_id: '6609',
  });

  it('proposes the sheet\'s name for a placeholder-email registrant matched by phone', () => {
    const sheet = sheetRow({ firstName: 'Real', lastName: 'Name', email: 'real-name@example.com', phone: '0400 222 333' }, 9267);
    expect(planNameCorrections([sheet], [placeholder])).toEqual([
      {
        registrantId: 'ab126d23',
        acContactId: '6609',
        currentFirstName: 'Testing',
        currentLastName: 'Person',
        newFirstName: 'Real',
        newLastName: 'Name',
        sheetLine: 9267,
      },
    ]);
  });

  it('does nothing when two sheet rows share the phone (ambiguous)', () => {
    const a = sheetRow({ firstName: 'Real', lastName: 'Name', phone: '0400 222 333' }, 1);
    const b = sheetRow({ firstName: 'Other', lastName: 'Person', phone: '0400 222 333' }, 2);
    expect(planNameCorrections([a, b], [placeholder])).toEqual([]);
  });

  it('never touches a registrant with a real email', () => {
    const normal = registrant({ email: 'real@example.com', phone: '+61400222333', first_name: 'Testing', last_name: 'Person' });
    const sheet = sheetRow({ firstName: 'Real', lastName: 'Name', phone: '0400 222 333' });
    expect(planNameCorrections([sheet], [normal])).toEqual([]);
  });

  it('does nothing when the name already matches', () => {
    const fixed = { ...placeholder, first_name: 'Real', last_name: 'Name' };
    const sheet = sheetRow({ firstName: 'Real', lastName: 'Name', phone: '0400 222 333' });
    expect(planNameCorrections([sheet], [fixed])).toEqual([]);
  });
});

describe('toRegistrantInsertRow', () => {
  it('lower-cases the email, normalises the phone to E.164 and leaves ac_contact_id null', () => {
    const plan = planSheetRestore([sheetRow({ email: 'Jane@Example.COM', phone: '0400 111 222' })], [], []);
    expect(toRegistrantInsertRow(plan.inserts[0].registrant)).toMatchObject({
      ac_contact_id: null,
      email: 'jane@example.com',
      phone: '+61400111222',
      phone_raw: '0400 111 222',
      state: 'WA',
      registered_at: '2017-10-22T00:00:00Z',
    });
  });
});
