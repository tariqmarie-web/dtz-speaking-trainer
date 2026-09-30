# DTZ Speaking Trainer – Render Edition v1.1.0

## Neu in v1.1.0: 25 Bildaufgaben

Die App enthält jetzt **25 lokale Übungsfotos zu unterschiedlichen DTZ-nahen Alltagsthemen**. Die Bildbibliothek wird automatisch aus `data/photoTasks.json` geladen. Für **Teil 2A** wird ein Foto zufällig gewählt; **Teil 2B** verwendet dasselbe Foto und eine thematisch passende Nachfrage. Im Trainingsmodus wechselt **„Anderes Foto“** durch alle 25 Themen.

Die Bilder sind **KI-generierte, fiktive Übungsbilder** und keine offiziellen telc-/BAMF-Prüfungsbilder.

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
## Version 1.2.0

- Prüfungsmodus mit getrennten Rollen: **KI-Prüferin** und **KI-Gesprächspartner (Kandidat B)**
- automatischer Live-Prüfungsablauf durch Sich vorstellen → Bild/Erfahrungen → Gemeinsam planen
- sachlicher Prüfungsstil ohne Lob/Hilfe während der Prüfung
- sachlicher Trainingscoach ohne pauschales Lob
- Worterklärung auf ausdrückliche Nachfrage des Lernenden mit einfachen Beispielen
- 25 Fotothemen bleiben vollständig erhalten


## Version 1.3.0 – DTZ-Bewertung am Prüfungsende

Die Prüfung erzeugt am Ende jetzt nur dann eine Punktbewertung, wenn ausreichende Evidenz vorhanden ist. Die Bewertung orientiert sich am veröffentlichten DTZ-Sprech-Raster (telc Übungstest 1, 3. Auflage 2024): Aufgabenbewältigung in Teil 1A, 1B, 2A, 2B und Teil 3 sowie Aussprache/Intonation, Flüssigkeit, Korrektheit und Wortschatz.

Wichtig: Die KI wählt zunächst eine Kriterien-Stufe (B1 gut erfüllt / B1 erfüllt / A2 gut erfüllt / A2 erfüllt / A1 erfüllt / nicht erfüllt). Erst danach rechnet der Server deterministisch die zugehörigen Punkte aus. Es wird keine Punktzahl „nach Gefühl“ erzeugt.

Aussprache/Intonation und Flüssigkeit werden über zwei verdeckte Bewertungen im laufenden Realtime-Audio-Kontext eingeschätzt. Aufgabenbewältigung, Korrektheit und Wortschatz werden zusätzlich von zwei unabhängigen Bewertungsdurchläufen anhand der Transkripte beurteilt. Fehlt die Audio-Evidenz oder schlägt die Bewertung fehl, zeigt die App bewusst keine erfundene Ersatznote an.
