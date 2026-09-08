import { describe, it, expect } from 'vitest';
import { parseCsv, stripBom } from '../csvParse';

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles a quoted field containing a comma — the real case that breaks a naive split(",")', () => {
    expect(parseCsv('name,church\nDavid,"Huon Valley Christian Life Centre, Cygnet"\n')).toEqual([
      ['name', 'church'],
      ['David', 'Huon Valley Christian Life Centre, Cygnet'],
    ]);
  });

  it('handles an escaped quote ("") inside a quoted field', () => {
    expect(parseCsv('a\n"She said ""hi"""\n')).toEqual([
      ['a'],
      ['She said "hi"'],
    ]);
  });

  it('handles a quoted field containing a newline', () => {
    expect(parseCsv('a,b\n"line1\nline2",2\n')).toEqual([
      ['a', 'b'],
      ['line1\nline2', '2'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a trailing row with no final newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves empty trailing fields (e.g. this project\'s many blank trailing columns)', () => {
    expect(parseCsv('a,b,,\n1,2,,\n')).toEqual([
      ['a', 'b', '', ''],
      ['1', '2', '', ''],
    ]);
  });
});

describe('stripBom', () => {
  it('removes a leading UTF-8 BOM', () => {
    expect(stripBom('﻿First Name,Last Name')).toBe('First Name,Last Name');
  });

  it('leaves text without a BOM untouched', () => {
    expect(stripBom('First Name,Last Name')).toBe('First Name,Last Name');
  });
});
