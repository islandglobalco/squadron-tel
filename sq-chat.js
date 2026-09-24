(function(){
  let sqOpen=false, sqSession=null, sqTyping=false;
  const msgs=document.getElementById('sqChatMessages');

  function sqAddMsg(text,role){
    const wrap=document.createElement('div');
    wrap.className='sqchat-msg '+(role==='agent'?'agent':'user');
    const bubble=document.createElement('div');
    bubble.className='sqchat-bubble';
    // render **bold** markdown
    bubble.innerHTML=text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    wrap.appendChild(bubble);
    msgs.appendChild(wrap);
    msgs.scrollTop=msgs.scrollHeight;
    return wrap;
  }

  function sqShowTyping(){
    const wrap=document.createElement('div');
    wrap.className='sqchat-msg agent'; wrap.id='sqTypingIndicator';
    wrap.innerHTML='<div class="sqchat-typing"><span></span><span></span><span></span></div>';
    msgs.appendChild(wrap);
    msgs.scrollTop=msgs.scrollHeight;
  }

  function sqHideTyping(){
    const el=document.getElementById('sqTypingIndicator');
    if(el) el.remove();
  }

  window.sqToggleChat=function(){
    sqOpen=!sqOpen;
    document.getElementById('sqChatWindow').classList.toggle('open',sqOpen);
    if(sqOpen && msgs.children.length===0) sqGreet();
  };

  function sqGreet(){
    sqShowTyping();
    setTimeout(()=>{
      sqHideTyping();
      sqAddMsg("I'm **Ace**, Squadron's AI assistant. I can answer questions about pricing, setup, agents and channels.",'agent');
    },800);
  }

  window.sqSendMsg=function(){
    const inp=document.getElementById('sqChatInput');
    const text=inp.value.trim();
    if(!text||sqTyping) return;
    inp.value='';
    sqAddMsg(text,'user');
    sqTyping=true;
    sqShowTyping();

    fetch('/api/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text, sessionId:sqSession})
    })
    .then(r=>r.json())
    .then(d=>{
      sqSession=d.sessionId;
      sqHideTyping();
      sqTyping=false;
      sqAddMsg(d.reply||'Thanks for your message! Our team will follow up shortly.','agent');
      if(d.followUp){sqShowTyping();setTimeout(()=>{sqHideTyping();sqAddMsg(d.followUp,'agent');},900);}
    })
    .catch(()=>{
      sqHideTyping();
      sqTyping=false;
      sqAddMsg('Thanks! Our team will get back to you shortly at info@squadron.tel','agent');
    });
  };
})();
