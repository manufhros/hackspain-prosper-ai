const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('consoleToken') || '', selected = null, calls = [], rows = [], cursor = 0, controller, timer, callsSignature='';
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
async function api(path) {
  const r = await fetch('/console/api/' + path, {headers:{Authorization:'Bearer ' + token}});
  if (!r.ok) { const data=await r.json(); throw new Error(typeof data.detail==='string'?data.detail:'Error '+r.status); }
  return r.json();
}
function renderCalls() {
  $('active').textContent = calls.filter(c=>c.status==='active').length;
  $('completed').textContent = calls.filter(c=>c.status==='completed').length;
  $('errors').textContent = calls.filter(c=>c.errors>0 || ['failed','interrupted','missing_record'].includes(c.status)).length;
  $('actions').textContent = calls.reduce((n,c)=>n+c.actions,0);
  $('calls').replaceChildren();
  for (const c of calls.filter(c=>c.call_id.includes($('search').value))) {
    const b=el('button','call'+(selected===c.call_id?' selected':'')); b.append(el('code','',c.call_id),el('small',c.errors?'failed':'',`${c.status} · ${c.actions} acciones · ${c.errors} errores`));
    b.onclick=()=>select(c.call_id); $('calls').append(b);
  }
  if (!calls.length) $('calls').append(el('p','empty','Esperando la primera llamada.'));
  const c=calls.find(c=>c.call_id===selected); if(c) $('detail-status').textContent=`${c.status} · ${new Date(c.started_at).toLocaleString()} · ${c.errors} errores`;
}
function renderRows() {
  const box=$('timeline'), bottom=box.scrollTop+box.clientHeight>=box.scrollHeight-70;
  const expanded = new Map([...box.querySelectorAll('details')].map(node=>[node.dataset.eventId,node.open]));
  box.replaceChildren();
  const f=$('filter').value;
  for(const row of rows.filter(r=>f==='all'||(f==='error'?r.level==='error':r.kind.startsWith(f)))) {
    const item=el('details','event '+row.level), summary=el('summary'); item.dataset.eventId=String(row.id);
    summary.append(el('time','',new Date(row.ts).toLocaleTimeString()),el('span','kind',row.kind),el('span','summary',row.data.name||row.data.path||row.data.message||'')); item.append(summary);
    if(row.kind.startsWith('transcript.')) { item.open=true; item.append(el('div','transcript',row.data.text)); }
    if(row.level==='error') item.open=true;
    if(expanded.has(String(row.id))) item.open=expanded.get(String(row.id));
    item.append(el('pre','',JSON.stringify(row.data,null,2))); box.append(item);
  }
  if(!rows.length) box.append(el('p','empty','Sin eventos todavía.'));
  if(bottom) box.scrollTop=box.scrollHeight;
}
async function select(id) {
  selected=id; rows=[]; $('selected').textContent=id; $('export').disabled=false; renderCalls();
  let after=0;
  do {const data=await api('events?call_id='+encodeURIComponent(id)+'&after='+after); if(selected!==id)return; rows.push(...data.events); if(data.events.length<300)break; after=data.events.at(-1).id;}while(rows.length<6000);
  rows=[...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>a.id-b.id);renderRows();
}
async function refresh() { const next=(await api('calls')).calls, signature=JSON.stringify(next);if(signature!==callsSignature){calls=next;callsSignature=signature;renderCalls();} }
async function stream(signal) {
  while(!signal.aborted) {
    try {
      const r=await fetch('/console/api/stream?after='+cursor,{headers:{Authorization:'Bearer '+token},signal});
      if(!r.ok)throw new Error('Stream '+r.status);
      $('connection').textContent='● En directo'; $('connection').className='badge live';
      const reader=r.body.getReader(), decoder=new TextDecoder(); let buffer='';
      while(!signal.aborted) {const {done,value}=await reader.read(); if(done)break; buffer+=decoder.decode(value,{stream:true}); let cut;
        while((cut=buffer.indexOf('\n\n'))>=0) {const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const line=block.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;const row=JSON.parse(line.slice(6));cursor=row.id;if(row.call_id===selected&&!rows.some(x=>x.id===row.id)){rows.push(row);if(rows.length>6000)rows.shift();renderRows();}}
      }
    } catch(e) {if(signal.aborted)return; $('connection').textContent='Reconectando…';$('connection').className='badge';}
    await new Promise(r=>setTimeout(r,1500));
  }
}
async function connect() {
  try {const config=await api('config'); await refresh(); $('configuration').textContent=`${config.stt} → ${config.llm} → ${config.tts}`+(config.missing_credentials.length?' · Faltan: '+config.missing_credentials.join(', '):'');
    sessionStorage.setItem('consoleToken',token);$('login').hidden=true;$('dashboard').hidden=false;controller?.abort();controller=new AbortController();stream(controller.signal);clearInterval(timer);timer=setInterval(()=>refresh().catch(e=>{$('connection').textContent=e.message;}),2000);
  }catch(e){$('login-error').textContent=e.message;}
}
$('login-form').onsubmit=e=>{e.preventDefault();token=$('token').value;connect();};
$('logout').onclick=()=>{controller?.abort();clearInterval(timer);sessionStorage.removeItem('consoleToken');location.reload();};
$('filter').onchange=renderRows;$('search').oninput=renderCalls;
$('export').onclick=()=>{const a=el('a');const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));a.href=url;a.download='call-events.json';a.click();URL.revokeObjectURL(url);};
if(token)connect();
