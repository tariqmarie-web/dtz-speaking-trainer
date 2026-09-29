# DTZ Speaking Trainer – Render Cloud Edition 1.0

Browserbasierter DTZ-Sprechtrainer für PC, Android-Handy und Android-Tablet.

## Enthalten
- natürliches Live-Sprachgespräch über WebRTC
- serververmittelte OpenAI-Realtime-Verbindung; API-Key nie im Browser
- Trainingsmodus und Prüfungsmodus getrennt
- DTZ-Teile 1A, 1B, 2A, 2B und 3
- echte integrierte Bilddateien für Bildbeschreibung
- drei Bildszenarien mit Wechsel-Funktion
- PWA/Startbildschirm-Unterstützung
- responsive Oberfläche für Desktop, Handy und Tablet
- Cloud-Warmup/Health-Check für Render Free
- zwei unabhängige textbasierte KI-Bewertungen mit deterministischer Punkteaggregation
- lokaler Fallback für Spracheingabe, falls Live-KI nicht verfügbar ist

## Produktion
Die Cloud-Version verwendet standardmäßig:
- Voice: `gpt-realtime-2.1`
- Bewertung: `gpt-5.6-terra`
- Stimme: `marin`

Alle Modelle sind über Render Environment Variables austauschbar.

## Schnell lokal testen
Node.js 22.6+ verwenden.

```bash
cp .env.example .env
# OPENAI_API_KEY in .env eintragen
npm start
```

Dann `http://localhost:10000` öffnen.

## Render
Siehe `DEPLOY_RENDER.md`.

## Sicherheit
- `OPENAI_API_KEY` nur serverseitig.
- Live-Session-Erstellung ist Same-Origin-geschützt und einfach rate-limitiert.
- Mikrofonberechtigung gilt nur für die Web-App.
- Auf öffentlicher Nutzung sollte später eine Benutzeranmeldung ergänzt werden.

## Wichtiger Bewertungs-Hinweis
Die aktuelle Punktebewertung ist eine **DTZ-orientierte Simulation**, kein offizielles Prüfungsergebnis. Die Audio-spezifische automatische Kalibrierung von Aussprache/Intonation ist noch ein eigener Entwicklungsmeilenstein.

## Foto-Fix
Bei `Bild beschreiben` wird jetzt ein echtes `<img>` aus `/assets/` verwendet. Zusätzlich prüft die App beim Start, ob die Bilddateien tatsächlich als Bild ausgeliefert werden. Der Service Worker löscht alte Caches bei Versionswechsel.
