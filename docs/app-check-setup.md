# Firebase App Check – Setup-Plan für pantrio

> Status: **vorbereitet, nicht aktiviert**.
> Aktivierung pending: reCAPTCHA-v3-Site-Key vom Owner.

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

## Was du dem Assistenten geben musst

- Den **Site-Key** (kann öffentlich im Code stehen, ist kein Secret).

Sobald der vorliegt, baut der Assistent das Snippet in `index.html` ein,
committet, und du aktivierst Enforcement im Console-Schritt 4.
