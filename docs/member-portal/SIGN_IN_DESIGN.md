# Member Portal — Sign-in Design (Phase 2, Step 1)

Status: **PR A (backend) and PR B (sign-in screens, `/member` shell, middleware guard) and the pilot invite script + monitoring queries built 2026-11-23; bulk emailed invites and portal features not yet.** Designed 2026-11-22. As-built notes are in `TECHNICAL_DOCS.md` §18.6.
Context: "Native Registration & Member Portal — Business Case", roadmap Step 3 ("Member Area").
This document covers sign-in only. What the portal shows after sign-in is a later design.

## 1. Goals and non-goals

**Goals**
- A registrant proves they own **both** the email address and the mobile number we hold for them, then gets a session for the member portal.
- Members never see the words MFA, 2FA, authenticator, token, etc.
- A member can only ever reach **their own** registrant record.
- Works for the one-off invite blast (~9,300 registrants) and for people who arrive without a link.

**Non-goals**
- Not a leader/admin login. Leaders keep `/login` (mobile+name, email+2FA). The two systems never share sessions or tables.
- No Supabase Auth users for members (see §2).
- No password, no authenticator app.

## 2. Key decision: a separate login, not Supabase Auth

Registrants are not `auth.users`. The leader login and `/registry` share one Supabase Auth pool, and RLS grants any *authenticated* session read access to e.g. `state_leaders`. Making members real Supabase users would give ~9,000 people a database credential and put them in the admins' user pool.

So members get:
- Verification and session state in **new `registry` tables**, reachable **only via the service role**, from API routes.
- A **signed, httpOnly cookie** that carries an opaque session id for one registrant — never a database JWT.
- Portal reads/writes go through `/api/member/*` routes that resolve the registrant from the cookie and touch only that row.

## 3. User flow

```
Invite email ──► /member/sign-in?i=<invite token>        (or /member/sign-in with no token)
                   │
   [no token]      │  asks for email + mobile (typed)
                   ▼
   Screen 1  "Let's make sure it's you"
             masked details shown:  j•••@gmail.com   04•• ••• 123
             text: "To sign you in and keep your information safe, we first need to
                    check that you are the owner of email address X and mobile
                    number Y. Tap 'Send my codes' and we'll send an email and a text
                    message. Find those messages, enter the codes below, then tap
                    'Validate'."
             [ Send my codes ]                 ← explicit tap; never auto-sends
                   ▼
   Screen 2  two code boxes (Email code / Text-message code), [ Validate ],
             "Resend" (cooldown), "These aren't my details" link
                   ▼
   Signed in → /member (portal home), cookie set
```

Copy notes: say "codes expire in 10 minutes"; label boxes "Code from the email" / "Code from the text message" (leaders confused two codes before — see CLAUDE.md "Easier-setup help"); large-text styles as for the setup screens; no jargon anywhere.

## 4. Invite token (the customised link)

- Link: `/member/sign-in?i=<token>` — token is 32 random bytes, base64url. **No email, name or mobile in the URL** (CLAUDE.md privacy rule). Masked details are fetched server-side when the page loads.
- Stored hashed (SHA-256) in `registry.member_invites`; the link is a **lookup key only**. Opening it proves nothing and consumes nothing — scanners/previews that GET the page are harmless, and the token is **not** a credential (codes are always required).
- Multi-use until expiry (e.g. 90 days) so a re-opened email still works; revocable.
- Token → one registrant. Generated in bulk by a script (dry-run default, like other scripts in `scripts/`), skipping `unsubscribed = 'Yes'`, `nfc = 'Yes'`, rows with no usable email, and placeholder emails (`noemail@…`).
- Invite is sent **by email only** (Resend), never SMS.

## 5. Data model (new, in `registry` schema; RLS enabled, no policies, `REVOKE` from anon/authenticated — same pattern as the other registry tables)

All use `GENERATED ALWAYS AS IDENTITY` ids (not `BIGSERIAL` — see the 2026-09-17 sequence-grant incident), except `member_verifications`, whose id is handed to the browser and so is a random UUID.

| Table | Purpose | Key columns |
|---|---|---|
| `registry.member_invites` | opaque link → registrant | `id`, `registrant_id` FK, `token_hash` unique, `created_at`, `expires_at`, `revoked_at`, `last_opened_at` |
| `registry.member_verifications` | one sign-in attempt | `id`, `registrant_id` FK, `email_code_hash`, `sms_code_hash`, `email_sent_to_masked`/`sms_sent_to_masked` (audit), `created_at`, `expires_at` (10 min), `attempts`, `consumed_at`, `ip_hash`, `invite_id` nullable |
| `registry.member_sessions` | signed-in device | `id` (random, stored hashed), `registrant_id` FK, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `device_label` (UA summary), `trusted_until` |
| `registry.member_auth_events` | append-only audit/throttle log | `id`, `registrant_id` nullable, `event` (`codes_sent`, `sms_failed`, `verify_ok`, `verify_bad`, `locked`, `session_revoked`…), `ip_hash`, `created_at`, `detail` |

- Codes: 6 digits, `crypto.randomInt`, stored as HMAC-SHA-256 with a server secret; compared in constant time; **single use**.
- Throttle counters are derived from `member_auth_events` (DB-backed) because `lib/rateLimit.ts` is in-memory and resets on cold start — fine for casual abuse, **not** sufficient to cap SMS spend. Keep the in-memory limiter as a cheap first line only.
- Backup: these are credential/log data — **excluded from `BACKUP_TABLE_CONFIG`** (like the other log tables); note this in the PR.
- IP hashed (not stored raw) to keep PII minimal.

## 6. API routes (all `enforceOrigin()`, service role, `/api/member/*`)

| Route | Does |
|---|---|
| `GET /api/member/invite?i=` | Looks up invite → returns **masked** email/mobile + whether each channel is available. Unknown/expired token → generic "link not valid" (same shape/timing). |
| `POST /api/member/request-codes` | Body: `{ invite }` **or** `{ email, mobile }` typed. Resolves registrant (exact lower-cased email **and** `normalizePhone(mobile)` must both match the same row when typed). Creates a verification; sends email via Resend and SMS via ClickSend **only to the addresses on file**. Response is always the same generic "if those details match, codes are on their way" — no registered/not-registered signal. |
| `POST /api/member/verify` | Body: `{ verificationId, emailCode, smsCode }`. Both must match, not expired, attempts < 5. On success: consume verification, create session, set cookie. On failure increment attempts; at 5 → locked for that verification. Generic error text. |
| `POST /api/member/sign-out` | Revokes the session, clears cookie. |
| `GET /api/member/me` | Resolves the cookie → minimal profile (first name). Used by the portal shell; everything else in the portal builds on the same resolver. |

Shared server code: `lib/services/memberAuthService.ts` (injected client, same DI pattern as `sessionAccessService`), `lib/memberCodes.ts` (generate/hash/compare — pure), `lib/memberMasking.ts` (mask email/mobile — pure), `lib/memberSession.ts` (cookie sign/verify + `getMemberFromRequest()` — the one gate every `/api/member/*` route uses, analogous to `verifyAdminCaller`).

## 7. Session and "remembered device"

- Cookie `member_session`: opaque random id, `HttpOnly; Secure; SameSite=Lax; Path=/`, value HMAC-signed. Separate from `app_session`/`registry_*`; middleware adds a `/member` guard (UX only — the real check is the server-side session lookup on every API call).
- **Default (pending your answer to Q1):** full dual verification on a new device; session lasts 90 days, sliding on use; no re-prompt while valid. Sign-out and "sign out of all devices" revoke rows.
- Idle/absolute limits and the portal's own screens are configurable constants in one file.

## 8. Abuse and cost controls

- Per registrant: max 3 code sends / 15 min, 10 / day. Resend cooldown 60 s.
- Per IP (hashed): max 10 sends / hour. Global daily SMS ceiling (e.g. 1,500) in `app_settings`; above it, SMS sends are refused and an admin is alerted — protects against SMS-pumping.
- Typed (non-invite) path only sends if both details match a single registrant — attackers cannot use it to message arbitrary numbers.
- Attempts: 5 per verification, then a new verification is required (and counts toward the send limits).
- Every send/verify outcome logged to `member_auth_events` (learning from `whatsapp_invite_log`: never let failures be console-only). SMS provider failure → user sees a neutral "we couldn't send the text — try again or get help".
- Codes never logged; SMS body: "Your AFJ code is 123456. It expires in 10 minutes. Don't share it." Sender name TBD (ClickSend currently sends as `campaign-app`; check sender-ID rules).

## 9. Edge cases and fallbacks

| Case | Handling |
|---|---|
| No mobile on file / placeholder email | Not eligible for self-serve sign-in; "get help" path (Q2). Excluded from the invite blast. |
| Mobile not receiving (number changed, overseas, landline) | "These aren't my details / I can't get the text" → help path (Q2); admin sees it in an "unable to verify" list (like `/admin/stuck-leaders`). |
| Email changed | Same help path. |
| Shared household mobile | Identity anchored on email; mobile is a second proof, may coincide across rows without harm. |
| Registrant is also a leader | No link between the two logins in this phase. |
| Unsubscribed / NFC | May sign in if they ask, but are never in the invite blast. |
| Stray whitespace / footnote digits in legacy emails (known ~192) | Typed path normalises by trimming/lower-casing only; unmatched ones fall to the help path. Fixing the data is separate. |

## 10. Security properties and honest limits

- Two independent channels must both be proved; nothing is sent to details the user types except to compare against what we hold.
- Enumeration-resistant responses; no PII in URLs; codes hashed, expiring, single-use, attempt-limited; session ids hashed at rest.
- Limit: this proves control of an inbox and a phone, not identity — someone with the member's unlocked phone (which usually also holds their email) passes. Acceptable for self-service access to their *own* contact details and campaign interest; **not** acceptable for exposing anyone else's data, which this portal must never do.

## 11. Testing plan (per CLAUDE.md)

- Pure-helper unit tests: code generation/hash/compare, masking, cookie sign/verify, throttle decisions.
- Service tests with `supabaseMock.ts`: request-codes (match, no match, one-channel match, rate-limited, provider failure), verify (ok, wrong, expired, locked, reuse), session lookup/revoke.
- Route tests: generic responses identical for known/unknown details; origin enforced.
- Page test for the sign-in screens' validation: code boxes digits-only (`normalizeOtpInput`), both required before Validate enabled, inline `role="alert"` errors, nothing submits with errors (UI validation standing rule). **Rules to confirm:** exactly 6 digits each; typed-path email format via `isValidEmail`, mobile via `isValidMobile`.
- Draft backup: the typed codes and details are deliberately **not** mirrored (codes are secrets and expire). The one thing kept on the device is the "codes sent" step — verification id + masked details, 10-minute expiry, never a code — so an iPhone reload while reading the email/text doesn't force a second (rate-limited, paid) send. Added in PR B.

## 12. Rollout plan

1. PR A — migrations, pure helpers, service, routes, tests, `TECHNICAL_DOCS.md`/`CLAUDE.md` updates. No UI, no invites.
2. PR B — `/member/sign-in` screens + minimal `/member` shell showing "Signed in as <first name>" and Sign out.
3. Pilot: invite ~20 leaders/friendlies; watch `member_auth_events` (and Resend/ClickSend delivery).
4. Bulk invite script (dry-run first), staged in batches (e.g. 500/day) so help requests are manageable.
5. Pre-PR checklist items per PR: backups (excluded — say why), docs, quality pass.

## 13. Decisions and open questions

**Decided by Peter, 2026-11-22 (defaults accepted):**
1. **Returning visits** — both codes on a new device, then a 90-day remembered session.
2. **Help path** for no-mobile / lost-phone — contact link to a human, plus an admin "unable to verify" list.
3. **Changing email/mobile in the portal** — requires a code sent to the *new* address/number before saving (separate design).

**Still open:**
4. SMS **sender name** and any Australian sender-ID registration requirement.
5. Spam Act review of the one-off invite wording and recipient filter.
6. Confirm the global daily SMS ceiling and per-person limits in §8.
