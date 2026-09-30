import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const port=19180;
const base=`http://127.0.0.1:${port}`;
let failures=0;
const results=[];
function pass(name,detail=''){results.push({ok:true,name,detail});}
function fail(name,detail=''){failures++;results.push({ok:false,name,detail});}
async function check(name,fn){try{const d=await fn();pass(name,d||'');}catch(e){fail(name,String(e?.message||e));}}

const child=spawn(process.execPath,['server.js'],{
  cwd:__dirname,
  env:{...process.env,PORT:String(port),HOST:'127.0.0.1',OPENAI_API_KEY:'',APP_VERSION:'qa-test'},
  stdio:['ignore','pipe','pipe']
});
let started=false;
child.stdout.on('data',d=>{if(String(d).includes('läuft auf')) started=true;});
let stderr='';child.stderr.on('data',d=>stderr+=String(d));
for(let i=0;i<30&&!started;i++) await new Promise(r=>setTimeout(r,100));

await check('Health endpoint',async()=>{
  const r=await fetch(`${base}/api/health`);const j=await r.json();
  if(!r.ok||!j.ok) throw new Error(JSON.stringify(j));
  if(j.openaiConfigured!==false) throw new Error('QA-Server sollte ohne API-Key laufen');
  return `${r.status} ${j.version}`;
});
await check('Version endpoint',async()=>{
  const r=await fetch(`${base}/api/version`);const j=await r.json();
  if(!r.ok||!j.version) throw new Error(JSON.stringify(j)); return j.version;
});
await check('Startseite HTML',async()=>{
  const r=await fetch(base);const t=await r.text();
  if(!t.includes('DTZ Speaking Trainer')) throw new Error('Titel fehlt');
  if(!t.includes('trainingTaskPhoto')) throw new Error('Foto-Element im Training fehlt');
  if(!t.includes('examTaskPhoto')) throw new Error('Foto-Element in Prüfung fehlt');
  if(!t.includes('trainingPhotoSelect')||!t.includes('trainingPrevPhotoBtn')||!t.includes('trainingRandomPhotoBtn')||!t.includes('trainingNextPhotoBtn')) throw new Error('Foto-Auswahlsteuerung fehlt');
  return r.headers.get('content-type');
});
await check('Fotobibliothek enthält 25 Aufgaben',async()=>{
  const r=await fetch(`${base}/data/photoTasks.json`);const j=await r.json();
  if(!r.ok||!Array.isArray(j)) throw new Error(`HTTP ${r.status}`);
  if(j.length!==25) throw new Error(`Erwartet 25, gefunden ${j.length}`);
  const ids=new Set(j.map(x=>x.id)); if(ids.size!==25) throw new Error('Doppelte IDs');
  if(j.some(x=>!x.src||!x.topic||!x.prompt||!x.followUp)) throw new Error('Pflichtfelder fehlen');
  return '25 Aufgaben';
});
const photoManifest=JSON.parse(await fs.readFile(path.join(__dirname,'data','photoTasks.json'),'utf8'));
for(const photo of photoManifest){
  await check(`Foto ${photo.id} · ${photo.topic}`,async()=>{
    const r=await fetch(`${base}/${photo.src}`);const b=new Uint8Array(await r.arrayBuffer());
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    if(!(r.headers.get('content-type')||'').startsWith('image/jpeg')) throw new Error(`MIME ${r.headers.get('content-type')}`);
    if(b.length<30000) throw new Error(`Datei zu klein ${b.length}`);
    if(!(b[0]===0xff&&b[1]===0xd8)) throw new Error('JPEG-Magic fehlt');
    return `${Math.round(b.length/1024)} KB`;
  });
}
await check('Manifest gültiges JSON',async()=>{
  const r=await fetch(`${base}/manifest.webmanifest`);const j=await r.json();
  if(j.display!=='standalone'||!Array.isArray(j.icons)||j.icons.length<2) throw new Error('PWA-Felder unvollständig');
  return j.short_name;
});
await check('Service Worker erreichbar',async()=>{
  const r=await fetch(`${base}/sw.js`);const t=await r.text();
  if(!t.includes('dtz-speaking-v1.3.0')) throw new Error('Cache-Version falsch');
  return r.headers.get('content-type');
});
await check('Realtime ohne API-Key sauber abgelehnt',async()=>{
  const r=await fetch(`${base}/api/realtime/connect`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sdp:'v=0'})});
  const j=await r.json(); if(r.status!==503||!/OPENAI_API_KEY/.test(j.error||'')) throw new Error(`${r.status} ${JSON.stringify(j)}`); return '503 erwartet';
});
await check('Fehlendes Asset liefert 404',async()=>{
  const r=await fetch(`${base}/assets/does-not-exist.jpg`);
  if(r.status!==404) throw new Error(`HTTP ${r.status}`); return '404 erwartet';
});
await check('Security Header',async()=>{
  const r=await fetch(`${base}/`);
  if(r.headers.get('x-content-type-options')!=='nosniff') throw new Error('nosniff fehlt');
  if(!(r.headers.get('permissions-policy')||'').includes('microphone=(self)')) throw new Error('Permissions-Policy fehlt');
  return 'ok';
});
await check('Fremder Origin wird blockiert',async()=>{
  const r=await fetch(`${base}/api/realtime/connect`,{method:'POST',headers:{'content-type':'application/json','origin':'https://evil.example'},body:JSON.stringify({sdp:'v=0'})});
  if(r.status!==403) throw new Error(`HTTP ${r.status}`); return '403 erwartet';
});

await check('Prüfungsmodus hat zwei getrennte KI-Rollen',async()=>{
  const app=await fs.readFile(path.join(__dirname,'app.js'),'utf8');
  const server=await fs.readFile(path.join(__dirname,'server.js'),'utf8');
  const html=await fs.readFile(path.join(__dirname,'index.html'),'utf8');
  if(!app.includes("agentRole:'examiner'")||!app.includes("agentRole:'partner'")) throw new Error('Agentrollen fehlen in app.js');
  if(!app.includes('switchToPartnerAgent')||!app.includes('handleLiveExamTurn')) throw new Error('Automatischer Prüfungsablauf fehlt');
  if(!server.includes('ROLLE: KI-PRÜFERIN')||!server.includes('ROLLE: KI-GESPRÄCHSPARTNER')) throw new Error('Serverrollen fehlen');
  if(!html.includes('examAgentLabel')||!html.includes('examPhaseStrip')) throw new Error('Prüfungsrollen/Phasen fehlen in UI');
  return 'Prüferin + Gesprächspartner';
});
await check('Training verlangt sachliches Feedback und Worterklärung nur auf Anfrage',async()=>{
  const server=await fs.readFile(path.join(__dirname,'server.js'),'utf8');
  if(!server.includes('Lobe NICHT automatisch')) throw new Error('Anti-Überlob-Regel fehlt');
  if(!server.includes('Erkläre neue Wörter nur, wenn der Lernende danach fragt')) throw new Error('Worterklärungsregel fehlt');
  if(!server.includes('1–2 alltagsnahe Beispielsätze')) throw new Error('Beispielregel fehlt');
  return 'sachlich + Worterklärung';
});
await check('Prüfung deaktiviert automatische KI-Antworten zwischen gesteuerten Schritten',async()=>{
  const server=await fs.readFile(path.join(__dirname,'server.js'),'utf8');
  if(!server.includes('create_response: mode !== "exam"')) throw new Error('Exam-Turn-Control fehlt');
  return 'manuell gesteuerte Exam-State-Machine';
});

await check('DTZ-Bewertung ist kriteriumsorientiert und serverseitig bepunktet',async()=>{
  const server=await fs.readFile(path.join(__dirname,'server.js'),'utf8');
  if(!server.includes('B1_GUT')||!server.includes('A2_ERFUELLT')) throw new Error('DTZ-Bewertungsstufen fehlen');
  if(!server.includes('pointsForBand')||!server.includes('DTZ_RUBRIC_VERSION')) throw new Error('Deterministische Punkte-Engine fehlt');
  if(!server.includes('Teil 1A: B1')||!server.includes('Teil 3: B1')) throw new Error('Offizielle Kriterienbeschreibung fehlt');
  return 'Band -> Punkte';
});
await check('Prüfungsbewertung verlangt Live-Audio-Evidenz',async()=>{
  const app=await fs.readFile(path.join(__dirname,'app.js'),'utf8');
  const server=await fs.readFile(path.join(__dirname,'server.js'),'utf8');
  const rt=await fs.readFile(path.join(__dirname,'realtime.js'),'utf8');
  if(!app.includes('collectRealtimeAudioAssessments')) throw new Error('Audio-Bewertung im Client fehlt');
  if(!rt.includes('requestTextAssessment')) throw new Error('Realtime-Audioassessment fehlt');
  if(!server.includes('audioAssessments.length < 2')) throw new Error('Server erzwingt Audioevidenz nicht');
  return '2 Audio-Bewertungen erforderlich';
});
await check('Keine erfundene Ersatznote bei Bewertungsfehler',async()=>{
  const app=await fs.readFile(path.join(__dirname,'app.js'),'utf8');
  if(!app.includes('Es wird bewusst keine Ersatznote oder geschätzte Punktzahl angezeigt')) throw new Error('No-fake-score Regel fehlt');
  if(/catch\(e\).*calculateScores\(\)/s.test(app)) throw new Error('Heuristischer Exam-Fallback noch aktiv');
  return 'kein Heuristik-Fallback';
});

await check('Render Blueprint vorhanden',async()=>{
  const t=await fs.readFile(path.join(__dirname,'render.yaml'),'utf8');
  if(!t.includes('healthCheckPath: /api/health')||!t.includes('startCommand: npm start')) throw new Error('render.yaml unvollständig'); return 'ok';
});
await check('Keine echte .env im Paket',async()=>{
  try{await fs.access(path.join(__dirname,'.env'));throw new Error('.env darf nicht ausgeliefert werden');}catch(e){if(e.message.includes('darf nicht')) throw e;return 'ok';}
});

child.kill('SIGTERM');
await new Promise(r=>setTimeout(r,200));
for(const row of results) console.log(`${row.ok?'PASS':'FAIL'} | ${row.name}${row.detail?' | '+row.detail:''}`);
if(stderr.trim()) console.error(stderr.trim());
if(failures){console.error(`\n${failures} QA-Test(s) fehlgeschlagen.`);process.exit(1);}else console.log(`\nAlle ${results.length} QA-Tests bestanden.`);
