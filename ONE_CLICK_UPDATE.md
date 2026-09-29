# ONE-CLICK-UPDATE: 25 Fotos

Dein bestehendes Render-/GitHub-Projekt muss **nicht neu eingerichtet** werden.

## Einmalig aktualisieren

1. ZIP `dtz-speaking-render-v1.1.0_25_FOTOS_ONE_CLICK.zip` entpacken.
2. GitHub öffnen: Repository `dtz-speaking-trainer`.
3. **Add file → Upload files**.
4. Den **gesamten Inhalt** des entpackten Ordners hineinziehen. Vorhandene Dateien dürfen ersetzt werden.
5. **Commit changes**.
6. Render erkennt den Commit automatisch und deployt neu. Falls nicht: **Manual Deploy → Deploy latest commit**.
7. Nach „Live“ die App öffnen und einmal **Strg+F5** drücken. Auf Android Chrome die Seite/App einmal komplett schließen und neu öffnen.

Danach sind automatisch 25 Fotos verfügbar. Es ist **keine manuelle Änderung in `app.js`** nötig.

## Themen

1. Schule
2. Kindergarten
3. Einkaufen
4. Arztbesuch
5. Apotheke
6. Arbeit
7. Büro
8. Wohnen
9. Umzug
10. Bus und Bahn
11. Bahnhof
12. Verkehr
13. Familie
14. Freizeit
15. Sport
16. Park
17. Restaurant
18. Nachbarschaft
19. Behörde
20. Post und Paket
21. Reise
22. Feier
23. Handwerker
24. Telefon und Kommunikation
25. Ausflug

## Automatik

- Trainingsmodus: „Anderes Foto“ wechselt durch alle 25 Bilder.
- Prüfung Teil 2A: zufällige Bildaufgabe.
- Prüfung Teil 2B: dasselbe Bild bleibt bestehen; passende Erfahrungsfrage wird verwendet.
- Live-KI erhält intern die Bildbeschreibung und das Thema, ohne dem Lernenden die Lösung vorzusagen.
- Service Worker Version 1.1.0 löscht den alten Cache beim Update.
