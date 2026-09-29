# QA-Bericht – v1.1.0 / 25 Fotos

Status: **BESTANDEN**

Automatisierte lokale QA: **37/37 Tests bestanden**.

Geprüft wurden:

- Serverstart und `/api/health`
- `/api/version`
- Startseite und Bild-Elemente
- `data/photoTasks.json` mit exakt 25 eindeutigen Aufgaben
- alle 25 JPEG-Dateien: HTTP 200, korrekter MIME-Typ, JPEG-Signatur, Mindestgröße
- PWA-Manifest
- Service Worker Cache-Version `dtz-speaking-v1.1.0`
- Realtime-Endpunkt ohne API-Key: sauberer 503-Fallback
- fehlendes Asset: korrekter HTTP 404
- Security Header und Mikrofon-Permissions-Policy
- fremder Origin wird für den Realtime-Endpunkt blockiert
- Render Blueprint/Healthcheck
- keine echte `.env` im Paket

## Behobene Punkte

- Bildbibliothek von 3 auf 25 Themen erweitert.
- Bilddaten aus dem Code in `data/photoTasks.json` ausgelagert.
- Teil 2B verwendet eine zum jeweiligen Foto passende Erfahrungsfrage.
- Cache-Version erhöht, damit alte Browser-/PWA-Dateien nach Deployment nicht weiter angezeigt werden.
- 25 Fotos werden beim Start validiert.

## Noch extern zu testen

Ein vollständiger End-to-End-Test von **Render → OpenAI Realtime → echtes Mikrofon/Audio** benötigt deinen aktiven Render-Dienst, deinen OpenAI-API-Key und ein reales Endgerät.
