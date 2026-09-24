// ═══════════════════════════════════════════════
// AUDIO ENGINE
// ═══════════════════════════════════════════════
let audioCtx = null;
function getAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}

// Reverb impulse response generator
function makeReverb(ctx, duration=1.5, decay=2.5){
  const sr = ctx.sampleRate;
  const len = sr * duration;
  const buf = ctx.createBuffer(2, len, sr);
  for(let c=0;c<2;c++){
    const d=buf.getChannelData(c);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
  }
  const conv=ctx.createConvolver();
  conv.buffer=buf;
  return conv;
}

// Sword unsheath sound
function playSword(){
  try{
    const ctx=getAudio();
    const now=ctx.currentTime;
    const master=ctx.createGain(); master.gain.value=0.4;
    const reverb=makeReverb(ctx,2,3);
    reverb.connect(master); master.connect(ctx.destination);
    const dry=ctx.createGain(); dry.gain.value=0.6; dry.connect(master);

    // Metallic scrape: white noise + highpass
    const buf=ctx.createBuffer(1,ctx.sampleRate*0.6,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,1.5)*Math.pow(i/d.length*4,0.3);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=2000;
    const hp2=ctx.createBiquadFilter(); hp2.type='peaking'; hp2.frequency.value=5000; hp2.gain.value=8;
    src.connect(hp); hp.connect(hp2); hp2.connect(dry); hp2.connect(reverb);

    // Shimmer ring: high pitched oscillator sweep
    const osc=ctx.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(4000,now);
    osc.frequency.exponentialRampToValueAtTime(8000,now+0.15);
    osc.frequency.exponentialRampToValueAtTime(6000,now+0.6);
    const oscGain=ctx.createGain();
    oscGain.gain.setValueAtTime(0.08,now);
    oscGain.gain.exponentialRampToValueAtTime(0.001,now+0.8);
    osc.connect(oscGain); oscGain.connect(reverb);

    src.start(now); src.stop(now+0.6);
    osc.start(now); osc.stop(now+0.8);
  }catch(e){}
}

// Button click sound
function playClick(){
  try{
    const ctx=getAudio(); const now=ctx.currentTime;
    const osc=ctx.createOscillator(); osc.type='square';
    osc.frequency.setValueAtTime(800,now);
    osc.frequency.exponentialRampToValueAtTime(200,now+0.08);
    const g=ctx.createGain();
    g.gain.setValueAtTime(0.15,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(now); osc.stop(now+0.1);
  }catch(e){}
}

// Whoosh sound
function playWhoosh(){
  try{
    const ctx=getAudio(); const now=ctx.currentTime;
    const buf=ctx.createBuffer(1,ctx.sampleRate*0.25,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(i/d.length,0.5)*Math.pow(1-i/d.length,2);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=800; bp.Q.value=2;
    const g=ctx.createGain(); g.gain.value=0.15;
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(now); src.stop(now+0.25);
  }catch(e){}
}

// Chime sound (portrait hover)
function playChime(){
  try{
    const ctx=getAudio(); const now=ctx.currentTime;
    [880,1320,1760].forEach((f,i)=>{
      const osc=ctx.createOscillator(); osc.type='sine';
      osc.frequency.value=f;
      const g=ctx.createGain();
      g.gain.setValueAtTime(0,now+i*0.03);
      g.gain.linearRampToValueAtTime(0.06,now+i*0.03+0.01);
      g.gain.exponentialRampToValueAtTime(0.001,now+i*0.03+0.5);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now+i*0.03); osc.stop(now+i*0.03+0.6);
    });
  }catch(e){}
}

// Keyboard click (terminal typing)
function playKeyClick(vol=0.03){
  try{
    const ctx=getAudio(); const now=ctx.currentTime;
    const buf=ctx.createBuffer(1,ctx.sampleRate*0.025,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,3);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3000;
    const g=ctx.createGain(); g.gain.value=vol;
    src.connect(hp); hp.connect(g); g.connect(ctx.destination);
    src.start(now); src.stop(now+0.025);
  }catch(e){}
}

// ═══════════════════════════════════════════════
// VOICE PREVIEW (synthesized speech-like audio)
// ═══════════════════════════════════════════════
// Each agent: [baseFreq (Hz), tempo, formantFreq, personality (0=calm,1=energetic)]
const VOICE_PROFILES=[
  [180,1.0,900,0.3],  // 0 Luna - low, calm
  [230,1.2,1100,0.6], // 1 Wren - bright
  [200,0.9,950,0.4],  // 2 Vera - smooth
  [150,0.8,800,0.2],  // 3 Atlas - deep
  [260,1.4,1200,0.9], // 4 Echo - fast/bright
  [210,1.1,1050,0.5], // 5 Lyra - melodic
  [140,0.85,750,0.3], // 6 Rex - low authority
  [220,1.0,1000,0.4], // 7 Iris - clear
  [160,0.9,850,0.3],  // 8 Leo - steady
  [240,1.3,1150,0.7], // 9 Nova - upbeat
  [170,1.0,900,0.45], // 10 Cruz
  [215,1.1,1080,0.5], // 11 Jade
  [155,0.85,820,0.25],// 12 Orion
  [195,0.95,980,0.4], // 13 Sage
  [225,1.1,1100,0.6], // 14 River
  [185,1.0,950,0.4],  // 15 Felix
  [250,1.35,1200,0.8],// 16 Zoe
  [145,0.8,780,0.2],  // 17 Marcus
  [270,1.4,1250,0.9], // 18 Blaze
  [205,1.05,1020,0.5],// 19 Kai
  [190,1.0,980,0.45], // 20 Priya
  [175,0.95,900,0.4], // 21 Ace
  [245,1.3,1180,0.75],// 22 Maya
  [160,0.9,850,0.35], // 23 Sam
];

let currentVoiceSource=null;
let currentVoiceBtn=null;
const TTS_VERSION='gpt4o-mini-tts-1';
const ttsCache={};

function stopVoice(){
  if(currentVoiceSource){try{currentVoiceSource.pause();currentVoiceSource.currentTime=0;}catch(e){} currentVoiceSource=null;}
  if(currentVoiceBtn){
    currentVoiceBtn.classList.remove('playing');
    const wf=currentVoiceBtn.parentElement.querySelector('.voice-waveform');
    if(wf) wf.classList.remove('active');
    currentVoiceBtn=null;
  }
}

// Real OpenAI voice (gpt-4o-mini-tts via /api/tts), cached at the edge per agent.
function previewVoice(agentIdx, btn){
  if(currentVoiceBtn===btn){stopVoice();return;}
  stopVoice();
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  const audio=ttsCache[agentIdx]||new Audio('/api/tts?agent='+agentIdx+'&v='+TTS_VERSION);
  audio.preload='auto';
  ttsCache[agentIdx]=audio;
  currentVoiceSource=audio;
  currentVoiceBtn=btn;
  btn.classList.add('playing');
  const wf=btn.parentElement.querySelector('.voice-waveform');
  if(wf) wf.classList.add('active');
  audio.onended=()=>{ if(currentVoiceSource===audio) stopVoice(); };
  audio.onerror=()=>{
    delete ttsCache[agentIdx];
    if(currentVoiceSource===audio) stopVoice();
    console.error('Voice preview failed to load for agent',agentIdx);
  };
  audio.currentTime=0;
  const p=audio.play();
  if(p&&p.catch) p.catch(err=>{ if(currentVoiceSource===audio) stopVoice(); console.error('Voice preview play error',err); });
}

// ═══════════════════════════════════════════════
// LOGO SWORD SOUND ON HOVER
// ═══════════════════════════════════════════════
const navLogo=document.getElementById('navLogo');
let swordCooldown=false;
navLogo.addEventListener('mouseenter',()=>{
  if(!swordCooldown){playSword();swordCooldown=true;setTimeout(()=>swordCooldown=false,1200);}
});

// ═══════════════════════════════════════════════
// BUTTON SOUNDS
// ═══════════════════════════════════════════════
document.querySelectorAll('[data-sound]').forEach(el=>{
  el.addEventListener('mouseenter',()=>{
    if(el.dataset.sound==='whoosh') playWhoosh();
  });
  el.addEventListener('click',()=>playClick());
});

// ═══════════════════════════════════════════════
// PORTRAIT CARD HOVER SOUNDS
// ═══════════════════════════════════════════════
document.querySelectorAll('.portrait-card').forEach(card=>{
  let cardCooldown=false;
  card.addEventListener('mouseenter',()=>{
    if(!cardCooldown){playChime();cardCooldown=true;setTimeout(()=>cardCooldown=false,600);}
  });
});

// ═══════════════════════════════════════════════
// HOLLYWOOD TERMINAL ANIMATION
// ═══════════════════════════════════════════════
const terminalOutput=document.getElementById('terminalOutput');
const successBox=document.getElementById('successBox');
const successOutput=document.getElementById('successOutput');

// Terminal content: array of {type, text, delay, spanClass}
const TERMINAL_LINES=[
  {raw:true, html:'<span class="t-comment"># Deploy in 3 lines</span>', delay:600},
  {raw:true, html:'<span class="t-cmd">curl</span> <span class="t-muted">-X POST</span> \\', delay:80},
  {raw:true, html:'  <span class="t-url">api.squadron.tel/v1/agents/deploy</span> \\', delay:60},
  {raw:true, html:'  <span class="t-muted">-H</span> <span class="t-str">"Authorization: Bearer sq_live_..."</span> \\', delay:60},
  {raw:true, html:"  <span class='t-muted'>-d</span> <span class='t-str'>'</span><span class='t-val'>{</span>", delay:60},
  {raw:true, html:"    <span class='t-key'>\"agent\"</span><span class='t-str'>: </span><span class='t-str'>\"alex\"</span><span class='t-val'>,</span>", delay:55},
  {raw:true, html:"    <span class='t-key'>\"phone\"</span><span class='t-str'>: </span><span class='t-str'>\"+15550001234\"</span><span class='t-val'>,</span>", delay:55},
  {raw:true, html:"    <span class='t-key'>\"greeting\"</span><span class='t-str'>: </span><span class='t-str'>\"Hi, thanks for calling!\"</span><span class='t-val'>,</span>", delay:55},
  {raw:true, html:"    <span class='t-key'>\"knowledge_url\"</span><span class='t-str'>: </span><span class='t-str'>\"https://help.acme.com\"</span><span class='t-val'>,</span>", delay:55},
  {raw:true, html:"    <span class='t-key'>\"escalate_to\"</span><span class='t-str'>: </span><span class='t-str'>\"+15559876543\"</span>", delay:55},
  {raw:true, html:"  <span class='t-val'>}</span><span class='t-str'>'</span>", delay:55},
  {pause:900},
];

const SUCCESS_LINES=[
  {raw:true, html:"<span class='t-muted'>{</span><span class='t-key'>\"agent_id\"</span><span class='t-muted'>:</span><span class='t-str'>\"agt_9xKmPq2r\"</span><span class='t-muted'>,</span>", delay:60},
  {raw:true, html:" <span class='t-key'>\"status\"</span><span class='t-muted'>:</span><span class='t-str'>\"live\"</span><span class='t-muted'>,</span>", delay:60},
  {raw:true, html:" <span class='t-key'>\"phone\"</span><span class='t-muted'>:</span><span class='t-str'>\"+15550001234\"</span><span class='t-muted'>,</span>", delay:60},
  {raw:true, html:" <span class='t-key'>\"live_at\"</span><span class='t-muted'>:</span><span class='t-val'>1712345678</span><span class='t-muted'>}</span>", delay:60},
];

// Terminal boot: startup flicker
function terminalBoot(){
  const body=document.querySelector('.hero-terminal .terminal-body');
  body.style.opacity='0';
  setTimeout(()=>{body.style.transition='opacity 0.1s';body.style.opacity='0.7';},80);
  setTimeout(()=>{body.style.opacity='0.2';},160);
  setTimeout(()=>{body.style.opacity='1';body.style.transition='';},240);
  setTimeout(()=>{body.style.opacity='0.8';},300);
  setTimeout(()=>{body.style.opacity='1';startTerminal();},380);
}

// Cursor element
let cursorEl=null;
function ensureCursor(){
  if(!cursorEl){cursorEl=document.createElement('span');cursorEl.className='t-cursor';}
  return cursorEl;
}

// Type a line character by character with syntax spans
async function typeLine(lineEl, htmlContent, charDelay=2){
  // Parse HTML to get visible text and tags
  const temp=document.createElement('div'); temp.innerHTML=htmlContent;
  const nodes=Array.from(temp.childNodes);
  lineEl.innerHTML='';

  for(const node of nodes){
    if(node.nodeType===3){
      // Text node: type char by char
      const text=node.textContent;
      for(const ch of text){
        lineEl.appendChild(document.createTextNode(ch));
        
        await sleep(charDelay+Math.random()*charDelay*0.3);
      }
    } else {
      // Element node: clone and type its text
      const span=document.createElement(node.tagName);
      span.className=node.className;
      lineEl.appendChild(span);
      const text=node.textContent;
      for(const ch of text){
        span.appendChild(document.createTextNode(ch));
        
        await sleep(charDelay+Math.random()*charDelay*0.3);
      }
    }
  }
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function startTerminal(){
  terminalOutput.innerHTML='';
  successBox.classList.remove('visible');

  // Add cursor
  const cur=ensureCursor();
  terminalOutput.appendChild(cur);

  // Initial pause - cursor blinking
  await sleep(800);

  // Type each line
  for(const line of TERMINAL_LINES){
    if(line.pause){
      await sleep(line.pause);
      continue;
    }
    // Remove cursor
    if(cur.parentNode) cur.parentNode.removeChild(cur);
    // New line element
    const lineEl=document.createElement('span');
    lineEl.style.display='block';
    terminalOutput.appendChild(lineEl);

    if(line.raw){
      await typeLine(lineEl, line.html, line.delay||2);
    }

    // Add cursor after line
    terminalOutput.appendChild(cur);
    await sleep(40);
  }

  // Remove cursor
  if(cur.parentNode) cur.parentNode.removeChild(cur);

  // Show "connecting..." with ellipsis
  const connecting=document.createElement('span');
  connecting.style.display='block';
  connecting.style.color='rgba(255,255,255,0.3)';
  connecting.style.marginTop='4px';
  terminalOutput.appendChild(connecting);

  for(let i=0;i<3;i++){
    connecting.textContent='  Connecting'+'.'.repeat(i+1);
    await sleep(350);
  }
  connecting.textContent='  Connecting to api.squadron.tel...';
  await sleep(500);
  connecting.textContent='  ✓ Connected';
  connecting.style.color='var(--green)';
  await sleep(600);
  connecting.remove();

  // Show success box
  successBox.classList.add('visible');
  await sleep(100);

  // Type success lines
  successOutput.innerHTML='';
  for(const line of SUCCESS_LINES){
    const lineEl=document.createElement('span');
    lineEl.style.display='block';
    successOutput.appendChild(lineEl);
    await typeLine(lineEl,line.html,line.delay||4);
    await sleep(40);
  }

  // Play success chime
  playChime();

  // Loop after pause
  await sleep(5000);
  terminalBoot();
}

// Start terminal on load
window.addEventListener('load',()=>{
  setTimeout(terminalBoot,800);
});

// Stop voice when clicking outside
document.addEventListener('click',e=>{
  if(!e.target.closest('.portrait-card')) stopVoice();
});
