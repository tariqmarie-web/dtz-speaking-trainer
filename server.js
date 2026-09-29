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

const APP_VERSION = process.env.APP_VERSION || '1.1.1-render';
const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || '0.0.0.0';
const rawApiKey = (process.env.OPENAI_API_KEY || "").trim();
const apiKey = rawApiKey && !/^(sk-)?\.\.\.$/.test(rawApiKey) && rawApiKey !== "sk-..." ? rawApiKey : "";
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
const evaluationModel = process.env.OPENAI_EVALUATION_MODEL || "gpt-5.6-terra";
const voice = process.env.OPENAI_VOICE || "marin";
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

function buildRealtimeInstructions({ mode = "training", examPart = "3", trainingTopic = "plan", scenario = "" } = {}) {
  const common = `
Du bist ein deutschsprachiger KI-Gesprächspartner für die Vorbereitung auf den Deutsch-Test für Zuwanderer (DTZ) bis B1.
Sprich natürlich, freundlich und erwachsen. Verwende klares Standarddeutsch und kurze, natürliche Gesprächsbeiträge.
Reagiere immer auf den konkreten Inhalt der letzten Äußerung. Verhalte dich nicht wie ein Formular und arbeite keine starre Fragenliste ab.
Lass Sprachlernenden Denkpausen. Unterbrich nicht vorschnell. Bleibe beim aktuellen Gesprächsthema.
Du bist ausdrücklich ein KI-Gesprächspartner, keine echte Prüfperson.
`;

  if (mode === "exam") {
    return `${common}
PRÜFUNGSMODUS.
Aktueller Teil: ${examPart}.
${partGuidance[examPart] || "Bleibe beim aktuellen DTZ-Prüfungsteil."}
${scenario ? `Szenario: ${scenario}` : ""}
Während der Prüfung: keine Grammatik-Korrekturen, keine Übersetzung, keine Musterantwort, keine Hinweise auf A2/B1, keine Punkte, kein Lob oder Tadel zur Qualität der Antwort und keine versteckte sprachliche Hilfe.
Du darfst natürlich nachfragen, zustimmen, höflich widersprechen oder einen Gegenvorschlag machen, sofern dies zum aktuellen Teil gehört.
Wechsle NIEMALS selbstständig in einen anderen Prüfungsteil. Die Anwendung steuert den Prüfungsablauf.
`;
  }

  return `${common}
TRAININGSMODUS.
Trainingsschwerpunkt: ${trainingTopic}.
${scenario ? `Szenario: ${scenario}` : ""}
Du darfst coachen. Führe zuerst ein natürliches Gespräch. Gib nach einer sinnvollen Schülerantwort höchstens eine kurze, konkrete Verbesserung und lasse den Schüler möglichst erneut sprechen.
Korrigiere nicht jeden kleinen Fehler. Priorisiere Verständlichkeit, Aufgabenbewältigung, Interaktion, Flüssigkeit und die wichtigsten B1-relevanten Muster.
`;
}

function makeRealtimeSession({ mode = "training", examPart = "3", trainingTopic = "plan", scenario = "" } = {}) {
  return {
    type: "realtime",
    model: realtimeModel,
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: transcriptionModel },
        turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true }
      },
      output: { voice }
    },
    instructions: buildRealtimeInstructions({ mode, examPart, trainingTopic, scenario })
  };
}

const evidenceSchema = { type: "array", items: { type: "string" } };
function scoreObjectSchema(values) {
  return {
    type: "object",
    properties: {
      points: { type: "integer", enum: values },
      evidence: evidenceSchema
    },
    required: ["points", "evidence"],
    additionalProperties: false
  };
}
const evaluationSchema = {
  type: "object",
  properties: {
    taskAchievement: {
      type: "object",
      properties: {
        "1A": scoreObjectSchema([0,1,2,3,4,5]),
        "1B": scoreObjectSchema([0,1,2,3,4,5]),
        "2A": scoreObjectSchema([0,2,4,6,8,10]),
        "2B": scoreObjectSchema([0,2,4,6,8,10]),
        "3": scoreObjectSchema([0,4,8,12,16,20])
      },
      required: ["1A", "1B", "2A", "2B", "3"],
      additionalProperties: false
    },
    pronunciation: scoreObjectSchema([0,2,4,6,8,10]),
    fluency: scoreObjectSchema([0,2,4,6,8,10]),
    accuracy: scoreObjectSchema([0,3,6,9,12,15]),
    vocabulary: scoreObjectSchema([0,3,6,9,12,15]),
    strengths: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["taskAchievement", "pronunciation", "fluency", "accuracy", "vocabulary", "strengths", "priorities", "confidence"],
  additionalProperties: false
};

function evaluationPrompt(label, answers, interactionMetrics) {
  return `Du bist ${label}, ein unabhängiger DTZ-orientierter Zweitbewerter für eine Sprechsimulation.
Bewerte nur anhand der vorliegenden Evidenz. Erfinde keine Audioeigenschaften. Wenn keine verlässliche Audioevidenz vorliegt, bewerte Aussprache vorsichtig und senke confidence.
Bewerte kriteriumsorientiert, nicht nach Bauchgefühl. Nutze nur die im Schema erlaubten Punkte.
Teil 1A max 5, Teil 1B max 5, Teil 2A max 10, Teil 2B max 10, Teil 3 max 20; Aussprache/Intonation max 10; Flüssigkeit max 10; Korrektheit max 15; Wortschatz max 15.
Achte besonders auf Aufgabenbewältigung, selbstständige zusammenhängende Sprache, Reaktion auf Nachfragen, Bildbeschreibung, eigene Erfahrungen sowie Interaktion/Vorschläge/Gegenvorschläge in Teil 3.

TRANSKRIPTE:
${JSON.stringify(answers, null, 2)}

TECHNISCHE INTERAKTIONSMETRIKEN (nur unterstützende Evidenz):
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
        { role: "system", content: "Du bewertest DTZ-Sprechsimulationen nachvollziehbar und streng kriteriumsorientiert. Gib ausschließlich das geforderte strukturierte Ergebnis zurück." },
        { role: "user", content: evaluationPrompt(label, answers, interactionMetrics) }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "dtz_speaking_evaluation",
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

function criterionAverage(a, b, key) {
  return (Number(a[key].points) + Number(b[key].points)) / 2;
}

function combineEvaluations(a, b) {
  const task = {};
  for (const id of ["1A", "1B", "2A", "2B", "3"]) {
    task[id] = (a.taskAchievement[id].points + b.taskAchievement[id].points) / 2;
  }
  const pronunciation = criterionAverage(a, b, "pronunciation");
  const fluency = criterionAverage(a, b, "fluency");
  const accuracy = criterionAverage(a, b, "accuracy");
  const vocabulary = criterionAverage(a, b, "vocabulary");
  const taskTotal = Object.values(task).reduce((sum, n) => sum + n, 0);
  const total = taskTotal + pronunciation + fluency + accuracy + vocabulary;
  const level = total >= 75 ? "B1" : total >= 35 ? "A2" : "unter A2";
  const scoreA = Object.values(a.taskAchievement).reduce((s, x) => s + x.points, 0) + a.pronunciation.points + a.fluency.points + a.accuracy.points + a.vocabulary.points;
  const scoreB = Object.values(b.taskAchievement).reduce((s, x) => s + x.points, 0) + b.pronunciation.points + b.fluency.points + b.accuracy.points + b.vocabulary.points;
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
    evaluatorA: a,
    evaluatorB: b,
    evaluationBasis: "transcript+interaction-metrics"
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
  const userId = body?.userId || "anonymous";
  const session = makeRealtimeSession({ mode, examPart, trainingTopic, scenario });

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
  if (!answers.length) return sendJson(res, 400, { error: "Keine Prüfungsantworten vorhanden." });
  try {
    const [a, b] = await Promise.all([
      runEvaluator("Evaluator A", answers, interactionMetrics),
      runEvaluator("Evaluator B", answers, interactionMetrics)
    ]);
    sendJson(res, 200, combineEvaluations(a, b));
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
    if (req.method === "GET" && url.pathname === "/api/version") return sendJson(res, 200, { version: APP_VERSION, realtimeModel, evaluationModel, transcriptionModel });
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
