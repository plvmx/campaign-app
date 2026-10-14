# Supabase email templates

Supabase sends every sign-in email from a template set in the **Supabase Dashboard**, not from this
repo — the copy here is a record, so the wording isn't only in the dashboard. **The dashboard is what is
live.** If you change one, change the other.

## `magic-link.html` — Authentication → Email Templates → **Magic Link**

One template covers every email this app sends: leader email confirmation (`/confirm-email`), 2FA setup
(`/setup-mfa`), email sign-in (`/login/mfa`) and the `/registry` portal sign-in.

Things the app depends on — keep them when editing:

- **Link text `CONFIRM NOW`** — the on-screen "check your inbox" messages (`/login`, `/login/mfa`) tell
  people to click the **CONFIRM NOW** link. Change both together.
- **Link format `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`** — this is the
  scanner-proof link: it opens our own page, which only uses the one-time token when the person taps a
  button, so Apple Mail / Outlook link scanners can't use it up. Every sender's `emailRedirectTo`
  already contains a `?` so the `&` attaches. (See "Scanner-proof magic links" in `CLAUDE.md`.)
- **`{{ .Token }}`** — the typed-code fallback ("click here to enter the code from the email") needs the
  code shown in the email. It can be 6–10 digits depending on Supabase's "Email OTP Length" setting.
- Sizes are deliberately large (22px body, 30px button, 36px code) for older readers; email programs
  ignore most styling except **inline** styles, so keep them inline.

## Applying a change

1. Edit `magic-link.html` here and open a PR.
2. After it merges, paste the same HTML into the dashboard template and save.
3. Send one real email (e.g. start an email confirmation for PVTester) and check the button and code
   in your mail program.
