const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecognize = !!SpeechRecognition;
const synth = window.speechSynthesis;

const state = {
  view: 'home',
  trainingTopic: 'intro',
  trainingPhotoIndex: 0,
  examPhotoIndex: 0,
  examIndex: 0,
  examSeconds: 16 * 60,
  timer: null,
  examAnswers: [],
  listening: false,
  liveMode: null,
  realtimeConnected: false,
  realtimeMuted: false,
  openaiConfigured: false,
  backendReady: false,
  backendVersion: '',
  currentSpeechStartedAt: null,
  partMetrics: {},
  history: JSON.parse(localStorage.getItem('dtzHistory') || 'null') || [
    {date:'01.09.',score:58},{date:'08.09.',score:63},{date:'15.09.',score:66},{date:'22.09.',score:68}
  ]
};

if (!localStorage.getItem('dtzUserId')) {
  localStorage.setItem('dtzUserId', (crypto.randomUUID?.() || `u-${Date.now()}-${Math.random()}`).toString());
}

let photoTasks = [
  {
    id:'fallback_01',
    src:'assets/school_family.jpg',
    alt:'Eine erwachsene Person und ein Schulkind vor einer Grundschule',
    topic:'Schule und Familie',
    level:'A2-B1',
    expected:'Eine erwachsene Bezugsperson steht mit einem Schulkind vor einer Grundschule; im Hintergrund gehen weitere Kinder in das Gebäude.',
    prompt:'Beschreibe bitte das Foto so genau wie möglich. Was siehst du? Was passiert gerade? Erzähle danach, ob du eine ähnliche Situation aus deinem Alltag kennst.',
    followUp:'Erzähle von deinen Erfahrungen mit Schule oder dem Schulweg.',
    active:true
  }
];

async function loadPhotoLibrary(){
  try{
    const r = await fetch('/data/photoTasks.json', { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if(!Array.isArray(data) || data.length < 25) throw new Error(`Fotobibliothek unvollständig: ${Array.isArray(data)?data.length:0}`);
    const valid = data.filter(x=>x && x.active!==false && x.src && x.topic && x.prompt);
    if(valid.length < 25) throw new Error(`Nur ${valid.length} aktive Fotos gefunden`);
    photoTasks = valid;
    state.trainingPhotoIndex = Math.min(state.trainingPhotoIndex, photoTasks.length-1);
    state.examPhotoIndex = Math.min(state.examPhotoIndex, photoTasks.length-1);
    trainingPrompts.image = photoTasks[0].prompt;
    $('#globalStatus').textContent = `25 Fotos geladen`;
    return true;
  }catch(error){
    console.error('Fotobibliothek konnte nicht geladen werden:', error);
    $('#globalStatus').textContent = 'Fotobibliothek: Fallback aktiv';
    return false;
  }
}

const trainingPrompts = {
  intro: 'Erzähl mir bitte kurz etwas über dich: Woher kommst du, was machst du und was machst du gern in deiner Freizeit?',
  image: photoTasks[0].prompt,
  plan: 'Wir möchten mit unserem Deutschkurs am Wochenende einen Ausflug machen. Hast du eine Idee, wohin wir fahren könnten?',
  fluency: 'Erzähl mir bitte ungefähr eine Minute lang von deinem letzten Wochenende. Versuche, ohne lange Pausen weiterzusprechen.'
};

const examParts = [
  {id:'1A', title:'Teil 1A · Über sich sprechen', prompt:'Bitte stellen Sie sich kurz vor. Erzählen Sie etwas über Ihren Wohnort, Ihre Familie, Ihre Arbeit oder Ausbildung und Ihre Interessen.', max:5},
  {id:'1B', title:'Teil 1B · Auf Nachfragen reagieren', prompt:'Ich stelle Ihnen jetzt noch eine Frage zu dem, was Sie gerade erzählt haben.', max:5},
  {id:'2A', title:'Teil 2A · Bild beschreiben', prompt:'Bitte beschreiben Sie das Bild. Was sehen Sie? Was machen die Personen? Wo könnte die Situation sein?', max:10, image:true},
  {id:'2B', title:'Teil 2B · Über Erfahrungen sprechen', prompt:'Haben Sie eine ähnliche Situation schon erlebt? Erzählen Sie bitte von Ihren eigenen Erfahrungen.', max:10, image:true},
  {id:'3', title:'Teil 3 · Gemeinsam etwas planen', prompt:'Wir möchten für unseren Deutschkurs einen Ausflug organisieren. Ich finde Samstag gut, aber ich habe kein Auto. Was schlagen Sie vor?', max:20}
];

function currentPart(){ return examParts[state.examIndex]; }
function partMetric(id=currentPart()?.id){
  if (!state.partMetrics[id]) state.partMetrics[id] = { userTurns:0, assistantTurns:0, speechMs:0, transcriptChars:0 };
  return state.partMetrics[id];
}

function friendlyLiveError(error){
  const message = String(error?.message || error || 'Unbekannter Fehler');
  if (location.protocol === 'file:') return 'Die App muss über die Webadresse geöffnet werden, nicht als lokale Datei.';
  if (/Failed to fetch|fetch failed|Backend nicht erreichbar|NetworkError/i.test(message)) return 'Der Cloud-Server ist gerade nicht erreichbar oder startet noch. Bitte kurz warten und erneut versuchen.';
  if (/OPENAI_API_KEY/i.test(message)) return 'OpenAI API-Key fehlt auf dem Render-Server.';
  if (/401|unauthorized|invalid.*key|incorrect api key/i.test(message)) return 'Der OpenAI API-Key wurde nicht akzeptiert.';
  if (/429|rate limit|quota|billing|insufficient_quota/i.test(message)) return 'OpenAI-Limit oder Guthabenproblem. Bitte API-Abrechnung bzw. Limit prüfen.';
  if (/microphone|mikrofon|permission|notallowed|NotAllowedError/i.test(message)) return 'Mikrofonzugriff fehlt. Bitte den Mikrofonzugriff für diese Website erlauben.';
  if (/ICE|WebRTC|SDP/i.test(message)) return 'Die Live-Audio-Verbindung konnte nicht aufgebaut werden. Bitte Netzwerk/WLAN wechseln oder erneut starten.';
  if (!window.isSecureContext && !['localhost','127.0.0.1','::1'].includes(location.hostname)) return 'Für Mikrofon und Live-KI ist eine HTTPS-Adresse erforderlich.';
  return message;
}

async function fetchHealth(timeoutMs = 8000){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const r = await fetch('/api/health', { cache:'no-store', signal:controller.signal });
    if(!r.ok) throw new Error(`Backend HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function applyHealth(h){
  state.backendReady = !!h?.ok;
  state.backendVersion = h?.version || '';
  state.openaiConfigured = !!h?.openaiConfigured;
  $('#aiStatus').textContent = h?.openaiConfigured ? 'Live-KI: bereit' : 'Live-KI: API-Key fehlt';
  $('#aiCheck').textContent = h?.openaiConfigured ? 'bereit' : 'API-Key fehlt';
  $('#networkCheck').textContent = `Cloud v${h?.version || '?'} erreichbar`;
  $('#globalStatus').textContent = 'Bereit';
}

async function checkBackend(){
  if(location.protocol === 'file:'){
    state.backendReady = false;
    state.openaiConfigured = false;
    $('#aiStatus').textContent = 'Live-KI: Webadresse erforderlich';
    $('#aiCheck').textContent = 'nicht verfügbar';
    $('#networkCheck').textContent = 'Dateimodus';
    return null;
  }
  try {
    const h = await fetchHealth();
    applyHealth(h);
    return h;
  } catch(e){
    state.backendReady = false;
    state.openaiConfigured = false;
    $('#aiStatus').textContent = 'Cloud startet …';
    $('#aiCheck').textContent = 'wird geprüft';
    $('#networkCheck').textContent = 'Server startet eventuell';
    $('#globalStatus').textContent = 'Server wird vorbereitet …';
    return null;
  }
}

async function warmupBackend({ attempts = 18, delayMs = 5000 } = {}){
  let h = await checkBackend();
  if(h) return h;
  for(let i=1;i<attempts;i++){
    $('#globalStatus').textContent = `Cloud-Server wird gestartet … ${i}/${attempts-1}`;
    await new Promise(r=>setTimeout(r, delayMs));
    try{
      h = await fetchHealth();
      applyHealth(h);
      return h;
    }catch{}
  }
  $('#globalStatus').textContent = 'Cloud nicht erreichbar';
  $('#aiStatus').textContent = 'Live-KI: Server nicht erreichbar';
  return null;
}

async function ensureBackendReady(){
  if(state.backendReady) return true;
  const h = await warmupBackend({ attempts:6, delayMs:3000 });
  if(!h) throw new Error('Cloud-Server nicht erreichbar.');
  return true;
}

async function validatePhotos(){
  const checks = await Promise.all(photoTasks.map(async photo=>{
    try{
      const r = await fetch(photo.src, { cache:'reload' });
      const type = r.headers.get('content-type') || '';
      if(!r.ok || !type.startsWith('image/')) throw new Error(`${r.status} ${type}`);
      return {src:photo.src,ok:true};
    }catch(error){ return {src:photo.src,ok:false,error:String(error)}; }
  }));
  const failed=checks.filter(x=>!x.ok);
  if(failed.length){
    console.error('Bilddateien fehlen:',failed);
    const msg='Mindestens ein Übungsfoto konnte nicht geladen werden. Bitte Seite neu laden.';
    $('#trainingStatusText').textContent=msg;
    $('#globalStatus').textContent='Foto-Fehler';
  }
  return failed.length===0;
}

function currentTrainingPhoto(){ return photoTasks[state.trainingPhotoIndex % photoTasks.length]; }
function currentExamPhoto(){ return photoTasks[state.examPhotoIndex % photoTasks.length]; }

function renderTrainingPhoto(){
  const show = state.trainingTopic === 'image';
  const wrap = $('#trainingImageTask');
  if(!wrap) return;
  wrap.classList.toggle('hidden', !show);
  if(!show) return;
  const photo=currentTrainingPhoto();
  $('#trainingTaskPhoto').src=photo.src;
  $('#trainingTaskPhoto').alt=photo.alt;
  $('#trainingPrompt').textContent=photo.prompt;
  const caption=$('#trainingPhotoCaption');
  if(caption) caption.textContent=`Thema: ${photo.topic} · Foto ${state.trainingPhotoIndex+1} von ${photoTasks.length}`;
}

function renderExamPhoto(){
  const part=currentPart();
  const show=!!part?.image;
  const wrap=$('#imageTask');
  if(!wrap) return;
  wrap.classList.toggle('hidden',!show);
  if(!show) return;
  const photo=currentExamPhoto();
  $('#examTaskPhoto').src=photo.src;
  $('#examTaskPhoto').alt=photo.alt;
  $('#examPhotoCaption').textContent=`Thema: ${photo.topic} · Beschreiben Sie das Foto so, wie Sie es in einer Prüfung tun würden.`;
}

function installImageGuards(){
  [['#trainingTaskPhoto','#trainingImageTask'],['#examTaskPhoto','#imageTask']].forEach(([imgSel,wrapSel])=>{
    const img=$(imgSel), wrap=$(wrapSel);
    if(!img||!wrap) return;
    img.addEventListener('error',()=>{
      wrap.classList.add('photo-load-error');
      let error=wrap.querySelector('.photo-error-message');
      if(!error){
        error=document.createElement('div');
        error.className='photo-error-message';
        error.textContent='Foto konnte nicht geladen werden. Bitte Seite neu laden oder ein anderes Foto wählen.';
        wrap.appendChild(error);
      }
    });
    img.addEventListener('load',()=>{
      wrap.classList.remove('photo-load-error');
      wrap.querySelector('.photo-error-message')?.remove();
    });
  });
}

function setView(view){
  state.view=view;
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles={home:'Heute üben',training:'Sprechen üben',exam:'Prüfung simulieren',progress:'Fortschritt'};
  $('#pageTitle').textContent=titles[view];
  if(view==='progress') renderProgress();
}

$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$$('[data-jump]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.jump)));
$('#startTodayBtn').addEventListener('click',()=>setView('training'));

function speak(text, rate=0.95){
  if(!synth) return;
  synth.cancel();
  const u=new SpeechSynthesisUtterance(text);u.lang='de-DE';u.rate=rate;u.pitch=1;
  synth.speak(u);
}

function createRecognition(onText,onEnd,statusEl,dotEl){
  if(!canRecognize){ statusEl.textContent='Spracherkennung nicht verfügbar – bitte Antwort eintippen.'; return null; }
  const r=new SpeechRecognition();
  r.lang='de-DE';r.interimResults=true;r.continuous=false;
  let final='';
  r.onstart=()=>{state.listening=true;state.currentSpeechStartedAt=Date.now();statusEl.textContent='Ich höre zu …';dotEl.classList.add('live');};
  r.onresult=(e)=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t=e.results[i][0].transcript;
      if(e.results[i].isFinal) final+=t+' '; else interim+=t;
    }
    onText((final+interim).trim());
  };
  r.onerror=(e)=>{statusEl.textContent='Mikrofonfehler: '+e.error;dotEl.classList.remove('live');state.listening=false;};
  r.onend=()=>{dotEl.classList.remove('live');state.listening=false;statusEl.textContent='Antwort aufgenommen';onEnd(final.trim());};
  return r;
}

function analyzeTraining(text,topic){
  const words=text.trim().split(/\s+/).filter(Boolean);
  const length=words.length;
  const connectors=(text.match(/\b(weil|deshalb|aber|trotzdem|wenn|dass|und|oder|dann|danach|zum Beispiel)\b/gi)||[]).length;
  const questions=(text.match(/\?/g)||[]).length;
  const filler=(text.match(/\b(äh|ähm|hm)\b/gi)||[]).length;
  let good=[];let improve=[];
  if(length>=20) good.push('Du hast ausführlich geantwortet.'); else improve.push('Versuche, deine Antwort um 1–2 Sätze zu verlängern.');
  if(connectors>=2) good.push('Du verbindest Gedanken bereits gut.'); else improve.push('Nutze Verbindungswörter wie „weil“, „aber“, „deshalb“ oder „dann“.');
  if(topic==='plan' && questions===0) improve.push('Stelle deinem Gesprächspartner auch mindestens eine Frage.');
  if(filler>2) improve.push('Versuche kurze Denkpausen zu machen, statt viele Füllwörter zu verwenden.');
  if(!good.length) good.push('Du hast die Aufgabe beantwortet und weitergesprochen.');
  return {good,improve};
}

const realtime = window.DTZRealtimeClient ? new window.DTZRealtimeClient({
  status: (text)=>{
    if(state.liveMode==='training') $('#trainingStatusText').textContent=text;
    if(state.liveMode==='exam') $('#examStatusText').textContent=text;
    $('#globalStatus').textContent=text.includes('verbunden') ? 'Live' : 'Bereit';
  },
  connected: (connected)=>{
    state.realtimeConnected=connected;
    $('#aiStatus').textContent=connected ? 'Live-KI: verbunden' : (state.openaiConfigured ? 'Live-KI: bereit' : 'Live-KI: Fallback');
    $('#trainingLiveBtn').textContent=connected && state.liveMode==='training' ? '■ Live-KI beenden' : '⚡ Live-KI starten';
    if(state.liveMode==='exam') {
      $('#examMicBtn').textContent=connected ? '🎙 Live-Mikrofon an' : '🎙 Aufnahme-Fallback';
      $('#examListenBtn').disabled=connected;
    }
  },
  listening: (listening)=>{
    const dot=state.liveMode==='exam'?$('#examDot'):$('#trainingDot');
    dot.classList.toggle('live',listening);
    if(listening) state.currentSpeechStartedAt=Date.now();
    else if(state.liveMode==='exam' && state.currentSpeechStartedAt){ partMetric().speechMs += Date.now()-state.currentSpeechStartedAt; state.currentSpeechStartedAt=null; }
  },
  speaking: (speaking)=>{
    if(state.liveMode==='exam' && speaking) $('#examStatusText').textContent='KI-Prüfungspartner spricht …';
    if(state.liveMode==='training' && speaking) $('#trainingStatusText').textContent='KI-Trainer spricht …';
  },
  userTranscriptDelta: ({text})=>{
    const box=state.liveMode==='exam'?$('#examTranscript'):$('#trainingTranscript');
    const existing=box.dataset.committed || '';
    box.value=(existing + (existing?' ':'') + text).trim();
  },
  userTranscript: (text)=>{
    const box=state.liveMode==='exam'?$('#examTranscript'):$('#trainingTranscript');
    const existing=box.dataset.committed || '';
    const merged=(existing + (existing?' ':'') + text).trim();
    box.dataset.committed=merged;box.value=merged;
    if(state.liveMode==='exam'){
      const m=partMetric();m.userTurns++;m.transcriptChars=merged.length;
    }
  },
  assistantTranscriptDelta: ({text})=>{
    const target=state.liveMode==='exam'?$('#examPrompt'):$('#trainingPrompt');
    target.textContent=text;
  },
  assistantTranscript: (text)=>{
    const target=state.liveMode==='exam'?$('#examPrompt'):$('#trainingPrompt');
    if(text) target.textContent=text;
    if(state.liveMode==='exam') partMetric().assistantTurns++;
  },
  error: (e)=>console.warn('Realtime error',e)
}) : null;

function examSessionInstructions(part){
  const photo=currentExamPhoto();
  const rules={
    '1A':'Lass den Kandidaten sich selbstständig vorstellen. Unterbrich nicht mit einer Stichpunktliste.',
    '1B':'Stelle eine natürliche Nachfrage, die sich direkt auf die vorherige Vorstellung bezieht.',
    '2A':`Lass den Kandidaten das angezeigte Foto beschreiben. Die interne Bildreferenz lautet: ${photo.expected} Korrigiere die Beschreibung während der Prüfung nicht und verrate keine Bilddetails, bevor der Kandidat sie selbst erwähnt. Frage nur knapp nach, wenn er sehr früh endet.`,
    '2B':`Frage nach einer persönlichen Erfahrung passend zum zuvor gezeigten Foto. Nutze diese thematische Nachfrage: ${photo.followUp || 'Erzähle von einer ähnlichen Erfahrung.'} Interne Bildreferenz: ${photo.expected}`,
    '3':'Sei zweiter Teilnehmer beim gemeinsamen Planen. Stimme nicht allem zu. Bringe einen realistischen Einwand oder Gegenvorschlag ein und reagiere auf den Kandidaten.'
  };
  return `Du bist ein KI-Prüfungspartner für eine DTZ-Sprechsimulation. Aktueller Prüfungsteil: ${part.id}. ${rules[part.id]} Sprich klares natürliches Deutsch. Keine Korrektur, keine Übersetzung, keine Musterantwort, keine Punkte oder Niveauhinweise. Reagiere auf den konkreten Inhalt. Bleibe ausschließlich in Teil ${part.id}, bis die Anwendung umschaltet.`;
}

async function startRealtime(mode){
  if(!realtime) throw new Error('Realtime-Client nicht geladen');
  await ensureBackendReady();
  if(!state.openaiConfigured) throw new Error('OPENAI_API_KEY fehlt auf dem Server.');
  const examScenario = ['2A','2B'].includes(currentPart()?.id)
    ? `${currentPart().id==='2B' ? (currentExamPhoto().followUp || currentPart().prompt) : currentPart().prompt} Interne Bildreferenz: ${currentExamPhoto().expected}`
    : currentPart()?.prompt;
  const trainingScenario = state.trainingTopic==='image'
    ? `${currentTrainingPhoto().prompt} Interne Bildreferenz: ${currentTrainingPhoto().expected}`
    : trainingPrompts[state.trainingTopic];
  const opts=mode==='exam'
    ? {mode:'exam',examPart:currentPart().id,scenario:examScenario}
    : {mode:'training',trainingTopic:state.trainingTopic,scenario:trainingScenario};
  state.liveMode=mode;
  await realtime.connect(opts);
  if(mode==='exam'){
    realtime.startPrompt(`Beginne jetzt Prüfungsteil ${currentPart().id}. Formuliere eine kurze natürliche Aufgabenstellung entsprechend diesem Ziel: ${currentPart().prompt}. Danach warte auf die Antwort.`);
  } else {
    realtime.startPrompt(`Beginne jetzt ein natürliches Sprechtraining zum Schwerpunkt ${state.trainingTopic}. Stelle genau eine passende Einstiegsfrage. Das Ausgangsthema lautet: ${trainingPrompts[state.trainingTopic]}`);
  }
}

$$('#trainingTopics .chip').forEach(ch=>ch.addEventListener('click',async()=>{
  $$('#trainingTopics .chip').forEach(c=>c.classList.remove('active'));ch.classList.add('active');
  state.trainingTopic=ch.dataset.topic;
  $('#trainingPrompt').textContent=state.trainingTopic==='image' ? currentTrainingPhoto().prompt : trainingPrompts[state.trainingTopic];
  renderTrainingPhoto();
  $('#trainingTranscript').value='';$('#trainingTranscript').dataset.committed='';$('#trainingFeedback').classList.add('hidden');
  if(state.realtimeConnected && state.liveMode==='training'){
    await realtime.disconnect();
    try{ await startRealtime('training'); }catch(e){ $('#trainingStatusText').textContent=`Live-KI nicht verfügbar: ${friendlyLiveError(e)}`; }
  }
}));
$('#trainingListenBtn').addEventListener('click',()=>speak($('#trainingPrompt').textContent));
$('#trainingNextPhotoBtn')?.addEventListener('click',async()=>{
  state.trainingPhotoIndex=(state.trainingPhotoIndex+1)%photoTasks.length;
  const photo=currentTrainingPhoto();
  trainingPrompts.image=photo.prompt;
  renderTrainingPhoto();
  $('#trainingTranscript').value='';$('#trainingTranscript').dataset.committed='';$('#trainingFeedback').classList.add('hidden');
  if(state.realtimeConnected && state.liveMode==='training'){
    await realtime.disconnect();
    try{ await startRealtime('training'); }catch(e){ $('#trainingStatusText').textContent=`Live-KI nicht verfügbar: ${friendlyLiveError(e)}`; }
  }
});
$('#trainingResetBtn').addEventListener('click',()=>{$('#trainingTranscript').value='';$('#trainingTranscript').dataset.committed='';$('#trainingFeedback').classList.add('hidden');$('#trainingStatusText').textContent='Mikrofon bereit';});
$('#trainingLiveBtn').addEventListener('click',async()=>{
  if(state.realtimeConnected){ await realtime.disconnect();state.liveMode=null;return; }
  try{ await startRealtime('training'); }
  catch(e){ $('#trainingStatusText').textContent=`Live-KI nicht verfügbar: ${friendlyLiveError(e)} Lokaler Fallback bleibt nutzbar.`; }
});
$('#trainingMicBtn').addEventListener('click',()=>{
  if(state.realtimeConnected){ realtime.setMuted(!state.realtimeMuted);state.realtimeMuted=!state.realtimeMuted;$('#trainingMicBtn').textContent=state.realtimeMuted?'🔇 Mikrofon aus':'🎙 Mikrofon an';return; }
  const box=$('#trainingTranscript');
  if(!canRecognize){box.focus();return;}
  const r=createRecognition(t=>box.value=t,final=>{
    const text=(final||box.value).trim();if(!text)return;
    box.dataset.committed=text;
    const a=analyzeTraining(text,state.trainingTopic);
    const f=$('#trainingFeedback');
    f.innerHTML=`<strong>Coach-Feedback (lokaler Fallback)</strong><p><b>Gut:</b> ${a.good.join(' ')}</p><p><b>Nächster Schritt:</b> ${a.improve.join(' ')||'Sehr gut – versuche die Antwort jetzt noch einmal etwas spontaner.'}</p>`;
    f.classList.remove('hidden');
    if(state.trainingTopic==='plan'){
      const response = /zug/i.test(text) ? 'Mit dem Zug finde ich auch gut. Wann sollten wir losfahren?' : /auto/i.test(text) ? 'Mit dem Auto wäre praktisch. Aber ich habe kein Auto. Welche Alternative hätten wir?' : 'Das ist eine Idee. Wie könnten wir die Anreise organisieren?';
      $('#trainingPrompt').textContent=response;speak(response);
    }
  },$('#trainingStatusText'),$('#trainingDot'));
  r.start();
});

function examPrecheck(){
  const isLocalhost=['localhost','127.0.0.1','::1'].includes(location.hostname);
  if(!window.isSecureContext && !isLocalhost){
    $('#micCheck').textContent='HTTPS erforderlich';
    $('#networkCheck').textContent='Mobil: sichere HTTPS-Adresse nötig';
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia){$('#micCheck').textContent='Browser unterstützt keinen Mikrofontest';return;}
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    $('#micCheck').textContent='bereit';stream.getTracks().forEach(t=>t.stop());
  }).catch(()=>$('#micCheck').textContent='Zugriff erforderlich');
}
examPrecheck();

$('#beginExamBtn').addEventListener('click',beginExam);
$('#repeatExamBtn').addEventListener('click',beginExam);
$('#backToTrainingBtn').addEventListener('click',()=>setView('training'));
$('#examListenBtn').addEventListener('click',()=>speak($('#examPrompt').textContent,0.92));
$('#examNextBtn').addEventListener('click',nextExamPart);

async function beginExam(){
  if(realtime) await realtime.disconnect();
  state.examIndex=0;state.examSeconds=16*60;state.examAnswers=[];state.partMetrics={};state.realtimeMuted=false;state.examPhotoIndex=Math.floor(Math.random()*photoTasks.length);
  $('#examIntro').classList.add('hidden');$('#examResult').classList.add('hidden');$('#examRoom').classList.remove('hidden');
  loadExamPart();startTimer();setView('exam');
  if(state.openaiConfigured && realtime){
    try{ await startRealtime('exam');return; }
    catch(e){ $('#examStatusText').textContent=`Live-KI konnte nicht starten: ${friendlyLiveError(e)} Lokaler Fallback aktiv.`; }
  }
  speak($('#examPrompt').textContent,0.92);
}

function loadExamPart(){
  const part=currentPart();
  const displayedPrompt = part.id==='2B' ? (currentExamPhoto().followUp || part.prompt) : part.prompt;
  $('#examPartTitle').textContent=part.title;$('#examPrompt').textContent=displayedPrompt;$('#examTranscript').value='';$('#examTranscript').dataset.committed='';
  renderExamPhoto();
  $('#examProgressBar').style.width=`${(state.examIndex/examParts.length)*100}%`;
  $('#examNextBtn').textContent=state.examIndex===examParts.length-1?'Prüfung beenden':'Nächster Teil';
  $('#examStatusText').textContent=state.realtimeConnected?'Live-Mikrofon aktiv – einfach sprechen':'Bereit';
  partMetric(part.id);
}

async function nextExamPart(){
  saveCurrentExamAnswer();
  if(state.examIndex>=examParts.length-1){await finishExam();return;}
  state.examIndex++;loadExamPart();
  if(state.realtimeConnected){
    realtime.cancelResponse();
    realtime.updateInstructions(examSessionInstructions(currentPart()));
    realtime.startPrompt(`Wechsle jetzt ausschließlich zu Prüfungsteil ${currentPart().id}. Stelle die passende Aufgabe natürlich: ${$('#examPrompt').textContent}. Berücksichtige den bisherigen Gesprächskontext, wenn der Teil darauf aufbaut.`);
  } else speak($('#examPrompt').textContent,0.92);
}

function saveCurrentExamAnswer(){
  const part=currentPart();
  const text=$('#examTranscript').value.trim();
  const existing=state.examAnswers.findIndex(a=>a.id===part.id);
  const payload={id:part.id,text,max:part.max,metrics:{...partMetric(part.id)}};
  if(existing>=0) state.examAnswers[existing]=payload; else state.examAnswers.push(payload);
}

$('#examMicBtn').addEventListener('click',()=>{
  if(state.realtimeConnected){
    state.realtimeMuted=!state.realtimeMuted;realtime.setMuted(state.realtimeMuted);
    $('#examMicBtn').textContent=state.realtimeMuted?'🔇 Live-Mikrofon aus':'🎙 Live-Mikrofon an';
    return;
  }
  const box=$('#examTranscript');
  if(!canRecognize){box.focus();return;}
  const r=createRecognition(t=>box.value=t,final=>{
    if(final){box.value=final;box.dataset.committed=final;const m=partMetric();m.userTurns++;m.transcriptChars=final.length;if(state.currentSpeechStartedAt)m.speechMs+=Date.now()-state.currentSpeechStartedAt;}
    if(currentPart().id==='3' && box.value.trim()){
      const t=box.value.toLowerCase();
      let response='Das klingt möglich. Was sollten wir noch organisieren?';
      if(t.includes('auto')) response='Mit dem Auto wäre praktisch, aber ich habe kein Auto. Vielleicht könnten wir mit dem Zug fahren?';
      else if(t.includes('zug')) response='Mit dem Zug bin ich einverstanden. Wann sollten wir losfahren und wo treffen wir uns?';
      else if(t.includes('samstag')) response='Samstag passt mir auch. Ich möchte aber nicht zu spät zurückkommen. Was meinst du?';
      $('#examPrompt').textContent=response;partMetric().assistantTurns++;speak(response,0.92);
    }
  },$('#examStatusText'),$('#examDot'));
  r.start();
});

function startTimer(){
  clearInterval(state.timer);
  $('#examTimer').textContent='16:00';
  state.timer=setInterval(()=>{
    state.examSeconds--;
    const m=Math.floor(state.examSeconds/60),s=state.examSeconds%60;
    $('#examTimer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if(state.examSeconds<=0) finishExam();
  },1000);
}

function rubricLevel(ratio, levels){
  if(ratio>=.85)return levels[0];if(ratio>=.72)return levels[1];if(ratio>=.58)return levels[2];if(ratio>=.44)return levels[3];if(ratio>=.25)return levels[4];return 0;
}
function heuristicPartScore(text,max){
  const words=text.split(/\s+/).filter(Boolean); const w=words.length;
  const connectors=(text.match(/\b(weil|deshalb|aber|trotzdem|wenn|dass|und|oder|dann|danach|zuerst|später)\b/gi)||[]).length;
  const interaction=(text.match(/\b(was meinst du|wie findest du|können wir|sollen wir|vielleicht|ich schlage vor|einverstanden|lieber)\b/gi)||[]).length;
  let ratio=Math.min(1,w/32)*.65 + Math.min(1,connectors/3)*.2 + Math.min(1,interaction/2)*.15;
  const levels=max===5?[5,4,3,2,1]:max===10?[10,8,6,4,2]:[20,16,12,8,4];
  return rubricLevel(ratio,levels);
}
function calculateScores(){
  const taskScores={};
  state.examAnswers.forEach(a=>taskScores[a.id]=heuristicPartScore(a.text,a.max));
  examParts.forEach(p=>{if(taskScores[p.id]==null)taskScores[p.id]=0;});
  const allText=state.examAnswers.map(a=>a.text).join(' ');
  const words=allText.split(/\s+/).filter(Boolean); const unique=new Set(words.map(w=>w.toLowerCase().replace(/[^a-zäöüß]/g,''))).size;
  const connectorCount=(allText.match(/\b(weil|deshalb|aber|trotzdem|wenn|dass|dann|danach|obwohl|damit)\b/gi)||[]).length;
  const sentenceCount=Math.max(1,(allText.match(/[.!?]/g)||[]).length);
  const avgLen=words.length/sentenceCount;
  const pronunciation = words.length>=45 ? 8 : words.length>=25 ? 6 : words.length>=12 ? 4 : 2;
  const fluency = words.length>=70 ? 8 : words.length>=45 ? 6 : words.length>=25 ? 4 : 2;
  const accuracy = connectorCount>=5 && avgLen>7 ? 12 : connectorCount>=3 ? 9 : connectorCount>=1 ? 6 : 3;
  const vocabRatio = unique/Math.max(1,words.length);
  const vocabulary = words.length>=70 && vocabRatio>.55 ? 12 : words.length>=45 ? 9 : words.length>=20 ? 6 : 3;
  const taskTotal=Object.values(taskScores).reduce((a,b)=>a+b,0);
  const total=Math.min(100,taskTotal+pronunciation+fluency+accuracy+vocabulary);
  return {taskScores,pronunciation,fluency,accuracy,vocabulary,total,level:total>=75?'B1':total>=35?'A2':'unter A2',evaluationBasis:'local-heuristic',strengths:[],priorities:[]};
}

async function requestAiEvaluation(){
  if(!state.openaiConfigured) throw new Error('KI-Bewertung nicht konfiguriert');
  const r=await fetch('/api/exam/evaluate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({answers:state.examAnswers,interactionMetrics:state.partMetrics})
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.detail||data.error||'KI-Bewertung fehlgeschlagen');
  return data;
}

function fmt(n){ return Number.isInteger(n)?String(n):Number(n).toFixed(1).replace('.',','); }
function renderExamResult(s){
  $('#examRoom').classList.add('hidden');$('#examResult').classList.remove('hidden');
  $('#resultScore').textContent=fmt(s.total);$('#resultLevel').textContent=`${s.level}-Einschätzung`;
  $('#resultBasis').textContent=s.evaluationBasis==='transcript+interaction-metrics'
    ? `Zwei unabhängige KI-Bewerter · Transkript + Interaktionsdaten · Sicherheit ${Math.round((s.confidence||0)*100)} % · kein offizielles Prüfungsergebnis`
    : 'Lokale Demo-Heuristik · kein offizielles Prüfungsergebnis';
  $('#scoreTable').innerHTML=`
    <div class="score-row"><span>Teil 1A · Über sich sprechen</span><b>${fmt(s.taskScores['1A'])}/5</b></div>
    <div class="score-row"><span>Teil 1B · Nachfragen</span><b>${fmt(s.taskScores['1B'])}/5</b></div>
    <div class="score-row"><span>Teil 2A · Bildbeschreibung</span><b>${fmt(s.taskScores['2A'])}/10</b></div>
    <div class="score-row"><span>Teil 2B · Erfahrungen</span><b>${fmt(s.taskScores['2B'])}/10</b></div>
    <div class="score-row"><span>Teil 3 · Gemeinsam planen</span><b>${fmt(s.taskScores['3'])}/20</b></div>
    <div class="score-row"><span>Aussprache / Intonation</span><b>${fmt(s.pronunciation)}/10</b></div>
    <div class="score-row"><span>Flüssigkeit</span><b>${fmt(s.fluency)}/10</b></div>
    <div class="score-row"><span>Korrektheit</span><b>${fmt(s.accuracy)}/15</b></div>
    <div class="score-row"><span>Wortschatz</span><b>${fmt(s.vocabulary)}/15</b></div>
    <div class="score-row total"><span>Gesamt</span><b>${fmt(s.total)}/100</b></div>
    ${s.scoreA!=null?`<p class="muted">Evaluator A: ${fmt(s.scoreA)} · Evaluator B: ${fmt(s.scoreB)} · Abweichung: ${fmt(s.disagreement)} Punkte. Audio-spezifische Aussprachebewertung ist in diesem Entwicklungsschritt noch nicht vollständig kalibriert.</p>`:'<p class="muted">Fallback: Textbasierte Demo-Heuristik. Für belastbare Aussprachebewertung ist die Audio-Evaluationsstufe noch erforderlich.</p>'}`;
  const strengths=s.strengths?.length?s.strengths:[];
  const focus=s.priorities?.length?s.priorities:[];
  if(!strengths.length){
    if(s.vocabulary>=9)strengths.push('Dein Wortschatz reicht für viele Alltagssituationen gut aus.');
    if(s.fluency>=6)strengths.push('Du kannst bereits zusammenhängend sprechen.');
    if(s.taskScores['3']>=12)strengths.push('Du beteiligst dich sinnvoll an Planungsgesprächen.');
  }
  if(!focus.length){
    if(s.vocabulary<9)focus.push('Wortschatz für Alltag, Planung und Begründungen erweitern.');
    if(s.fluency<6)focus.push('Längere Antworten mit weniger Unterbrechungen trainieren.');
    if(s.taskScores['3']<12)focus.push('Mehr eigene Vorschläge, Rückfragen und Gegenvorschläge in Teil 3 verwenden.');
    if(s.accuracy<9)focus.push('Grammatik im freien Sprechen stabilisieren.');
  }
  $('#strengthsList').innerHTML=(strengths.length?strengths:['Du hast alle Prüfungsteile bearbeitet.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  $('#focusList').innerHTML=(focus.length?focus:['Ergebnis mit weiteren prüfungsnahen Aufgaben stabilisieren.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  const now=new Date();state.history.push({date:`${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.`,score:Number(s.total)});
  state.history=state.history.slice(-8);localStorage.setItem('dtzHistory',JSON.stringify(state.history));
  $('#homeScore').textContent=Math.round(Number(s.total));$('#progressLast').textContent=`${fmt(s.total)}/100`;
  $('#examProgressBar').style.width='100%';
}

function escapeHtml(text){return String(text).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

async function finishExam(){
  if(!state.timer && $('#examRoom').classList.contains('hidden')) return;
  clearInterval(state.timer);state.timer=null;saveCurrentExamAnswer();
  if(realtime && state.realtimeConnected) await realtime.disconnect();
  $('#examStatusText').textContent='Bewertung läuft …';
  $('#globalStatus').textContent='Bewertung …';
  let result;
  try{ result=await requestAiEvaluation(); }
  catch(e){ console.warn(e);result=calculateScores(); }
  renderExamResult(result);
  $('#globalStatus').textContent='Bereit';
}

function renderProgress(){
  const chart=$('#progressChart');chart.innerHTML='';
  state.history.forEach(h=>{
    const wrap=document.createElement('div');wrap.className='bar-wrap';
    wrap.innerHTML=`<div class="bar" style="height:${Math.max(18,h.score*1.7)}px"><strong>${Math.round(h.score)}</strong></div><small>${h.date}</small>`;
    chart.appendChild(wrap);
  });
  const last=state.history[state.history.length-1];if(last)$('#progressLast').textContent=`${fmt(last.score)}/100`;
}

window.addEventListener('beforeunload',()=>{ if(realtime) realtime.disconnect(); });

async function initializeApp(){
  renderProgress();
  installImageGuards();
  await loadPhotoLibrary();
  renderTrainingPhoto();
  await validatePhotos();
  warmupBackend();
}

initializeApp();
