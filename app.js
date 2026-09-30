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
  examAutoFlow: true,
  examTransitioning: false,
  examFinishAfterResponse: false,
  part3TurnsRequired: 4,
  audioAssessments: [],
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
  {id:'1A', phase:'1', phaseTitle:'Teil 1 · Sich vorstellen', title:'Teil 1A · Über sich sprechen', agentRole:'examiner', prompt:'Bitte stellen Sie sich kurz vor. Erzählen Sie etwas über Ihren Wohnort, Ihre Familie, Ihre Arbeit oder Ausbildung und Ihre Interessen.', max:5},
  {id:'1B', phase:'1', phaseTitle:'Teil 1 · Sich vorstellen', title:'Teil 1B · Auf Nachfragen reagieren', agentRole:'examiner', prompt:'Die Prüferin stellt Ihnen jetzt eine sachliche Nachfrage zu Ihrer Vorstellung.', max:5},
  {id:'2A', phase:'2', phaseTitle:'Teil 2 · Bild und Erfahrungen', title:'Teil 2A · Bild beschreiben', agentRole:'examiner', prompt:'Bitte beschreiben Sie das Bild. Was sehen Sie? Was machen die Personen? Wo könnte die Situation sein?', max:10, image:true},
  {id:'2B', phase:'2', phaseTitle:'Teil 2 · Bild und Erfahrungen', title:'Teil 2B · Über Erfahrungen sprechen', agentRole:'examiner', prompt:'Die Prüferin fragt jetzt nach Ihren eigenen Erfahrungen zum Thema des Bildes.', max:10, image:true},
  {id:'3', phase:'3', phaseTitle:'Teil 3 · Gemeinsam planen', title:'Teil 3 · Gemeinsam etwas planen', agentRole:'partner', prompt:'Planen Sie gemeinsam mit dem KI-Gesprächspartner einen Ausflug für den Deutschkurs.', max:20}
];

function currentPart(){ return examParts[state.examIndex]; }
function partMetric(id=currentPart()?.id){
  if (!state.partMetrics[id]) state.partMetrics[id] = { userTurns:0, assistantTurns:0, speechMs:0, transcriptChars:0, agentRole:currentPart()?.agentRole || 'examiner' };
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

function populatePhotoSelect(){
  const select=$('#trainingPhotoSelect');
  if(!select) return;
  select.innerHTML=photoTasks.map((photo,index)=>`<option value="${index}">${String(index+1).padStart(2,'0')} · ${escapeHtml(photo.topic)}</option>`).join('');
  select.value=String(state.trainingPhotoIndex);
}

async function changeTrainingPhoto(index,{restartLive=true}={}){
  const total=photoTasks.length;
  if(!total) return;
  state.trainingPhotoIndex=((Number(index)%total)+total)%total;
  const photo=currentTrainingPhoto();
  trainingPrompts.image=photo.prompt;
  renderTrainingPhoto();
  const select=$('#trainingPhotoSelect');
  if(select) select.value=String(state.trainingPhotoIndex);
  $('#trainingTranscript').value='';
  $('#trainingTranscript').dataset.committed='';
  $('#trainingFeedback').classList.add('hidden');
  $('#trainingStatusText').textContent=`Foto ${state.trainingPhotoIndex+1} von ${total} · ${photo.topic}`;
  if(restartLive && state.realtimeConnected && state.liveMode==='training'){
    await realtime.disconnect();
    try{ await startRealtime('training'); }
    catch(e){ $('#trainingStatusText').textContent=`Live-KI nicht verfügbar: ${friendlyLiveError(e)}`; }
  }
}

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
  const select=$('#trainingPhotoSelect');
  if(select && select.options.length===photoTasks.length) select.value=String(state.trainingPhotoIndex);
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
  const observations=[];const improve=[];
  if(length>=28) observations.push(`Antwortumfang: ausführlich (${length} Wörter).`);
  else if(length>=12) observations.push(`Antwortumfang: ausreichend (${length} Wörter).`);
  else improve.push('Antwort ist sehr kurz. Ergänze 1–2 konkrete Informationen oder eine Begründung.');
  if(connectors>=2) observations.push('Mehrere Verbindungswörter wurden verwendet.');
  else improve.push('Verbinde Aussagen gezielter, z. B. mit „weil“, „aber“, „deshalb“ oder „dann“.');
  if(topic==='plan' && questions===0) improve.push('Im Planungsgespräch solltest du auch eine Rückfrage stellen.');
  if(filler>2) improve.push('Viele Füllwörter erkannt. Nutze lieber kurze Denkpausen.');
  return {observations,improve};
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
      $('#examNextBtn')?.classList.toggle('hidden',connected);
      $('.exam-transcript')?.classList.toggle('hidden',connected);
      updateExamRoleUi();
    }
  },
  listening: (listening)=>{
    const dot=state.liveMode==='exam'?$('#examDot'):$('#trainingDot');
    dot.classList.toggle('live',listening);
    if(listening) state.currentSpeechStartedAt=Date.now();
    else if(state.liveMode==='exam' && state.currentSpeechStartedAt){ partMetric().speechMs += Date.now()-state.currentSpeechStartedAt; state.currentSpeechStartedAt=null; }
  },
  speaking: (speaking)=>{
    if(state.liveMode==='exam' && speaking) $('#examStatusText').textContent=currentPart()?.agentRole==='partner'?'KI-Gesprächspartner spricht …':'KI-Prüferin spricht …';
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
      handleLiveExamTurn(text).catch(err=>{ console.error(err); $('#examStatusText').textContent=`Prüfungsablauf-Fehler: ${friendlyLiveError(err)}`; state.examTransitioning=false; });
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
  responseDone: ()=>{
    if(state.liveMode==='exam' && state.examFinishAfterResponse){
      state.examFinishAfterResponse=false;
      setTimeout(()=>finishExam(),600);
    }
  },
  error: (e)=>console.warn('Realtime error',e)
}) : null;

function examSessionInstructions(part){
  const photo=currentExamPhoto();
  if(part.agentRole==='partner'){
    return `Du bist der KI-Gesprächspartner (Kandidat B) in Teil 3 der DTZ-Sprechsimulation. Führe ein sachliches Planungsgespräch. Reagiere konkret, stelle Rückfragen, bringe eigene Vorschläge und realistische Einwände ein. Stimme nicht automatisch zu. Keine Korrektur, keine Sprachhilfe, kein Lob, keine Punkte.`;
  }
  const rules={
    '1A':'Bitte den Kandidaten sachlich, sich vorzustellen. Lass ihn selbstständig sprechen.',
    '1B':'Stelle genau eine natürliche, prüfungsnahe Nachfrage zu seiner vorherigen Vorstellung.',
    '2A':`Bitte den Kandidaten, das sichtbare Foto zu beschreiben. Interne Bildreferenz: ${photo.expected}. Verrate keine Bilddetails.`,
    '2B':`Stelle eine sachliche Frage nach eigenen Erfahrungen passend zum Foto. Nutze als Orientierung: ${photo.followUp || 'Erzählen Sie von einer ähnlichen Erfahrung.'}`
  };
  return `Du bist die KI-Prüferin. Auftreten: neutral, ernsthaft, höflich, knapp. Aktueller interner Teil ${part.id}. ${rules[part.id]||''} Keine Korrektur, keine Übersetzung, keine Musterantwort, kein Lob oder Tadel, keine Punkte oder Niveauhinweise.`;
}

function examAgentLabel(part=currentPart()){
  return part?.agentRole==='partner' ? 'KI-Gesprächspartner · Kandidat B' : 'KI-Prüferin';
}

function updateExamRoleUi(){
  const part=currentPart();
  const label=$('#examAgentLabel'); if(label) label.textContent=examAgentLabel(part);
  const avatar=$('#examAvatar'); if(avatar){ avatar.textContent=part?.agentRole==='partner'?'B':'P'; avatar.classList.toggle('partner-role',part?.agentRole==='partner'); }
  const strip=$('#examPhaseStrip');
  strip?.querySelectorAll('[data-phase]').forEach(el=>el.classList.toggle('active',el.dataset.phase===part?.phase));
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
    ? {mode:'exam',examPart:currentPart().id,agentRole:currentPart().agentRole,scenario:examScenario}
    : {mode:'training',trainingTopic:state.trainingTopic,agentRole:'trainer',scenario:trainingScenario};
  state.liveMode=mode;
  await realtime.connect(opts);
  if(mode==='exam'){
    if(currentPart().agentRole==='partner'){
      realtime.startPrompt('Beginne Teil 3 als zweiter Prüfungsteilnehmer. Mache einen kurzen eigenen Vorschlag zur gemeinsamen Planung und frage den Kandidaten nach seiner Meinung. Bleibe sachlich und hilf sprachlich nicht.');
    }else{
      realtime.startPrompt(`Beginne die Prüfung sachlich. Formuliere genau die Aufgabe für ${currentPart().id}: ${currentPart().prompt}. Keine einleitende Plauderei, kein Lob. Danach warte.`);
    }
  } else {
    realtime.startPrompt(`Beginne jetzt ein natürliches Sprechtraining zum Schwerpunkt ${state.trainingTopic}. Stelle genau eine passende Einstiegsfrage. Das Ausgangsthema lautet: ${trainingPrompts[state.trainingTopic]}. Bewerte später sachlich; kein pauschales Lob.`);
  }
}

async function advanceExamInternal(targetIndex, promptInstruction){
  saveCurrentExamAnswer();
  state.examIndex=targetIndex;
  loadExamPart();
  if(!state.realtimeConnected) return;
  realtime.updateInstructions(examSessionInstructions(currentPart()));
  realtime.startPrompt(promptInstruction);
}

async function switchToPartnerAgent(){
  if(state.examTransitioning) return;
  state.examTransitioning=true;
  saveCurrentExamAnswer();
  if(realtime && state.realtimeConnected) await realtime.disconnect();
  state.examIndex=4;
  loadExamPart();
  try{ await startRealtime('exam'); }
  finally{ state.examTransitioning=false; }
}

async function handleLiveExamTurn(text){
  if(!state.examAutoFlow || state.examTransitioning || !state.realtimeConnected) return;
  state.examTransitioning=true;
  const id=currentPart()?.id;
  try{
    if(id==='1A'){
      await advanceExamInternal(1,`Stelle jetzt genau eine sachliche Nachfrage, die sich direkt auf diese Vorstellung bezieht: ${text}. Keine Bewertung und kein Lob.`);
    }else if(id==='1B'){
      await advanceExamInternal(2,'Leite ohne Kommentar zu Teil 2 über. Bitte den Kandidaten sachlich, das sichtbare Foto zu beschreiben. Danach warte.');
    }else if(id==='2A'){
      const follow=currentExamPhoto().followUp || 'Erzählen Sie bitte von einer ähnlichen Erfahrung.';
      await advanceExamInternal(3,`Stelle jetzt genau eine sachliche Nachfrage nach eigenen Erfahrungen zum Bildthema. Orientierung: ${follow}. Keine Bewertung.`);
    }else if(id==='2B'){
      state.examTransitioning=false;
      await switchToPartnerAgent();
      return;
    }else if(id==='3'){
      saveCurrentExamAnswer();
      const turns=partMetric('3').userTurns;
      if(turns>=state.part3TurnsRequired){
        state.examFinishAfterResponse=true;
        realtime.startPrompt('Reagiere noch einmal kurz als Gesprächspartner, bringt den gemeinsamen Plan zu einem natürlichen Abschluss und verabschiede dich knapp. Keine Bewertung.');
      }else{
        realtime.startPrompt('Reagiere als Kandidat B direkt auf den letzten Vorschlag. Bringe einen eigenen Vorschlag, eine Rückfrage oder einen realistischen Einwand ein, damit die gemeinsame Planung weitergeht. Keine Sprachhilfe und kein Lob.');
      }
    }
  } finally {
    if(id!=='2B') state.examTransitioning=false;
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
$('#trainingPrevPhotoBtn')?.addEventListener('click',()=>changeTrainingPhoto(state.trainingPhotoIndex-1));
$('#trainingNextPhotoBtn')?.addEventListener('click',()=>changeTrainingPhoto(state.trainingPhotoIndex+1));
$('#trainingRandomPhotoBtn')?.addEventListener('click',()=>{
  if(photoTasks.length<2) return;
  let next=state.trainingPhotoIndex;
  while(next===state.trainingPhotoIndex) next=Math.floor(Math.random()*photoTasks.length);
  changeTrainingPhoto(next);
});
$('#trainingPhotoSelect')?.addEventListener('change',e=>changeTrainingPhoto(Number(e.target.value)));
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
    f.innerHTML=`<strong>Sachliches Coach-Feedback (lokaler Fallback)</strong><p><b>Beobachtung:</b> ${a.observations.join(' ')||'Keine besondere Stärke sicher ableitbar.'}</p><p><b>Nächster Schritt:</b> ${a.improve.join(' ')||'Die Antwort ist ausreichend. Wiederhole sie noch einmal möglichst klar und ohne zusätzliche Hilfen.'}</p>`;
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
  state.examIndex=0;state.examSeconds=16*60;state.examAnswers=[];state.partMetrics={};state.realtimeMuted=false;state.examTransitioning=false;state.examFinishAfterResponse=false;state.examPhotoIndex=Math.floor(Math.random()*photoTasks.length);
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
  $('#examPartTitle').textContent=part.phaseTitle;
  const detail=$('#examPartDetail'); if(detail) detail.textContent=part.title;
  $('#examPrompt').textContent=displayedPrompt;
  $('#examTranscript').value='';$('#examTranscript').dataset.committed='';
  renderExamPhoto();
  updateExamRoleUi();
  const phaseProgress=part.phase==='1'?18:part.phase==='2'?52:82;
  $('#examProgressBar').style.width=`${phaseProgress}%`;
  $('#examNextBtn').textContent=part.id==='3'?'Prüfung beenden':'Nächster Abschnitt';
  $('#examNextBtn').classList.toggle('hidden',state.realtimeConnected);
  $('.exam-transcript')?.classList.toggle('hidden',state.realtimeConnected);
  $('#examStatusText').textContent=state.realtimeConnected?'Prüfung läuft – bitte sprechen':'Bereit';
  partMetric(part.id);
}

async function nextExamPart(){
  if(state.realtimeConnected){
    $('#examStatusText').textContent='Im Live-Prüfungsmodus wechselt die Prüfung automatisch.';
    return;
  }
  saveCurrentExamAnswer();
  if(state.examIndex>=examParts.length-1){await finishExam();return;}
  state.examIndex++;loadExamPart();
  speak($('#examPrompt').textContent,0.92);
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
      let response='Was sollten wir noch organisieren?';
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

function parseJsonObject(text){
  const raw=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(raw);}catch{}
  const start=raw.indexOf('{'), end=raw.lastIndexOf('}');
  if(start>=0 && end>start) return JSON.parse(raw.slice(start,end+1));
  throw new Error('Audio-Bewertung war nicht als JSON lesbar.');
}

function audioAssessmentPrompt(label){
  return `Du bist ${label}, ein VERDECKTER Audio-Bewerter nach den DTZ-Sprechkriterien. Antworte ausschließlich als kompaktes JSON und erzeuge KEINE Audioausgabe. Bewerte NUR die tatsächliche Stimme und Sprechweise des KANDIDATEN (user), nicht die Stimmen der KI-Prüferin oder des KI-Gesprächspartners.

Bewerte zwei Kriterien über die gesamte bisherige mündliche Prüfung:
1) Aussprache/Intonation:
- B1: gut verständlich; fremdsprachiger Akzent und einzelne Aussprachefehler sind erlaubt, solange Verständlichkeit erhalten bleibt.
- A2: im Allgemeinen verständlich trotz deutlichem Akzent; gelegentlich kann Wiederholung nötig sein.
- A1: sehr begrenztes Repertoire nur mit Mühe verständlich.
2) Flüssigkeit:
- B1: verständlich und ohne viel Stocken; deutliche Planungs-/Korrekturpausen sind erlaubt.
- A2: kurze vertraute Gespräche möglich, aber häufiges Stocken und Neuansetzen.
- A1: sehr kurze, isolierte Äußerungen mit vielen Suchpausen und Abbrüchen.

Stufen: B1_GUT, B1_ERFUELLT, A2_GUT, A2_ERFUELLT, A1_ERFUELLT, 0.
"GUT" nur wählen, wenn die Niveaubeschreibung klar und stabil erfüllt ist. Im Grenzfall konservativ entscheiden. Kein Gefälligkeitslob.

JSON-Schema exakt:
{"pronunciationBand":"...","fluencyBand":"...","pronunciationEvidence":["..."],"fluencyEvidence":["..."]}`;
}

async function collectRealtimeAudioAssessments(){
  if(!realtime || !state.realtimeConnected || typeof realtime.requestTextAssessment!=='function'){
    throw new Error('Für Aussprache/Intonation und Flüssigkeit ist eine aktive Live-KI-Prüfung erforderlich.');
  }
  realtime.setMuted(true);
  $('#examStatusText').textContent='Aussprache und Flüssigkeit werden nach DTZ-Kriterien ausgewertet …';
  const first=parseJsonObject(await realtime.requestTextAssessment(audioAssessmentPrompt('Audio-Bewerter A')));
  const second=parseJsonObject(await realtime.requestTextAssessment(audioAssessmentPrompt('Audio-Bewerter B. Bewerte unabhängig neu und ignoriere frühere Bewertungsurteile')));
  return [first,second];
}

async function requestAiEvaluation(audioAssessments){
  if(!state.openaiConfigured) throw new Error('KI-Bewertung nicht konfiguriert');
  const r=await fetch('/api/exam/evaluate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({answers:state.examAnswers,interactionMetrics:state.partMetrics,audioAssessments})
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.detail||data.error||'KI-Bewertung fehlgeschlagen');
  return data;
}

function fmt(n){ return Number.isInteger(n)?String(n):Number(n).toFixed(1).replace('.',','); }
function renderExamResult(s){
  $('#examRoom').classList.add('hidden');$('#examResult').classList.remove('hidden');
  $('#resultScore').textContent=fmt(s.total);$('#resultLevel').textContent=`${s.level} · DTZ-Sprechsimulation`;
  $('#resultBasis').textContent=`Bewertung nach hinterlegten DTZ-Sprechkriterien · 2 Transkript-Bewerter + 2 Live-Audio-Bewertungen · ${s.rubricVersion||'DTZ-Raster'} · kein offizielles Zertifikat`;
  const bandText=(key)=>{ const pair=s.criterionBands?.[key]; if(!pair)return ''; return pair.map(x=>s.bandLabels?.[x]||x).join(' / '); };
  const taskBand=(id)=>{ const pair=s.criterionBands?.taskAchievement?.[id]; if(!pair)return ''; return pair.map(x=>s.bandLabels?.[x]||x).join(' / '); };
  const evidenceHtml=(title,items)=>items?.length?`<details class="rubric-evidence"><summary>${escapeHtml(title)} – Begründung</summary><ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></details>`:'';
  $('#scoreTable').innerHTML=`
    <div class="score-row"><span>Teil 1A · Über sich sprechen<small>${taskBand('1A')}</small></span><b>${fmt(s.taskScores['1A'])}/5</b></div>
    ${evidenceHtml('Teil 1A',s.evidence?.taskAchievement?.['1A'])}
    <div class="score-row"><span>Teil 1B · Auf Nachfragen reagieren<small>${taskBand('1B')}</small></span><b>${fmt(s.taskScores['1B'])}/5</b></div>
    ${evidenceHtml('Teil 1B',s.evidence?.taskAchievement?.['1B'])}
    <div class="score-row"><span>Teil 2A · Bildbeschreibung<small>${taskBand('2A')}</small></span><b>${fmt(s.taskScores['2A'])}/10</b></div>
    ${evidenceHtml('Teil 2A',s.evidence?.taskAchievement?.['2A'])}
    <div class="score-row"><span>Teil 2B · Eigene Erfahrungen<small>${taskBand('2B')}</small></span><b>${fmt(s.taskScores['2B'])}/10</b></div>
    ${evidenceHtml('Teil 2B',s.evidence?.taskAchievement?.['2B'])}
    <div class="score-row"><span>Teil 3 · Gemeinsam planen<small>${taskBand('3')}</small></span><b>${fmt(s.taskScores['3'])}/20</b></div>
    ${evidenceHtml('Teil 3',s.evidence?.taskAchievement?.['3'])}
    <div class="score-row"><span>Aussprache / Intonation<small>${bandText('pronunciation')}</small></span><b>${fmt(s.pronunciation)}/10</b></div>
    ${evidenceHtml('Aussprache / Intonation',s.evidence?.pronunciation)}
    <div class="score-row"><span>Flüssigkeit<small>${bandText('fluency')}</small></span><b>${fmt(s.fluency)}/10</b></div>
    ${evidenceHtml('Flüssigkeit',s.evidence?.fluency)}
    <div class="score-row"><span>Korrektheit<small>${bandText('accuracy')}</small></span><b>${fmt(s.accuracy)}/15</b></div>
    ${evidenceHtml('Korrektheit',s.evidence?.accuracy)}
    <div class="score-row"><span>Wortschatz<small>${bandText('vocabulary')}</small></span><b>${fmt(s.vocabulary)}/15</b></div>
    ${evidenceHtml('Wortschatz',s.evidence?.vocabulary)}
    <div class="score-row total"><span>Gesamt</span><b>${fmt(s.total)}/100</b></div>
    <p class="muted">Bewertung A: ${fmt(s.scoreA)} · Bewertung B: ${fmt(s.scoreB)} · Abweichung: ${fmt(s.disagreement)} Punkte. Die Einstufung folgt dem hinterlegten DTZ-Punkteschema: 75–100 B1, 35–74,5 A2, darunter unter A2.</p>`;
  const strengths=s.strengths?.length?s.strengths:[];
  const focus=s.priorities?.length?s.priorities:[];
  if(!strengths.length){
    if(s.vocabulary>=12)strengths.push('Wortschatz: in den vorliegenden Antworten klar über dem Mindestniveau der Simulation.');
    if(s.fluency>=8)strengths.push('Flüssigkeit: überwiegend zusammenhängende Äußerungen in der vorliegenden Evidenz.');
    if(s.taskScores['3']>=16)strengths.push('Teil 3: Vorschläge und Reaktionen wurden überzeugend in die Planung eingebracht.');
  }
  if(!focus.length){
    if(s.vocabulary<9)focus.push('Wortschatz für Alltag, Planung und Begründungen erweitern.');
    if(s.fluency<6)focus.push('Längere Antworten mit weniger Unterbrechungen trainieren.');
    if(s.taskScores['3']<12)focus.push('Mehr eigene Vorschläge, Rückfragen und Gegenvorschläge in Teil 3 verwenden.');
    if(s.accuracy<9)focus.push('Grammatik im freien Sprechen stabilisieren.');
  }
  $('#strengthsList').innerHTML=(strengths.length?strengths:['Keine besondere Stärke mit ausreichender Evidenz hervorgehoben.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  $('#focusList').innerHTML=(focus.length?focus:['Ergebnis mit weiteren prüfungsnahen Aufgaben stabilisieren.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  const now=new Date();state.history.push({date:`${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.`,score:Number(s.total)});
  state.history=state.history.slice(-8);localStorage.setItem('dtzHistory',JSON.stringify(state.history));
  $('#homeScore').textContent=Math.round(Number(s.total));$('#progressLast').textContent=`${fmt(s.total)}/100`;
  $('#examProgressBar').style.width='100%';
}

function escapeHtml(text){return String(text).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function renderEvaluationError(error){
  $('#examRoom').classList.add('hidden');
  $('#examResult').classList.remove('hidden');
  $('#resultScore').textContent='—';
  $('#resultLevel').textContent='Bewertung nicht abgeschlossen';
  $('#resultBasis').textContent='Es wird bewusst keine Ersatznote oder geschätzte Punktzahl angezeigt.';
  $('#scoreTable').innerHTML=`<div class="notice"><strong>DTZ-Bewertung konnte nicht erstellt werden.</strong><p>${escapeHtml(friendlyLiveError(error))}</p><p>Für eine vollständige Bewertung müssen Live-Audio, Transkript und beide KI-Bewertungen verfügbar sein. Bitte die Simulation mit Live-KI erneut durchführen.</p></div>`;
  $('#strengthsList').innerHTML='<li>Keine Bewertung ohne ausreichende Evidenz.</li>';
  $('#focusList').innerHTML='<li>Prüfung erneut mit stabiler Live-KI-Verbindung durchführen.</li>';
}

async function finishExam(){
  if(!state.timer && $('#examRoom').classList.contains('hidden')) return;
  clearInterval(state.timer);state.timer=null;saveCurrentExamAnswer();
  $('#examStatusText').textContent='DTZ-Bewertung wird erstellt …';
  $('#globalStatus').textContent='Bewertung …';
  try{
    state.audioAssessments = await collectRealtimeAudioAssessments();
    if(realtime && state.realtimeConnected) await realtime.disconnect();
    $('#examStatusText').textContent='Aufgabenbewältigung, Korrektheit und Wortschatz werden bewertet …';
    const result=await requestAiEvaluation(state.audioAssessments);
    renderExamResult(result);
  }catch(e){
    console.warn('DTZ-Bewertung fehlgeschlagen',e);
    if(realtime && state.realtimeConnected) await realtime.disconnect();
    renderEvaluationError(e);
  }
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
  populatePhotoSelect();
  renderTrainingPhoto();
  await validatePhotos();
  warmupBackend();
}

initializeApp();
