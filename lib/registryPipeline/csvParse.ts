// Minimal RFC 4180-ish CSV parser — no dependency added for a one-time
// reload script. Handles quoted fields (including embedded commas,
// embedded newlines, and "" as an escaped quote), which a naive
// String.split(',') cannot: at least one real value in
// AFJ Registrations.csv contains a comma inside a quoted field
// ("Huon Valley Christian Life Centre, Cygnet").

/** Parses a full CSV document (already stripped of any leading BOM) into rows of raw string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore — paired \n (or a lone \r) handles the line break
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // Final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Strips a UTF-8 BOM if present — AFJ Registrations.csv (and most Excel CSV exports) start with one. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
