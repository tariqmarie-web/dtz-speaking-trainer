import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load a local .env file without extra dependencies. Existing process env values win.
try {
  const envPath = path.join(__dirname, ".env");
  const raw = fsSync.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}

const APP_VERSION = process.env.APP_VERSION || '1.3.0-render';
const DTZ_RUBRIC_VERSION = 'telc-DTZ-5010-B00-020101-3.Auflage2-2024';
const DTZ_RUBRIC_SOURCE = 'telc Deutsch-Test für Zuwanderer A2-B1, Übungstest 1, Bewertungskriterien Sprechen';
const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || '0.0.0.0';
const rawApiKey = (process.env.OPENAI_API_KEY || "").trim();
const apiKey = rawApiKey && !/^(sk-)?\.\.\.$/.test(rawApiKey) && rawApiKey !== "sk-..." ? rawApiKey : "";
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
const evaluationModel = process.env.OPENAI_EVALUATION_MODEL || "gpt-5.6-terra";
const voice = process.env.OPENAI_VOICE || "marin";
const examinerVoice = process.env.OPENAI_EXAMINER_VOICE || voice;
const partnerVoice = process.env.OPENAI_PARTNER_VOICE || voice;
const trainerVoice = process.env.OPENAI_TRAINER_VOICE || voice;
const transcriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);

function safeUserHash(userId = "anonymous") {
  return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 32);
}

const partGuidance = {
  "1A": "Der Kandidat stellt sich selbstständig vor. Lass ihn zusammenhängend sprechen. Frage nicht jeden Stichpunkt einzeln ab.",
  "1B": "Stelle 1–2 natürliche Nachfragen, die sich konkret auf das zuvor Gesagte beziehen.",
  "2A": "Der Kandidat beschreibt eine Alltagsszene. Höre zuerst zu und frage nur knapp nach, wenn die Beschreibung sehr früh endet.",
  "2B": "Bitte den Kandidaten um eigene Erfahrungen, passend zur vorherigen Bildbeschreibung.",
  "3": "Du bist der zweite Prüfungsteilnehmer. Plant gemeinsam. Stimme nicht allem zu; bringe realistische Präferenzen, Einwände und Gegenvorschläge ein."
};

function buildRealtimeInstructions({ mode = "training", examPart = "3", trainingTopic = "plan", scenario = "", agentRole = "trainer" } = {}) {
  const common = `
Du sprichst klares, natürliches Standarddeutsch auf einem für DTZ A2-B1 geeigneten Niveau.
Reagiere auf den konkreten Inhalt der letzten Äußerung und arbeite nicht wie ein Fragebogen.
Lass Sprachlernenden Denkpausen und unterbrich nicht vorschnell.
`;

  if (mode === "exam") {
    if (agentRole === "partner") {
      return `${common}
ROLLE: KI-GESPRÄCHSPARTNER / KANDIDAT B IN TEIL 3.
Du simulierst ernsthaft und sachlich den zweiten Prüfungsteilnehmenden beim gemeinsamen Planen.
${scenario ? `Aufgabenszenario: ${scenario}` : ""}
Regeln:
- Führe ein echtes Planungsgespräch, keine Unterrichtssituation.
- Reagiere auf Vorschläge, stelle Rückfragen, bringe eigene Vorschläge und realistische Einwände ein.
- Stimme nicht automatisch zu. Verhandle höflich über mindestens zwei Punkte, bis ein gemeinsamer Plan entsteht.
- Hilf sprachlich NICHT: keine Korrektur, keine Satzanfänge, keine Übersetzung, keine Musterantworten.
- Kein Lob, kein Tadel, keine Punkte, keine Niveauhinweise.
- Bleibe ausschließlich bei Teil 3 und verhalte dich wie ein Prüfungsteilnehmer, nicht wie ein Lehrer.
- Halte Beiträge eher kurz, damit der Kandidat ausreichend Redeanteil hat.
`;
    }

    return `${common}
ROLLE: KI-PRÜFERIN.
Du simulierst eine sachliche, professionelle DTZ-Prüferin. Auftreten: ruhig, neutral, ernsthaft, höflich und knapp.
Aktueller interner Prüfungsteil: ${examPart}.
${partGuidance[examPart] || "Bleibe beim aktuellen DTZ-Prüfungsteil."}
${scenario ? `Aufgabenszenario: ${scenario}` : ""}
Regeln:
- Keine Grammatik-Korrektur, keine Übersetzung, keine Musterantwort, keine sprachliche Hilfestellung.
- Kein Lob wie „super“, „toll“, „sehr gut“ und kein Tadel während der Prüfung.
- Keine Punkte, keine A2/B1-Hinweise und keine Bewertung während der Prüfung.
- Stelle nur prüfungsrelevante Aufgaben und Nachfragen. Keine Plauderei.
- Wechsle niemals eigenständig den Prüfungsteil; die Anwendung steuert den Ablauf.
`;
  }

  return `${common}
ROLLE: KI-TRAINER.
Trainingsschwerpunkt: ${trainingTopic}.
${scenario ? `Szenario: ${scenario}` : ""}
Dein Feedback muss fair, sachlich und evidenzbasiert sein.
- Lobe NICHT automatisch nach jeder Antwort.
- Sage nicht „perfekt“, „super“, „toll“ oder „sehr gut“, wenn du dafür keine klare sprachliche Evidenz hast.
- Wenn etwas wirklich stark ist, benenne konkret warum, z. B. klare Aussprache, treffender Wortschatz, gute Satzverknüpfungen oder flüssige Interaktion.
- Bei durchschnittlicher Leistung formuliere neutral: was verständlich war und was als Nächstes verbessert werden sollte.
- Korrigiere nicht jeden kleinen Fehler; priorisiere Verständlichkeit, Aufgabenbewältigung, Interaktion, Flüssigkeit, Wortschatz und wichtige B1-Muster.
- Gib höchstens 1–2 konkrete Verbesserungen pro Runde und lass den Lernenden danach erneut sprechen.
WORTERKLÄRUNG:
- Erkläre neue Wörter nur, wenn der Lernende danach fragt oder ausdrücklich sagt, dass er ein Wort nicht versteht.
- Dann: kurze Bedeutung in einfachem Deutsch, 1–2 alltagsnahe Beispielsätze und bei Bedarf ein einfaches Synonym/Gegenbeispiel.
- Danach kehre zum Gespräch zurück.
- Tue nicht so, als wüsstest du sicher, dass ein Wort neu ist, wenn der Lernende das nicht signalisiert hat.
`;
}

function makeRealtimeSession({ mode = "training", examPart = "3", trainingTopic = "plan", scenario = "", agentRole = "trainer" } = {}) {
  const selectedVoice = mode === "exam" ? (agentRole === "partner" ? partnerVoice : examinerVoice) : trainerVoice;
  return {
    type: "realtime",
    model: realtimeModel,
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: transcriptionModel },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: mode !== "exam",
          interrupt_response: mode !== "exam"
        }
      },
      output: { voice: selectedVoice }
    },
    instructions: buildRealtimeInstructions({ mode, examPart, trainingTopic, scenario, agentRole })
  };
}

const evidenceSchema = { type: "array", items: { type: "string" }, maxItems: 6 };
const bandValues = ["B1_GUT", "B1_ERFUELLT", "A2_GUT", "A2_ERFUELLT", "A1_ERFUELLT", "0"];
const bandLabels = {
  B1_GUT: "B1 gut erfüllt",
  B1_ERFUELLT: "B1 erfüllt",
  A2_GUT: "A2 gut erfüllt",
  A2_ERFUELLT: "A2 erfüllt",
  A1_ERFUELLT: "A1 erfüllt",
  "0": "nicht erfüllt"
};

function bandObjectSchema() {
  return {
    type: "object",
    properties: {
      band: { type: "string", enum: bandValues },
      evidence: evidenceSchema
    },
    required: ["band", "evidence"],
    additionalProperties: false
  };
}

const evaluationSchema = {
  type: "object",
  properties: {
    taskAchievement: {
      type: "object",
      properties: {
        "1A": bandObjectSchema(),
        "1B": bandObjectSchema(),
        "2A": bandObjectSchema(),
        "2B": bandObjectSchema(),
        "3": bandObjectSchema()
      },
      required: ["1A", "1B", "2A", "2B", "3"],
      additionalProperties: false
    },
    accuracy: bandObjectSchema(),
    vocabulary: bandObjectSchema(),
    strengths: { type: "array", items: { type: "string" }, maxItems: 4 },
    priorities: { type: "array", items: { type: "string" }, maxItems: 4 },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["taskAchievement", "accuracy", "vocabulary", "strengths", "priorities", "confidence"],
  additionalProperties: false
};

const BAND_FACTOR = {
  B1_GUT: 1,
  B1_ERFUELLT: 0.8,
  A2_GUT: 0.6,
  A2_ERFUELLT: 0.4,
  A1_ERFUELLT: 0.2,
  "0": 0
};

function pointsForBand(band, maxPoints) {
  const f = BAND_FACTOR[band];
  if (typeof f !== "number") throw new Error(`Unbekannte DTZ-Bewertungsstufe: ${band}`);
  return maxPoints * f;
}

function officialRubricPrompt() {
  return `Verbindliche Bewertungslogik (${DTZ_RUBRIC_VERSION}):
- Zuerst kriteriumsorientiert einstufen, erst danach rechnet der Server die offiziellen Punkte aus. Du selbst rechnest KEINE Punkte.
- Stufen: B1 gut erfüllt, B1 erfüllt, A2 gut erfüllt, A2 erfüllt, A1 erfüllt, nicht erfüllt.
- Teil 1A: B1 = zusammenhängende Vorstellung mit auch detaillierteren Angaben; A2 = knappe allgemeine Angaben; A1 = weitgehend unverbundene Einzelangaben.
- Teil 1B: B1 = relativ spontan und ausführlich auf Nachfragen reagieren; A2 = knapp bzw. teilweise verständlich; A1 = einzelne Wörter/gelernte Wendungen bei sehr einfacher Nachfrage.
- Teil 2A: B1 = Hauptinhalte des Fotos plus relevante Einzelheiten; A2 = Hauptinhalt knapp und allgemein; A1 = nur wenige Wörter/Andeutungen.
- Teil 2B: B1 = eigene Erfahrungen auf Nachfrage teilweise detailliert berichten; A2 = knapp/allgemein; A1 = einzelne Wörter oder sehr knappe Äußerungen.
- Teil 3: B1 = Gespräch beginnen und in Gang halten, spontan planen, Ideen/Meinungen/Vorschläge äußern und darauf reagieren; A2 = mit Fragen/Antworten und einfachen Vorschlägen teilnehmen, Gespräch aber nur begrenzt selbst tragen; A1 = auf Wiederholen/Umformulieren angewiesen und nur sehr einfache Beiträge.
- Korrektheit: B1 = trotz Fehlern im Allgemeinen gute Beherrschung vertrauter grammatischer Strukturen und klar verständliche Aussage; A2 = einfache Strukturen teils korrekt, systematische elementare Fehler, Aussage meist noch klar; A1 = nur begrenzte Kontrolle weniger einfacher Muster.
- Wortschatz: B1 = ausreichend groß für die meisten Alltagsthemen, nötigenfalls mit Umschreibungen; A2 = ausreichend für vertraute Routinen/Alltagsangelegenheiten, aber begrenzter; A1 = elementarer Vorrat einzelner Wörter und Wendungen.
- "gut erfüllt" nur vergeben, wenn die jeweilige Niveaubeschreibung klar und über den gesamten relevanten Abschnitt stabil erfüllt wird; sonst "erfüllt". Im Grenzfall konservativ entscheiden.`;
}

function evaluationPrompt(label, answers, interactionMetrics) {
  return `Du bist ${label}, ein unabhängiger Bewerter einer DTZ-Sprechsimulation.
${officialRubricPrompt()}

Bewerte ausschließlich die Kriterien, die aus Transkript und Gesprächsverlauf belastbar hervorgehen: Aufgabenbewältigung, Korrektheit und Wortschatz. Aussprache/Intonation und Flüssigkeit werden separat aus der tatsächlich gehörten Live-Audioleistung bewertet.

Regeln:
- Keine Gefälligkeitsbewertung und kein pauschales Lob.
- Jede Stufe braucht konkrete Evidenz aus den Antworten.
- Hohe Stufen nur, wenn die Evidenz sie klar trägt.
- Fehlende oder extrem knappe Leistung darf nicht hochgerechnet werden.
- Stärken nur mit konkretem Beleg nennen; Prioritäten sachlich und lernbar formulieren.

TRANSKRIPTE:
${JSON.stringify(answers, null, 2)}

INTERAKTIONSMETRIKEN (nur unterstützend, nicht als Ersatz für Sprachleistung):
${JSON.stringify(interactionMetrics || {}, null, 2)}
`;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function runEvaluator(label, answers, interactionMetrics) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: evaluationModel,
      reasoning: { effort: "medium" },
      input: [
        { role: "system", content: "Du bewertest eine DTZ-Sprechsimulation streng nach dem vorgegebenen Kriterienraster. Wähle zuerst die Kriterien-Stufe; rechne keine Punkte. Gib ausschließlich das geforderte strukturierte Ergebnis zurück." },
        { role: "user", content: evaluationPrompt(label, answers, interactionMetrics) }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "dtz_speaking_evaluation_v130",
          strict: true,
          schema: evaluationSchema
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Evaluator ${label} fehlgeschlagen`);
  const text = extractOutputText(data);
  if (!text) throw new Error(`Evaluator ${label}: keine strukturierte Ausgabe`);
  return JSON.parse(text);
}

function validateAudioAssessment(item, label) {
  if (!item || typeof item !== "object") throw new Error(`${label}: Audio-Bewertung fehlt.`);
  for (const key of ["pronunciationBand", "fluencyBand"]) {
    if (!bandValues.includes(item[key])) throw new Error(`${label}: ungültige Audio-Stufe ${key}.`);
  }
  return {
    pronunciationBand: item.pronunciationBand,
    fluencyBand: item.fluencyBand,
    pronunciationEvidence: Array.isArray(item.pronunciationEvidence) ? item.pronunciationEvidence.slice(0, 6) : [],
    fluencyEvidence: Array.isArray(item.fluencyEvidence) ? item.fluencyEvidence.slice(0, 6) : []
  };
}

function average(a, b) { return (Number(a) + Number(b)) / 2; }

function combineEvaluations(a, b, rawAudioAssessments) {
  const audioA = validateAudioAssessment(rawAudioAssessments?.[0], "Audio-Bewerter A");
  const audioB = validateAudioAssessment(rawAudioAssessments?.[1], "Audio-Bewerter B");
  const maxByTask = { "1A": 5, "1B": 5, "2A": 10, "2B": 10, "3": 20 };
  const task = {};
  const criterionBands = { taskAchievement: {} };
  for (const id of ["1A", "1B", "2A", "2B", "3"]) {
    const pa = pointsForBand(a.taskAchievement[id].band, maxByTask[id]);
    const pb = pointsForBand(b.taskAchievement[id].band, maxByTask[id]);
    task[id] = average(pa, pb);
    criterionBands.taskAchievement[id] = [a.taskAchievement[id].band, b.taskAchievement[id].band];
  }

  const pronunciationA = pointsForBand(audioA.pronunciationBand, 10);
  const pronunciationB = pointsForBand(audioB.pronunciationBand, 10);
  const fluencyA = pointsForBand(audioA.fluencyBand, 10);
  const fluencyB = pointsForBand(audioB.fluencyBand, 10);
  const accuracyA = pointsForBand(a.accuracy.band, 15);
  const accuracyB = pointsForBand(b.accuracy.band, 15);
  const vocabularyA = pointsForBand(a.vocabulary.band, 15);
  const vocabularyB = pointsForBand(b.vocabulary.band, 15);

  const pronunciation = average(pronunciationA, pronunciationB);
  const fluency = average(fluencyA, fluencyB);
  const accuracy = average(accuracyA, accuracyB);
  const vocabulary = average(vocabularyA, vocabularyB);
  const taskTotal = Object.values(task).reduce((sum, n) => sum + n, 0);
  const total = taskTotal + pronunciation + fluency + accuracy + vocabulary;
  const level = total >= 75 ? "B1" : total >= 35 ? "A2" : "unter A2";

  const scoreA = Object.keys(maxByTask).reduce((sum, id) => sum + pointsForBand(a.taskAchievement[id].band, maxByTask[id]), 0)
    + pronunciationA + fluencyA + accuracyA + vocabularyA;
  const scoreB = Object.keys(maxByTask).reduce((sum, id) => sum + pointsForBand(b.taskAchievement[id].band, maxByTask[id]), 0)
    + pronunciationB + fluencyB + accuracyB + vocabularyB;

  criterionBands.pronunciation = [audioA.pronunciationBand, audioB.pronunciationBand];
  criterionBands.fluency = [audioA.fluencyBand, audioB.fluencyBand];
  criterionBands.accuracy = [a.accuracy.band, b.accuracy.band];
  criterionBands.vocabulary = [a.vocabulary.band, b.vocabulary.band];

  const evidence = {
    taskAchievement: Object.fromEntries(["1A","1B","2A","2B","3"].map(id => [id, [...new Set([...(a.taskAchievement[id].evidence||[]), ...(b.taskAchievement[id].evidence||[])])].slice(0,4)])),
    pronunciation: [...new Set([...(audioA.pronunciationEvidence||[]), ...(audioB.pronunciationEvidence||[])])].slice(0,4),
    fluency: [...new Set([...(audioA.fluencyEvidence||[]), ...(audioB.fluencyEvidence||[])])].slice(0,4),
    accuracy: [...new Set([...(a.accuracy.evidence||[]), ...(b.accuracy.evidence||[])])].slice(0,4),
    vocabulary: [...new Set([...(a.vocabulary.evidence||[]), ...(b.vocabulary.evidence||[])])].slice(0,4)
  };

  return {
    taskScores: task,
    pronunciation,
    fluency,
    accuracy,
    vocabulary,
    total,
    level,
    scoreA,
    scoreB,
    disagreement: Math.abs(scoreA - scoreB),
    confidence: Math.round(((a.confidence + b.confidence) / 2) * 100) / 100,
    strengths: [...new Set([...(a.strengths || []), ...(b.strengths || [])])].slice(0, 4),
    priorities: [...new Set([...(a.priorities || []), ...(b.priorities || [])])].slice(0, 4),
    criterionBands,
    bandLabels,
    evidence,
    evaluatorA: a,
    evaluatorB: b,
    audioEvaluatorA: audioA,
    audioEvaluatorB: audioB,
    rubricVersion: DTZ_RUBRIC_VERSION,
    rubricSource: DTZ_RUBRIC_SOURCE,
    evaluationBasis: "dtz-rubric+live-audio+transcript"
  };
}


function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("Request zu groß");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readText(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request zu groß");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    openaiConfigured: Boolean(apiKey),
    realtimeModel,
    evaluationModel,
    version: APP_VERSION,
    environment: process.env.RENDER ? "render" : "local",
    uptimeSeconds: Math.round(process.uptime()),
    transcriptionModel
  });
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  return `${proto}://${req.headers.host || "localhost"}`;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === requestOrigin(req)) return true;
  if (allowedOrigins.includes(origin)) return true;
  return false;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

const rateBuckets = new Map();
function allowRate(req, bucketName, limit, windowMs) {
  const now = Date.now();
  const key = `${bucketName}:${clientIp(req)}`;
  const existing = rateBuckets.get(key);
  if (!existing || now - existing.startedAt >= windowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

async function handleRealtimeConnect(req, res) {
  if (!originAllowed(req)) return sendJson(res, 403, { error: "Unerlaubter Ursprung." });
  if (!allowRate(req, "realtime", 30, 60 * 60 * 1000)) return sendJson(res, 429, { error: "Zu viele Live-Sitzungen. Bitte später erneut versuchen." });
  if (!apiKey) return sendJson(res, 503, { error: "OPENAI_API_KEY fehlt auf dem Server." });

  const body = await readJson(req);
  const sdp = typeof body?.sdp === "string" ? body.sdp : "";
  if (!sdp.trim().startsWith("v=")) return sendJson(res, 400, { error: "Ungültiges WebRTC-SDP empfangen." });

  const mode = body?.mode || "training";
  const examPart = body?.examPart || "3";
  const trainingTopic = body?.trainingTopic || "plan";
  const scenario = body?.scenario || "";
  const agentRole = body?.agentRole || (mode === "exam" ? (examPart === "3" ? "partner" : "examiner") : "trainer");
  const userId = body?.userId || "anonymous";
  const session = makeRealtimeSession({ mode, examPart, trainingTopic, scenario, agentRole });

  try {
    const fd = new FormData();
    fd.set("sdp", sdp);
    fd.set("session", JSON.stringify(session));

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": safeUserHash(userId)
      },
      body: fd
    });

    const answer = await response.text();
    if (!response.ok) {
      let detail = answer;
      try { detail = JSON.parse(answer)?.error?.message || answer; } catch {}
      return sendJson(res, response.status, {
        error: "OpenAI Realtime-Verbindung konnte nicht erstellt werden.",
        detail,
        model: realtimeModel
      });
    }

    sendJson(res, 200, { sdp: answer, model: realtimeModel });
  } catch (error) {
    console.error("Realtime connect error:", error);
    sendJson(res, 502, {
      error: "OpenAI ist vom Render-Server aus nicht erreichbar.",
      detail: String(error?.message || error)
    });
  }
}

async function handleEvaluation(req, res) {
  if (!apiKey) return sendJson(res, 503, { error: "OPENAI_API_KEY fehlt auf dem Server." });
  const body = await readJson(req);
  const answers = Array.isArray(body?.answers) ? body.answers : [];
  const interactionMetrics = body?.interactionMetrics || {};
  const audioAssessments = Array.isArray(body?.audioAssessments) ? body.audioAssessments : [];
  if (!answers.length) return sendJson(res, 400, { error: "Keine Prüfungsantworten vorhanden." });
  if (audioAssessments.length < 2) return sendJson(res, 422, { error: "Für eine vollständige DTZ-orientierte Bewertung fehlen zwei Audio-Bewertungen für Aussprache/Intonation und Flüssigkeit. Bitte die Prüfung mit Live-KI durchführen." });
  try {
    const [a, b] = await Promise.all([
      runEvaluator("Evaluator A", answers, interactionMetrics),
      runEvaluator("Evaluator B", answers, interactionMetrics)
    ]);
    sendJson(res, 200, combineEvaluations(a, b, audioAssessments));
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "KI-Bewertung fehlgeschlagen.", detail: String(error.message || error) });
  }
}

function applyCommonHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

async function serveStatic(req, res) {
  const rawPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname);
  let rel = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(__dirname, rel);
  if (!filePath.startsWith(__dirname)) filePath = path.join(__dirname, "index.html");
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await fs.readFile(filePath);
    applyCommonHeaders(res);
    const ext = path.extname(filePath).toLowerCase();
    const cacheControl = [".html", ".js", ".css", ".webmanifest"].includes(ext)
      ? "no-cache"
      : "public, max-age=86400";
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": cacheControl
    });
    res.end(data);
  } catch {
    const ext = path.extname(rawPath).toLowerCase();
    if (rawPath.startsWith("/assets/") || ext) {
      applyCommonHeaders(res);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Not found");
      return;
    }
    const data = await fs.readFile(path.join(__dirname, "index.html"));
    applyCommonHeaders(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      applyCommonHeaders(res);
      res.setHeader("Cache-Control", "no-store");
    }
    if (req.method === "GET" && url.pathname === "/api/health") return handleHealth(req, res);
    if (req.method === "GET" && url.pathname === "/api/version") return sendJson(res, 200, { version: APP_VERSION, realtimeModel, evaluationModel, transcriptionModel, rubricVersion: DTZ_RUBRIC_VERSION });
    if (req.method === "POST" && url.pathname === "/api/realtime/connect") return handleRealtimeConnect(req, res);
    if (req.method === "POST" && url.pathname === "/api/exam/evaluate") {
      if (!originAllowed(req)) return sendJson(res, 403, { error: "Unerlaubter Ursprung." });
      if (!allowRate(req, "evaluation", 60, 60 * 60 * 1000)) return sendJson(res, 429, { error: "Zu viele Bewertungen. Bitte später erneut versuchen." });
      return handleEvaluation(req, res);
    }
    return serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Serverfehler", detail: String(error.message || error) });
  }
});

server.keepAliveTimeout = 120_000;
server.headersTimeout = 121_000;

server.listen(port, host, () => {
  console.log(`DTZ Speaking Trainer ${APP_VERSION} läuft auf ${host}:${port}`);
  console.log(process.env.RENDER ? "Umgebung: Render" : "Umgebung: lokal");
  console.log(`Realtime-Modell: ${realtimeModel}`);
  console.log(apiKey ? "OpenAI-Anbindung: aktiviert" : "OpenAI-Anbindung: NICHT konfiguriert (lokaler Fallback bleibt nutzbar)");
});

function shutdown(signal) {
  console.log(`${signal}: Server wird beendet …`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
