# Firebase App Check – Setup-Plan für pantrio

> **Status (2026-05-05): aktiv im Beobachtungsmodus.** Site-Key registriert,
> Provider in Firebase Console hinterlegt, Client initialisiert, vollständige
> Web-App-Config (`appId`, `storageBucket`, `messagingSenderId`) seit v0.9.2
> in `app.js`. Verified-Quote klettert.
>
> **Pending:** Enforcement (RTDB → Auth) — frühestens nach 24 h stabiler
> Verified-Quote ≥ 99 % (Schritt 4 unten).

App Check stellt sicher, dass nur Anfragen von **deiner** offiziellen Web-App
(über die Live-Domain `pantrio-8sc.pages.dev`) auf RTDB und Auth zugreifen
können. Bot-Traffic, gescriptete Angriffe und gestohlene API-Keys werden
geblockt, bevor sie die Datenbank erreichen.

## Aktivierung in 4 Schritten

### 1. reCAPTCHA v3 Site-Key registrieren
1. Öffne <https://www.google.com/recaptcha/admin/create>
2. **Label:** `pantrio`
3. **Typ:** reCAPTCHA v3
4. **Domains:** `pantrio-8sc.pages.dev` (und `localhost` für lokale Tests)
5. AGB akzeptieren → Speichern
6. **Site-Key** und **Secret-Key** notieren (Site-Key ist public, Secret-Key bleibt geheim).

### 2. App Check in Firebase Console aktivieren
1. <https://console.firebase.google.com/project/pantrio-de/appcheck>
2. App auswählen (Web-App `pantrio`)
3. Provider **reCAPTCHA v3** wählen → Site-Key aus Schritt 1 eintragen → Speichern.

### 3. Client-Code aktivieren
Sobald der Site-Key vorliegt: das folgende Snippet in `index.html` direkt
nach `initializeApp` einfügen:

```js
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('DEIN_SITE_KEY_HIER'),
  isTokenAutoRefreshEnabled: true
});
```

### 4. Enforcement aktivieren
Nach 24 h Beobachtungsphase ohne Fehlerflut in der Console:
1. App Check → Realtime Database → **Enforce** aktivieren
2. App Check → Authentication → **Enforce** aktivieren

Ab dann werden Requests **ohne** gültiges App-Check-Token abgewiesen.

## Was passiert, wenn ich es jetzt schon einbinde?

Nichts Schlimmes: solange Enforcement noch **nicht** aktiv ist, sammelt
Firebase nur Telemetrie. Die App läuft normal weiter.

## Verlauf

- **2026-04-30** – Plan dokumentiert, Snippet in `index.html` (später nach `app.js`)
  vorbereitet, App-Check-Console-Provider hinterlegt.
- **2026-05-05 (v0.9.2)** – Verified-Quote stand auf 0 %. Ursache: in `initializeApp(...)`
  fehlten `appId`, `storageBucket` und `messagingSenderId` → Token-Exchange-URL endete auf
  `apps/undefined:exchangeRecaptchaV3Token` → 400 → `appCheck/throttled`. Mit der
  vollständigen Firebase-Web-App-Config behoben. Verified-Quote klettert seitdem.
- **Pending** – Enforcement aktivieren, sobald Verified-Quote ≥ 99 % stabil
  (24 h Beobachtungsphase ab dem Fix).

## Lessons Learned

- App Check **muss** mit der vollständigen Firebase-Config initialisiert werden,
  nicht nur `apiKey` + `authDomain` + `databaseURL` + `projectId`. Der `appId` ist
  zwingend, sonst kann Firebase die App nicht zuordnen und keine Tokens validieren.
- Symptom für falsche Config: `apps/undefined:` in der Token-Exchange-URL und
  `Provided AppCheck credentials … are invalid` aus dem Database-Logger.
