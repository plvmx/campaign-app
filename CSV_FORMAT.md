# Campaign CSV Format

This document describes the CSV format used for the campaigns table (e.g. by `scripts/load_campaigns.js`).

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

These fields are **required**:
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

## Tips

- Ensure dates are in YYYY-MM-DD format and times in HH:MM:SS format
- Use UTF-8 encoding when saving CSV files
