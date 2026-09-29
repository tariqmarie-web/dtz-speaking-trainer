# Integrationsvertrag – DTZ Speaking Trainer 0.2

## 1. Realtime Voice

Der Browser verwendet WebRTC. Ein dauerhafter OpenAI API-Key darf niemals an den Client ausgeliefert werden.

### `POST /api/realtime/token`

Input:

```json
{
  "mode": "training",
  "examPart": "3",
  "trainingTopic": "plan",
  "scenario": "Ausflug organisieren",
  "userId": "privacy-preserving-internal-id"
}
```

Backend erzeugt ein kurzlebiges Client-Secret für eine Realtime-Session.

### Realtime-Regeln im Prüfungsmodus

- keine Korrektur
- keine Übersetzung
- keine Musterantwort
- keine Punkte während der Prüfung
- keine A2/B1-Hinweise
- dynamische Reaktion auf tatsächliche Schülerantwort
- kein selbstständiger Wechsel des Prüfungsteils
- State Machine bleibt in der App

## 2. Prüfungsteile

```text
PRECHECK
→ 1A
→ 1B
→ 2A
→ 2B
→ 3
→ EVALUATION
→ RESULT
```

Eine Realtime-Session darf über `session.update` neue teilbezogene Instruktionen erhalten, damit der Gesprächskontext erhalten bleibt.

## 3. Transkription

Schülertranskripte werden aus den Realtime-Ereignissen gesammelt:

- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed`

KI-Sprachausgabe kann über Output-Audio-Transcript-Ereignisse im UI dargestellt werden.

## 4. Doppelbewertung

### `POST /api/exam/evaluate`

Input:

```json
{
  "answers": [
    {"id":"1A","text":"...","max":5,"metrics":{}},
    {"id":"1B","text":"...","max":5,"metrics":{}},
    {"id":"2A","text":"...","max":10,"metrics":{}},
    {"id":"2B","text":"...","max":10,"metrics":{}},
    {"id":"3","text":"...","max":20,"metrics":{}}
  ],
  "interactionMetrics": {}
}
```

Evaluator A und B arbeiten unabhängig voneinander.

Erlaubte Rasterwerte:

- 1A / 1B: `0,1,2,3,4,5`
- 2A / 2B: `0,2,4,6,8,10`
- Teil 3: `0,4,8,12,16,20`
- Aussprache/Intonation: `0,2,4,6,8,10`
- Flüssigkeit: `0,2,4,6,8,10`
- Korrektheit: `0,3,6,9,12,15`
- Wortschatz: `0,3,6,9,12,15`

Die Anwendung mittelt die beiden unabhängigen Bewertungen. Dadurch sind halbe Gesamtpunkte möglich.

## 5. Aktuelle Grenze

Version 0.2 bewertet serverseitig Transkript und Interaktionsmetriken. Vollständig belastbare Aussprache-/Intonationsbewertung benötigt im nächsten Schritt eine separate Audio-Evaluation und Kalibrierung gegen menschliche DTZ-erfahrene Bewerter.
