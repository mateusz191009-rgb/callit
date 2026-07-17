# Supabase Auth-Mail-Templates (Callitnow-Branding)

Diese HTML-Dateien ersetzen die grauen Supabase-Standardmails durch das
Callitnow-Design (dunkle Karte, gruener Akzent, Wortmarke). Sie werden im
Supabase-**Dashboard** eingefuegt — nicht deployed, nicht importiert.

## Einrichten (einmalig, ~3 Minuten)

Supabase Dashboard -> dein Projekt -> **Authentication -> Email Templates**:

1. **Confirm signup**
   - Subject: `Confirm your email — Callitnow`
   - Body: kompletten Inhalt von `confirm-signup.html` einfuegen
     (Quelltext-Ansicht, alles ersetzen).
2. **Reset password** (Template "Reset Password" / "Recovery")
   - Subject: `Reset your password — Callitnow`
   - Body: kompletten Inhalt von `reset-password.html` einfuegen.

`{{ .ConfirmationURL }}` ist eine Supabase-Variable und muss GENAU so
im Template stehen bleiben — Supabase setzt dort den Link ein.

## Pflicht-Einstellung: E-Mail-Bestaetigung erzwingen

Damit sich niemand VOR der Verifizierung einloggen kann:

Dashboard -> **Authentication -> Sign In / Providers -> Email** ->
**"Confirm email" aktivieren**.

Der App-Code ist darauf vorbereitet: Nach der Registrierung erscheint
"Check your email to confirm your account.", und ein Login vor der
Bestaetigung zeigt "Please confirm your email first — check your inbox
for the link." (mapAuthError in components/auth/AuthModal.tsx).

Hinweis: Bereits existierende, unbestaetigte Accounts bleiben nutzbar —
der Zwang gilt fuer Logins/Signups ab dem Umschalten.
