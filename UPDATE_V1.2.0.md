# Update v1.2.0 – Realistische DTZ-Sprechprüfung + sachlicher KI-Trainer

## Neu im Prüfungsmodus

Die sichtbare Prüfung läuft jetzt in drei Phasen:

1. **Sich vorstellen** – KI-Prüferin stellt die Aufgabe und danach eine sachliche Nachfrage.
2. **Bild beschreiben + eigene Erfahrungen** – KI-Prüferin zeigt das Foto, hört die Beschreibung und stellt danach eine persönliche Nachfrage zum Thema.
3. **Gemeinsam planen** – eine getrennte KI-Rolle übernimmt als **KI-Gesprächspartner / Kandidat B** und führt ein echtes Planungsgespräch mit Vorschlägen, Rückfragen, Einwänden und Gegenvorschlägen.

Intern bleiben die DTZ-Unterabschnitte 1A, 1B, 2A, 2B und 3 für die Bewertung erhalten.

Während der Live-Prüfung:
- keine Korrektur
- kein Lob oder Tadel
- keine Übersetzung
- keine Musterantwort
- keine Punkte oder Niveauhinweise
- kein sichtbares Transkript
- automatischer Wechsel zwischen den Prüfungsabschnitten

## Neu im Training

Der KI-Trainer wurde auf sachliches Feedback umgestellt:
- kein automatisches Lob
- konkrete positive Rückmeldung nur bei erkennbarer Evidenz
- „perfekt“, „super“, „toll“ oder „sehr gut“ nicht ohne klaren Grund
- höchstens 1–2 konkrete Verbesserungen pro Runde
- Aussprache/Wortschatz nur loben, wenn tatsächlich erkennbar stark

### Wörter erklären
Der Lernende kann im Live-Gespräch jederzeit fragen, z. B.:
- „Was bedeutet *zuverlässig*?“
- „Ich verstehe das Wort *vereinbaren* nicht.“

Dann erklärt der KI-Trainer:
1. kurze Bedeutung in einfachem Deutsch
2. 1–2 alltagsnahe Beispielsätze
3. bei Bedarf ein einfaches Synonym oder Gegenbeispiel
4. danach Rückkehr zur Übung

## Update bei GitHub / Render

1. ZIP entpacken.
2. In GitHub `dtz-speaking-trainer` öffnen.
3. **Add file → Upload files**.
4. Alle Dateien aus dem Update-Ordner hineinziehen und vorhandene Dateien überschreiben.
5. **Commit changes**.
6. Render deployt normalerweise automatisch. Falls nicht: **Manual Deploy → Deploy latest commit**.
7. App danach neu laden; am PC einmal **Strg+F5**.

Die 25 Fotos und `data/photoTasks.json` bleiben unverändert.
