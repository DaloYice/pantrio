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
ein Hinweis auf eine Regression.

## CI

(Optional, später) – Diese Tests können in einer GitHub Actions Pipeline
laufen, sobald wir CI einrichten.
