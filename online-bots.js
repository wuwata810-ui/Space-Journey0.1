/* Online room bots. Load after index.html's scripts and bots.js.
 * The server owns the roster; only the original match host simulates bots.
 * Existing enemy simulation remains per human, as in the original game.
 */
(function () {
  'use strict';
  const GREY = '#a9adb5';
  const BOT_COLORS = ['#38d9ff', '#ff5c8a', '#ffc247', '#a77bff'];
  const botColor = (p, i) => MP.m === 'vs' ? (p.tm === 0 ? '#38d9ff' : '#ff5964') : BOT_COLORS[i % BOT_COLORS.length];
  const online = { host: false, hostSlot: null, match: null, bots: [], stateTimer: 0, stage: '', enabled: false };
  const isBot = p => !!(p && p.bot);
  const aliveSocket = () => !!(MP.ws && MP.ws.readyState === 1);
  const limit = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 0));
  const rnd = x => Math.round(x * 100) / 100;
  const player = id => MP.pm && MP.pm[id];

  // The server must not start a bot match with a stale client that would turn
  // host loss into a false result. Advertise this capability on each connection.
  const sendMessage = mpSend;
  mpSend = function (d) {
    return sendMessage(d && d.t === 'name' ? Object.assign({},d,{be:1}) : d);
  };

  // The normal lobby was laid out for human slots only. Keep its difficulty,
  // ready and team controls, but render human capacity and extra bots separately.
  const lobbyRender = mpLobR;
  mpLobR = function () {
    lobbyRender();
    const d = MP.ld;
    if (!d || !Array.isArray(d.p) || !Number.isInteger(d.bn)) return;
    const humans = d.p.filter(p => !p.bot), bots = d.p.filter(isBot);
    const host = !!d.host, vs = d.m === 'vs', hs = humans[0] && humans[0].s;
    $('lbc').textContent = (d.pub ? '🌍 غرفة عامة' : '🔒 رمز الغرفة: ' + d.code) +
      ' · بشر ' + humans.length + '/' + d.max + ' · روبوتات ' + bots.length;
    const card = p => {
      const c = document.createElement('div');
      c.style.cssText = 'border:2px solid #6c7588;border-radius:6px;padding:6px 4px;background:' +
        (p && p.bot ? '#c5c8cd' : p ? '#e7eaf0' : '#f3f5f9') + ';font-size:14px;min-height:42px;color:#2b3345;overflow:hidden';
      const a = document.createElement('div'), b = document.createElement('div');
      a.style.fontWeight = '700'; b.style.fontSize = '12px';
      if (p && p.bot) {
        const swatch = vs ? (p.t === 0 ? '#38d9ff' : '#ff5964') : BOT_COLORS[p.s % BOT_COLORS.length];
        a.style.color = swatch; c.style.borderColor = swatch;
      }
      a.textContent = p ? p.n + (p.s === d.me ? ' (أنت)' : '') : '—';
      b.textContent = !p ? 'مكان بشري فارغ' : p.bot ? '🤖 روبوت · جاهز تلقائياً' :
        p.s === hs ? '👑 المضيف' : p.r ? '✅ جاهز' : '⏳ غير جاهز';
      c.append(a, b); return c;
    };
    const box = $('lbp'); box.innerHTML = '';
    if (vs) {
      box.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
      [0, 1].forEach(t => {
        const col = document.createElement('div');
        col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:6px';
        const title = document.createElement('div');
        title.textContent = t ? '🔴 الفريق الثاني' : '🔵 الفريق الأول';
        title.style.cssText = 'font-weight:700;font-size:13px'; col.appendChild(title);
        const members = d.p.filter(p => p.t === t);
        for (let i = 0; i < Math.max(d.ts, members.length); i++) col.appendChild(card(members[i]));
        box.appendChild(col);
      });
    } else {
      box.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px';
      const members = humans.concat(bots);
      for (const p of members) box.appendChild(card(p));
      for (let i = humans.length; i < d.max; i++) box.appendChild(card(null));
    }
    $('lbi').style.display = humans.length < d.max ? 'flex' : 'none';
    let controls = $('onlineBotControls');
    if (!controls) {
      controls = document.createElement('div'); controls.id = 'onlineBotControls';
      box.parentNode.insertBefore(controls, box.nextSibling);
    }
    controls.style.cssText = 'margin:8px 0;padding:8px;border-radius:6px;background:#d8dbe0;color:#29303a;font-size:14px';
    controls.innerHTML = '';
    const label = document.createElement('label'); label.textContent = '🤖 روبوتات إضافية: ';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'عدد الروبوتات الإضافية');
    for (let i = 0; i <= 4; i++) {
      const option = document.createElement('option'); option.value = String(i); option.textContent = String(i);
      select.appendChild(option);
    }
    select.value = String(d.bn); select.disabled = !host;
    select.onchange = () => mpSend({t:'bots', n:Number(select.value)});
    label.appendChild(select); controls.appendChild(label);
    const auto = document.createElement('button'); auto.type = 'button'; auto.className = 'btn';
    auto.style.cssText = 'margin-inline-start:8px;padding:5px 9px;font-size:12px';
    auto.textContent = d.ba ? 'تلقائي ✓' : 'اقتراح تلقائي'; auto.disabled = !host;
    auto.onclick = () => mpSend({t:'bots',auto:1}); controls.appendChild(auto);
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;margin-top:4px';
    note.textContent = host ? 'يمكن إضافة ٠–٤ روبوتات حتى لو اكتملت مقاعد البشر.' : 'المضيف يختار عدد الروبوتات.';
    controls.appendChild(note);
    const ready = humans.slice(1).every(p => p.r);
    const teams = !vs || [0,1].every(t => d.p.some(p => p.t === t));
    const go = $('lbg');
    if (host) { go.disabled = !(ready && teams); go.textContent = '▶ ابدأ (' + d.p.length + ')'; }
    if (host && !teams) $('lbh').textContent = 'يلزم لاعب أو روبوت في كل فريق';
    else if (host && ready) $('lbh').textContent = 'كل البشر جاهزون — اضغط ابدأ';
    if (d.pub && humans.length >= d.max) $('lbh').textContent = '🚀 اكتملت مقاعد البشر — تبدأ تلقائياً بعد لحظات';
  };

  // A bot never blocks the wave or story cutscene barriers.
  const oldAllDone = mpAllDone;
  mpAllDone = function () {
    if (!MP.on || !MP.ps.some(isBot)) return oldAllDone();
    return MP.ps.every(p => p.bot || p.dead || p.gone || p.pwd >= WV.n);
  };
  const oldCsCnt = csCnt, oldCsUI = csUI, oldCsCheck = csCheck;
  function storyHumans() { return 1 + MP.ps.filter(p => !p.bot && !p.gone).length; }
  csCnt = function () {
    if (!stMP() || !MP.ps.some(isBot)) return oldCsCnt();
    let n = CS.me ? 1 : 0;
    for (const p of MP.ps) if (!p.bot && !p.gone && CS.rd && CS.rd[p.s]) n++;
    return n;
  };
  csUI = function () {
    if (!stMP() || !MP.ps.some(isBot)) return oldCsUI();
    const b = $('csb'); if (!b) return;
    const n = csCnt(), total = storyHumans();
    b.textContent = CS.me ? '⏳ بانتظار الباقين (' + n + '/' + total + ')' :
      'تخطي ⏭' + (n ? ' (' + n + '/' + total + ')' : '');
  };
  csCheck = function () {
    if (!stMP() || !MP.ps.some(isBot)) return oldCsCheck();
    if (CS.cb && CS.me && csCnt() >= storyHumans()) csFin();
  };

  function makeBot(p, index, all) {
    const team = all.filter(q => q.t === p.tm);
    const ti = team.findIndex(q => q.s === p.s);
    const x = MP.m === 'vs' ? (p.tm ? 220 : -220) : (index - (all.length - 1) / 2) * 90;
    const y = MP.m === 'vs' ? (ti - (team.length - 1) / 2) * 90 : 0;
    const cells = [];
    MAPS[0].forEach((row, j) => [...row].forEach((ch, i) => {
      const t = {H:'h',R:'r',E:'e',W:'w'}[ch];
      if (t) cells.push({x:i,y:j,t,c:Math.random() * .2});
    }));
    return {s:p.s, tm:p.tm, x, y, vx:0, vy:0, rot:0, aim:0, hp:60, max:60, sp:150,
      dead:false, shield:0, rapid:0, inv:{m:50,g:50,e:50}, cells,
      wi:0, ai:0, ei:0, upgrade:3+index*.35, sentCells:'', rescue:-1, rescueTime:0};
  }
  function syncGhost(b) {
    const p = player(b.s); if (!p) return;
    let g = p.g;
    if (!g) g = p.g = {x:b.x,y:b.y,r:b.rot,dr:[]};
    Object.assign(g,{tx:b.x,ty:b.y,tr:b.rot,h:b.hp,M:b.max,mv:Math.hypot(b.vx,b.vy)>10?1:0,
      sh:0,sg:b.shield>0?1:0,dead:b.dead?1:0});
    p.dead = b.dead ? 1 : 0; p.col = GREY;
    if (b.dead) { p.cx=b.x; p.cy=b.y; } else { p.cx=null; p.cy=null; }
  }
  function sendCells(b, force) {
    const cells = b.cells.map(c => [c.x,c.y,c.t,c.sn?2:c.sg?1:0]);
    const key = JSON.stringify(cells);
    if (!force && key === b.sentCells) return;
    b.sentCells = key;
    const p = player(b.s);
    if (p) p.uc = cells.map(q => ({x:q[0],y:q[1],t:q[2],c:0,sg:q[3]===1?1:0,sn:q[3]===2?1:0}));
    mpSend({t:'bu',s:b.s,c:cells});
  }
  const startGame = mpStart;
  mpStart = function (d) {
    online.host = !!(Number.isInteger(d.bh) && d.bh === d.me);
    online.hostSlot = Number.isInteger(d.bh) ? d.bh : null;
    online.match = typeof d.bi === 'string' && /^[0-9a-f]{32}$/.test(d.bi) ? d.bi : null;
    online.enabled = Number.isInteger(d.bh) && Array.isArray(d.p) && d.p.some(isBot);
    online.bots = []; online.stateTimer = 0; online.stage = '';
    const names = new Set((d.p || []).filter(isBot).map(p => p.n));
    const addFriend = mpFrAdd;
    mpFrAdd = function (n) { if (!names.has(n)) return addFriend(n); };
    try { startGame(d); } finally { mpFrAdd = addFriend; }
    if (!online.enabled) return;
    const all = d.p.slice().sort((a,b) => a.s-b.s);
    for (let i=0;i<all.length;i++) {
      const q=all[i]; if (!q.bot) continue;
      const p=player(q.s); if (!p) continue;
      p.bot=1; p.botColor=botColor(q,i); p.col=p.botColor;
      const b=makeBot(p,i,all); online.bots.push(b); syncGhost(b);
      // The client-side copy is display-only unless it is the host.
      p.uc=b.cells.map(c => ({x:c.x,y:c.y,t:c.t,c:0,sg:0,sn:0}));
    }
    if (stMP() && CS.cb) csUI();
    if (online.host) for (const b of online.bots) sendCells(b,true);
  };

  function advanceStage() {
    const key = MP.kind === 'story' ? cur.w + ':' + cur.l : 'one';
    if (online.stage === key) return;
    const was = online.stage; online.stage = key;
    if (!was || MP.kind !== 'story') return;
    for (const b of online.bots) {
      const p=player(b.s); if (!p || p.gone) continue;
      b.dead=false; b.hp=b.max; b.vx=b.vy=0; b.shield=3;
      b.x=P.x + (b.s % 4) * 65; b.y=P.y + 100;
      b.inv.m+=50; b.inv.g+=50; b.inv.e+=50;
      syncGhost(b); sendCells(b,true);
    }
  }
  function upgrade(b) {
    if (b.hp < b.max*.55 && b.inv.m>=2) { b.inv.m-=2; b.hp=Math.min(b.max,b.hp+40); }
    else if (b.inv.g>=20 && b.wi<wSlots.length && b.cells.filter(c=>c.t==='w'&&!c.sn&&!c.sg).length < (crazy()?5:14)) {
      b.inv.g-=20;
      for (let i=0;i<2 && b.wi<wSlots.length && b.cells.filter(c=>c.t==='w'&&!c.sn&&!c.sg).length<(crazy()?5:14);i++) { const s=wSlots[b.wi++]; b.cells.push({x:s[0],y:s[1],t:'w',c:Math.random()*.3}); }
    } else if (b.inv.g>=30 && b.wi<wSlots.length && !b.cells.some(c=>c.sn)) {
      b.inv.g-=30; const s=wSlots[b.wi++]; b.cells.push({x:s[0],y:s[1],t:'w',sn:1,c:0});
    } else if (b.inv.m>=20 && b.ai<aSlots.length) {
      b.inv.m-=20;
      for (let i=0;i<2 && b.ai<aSlots.length;i++) { const s=aSlots[b.ai++]; b.cells.push({x:s[0],y:s[1],t:'a',c:0}); b.max+=30; b.hp+=30; }
    } else if (b.inv.e>=30 && b.sp<250) {
      b.inv.e-=30; b.sp+=25;
      for (let i=0;i<2 && b.ei<eSlots.length;i++) { const s=eSlots[b.ei++]; b.cells.push({x:s[0],y:s[1],t:'e',c:0}); }
    }
    sendCells(b,false);
  }
  function targets(b) {
    if (MP.m === 'vs') {
      const out=[];
      if (!MP.dead && MP.tm!==b.tm) out.push({x:P.x,y:P.y});
      for (const p of MP.ps) if (p.tm!==b.tm && !p.dead && !p.gone && p.g) out.push(p.g);
      return out;
    }
    const out=E.slice();
    for (const p of MP.ps) if (!p.bot && !p.gone) for (const k in p.gd) {
      const e=p.gd[k]; if (e.live && e.hp>0) out.push(e);
    }
    return out;
  }
  function nearest(list, b, radius) {
    let best=null, bestD=radius;
    for (const x of list) { const d=Math.hypot(x.x-b.x,x.y-b.y); if (d<bestD) {best=x;bestD=d;} }
    return best;
  }
  function rescueTarget(b) {
    if (MP.rl<=0) return null;
    const list=[];
    if (MP.dead && MP.cx!=null && (MP.m!=='vs'||MP.tm===b.tm)) list.push({s:MP.me,x:MP.cx,y:MP.cy});
    for (const p of MP.ps) if (p.s!==b.s && p.dead && !p.gone && p.cx!=null && (MP.m!=='vs'||p.tm===b.tm)) list.push({s:p.s,x:p.cx,y:p.cy});
    return nearest(list,b,200000);
  }
  function botRescue(b, t, dt) {
    if (!t || Math.hypot(t.x-b.x,t.y-b.y)>RESCUE_R-8) { b.rescue=-1; b.rescueTime=0; return; }
    if (b.rescue!==t.s) { b.rescue=t.s; b.rescueTime=0; }
    b.rescueTime+=dt;
    if (b.rescueTime>=RESCUE_SEC) {
      b.rescue=-1; b.rescueTime=0;
      mpSend({t:'br',s:b.s,to:t.s});
      mpMsg({t:'rv',f:b.s,to:t.s});
    }
  }
  function shoot(b, target, dt) {
    const q=[];
    for (const c of b.cells) {
      if (c.t!=='w') continue;
      c.c=(c.c||0)-dt;
      if (!target || c.c>0) continue;
      const ca=Math.cos(b.rot),sa=Math.sin(b.rot);
      const x=b.x+(c.x-5)*CFG.size*ca-(c.y-3)*CFG.size*sa;
      const y=b.y+(c.x-5)*CFG.size*sa+(c.y-3)*CFG.size*ca;
      const spread=c.sg?[-.28,-.14,0,.14,.28]:[0];
      for (const offset of spread) {
        const a=b.aim+offset+(Math.random()-.5)*.12, speed=c.sn?1400:c.sg?600:560;
        const vx=Math.cos(a)*speed, vy=Math.sin(a)*speed, damage=c.sn?40:c.sg?4:8;
        const life=c.sn?.9:c.sg?.32:1.1, kind=c.sn?2:c.sg?1:0;
        const friendly=MP.m==='coop'||b.tm===MP.tm;
        B.push({x,y,vx,vy,dmg:damage,life,own:0,r:1,es:1,vis:friendly?1:0,
          bc:friendly?GREY:'#ffa646',sg:c.sg?1:0,sn:c.sn?1:0,_botTeam:b.tm,_botShot:1});
        q.push([rnd(x),rnd(y),rnd(vx),rnd(vy),damage,life,kind]);
      }
      c.c=(c.sn?2:c.sg?1.2:.58)*(b.rapid>0?.55:1);
    }
    for (let i=0;i<q.length;i+=30) mpSend({t:'bb',s:b.s,b:q.slice(i,i+30)});
  }
  function moveAndAct(b, dt) {
    const p=player(b.s); if (!p || p.gone) return;
    if (b.dead) {
      if (!p.dead) { b.dead=false; b.hp=Math.max(1,b.max*.5); b.shield=5; }
      else { syncGhost(b); return; }
    }
    b.shield=Math.max(0,b.shield-dt); b.rapid=Math.max(0,b.rapid-dt);
    b.upgrade-=dt; if (b.upgrade<=0) { b.upgrade=5; upgrade(b); }
    const target=nearest(targets(b),b,900), rescue=rescueTarget(b);
    const loot=MP.m==='coop' ? nearest(D.filter(d=>!d.got),b,350) : null;
    let destination=rescue || loot || target;
    if (!destination && flag) destination=flag;
    if (MP.m==='vs' && flag && !rescue && (!target || Math.hypot(target.x-b.x,target.y-b.y)>550)) destination=flag;
    let ax=0, ay=0;
    if (destination) {
      const dx=destination.x-b.x,dy=destination.y-b.y,dist=Math.hypot(dx,dy)||1;
      let desire=1;
      if (rescue===destination && dist<RESCUE_R-15) desire=0;
      else if (target===destination && dist<230) desire=-.6;
      else if (target===destination && dist<380) desire=.15;
      ax=dx/dist*desire; ay=dy/dist*desire;
      if (target===destination && dist<450) { ax+=-dy/dist*.45; ay+=dx/dist*.45; }
    }
    if (target) b.aim=Math.atan2(target.y-b.y,target.x-b.x);
    const m=Math.hypot(ax,ay); if (m>1) {ax/=m;ay/=m;}
    b.vx+=(ax*b.sp-b.vx)*Math.min(1,dt*3); b.vy+=(ay*b.sp-b.vy)*Math.min(1,dt*3);
    b.x=limit(b.x+b.vx*dt,-99000,99000); b.y=limit(b.y+b.vy*dt,-99000,99000);
    if (Math.hypot(b.vx,b.vy)>20) {
      const angle=Math.atan2(b.vy,b.vx)-b.rot;
      b.rot+=Math.atan2(Math.sin(angle),Math.cos(angle))*Math.min(1,dt*7);
      b.rot=Math.atan2(Math.sin(b.rot),Math.cos(b.rot));
    }
    botRescue(b,rescue,dt);
    if (!MP.on) return;
    shoot(b,target,dt);
    if (MP.m==='coop' && D.length) {
      const got=[];
      for (const d of D) if (!d.got && Math.hypot(d.x-b.x,d.y-b.y)<5.2*CFG.size+6) {
        d.got=1; if(d.id)got.push(d.id);
        if(d.k==='f') b.rapid=8; else if(d.k==='s') b.shield=5;
        else if(Object.prototype.hasOwnProperty.call(b.inv,d.k)) b.inv[d.k]=Math.min(10000,b.inv[d.k]+1);
      }
      if(got.length) mpSend({t:'dg',i:got.slice(0,60)});
      D=D.filter(d=>!d.got);
    }
    syncGhost(b);
    if (flag && !done && Math.hypot(flag.x-b.x,flag.y-b.y)<5.2*CFG.size+28) {
      if (MP.m==='vs') { mpSend({t:'bf',s:b.s}); mpEnd(b.tm===MP.tm?'win':'lose'); }
      else winLevel();
    }
  }
  function hitBots(dt) {
    let died=false;
    for (const shot of B) {
      if (shot.life<=0) continue;
      let team=null, hostileEnemy=false;
      if (MP.m==='vs') {
        team=shot.own?MP.tm:shot._botTeam;
        if (team!==0 && team!==1) continue;
      } else {
        hostileEnemy=(!shot.own&&!shot.vis&&!shot.r) || !!shot.en;
        if (!hostileEnemy) continue;
      }
      let hit=null, first=Infinity;
      // Swept collision avoids fast bullets jumping across a bot between frames.
      const dx=shot.vx*dt,dy=shot.vy*dt,x0=shot.x-dx,y0=shot.y-dy,den=dx*dx+dy*dy;
      for (const b of online.bots) {
        if (b.dead || (MP.m==='vs' && team===b.tm)) continue;
        const t=den?limit(((b.x-x0)*dx+(b.y-y0)*dy)/den,0,1):0;
        if(Math.hypot(x0+dx*t-b.x,y0+dy*t-b.y)<5.2*CFG.size+4 && t<first){hit=b;first=t;}
      }
      if(hit){
        shot.life=0;
        if (hit.shield<=0) hit.hp=Math.max(0,hit.hp-(hostileEnemy && shot.en ? 6*CFG.diff : (Number(shot.dmg)||0)));
        if (hit.hp<=0) { hit.dead=true; hit.vx=hit.vy=0; died=true; }
        syncGhost(hit);
      }
    }
    return died;
  }
  function sendState() {
    const v=online.bots.map(b=>[b.s,rnd(b.x),rnd(b.y),rnd(b.rot),rnd(b.aim),rnd(b.hp),rnd(b.max),
      Math.hypot(b.vx,b.vy)>10?1:0,b.shield>0?1:0,b.dead?1:0,
      Math.floor(limit(b.inv.m,0,10000)),Math.floor(limit(b.inv.g,0,10000)),Math.floor(limit(b.inv.e,0,10000))]);
    if(v.length) mpSend({t:'bs',v});
  }

  // The stock world stops when every human is dead. A surviving bot cannot
  // complete a cooperative match alone, but may still rescue someone if the
  // shared rescue counter is positive. Only the bot host decides this result.
  function noRescueStalemate() {
    return MP.on && !MP.end && !done && online.enabled && online.host && MP.m==='coop' &&
      MP.dead && MP.rl<=0 && MP.ps.every(p=>p.bot || p.dead || p.gone) &&
      MP.ps.some(p=>p.bot && !p.dead && !p.gone);
  }
  function endNoRescue(wave) {
    if (!MP.on || MP.end) return;
    // The host's wave is used for both the Endless reward and displayed result.
    if (MP.en && Number.isSafeInteger(wave) && wave>=1) WV.n=wave;
    const endless=MP.en, reached=WV.n, drop=mpDrop;
    try {
      // mpEnd normally drops the socket and sends leave. Keep it connected until
      // the player explicitly leaves or starts again, so peers receive the result.
      mpDrop=function () {};
      mpEnd('lose');
    } finally { mpDrop=drop; }
    $('mpt').textContent='💥 خسر الفريق: تحطّم جميع اللاعبين البشر المتبقّين ولم تتبقَّ فرص إنقاذ';
    $('mpd').textContent+=(endless?' · وصلتم للموجة '+ar(reached):'')+
      ' · لا يمكن للروبوتات مواصلة اللعب دون لاعب بشري حي.';
  }
  function checkNoRescue() {
    if (!noRescueStalemate()) return false;
    // The server forwards extra fields on ordinary death messages. Reusing one
    // avoids a server change and does not turn an older client's result into a win.
    mpSend({t:'dead',x:MP.cx|0,y:MP.cy|0,botNoRescue:1,w:WV.n});
    endNoRescue(WV.n);
    return true;
  }
  function endHostDisconnected() {
    if (!MP.on || MP.end) return;
    // This is not a win or a loss: do not call mpEnd, which awards coins and
    // can display a false VS result. Previously earned stage rewards remain.
    MP.end=1; online.enabled=false; online.host=false; online.match=null;
    mpRd(); WV.on=0; WV.cd=0; WV.im=0; NOE=0;
    // A story cutscene can be active even when mode is not 'play'. Do not run
    // its callback after MP.on becomes false or leave it covering the result.
    clearInterval(CS.tm); clearTimeout(CS.ct);
    CS.cb=0; CS.me=0; CS.rd={}; CS.pre={};
    hideAll(); $('dmo').classList.remove('on'); $('sov').classList.remove('on');
    $('cm').classList.remove('on'); paused=false;
    MP.on=0; mode='mp'; mpDrop(); $('mpi').style.display='none';
    $('mpt').textContent='📡 انقطع اتصال المضيف — انتهت المباراة';
    $('mpd').textContent='لم يُحتسب فوز أو خسارة، ولم تُمنح مكافأة لإنهاء المباراة.';
    $('mpr').classList.add('on');
  }
  const gameTick=mpTick;
  mpTick = function (dt) {
    if (checkNoRescue()) return;
    if (MP.on && online.enabled && online.host && aliveSocket() && !MP.end &&
        (mode==='play' || (MP.dead && mode==='mp')) && !done) {
      advanceStage(); const died=hitBots(Math.min(.05,Math.max(0,dt)));
      for (const b of online.bots) { if (!MP.on) break; moveAndAct(b,Math.min(.05,Math.max(0,dt))); }
      if (MP.on) {
        online.stateTimer-=dt;
        if (died || online.stateTimer<=0) {online.stateTimer=.1;sendState();}
        if (MP.m==='vs') mpVsCheck();
        else if (MP.dead && MP.ps.every(p=>p.dead||p.gone)) mpEnd('lose');
      }
    }
    gameTick(dt);
    checkNoRescue();
  };

  const originalMessage=mpMsg;
  mpMsg = function (d) {
    if (d.t==='dead' && d.botNoRescue===1 && MP.on && online.enabled &&
        !online.host && MP.m==='coop' && d.f===online.hostSlot) {
      endNoRescue(d.w);
      return;
    }
    if (d.t==='boff') {
      // Only the server emits boff; reject old, malformed, stale or unrelated
      // events, and never invoke game/UI cleanup after the match has ended.
      if (MP.on && !MP.end && online.enabled && !online.host && online.match &&
          d.reason==='host_left' && d.f===online.hostSlot && d.bi===online.match)
        endHostDisconnected();
      return;
    }
    if (d.t==='bs' && MP.on && online.enabled && !online.host && Array.isArray(d.v)) {
      let changed=false;
      for(const q of d.v) {
        const p=player(q[0]); if(!p||!p.bot) continue;
        const dead=!!q[9]; if(dead!==!!p.dead) changed=true;
        let g=p.g; if(!g) g=p.g={x:q[1],y:q[2],r:q[3],dr:[]};
        Object.assign(g,{tx:q[1],ty:q[2],tr:q[3],h:q[5],M:q[6],mv:q[7],sh:0,sg:q[8],dead:dead?1:0});
        p.dead=dead?1:0; p.col=p.botColor||GREY; p.botInventory={m:q[10],g:q[11],e:q[12]};
        if(dead){p.cx=q[1];p.cy=q[2];}else{p.cx=null;p.cy=null;}
      }
      if(changed) {
        if(MP.m==='vs') mpVsCheck();
        else if(MP.dead && MP.ps.every(p=>p.dead||p.gone)) mpEnd('lose');
        else wvCheck();
      }
      return;
    }
    if (d.t==='bu' && MP.on && online.enabled && !online.host) {
      const p=player(d.s); if(p&&p.bot&&Array.isArray(d.c)) p.uc=d.c.map(q=>({x:q[0],y:q[1],t:q[2],c:0,sg:q[3]===1?1:0,sn:q[3]===2?1:0}));
      return;
    }
    if (d.t==='bb' && MP.on && online.enabled && !online.host) {
      const p=player(d.s); if(!p||!p.bot||p.gone||!Array.isArray(d.b))return;
      const friendly=MP.m==='coop'||p.tm===MP.tm;
      for(const q of d.b) B.push({x:q[0],y:q[1],vx:q[2],vy:q[3],dmg:q[4],life:q[5],own:0,r:1,es:1,
        vis:friendly?1:0,bc:friendly?GREY:'#ffa646',sg:q[6]===1?1:0,sn:q[6]===2?1:0,_botTeam:p.tm,_botShot:1});
      return;
    }
    if (d.t==='br' && MP.on && online.enabled) {
      const p=player(d.s); if(p&&p.bot&&!p.dead&&!p.gone) originalMessage({t:'rv',f:d.s,to:d.to});
      return;
    }
    if (d.t==='bf' && MP.on && online.enabled) {
      const p=player(d.s); if(p&&p.bot&&!p.gone&&MP.m==='vs') mpEnd(p.tm===MP.tm?'win':'lose');
      return;
    }
    // Preserve the source team on human projectiles for authoritative bot hits.
    if (d.t==='b' && MP.on && online.host && online.enabled) {
      const n=B.length, p=player(d.f);
      if (MP.m==='vs' && MP.dead && p && Array.isArray(d.b)) {
        // The stock client discards VS bullets while spectating. The host still
        // needs them to simulate its surviving bots; accept only bounded shots.
        const fr=p.tm===MP.tm;
        for (const q of d.b.slice(0,30)) {
          if (!Array.isArray(q) || q.length<6 ||
              !q.slice(0,6).every(Number.isFinite) || Math.abs(q[0])>100000 || Math.abs(q[1])>100000 ||
              Math.abs(q[2])>1600 || Math.abs(q[3])>1600 || q[4]<0 || q[4]>100 || q[5]<=0 || q[5]>4) continue;
          B.push({x:q[0],y:q[1],vx:q[2],vy:q[3],own:0,dmg:q[4],life:q[5],
            bc:fr?(q[6]?'#ff8a3a':p.col):'#ffa646',r:1,vis:fr?1:0,_botTeam:p.tm});
        }
      } else originalMessage(d);
      if(p) for(let i=n;i<B.length;i++) B[i]._botTeam=p.tm;
      return;
    }
    originalMessage(d);
    if (d.t==='dead' || d.t==='pl' || d.t==='rv') checkNoRescue();
  };

  // Draw bots with grayscale sprites, not merely a grey name/ring.
  const drawOnline=mpDraw;
  mpDraw = function () {
    if (!MP.on || !MP.ps.some(isBot)) return drawOnline();
    const saved=MP.ps;
    MP.ps=saved.filter(p=>!p.bot);
    try { drawOnline(); } finally { MP.ps=saved; }
    for (const p of saved) {
      if (!p.bot || p.gone) continue;
      const g=p.g;
      if(p.dead && p.cx!=null) {
        const deadCol=p.botColor||GREY;
        ctx.save();ctx.strokeStyle=deadCol;ctx.setLineDash([10,8]);ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(p.cx,p.cy,RESCUE_R,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        dtxt('🛟 '+p.n,'bold 14px sans-serif',deadCol,p.cx,p.cy);
        if(typeof drawBotLocator==='function')drawBotLocator(p.cx,p.cy,deadCol,p.n+' · إنقاذ');
        ctx.restore();continue;
      }
      if(!g||g.dead) { if(typeof drawBotLocator==='function'&&p.cx!=null)drawBotLocator(p.cx,p.cy,p.botColor||GREY,p.n+' · إنقاذ'); continue; }
      const botCol=p.botColor||GREY;
      const oldP=P,oldShip=CFG.ship,h=gHold(p);
      if(p.uc){h.cells=p.uc;h.spr=null;p.uc=null;}
      let ss;
      try {P=h;CFG.ship=g.sh|0;ss=shipSpr();} finally {P=oldP;CFG.ship=oldShip;}
      ctx.save();ctx.translate(Math.round(g.x),Math.round(g.y));ctx.rotate(g.r);
      ctx.filter='grayscale(1) sepia(1) saturate(7) hue-rotate('+({ '#38d9ff':150, '#ff5964':315, '#ff5c8a':300, '#ffc247':5, '#a77bff':235 }[botCol]||150)+'deg)';ctx.drawImage(ss.m,ss.x0,ss.y0);ctx.restore();
      ctx.save();ctx.strokeStyle=botCol;ctx.globalAlpha=.9;ctx.lineWidth=2;ctx.beginPath();ctx.arc(g.x,g.y,CFG.size*3.2,0,7);ctx.stroke();
      if(g.sg){ctx.strokeStyle='#7dff9acc';ctx.beginPath();ctx.arc(g.x,g.y,CFG.size*5.5,0,7);ctx.stroke();}
      ctx.globalAlpha=1;const by=g.y-CFG.size*5;R('#222',g.x-18,by,36,4);R(botCol,g.x-18,by,36*limit(g.h/(g.M||1),0,1),4);
      dtxt('🤖 '+p.n,'bold 14px sans-serif',botCol,g.x,by-6);if(typeof drawBotLocator==='function')drawBotLocator(g.x,g.y,botCol,p.n);ctx.restore();
    }
  };
  const finish=mpEnd;
  mpEnd=function(result){
    const bots=MP.ps.filter(isBot).map(p=>p.n+(MP.m==='vs'?' (فريق '+(p.tm+1)+(p.gone?'، غادر':p.dead?'، تحطم':'')+')':(p.gone?' (غادر)':p.dead?' (تحطم)':'')));
    const teamVs=MP.m==='vs' && (MP.ts>1 || MP.ps.some(isBot));
    const was=MP.end; finish(result);
    if(!was && bots.length) {
      if(teamVs && (result==='win'||result==='lose')) $('mpt').textContent=result==='win'?'🏆 فاز فريقك!':'💥 خسر فريقك';
      $('mpd').textContent += ' · الروبوتات: ' + bots.join('، ');
    }
  };
})();
