#!/usr/bin/env python3
"""
One-off — extracts the "Unsubscribes" tab (Date, Email columns) of Jordan's
AFJ Tracking export (the same workbook campaign_reports_xlsx_to_json.py
reads the "campaign report" tab from) into a JSON array of lowercased,
deduped email addresses, for scripts/mark_unsubscribed_from_jordan_sheet.ts
to cross-reference against registry.registrants.

Uses only the standard library (zipfile + xml.etree), not openpyxl like
campaign_reports_xlsx_to_json.py — this dev environment has no pip/openpyxl
available, and a plain two-column sheet (Date, Email) doesn't need a real
xlsx library: an .xlsx is just a zip of XML parts, and a bare
sharedStrings.xml + sheet.xml walk is enough to read it correctly.

Usage:
  python3 scripts/jordan_unsubscribes_xlsx_to_json.py <input.xlsx> <output.json>
"""
import json
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SHEET_NAME = "Unsubscribes"


def find_sheet_path(z: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(z.read("xl/workbook.xml"))
    sheet_el = None
    for s in workbook.findall(".//a:sheets/a:sheet", NS):
        if s.get("name") == SHEET_NAME:
            sheet_el = s
            break
    if sheet_el is None:
        names = [s.get("name") for s in workbook.findall(".//a:sheets/a:sheet", NS)]
        print(f"No '{SHEET_NAME}' sheet found. Sheets present: {names}", file=sys.stderr)
        sys.exit(1)
    r_id = sheet_el.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")

    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.get("Id") == r_id:
            return f"xl/{rel.get('Target')}"
    raise RuntimeError(f"Could not resolve sheet path for r:id {r_id}")


def load_shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall("a:si", NS):
        out.append("".join((t.text or "") for t in si.findall(".//a:t", NS)))
    return out


def cell_value(cell, shared: list[str]):
    v_el = cell.find("a:v", NS)
    if v_el is None or v_el.text is None:
        return None
    if cell.get("t") == "s":
        return shared[int(v_el.text)]
    return v_el.text


def col_letters(cell_ref: str) -> str:
    return "".join(ch for ch in cell_ref if ch.isalpha())


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.xlsx> <output.json>", file=sys.stderr)
        sys.exit(1)
    input_path, output_path = sys.argv[1], sys.argv[2]

    z = zipfile.ZipFile(input_path)
    sheet_path = find_sheet_path(z)
    shared = load_shared_strings(z)
    sheet_root = ET.fromstring(z.read(sheet_path))
    rows = sheet_root.find("a:sheetData", NS)

    # Locate the "Email" header column on row 1 rather than assuming B —
    # cheap insurance against the sheet's column order ever changing.
    header_row = rows.find("a:row", NS)
    email_col = None
    for c in header_row.findall("a:c", NS):
        if (cell_value(c, shared) or "").strip().lower() == "email":
            email_col = col_letters(c.get("r"))
            break
    if email_col is None:
        print("Could not find an 'Email' header column on row 1.", file=sys.stderr)
        sys.exit(1)

    emails = []
    for row in rows.findall("a:row", NS)[1:]:
        for c in row.findall("a:c", NS):
            if col_letters(c.get("r")) == email_col:
                v = cell_value(c, shared)
                if v and v.strip():
                    emails.append(v.strip().lower())

    unique_sorted = sorted(set(emails))
    with open(output_path, "w") as f:
        json.dump(unique_sorted, f)

    print(f"Wrote {len(unique_sorted)} unique emails ({len(emails)} rows, {len(emails) - len(unique_sorted)} duplicates) to {output_path}")


if __name__ == "__main__":
    main()
