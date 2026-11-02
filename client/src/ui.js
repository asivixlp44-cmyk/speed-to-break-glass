// The HUD (Shards and the menu on the left, the Progress bar and your quest at the top, the pane's health under them,
// the FREE gift, Auto Run, x2 and PLAY on the right, your Speed and Level bar at the bottom, a race's place and clock) and
// every panel: the wheel, rebirth, auras, trails, worlds, the shop (Gems for Shards, x2 Speed, x2 Shards, codes), quests,
// the daily reward, gifts, leaderboards, a race's results, settings. Prices are Shards or Gems only.
import { $ } from './engine.js';
import { S, net, actions } from './state.js';
import { sfx, setMusicDuck, getVolumes, setVolume, playAsmr } from './audio.js';
import { setQuality, getQuality } from './fx.js';
import {
    CFG, WORLDS, TRAILS, AURAS, RARITIES, TREADS, SHOES, SPIN, rebirthCost, rebMult, perStep, xpNeed, RANKS, rankOf, TASKS, QUESTS, DAILY, dailyStatus, dayLeft, GIFTS, PACKS, packShards,
    rewardText, clock, fmtComma, fmt, worldOpen, PLACES, rushInfo,
} from '../../shared/config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const rar = (r) => `<span class="rar" style="color:${RARITIES[r].color}">${RARITIES[r].name}</span>`;
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const DC = '<i class="dc"></i>', SC = '<i class="sc"></i>';
// a drawn icon (icons.js) for a panel's title
const IC = (k) => '<i class="ic ic-' + k + ' pic"></i>';
const price = (shards, gems) => (gems ? '💎 ' + gems : DC + ' ' + fmtComma(shards));
const sessionSecs = () => (S.sessionSecs || 0) + (Date.now() - S.profileAt) / 1000;

// =====================================================================================
// Small things: toasts, big words, pop-ups, level ups, Shards
// =====================================================================================
export function toast(text, color) {
    const box = $('#toasts'), el = document.createElement('div');
    el.className = 'toast o1'; el.textContent = text; el.style.color = color || '#fff';
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 3300);
}
export function bigText(text, color) {
    const el = $('#bigText');
    el.textContent = text; el.style.color = color || '#ffe24a';
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(bigText.t); bigText.t = setTimeout(() => { el.hidden = true; }, 2400);
}
// sub may hold the drawn icons (html)
export function popup(icon, title, sub, color, html) {
    const el = $('#popup');
    $('#popIc').textContent = icon; $('#popT').textContent = title; $('#popT').style.color = color || '#ffe24a';
    if (html) $('#popS').innerHTML = sub || ''; else $('#popS').textContent = sub || '';
    el.hidden = false;
    if (el.getAnimations) for (const a of el.getAnimations()) a.cancel();
    el.classList.add('go');
    clearTimeout(popup.t); popup.t = setTimeout(() => { el.hidden = true; el.classList.remove('go'); }, 3000);
}
export function levelUp(lv0, lv1) {
    const el = $('#lvlUp');
    $('#lu1').textContent = `Level Up! (${lv0} → ${lv1})`;
    $('#lu2').textContent = lv1 % 5 === 0 ? '+5 Gems · Glass Rush gets longer' : 'Glass Rush gets tougher, and pays more';
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(levelUp.t); levelUp.t = setTimeout(() => { el.hidden = true; }, 2600);
    bump('#lvBar');
}
export function shardPop(n) {
    const el = $('#winPop');
    $('#winPopV').textContent = '+' + fmt(n) + (n === 1 ? ' SHARD' : ' SHARDS');
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(shardPop.t); shardPop.t = setTimeout(() => { el.hidden = true; }, 2200);
}
export function notEnough(m) {
    sfx('denied');
    const gems = m.cur === 'gems';
    askConfirm(gems ? '💎' : '🔷', 'Not enough ' + (gems ? 'Gems' : 'Shards'), `You need ${fmtComma(m.need)} more ${gems ? 'Gems' : 'Shards'} for ${esc(m.name)}.` + (gems ? '<br><small>Gems come from quests, daily tasks, the chest, gifts, the wheel, Glass Rush and the daily reward.</small>' : '<br><small>Smash panes and step on the Shard Pads: the further the stage, the more Shards.</small>'),
        gems ? 'Quests' : 'OK', () => { if (gems) openPanel('quests'); });
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff7a8a'); if (m.ok) sfx('reward'); else sfx('denied'); }

// =====================================================================================
// The HUD (written only when a value changes; the bars move with transforms)
// =====================================================================================
const shown = { s: 0, d: 0, g: 0 }, shownTxt = { s: '', d: '', g: '' };
export function animateCounters(dt) {
    // Speed and Gems count up quickly; Shards roll up over a second or so, as they fly in
    const kf = Math.min(1, dt * 12), ks = Math.min(1, dt * 2.6);
    for (const [key, v, sel, f] of [['s', S.speed, '#speedVal', fmt], ['d', S.shards, '#shardVal', fmt], ['g', S.gems, '#gemVal', fmtComma]]) {
        const target = v || 0;
        shown[key] += (target - shown[key]) * (key === 'd' && target > shown[key] ? ks : kf);
        if (Math.abs(target - shown[key]) < 0.5) shown[key] = target;
        const txt = f(Math.round(shown[key]));
        if (txt !== shownTxt[key]) { shownTxt[key] = txt; $(sel).textContent = txt; }
    }
    // the level bar
    const f = Math.min(1, (S.xp || 0) / (S.need || xpNeed(S.lv)));
    if (Math.abs(f - lvFillShown) > 0.002) { lvFillShown = f; $('#lvFill').style.transform = 'scaleX(' + f.toFixed(3) + ')'; put('#lvNum', fmt(Math.floor(S.xp || 0)) + '/' + fmt(S.need || xpNeed(S.lv))); }
}
let lvFillShown = -1;
// a springy pop (an animation of its own: no class toggling, so no layout read)
const POP = [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(1)' }];
export function bump(sel) { const el = $(sel); if (el && el.animate) el.animate(POP, { duration: 420, easing: 'cubic-bezier(0.34, 1.6, 0.5, 1)' }); }
// every counted step: the Speed counter ticks
const TICK = [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.4 }, { transform: 'scale(1)' }];
export function stepTick() { const el = $('#speedTxt'); if (el.animate) el.animate(TICK, { duration: 180, easing: 'ease-out' }); }
// Shards: little slivers burst out of the middle of the screen and stream into the counter, each one a chime
let shardAt = null, flying = 0;
export function flyShards(n) {
    if (!shardAt || flying > 24) return;
    const box = $('#flyLayer'), k = Math.min(10, Math.max(3, Math.round(Math.sqrt(n) * 2.5)));
    const fx = innerWidth / 2, fy = innerHeight * 0.42;
    for (let i = 0; i < k; i++) {
        const el = document.createElement('i');
        el.className = 'dc';
        box.appendChild(el);
        flying++;
        const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 80, sx = fx + Math.cos(a) * r, sy = fy + Math.sin(a) * r * 0.7;
        const at = (x, y, sc) => 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px) translate(-50%,-50%) scale(' + sc + ')';
        const anim = el.animate([
            { transform: at(fx, fy, 0.2), opacity: 0 },
            { transform: at(sx, sy, 1.3), opacity: 1, offset: 0.3 },
            { transform: at(shardAt.x, shardAt.y, 0.75), opacity: 1 },
        ], { duration: 820 + i * 60, delay: i * 50, easing: 'cubic-bezier(0.45, 0, 0.65, 1)', fill: 'both' });
        anim.onfinish = () => { el.remove(); flying--; bump('#shardBox'); playAsmr('tick', 0.14, 1.5 + i * 0.06); };
    }
}
const put = (sel, v, html) => { const el = $(sel); if (html) { if (el.innerHTML !== v) el.innerHTML = v; } else if (el.textContent !== v) el.textContent = v; };
export function updateHud() {
    put('#lvTxt', 'Level ' + S.lv);
    put('#lvNum', fmt(Math.floor(S.xp || 0)) + '/' + fmt(S.need || xpNeed(S.lv)));
    // the quest
    const Q = QUESTS[S.qi];
    if (Q) {
        const p = Math.min(Q.n, S.qv || 0);
        put('#questLine', Q.text + (Q.n > 1 ? ' ' + fmt(p) + '/' + fmt(Q.n) : ''));
        $('#questLine').hidden = false;
    } else $('#questLine').hidden = true;
    // FOR FREE: the next playtime gift
    const secs = sessionSecs(), gi = GIFTS.findIndex((g, i) => !S.gifts[i]);
    const gb = $('#bGift');
    if (gi < 0) gb.hidden = true;
    else {
        gb.hidden = false;
        const left = GIFTS[gi].min * 60 - secs;
        gb.classList.toggle('ready', left <= 0);
        put('#giftTxt', left <= 0 ? 'CLAIM!' : clock(left));
    }
    // x2 Speed, x2 Shards
    put('#x2Txt', S.x2 ? clock(((S.x2Until || 0) - net.now()) / 1000) : '💎 ' + CFG.x2SpeedGems);
    $('#bX2').classList.toggle('on', !!S.x2);
    put('#x2sTxt', S.x2s ? clock(((S.x2sUntil || 0) - net.now()) / 1000) : '💎 ' + CFG.x2ShardsGems);
    $('#bX2s').classList.toggle('on', !!S.x2s);
    // what each step gives
    put('#perStep', '+' + fmt(perStep(S, 1, S.x2)) + ' a step');
    put('#mReb', 'x' + rebMult(S.rebirths) + (S.x2 ? ' x2' : ''));
    // badges: something to do
    const ds = dailyStatus(S.daily, net.now());
    setBadge('#bDaily', ds.can ? '!' : '');
    const list = (S.jq && S.jq.list) || [];
    setBadge('#bQuests', list.some((q) => !q.c && TASKS[q.k] && q.p >= TASKS[q.k].n) ? '!' : '');
    setBadge('#bSpin', S.spins > 0 ? String(S.spins) : '');
    setBadge('#bRebirth', S.shards >= rebirthCost(S.rebirths) ? '!' : '');
    const nx = WORLDS.findIndex((w, i) => i > 0 && worldOpen(S, i) && !(S.seen && S.seen['w' + i]));
    setBadge('#bWorlds', nx > 0 ? 'NEW' : '');
    if (panelKind === 'quests' || panelKind === 'gifts' || (panelKind === 'spin' && !spinning)) renderPanel();
}
function setBadge(sel, text) {
    const el = $(sel);
    let b = el.querySelector('.badge');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'badge'; el.appendChild(b); }
    if (b.textContent !== text) b.textContent = text;
}
// the Progress bar: a head for everyone in your world, by the pane they're up to (10 times a second; the
// bar's width is read on a resize, never in the frame loop)
let barW = 300;
const markEls = new Map();
export function measureHud() {
    const r = $('#progMarks').getBoundingClientRect(); if (r.width > 0) barW = r.width;
    const w = $('#shardBox .dc').getBoundingClientRect(); if (w.width > 0) shardAt = { x: w.left + w.width / 2, y: w.top + w.height / 2 };
}
const MARK_COLORS = ['#ff5a8a', '#3ab4ff', '#46ec50', '#ffa82a', '#b45aff', '#2ae8d8', '#ff7a3a', '#e8e85a'];
export function progressMarks(list) {
    const box = $('#progMarks');
    for (const m of list) {
        let el = markEls.get(m.id);
        if (!el) {
            el = document.createElement('i');
            el.className = m.me ? 'me' : '';
            el.textContent = (m.name || '?').charAt(0).toUpperCase();
            if (!m.me) el.style.background = MARK_COLORS[(m.pid || 0) % MARK_COLORS.length];
            box.appendChild(el);
            markEls.set(m.id, el);
            el._f = -1;
        }
        el._seen = true;
        if (Math.abs(el._f - m.f) > 0.001) { el._f = m.f; el.style.transform = 'translateX(' + (m.f * barW).toFixed(1) + 'px)'; }
    }
    for (const [id, el] of markEls) { if (!el._seen) { el.remove(); markEls.delete(id); } else el._seen = false; }
}
// ----- the pane you're at: its name and health, big, under the quest -----
let paneShown = false, paneTxt = '', paneName = '', paneF = -1;
export function paneBar(name, hp, max, pushing) {
    const el = $('#hpBox');
    if (!name) { if (paneShown) { paneShown = false; el.hidden = true; } return; }
    if (!paneShown) { paneShown = true; el.hidden = false; }
    if (name !== paneName) { paneName = name; $('#hpName').textContent = name; }
    const f = Math.max(0, Math.min(1, hp / max));
    if (Math.abs(f - paneF) > 0.004) { paneF = f; $('#hpFill').style.transform = 'scaleX(' + f.toFixed(3) + ')'; }
    const txt = fmt(Math.ceil(Math.max(0, hp))) + ' / ' + fmt(max);
    if (txt !== paneTxt) { paneTxt = txt; $('#hpTxt').textContent = txt; }
    el.classList.toggle('hit', !!pushing);
}
// ----- the queue: on the PLAY button -----
let qAt = 0, qFound = 0, qTimer = 0, qSpots = CFG.rushSpots;
export function queueState(m) {
    const b = $('#bPlay');
    clearInterval(qTimer);
    if (!m) { b.classList.remove('queue'); put('#playTxt', 'PLAY'); put('#playSub', 'Glass Rush'); $('#queueBox').hidden = true; return; }
    qAt = m.at; qFound = m.found; qSpots = m.spots;
    b.classList.add('queue');
    put('#playTxt', 'CANCEL');
    $('#queueBox').hidden = false;
    put('#qLine1', 'Looking for players…');
    put('#qSub', 'Glass Rush · Level ' + m.lv + ' · ' + m.rows + ' rows · ' + WORLDS[m.map].name);
    const tick = () => {
        const left = Math.max(0, Math.ceil((qAt - net.now()) / 1000));
        put('#qFound', qFound + '/' + qSpots + ' found');
        put('#qLeft', left + 's');
        put('#playSub', qFound + '/' + qSpots + ' · ' + left + 's');
    };
    tick();
    qTimer = setInterval(tick, 250);
}
// ----- a race: your place and the clock -----
export function rushHud(o) {
    const el = $('#rushBox');
    if (o.on === false) { el.hidden = true; return; }
    if (o.on) el.hidden = false;
    if (o.place !== undefined) { put('#rushPlace', o.place); }
    if (o.left !== undefined && o.left > 0) put('#rushLeft', clock(o.left));
}
export function showCount(t) {
    const el = $('#count');
    if (!t) { el.hidden = true; return; }
    el.textContent = t;
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}

// =====================================================================================
// Panels
// =====================================================================================
let panelKind = null, panelTab = null, spinning = false, wheelAngle = 0, lastRace = null;
export function openPanel(kind, tab) {
    panelKind = kind; panelTab = tab || null;
    $('#modal').hidden = false;
    renderPanel();
    sfx('open');
    setMusicDuck(true);
    if (actions.onPanel) actions.onPanel(true);
    if (kind === 'worlds') { const nx = WORLDS.findIndex((w, i) => i > 0 && worldOpen(S, i) && !(S.seen && S.seen['w' + i])); if (nx > 0) { S.seen = { ...S.seen, ['w' + nx]: 1 }; net.send('tut', { seen: 'w' + nx }); } }
}
export function closePanel() {
    if ($('#modal').hidden) return false;
    $('#modal').hidden = true; panelKind = null; renderedKind = null;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    setMusicDuck(false);
    if (actions.onPanel) actions.onPanel(false);
    sfx('close');
    return true;
}
export const panelIs = (k) => !$('#modal').hidden && panelKind === k;
export function refreshPanels() { if (!$('#modal').hidden && panelKind !== 'race' && !(panelKind === 'spin' && spinning)) renderPanel(); }
// a race's results
export function rushResults(m) {
    lastRace = m;
    openPanel('race');
    if (m.place === 0) sfx('win'); else if (m.place <= 2) sfx('reward');
}
function frame(title, icon, body, opts) {
    opts = opts || {};
    return `<div class="panel ${opts.cls || ''}"${opts.w ? ` style="width:min(${opts.w}rem,94vw)"` : ''}>
        <header><h2 class="o">${icon} ${title}</h2><div class="hx">${opts.hx || ''}<button class="btn g-red o x" data-close>✕</button></div></header>
        ${opts.tabs ? `<div class="tabs">${opts.tabs.map(([k, l]) => `<button class="tab o1${k === opts.tab ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>` : '<div></div>'}
        <div class="body">${body}</div>${opts.foot ? `<div class="foot">${opts.foot}</div>` : '<div></div>'}</div>`;
}
let renderedKind = null;
function renderPanel() {
    const m = $('#modal');
    const again = renderedKind === panelKind && !m.hidden && m.firstElementChild;
    m.innerHTML = PANELS[panelKind] ? PANELS[panelKind]() : '';
    renderedKind = panelKind;
    // a refresh of the open panel (a timer, a new value): no pop-in again
    if (again && m.firstElementChild) m.firstElementChild.classList.add('still');
    const x = m.querySelector('[data-close]');
    if (x) x.onclick = () => closePanel();
    m.onclick = (e) => { if (e.target === m) closePanel(); };
    for (const b of m.querySelectorAll('[data-tab]')) b.onclick = () => { panelTab = b.dataset.tab; sfx('click'); renderPanel(); };
    for (const b of m.querySelectorAll('[data-act]')) b.onclick = (e) => { e.stopPropagation(); doAct(b.dataset.act, b.dataset); };
    const code = m.querySelector('#codeIn');
    if (code) code.onkeydown = (e) => { if (e.key === 'Enter') doAct('code', {}); };
    for (const r of m.querySelectorAll('input[type=range]')) r.oninput = () => setVolume(r.dataset.vol, r.value / 100);
}
const swatch = (c1, rainbow) => `<span class="sw" style="background:${rainbow ? 'linear-gradient(135deg,#ff3a5a,#ffa82a,#ffe02a,#4aff6a,#3ad8ff,#8a5aff)' : `radial-gradient(circle at 35% 30%, #ffffff, ${hex(c1)} 55%)`}"></span>`;
// a wheel prize's label
const spinLabel = (s) => (s.speed ? SC + ' Speed' : s.shards ? DC + ' Shards' : s.gems ? '💎 ' + s.gems : s.x2 ? 'x2 ' + s.x2 + 'm' : '');
function styleGrid(kind) {
    const list = kind === 'trails' ? TRAILS : AURAS, cur = kind === 'trails' ? S.trail : S.aura, owned = kind === 'trails' ? S.trails : S.auras;
    return '<div class="grid">' + list.map((x) => {
        const own = owned.includes(x.id), on = cur === x.id;
        const btn = own ? (on ? '<button class="btn g-grey o" disabled>Equipped ✓</button>' : `<button class="btn g-green o" data-act="${kind === 'trails' ? 'trail' : 'aura'}" data-id="${x.id}">Equip</button>`)
            : `<button class="btn ${x.gems ? 'g-gem' : 'g-yellow'} o1" data-act="${kind === 'trails' ? 'buytrail' : 'buyaura'}" data-id="${x.id}">${price(x.shards, x.gems)}</button>`;
        return `<div class="card${on ? ' on' : ''}"><div class="ci">${x.id === 'none' ? '🚫' : swatch(x.c1, x.rainbow)}</div><b class="o1">${esc(x.name)}</b><small>${rar(x.rarity)}</small>${btn}</div>`;
    }).join('') + '</div>';
}
const PANELS = {
    spin() {
        const n = SPIN.length, seg = 360 / n;
        const grad = SPIN.map((s, i) => `${s.color} ${(i * seg).toFixed(2)}deg ${((i + 1) * seg).toFixed(2)}deg`).join(',');
        const labels = SPIN.map((s, i) => `<span class="wl" style="transform:rotate(${((i + 0.5) * seg).toFixed(2)}deg)"><b class="o1">${spinLabel(s)}</b></span>`).join('');
        const left = Math.max(0, (S.spinIn || 0) - (Date.now() - S.profileAt) / 1000);
        const body = `<div class="wheelWrap"><div class="wptr"></div><div class="wheel" id="wheel" style="background:conic-gradient(${grad});transform:rotate(${wheelAngle}deg)">${labels}</div><div class="whub o">SPIN</div></div>
            <div style="text-align:center;margin-top:.8rem"><button class="btn ${S.spins > 0 ? 'g-green' : 'g-grey'} o" data-act="spin" ${S.spins > 0 && !spinning ? '' : 'disabled'} style="min-width:12rem;height:3.2rem;font-size:1.5rem">${S.spins > 0 ? 'Spin! (' + S.spins + ')' : 'No spins left'}</button>
            <p class="o1" style="margin:.5rem 0 0;font-weight:700">${S.spins >= CFG.spinMax ? 'Spins full: use one!' : 'Next free spin in ' + clock(left)}</p></div>`;
        return frame('Lucky Wheel', IC('spin'), body, { w: 30, foot: 'A free spin every ' + CFG.spinMins + ' minutes of play (up to ' + CFG.spinMax + ' saved). Prizes grow as you get further.' });
    },
    rebirth() {
        const r = S.rebirths || 0, cost = rebirthCost(r), can = S.shards >= cost;
        const tr = TREADS.find((t) => t.reb === r + 1);
        const body = `<div class="rebBox"><div class="rebRow"><span>Rebirths</span><b>${r}</b><i>→</i><b class="g">${r + 1}</b></div>
            <div class="rebRow"><span>Speed a step</span><b>x${rebMult(r)}</b><i>→</i><b class="g">x${rebMult(r + 1)}</b></div>
            <div class="rebRow"><span>Your Speed</span><b>${fmt(S.speed)}</b><i>→</i><b class="r">0</b></div>
            ${tr ? `<div class="rebNew o1">🔓 Unlocks the x${tr.mult} treadmill!</div>` : ''}
            <p class="rebWarn">Your Speed goes back to 0 and you start the Run again. You keep your sneakers, Level, Shards left over, trails, auras and Gems.</p>
            <button class="btn ${can ? 'g-blue' : 'g-grey'} o" data-act="rebirth" style="min-width:14rem;height:3.4rem;font-size:1.5rem">Rebirth · ${DC} ${fmtComma(cost)}</button>
            ${can ? '' : `<small class="o1" style="font-weight:700">You have ${fmtComma(S.shards)} Shards</small>`}</div>`;
        return frame('Rebirth', IC('rebirth'), body, { w: 32 });
    },
    trails() { return frame('Trails', IC('trail'), styleGrid('trails'), { foot: 'A trail streams behind you as you run.' }); },
    auras() { return frame('Auras', IC('aura'), styleGrid('auras'), { foot: 'An aura glows round you.' }); },
    worlds() {
        const body = '<div class="grid wgrid">' + WORLDS.map((w, i) => {
            const open = worldOpen(S, i), here = S.world === i, best = (S.best && S.best[i]) || 0;
            const btn = here ? '<button class="btn g-blue o" data-act="world" data-w="' + i + '">Back to spawn</button>' : open ? `<button class="btn g-green o" data-act="world" data-w="${i}">Teleport</button>` : `<button class="btn g-grey o" disabled>🔒 Locked</button>`;
            return `<div class="card wcard${here ? ' on' : ''}" style="--wc:${hex(w.trim)}"><div class="ci">${w.icon}</div><b class="o1">${esc(w.name)}</b><small class="o1">${open ? 'Stages cleared: ' + best + '/6' : 'Clear ' + esc(WORLDS[i - 1].name) + ' first'}</small>${btn}</div>`;
        }).join('') + '</div>';
        return frame('Worlds', IC('world'), body, { w: 42, foot: 'Tougher glass, far more Shards. Clear a world\'s last stage to open the next.' });
    },
    shop() {
        const tab = panelTab || 'gems';
        let body = '';
        if (tab === 'gems') {
            const packs = PACKS.map((p, i) => `<div class="card"><div class="ci">${['🔷', '🔷🔷', '💠'][i]}</div><b class="o1">${fmt(packShards(p, S))} ${DC}</b><button class="btn g-gem o" data-act="pack" data-id="${p.id}">💎 ${p.gems}</button></div>`).join('');
            body = `<div class="grid">${packs}<div class="card"><div class="ci"><i class="ic ic-bolt" style="width:3rem;height:3rem"></i></div><b class="o1">x2 Speed · ${CFG.x2Mins} min</b><small>${S.x2 ? 'Active: ' + clock(((S.x2Until || 0) - net.now()) / 1000) + ' left' : 'Double every step'}</small><button class="btn g-gem o" data-act="x2">💎 ${CFG.x2SpeedGems}</button></div>
                <div class="card"><div class="ci"><i class="ic ic-shard" style="width:3rem;height:3rem"></i></div><b class="o1">x2 Shards · ${CFG.x2Mins} min</b><small>${S.x2s ? 'Active: ' + clock(((S.x2sUntil || 0) - net.now()) / 1000) + ' left' : 'Double every pad'}</small><button class="btn g-gem o" data-act="x2s">💎 ${CFG.x2ShardsGems}</button></div></div>
                <p style="margin:.8rem 0 0;font-weight:600;opacity:.85">💎 Gems come from quests, daily tasks, the FREE chest, gifts, the wheel, Glass Rush and the daily reward. Everything here is bought with Shards or Gems.</p>`;
        } else if (tab === 'shoes') {
            body = '<div class="grid">' + SHOES.map((k, i) => {
                const own = i < S.shoes, next = i === S.shoes;
                return `<div class="card${own ? ' on' : ''}"><div class="ci">${swatch(k.color)}</div><b class="o1">${esc(k.name)}</b><small>+${fmt(k.add)} Speed a step</small><small class="o1" style="font-weight:700;color:${own ? '#7dff6b' : next ? '#ffe24a' : '#c8d0dc'}">${own ? 'Owned ✓' : k.shards ? DC + ' ' + fmtComma(k.shards) : 'FREE'}</small></div>`;
            }).join('') + '</div><p style="margin:.8rem 0 0;font-weight:600;opacity:.85">Buy them on the pads east of the spawn: step on the next pair.</p>';
        } else {
            body = `<h3 style="margin:.2rem 0 .5rem">🎟️ Codes</h3><div style="display:flex;gap:.5rem"><input class="code" id="codeIn" maxlength="20" placeholder="Enter a code"><button class="btn g-green o" data-act="code" style="min-width:6rem">Redeem</button></div>
                <p style="margin:.8rem 0 0;font-weight:600;opacity:.85">Codes give free Speed, Shards, Gems and spins. Try GLASS!</p>`;
        }
        return frame('Shop', IC('shop'), body, { tabs: [['gems', '💎 Gems'], ['shoes', '👟 Sneakers'], ['codes', '🎟️ Codes']], tab });
    },
    quests() {
        const Q = QUESTS[S.qi];
        let body = '';
        if (Q) {
            const p = Math.min(Q.n, S.qv || 0);
            body += `<div class="row feat"><div class="ri"><span class="ci" style="font-size:2.4rem">🎯</span></div><div class="rt"><small style="color:#7af4ff;font-weight:700">QUEST ${S.qi + 1} / ${QUESTS.length}</small><b class="o1">${esc(Q.text)}</b><div class="prog"><i style="width:${(p / Q.n * 100).toFixed(0)}%"></i></div><em>${fmt(p)} / ${fmt(Q.n)} · Reward: ${rewardText(Q)}</em></div></div>`;
        } else body += '<div class="row"><div class="rt"><b>🏆 Every quest done! No pane is safe from you.</b></div></div>';
        body += `<h3 style="margin:.9rem 0 .4rem">🔥 Daily Tasks <small style="opacity:.75;font-size:.85rem">Resets in ${clock(dayLeft(net.now()))}</small></h3>`;
        body += ((S.jq && S.jq.list) || []).map((q, i) => {
            const K = TASKS[q.k], done = q.p >= K.n;
            return `<div class="row"><div class="ri"><span class="ci" style="font-size:2.2rem">${K.icon}</span></div><div class="rt"><b class="o1">${esc(K.text)}</b><div class="prog"><i style="width:${Math.min(100, q.p / K.n * 100).toFixed(0)}%"></i></div><em>${fmt(q.p)} / ${fmt(K.n)} · ${rewardText(K)}</em></div><div class="rb"><button class="btn ${done && !q.c ? 'g-green' : 'g-grey'} o" data-act="tclaim" data-i="${i}" ${done && !q.c ? '' : 'disabled'}>${q.c ? 'Done ✓' : 'Claim'}</button></div></div>`;
        }).join('');
        return frame('Quests', IC('quest'), body);
    },
    daily() {
        const st = dailyStatus(S.daily, net.now());
        const ic = (r) => (r.gems && !r.shards ? '💎' : r.shards ? DC : r.spins ? '<i class="spinIc"></i>' : r.x2 ? '✨' : SC);
        const days = DAILY.map((r, i) => `<div class="day${i === 6 ? ' big' : ''}${i < st.day ? ' got' : ''}${i === st.day && st.can ? ' now' : ''}"><span class="o1">DAY ${i + 1}</span><span class="di">${i < st.day ? '✅' : ic(r)}</span><span class="o1">${rewardText(r)}</span></div>`).join('');
        const body = `<div class="days">${days}</div><div style="text-align:center;margin-top:1rem"><button class="btn ${st.can ? 'g-green' : 'g-grey'} o" data-act="daily" ${st.can ? '' : 'disabled'} style="min-width:12rem;height:3rem;font-size:1.4rem">${st.can ? 'Claim Day ' + (st.day + 1) : 'Next reward in ' + clock(dayLeft(net.now()))}</button></div>`;
        return frame('Daily Rewards', IC('gift'), body, { w: 44, foot: 'Come back every day: the rewards grow for 7 days in a row.' });
    },
    gifts() {
        const secs = sessionSecs();
        const body = GIFTS.map((g, i) => {
            const left = g.min * 60 - secs, got = S.gifts[i];
            return `<div class="row"><div class="ri"><span class="ci" style="font-size:2.4rem">${got ? '✅' : '🎁'}</span></div><div class="rt"><b class="o1">${rewardText(g)}</b><small>After ${g.min} minutes of play</small></div><div class="rb"><button class="btn ${!got && left <= 0 ? 'g-green' : 'g-grey'} o" data-act="gift" data-i="${i}" ${!got && left <= 0 ? '' : 'disabled'}>${got ? 'Claimed' : left <= 0 ? 'Claim!' : clock(left)}</button></div></div>`;
        }).join('');
        return frame('FREE Gifts', IC('gift'), body, { w: 34, foot: 'Gifts unlock the longer you play this session.' });
    },
    boards() {
        const b = actions.boards ? actions.boards() : { shards: [], speed: [], rush: [] };
        const col = (title, rows) => `<div><h3 style="margin:.2rem 0 .5rem">${title}</h3>${(rows || []).map((r, i) => `<div class="row" style="padding:.35rem .6rem;margin-bottom:.3rem"><b style="width:2rem">${['🥇', '🥈', '🥉'][i] || i + 1}</b><div class="rt"><b style="font-size:1rem">${esc(r.n)}</b></div><b>${fmt(r.v)}</b></div>`).join('') || '<p>Be the first!</p>'}</div>`;
        const rk = RANKS[rankOf(S.totalShards)];
        const body = `<p class="o1" style="margin:0 0 .6rem;font-weight:700">Your rank: ${rk.icon} ${rk.name} · ${fmtComma(S.totalShards)} Shards collected</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem">${col('🔷 Most Shards', b.shards)}${col('⚡ Top Speed', b.speed)}${col('🏆 Rush Wins', b.rush)}</div>`;
        return frame('Leaderboards', '🏆', body);
    },
    // a race's results: everyone's place, what you won
    race() {
        const m = lastRace || { rows: [], prize: {}, place: 0, smashed: 0, lv: S.lv }, pl = PLACES[m.place] || '';
        const list = m.rows.map((r) => `<div class="row rr${r.n === S.name ? ' feat' : ''}"><b class="rp">${['🥇', '🥈', '🥉'][r.place] || PLACES[r.place]}</b><div class="rt"><b style="font-size:1.05rem">${esc(r.n)}</b></div><small>${r.smashed} panes</small></div>`).join('');
        const D = rushInfo(S.lv);
        const body = `<div class="raceTop"><b class="o" style="color:${m.place === 0 ? '#ffd028' : '#7af4ff'}">${pl} place!</b><span class="o1">${m.smashed} panes smashed · Level ${m.lv} race</span>
            <div class="prizes o1">+${fmtComma(m.prize.shards || 0)} ${DC}${m.prize.gems ? ' &nbsp; +' + m.prize.gems + ' 💎' : ''} &nbsp; +${m.prize.xp || 0} XP</div></div>${list}
            <div class="raceBtns"><button class="btn g-green o" data-act="again">Play Again</button><button class="btn g-grey o" data-close2>Back to the Run</button></div>`;
        return frame('Glass Rush', IC('rush'), body, { w: 34, foot: 'Your next race: ' + D.rows + ' rows at Level ' + S.lv + '. Higher Levels race longer and tougher, for more Shards.' });
    },
    settings() {
        const v = getVolumes(), q = getQuality();
        const body = `<div class="vol"><span>Graphics</span><div class="qbtns">${['low', 'medium', 'high'].map((k) => `<button class="btn g-blue o${q === k ? ' on' : ''}" data-act="quality" data-q="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
            <div class="vol"><span>Music</span><input type="range" min="0" max="100" value="${Math.round(v.music * 100)}" data-vol="music"></div>
            <div class="vol"><span>Glass sounds</span><input type="range" min="0" max="100" value="${Math.round((v.asmr ?? 0.9) * 100)}" data-vol="asmr"></div>
            <div class="vol"><span>Effects</span><input type="range" min="0" max="100" value="${Math.round(v.sfx * 100)}" data-vol="sfx"></div>
            <div class="vol"><span>Show FPS</span><div class="qbtns"><button class="btn g-grey o" data-act="fps">${actions.fpsOn && actions.fpsOn() ? 'On' : 'Off'}</button></div></div>
            <div class="vol"><span>Stuck?</span><div class="qbtns"><button class="btn g-blue o" data-act="home">Back to spawn</button></div></div>
            <p style="margin:1rem 0 0;font-weight:600;opacity:.8">${isTouch ? 'Use the stick to run, or tap AUTO RUN. Drag to look around.' : 'WASD run · SPACE jump · E use · T Auto Run · P Glass Rush · R back to spawn · drag to look'}</p>`;
        return frame('Settings', IC('gear'), body, { w: 36 });
    },
};

// =====================================================================================
// What the buttons do
// =====================================================================================
function doAct(act, d) {
    sfx('click');
    switch (act) {
        case 'spin':
            if (S.spins > 0 && !spinning) {
                spinning = true; net.send('spin', {}); renderSpinButton();
                // no answer (no spin left after all): the button comes back
                clearTimeout(spinWait); spinWait = setTimeout(() => { if (spinning) { spinning = false; refreshPanels(); } }, 4000);
            }
            break;
        case 'rebirth': {
            const cost = rebirthCost(S.rebirths);
            if (S.shards < cost) { notEnough({ cur: 'shards', need: cost - S.shards, name: 'a rebirth' }); break; }
            askConfirm('🔄', 'Rebirth?', 'Your Speed goes back to 0. Every step gives x' + rebMult(S.rebirths + 1) + ' from now on.', 'Rebirth!', () => { closePanel(); net.send('rebirth', {}); });
            break;
        }
        case 'world': closePanel(); if (actions.world) actions.world(+d.w); break;
        case 'buytrail': net.send('buytrail', { id: d.id }); break;
        case 'trail': net.send('trail', { id: d.id }); sfx('equip'); break;
        case 'buyaura': net.send('buyaura', { id: d.id }); break;
        case 'aura': net.send('aura', { id: d.id }); sfx('equip'); break;
        case 'pack': net.send('pack', { id: d.id }); break;
        case 'x2': net.send('x2', {}); break;
        case 'x2s': net.send('x2', { kind: 'shards' }); break;
        case 'code': { const v = ($('#codeIn') || {}).value || ''; if (v.trim()) net.send('code', { code: v.trim() }); break; }
        case 'tclaim': net.send('tclaim', { i: +d.i }); break;
        case 'daily': net.send('daily', {}); break;
        case 'gift': net.send('gift', { i: +d.i }); break;
        case 'quality': setQuality(d.q); renderPanel(); break;
        case 'fps': if (actions.toggleFps) actions.toggleFps(); renderPanel(); break;
        case 'home': closePanel(); if (actions.respawn) actions.respawn(); break;
        case 'again': closePanel(); if (actions.play) actions.play(); break;
    }
}
function renderSpinButton() { const b = $('#modal').querySelector('[data-act="spin"]'); if (b) b.disabled = true; }
// the wheel's answer: turn to the prize, then show it
let spinWait = 0;
export function onSpun(m) {
    clearTimeout(spinWait);
    const seg = 360 / SPIN.length, target = -((m.i + 0.5) * seg) + (Math.random() - 0.5) * seg * 0.6;
    const base = wheelAngle + 360 * 5;
    wheelAngle = base + ((((target - base) % 360) + 360) % 360);
    const el = $('#wheel');
    spinning = true;
    if (el) { el.style.transition = 'transform 3.4s cubic-bezier(0.15, 0.85, 0.25, 1)'; el.style.transform = 'rotate(' + wheelAngle.toFixed(1) + 'deg)'; }
    let ticks = 0;
    const tick = () => { if (ticks++ < 22) { sfx('click'); setTimeout(tick, 40 + ticks * ticks * 0.35); } };
    tick();
    setTimeout(() => {
        spinning = false;
        sfx('reward');
        popup('🎡', 'YOU WON!', m.text, '#ffe24a', true);
        if (panelKind === 'spin') renderPanel();
    }, el ? 3500 : 50);
}
// a yes / no question (yes may hold html: the drawn icons)
export function askConfirm(icon, title, text, yes, act) {
    const c = $('#confirm');
    c.innerHTML = `<div class="panel"><header><h2 class="o">${title}</h2><div class="hx"><button class="btn g-red o x" data-no>✕</button></div></header><div></div><div class="cbody"><span class="bi">${icon}</span><p>${text}</p><div class="btns"><button class="btn g-green o" data-yes>${yes}</button><button class="btn g-grey o" data-no>Cancel</button></div></div><div></div></div>`;
    c.hidden = false;
    for (const b of c.querySelectorAll('[data-no]')) b.onclick = () => { c.hidden = true; sfx('close'); };
    c.querySelector('[data-yes]').onclick = () => { c.hidden = true; act(); };
    c.onclick = (e) => { if (e.target === c) c.hidden = true; };
}
export function closeTop() {
    if (!$('#confirm').hidden) { $('#confirm').hidden = true; return true; }
    if (closePanel()) return true;
    return false;
}
// the panels with their real content, for the loading warm-up; returns the clean-up
export function warmPanels() {
    const m = $('#modal');
    panelKind = 'spin';
    lastRace = { rows: [{ n: 'Sample', place: 0, smashed: 3 }], prize: { shards: 5, gems: 1, xp: 3 }, place: 0, smashed: 3, lv: 1 };
    m.innerHTML = PANELS.spin() + PANELS.rebirth() + PANELS.daily() + PANELS.quests() + PANELS.shop() + PANELS.trails() + PANELS.worlds() + PANELS.race();
    m.hidden = false; m.classList.add('warmui');
    $('#confirm').innerHTML = '<div class="panel"><header><h2 class="o">Buy?</h2></header><div></div><div class="cbody"><span class="bi">🔷</span><p>Sample</p><div class="btns"><button class="btn g-green o">Yes</button></div></div><div></div></div>';
    $('#confirm').hidden = false; $('#confirm').classList.add('warmui');
    popup('⭐', 'UNLOCKED!', 'Sample', '#ffe24a'); $('#popup').classList.add('warmui');
    levelUp(1, 2); $('#lvlUp').classList.add('warmui');
    shardPop(12); $('#winPop').classList.add('warmui');
    showCount('3'); $('#count').classList.add('warmui');
    $('#hpBox').hidden = false; $('#hpBox').classList.add('warmui');
    $('#queueBox').hidden = false; $('#rushBox').hidden = false; $('#rushBox').classList.add('warmui'); $('#queueBox').classList.add('warmui');
    toast('Sample', '#ffffff');
    return () => {
        for (const s of ['#modal', '#confirm', '#popup', '#lvlUp', '#winPop', '#count', '#hpBox', '#queueBox', '#rushBox']) { $(s).classList.remove('warmui'); $(s).hidden = true; }
        m.innerHTML = ''; $('#confirm').innerHTML = ''; panelKind = null; $('#toasts').innerHTML = '';
    };
}
export const anyPopup = () => !$('#confirm').hidden || !$('#modal').hidden;
document.addEventListener('click', (e) => { if (e.target && e.target.matches && e.target.matches('[data-close2]')) closePanel(); });
