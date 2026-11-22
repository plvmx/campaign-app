# Registrations count — what happened and why the numbers differ

*Prepared 27 Oct 2026 for Lorraine. No personal details are included.*

## What was wrong

1. **Some real registrants had gone missing from the database.**
   - **31 people** on your 24 Sept sheet had been moved out of the registrations database in a September clean-up by mistake. Chris Tutauha was one of them.
   - **45 Australian people** on your sheet were never in the database at all. They were added to the sheet after the original September export, and they are not in ActiveCampaign (the email system the database syncs from), so nothing could have brought them in.
   - **Yency Mahecha** *was* in the database, but under the wrong name ("Testing Cottam"), because her ActiveCampaign contact has the placeholder email address noemail@noemail.com.
2. **All of the above is now fixed (27 Oct).** The 76 people were added back from your sheet, and Yency's name was corrected. Nothing was deleted.

## The count: 9,308 before, 9,384 now

| | |
|---|---|
| Registrations before the fix | 9,308 |
| Restored (moved out by mistake) | + 31 |
| Added from your sheet (never in the database) | + 45 |
| **Registrations now** | **9,384** |

## Why it isn't 9,368

9,368 was your sheet's 9,326 rows plus the 42 new registrations. The 42 is correct (the database has exactly 42 new people since 24 Sept). The sheet's row count is not a count of people:

- **151 rows are overseas** (OS, NZ, UK). The database leaves these out on purpose, as agreed when it was built.
- **2 rows are repeated headings.**
- **About 150 rows are the same person on more than one row** (a couple sharing an email or phone, or someone listed twice). The database holds each person once.
- **About 320 people are in the database but not on your 24 Sept sheet**, mostly people who registered through ActiveCampaign and were never typed into the sheet. Some of these may be the same person as a sheet row whose email is written slightly differently (see below).

So the database is the sheet, less the overseas and repeated rows, plus the people the sheet doesn't have, and 9,384 is what that adds up to. The two numbers aren't meant to match exactly.

## Two things still to do

- **Mark Chris and Yency as NFC (No Further Contact).** Your sheet doesn't have them flagged, so they weren't flagged when they were restored. You can do this on the Manage screen.
- **Fix Yency's email in ActiveCampaign.** Her contact still has noemail@noemail.com, which is why the database could not find her.

## A separate clean-up we'll do

About 190 emails in the database have stray spaces or a footnote number on the end (for example `name@gmail.com    1`). They came from the original spreadsheet and could cause duplicates later. We'll tidy them up separately; it won't change the count.

## If you want to check the 320

We can list the people in the database who aren't on your sheet so you can confirm they are genuine.
