import { describe, it, expect } from 'vitest';
import {
  extractMarker,
  extractPostcode,
  extractChurch,
  parseAuDate,
  parseAuDateTime,
  parseYesNo,
  transformRow,
  dedupeByEmail,
  type RawCsvRow,
  type TransformedRegistrant,
} from '../csvRegistrantTransform';

function row(overrides: Partial<RawCsvRow> = {}, lineNumber = 1): RawCsvRow {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '0400000000',
    state: 'NSW',
    postcode: '2000',
    church: 'Some Church',
    regd: '1/01/2020',
    webinar: '',
    webinarDone: '',
    code: '',
    dateAgreed: '',
    lineNumber,
    ...overrides,
  };
}

describe('extractMarker', () => {
  it('finds a marker case-insensitively and strips it, collapsing leftover whitespace', () => {
    expect(extractMarker('Raymond Tce Comm UNSUBSCRIBED', 'UNSUBSCRIBED')).toEqual({ found: true, cleaned: 'Raymond Tce Comm' });
    expect(extractMarker('5nfc', 'NFC')).toEqual({ found: true, cleaned: '5' });
  });

  it('returns found: false and the trimmed original when the marker is absent', () => {
    expect(extractMarker('  Some Church  ', 'UNSUBSCRIBED')).toEqual({ found: false, cleaned: 'Some Church' });
  });
});

describe('extractPostcode', () => {
  it('sets nfc before validating the postcode, per decision order', () => {
    expect(extractPostcode('9NFC')).toEqual({ postcode: null, nfc: 'Yes' });
  });

  it('keeps a valid 4-digit postcode', () => {
    expect(extractPostcode('2000')).toEqual({ postcode: '2000', nfc: null });
  });

  it('nulls a placeholder-masked postcode with no NFC marker', () => {
    expect(extractPostcode('5???')).toEqual({ postcode: null, nfc: null });
  });

  it('nulls a blank postcode', () => {
    expect(extractPostcode('')).toEqual({ postcode: null, nfc: null });
  });
});

describe('extractChurch', () => {
  it('sets unsubscribed and strips the marker, keeping the cleaned name', () => {
    expect(extractChurch('C3  Tamworth  UNSUBSCRIBED')).toEqual({ churchName: 'C3 Tamworth', unsubscribed: 'Yes' });
  });

  it('leaves a normal church name untouched', () => {
    expect(extractChurch('Bapt Ch')).toEqual({ churchName: 'Bapt Ch', unsubscribed: null });
  });

  it('returns null (not empty string) for a blank church field', () => {
    expect(extractChurch('')).toEqual({ churchName: null, unsubscribed: null });
  });
});

describe('parseAuDate', () => {
  it('parses D/M/YYYY into an ISO date at midnight UTC', () => {
    expect(parseAuDate('1/01/2017')).toBe('2017-01-01T00:00:00Z');
    expect(parseAuDate('22/08/2026')).toBe('2026-08-22T00:00:00Z');
  });

  it('rejects an impossible date rather than silently rolling it over', () => {
    expect(parseAuDate('31/02/2020')).toBeNull();
  });

  it('rejects unparseable input', () => {
    expect(parseAuDate('not a date')).toBeNull();
    expect(parseAuDate('')).toBeNull();
  });
});

describe('parseAuDateTime', () => {
  it('parses D/M/YYYY HH:MM into an ISO datetime', () => {
    expect(parseAuDateTime('22/06/2021 09:30')).toBe('2021-06-22T09:30:00Z');
    expect(parseAuDateTime('7/12/2021 19:00')).toBe('2021-12-07T19:00:00Z');
  });

  it('rejects an impossible date rather than silently rolling it over', () => {
    expect(parseAuDateTime('31/02/2020 10:00')).toBeNull();
  });

  it('rejects an out-of-range time', () => {
    expect(parseAuDateTime('22/06/2021 25:00')).toBeNull();
    expect(parseAuDateTime('22/06/2021 09:60')).toBeNull();
  });

  it('rejects a date with no time component', () => {
    expect(parseAuDateTime('22/06/2021')).toBeNull();
  });

  it('rejects unparseable input', () => {
    expect(parseAuDateTime('not a date')).toBeNull();
    expect(parseAuDateTime('')).toBeNull();
  });
});

describe('parseYesNo', () => {
  it('recognizes Yes in various casings', () => {
    expect(parseYesNo('Yes')).toBe('Yes');
    expect(parseYesNo('YES')).toBe('Yes');
    expect(parseYesNo('yes')).toBe('Yes');
    expect(parseYesNo(' Yes ')).toBe('Yes');
  });

  it('recognizes No in various casings', () => {
    expect(parseYesNo('No')).toBe('No');
    expect(parseYesNo('no')).toBe('No');
  });

  it('returns null for blank, junk, or ambiguous values', () => {
    expect(parseYesNo('')).toBeNull();
    expect(parseYesNo('?')).toBeNull();
    expect(parseYesNo('maybe')).toBeNull();
  });
});

describe('transformRow', () => {
  it('excludes a non-AU state (decision 3)', () => {
    for (const state of ['OS', 'NZ', 'UK', 'os', 'nz']) {
      expect(transformRow(row({ state }))).toEqual({ status: 'excluded_non_au_state', state: state.toUpperCase() });
    }
  });

  it('keeps a real AU state, uppercased', () => {
    const result = transformRow(row({ state: 'ViC' }));
    expect(result.status).toBe('included');
    expect(result.status === 'included' && result.registrant.state).toBe('VIC');
  });

  it('loads a blank state as null rather than excluding it — only the three named codes are excluded', () => {
    const result = transformRow(row({ state: '' }));
    expect(result.status).toBe('included');
    expect(result.status === 'included' && result.registrant.state).toBeNull();
  });

  it('produces the expected shape for a normal row', () => {
    const result = transformRow(row({}, 42));
    expect(result).toEqual({
      status: 'included',
      registrant: {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phoneRaw: '0400000000',
        state: 'NSW',
        postcode: '2000',
        churchName: 'Some Church',
        registeredAt: '2020-01-01T00:00:00Z',
        unsubscribed: null,
        nfc: null,
        webinarSessionAt: null,
        webinarAttended: null,
        codeOfConductAgreed: null,
        codeOfConductAgreedAt: null,
        sourceLines: [42],
      },
    });
  });

  it('reads webinarSessionAt, webinarAttended, codeOfConductAgreed, and codeOfConductAgreedAt when present', () => {
    const result = transformRow(row({ webinar: '22/06/2021 09:30', webinarDone: 'Yes', code: 'YES', dateAgreed: '5/11/2021' }));
    expect(result.status).toBe('included');
    expect(result.status === 'included' && result.registrant.webinarSessionAt).toBe('2021-06-22T09:30:00Z');
    expect(result.status === 'included' && result.registrant.webinarAttended).toBe('Yes');
    expect(result.status === 'included' && result.registrant.codeOfConductAgreed).toBe('Yes');
    expect(result.status === 'included' && result.registrant.codeOfConductAgreedAt).toBe('2021-11-05T00:00:00Z');
  });

  it('reads webinarAttended = No from the CSV\'s W/Done column', () => {
    const result = transformRow(row({ webinarDone: 'No' }));
    expect(result.status === 'included' && result.registrant.webinarAttended).toBe('No');
  });

  it('never stores a literal "No" for codeOfConductAgreed, even if the column somehow contained one — narrows to null', () => {
    const result = transformRow(row({ code: 'No' }));
    expect(result.status === 'included' && result.registrant.codeOfConductAgreed).toBeNull();
  });
});

function transformed(overrides: Partial<TransformedRegistrant> = {}): TransformedRegistrant {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phoneRaw: '0400000000',
    state: 'NSW',
    postcode: '2000',
    churchName: 'Some Church',
    registeredAt: '2020-01-01T00:00:00Z',
    unsubscribed: null,
    nfc: null,
    webinarSessionAt: null,
    webinarAttended: null,
    codeOfConductAgreed: null,
    codeOfConductAgreedAt: null,
    sourceLines: [1],
    ...overrides,
  };
}

describe('dedupeByEmail', () => {
  it('passes through rows with unique emails unchanged', () => {
    const a = transformed({ email: 'a@example.com' });
    const b = transformed({ email: 'b@example.com' });
    expect(dedupeByEmail([a, b])).toEqual(expect.arrayContaining([a, b]));
  });

  it('passes through every email-less row without attempting to merge them together', () => {
    const a = transformed({ email: null, firstName: 'A' });
    const b = transformed({ email: null, firstName: 'B' });
    expect(dedupeByEmail([a, b])).toHaveLength(2);
  });

  // Real pattern A from the CSV (17 of 22 groups): a fuller row + a thin
  // same-day re-entry of the same person. e.g. aljc2pearl@gmail.com.
  it('Pattern A: keeps the fuller row\'s data when a thin duplicate has the same name and date', () => {
    const full = transformed({
      email: 'aljc2pearl@gmail.com', firstName: 'Louise', lastName: 'Cannell',
      phoneRaw: '0407 466 779', churchName: 'Eaton Bapt Ch', registeredAt: '2026-08-22T00:00:00Z',
      sourceLines: [9255],
    });
    const thin = transformed({
      email: 'aljc2pearl@gmail.com', firstName: 'Louise', lastName: 'Cannell',
      phoneRaw: '61407 466 779', churchName: null, registeredAt: '2026-08-22T00:00:00Z',
      sourceLines: [9275],
    });

    const [merged] = dedupeByEmail([full, thin]);
    expect(merged.churchName).toBe('Eaton Bapt Ch');
    expect(merged.sourceLines).toEqual([9255, 9275]);
  });

  // Real pattern B: unsubscribed marker present on only one of two
  // otherwise-identical duplicate rows (e.g. 4hisglory70@gmail.com).
  it('Pattern B: unsubscribed is set if either duplicate row shows the marker', () => {
    const withMarker = transformed({ email: 'lynne@example.com', unsubscribed: 'Yes', churchName: 'C3 Tamworth' });
    const withoutMarker = transformed({ email: 'lynne@example.com', unsubscribed: null, churchName: 'C3 Tamworth' });

    const [merged] = dedupeByEmail([withMarker, withoutMarker]);
    expect(merged.unsubscribed).toBe('Yes');
  });

  // Real pattern C: genuine repeat registrations months/years apart with
  // real updates (e.g. jaynemcrichton@gmail.com: postcode changed;
  // jondelpino@hotmail.com: church filled in later).
  it('Pattern C: prefers the later row\'s value when both rows have a genuinely conflicting non-null value', () => {
    const first2019 = transformed({ email: 'jayne@example.com', postcode: '6102', registeredAt: '2019-09-15T00:00:00Z' });
    const later2021 = transformed({ email: 'jayne@example.com', postcode: '6171', registeredAt: '2021-12-03T00:00:00Z' });

    const [merged] = dedupeByEmail([first2019, later2021]);
    expect(merged.postcode).toBe('6171');
  });

  it('Pattern C: fills in a field that was blank on the earlier row without needing it to be "later" to win', () => {
    const earlierNoChurch = transformed({ email: 'jon@example.com', churchName: null, registeredAt: '2022-12-06T00:00:00Z' });
    const laterWithChurch = transformed({ email: 'jon@example.com', churchName: 'Bellevue CCC', registeredAt: '2023-03-13T00:00:00Z' });

    const [merged] = dedupeByEmail([earlierNoChurch, laterWithChurch]);
    expect(merged.churchName).toBe('Bellevue CCC');
  });

  // The real 22nd anomaly: steve.i.walker@icloud.com has 3 rows, one
  // under a completely different name ("Cilla Geldenhuys") sharing his
  // email — resolved as option (b): she keeps her own row with the email
  // removed, matchable only by phone.
  it('treats a differently-named row sharing someone else\'s email as a separate person, not a duplicate', () => {
    const walker1 = transformed({ email: 'steve.i.walker@icloud.com', firstName: 'Stephen', lastName: 'Walker', churchName: 'Australind Bapt Ch', registeredAt: '2026-08-22T00:00:00Z' });
    const walker2 = transformed({ email: 'steve.i.walker@icloud.com', firstName: 'Stephen', lastName: 'Walker', churchName: null, registeredAt: '2026-08-22T00:00:00Z' });
    const cilla = transformed({ email: 'steve.i.walker@icloud.com', firstName: 'Cilla', lastName: 'Geldenhuys', phoneRaw: '61467 269 846', churchName: null, registeredAt: '2026-08-22T00:00:00Z' });

    const result = dedupeByEmail([walker1, walker2, cilla]);

    expect(result).toHaveLength(2);
    const stephen = result.find((r) => r.lastName === 'Walker');
    const cillaResult = result.find((r) => r.lastName === 'Geldenhuys');
    expect(stephen?.email).toBe('steve.i.walker@icloud.com');
    expect(stephen?.churchName).toBe('Australind Bapt Ch'); // still merges normally within his own sub-group
    expect(cillaResult?.email).toBeNull(); // not Stephen's email — she's her own registrant, matchable only by phone
    expect(cillaResult?.phoneRaw).toBe('61467 269 846');
  });

  it('merges webinarAttended: Yes wins over No when duplicate rows disagree', () => {
    const withYes = transformed({ email: 'a@example.com', webinarAttended: 'Yes' });
    const withNo = transformed({ email: 'a@example.com', webinarAttended: 'No' });

    const [merged] = dedupeByEmail([withYes, withNo]);
    expect(merged.webinarAttended).toBe('Yes');
  });

  it('merges webinarAttended: No when only one duplicate row has a value at all', () => {
    const withNo = transformed({ email: 'a@example.com', webinarAttended: 'No' });
    const blank = transformed({ email: 'a@example.com', webinarAttended: null });

    const [merged] = dedupeByEmail([withNo, blank]);
    expect(merged.webinarAttended).toBe('No');
  });

  it('merges codeOfConductAgreed: Yes if either duplicate row shows it, same idiom as unsubscribed/nfc', () => {
    const withCode = transformed({ email: 'a@example.com', codeOfConductAgreed: 'Yes' });
    const withoutCode = transformed({ email: 'a@example.com', codeOfConductAgreed: null });

    const [merged] = dedupeByEmail([withCode, withoutCode]);
    expect(merged.codeOfConductAgreed).toBe('Yes');
  });

  it('merges webinarSessionAt and codeOfConductAgreedAt using the later-non-null-wins rule', () => {
    const earlier = transformed({
      email: 'a@example.com',
      registeredAt: '2021-01-01T00:00:00Z',
      webinarSessionAt: '2021-06-16T00:00:00Z',
      codeOfConductAgreedAt: '2021-06-01T00:00:00Z',
    });
    const later = transformed({
      email: 'a@example.com',
      registeredAt: '2021-12-01T00:00:00Z',
      webinarSessionAt: '2021-11-22T09:30:00Z',
      codeOfConductAgreedAt: '2021-11-05T00:00:00Z',
    });

    const [merged] = dedupeByEmail([earlier, later]);
    expect(merged.webinarSessionAt).toBe('2021-11-22T09:30:00Z');
    expect(merged.codeOfConductAgreedAt).toBe('2021-11-05T00:00:00Z');
  });
});
