# Security-Rules Tests

Lokale Unit-Tests für die Firebase RTDB Security-Rules von **pantrio**, basierend auf dem Firebase Emulator Suite und `@firebase/rules-unit-testing`.

## Voraussetzungen

- **Node.js** ≥ 18
- **Java** ≥ 11 (wird vom Firebase Emulator gebraucht)
- npm

## Installation

```bash
npm install
```

## Tests ausführen

```bash
npm test
```

Das startet automatisch den Firebase-Database-Emulator auf Port 9000, lädt
`database.rules.json` und führt anschließend die Mocha-Test-Suite gegen diese
Rules aus.

## Was wird getestet?

Die Test-Suite (`tests/rules.spec.js`) deckt die zentralen Sicherheits-
Eigenschaften ab:

- `/familyCodes`: Enumeration blockiert, einzelner Lookup erlaubt, Schreiben
  nur durch Admin der Zielfamilie, kein Hijack, Löschen für Code-Rotation
  funktioniert.
- `/families`: Lesen nur für Member, ungeschützte Reads blockiert.
- `/families/$id/members/$uid`: Self-Join nur mit gültigem `joinCode` für
  genau diese Familie, fremde Member-Slots schreibgeschützt.
- `/users`: Strikte User-Isolation.
- Anonymer Zugriff: alle Top-Level-Knoten blockiert.

## Bei Änderungen an den Rules

Vor dem Push die Tests laufen lassen — ein Bruch in Erwartungen ist meist
ein Hinweis auf eine Regression. Falls lokale Voraussetzungen (Node.js + Java)
nicht installiert sind, läuft die Suite ohnehin in CI bei jedem Push (siehe unten).

## CI

Eingerichtet seit 2026-05-05 in [`.github/workflows/rules-tests.yml`](../.github/workflows/rules-tests.yml).
Der Workflow läuft automatisch bei jedem Push und PR auf `main`, der eine der
folgenden Dateien berührt:

- `database.rules.json`
- `tests/**`
- `package.json` / `package-lock.json`
- `firebase.json`
- der Workflow selbst

Reine UI-Änderungen (`app.js`/`app.css`/`index.html`) lösen ihn nicht aus
(Path-Filter spart CI-Minuten). Manuell triggerbar via `workflow_dispatch`
im Actions-Tab des Repos.

**Pipeline:** Checkout → Node 20 → Java 17 (Temurin) → `npm install` → `npm test`.
Erwartet: **24 passing**, Gesamtlaufzeit ≈ 2 Min.

Status badge:

[![Rules Tests](https://github.com/DaloYice/pantrio/actions/workflows/rules-tests.yml/badge.svg)](https://github.com/DaloYice/pantrio/actions/workflows/rules-tests.yml)
