# QA-Bericht – DTZ Speaking Trainer Render Edition 1.0

Datum: 29.09.2026

## Ergebnis
Lokale automatisierte QA: **14/14 Tests bestanden**.

## Geprüft
- Node.js-Syntax: `server.js`, `realtime.js`, `app.js`
- Serverstart und `/api/health`
- `/api/version`
- Startseite wird als HTML ausgeliefert
- Trainings-Fotoelement vorhanden
- Prüfungs-Fotoelement vorhanden
- alle drei JPEG-Fotos erreichbar, korrekter MIME-Type und gültiger JPEG-Header
- PWA-Manifest gültig
- Service Worker erreichbar und neue Cache-Version aktiv
- Live-Endpunkt lehnt fehlenden API-Key verständlich ab
- fehlende Assets liefern korrekt 404 statt versehentlich HTML
- Security-Header aktiv, inklusive Mikrofon-Berechtigungsrichtlinie
- fremder Origin wird beim Live-Endpunkt blockiert
- `render.yaml` enthält Start- und Health-Konfiguration
- keine `.env` mit Geheimnissen im Paket

## Gefundene und behobene Bugs
1. **Render-Port/Host:** vorher lokal auf `127.0.0.1`; jetzt standardmäßig `0.0.0.0` und `$PORT`.
2. **Foto-Cacheproblem:** alter Service-Worker konnte alte UI-Dateien halten; neue Cache-Version und Network-First für HTML/JS/CSS.
3. **Fehlende Fotos:** Server lieferte bei fehlendem Asset fälschlich `index.html` mit HTTP 200; jetzt 404.
4. **Live-Verbindung:** Browser musste früher direkt zu OpenAI verbinden; jetzt serververmittelte Realtime-Session über Same-Origin-Endpunkt.
5. **Mobile WebRTC-Stabilität:** ICE-Gathering-Wartezeit, Echo-Cancellation, Noise-Suppression und bessere Verbindungsfehler ergänzt.
6. **Sprachlernpausen:** Semantic VAD auf `eagerness: low` gestellt, damit Lernende weniger schnell unterbrochen werden.
7. **Cloud-Wakeup:** Health-Polling ergänzt, damit Render-Free-Kaltstarts verständlich angezeigt werden.
8. **API-Schutz:** Same-Origin-Prüfung und einfaches Rate-Limit ergänzt.
9. **PWA-Updates:** Service Worker räumt alte Caches auf; Versionierung in JS/CSS-URLs ergänzt.

## Noch nicht End-to-End testbar in dieser Umgebung
- echte OpenAI-Realtime-Sitzung mit deinem API-Key
- tatsächliche Render-Cloud-URL
- Mikrofon auf deinem konkreten Android-Handy/Tablet
- echte API-Billing-/Rate-Limit-Situation

Diese vier Punkte müssen nach dem ersten Render-Deployment als Smoke-Test geprüft werden.

## Release-Status
**M1 – Render Ready: bestanden.**

Nächster Meilenstein: M2 – Live Voice Smoke Test auf Render mit PC, Android-Handy und Android-Tablet.
