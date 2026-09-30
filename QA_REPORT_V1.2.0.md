# QA-Bericht v1.2.0

Automatisierter lokaler QA-Durchlauf: **40/40 Tests bestanden**.

Geprüft wurden u. a.:
- Health- und Version-Endpunkt
- HTML und PWA
- alle 25 Fotothemen und JPEG-Dateien
- `photoTasks.json`
- Service-Worker-Cache v1.2.0
- 404 bei fehlenden Assets
- Security Header / Origin-Schutz
- Realtime ohne API-Key sauber abgefangen
- getrennte Rollen **KI-Prüferin** und **KI-Gesprächspartner**
- automatische Exam-State-Machine
- Exam-Realtime mit serverseitig deaktiviertem Auto-Response zwischen gesteuerten Prüfungsschritten
- Training: Regel gegen unbegründetes Lob
- Training: Worterklärung nur auf Anfrage mit Beispielen
- Render Blueprint
- keine echte `.env` im Paket

Nicht lokal end-to-end testbar war die echte OpenAI-WebRTC-Verbindung mit deinem persönlichen API-Key. Dieser Test erfolgt nach Render-Deployment im Browser auf PC/Handy/Tablet.
