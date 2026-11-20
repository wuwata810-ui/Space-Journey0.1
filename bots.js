/* Local bots for Space Journey. Load as a classic script after index.html's scripts.
 * The original simulation is advanced exactly once per frame. No networking is used.
 */
(function () {
  'use strict';
  if (window.SpaceBotsLocal) return;

  const LIMIT = 4, LOCAL_RESCUE_MAX = 5, LOCAL_RESCUE_SEC = 3, LOCAL_RESCUE_R = 80;
  const names = ['روبوت ١', 'روبوت ٢', 'روبوت ٣', 'روبوت ٤'];
  const BOT_COLORS = ['#38d9ff', '#ff5c8a', '#ffc247', '#a77bff'];
  function botColor(b) { return state.kind === 'vs' ? (b.team === 0 ? '#38d9ff' : '#ff5964') : BOT_COLORS[b.id % BOT_COLORS.length]; }
  const initialCount = (() => {
    try {
      const v = localStorage.getItem('spacebots_local_count');
      return v === null ? 3 : Math.floor(Math.max(0, Math.min(LIMIT, Number(v) || 0)));
    } catch (_) { return 3; }
  })();
  const initialTeamSize = (() => {
    try { return clampSize(Number(localStorage.getItem('spacebots_local_team_size')) || 2); }
    catch (_) { return 2; }
  })();
  function clampSize(n) { return Math.max(1, Math.min(4, Math.floor(n))); }
  const state = {
    count: initialCount, teamSize: initialTeamSize, kind: 'solo', pending: false, active: false,
    bots: [], shots: [], snapshot: null, playerAlive: true, playerDown: null,
    rescueLeft: LOCAL_RESCUE_MAX, playerSafe: 0, hudClock: 0, ended: false
  };
  const $id = id => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const living = b => b && b.alive && b.hp > 0;
  // Campaign, stages, Endless and local coop all use the same friendly roster.
  // An empty roster deliberately retains the original single-player behavior.
  const teamCoop = () => state.active && state.kind !== 'vs' && state.bots.length > 0;
  let spectatorPlayer = null;

  // First intersection of a segment with a circle; null means no collision.
  function intersection(x1, y1, x2, y2, x, y, r) {
    const dx = x2 - x1, dy = y2 - y1, fx = x1 - x, fy = y1 - y;
    const a = dx * dx + dy * dy, c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    if (!a) return null;
    const bb = 2 * (fx * dx + fy * dy), discriminant = bb * bb - 4 * a * c;
    if (discriminant < 0) return null;
    const t = (-bb - Math.sqrt(discriminant)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }

  function copyPlayer() {
    return Object.assign({}, P, {
      inv: Object.assign({}, P.inv), cells: P.cells.map(c => Object.assign({}, c)), spr: null
    });
  }
  function capture() {
    return { player: copyPlayer(), q: Object.assign({}, Q), qi, score, pts, combo, comboT,
      rf: pw.rf, shield: pw.sh };
  }
  function restore() {
    if (!state.snapshot) return;
    const s = state.snapshot;
    P = s.player; Q = s.q; qi = s.qi; score = s.score; pts = s.pts;
    combo = s.combo; comboT = s.comboT; pw.rf = s.rf; pw.sh = s.shield;
    state.snapshot = null;
    if (typeof hud === 'function') hud();
  }
  function hideResults() {
    const e = $id('local-bot-result');
    if (e) e.classList.remove('on');
  }
  function clearRound() {
    state.pending = false; state.active = false; state.ended = false;
    state.bots = []; state.shots = []; state.playerAlive = true; state.playerDown = null;
    state.rescueLeft = LOCAL_RESCUE_MAX; state.hudClock = 0;
    const h = $id('local-bot-hud');
    if (h) h.style.display = 'none';
    hideResults();
  }
  function leaveLocal(restorePlayer) {
    const wasVs = state.kind === 'vs';
    clearRound();
    if (restorePlayer) restore(); else state.snapshot = null;
    if (wasVs && !MP.on) NOE = 0;
    state.kind = 'solo';
  }

  // The human starts on team 0; bots alternate onto the smaller team.
  // Mode size describes seats, not a limit on the separately selected bots.
  function roster() {
    const teams = [['أنت'], []];
    for (let i = 0; i < state.count; i++) {
      const team = teams[0].length <= teams[1].length ? 0 : 1;
      teams[team].push(names[i]);
    }
    return teams;
  }
  function updateRoster() {
    const teams = roster();
    const box = $id('local-bot-roster');
    if (box) box.textContent = teams.map((members, t) => {
      const empty = Math.max(0, state.teamSize - members.length);
      const extra = Math.max(0, members.length - state.teamSize);
      return (t ? 'الفريق الآخر' : 'فريقك') + ': ' + members.join('، ') +
        ' · ' + members.length + '/' + state.teamSize +
        (empty ? ' · مقاعد فارغة: ' + empty : '') +
        (extra ? ' · تجاوز المقاعد: ' + extra : '');
    }).join('\n');
  }
  function setTeamSize(value) {
    const n = Number(value);
    state.teamSize = Number.isFinite(n) ? clampSize(n) : 2;
    try { localStorage.setItem('spacebots_local_team_size', String(state.teamSize)); } catch (_) {}
    const select = $id('local-bot-team-size');
    if (select) select.value = String(state.teamSize);
    updateRoster();
  }
  function setCount(value) {
    const n = Number(value);
    state.count = Number.isFinite(n) ? clamp(Math.floor(n), 0, LIMIT) : 3;
    try { localStorage.setItem('spacebots_local_count', String(state.count)); } catch (_) {}
    document.querySelectorAll('[data-local-bot-count]').forEach(e => { e.value = String(state.count); });
    const note = $id('local-bot-count-note');
    if (note) note.textContent = state.count ? 'لاعب واحد + ' + state.count + ' روبوتات' : 'لاعب واحد بلا روبوتات';
    const vs = $id('local-bot-vs');
    if (vs) vs.disabled = state.count === 0;
    const hint = $id('local-bot-vs-hint');
    if (hint) hint.textContent = state.count === 0 ? 'التنافسي يحتاج روبوتًا واحدًا على الأقل.' :
      'أول فريق يصل للعلم أو يهزم الفريق الآخر يفوز. العدد المختار لا يملأ المقاعد تلقائيًا.';
    updateRoster();
  }
  function countControl() {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;direction:rtl;font:700 15px system-ui;color:#e6ecff';
    const text = document.createElement('span'); text.textContent = 'عدد الروبوتات المحلية';
    const select = document.createElement('select');
    select.setAttribute('data-local-bot-count', '');
    select.setAttribute('aria-label', 'عدد الروبوتات المحلية');
    select.style.cssText = 'font:700 16px system-ui;padding:6px 12px;border-radius:6px;border:2px solid #65708d;background:#121740;color:white';
    for (let i = 0; i <= LIMIT; i++) {
      const option = document.createElement('option'); option.value = String(i); option.textContent = String(i);
      select.appendChild(option);
    }
    select.addEventListener('change', () => setCount(select.value));
    label.append(text, select); return label;
  }
  function makeUI() {
    const menuRow = $id('menu') && $id('menu').querySelector('.row2');
    if (menuRow) {
      const button = document.createElement('button');
      button.className = 'px sm'; button.type = 'button';
      button.textContent = '🤖 لعب محلي'; button.setAttribute('aria-label', 'اللعب المحلي مع أو ضد الروبوتات');
      button.addEventListener('click', () => { hideAll(); $id('local-bot-menu').classList.add('on'); mode = 'menu'; setCount(state.count); });
      menuRow.appendChild(button);
    }
    const difficulty = $id('dfo');
    if (difficulty) difficulty.insertBefore(countControl(), $id('dfl'));
    // The original game asks for an online name on first launch. Local play
    // should not require a name, a socket, or a fabricated online identity.
    const namePanel = $id('nmo') && $id('nmo').querySelector('.pnl');
    if (namePanel) {
      const offline = document.createElement('button');
      offline.className = 'mb'; offline.type = 'button';
      offline.style.cssText = 'display:block;margin:8px auto 0';
      offline.textContent = 'العب محليًا دون اسم';
      offline.addEventListener('click', () => showMenu());
      namePanel.appendChild(offline);
    }
    const panel = document.createElement('div');
    panel.id = 'local-bot-menu'; panel.className = 'ov spc';
    panel.style.cssText = 'direction:rtl;padding:12px;box-sizing:border-box;overflow:auto;z-index:8';
    panel.innerHTML = '<div style="width:min(440px,94vw);padding:18px;box-sizing:border-box;background:#121740;border:2px solid #65708d;border-radius:12px;text-align:center;color:#e6ecff">' +
      '<h2 style="margin:0 0 10px">🤖 اللعب المحلي بلا إنترنت</h2>' +
      '<p style="font-size:14px">لاعب حقيقي واحد، مع روبوتات ملوّنة مستقلة.</p>' +
      '<div id="local-bot-count-holder"></div><p id="local-bot-count-note" style="font-size:13px"></p>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<button id="local-bot-coop" class="mb go">🤝 تعاوني · ٥ موجات</button>' +
      '<button id="local-bot-endless" class="mb">♾️ تعاوني بلا نهاية</button>' +
      '<label for="local-bot-team-size" style="font-size:14px">طور التنافسي: ' +
      '<select id="local-bot-team-size" aria-label="طور التنافسي" style="font:700 15px system-ui;padding:5px;border-radius:6px;background:#121740;color:white">' +
      '<option value="1">1v1</option><option value="2">2v2</option><option value="3">3v3</option><option value="4">4v4</option></select></label>' +
      '<div id="local-bot-roster" style="white-space:pre-line;font-size:13px;line-height:1.6"></div>' +
      '<button id="local-bot-vs" class="mb">⚔️ تنافسي · فريق ضد فريق</button>' +
      '<small id="local-bot-vs-hint" style="min-height:2em"></small>' +
      '<button id="local-bot-back" class="mb">🏠 رجوع</button></div></div>';
    document.body.appendChild(panel);
    $id('local-bot-count-holder').appendChild(countControl());
    $id('local-bot-team-size').addEventListener('change', e => setTeamSize(e.target.value));
    setTeamSize(state.teamSize);
    $id('local-bot-coop').addEventListener('click', () => launch('coop'));
    $id('local-bot-endless').addEventListener('click', () => launch('endless'));
    $id('local-bot-vs').addEventListener('click', () => { if (state.count) launch('vs'); });
    $id('local-bot-back').addEventListener('click', () => { panel.classList.remove('on'); showMenu(); });
    const result = document.createElement('div'); result.id = 'local-bot-result'; result.className = 'ov spc';
    result.style.cssText = 'direction:rtl;z-index:8;padding:12px;box-sizing:border-box';
    result.innerHTML = '<div style="width:min(420px,94vw);padding:20px;background:#121740;border:2px solid #65708d;border-radius:12px;text-align:center">' +
      '<h2 id="local-bot-result-title"></h2><div id="local-bot-result-scores" style="white-space:pre-line;line-height:1.9"></div>' +
      '<div style="display:flex;justify-content:center;gap:8px;margin-top:14px"><button id="local-bot-again" class="mb go">🔁 العب مجددًا</button><button id="local-bot-home" class="mb">🏠 القائمة</button></div></div>';
    document.body.appendChild(result);
    $id('local-bot-again').addEventListener('click', () => { if (!MP.on) startLevel(0, 1); });
    $id('local-bot-home').addEventListener('click', () => showMenu());
    const h = document.createElement('div'); h.id = 'local-bot-hud';
    h.style.cssText = 'display:none;position:fixed;top:48px;left:8px;z-index:3;background:#070b1bdd;color:white;border:1px solid #8790a5;border-radius:8px;padding:6px 9px;white-space:pre-line;font:700 12px system-ui;direction:rtl;pointer-events:none';
    document.body.appendChild(h);
    setCount(state.count);
  }

  function launch(kind) {
    if (MP.on || (kind === 'vs' && !state.count)) return;
    // Save the real campaign before the temporary competitive ship is constructed.
    if (state.kind === 'vs') { restore(); NOE = 0; }
    if (kind === 'vs') { try { saveGame(); } catch (_) {} state.snapshot = capture(); }
    state.kind = kind === 'vs' ? 'vs' : 'coop';
    CAMPAIGN_MODE = 'level'; ENDLESS = kind === 'endless' ? 1 : 0;
    $id('local-bot-menu').classList.remove('on'); paused = false;
    startLevel(0, 1);
  }
  function newBot(i, versus) {
    const a = Math.PI * 2 * (i + 1) / (state.count + 1), r = 100;
    const teams = roster(), team = versus && teams[1].includes(names[i]) ? 1 : 0;
    const ti = teams[team].indexOf(names[i]);
    const cells = [];
    MAPS[0].forEach((row, y) => [...row].forEach((ch, x) => {
      const t = { H: 'h', R: 'r', E: 'e', W: 'w' }[ch];
      if (t) cells.push({ x, y, t, c: Math.random() * 0.2 });
    }));
    return { id: i, name: names[i], team,
      x: versus ? (team ? 220 : -220) : P.x + Math.cos(a) * r,
      y: versus ? (ti - (teams[team].length - 1) / 2) * 90 : P.y + Math.sin(a) * r,
      vx: 0, vy: 0, rot: a, aim: a, sp: SH[0].sp, hp: SH[0].hp, max: SH[0].hp,
      rad: 5.2 * CFG.size, alive: true, safe: versus ? 1.5 : 0,
      inv: { m: 50, g: 50, e: 50 }, cells, wi: 0, ai: 0, ei: 0,
      rapid: 0, shield: 0, think: Math.random(), target: null };
  }
  function initRound() {
    if (MP.on || mode !== 'play') return;
    state.pending = false; state.active = true; state.ended = false;
    state.shots = []; state.bots = Array.from({ length: state.count }, (_, i) => newBot(i, state.kind === 'vs'));
    state.playerAlive = true; state.playerDown = null; state.rescueLeft = LOCAL_RESCUE_MAX; state.playerSafe = 1.5;
    if (state.kind === 'vs') {
      NOE = 1; E = []; B = []; D = []; F = []; flag = { x: 0, y: -1600 };
      WV.on = 0; WV.cd = WV.im = WV.wd = 0; goal = 1e9; spawnT = bossT = 1e9;
      bph = 0; P.x = -220; P.y = -(roster()[0].length - 1) / 2 * 90;
      P.vx = P.vy = 0; pw.rf = pw.sh = 0;
      // The default level initializer already gave the player fifty of each resource.
      ban('⚔️ فريقك ضد الفريق الآخر · أول فريق يصل للعلم أو يهزم خصومه');
    }
  }
  function upgrade(b) {
    if (b.hp < b.max * .72 && b.inv.m >= 2) { b.inv.m -= 2; b.hp = Math.min(b.max, b.hp + 40); }
    const ordinary = b.cells.filter(c => c.t === 'w' && !c.sg && !c.sn).length;
    if (b.inv.g >= 20 && ordinary < wCap() && b.wi < wSlots.length) {
      b.inv.g -= 20;
      for (let j = 0; j < 2 && b.cells.filter(c => c.t === 'w' && !c.sg && !c.sn).length < wCap() && b.wi < wSlots.length; j++) {
        const p = wSlots[b.wi++]; b.cells.push({ x: p[0], y: p[1], t: 'w', c: Math.random() * .3 });
      }
    }
    if (b.inv.m >= 20 && b.ai < aSlots.length) {
      b.inv.m -= 20;
      for (let j = 0; j < 2 && b.ai < aSlots.length; j++) {
        const p = aSlots[b.ai++]; b.cells.push({ x: p[0], y: p[1], t: 'a', c: 0 }); b.max += 30; b.hp += 30;
      }
    }
    if (b.inv.e >= 30 && b.sp < 250) {
      b.inv.e -= 30; b.sp += 25;
      for (let j = 0; j < 2 && b.ei < eSlots.length; j++) {
        const p = eSlots[b.ei++]; b.cells.push({ x: p[0], y: p[1], t: 'e', c: 0 });
      }
    }
    if (b.inv.g >= 30 && b.wi < wSlots.length && !b.cells.some(c => c.sn)) {
      b.inv.g -= 30; const p = wSlots[b.wi++]; b.cells.push({ x: p[0], y: p[1], t: 'w', sn: 1, c: 0 });
    }
  }
  function chooseTarget(bot) {
    let target = null, nearest = Infinity;
    const list = state.kind === 'vs' ?
      [...(bot.team !== 0 && state.playerAlive ? [P] : []),
        ...state.bots.filter(b => b.team !== bot.team && living(b))] : E.filter(e => e.hp > 0);
    for (const e of list) {
      const d = dist(bot, e);
      if (d < nearest) { nearest = d; target = e; }
    }
    return target;
  }
  function nearestLoot(bot) {
    let best = null, d0 = 380;
    for (const d of D) {
      const n = dist(bot, d);
      if (!d.got && n < d0) { d0 = n; best = d; }
    }
    return best;
  }
  function shoot(bot, target, dt) {
    const speed = 650, lead = Math.min(.7, dist(bot, target) / speed);
    const tx = target.x + (target.vx || 0) * lead, ty = target.y + (target.vy || 0) * lead;
    bot.aim = Math.atan2(ty - bot.y, tx - bot.x);
    for (const c of bot.cells) if (c.t === 'w') {
      c.c -= dt;
      if (c.c > 0 || dist(bot, target) > (c.sn ? 1000 : 680)) continue;
      const a = bot.aim + (Math.random() - .5) * (c.sn ? .035 : .075);
      const s = c.sn ? 1400 : speed, size = CFG.size;
      const x = bot.x + (c.x - 5) * size * Math.cos(bot.rot) - (c.y - 3) * size * Math.sin(bot.rot);
      const y = bot.y + (c.x - 5) * size * Math.sin(bot.rot) + (c.y - 3) * size * Math.cos(bot.rot);
      state.shots.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: c.sn ? .9 : 1.1, dmg: c.sn ? 40 : 8, owner: bot, sn: !!c.sn });
      c.c = c.sn ? (bot.rapid > 0 ? .9 : 1.8) : (bot.rapid > 0 ? .16 : .38);
    }
  }
  function damageBot(bot, damage) {
    if (!living(bot) || bot.safe > 0 || bot.shield > 0) return;
    bot.hp -= damage;
    if (bot.hp > 0) return;
    bot.hp = 0; bot.alive = false; bot.vx = bot.vy = 0;
    if (typeof boom === 'function') boom(bot.x, bot.y, ['#ddd', '#9aa0ae', '#fff'], 18);
    if (state.kind === 'vs') checkWinner();
  }
  function damagePlayer(damage) {
    if (!state.playerAlive || state.playerSafe > 0 || pw.sh > 0 || state.ended) return;
    P.hp -= damage;
    if (P.hp > 0) return;
    downPlayer();
  }
  function downPlayer() {
    if (!state.playerAlive || state.ended) return;
    P.hp = 0; P.vx = P.vy = 0; state.playerAlive = false;
    state.playerDown = { x: P.x, y: P.y, name: 'أنت' };
    // A dead player watches the surviving ally instead of respawning or ending
    // the entire match. 'over' also hides the player's ship and disables upgrades.
    over = true;
    boom(P.x, P.y, ['#ddd', '#9aa0ae', '#fff'], 18);
    checkWinner();
    if (teamCoop()) hud();
    if (!state.ended) ban('💥 تحطمت مركبتك · شاهد فريقك أو انتظر الإنقاذ');
  }
  // A bot cannot finish a cooperative game without a living human. End rather
  // than leaving a wave waiting forever if nobody can revive that human.
  function checkCoopDefeat() {
    if (!teamCoop() || state.playerAlive || (state.rescueLeft > 0 && aliveCount(0) > 0)) return false;
    state.ended = true; state.active = false; state.pending = false; over = true;
    P.hp = 0; P.vx = P.vy = 0; shake = 0;
    if (state.playerDown) { P.x = state.playerDown.x; P.y = state.playerDown.y; }
    saveGame();
    const nb = pts > (+localStorage.getItem('best') || 0);
    if (nb) try { localStorage.setItem('best', pts); } catch (_) {}
    $id('sc').textContent = 'دمّرت ' + score + ' مركبة · النقاط ' + pts +
      (nb ? ' 🏆 رقم قياسي جديد!' : ' · أفضل: ' + (localStorage.getItem('best') || 0)) +
      (WV.on && WV.endless ? ' · 🌊 وصلت للموجة ' + ar(WV.n) + ' · أفضل موجة ' + ar(BESTW) : '') +
      (state.rescueLeft ? ' · لم يبقَ زميل حي للإنقاذ' : ' · نفدت فرص الإنقاذ');
    $id('local-bot-hud').style.display = 'none';
    $id('over').classList.add('on');
    hud();
    return true;
  }
  function aliveCount(team) {
    return (team === 0 && state.playerAlive ? 1 : 0) +
      state.bots.filter(b => b.team === team && living(b)).length;
  }
  function checkWinner() {
    if (state.ended || state.kind !== 'vs') return;
    if (!aliveCount(1)) finishMatch(0, 'elimination');
    else if (!aliveCount(0)) finishMatch(1, 'elimination');
  }
  function checkFlag() {
    if (state.ended || state.kind !== 'vs' || !flag) return;
    if (state.playerAlive && dist(P, flag) < P.rad + 28) return finishMatch(0, 'flag');
    for (const b of state.bots) if (living(b) && dist(b, flag) < b.rad + 28) {
      finishMatch(b.team, 'flag'); return;
    }
  }
  function finishMatch(winner, reason) {
    if (state.ended) return;
    state.ended = true; state.active = false; state.pending = false; mode = 'local-result';
    $id('local-bot-result-title').textContent = winner === 0 ? '🏆 فاز فريقك!' : '💥 خسر فريقك';
    $id('local-bot-result-scores').textContent = (reason === 'flag' ? '🚩 الوصول إلى العلم' : '💥 هزيمة الفريق الآخر') +
      '\nفريقك: ' + aliveCount(0) + ' حي · الفريق الآخر: ' + aliveCount(1) + ' حي';
    $id('local-bot-result').classList.add('on');
    $id('local-bot-hud').style.display = 'none';
  }
  // Like the original competitive mode: a living teammate can stand within
  // 80 units for 3 seconds to revive a downed teammate, up to five rescues.
  function downed(team) {
    const list = state.bots.filter(b => b.team === team && !living(b));
    if (team === 0 && !state.playerAlive && state.playerDown) list.push(state.playerDown);
    return list;
  }
  function nearestDown(actor, team) {
    // The cooperative match cannot continue without its only human. Do not
    // spend the last rescue on a nearer bot while that human is also down.
    if (state.kind !== 'vs' && team === 0 && !state.playerAlive && state.playerDown) return state.playerDown;
    let best = null, distance = Infinity;
    for (const d of downed(team)) {
      const n = dist(actor, d);
      if (n < distance) { best = d; distance = n; }
    }
    return best;
  }
  function revive(target) {
    if (!state.rescueLeft) return;
    state.rescueLeft--;
    if (target === state.playerDown) {
      P.x = target.x; P.y = target.y; P.vx = P.vy = 0;
      P.hp = Math.max(1, P.max * .5); pw.sh = 5; over = false;
      state.playerAlive = true; state.playerDown = null; state.playerSafe = 0;
      ban('🛟 أنقذك فريقك!');
    } else {
      target.alive = true; target.hp = Math.max(1, target.max * .5);
      target.vx = target.vy = 0; target.shield = 5;
      ban('🛟 تم إنقاذ ' + target.name + '!');
    }
  }
  function rescueTick(actor, team, dt) {
    const target = state.rescueLeft ? nearestDown(actor, team) : null;
    if (!target || dist(actor, target) >= LOCAL_RESCUE_R) {
      actor._localRescueTarget = null; actor._localRescueTime = 0; return;
    }
    if (actor._localRescueTarget !== target) {
      actor._localRescueTarget = target; actor._localRescueTime = 0;
    }
    actor._localRescueTime += dt;
    if (actor._localRescueTime >= LOCAL_RESCUE_SEC) {
      actor._localRescueTarget = null; actor._localRescueTime = 0; revive(target);
    }
  }
  function updateRescues(dt) {
    if ((state.kind !== 'vs' && !teamCoop()) || state.ended) return;
    if (state.playerAlive) rescueTick(P, 0, dt);
    for (const b of state.bots) if (living(b)) rescueTick(b, b.team, dt);
  }
  function thinkAndMove(dt) {
    for (const b of state.bots) {
      if (!living(b)) continue;
      b.safe = Math.max(0, b.safe - dt); b.shield -= dt; b.rapid -= dt;
      b.think -= dt; if (b.think <= 0) { upgrade(b); b.think = .4 + Math.random() * .2; }
      const target = chooseTarget(b), loot = nearestLoot(b);
      const rescue = (state.kind === 'vs' || teamCoop()) && state.rescueLeft ? nearestDown(b, b.team) : null;
      b.target = target;
      const targetDistance = target ? dist(b, target) : Infinity;
      // Loot takes priority when it is close, otherwise approach or orbit an opponent.
      let x = 0, y = 0;
      if (rescue) {
        const d = dist(b, rescue);
        if (d >= LOCAL_RESCUE_R - 15) { x = rescue.x - b.x; y = rescue.y - b.y; }
      } else if (state.kind === 'vs' && flag && targetDistance > 550) {
        x = flag.x - b.x; y = flag.y - b.y;
      } else if (loot && (targetDistance > 500 || dist(b, loot) < 115)) {
        x = loot.x - b.x; y = loot.y - b.y;
      } else if (target) {
        const dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy) || 1;
        const approach = d > 350 ? 1 : d < 220 ? -.7 : .08;
        const side = (b.id % 2 ? 1 : -1) * .55;
        x = dx / d * approach - dy / d * side; y = dy / d * approach + dx / d * side;
      } else if (state.kind !== 'vs' && dist(b, P) > 180) { x = P.x - b.x; y = P.y - b.y; }
      const n = Math.hypot(x, y) || 1, moving = Math.hypot(x, y) > 1e-3;
      const k = Math.min(1, dt * 3);
      b.vx += ((moving ? x / n * b.sp : 0) - b.vx) * k;
      b.vy += ((moving ? y / n * b.sp : 0) - b.vy) * k;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (Math.hypot(b.vx, b.vy) > 10) {
        let da = Math.atan2(b.vy, b.vx) - b.rot; da = Math.atan2(Math.sin(da), Math.cos(da));
        b.rot += da * Math.min(1, dt * 7);
      }
      if (state.kind === 'vs') { checkFlag(); if (state.ended) return; }
      if (target) shoot(b, target, dt);
      else for (const c of b.cells) if (c.t === 'w') c.c -= dt;
    }
  }
  function advanceShots(dt) {
    for (const s of state.shots) {
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
      let hit = null, first = Infinity;
      const targets = state.kind === 'vs' ?
        [...(s.owner.team !== 0 && state.playerAlive ? [P] : []),
          ...state.bots.filter(b => b.team !== s.owner.team && living(b))] : E.filter(e => e.hp > 0);
      for (const target of targets) {
        if (target === P && state.playerSafe > 0) continue;
        if (target !== P && target.alive && target.safe > 0) continue;
        const radius = target === P ? P.rad : target.alive ? target.rad : (target.n * .6 + 1) * CFG.size * target.sc;
        const t = intersection(s.x, s.y, nx, ny, target.x, target.y, radius);
        if (t !== null && t < first) { first = t; hit = target; }
      }
      s.x = nx; s.y = ny; s.life -= dt;
      if (hit) {
        if (hit === P) damagePlayer(s.dmg, s.owner);
        else if (hit.alive) damageBot(hit, s.dmg, s.owner);
        else { hit.hp -= s.dmg; hit.fl = .08; }
        s.life = 0;
        if (state.ended) break;
      }
    }
    state.shots = state.shots.filter(s => s.life > 0);
  }
  function collectLoot() {
    for (const b of state.bots) if (living(b)) {
      for (const d of D) {
        if (d.got || dist(b, d) >= b.rad + 6) continue;
        d.got = 1;
        if (d.k === 'f') b.rapid = 8;
        else if (d.k === 's') b.shield = 5;
        else if (Object.prototype.hasOwnProperty.call(b.inv, d.k)) b.inv[d.k]++;
      }
    }
    D = D.filter(d => !d.got);
  }
  // Original B projectiles are integrated only by upd(). Intercept their swept paths afterwards.
  function interceptBullets(before) {
    for (const b of B) {
      if (b.life <= 0) continue;
      const old = before.get(b) || { x: b.x - b.vx * before.dt, y: b.y - b.vy * before.dt };
      let hit = null, first = Infinity;
      const eligible = state.kind === 'vs' ? !!b.own : !b.own && !b.vis;
      if (!eligible) continue;
      for (const bot of state.bots) {
        if (!living(bot) || bot.safe > 0 || (state.kind === 'vs' && bot.team === 0) || (b._localHits && b._localHits.has(bot))) continue;
        const t = intersection(old.x, old.y, b.x, b.y, bot.x, bot.y, bot.rad);
        if (t !== null && t < first) { first = t; hit = bot; }
      }
      if (hit) {
        damageBot(hit, b.dmg || 0, state.kind === 'vs' ? P : null);
        if (b.pi && state.kind === 'vs') {
          if (!b._localHits) b._localHits = new Set(); b._localHits.add(hit);
        } else b.life = 0;
        if (state.ended) break;
      }
    }
    B = B.filter(b => b.life > 0);
  }
  function autoPlayer(dt) {
    let target = null, d0 = 700;
    for (const b of state.bots) if (b.team !== 0 && living(b) && dist(P, b) < d0) { target = b; d0 = dist(P, b); }
    if (!target) return;
    const manual = mouse.down || kd('fire') || Object.values(ptr).some(p => p.role === 'aim' && Math.hypot(p.dx, p.dy) > .2);
    if (CFG.auto && !manual) P.aim = Math.atan2(target.y - P.y, target.x - P.x);
    for (const c of P.cells) if (CFG.auto && !manual && c.t === 'w' && c.c <= 0) {
      const x = P.x + (c.x - 5) * CFG.size * Math.cos(P.rot) - (c.y - 3) * CFG.size * Math.sin(P.rot);
      const y = P.y + (c.x - 5) * CFG.size * Math.sin(P.rot) + (c.y - 3) * CFG.size * Math.cos(P.rot);
      if (c.sg) {
        for (let i = -2; i <= 2; i++) { const a = P.aim + i * .14; B.push({ x, y, vx: Math.cos(a) * 600, vy: Math.sin(a) * 600, own: 1, dmg: 4, life: .32, sg: 1 }); }
        c.c = pw.rf > 0 ? .5 : 1.1;
      } else {
        const a = P.aim + (c.sn ? 0 : (Math.random() - .5) * .05), speed = c.sn ? 1400 : 560;
        B.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, own: 1,
          dmg: c.sn ? 40 : 8, life: c.sn ? .9 : 1.1, pi: c.sn ? 1 : 0, h: new Set(), sn: !!c.sn });
        c.c = c.sn ? (pw.rf > 0 ? .9 : 1.8) : (pw.rf > 0 ? .16 : .38);
      }
    }
    // Purchased player drones also participate instead of idling in competitive mode.
    for (const f of F) {
      f.a = Math.atan2(target.y - f.y, target.x - f.x); f._localCd = (f._localCd || 0) - dt;
      if (f._localCd <= 0 && dist(f, target) < 480) {
        B.push({ x: f.x, y: f.y, vx: Math.cos(f.a) * 520, vy: Math.sin(f.a) * 520, own: 1, dmg: 5, life: 1 }); f._localCd = .7;
      }
    }
  }
  function hudLocal(dt) {
    if (state.kind !== 'vs' && !teamCoop()) return;
    state.hudClock -= dt; if (state.hudClock > 0) return; state.hudClock = .2;
    const h = $id('local-bot-hud'); h.style.display = 'block';
    h.textContent = (state.kind === 'vs' ?
      '⚔️ فريقك: ' + aliveCount(0) + ' حي · الخصوم: ' + aliveCount(1) + ' حي\n🚩 الوصول للعلم أو هزيمة الخصوم' :
      '🤝 الفريق: ' + aliveCount(0) + ' حي') + ' · 🛟 ' + state.rescueLeft + '/' + LOCAL_RESCUE_MAX +
      (state.playerAlive ? '' : '\n👁️ تشاهد فريقك');
  }
  function drawBots() {
    if (!state.active || MP.on || mode !== 'play') return;
    ctx.save();
    for (const s of state.shots) {
      ctx.fillStyle = s.sn ? '#e8ecf2' : '#bec5d0'; ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
      ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    const S = CFG.size;
    if (state.kind === 'vs' || teamCoop()) {
      const fallen = state.kind === 'vs' ? [...downed(0), ...downed(1)] : downed(0);
      for (const d of fallen) {
        ctx.save(); ctx.strokeStyle = state.rescueLeft ? '#aeb6c0' : '#666';
        ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.beginPath();
        ctx.arc(d.x, d.y, LOCAL_RESCUE_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = 'bold 14px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        const label = (state.rescueLeft ? '🛟 ' : '✖ ') + d.name;
        ctx.strokeText(label, d.x, d.y); ctx.fillStyle = '#d6dbe0'; ctx.fillText(label, d.x, d.y);
        ctx.restore();
      }
    }
    for (const b of state.bots) if (living(b)) {
      const color = botColor(b);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      for (const c of b.cells) {
        const x = (c.x - 5) * S - S / 2, y = (c.y - 3) * S - S / 2;
        ctx.fillStyle = color; ctx.globalAlpha = c.t === 'e' ? .48 : c.t === 'a' ? .72 : c.t === 'r' ? .84 : 1;
        ctx.fillRect(x, y, S, S); ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y + 1, Math.max(1, S - 3), Math.max(1, S - 3));
      }
      ctx.rotate(b.aim - b.rot); ctx.fillStyle = color; ctx.fillRect(0, -2, S * 3, 4); ctx.restore();
      if (b.shield > 0 || b.safe > 0) {
        ctx.strokeStyle = color; ctx.globalAlpha = .75; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, b.rad, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      const y = b.y - S * 5.7;
      ctx.fillStyle = '#222'; ctx.fillRect(b.x - 24, y, 48, 5);
      ctx.fillStyle = color; ctx.fillRect(b.x - 24, y, 48 * clamp(b.hp / b.max, 0, 1), 5);
      ctx.font = 'bold 14px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const label = state.kind === 'vs' ? (b.team === 0 ? '🤝 ' : '⚔️ ') + b.name : b.name;
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, b.x, y - 4);
      ctx.fillStyle = color; ctx.fillText(label, b.x, y - 4);
      if (typeof drawBotLocator === 'function') drawBotLocator(b.x, b.y, color, b.name);
    }
    if (typeof drawBotLocator === 'function') for (const b of state.bots) if (!living(b))
      drawBotLocator(b.x, b.y, botColor(b), b.name + ' · إنقاذ');
    ctx.restore();
  }

  // Wrappers preserve previously installed game/online wrappers, and never simulate MP.on.
  const previousStartLevel = startLevel;
  startLevel = function (w, l) {
    if (MP.on) {
      if (state.kind === 'vs') restore();
      clearRound(); state.kind = 'solo';
      return previousStartLevel.apply(this, arguments);
    }
    clearRound(); state.pending = true;
    // A competitive round must not inherit campaign upgrades when the user has
    // disabled the normal per-level reset. Restore their setting immediately.
    const reset = CFG.reset;
    if (state.kind === 'vs') CFG.reset = 1;
    let result;
    try { result = previousStartLevel.apply(this, arguments); }
    finally { CFG.reset = reset; }
    if (mode === 'play' && state.pending) initRound();
    return result;
  };
  const previousUpdate = upd;
  function updateCoopLiving(dt) {
    // The stock update tests HP and schedules game over inside the same call.
    // Latch lethal damage for that call so its death branch cannot run first,
    // including when a kill would otherwise heal the player later in the frame.
    const player = P, descriptor = Object.getOwnPropertyDescriptor(player, 'hp');
    let hp = player.hp, fallen = false, result;
    Object.defineProperty(player, 'hp', { configurable: true, enumerable: descriptor.enumerable,
      get() { return fallen ? 1 : hp; },
      set(value) { if (!fallen) { hp = value; if (value <= 0) fallen = true; } } });
    try { result = previousUpdate.call(this, dt); }
    finally { Object.defineProperty(player, 'hp', Object.assign({}, descriptor, { value: fallen ? 0 : hp })); }
    if (fallen && state.active && !MP.on) downPlayer();
    return result;
  }
  function updateCoopSpectator(dt) {
    const ally = state.bots.find(b => living(b));
    if (!ally) return;
    // Give the original enemy/wave simulation a harmless targeting position,
    // not a second living ship. It cannot shoot, pick up loot, take hits, dash,
    // trigger the flag or mutate the saved player's equipment. Quest rewards
    // still belong to the real inventory while the world is advancing.
    const player = P, drones = F, dash = dcd;
    spectatorPlayer = player;
    P = Object.assign({}, player, { x: ally.x, y: ally.y, vx: 0, vy: 0, sp: 0,
      rad: -10, hp: 1, max: Math.max(1, player.max), cells: [], fl: 0,
      inv: player.inv });
    F = []; dcd = Infinity; tDash = 0; over = false;
    try { return previousUpdate.call(this, dt); }
    finally {
      P = player; F = drones; dcd = Math.max(0, dash - dt); spectatorPlayer = null;
      P.x = ally.x; P.y = ally.y; P.vx = P.vy = 0; P.hp = 0; over = true;
      hud();
    }
  }
  upd = function (dt) {
    if (MP.on) {
      if (state.active || state.pending) { if (state.snapshot) restore(); clearRound(); state.kind = 'solo'; }
      return previousUpdate.apply(this, arguments);
    }
    if (state.pending && mode === 'play') initRound();
    const running = state.active && mode === 'play' && (!over || (!state.playerAlive && (state.kind === 'vs' || teamCoop()))) && !done && !paused && !rotNeed;
    if (!running) return previousUpdate.apply(this, arguments);
    dt = Math.max(0, Math.min(.05, Number(dt) || 0));
    if (teamCoop() && state.playerAlive && P.hp <= 0) downPlayer();
    if (checkCoopDefeat()) return;
    if (state.kind === 'vs') {
      state.playerSafe = Math.max(0, state.playerSafe - dt);
      checkFlag(); if (state.ended) return;
    }
    thinkAndMove(dt); if (state.ended) return;
    advanceShots(dt);
    if (state.ended) return;
    const before = new Map(); before.dt = dt;
    for (const b of B) before.set(b, { x: b.x, y: b.y });
    let result;
    if (state.kind === 'vs' && !state.playerAlive) {
      // Continue remaining player bullets and bot simulation while spectating.
      for (const b of B) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
      const ally = state.bots.find(b => b.team === 0 && living(b));
      if (ally) { P.x = ally.x; P.y = ally.y; }
    } else if (teamCoop() && !state.playerAlive) result = updateCoopSpectator(dt);
    else if (teamCoop()) result = updateCoopLiving(dt);
    else result = previousUpdate.call(this, dt);
    if (!state.active || MP.on) return result;
    if (state.kind === 'vs') { checkFlag(); if (state.ended) return result; }
    interceptBullets(before);
    if (state.ended) return result;
    if (checkCoopDefeat()) return result;
    collectLoot();
    if (state.kind === 'vs' || teamCoop()) updateRescues(dt);
    if (checkCoopDefeat()) return result;
    if (state.kind === 'vs' && state.playerAlive) autoPlayer(dt);
    hudLocal(dt);
    return result;
  };
  // The stock update calls winLevel on touching the flag; do not grant campaign
  // progress for a local competitive match. Leave online and other modes intact.
  const previousWinLevel = winLevel;
  winLevel = function () {
    if (!MP.on && state.active && state.kind === 'vs') return finishMatch(0, 'flag');
    if (!MP.on && teamCoop() && !state.playerAlive) return;
    return previousWinLevel.apply(this, arguments);
  };
  // The main loop ticks waves separately and normally stops them on `over`.
  // Advance intermediate waves while spectating, but require the human to be
  // revived before the final wave can award a cooperative victory.
  const previousWvCheck = wvCheck;
  wvCheck = function () {
    if (!MP.on && teamCoop() && !state.playerAlive && WV.wd && !WV.endless && WV.n >= WV.N) return;
    return previousWvCheck.apply(this, arguments);
  };
  const previousSoloWv = soloWv;
  soloWv = function () {
    if (!MP.on && teamCoop() && !state.playerAlive && over && !done && !paused && !rotNeed && mode === 'play') {
      over = false;
      try { return previousSoloWv.apply(this, arguments); }
      finally { over = true; }
    }
    return previousSoloWv.apply(this, arguments);
  };
  const previousMpDraw = mpDraw;
  mpDraw = function () { previousMpDraw.apply(this, arguments); if (!MP.on) drawBots(); };
  const previousMenu = showMenu;
  showMenu = function () { leaveLocal(true); const result = previousMenu.apply(this, arguments); const m = $id('local-bot-menu'); if (m) m.classList.remove('on'); return result; };
  const previousSave = saveGame;
  saveGame = function () {
    if (state.kind === 'vs' && state.snapshot) return;
    if (!spectatorPlayer) return previousSave.apply(this, arguments);
    const ghost = P; P = spectatorPlayer;
    try { return previousSave.apply(this, arguments); }
    finally { P = ghost; }
  };
  // The original listeners captured the unwrapped function before this script
  // loaded. Route them through the current guard, including the online guard.
  removeEventListener('beforeunload', _sg);
  document.removeEventListener('visibilitychange', _sg);
  addEventListener('beforeunload', () => saveGame());
  document.addEventListener('visibilitychange', () => saveGame());
  const previousIgsOk = igsOk;
  igsOk = function () { return state.kind !== 'vs' && previousIgsOk.apply(this, arguments); };
  const previousMpOpen = mpOpen;
  mpOpen = function () { if (!MP.name) return nameOpen(); return previousMpOpen.apply(this, arguments); };

  makeUI();
  // A small read-only surface also supports automated integration tests.
  window.SpaceBotsLocal = Object.freeze({
    get count() { return state.count; },
    get kind() { return state.kind; },
    get teamSize() { return state.teamSize; },
    get playerAlive() { return state.playerAlive; },
    get rescuesLeft() { return state.rescueLeft; },
    get active() { return state.active; },
    get bots() { return state.bots.map(b => ({ name: b.name, team: b.team, x: b.x, y: b.y, hp: b.hp, max: b.max, alive: b.alive, resources: Object.assign({}, b.inv), weapons: b.cells.filter(c => c.t === 'w').length })); },
    get projectileCount() { return state.shots.length; },
    setCount, setTeamSize, launch, intersection
  });
})();
