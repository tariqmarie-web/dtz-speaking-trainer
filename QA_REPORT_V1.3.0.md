# QA Report v1.3.0 – DTZ-Bewertung

## Ergebnis

**43/43 automatisierte QA-Tests bestanden.**

## Neu geprüft

- kriteriumsorientierte DTZ-Stufen sind im Server hinterlegt
- Punkte werden serverseitig deterministisch aus der gewählten Kriterien-Stufe berechnet
- Teil 1A, 1B, 2A, 2B und Teil 3 werden separat bewertet
- Aussprache/Intonation und Flüssigkeit verlangen zwei verdeckte Live-Audio-Bewertungen
- Korrektheit und Wortschatz werden durch zwei unabhängige Transkript-Bewerter beurteilt
- bei unvollständiger Bewertung wird **keine Ersatznote** erzeugt
- Ergebnis enthält Bewertungsstufen und aufklappbare Evidenz
- 25 Fotos weiterhin vollständig erreichbar
- PWA-/Service-Worker-Cache auf v1.3.0 aktualisiert
- Render Blueprint bleibt gültig
- kein echter `.env`/API-Key im Paket

## Bestehende QA

- Health- und Version-Endpunkte
- HTML und Fotoelemente
- 25/25 Bilddateien als gültige JPEGs
- Fotobibliothek mit 25 eindeutigen Aufgaben
- Manifest und Service Worker
- fehlende Assets -> HTTP 404
- Security Header
- Fremd-Origin-Schutz
- getrennte Rollen KI-Prüferin / KI-Gesprächspartner
- sachliches Trainingsfeedback und Worterklärung nur auf Nachfrage
- kontrollierte Exam-State-Machine

## Noch live zu testen

Die automatisierte QA kann ohne deinen Render-API-Key nicht den kompletten externen Pfad testen:

Browser-Mikrofon -> OpenAI Realtime -> verdeckte Audio-Bewertung -> zwei Text-Bewerter -> finales Ergebnis.

Dieser End-to-End-Test muss nach dem Render-Deploy im echten Browser durchgeführt werden.
