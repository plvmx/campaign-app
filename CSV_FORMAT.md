# Campaign CSV Import/Export Format

This document describes the CSV format used for importing and exporting campaigns.

## CSV Structure

The CSV file must have the following columns in this exact order:

1. **id** - UUID (unique identifier)
2. **date** - Date in YYYY-MM-DD format
3. **state** - State code (e.g., VIC, NSW, QLD)
4. **place** - Location name
5. **time** - Time in HH:MM:SS format
6. **leader** - Leader name
7. **mobile** - Mobile number
8. **botj** - 'Yes' or 'No'
9. **team_size** - Number (or empty)
10. **user_id** - UUID (user identifier)
11. **created_at** - Timestamp in ISO format

## Required Fields

When importing, these fields are **required**:
- date
- state
- place
- time
- leader

Other fields are optional and can be empty.

## Example CSV

```csv
id,date,state,place,time,leader,mobile,botj,team_size,user_id,created_at
550e8400-e29b-41d4-a716-446655440000,2026-01-10,VIC,Melbourne,10:00:00,John Smith,0412345678,Yes,5,550e8400-e29b-41d4-a716-446655440001,2026-01-05T10:00:00Z
650e8400-e29b-41d4-a716-446655440000,2026-01-11,NSW,Sydney,14:30:00,Jane Doe,0423456789,No,,650e8400-e29b-41d4-a716-446655440001,2026-01-05T11:00:00Z
```

## CSV Escaping Rules

- Values containing commas, quotes, or newlines must be enclosed in double quotes
- Double quotes within values must be escaped by doubling them (`""`)
- Empty values can be left blank or use empty quotes (`""`)

### Example with Special Characters

```csv
id,date,state,place,time,leader,mobile,botj,team_size,user_id,created_at
abc123,2026-01-12,QLD,"Brisbane, CBD",09:00:00,"O'Brien, Patrick",0434567890,Yes,3,def456,2026-01-05T12:00:00Z
```

## Export Format

When you export campaigns using the "Export Campaigns to CSV" button:
- All campaigns are exported in date order (ascending)
- The file is named `campaigns_export_YYYY-MM-DD.csv`
- All fields are included, even if null

## Import Process

When you import campaigns using the "Import Campaigns from CSV" button:

1. **Select a CSV file** using the file picker
2. **Review the warning** - this will delete ALL existing campaigns
3. **Confirm** the operation
4. The system will:
   - Parse the CSV file
   - Validate required fields
   - Delete all existing campaigns
   - Insert new campaigns from the file
5. A success message will show the number of campaigns imported

## Important Warnings

⚠️ **IMPORT DELETES ALL CAMPAIGNS**: The import process permanently removes all existing campaigns before importing. Always export your current campaigns before importing new ones!

⚠️ **NO UNDO**: There is no undo function. Make sure you have a backup before importing.

⚠️ **VALIDATION**: Campaigns missing required fields (date, state, place, time, leader) will be skipped during import.

## Tips

1. **Always export first**: Before importing, export your current campaigns as a backup
2. **Test with small files**: Test the import process with a small CSV file first
3. **Check formatting**: Ensure dates are in YYYY-MM-DD format and times in HH:MM:SS format
4. **Use UTF-8 encoding**: Save your CSV files with UTF-8 encoding to avoid character issues
5. **Excel compatibility**: If using Excel, use "Save As" and select "CSV UTF-8 (Comma delimited)"

## Troubleshooting

### "No valid campaigns found in CSV file"
- Check that your CSV has the correct headers
- Verify required fields are not empty
- Ensure date format is YYYY-MM-DD

### "CSV file is empty or invalid"
- Check that the file contains data rows (not just headers)
- Ensure the file is actually CSV format

### Import fails partway through
- Check for duplicate IDs in the CSV
- Verify all foreign key references (user_id) are valid UUIDs
- Check that the data matches database constraints
