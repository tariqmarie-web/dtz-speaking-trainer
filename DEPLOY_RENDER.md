# DTZ Speaking Trainer auf Render deployen

## Ziel
Nach dem Deployment läuft dieselbe Web-App auf PC, Android-Handy und Android-Tablet über HTTPS. Der OpenAI-Key bleibt ausschließlich auf Render.

## 1. GitHub-Repository anlegen
1. Auf GitHub ein neues Repository `dtz-speaking-trainer` anlegen.
2. Den kompletten Inhalt dieses Ordners hochladen.
3. **Nicht** `.env` hochladen. `.gitignore` schützt diese Datei bereits.

## 2. Render verbinden
1. Auf https://render.com anmelden.
2. `New` → `Blueprint` auswählen.
3. Das GitHub-Repository auswählen.
4. Render erkennt `render.yaml` und legt den Web Service an.
5. Bei `OPENAI_API_KEY` den echten OpenAI-Projekt-Key als Secret eintragen.
6. Deployment starten.

Alternative ohne Blueprint: `New` → `Web Service`, Node, Build `npm install`, Start `npm start`, Health Check `/api/health`.

## 3. Nach dem Deployment prüfen
Öffne zuerst:

`https://DEIN-DIENST.onrender.com/api/health`

Erwartet wird ungefähr:

```json
{
  "ok": true,
  "openaiConfigured": true,
  "realtimeModel": "gpt-realtime-2.1",
  "evaluationModel": "gpt-5.6-terra",
  "version": "1.1.0-render"
}
```

Danach die Hauptadresse öffnen.

## 4. Auf Android installieren
1. Adresse in Chrome öffnen.
2. Mikrofon erlauben.
3. Entweder den eingeblendeten Button `App installieren` verwenden oder Chrome-Menü → `Zum Startbildschirm hinzufügen`.
4. Danach startet die Web-App wie eine normale App, bleibt aber browserbasiert.

## 5. Render Free beachten
Ein kostenloser Render-Webservice kann nach Inaktivität schlafen. Beim ersten Zugriff kann der Start deshalb dauern. Die App prüft `/api/health` wiederholt und zeigt währenddessen `Cloud-Server wird gestartet …`.

## 6. OpenAI-Kosten
Render kann kostenlos sein. OpenAI Realtime und die KI-Bewertung verbrauchen separat API-Guthaben.

## 7. Updates
Nach einem Push auf den verbundenen Git-Branch deployt Render automatisch neu. Der Service Worker verwendet versionierte Caches, damit alte Bild-/JavaScript-Dateien nicht dauerhaft angezeigt werden.
