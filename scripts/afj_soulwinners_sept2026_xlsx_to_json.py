#!/usr/bin/env python3
"""
One-off — extracts the "main AFJ page" tab of Lorraine's updated soulwinners
export ("Current AFJ Soulwinners as at 24 Sept 2026.xlsx") into a JSON array
of raw rows, for scripts/backfill_postcode_nfc_state_from_sept24_sheet.ts to
cross-reference against registry.registrants.

Same column layout as the original registrations CSV (see
reload_registrants_from_csv.ts's COLUMNS comment) — 0 First Name, 1 Last
Name, 2 Email, 3 Phone, 4 Place/State, 5 Postcode, 6 Church, 9 Regd, 10
Webinar, 11 W/Done, 15 Code, 16 Date Agreed — but this sheet has NO header
row at all (data starts on row 1), unlike the CSV, so columns are read by
fixed position rather than by header lookup.

Uses only the standard library (zipfile + xml.etree), not openpyxl like
campaign_reports_xlsx_to_json.py — this dev environment has no pip/openpyxl
available (see jordan_unsubscribes_xlsx_to_json.py's own note on this).

Usage:
  python3 scripts/afj_soulwinners_sept2026_xlsx_to_json.py <input.xlsx> <output.json>
"""
import json
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SHEET_NAME = "main AFJ page"

COLUMNS = {
    "firstName": 0, "lastName": 1, "email": 2, "phone": 3, "state": 4,
    "postcode": 5, "church": 6, "regd": 9, "webinar": 10, "webinarDone": 11,
    "code": 15, "dateAgreed": 16,
}


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


def col_to_idx(col_letters: str) -> int:
    idx = 0
    for ch in col_letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx - 1


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
    sheet_data = sheet_root.find("a:sheetData", NS)

    rows_out = []
    for line_number, row in enumerate(sheet_data.findall("a:row", NS), start=1):
        by_idx = {}
        for c in row.findall("a:c", NS):
            idx = col_to_idx(col_letters(c.get("r")))
            by_idx[idx] = cell_value(c, shared)

        def get(key: str) -> str:
            v = by_idx.get(COLUMNS[key])
            return v if v is not None else ""

        rows_out.append({
            "firstName": get("firstName"),
            "lastName": get("lastName"),
            "email": get("email"),
            "phone": get("phone"),
            "state": get("state"),
            "postcode": get("postcode"),
            "church": get("church"),
            "regd": get("regd"),
            "webinar": get("webinar"),
            "webinarDone": get("webinarDone"),
            "code": get("code"),
            "dateAgreed": get("dateAgreed"),
            "lineNumber": line_number,
        })

    with open(output_path, "w") as f:
        json.dump(rows_out, f)

    print(f"Wrote {len(rows_out)} rows to {output_path}")


if __name__ == "__main__":
    main()
