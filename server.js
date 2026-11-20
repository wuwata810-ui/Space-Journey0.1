'use strict';
// سيرفر "رحلة إلى الفضاء" أونلاين — بدون أي مكتبات خارجية. التشغيل: node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000,DIR=__dirname;
const MIME={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.js':'text/javascript'};
const HIDE=new Set(['server.js','package.json']);
const srv=http.createServer((req,res)=>{
  let p;try{p=decodeURIComponent(req.url.split('?')[0])}catch(e){p='/'}
  if(p==='/health'){res.end('ok');return}
  if(p==='/')p='/index.html';
  const f=path.join(DIR,path.normalize(p)),ext=path.extname(f);
  if(!f.startsWith(DIR+path.sep)||HIDE.has(path.basename(f))||!MIME[ext]){res.writeHead(404);res.end('404');return}
  fs.readFile(f,(e,b)=>{
    if(e){res.writeHead(404);res.end('404');return}
    res.writeHead(200,{'Content-Type':MIME[ext],'Cache-Control':(ext==='.html'||p==='/sw.js')?'no-cache':'public, max-age=3600'});
    res.end(b);
  });
});

/* ---------- WebSocket (يدوي، نصوص فقط) ---------- */
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients=new Set(),rooms=new Map();
const RT=new Set(['s','b','k','fin','dead','u','e','en','eb','wd','wn','rv','dp','dg','csk']); // رسائل تُمرَّر لباقي اللاعبين في الغرفة
const CH='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const names=new Map();
const nm=v=>String(v||'').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,14);
let nid=1;
const COOP_MAX=4; // أقصى عدد لاعبين في التعاوني
const BOT_NAMES=['روبوت رمادي ١','روبوت رمادي ٢','روبوت رمادي ٣','روبوت رمادي ٤'];
const finite=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;

// Human capacity is deliberately independent of the extra bots. Negative slots
// cannot collide with the monotonically allocated human slots.
function updateBots(r){
  if(!r.botManual)r.botCount=Math.max(0,4-r.players.length);
  const counts=[cnt(r,0),cnt(r,1)],bots=[];
  for(let i=0;i<r.botCount;i++){
    const t=r.m==='vs'?(counts[0]<=counts[1]?0:1):0;
    counts[t]++;bots.push({s:-1-i,n:BOT_NAMES[i],t,r:1,bot:1});
  }
  r.bots=bots;
}
function botSlot(r,s){return Number.isInteger(s)&&r.bots.some(b=>b.s===s)}

// Only the original match host may send these messages, and every field is
// checked rather than forwarding arbitrary client-supplied objects.
function botRelay(r,c,d){
  if(r.lobby||!r.botHost||c!==r.botHost||!r.bots.length)return;
  let out;
  if(d.t==='bs'){
    if(!Array.isArray(d.v)||d.v.length>4)return;
    const seen=new Set(),v=[];
    for(const q of d.v){
      if(!Array.isArray(q)||q.length!==13||!botSlot(r,q[0])||seen.has(q[0])||
         !finite(q[1],-100000,100000)||!finite(q[2],-100000,100000)||
         !finite(q[3],-10000,10000)||!finite(q[4],-10000,10000)||
         !finite(q[5],0,10000)||!finite(q[6],1,10000)||q[5]>q[6]||
         ![0,1].includes(q[7])||![0,1].includes(q[8])||![0,1].includes(q[9])||
         !finite(q[10],0,10000)||!finite(q[11],0,10000)||!finite(q[12],0,10000))return;
      seen.add(q[0]);v.push(q.slice());
    }
    out={t:'bs',v};
  }else if(d.t==='bu'){
    if(!botSlot(r,d.s)||!Array.isArray(d.c)||d.c.length>100)return;
    const cells=[];
    for(const q of d.c){
      if(!Array.isArray(q)||q.length!==4||!Number.isInteger(q[0])||!Number.isInteger(q[1])||
         !finite(q[0],-16,20)||!finite(q[1],-16,20)||!['h','r','e','w','a'].includes(q[2])||![0,1,2].includes(q[3]))return;
      cells.push(q.slice());
    }
    out={t:'bu',s:d.s,c:cells};
  }else if(d.t==='bb'){
    if(!botSlot(r,d.s)||!Array.isArray(d.b)||d.b.length>30)return;
    const bullets=[];
    for(const q of d.b){
      if(!Array.isArray(q)||q.length!==7||!finite(q[0],-100000,100000)||!finite(q[1],-100000,100000)||
         !finite(q[2],-1600,1600)||!finite(q[3],-1600,1600)||!finite(q[4],0,100)||
         !finite(q[5],0,4)||![0,1,2].includes(q[6]))return;
      bullets.push(q.slice());
    }
    out={t:'bb',s:d.s,b:bullets};
  }else if(d.t==='br'){
    if(!botSlot(r,d.s)||!Number.isInteger(d.to))return;
    const from=r.bots.find(b=>b.s===d.s),target=r.bots.find(b=>b.s===d.to)||r.players.find(p=>p.sl===d.to);
    if(!target||d.to===d.s||(r.m==='vs'&&from.t!==(target.bot?target.t:target.tm)))return;
    out={t:'br',s:d.s,to:d.to};
  }else if(d.t==='bf'){
    if(r.m!=='vs'||!botSlot(r,d.s))return;
    out={t:'bf',s:d.s};
  }else return;
  for(const o of r.players)if(o!==c&&o.alive)send(o,out);
}

function frame(op,d){
  let h;
  if(d.length<126)h=Buffer.from([0x80|op,d.length]);
  else{h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(d.length,2)}
  return Buffer.concat([h,d]);
}
function send(c,o){if(!c.alive)return;try{c.s.write(frame(1,Buffer.from(JSON.stringify(o))))}catch(e){}}
function kill(c){
  if(!c.alive)return;c.alive=false;clients.delete(c);leave(c);
  if(c.name&&names.get(c.name.toLowerCase())===c)names.delete(c.name.toLowerCase());
  try{c.s.end()}catch(e){}try{c.s.destroy()}catch(e){}
}
function leave(c){
  const r=c.room;if(!r)return;
  c.room=null;c.rd=0;
  const i=r.players.indexOf(c);if(i>=0)r.players.splice(i,1);
  if(!r.players.length){closeRoom(r);return}
  if(r.lobby){r.players.forEach(o=>o.rd=o===r.players[0]?0:o.rd);updateBots(r);lobbyMsg(r)}
  else{
    if(r.botHost===c&&r.bots.length){
      // No client has a complete authoritative bot state to take over. End the
      // match atomically instead of removing bots and accidentally declaring a win.
      const players=r.players.splice(0);r.botHost=null;closeRoom(r);
      for(const o of players)if(o.room===r){o.room=null;o.rd=0;}
      // Server-only event, bound to this match and the original host slot.
      for(const o of players)send(o,{t:'boff',f:c.sl,reason:'host_left',bi:r.botMatch});
      return;
    }
    if(r.botHost===c)r.botHost=null;
    for(const o of r.players)send(o,{t:'pl',f:c.sl});
  }
}
function closeRoom(r){if(r.code&&rooms.get(r.code)===r)rooms.delete(r.code);if(r.at){clearTimeout(r.at);r.at=0}}
const dfOf=v=>{v=+v;return [.7,1,1.4,2].includes(v)?v:1};
const lvOf=v=>[Math.max(0,Math.min(49,(v&&v[0])|0)),Math.max(1,Math.min(10,((v&&v[1])|0)||1))];
function mkCode(kind){let c;do{if(kind==='story'||kind==='level'){c='';for(let i=0;i<6;i++)c+=String(crypto.randomInt(10))}else{c='';for(let i=0;i<4;i++)c+=CH[crypto.randomInt(CH.length)]}}while(rooms.has(c));return c}
function mkRoom(c,d,pub){
  const m=d.m==='vs'?'vs':'coop',ts=m==='vs'?Math.max(1,Math.min(4,d.ts|0||1)):0,en=m==='coop'&&d.en?1:0,kind=m==='vs'?'vs':(['story','level'].includes(d.kind)?d.kind:'coop');
  const r={code:mkCode(kind),m,en,kind,ts,max:m==='vs'?ts*2:COOP_MAX,lv:lvOf(d.lv),df:dfOf(d.df),pub:pub?1:0,key:m+(en?'E':'')+ts+':'+kind,players:[],lobby:1,ns:0,inv:new Set(),at:0,botManual:false,botCount:0,bots:[],botHost:null};
  rooms.set(r.code,r);join(r,c);return r;
}
function cnt(r,t){return r.players.filter(p=>p.tm===t).length}
function join(r,c){
  leave(c);r.players.push(c);c.room=r;c.sl=r.ns++;c.rd=0;
  c.tm=r.m==='vs'?(cnt(r,0)<=cnt(r,1)?0:1):0;
  if(r.m==='vs'&&cnt(r,c.tm)>r.ts)c.tm=1-c.tm;
  updateBots(r);
  lobbyMsg(r);
  if(r.at){clearTimeout(r.at);r.at=0}
  if(r.pub&&r.players.length>=r.max&&r.max>1)r.at=setTimeout(()=>{r.at=0;if(r.lobby&&r.players.length>=r.max)launch(r)},4000);
}
function lobbyMsg(r){
  const ps=r.players.map(c=>({s:c.sl,n:c.name||'لاعب',t:c.tm|0,r:c.rd?1:0})).concat(r.bots);
  r.players.forEach((c,i)=>send(c,{t:'lobby',m:r.m,en:r.en,kind:r.kind,ts:r.ts,lv:r.lv,df:r.df,code:r.code,pub:r.pub,host:i===0?1:0,me:c.sl,p:ps,max:r.max,bn:r.botCount,ba:r.botManual?0:1}));
}
function launch(r){
  // Old cached clients interpret boff as disappearing bots and can award a
  // false win. Never start a bot match unless every human declares support.
  if(r.bots.length&&r.players.some(c=>c.botEnd!==1)){
    for(const c of r.players)send(c,{t:'err',e:'إصدار أحد اللاعبين لا يدعم إنهاء مباراة الروبوتات بأمان؛ حدّثوا اللعبة أو عطّلوا الروبوتات'});
    return;
  }
  r.lobby=0;if(r.at){clearTimeout(r.at);r.at=0}
  closeRoom(r);
  r.botHost=r.players[0]||null;
  // A fresh token prevents a delayed host-loss event ending a different match.
  r.botMatch=r.bots.length?crypto.randomBytes(16).toString('hex'):null;
  const ps=r.players.map(c=>({s:c.sl,n:c.name||'لاعب',t:c.tm|0})).concat(r.bots);
  for(const c of r.players){
    const start={t:'start',m:r.m,en:r.en,kind:r.kind,ts:r.ts,lv:r.lv,df:r.df,me:c.sl,p:ps,bh:r.botHost.sl};
    if(r.botMatch)start.bi=r.botMatch;
    send(c,start);
  }
}
function canStart(r){
  if(!r.lobby||!r.players.length)return false;
  for(let i=1;i<r.players.length;i++)if(!r.players[i].rd)return false;
  if(r.m==='vs'&&(![0,1].every(t=>cnt(r,t)+r.bots.filter(b=>b.t===t).length>0)))return false;
  return true;
}
function onMsg(c,d){
  const now=Date.now();if(now-c.t>1000){c.t=now;c.n=0}if(++c.n>200)return;
  switch(d.t){
    case 'pub':{
      leave(c);const m=d.m==='vs'?'vs':'coop',ts=m==='vs'?Math.max(1,Math.min(4,d.ts|0||1)):0,en=m==='coop'&&d.en?1:0,kind=m==='vs'?'vs':(['story','level'].includes(d.kind)?d.kind:'coop'),key=m+(en?'E':'')+ts+':'+kind;
      let r=null;for(const x of rooms.values())if(x.pub&&x.lobby&&x.key===key&&x.players.length<x.max&&x.players[0].alive){r=x;break}
      if(r){c.lv=lvOf(d.lv);join(r,c)}else mkRoom(c,d,1);
      break}
    case 'new':{leave(c);mkRoom(c,d,0);break}
    case 'join':{
      leave(c);const r=rooms.get(String(d.c||'').toUpperCase());
      if(!r||!r.lobby||r.players.length>=r.max){send(c,{t:'err',e:'الغرفة غير موجودة أو ممتلئة'});break}
      join(r,c);break}
    case 'name':{
      const n=nm(d.n);if(n.length<2){send(c,{t:'err',e:'الاسم قصير',c:'name'});break}
      const k=n.toLowerCase(),o=names.get(k);
      if(o&&o!==c){if(o.room){send(c,{t:'err',e:'الاسم مستخدم الآن',c:'name'});break}kill(o)}
      if(c.name&&c.name.toLowerCase()!==k)names.delete(c.name.toLowerCase());
      c.name=n;c.botEnd=d.be===1?1:0;names.set(k,c);send(c,{t:'named',n});
      if(c.room&&c.room.lobby)lobbyMsg(c.room);break}
    case 'inv':{ // دعوة صديق: إذا ما عندك غرفة ننشئ لك غرفة خاصة
      const o=names.get(nm(d.to).toLowerCase());
      if(!o||!o.alive||o===c){send(c,{t:'err',e:'لا يوجد لاعب بهذا الاسم'});break}
      if(o.room){send(c,{t:'err',e:o.name+' داخل غرفة الحين'});break}
      let r=c.room;
      if(r&&!r.lobby){send(c,{t:'err',e:'المباراة بدأت'});break}
      if(!r)r=mkRoom(c,d,0);
      if(r.players.length>=r.max){send(c,{t:'err',e:'الغرفة ممتلئة'});break}
      r.inv.add(o);
      send(o,{t:'inv',from:c.name,m:r.m,en:r.en,kind:r.kind,ts:r.ts});send(c,{t:'invok',w:o.name});break}
    case 'acc':{
      const s=names.get(nm(d.from).toLowerCase()),r=s&&s.room;
      if(!s||!s.alive||!r||!r.lobby||!r.inv.has(c)||c.room){send(c,{t:'err',e:'الدعوة انتهت'});break}
      if(r.players.length>=r.max){send(c,{t:'err',e:'الغرفة ممتلئة'});break}
      r.inv.delete(c);join(r,c);break}
    case 'dec':{
      const s=names.get(nm(d.from).toLowerCase());
      if(s&&s.room)s.room.inv.delete(c);
      if(s)send(s,{t:'err',e:(c.name||'اللاعب')+' رفض الدعوة'});break}
    case 'df':{const r=c.room;if(!r||!r.lobby||r.players[0]!==c)break;r.df=dfOf(d.v);for(const o of r.players)o.rd=0;lobbyMsg(r);break}
    case 'tm':{const r=c.room;if(!r||!r.lobby||r.m!=='vs')break;const t=1-c.tm;if(cnt(r,t)>=r.ts)break;c.tm=t;c.rd=0;updateBots(r);lobbyMsg(r);break}
    case 'bots':{const r=c.room;if(!r||!r.lobby||r.players[0]!==c)break;
      if(d.auto===1){r.botManual=false}else if(Number.isInteger(d.n)&&d.n>=0&&d.n<=4){r.botManual=true;r.botCount=d.n}else break;
      updateBots(r);lobbyMsg(r);break}
    case 'rdy':{const r=c.room;if(!r||!r.lobby||r.players[0]===c)break;c.rd=d.v?1:0;lobbyMsg(r);break}
    case 'go':{const r=c.room;if(!r||r.players[0]!==c||!canStart(r))break;launch(r);break}
    case 'leave':leave(c);break;
    case 'bs':case 'bu':case 'bb':case 'br':case 'bf':{const r=c.room;if(r)botRelay(r,c,d);break}
    default:{
      const r=c.room;if(!r||r.lobby||!RT.has(d.t))return;
      d.f=c.sl;for(const o of r.players)if(o!==c&&o.alive)send(o,d)}
  }
}
function parse(c){
  for(;;){
    const b=c.buf;if(b.length<2)return;
    const op=b[0]&15,fin=b[0]>>7,mask=b[1]>>7;let len=b[1]&127,o=2;
    if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);o=4}else if(len===127)return kill(c);
    if(!mask||!fin||op===0||len>4096)return kill(c);
    if(b.length<o+4+len)return;
    const mk=b.subarray(o,o+4),pl=Buffer.alloc(len);
    for(let i=0;i<len;i++)pl[i]=b[o+4+i]^mk[i&3];
    c.buf=b.subarray(o+4+len);c.last=Date.now();
    if(op===8){try{c.s.write(frame(8,Buffer.alloc(0)))}catch(e){}return kill(c)}
    if(op===9){try{c.s.write(frame(10,pl))}catch(e){}continue}
    if(op===1){let d;try{d=JSON.parse(pl.toString('utf8'))}catch(e){continue}if(d&&typeof d==='object')onMsg(c,d)}
  }
}
srv.on('upgrade',(req,s)=>{
  const k=req.headers['sec-websocket-key'];
  if(!k||clients.size>2000){s.destroy();return}
  s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(k+GUID).digest('base64')+'\r\n\r\n');
  const c={s,id:nid++,buf:Buffer.alloc(0),room:null,alive:true,n:0,t:Date.now(),last:Date.now(),lv:[0,1],name:'',inv:null};
  clients.add(c);s.setNoDelay(true);
  s.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);if(c.buf.length>16384)return kill(c);parse(c)});
  s.on('close',()=>kill(c));s.on('error',()=>kill(c));
});
setInterval(()=>{const now=Date.now();for(const c of clients){if(now-c.last>70000)kill(c);else try{c.s.write(frame(9,Buffer.alloc(0)))}catch(e){}}},25000);
srv.listen(PORT,()=>console.log('Space online server on :'+PORT));
