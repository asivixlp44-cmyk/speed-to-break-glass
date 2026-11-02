import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, updateSky, SUN_DIRECTION, GPU_NAME, setMood, updateEffects, floatText, billboard, prompts,
} from './engine.js';
import { S, actions, net, prof } from './state.js';
import { CU, setEpoch, rel } from './clock.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, setVolume, audioSuspended, setMusicMode, setMusicIntensity, toggleMusic, playAsmr, prerenderMusic, allowLiveMusic } from './audio.js';
import { buildAsmr } from './asmr.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar } from './avatar.js';
import { pad, pollGamepad } from './gamepad.js';
import * as FX from './fx.js';
import { render, updateFx, setQuality, getQuality, autoQualityAllowed, shadowDue, setResScale, getResScale, fxWarmGroup, fxShowAll, updateAmbient, setSpeedLines, confetti, screenConfetti } from './fx.js';
import { buildWorld } from './world.js';
import { buildRush } from './rushview.js';
import { installIcons } from './icons.js';
import * as SH from './shadows.js';
import { Char, pumpAvatars, avatarsPending } from './chars.js';
import { Track, pingSend, onPong, pingEvery, updateDelay } from './smooth.js';
import { initShards, shardBurst, tickGlass, paneFog, shardFog, glassWarmGroup, glassWarmDone } from './glass.js';
import {
    toast, bigText, popup, notEnough, animateCounters, bump, updateHud, openPanel, panelIs, refreshPanels, closeTop, anyPopup, codeResult, warmPanels,
    levelUp, shardPop, progressMarks, measureHud, onSpun, askConfirm, flyShards, stepTick, paneBar, queueState, rushHud, showCount, rushResults,
} from './ui.js';
import { CFG, WORLDS, SHOES, TRAILS, AURAS, TREADS, QUESTS, TASKS, PLACES, dailyStatus, fmt, fmtComma, clamp, moveSpeed, smashRate, perStep, rebirthCost, worldOpen } from '../../shared/config.js';
import { newBody, stepBody } from '../../shared/physics.js';
import { W, onPad, stageAt, portal, rushGate, treads, shoePads, treadAt, shoePadAt, hubChest } from '../../shared/world.js';
import { RUSH, KINDS, rushLayout, paneIn } from '../../shared/rush.js';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => new Promise((r) => setTimeout(r, 0));
const RND = Math.random;
const fmtNum = (v) => (v >= 1000 ? fmt(v) : String(Math.round(v * 10) / 10));

// =====================================================================================
// The world on screen (one at a time: a world switch throws the last one away)
// =====================================================================================
let view = null;
const worldOpts = {
    shoeLabel: (b) => (b.i < S.shoes ? b.name + ' · Owned ✓' : b.i === S.shoes ? 'Buy ' + b.name + ' · ' + (b.shards ? fmtComma(b.shards) + ' Shards' : 'FREE') : '🔒 Buy the pair before them first'),
    shoe: (b) => buyShoe(b),
    worlds: () => openPanel('worlds'),
    play: () => pressPlay(),
};
function buildView(w) {
    if (view && view.w === w) return view;
    if (view) { view.dispose(); view = null; }
    view = buildWorld(w, worldOpts);
    P.world = view.T.world;
    setMood(WORLDS[w].mood, true);
    paneFog(); shardFog();
    view.setProgress(S, net.now());
    view.setBoards(boards);
    resetRun();
    return view;
}
// a world switch: behind the fade, built, drawn once with nothing culled (its shaders and textures on the
// graphics card before you see it)
async function switchWorld(w, x, z) {
    switching = true;
    holdFpsWatch(6);
    closeTop(); closeTop();
    await fadeOut();
    try {
        buildView(w);
        await primeScene(view.group);
    } catch (e) { console.error('[world]', e); noteError('[world] ' + (e && e.message)); }
    for (const r of remotes.values()) r.char.setVisible(false);
    switching = false;
    teleport(x, 0, z, Math.PI);
    fadeIn();
    bigText(WORLDS[w].icon + ' ' + WORLDS[w].name.toUpperCase(), '#ffe24a');
}
async function primeScene(group) {
    const culled = [];
    group.traverse((o) => { if ((o.isMesh || o.isPoints) && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    try { await Promise.race([renderer.compileAsync(scene, camera), sleep(1200)]); } catch (e) { /* compiles when drawn */ }
    render();
    for (const o of culled) o.frustumCulled = true;
}

// =====================================================================================
// You: the shared physics (shared/physics.js) on your screen, every frame
// =====================================================================================
const P = {
    b: newBody(W.spawn.x, 0, W.spawn.z), facing: Math.PI, moving: false, world: null, auto: null, autoRun: false,
    pane: 0, hp: 0, hpMax: 1, pushing: false, pushAt: -9, wasPush: false, ix: 0, iy: 3.6, dmgShown: 0, crackAt: 0,
    tread: null, stepT: 0, combo: 0, comboT: -9, stride: 0, lastStride: 0, trainT: 0, kickT: 0,
    padAt: -9, shoeAt: -9, chestAt: -9, lockToast: -9, portalAt: -9, gateAt: -9, tooToast: -9, frozen: false, onRun: false, snaps: 0, groundY: 0, lastInput: 0,
};
// the race you're in, or null
let R = null;
let me = null, localAvatarReq = 0, dash = null;
function buildMe() {
    if (me) me.dispose();
    if (!dash) { dash = FX.makeTrail(0xffffff); dash.width = 0.42; }
    me = new Char({ name: S.name, lv: S.lv, tr: S.totalShards, noLabel: true });
    setupLocalAvatar();
}
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !me) { a.dispose(); return; }
    me.wear(a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (me && me.blox && av) { me.blox.setProportions(av.proportions); me.blox.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
function teleport(x, y, z, yaw) {
    const b = P.b;
    b.x = x; b.y = y; b.z = z; b.vx = b.vy = b.vz = 0; b.onGround = true; b.pound = false;
    P.tread = null;
    camSnap = true;
    if (yaw !== undefined) { P.facing = yaw; cam.yaw = yaw + Math.PI; }
    sendMove(true);
}
const spawnHome = () => { if (R) return; teleport(W.spawn.x + (RND() - 0.5) * 8, 0, W.spawn.z, Math.PI); };
actions.respawn = spawnHome;

// ----- the Run's panes -----
function resetRun() {
    if (!view) return;
    const Tw = view.T;
    for (let i = 0; i <= Math.min(P.pane, Tw.n - 1); i++) view.panes.damage(i, 0, 0, 3.6);
    P.pane = 0; P.hp = Tw.panes[0].hp; P.hpMax = Tw.panes[0].hp; P.dmgShown = 0; P.pushing = false;
    view.setPane(0);
}
function setPane(i, hp) {
    const Tw = view.T, pn = Tw.panes[i];
    P.pane = i;
    P.hpMax = pn ? pn.hp : 1;
    P.hp = hp !== undefined ? hp : P.hpMax;
    P.dmgShown = 0;
    view.setPane(i);
}
// a pane gone: its glass flies, a bang, the whole screen feels it
function smashPane(pn) {
    const b = P.b, big = pn.hp > 8 * Math.max(4, smashRate(S.speed));
    view.panes.show(pn.i, false);
    shardBurst(-W.half, W.half, 0, W.paneH, pn.z, P.ix, P.iy, -1, pn.tint, getQuality() === 'low' ? 90 : 170, 1);
    playAsmr(big ? 'smashBig' : 'smash', big ? 1 : 0.85, 0.94 + RND() * 0.14);
    playAsmr('tinkle', 0.45, 0.9 + RND() * 0.25, (RND() - 0.5) * 0.6, 0.28);
    shake = Math.max(shake, big ? 0.62 : 0.42); fovKick = big ? 7 : 4.5; lineKick = 1;
    if (me) me.squash(0.35);
    FX.hitFx(b.x, P.iy, pn.z, -1, pn.tint, 1);
    setPane(pn.i + 1);
    paneFlash();
    const st = view.T.stages[pn.k];
    if (pn.i === st.last) {
        sfx('wall', pn.k + 1);
        bigText('STAGE ' + (pn.k + 1) + ' CLEARED!', '#7dff6b');
        if (!S.pads) setTimeout(() => toast('🔷 The Shard Pad is on your right!', '#ffe24a'), 800);
    }
}
function paneFlash() { flashT = 0.09; $('#flash').style.opacity = '0.26'; }
let flashT = 0;

// a counted step: Speed (x the treadmill, x2 when boosted); the server counts them too
function countStep() {
    const t = clockT, tr = P.tread, got = perStep(S, tr ? tr.mult : 1, S.x2);
    S.speed += got; if (S.speed > S.topSpeed) S.topSpeed = S.speed;
    // a rising scale for steps in a row
    P.combo = t - P.comboT < 1.3 ? P.combo + 1 : 0; P.comboT = t;
    const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
    playAsmr('tick', 0.1 + Math.min(0.08, P.combo * 0.006), Math.pow(2, SCALE[P.combo % 15] / 12) * (tr && tr.mult > 1 ? 1.12 : 1));
    if (!window.__noFloat) {
        // "+2" with a bolt, popping up beside you (left or right)
        const side = (RND() < 0.5 ? -1 : 1) * (1.6 + RND() * 2.4), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
        const head = FX.tmpV.set(P.b.x + rx * side, P.b.y + 4.4 + RND() * 2.6, P.b.z + rz * side);
        floatText('+' + fmtNum(got), tr && tr.mult > 1 ? '#7dff6b' : '#7af4ff', head, 4.4 + Math.min(2.4, (tr ? tr.mult : 1) * 0.1), P.combo % 6 === 5, 'bolt');
    }
    stepTick();
    sendMove(true);
    net.send('step', tr ? { tread: 1 } : {});
}
function panOf(x, z) {
    const dx = x - camera.position.x, dz = z - camera.position.z;
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return clamp((dx * rx + dz * rz) / 40, -0.8, 0.8);
}

function updateMe(dt) {
    const t = clockT, b = P.b;
    let f = 0, r = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.6 * dt * camSens;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.7 * dt * camSens, -0.5, 1.3);
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    let mx = fx * f + rx * r, mz = fz * f + rz * r;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    const manual = l > 0.08;
    // you take over from Auto Run the moment you steer (a tap of the button turns it back on)
    if (manual && P.autoRun && !P.auto) setAutoRun(false);
    let hold = !!(keys.Space || touchJump || (pad.held && pad.held.has('A')));
    let pressed = t - P.jumpPress < 0.15;
    // the autopilot (Auto Run, or QA) drives instead
    const driver = P.auto || (P.autoRun ? pilot : null);
    if (driver) { const a = driver(dt); mx = a.mx; mz = a.mz; hold = a.hold; pressed = a.jump; }
    P.frozen = anyPopup() || switching;
    if (P.frozen) { mx = 0; mz = 0; pressed = false; hold = false; }
    P.moving = mx * mx + mz * mz > 0.01;
    // a treadmill you stop on takes over: your feet go, you stay put (any steering and you walk off)
    const tr0 = !R && b.onGround ? treadAt(b.x, b.z) : null;
    if (tr0 && !P.moving) {
        if (S.rebirths >= tr0.reb) { if (P.tread !== tr0) { P.tread = tr0; sfx('equip'); if (tr0.mult > 1) bigText('X' + tr0.mult + ' SPEED!', '#7dff6b'); } }
        else if (t - P.lockToast > 4) { P.lockToast = t; toast('🔒 The x' + tr0.mult + ' treadmill needs ' + tr0.reb + (tr0.reb > 1 ? ' rebirths' : ' rebirth'), '#ff9a8a'); sfx('denied'); }
    } else if (!tr0 || P.moving) P.tread = null;
    const inp = { mx, mz, jump: pressed, hold, power: CFG.jumpPower, speed: (R ? rushRun() : moveSpeed(S.speed)) / CFG.walk };
    if (inp.jump) P.jumpPress = -9;
    const wasAir = !b.onGround, vy0 = b.vy;
    const ev = stepBody(b, inp, dt, P.world);
    if (P.tread) { b.x += (P.tread.x - b.x) * Math.min(1, dt * 8); b.z += (P.tread.z - b.z) * Math.min(1, dt * 4); P.facing = lerpA(P.facing, Math.PI, 1 - Math.exp(-dt * 8)); P.trainT += dt; }
    if (ev === 1 || ev === 2) { me.stretch(0.6); playAsmr('boing', 0.26, 0.95 + RND() * 0.1); fovKick = Math.max(fovKick, 2); }
    else if (ev === 3 || ev === 4) { const k = clamp(-vy0 / 60, 0.3, 1.2); me.squash(k); playAsmr('land', 0.25 + k * 0.3, 0.9 + RND() * 0.2); }
    if (wasAir && !b.onGround) P.groundY = b.y;
    if (R) updateRushMe(dt); else updateRun(dt);
    if (P.moving) P.facing = lerpA(P.facing, Math.atan2(mx, mz), 1 - Math.exp(-dt * 14));
    // footsteps, a puff of dust at speed
    const runningAnim = (P.moving && b.onGround) || !!P.tread;
    if (runningAnim) {
        P.stride += dt * (P.tread ? 3.6 : Math.max(2.4, Math.hypot(b.vx, b.vz) / 7.5));
        if (Math.floor(P.stride) !== P.lastStride) {
            P.lastStride = Math.floor(P.stride);
            playAsmr('step', P.tread ? 0.16 : 0.2, 0.92 + RND() * 0.18);
            if (getQuality() !== 'low' || P.lastStride % 2) {
                const shoe = SHOES[S.shoes - 1], col = shoe ? shoe.color : 0xffffff;
                if (P.tread) { FX.treadFx(b.x, b.y, b.z + 1.2, P.tread.color); FX.treadFx(b.x, b.y + 1.5, b.z, P.tread.color); if (P.lastStride % 6 === 0) FX.ring(FX.tmpV.set(b.x, b.y, b.z), P.tread.color, 6, 0.5); } else if (Math.hypot(b.vx, b.vz) > 26) FX.kickFx(b.x, b.y, b.z, b.vx, b.vz, col);
            }
        }
    }
    // Speed, step by step: running, pushing glass, or on a treadmill
    if (!R && !P.frozen && (P.tread || (P.moving && b.onGround) || P.pushing)) {
        const gap = P.tread ? CFG.treadGap : CFG.stepGap;
        P.stepT += dt;
        if (P.stepT >= gap) { P.stepT -= gap; countStep(); }
    } else P.stepT = Math.min(P.stepT, 0.1);
    touchSpots(t);
    if (b.y < -40) spawnHome();
    const sp = (P.tread || P.pushing) ? Math.max(30, moveSpeed(S.speed)) : Math.hypot(b.vx, b.vz);
    me.update(dt, t, { x: b.x, y: b.y, z: b.z, ry: P.facing, snapRy: true, air: !b.onGround, moving: runningAnim || P.pushing, speed: sp, vy: b.vy, jump: ev === 1, airJump: ev === 2, sprint: sp > 30, ground: b.y });
    if (dash) dash.update(FX.tmpV.set(b.x, b.y + 0.4, b.z), runningAnim && !P.tread && b.onGround && sp > 24, dt, t);
    if (view && !R) view.setTread(P.tread ? P.tread.i : -1);
    sendMove(false);
}
const lerpA = (a, b2, k) => { let d = (b2 - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
// the Run: the glass ahead stops you; pushing it takes its health at your Speed; left alone it heals
function updateRun(dt) {
    const b = P.b, Tw = view.T, pn = Tw.panes[P.pane], t = clockT;
    P.pushing = false;
    if (b.z > W.front + 2 && P.pane > 0) resetRun();
    if (!pn) return;
    const stop = pn.z + 1.5;
    if (b.z < stop) { b.z = stop; if (b.vz < 0) b.vz = 0; }
    if (b.z <= pn.z + W.touch + 0.3) {
        // the first touch: a thud, a crack from where you hit
        if (!P.wasPush) {
            P.wasPush = true;
            P.ix = b.x; P.iy = 3.6 + RND() * 1.6;
            view.panes.damage(pn.i, Math.max(0.02, 1 - P.hp / P.hpMax), P.ix, P.iy);
            playAsmr('hit', 0.75, 0.92 + RND() * 0.16);
            FX.hitFx(b.x, P.iy, pn.z, 1, pn.tint, 0.3);
            shake = Math.max(shake, 0.2);
            if (me) me.squash(0.2);
        }
        P.pushing = true; P.pushAt = t;
        P.hp -= smashRate(S.speed) * dt;
        if (P.hp <= 0) { P.wasPush = false; smashPane(pn); return; }
        const d = 1 - P.hp / P.hpMax;
        if (d - P.dmgShown > 0.015) {
            view.panes.damage(pn.i, d);
            if (d - P.crackAt > 0.14) { P.crackAt = d; playAsmr('crack', 0.4 + d * 0.45, 0.9 + RND() * 0.3 + d * 0.15); shake = Math.max(shake, 0.1 + d * 0.16); FX.hitFx(b.x + (RND() - 0.5) * 8, P.iy + (RND() - 0.5) * 6, pn.z, 1, pn.tint, 0.1); }
            P.dmgShown = d;
        }
        // far too tough for now: say so (once in a while), and what to do
        if (P.hp / smashRate(S.speed) > 22 && t - P.tooToast > 14) { P.tooToast = t; toast('💪 This one\'s tough: train on a treadmill or buy sneakers!', '#ffe24a'); }
    } else {
        P.wasPush = false;
        if (P.hp < P.hpMax && t - P.pushAt > CFG.regenAfter) {
            P.hp = Math.min(P.hpMax, P.hp + P.hpMax * CFG.regenRate * dt);
            const d = 1 - P.hp / P.hpMax;
            if (Math.abs(d - P.dmgShown) > 0.015 || d === 0) { view.panes.damage(pn.i, d); P.dmgShown = d; P.crackAt = Math.min(P.crackAt, d); }
        }
    }
}
// what you're standing on: a Shard Pad, a sneaker pad, the chest, the portal, the Rush gate
function touchSpots(t) {
    const b = P.b;
    if (!view || switching || R) return;
    const Tw = view.T, k = stageAt(Tw, b.z);
    P.onRun = k >= 0;
    if (b.y > 2) return;
    if (k >= 0 && P.pane > Tw.stages[k].last && onPad(Tw, k, b.x, b.z) && t - P.padAt > 1.2) { P.padAt = t; sendMove(true); net.send('pad', { k }); }
    if (k >= 0) return;
    // the next sneakers: stepping on the pad buys them (when you have the Shards)
    const sp = shoePadAt(b.x, b.z);
    if (sp && sp.i === S.shoes && t - P.shoeAt > 3 && S.shards >= sp.shards) { P.shoeAt = t; buyShoe(sp); }
    const ready = ((S.chests && S.chests.hub) || 0) <= net.now();
    if ((b.x - hubChest.x) ** 2 + (b.z - hubChest.z) ** 2 < 42 && t - P.chestAt > 4) {
        P.chestAt = t;
        if (ready) { sendMove(true); net.send('chest', {}); }
        else toast('🎁 The chest refills in ' + Math.ceil((S.chests.hub - net.now()) / 60000) + ' min', '#ffe24a');
    }
    if (Math.abs(b.x - portal.x) < 7 && Math.abs(b.z - (portal.z + 3)) < 2.4 && t - P.portalAt > 3 && !anyPopup()) { P.portalAt = t; sfx('whoosh'); openPanel('worlds'); }
    if (Math.abs(b.x - rushGate.x) < 7 && Math.abs(b.z - (rushGate.z + 3)) < 2.4 && t - P.gateAt > 3 && !anyPopup() && !S.queued) { P.gateAt = t; sfx('whoosh'); pressPlay(); }
}
function buyShoe(bp) {
    if (bp.i < S.shoes) { toast('✓ You own these', '#7dff6b'); return; }
    if (bp.i > S.shoes) { toast('🔒 Buy the pair before them first', '#ff9a8a'); return; }
    sendMove(true);
    net.send('shoe', {});
}
function setAutoRun(on) {
    P.autoRun = !!on;
    P.trainT = 0;
    $('#bAuto').classList.toggle('on', P.autoRun);
    if (!P.autoRun) rushAim = 0;
}
actions.autoRun = () => { setAutoRun(!P.autoRun); if (P.autoRun) toast('🏃 Auto Run: on. Steer to take over', '#7af4ff'); };

// =====================================================================================
// Glass Rush: the queue, the start line, your race
// =====================================================================================
function pressPlay() {
    if (R) return;
    if (S.queued) { net.send('unplay', {}); return; }
    sfx('queue');
    net.send('play', {});
}
actions.play = pressPlay;
const RWORLD = { solids: [], floor: 0, clamp(b) { if (b.x < -RUSH.half + 1) { b.x = -RUSH.half + 1; if (b.vx < 0) b.vx = 0; } else if (b.x > RUSH.half - 1) { b.x = RUSH.half - 1; if (b.vx > 0) b.vx = 0; } if (b.z > RUSH.startZ + 30) { b.z = RUSH.startZ + 30; if (b.vz > 0) b.vz = 0; } } };
const rushRun = () => (R ? Math.min(CFG.rushRunMax, CFG.rushRun * (1 + R.boost * 0.5)) : CFG.walk);
async function enterRush(m) {
    switching = true;
    holdFpsWatch(6);
    closeTop(); closeTop();
    S.queued = false; queueState(null);
    setAutoRunIfPhone();
    await fadeOut();
    if (R) leaveRushView();
    const layout = rushLayout(m.seed, m.lv, m.base, m.n);
    R = { id: m.id, seed: m.seed, lv: m.lv, w: m.w, base: m.base, n: m.n, spot: m.spot, power: m.power, goAt: m.goAt, phase: 'ready', layout, row: 0, boost: 0, boltI: 0, smashed: 0, place: -1, limit: 0, endsAt: 0, view: null, marksAt: 0, got: new Set(), wasPush: false, cnt: 99, ix: 0, iy: 3.6 };
    R.hp = layout.rows.map((r) => r.panes.map((p) => p.hp));
    R.taken = new Uint8Array(layout.bolts.length);
    view.visible(false);
    try {
        R.view = buildRush(m.w, layout, m.n);
        setMood(WORLDS[m.w].mood, true);
        paneFog(); shardFog();
        R.view.setRow(0, (r, c) => R.hp[r][c] <= 0);
        await primeScene(R.view.group);
    } catch (e) { console.error('[rush]', e); noteError('[rush] ' + (e && e.message)); }
    for (const r of remotes.values()) r.char.setVisible(false);
    P.world = RWORLD;
    P.pushing = false;
    document.body.classList.add('inrush');
    switching = false;
    teleport(m.x, 0, m.z, Math.PI);
    fadeIn();
    setMusicMode('climb'); setMusicIntensity(0);
    rushHud({ on: true, place: '', left: 0 });
}
// phones: racing with a thumb and steering is plenty, but the first race runs itself until you touch the stick
function setAutoRunIfPhone() { if (isTouch && !P.autoRun && S.rushes < 1) setAutoRun(true); }
function leaveRushView() {
    if (!R) return;
    if (R.view) R.view.dispose();
    R = null;
}
async function leaveRush(m, results) {
    switching = true;
    closeTop();
    await fadeOut();
    leaveRushView();
    document.body.classList.remove('inrush');
    rushHud({ on: false });
    showCount('');
    P.world = view.T.world;
    view.visible(true);
    setMood(WORLDS[view.w].mood, true);
    paneFog(); shardFog();
    resetRun();
    for (const r of remotes.values()) r.char.setVisible(false);
    switching = false;
    teleport(m.x, 0, m.z, Math.PI);
    fadeIn();
    setMusicMode('plaza'); setMusicIntensity(1);
    setAutoRun(false);
    if (results) rushResults(results);
}
// your race: the row ahead stops you where its glass stands; pushing takes its health at your power; steel doesn't give
function updateRushMe(dt) {
    const b = P.b, r = R, t = clockT;
    P.pushing = false;
    r.boost = Math.max(0, r.boost - dt * 0.22);
    if (r.phase === 'ready') {
        const left = Math.ceil((r.goAt - net.now()) / 1000);
        if (left !== r.cnt) { r.cnt = left; if (left <= 3 && left > 0) { showCount(String(left)); sfx('beep'); } else if (left > 3) showCount(''); }
        if (b.z < RUSH.startZ - 1.5) { b.z = RUSH.startZ - 1.5; if (b.vz < 0) b.vz = 0; }
        return;
    }
    // the Speed strips on the way
    while (r.boltI < r.layout.bolts.length && r.layout.bolts[r.boltI].z > b.z + 6) r.boltI++;
    for (let i = r.boltI; i < Math.min(r.boltI + 3, r.layout.bolts.length); i++) {
        const o = r.layout.bolts[i];
        if (!r.taken[i] && Math.abs(o.x - b.x) < 5 && Math.abs(o.z - b.z) < 5) { r.taken[i] = 1; r.boost = Math.min(1, r.boost + 0.7); playAsmr('zip', 0.5, 1); fovKick = Math.max(fovKick, 6); lineKick = 1; FX.powerFx(b, 0x6ae8ff, 8); }
    }
    let row = r.layout.rows[r.row];
    while (row && b.z < row.z - 1) { r.row++; row = r.layout.rows[r.row]; R.view.setRow(r.row, (rw, c) => r.hp[rw][c] <= 0); }
    // the race's song builds for the last stretch
    if (row) setMusicIntensity(r.row >= r.layout.rows.length - 4 ? 2 : 1);
    if (!row) return;
    const pn = paneIn(row, b.x), standing = r.hp[row.i][pn.c] > 0;
    // straddling two columns: blocked by whichever stands; nudged toward the open one
    if (b.z < row.z + 1.5 && !row.boss) {
        const lo = paneIn(row, b.x - 0.9), hi = paneIn(row, b.x + 0.9);
        const lS = r.hp[row.i][lo.c] > 0, hS = r.hp[row.i][hi.c] > 0;
        if (!lS && hS && !standing) b.x -= dt * 16; else if (lS && !hS && !standing) b.x += dt * 16;
        else if (lo.c !== hi.c && (lS || hS) && standing !== (lS && hS)) b.x += (lS ? 1 : -1) * dt * 16;
    }
    const blocked = standing;
    if (blocked && b.z < row.z + 1.5) { b.z = row.z + 1.5; if (b.vz < 0) b.vz = 0; }
    if (blocked && b.z <= row.z + RUSH.touch + 0.3 && pn.kind !== 'steel') {
        const idx = R.view.at(row.i, pn.c);
        if (r.pushKey !== row.i * 16 + pn.c) {
            r.pushKey = row.i * 16 + pn.c;
            r.ix = b.x; r.iy = 3.6 + RND() * 1.4;
            if (idx !== undefined) R.view.panes.damage(idx, Math.max(0.02, 1 - r.hp[row.i][pn.c] / pn.hp), r.ix, r.iy);
            playAsmr('hit', 0.7, 0.95 + RND() * 0.16);
            FX.hitFx(b.x, r.iy, row.z, 1, KINDS[pn.kind].tint, 0.3);
            shake = Math.max(shake, 0.16);
        }
        P.pushing = true;
        const v = r.hp[row.i][pn.c] - r.power * dt;
        r.hp[row.i][pn.c] = v;
        if (v <= 0) { r.hp[row.i][pn.c] = 0; r.pushKey = -1; rushSmash(row.i, pn.c, b.x, true); r.smashed++; r.boost = Math.min(1, r.boost + 0.12); return; }
        const d = 1 - v / pn.hp;
        if (idx !== undefined && Math.abs(d - (r.dmg || 0)) > 0.02) { r.dmg = d; R.view.panes.damage(idx, d); }
        if (d - (r.crack || 0) > 0.22) { r.crack = d; playAsmr('crack', 0.5, 0.9 + RND() * 0.3); }
    } else { if (r.pushKey !== undefined && r.pushKey !== row.i * 16 + pn.c) { r.pushKey = -1; r.crack = 0; r.dmg = 0; } }
    if (blocked && pn.kind === 'steel' && t - (r.steelAt || 0) > 2.2 && b.z <= row.z + RUSH.touch) { r.steelAt = t; toast('🚧 Steel! Go round it', '#ff9a8a'); playAsmr('land', 0.5, 0.7); shake = Math.max(shake, 0.18); }
    // the clock
    const left = Math.max(0, Math.ceil((r.endsAt - net.now()) / 1000));
    if (left !== r.leftShown) { r.leftShown = left; rushHud({ left }); }
}
// a pane down in the race (yours or someone's): it flies, and everyone can run through
function rushSmash(ri, c, x, mine) {
    const r = R, row = r.layout.rows[ri], pn = row.panes[c], idx = r.view.at(ri, c);
    if (r.got.has(ri * 16 + c)) return;
    r.got.add(ri * 16 + c);
    r.hp[ri][c] = 0;
    if (idx !== undefined) r.view.panes.show(idx, false);
    const K = KINDS[pn.kind], d = Math.abs(row.z - P.b.z), vol = mine ? 1 : Math.max(0, 1 - d / 150);
    if (d < 200) {
        const low = getQuality() === 'low';
        shardBurst(pn.x0, pn.x1, 0, RUSH.paneH, row.z, x, 3.6, -1, K.tint, row.boss ? (low ? 180 : 320) : (low ? 34 : 60), row.boss ? 1.4 : 1);
        if (vol > 0.05) playAsmr(row.boss ? 'smashBig' : 'smash', (mine ? 0.85 : 0.5) * vol * (row.boss ? 1.2 : 1), 0.95 + RND() * 0.2, mine ? 0 : panOf(x, row.z));
    }
    if (mine) {
        shake = Math.max(shake, row.boss ? 0.7 : 0.34); fovKick = Math.max(fovKick, row.boss ? 8 : 3.5); lineKick = 1;
        if (pn.kind === 'gold') { r.boost = 1; FX.powerFx(P.b, 0xffd028, 12); toast('⚡ Golden pane! A burst of pace', '#ffe24a'); playAsmr('zip', 0.6, 1.2); }
        paneFlash();
    }
    if (row.boss) { bigText('THE GIANT PANE IS DOWN!', '#ffd028'); screenConfetti(60); }
}
// a race's progress bar: everyone by how far along the course they are
function rushMarks() {
    const room = net.room;
    if (!R || !room || !room.state.players) return;
    const end = R.layout.finish;
    marks.length = 0;
    marks.push({ id: 'me', f: clamp(P.b.z / end, 0, 1), me: true, name: S.name });
    let ahead = 0;
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId || p.match !== R.id) return;
        const f = clamp(p.z / end, 0, 1);
        if (p.z < P.b.z) ahead++;
        if (marks.length < 12) marks.push({ id, f, name: p.name, pid: p.pid });
    });
    progressMarks(marks);
    if (R.phase === 'race' && R.place < 0) { const pl = PLACES[Math.min(ahead, PLACES.length - 1)]; if (pl !== R.placeShown) { R.placeShown = pl; rushHud({ place: pl }); } }
}

// =====================================================================================
// The camera: close behind you (drag to turn, wheel / pinch to zoom)
// =====================================================================================
const cam = { yaw: 0, pitch: 0.28, dist: isTouch ? 20 : 17 };
let camD = 17, camSens = 1, camSnap = true, shake = 0, fovKick = 0, lineKick = 0;
const dirV = new V3(), pivotV = new V3(), backV = new V3(), camPos = new V3(), lookV = new V3();
let pivotY = 5;
function lookDir(out) { const p = cam.pitch, cp = Math.cos(p); return out.set(-Math.sin(cam.yaw) * cp, -Math.sin(p), -Math.cos(cam.yaw) * cp); }
const LZD = SUN_DIRECTION.clone().normalize(), LX = new V3(0, 1, 0).cross(LZD).normalize(), LY = LZD.clone().cross(LX), snapV = new V3();
function snapShadow(p) {
    const c = sun.shadow.camera, texel = (c.right - c.left) / sun.shadow.mapSize.x;
    const a = Math.round(p.dot(LX) / texel) * texel, b = Math.round(p.dot(LY) / texel) * texel;
    snapV.copy(LX).multiplyScalar(a).addScaledVector(LY, b).addScaledVector(LZD, p.dot(LZD));
    sun.target.position.copy(snapV);
    sun.position.copy(snapV).addScaledVector(LZD, 200);
}
const AX = [0, 1, 2], oA = [0, 0, 0], dA = [0, 0, 0];
function rayHit(o, d, maxT) {
    let best = maxT;
    oA[0] = o.x; oA[1] = o.y; oA[2] = o.z; dA[0] = d.x; dA[1] = d.y; dA[2] = d.z;
    for (const c of P.world.solids) {
        if (c.max[1] - c.min[1] < 3) continue;
        let t0 = 0, t1 = best, miss = false;
        for (const a of AX) {
            if (Math.abs(dA[a]) < 1e-9) { if (oA[a] < c.min[a] || oA[a] > c.max[a]) { miss = true; break; } continue; }
            let ta = (c.min[a] - oA[a]) / dA[a], tb = (c.max[a] - oA[a]) / dA[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { miss = true; break; }
        }
        if (!miss && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
function updateCamera(dt) {
    const b = P.b, portrait = innerWidth < innerHeight;
    lookDir(dirV);
    const gy = b.y + 5.2;
    if (camSnap || (pivotV.x - b.x) ** 2 + (pivotV.z - b.z) ** 2 > 900) { pivotV.set(b.x, gy, b.z); pivotY = gy; camSnap = false; }
    else {
        const kx = 1 - Math.exp(-dt * 16);
        pivotV.x += (b.x - pivotV.x) * kx; pivotV.z += (b.z - pivotV.z) * kx;
        pivotY += (gy - pivotY) * (1 - Math.exp(-dt * (b.onGround ? 10 : 6)));
        pivotV.y = pivotY;
    }
    backV.copy(dirV).negate();
    const sp = Math.hypot(b.vx, b.vz), speedBack = Math.min(5, Math.max(0, sp - 26) * 0.12);
    let lim = cam.dist + (portrait ? 6 : 0) + speedBack;
    lim = Math.min(lim, rayHit(pivotV, backV, lim + 1) - 0.8);
    lim = Math.max(2, lim);
    camD = lim < camD ? lim : camD + (lim - camD) * (1 - Math.exp(-dt * 4));
    camPos.copy(pivotV).addScaledVector(backV, camD);
    if (camPos.y < 0.8) camPos.y = 0.8;
    // inside the corridor the camera stays between its walls
    const half = R ? RUSH.half : (b.z < W.front - 2 ? W.half : 0);
    if (half) camPos.x = clamp(camPos.x, -half + 1.4, half - 1.4);
    camera.position.copy(camPos);
    camera.lookAt(lookV.copy(camPos).addScaledVector(dirV, 30));
    if (shake > 0.001) { const s = shake * shake * 1.5; camera.position.x += (RND() * 2 - 1) * s; camera.position.y += (RND() * 2 - 1) * s; shake = Math.max(0, shake - dt * 2.4); }
    // the faster you go the wider the view; every smash kicks it wider still, easing back
    fovKick = Math.max(0, fovKick - dt * 9);
    const want = (portrait ? 80 : 70) + Math.min(11, sp * 0.14) + fovKick;
    if (Math.abs(camera.fov - want) > 0.01) { camera.fov += (want - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if (me) me.root.visible = camD > 2.2;
}

// =====================================================================================
// Input
// =====================================================================================
const keys = {};
const touchMove = { x: 0, y: 0 };
let running = false, touchJump = false;
actions.onPanel = () => { for (const k in keys) keys[k] = false; touchJump = false; };
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (!running) return;
    if (e.code === 'Escape' && !e.repeat) { if (closeTop()) return; if (BX.isEmbedded()) BX.showPortalMenu(); else openPanel('settings'); return; }
    keys[e.code] = true;
    if (e.repeat || anyPopup()) return;
    if (e.code === 'Space') P.jumpPress = clockT;
    if (e.code === 'KeyE' && activePrompt) usePrompt();
    if (e.code === 'KeyR') spawnHome();
    if (e.code === 'KeyQ') openPanel('quests');
    if (e.code === 'KeyF') openPanel('spin');
    if (e.code === 'KeyG') openPanel('shop');
    if (e.code === 'KeyP') pressPlay();
    if (e.code === 'KeyT') actions.autoRun();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchJump = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const drags = new Map();
let pinchD = 0;
canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    if (!running || anyPopup()) return;
    canvas.setPointerCapture(e.pointerId);
    drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
    if (drags.size === 2) { const [a, b] = [...drags.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) d.moved = true;
    if (drags.size === 2) {
        const [a, b] = [...drags.values()], nd = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD) cam.dist = clamp(cam.dist * pinchD / Math.max(20, nd), 8, 44);
        pinchD = nd;
    } else if (d.moved) {
        const k = (e.pointerType === 'touch' ? 0.0068 : 0.0045) * camSens;
        cam.yaw -= (e.clientX - d.x) * k;
        cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.5, 1.3);
    }
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => { drags.delete(e.pointerId); if (drags.size < 2) pinchD = 0; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2, 8, 44); e.preventDefault(); }, { passive: false });
(function touchControls() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null, rect = null;
    const set = (e) => {
        const r = rect;
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; rect = stick.getBoundingClientRect(); stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); jb.setPointerCapture(e.pointerId); P.jumpPress = clockT; touchJump = true; jb.classList.add('on'); });
    const jEnd = () => { touchJump = false; jb.classList.remove('on'); };
    jb.addEventListener('pointerup', jEnd); jb.addEventListener('pointercancel', jEnd);
})();

// ----- proximity prompts (the sneaker pads, the portal, the Rush gate) -----
let activePrompt = null;
const pv = new V3();
function updatePrompt() {
    let best = null, bd = 1e9;
    const b = P.b;
    if (!anyPopup() && b.y < 6 && !R) for (const p of prompts) { const d = Math.hypot(p.pos.x - b.x, p.pos.z - b.z); if (d < p.r && d < bd) { bd = d; best = p; } }
    activePrompt = best;
    const el = $('#promptBtn');
    if (!best) { if (!el.hidden) el.hidden = true; return; }
    pv.copy(best.pos).setY(best.pos.y + 6).project(camera);
    if (pv.z > 1) { el.hidden = true; return; }
    el.hidden = false;
    const lbl = best.label();
    if ($('#promptTxt').textContent !== lbl) $('#promptTxt').textContent = lbl;
    el.style.transform = `translate(${((pv.x + 1) / 2 * innerWidth).toFixed(0)}px, ${((1 - pv.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%, -110%)`;
}
function usePrompt() { if (activePrompt) { sfx('click'); activePrompt.act(); } }
$('#promptBtn').addEventListener('click', usePrompt);

// ----- controller -----
function padButtons() {
    if (!pad.connected || !running) return;
    if (pad.pressed.has('BACK') || pad.pressed.has('START')) { if (!closeTop()) openPanel('settings'); return; }
    if (anyPopup()) { if (pad.pressed.has('B')) closeTop(); return; }
    if (pad.pressed.has('A')) P.jumpPress = clockT;
    if (pad.pressed.has('X') && activePrompt) usePrompt();
    if (pad.pressed.has('Y')) openPanel('quests');
    if (pad.pressed.has('LB')) openPanel('spin');
    if (pad.pressed.has('RB')) openPanel('shop');
}

// =====================================================================================
// Everyone else in your world or your race (smoothed on the server's clock)
// =====================================================================================
const remotes = new Map();
const smp = { x: 0, y: 0, z: 0, ry: 0, a: 0, speed: 0 };
class Remote {
    constructor(p, id) {
        this.id = id;
        this.char = new Char({ name: p.name, lv: p.lv, tr: p.tr });
        this.char.setAvatar(p.av);
        this.av = p.av; this.track = new Track(); this.air = false; this.prevY = p.y; this.vy = 0; this.here = false;
    }
    update(p, dt, t, rt) {
        this.track.push(p.t, p.x, p.y, p.z, p.ry, p.anim);
        this.here = R ? p.match === R.id : (p.match === 0 && p.world === S.world);
        if (!this.here || switching) { this.char.setVisible(false); return; }
        if (!this.track.sample(rt, smp)) { smp.x = p.x; smp.y = p.y; smp.z = p.z; smp.ry = p.ry; smp.a = p.anim; smp.speed = 0; }
        const air = smp.a === 2, vy = dt > 0 ? (smp.y - this.prevY) / dt : 0;
        this.vy += (vy - this.vy) * Math.min(1, dt * 12);
        if (this.air && !air) this.char.squash(0.6);
        if (!this.air && air && this.vy > 3) this.char.stretch(0.5);
        this.air = air; this.prevY = smp.y;
        if (p.av !== this.av) { this.av = p.av; this.char.setAvatar(p.av); }
        this.char.setLabel(p.name, p.lv, p.tr);
        this.char.setTrail(p.trail); this.char.setAura(p.aura);
        const d2 = camera.position.distanceToSquared(FX.tmpV.set(smp.x, smp.y, smp.z)), near = d2 < 240 * 240;
        this.char.setVisible(near);
        // pushing glass or on a treadmill: running on the spot
        const onSpot = smp.a === 3 || (smp.a === 1 && smp.speed < 2);
        const speed = onSpot ? 30 : smp.speed;
        if (near) this.char.update(dt, t, { x: smp.x, y: smp.y, z: smp.z, ry: smp.ry, air, moving: smp.a === 1 || smp.a === 3 || smp.speed > 2, speed, vy: this.vy, far: d2 > 110 * 110, sprint: speed > 30 });
        this.vx = dt > 0 && this.x !== undefined ? (smp.x - this.x) / dt : 0; this.vz = dt > 0 && this.z !== undefined ? (smp.z - this.z) / dt : 0;
        this.x = smp.x; this.y = smp.y; this.z = smp.z;
    }
    dispose() { this.char.dispose(); }
}
const seenIds = new Set(), marks = [];
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    seenIds.clear();
    const rt = net.now() - updateDelay();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) { if (S.name !== p.name) { S.name = p.name; if (me) me.setLabel(S.name, S.lv, S.totalShards); } return; }
        seenIds.add(id);
        let r = remotes.get(id);
        if (!r) { r = new Remote(p, id); remotes.set(id, r); }
        r.update(p, dt, t, rt);
    });
    for (const [id, r] of remotes) if (!seenIds.has(id)) { r.dispose(); remotes.delete(id); }
}
// the Progress bar: everyone in your world, by the pane they're up to
function updateMarks() {
    if (R) { rushMarks(); return; }
    if (!view || !net.room || !net.room.state || !net.room.state.players) return;
    const n = view.T.n;
    marks.length = 0;
    marks.push({ id: 'me', f: Math.min(1, P.pane / n), me: true, name: S.name });
    net.room.state.players.forEach((p, id) => { if (id !== net.room.sessionId && !p.match && p.world === S.world && marks.length < 12) marks.push({ id, f: Math.min(1, p.prog / n), name: p.name, pid: p.pid }); });
    progressMarks(marks);
}
// the pane you're near: its health, big at the top of the screen
function updatePaneBar() {
    if (R) {
        const row = R.layout.rows[R.row], b = P.b;
        if (!row || row.z - b.z > 0 || b.z - row.z > 26 || R.phase !== 'race') { paneBar(null); return; }
        const pn = paneIn(row, b.x), hp = R.hp[row.i][pn.c];
        if (hp <= 0 || pn.kind === 'steel') { paneBar(row.boss ? null : null); return; }
        paneBar(row.boss ? 'The Giant Pane' : pn.kind === 'thin' ? 'Thin Pane' : pn.kind === 'tough' ? 'Tough Pane' : pn.kind === 'gold' ? 'Golden Pane' : 'Clear Pane', hp, pn.hp, b.z <= row.z + RUSH.touch + 0.3);
        return;
    }
    const pn = view && view.T.panes[P.pane];
    const near = pn && P.b.z - pn.z < 30;
    if (!near) { paneBar(null); return; }
    paneBar(pn.name, P.hp, P.hpMax, P.pushing);
}

// =====================================================================================
// HUD buttons
// =====================================================================================
let switching = false;
// (the button lets go of the keyboard: SPACE jumps, it never presses the last button clicked again)
const bind = (sel, fn) => $(sel).addEventListener('click', (e) => { sfx('click'); e.currentTarget.blur(); fn(); });
bind('#bSpin', () => openPanel('spin'));
bind('#bRebirth', () => openPanel('rebirth'));
bind('#bAura', () => openPanel('auras'));
bind('#bDaily', () => openPanel('daily'));
bind('#bTrails', () => openPanel('trails'));
bind('#bWorlds', () => openPanel('worlds'));
bind('#bQuests', () => openPanel('quests'));
bind('#bSettings', () => openPanel('settings'));
bind('#bShop', () => openPanel('shop'));
bind('#bGift', () => openPanel('gifts'));
bind('#questLine', () => openPanel('quests'));
bind('#shardBox', () => openPanel('boards'));
bind('#gemsBox', () => openPanel('shop'));
bind('#bX2', () => openPanel('shop'));
bind('#bX2s', () => openPanel('shop'));
bind('#bAuto', () => actions.autoRun());
bind('#bPlay', () => pressPlay());
bind('#bQuit', () => askConfirm('🏳️', 'Leave the race?', 'A bot takes your place and you get no prize.', 'Leave', () => net.send('quit', {})));
function fadeOut() { $('#fade').style.opacity = 1; return sleep(260); }
function fadeIn() { $('#fade').style.opacity = 0; }
let showFps = false;
actions.fpsOn = () => showFps;
actions.toggleFps = () => { showFps = !showFps; $('#fps').hidden = !showFps; };
let boards = { shards: [], speed: [], rush: [] };
actions.boards = () => boards;
actions.world = (w) => { if (R) return; if (w === S.world) { closeTop(); spawnHome(); return; } net.send('world', { w }); };
actions.toggleMusic = () => toggleMusic();
addEventListener('resize', () => measureHud());

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2877` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) loadingText('Waking up a server…');
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        loadingText('Waking up a server…');
        const until = Date.now() + 60000;
        while (Date.now() < until) { await sleep(2000); if (await serverUp(url)) break; }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    if (switching) return;
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const b = P.b;
    const a = !b.onGround ? 2 : P.pushing ? 3 : (P.moving || P.tread) ? 1 : 0;
    const m = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), ry: +P.facing.toFixed(3), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    m.ts = Math.round(net.now());
    net.send('move', m);
}
function playerUid() {
    let uid = storageGet('g1_uid');
    if (!uid) { uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); storageSet('g1_uid', uid); }
    return uid;
}
let gotProfile = false, lastGems = 0, lastShards = 0, lastReb = -1;
async function connect(name, endpoint) {
    const url = endpoint || await serverEndpoint();
    const client = new Client(url);
    const id = BX.identity();
    const room = await client.joinOrCreate('glass', { uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()), save: storageGet('g1_save') || '' });
    net.room = room;
    net.bloxity = false;
    BX.updateRoom(room.roomId);
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); setEpoch(m.now); net.bloxity = !!m.bloxity; pingSend(); });
    room.onMessage('pong', onPong);
    room.onMessage('profile', (m) => {
        const first = !gotProfile;
        if (m.save) storageSet('g1_save', m.save);
        delete m.now;
        const prevWorld = S.world;
        // Speed climbs on your screen as you step: the server's figure catches up, it doesn't pull you back mid-run
        if (!first && m.speed < S.speed && S.speed - m.speed < perStep(S, P.tread ? P.tread.mult : 1, S.x2) * 8) m.speed = S.speed;
        Object.assign(S, m);
        S.x2 = (S.x2Until || 0) > net.now();
        S.x2s = (S.x2sUntil || 0) > net.now();
        S.profileAt = Date.now();
        gotProfile = true;
        if (!first && m.gems > lastGems) { bump('#gemsBox'); sfx('gem'); }
        if (!first && m.shards > lastShards + 0.5) bump('#shardBox');
        lastGems = m.gems; lastShards = m.shards;
        if (me) { me.setLabel(S.name, S.lv, S.totalShards); me.setTrail(TRAILS.findIndex((x) => x.id === S.trail)); me.setAura(AURAS.findIndex((x) => x.id === S.aura)); }
        if (view) view.setProgress(S, net.now());
        if (lastReb !== S.rebirths) { lastReb = S.rebirths; document.body.classList.toggle('reborn', S.rebirths > 0); }
        // a world switch made elsewhere (another tab) shows up here
        if (!first && running && !switching && !R && prevWorld !== S.world && view && view.w !== S.world) switchWorld(S.world, W.spawn.x, W.spawn.z);
        refreshPanels();
        updateHud();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('broke', (m) => notEnough(m));
    room.onMessage('code', (m) => codeResult(m));
    room.onMessage('boards', (m) => { boards = m; if (view) view.setBoards(m); if (panelIs('boards')) refreshPanels(); });
    room.onMessage('reward', (m) => { popup(m.gems && !/sc|dc/.test(m.text) ? '💎' : '🎁', m.why || 'Reward!', m.text, '#ffe24a', true); sfx('reward'); confetti(P.b); if (/dc/.test(m.text)) flyShards(8); });
    room.onMessage('levelup', (m) => {
        const l0 = S.lv;
        S.lv = m.lv; S.xp = 0;
        sfx('levelup');
        levelUp(l0, m.lv);
        if (me) FX.sparkleColumn(P.b, 0x7af4ff);
        updateHud();
    });
    room.onMessage('pane', (m) => { if (view && !R && m.i > P.pane) { while (P.pane < m.i && view.T.panes[P.pane]) smashPane(view.T.panes[P.pane]); } });
    room.onMessage('stage', (m) => {
        if (m.opens >= 0) { popup('🌍', 'NEW WORLD OPEN!', WORLDS[m.opens].name + ': open Worlds on the left', '#7dff6b'); sfx('rankup'); screenConfetti(90); }
    });
    room.onMessage('runreset', () => { /* the panes went back up on this screen too, when you crossed back */ });
    room.onMessage('padok', (m) => onPadOk(m));
    room.onMessage('reborn', (m) => {
        sfx('rankup');
        popup('🔄', 'REBIRTH ' + m.r + '!', 'Every step now gives x' + (1 + 0.5 * m.r) + ' Speed', '#7af4ff');
        screenConfetti(90);
        S.speed = 0;
        resetRun();
        teleport(m.x, 0, m.z, Math.PI);
    });
    room.onMessage('warp', (m) => { S.world = m.w; switchWorld(m.w, m.x, m.z); });
    room.onMessage('spun', (m) => onSpun(m));
    room.onMessage('bought', (m) => {
        sfx('buy');
        screenConfetti(60);
        if (m.what === 'shoe') { const k = SHOES[m.i]; popup('👟', k.name.toUpperCase() + '!', '+' + fmt(k.add) + ' Speed every step', '#7dff6b'); if (me) FX.sparkleColumn(P.b, k.color); }
        else popup('🌈', 'UNLOCKED!', ((m.what === 'trail' ? TRAILS : AURAS).find((x) => x.id === m.id) || {}).name + (m.what === 'trail' ? ' trail' : ' aura'), '#7dff6b');
    });
    room.onMessage('rankup', () => { sfx('rankup'); });
    room.onMessage('taskdone', (m) => { sfx('task'); toast('✅ Daily task done: ' + TASKS[m.k].text + '! Claim it in Quests', '#7dff6b'); });
    room.onMessage('questdone', () => { sfx('task'); });
    room.onMessage('authed', (m) => { S.name = m.name; });
    room.onMessage('snap', (m) => {
        P.snaps++;
        if (R && m.rush) {
            const { r, c, hp } = m.rush, idx = R.view.at(r, c);
            if (R.got.delete(r * 16 + c) || hp > 0) { R.hp[r][c] = hp; if (idx !== undefined) R.view.panes.show(idx, true); }
            R.row = Math.min(R.row, r);
        } else if (!R && view && m.pane !== undefined && m.pane !== P.pane) {
            // the server says this pane is still up: it comes back
            for (let i = m.pane; i <= P.pane && i < view.T.n; i++) view.panes.show(i, false);
            setPane(m.pane, m.hp);
            view.setPane(-1); view.setPane(m.pane);
        }
        teleport(m.x, m.y, m.z);
    });
    // ----- Glass Rush -----
    room.onMessage('rushQueue', (m) => {
        if (m.off) { S.queued = false; queueState(null); return; }
        const was = S.queued ? S.qFound : 0;
        S.queued = true; S.qFound = m.found;
        if (m.found > was && was > 0) sfx('found');
        queueState(m);
    });
    room.onMessage('rushStart', (m) => enterRush(m));
    room.onMessage('rushJoined', (m) => { toast('🏃 ' + m.name + ' joined the race!', '#7af4ff'); sfx('found'); });
    room.onMessage('rushLeft', (m) => { toast(m.name + ' left: a bot takes over', '#c8d0dc'); });
    room.onMessage('rushGo', (m) => {
        if (!R) return;
        R.phase = 'race'; R.endsAt = m.at + m.limit * 1000;
        showCount('GO!');
        sfx('go');
        setMusicIntensity(1);
        setTimeout(() => showCount(''), 900);
    });
    room.onMessage('rushHit', (m) => {
        if (!R) return;
        for (const h of m.l) {
            if (R.got.has(h.r * 16 + h.c)) continue;
            const pn = R.layout.rows[h.r].panes[h.c], idx = R.view.at(h.r, h.c), mine = R.pushKey === h.r * 16 + h.c;
            if (h.hp < R.hp[h.r][h.c] || !mine) R.hp[h.r][h.c] = Math.min(R.hp[h.r][h.c], h.hp);
            if (idx !== undefined && !mine) R.view.panes.damage(idx, 1 - R.hp[h.r][h.c] / pn.hp, h.x, 3.6);
        }
    });
    room.onMessage('rushBreak', (m) => { if (R) rushSmash(m.r, m.c, m.x, m.by === room.sessionId); });
    room.onMessage('rushFinish', (m) => {
        if (!R) return;
        if (m.me) { R.place = m.place; rushHud({ place: PLACES[m.place] }); bigText(PLACES[m.place].toUpperCase() + ' PLACE!', m.place === 0 ? '#ffd028' : '#7af4ff'); sfx(m.place <= 2 ? 'win' : 'pass'); screenConfetti(m.place === 0 ? 120 : 50); setAutoRun(false); }
        else toast(m.name + ' finished ' + PLACES[m.place], '#c8d0dc');
    });
    room.onMessage('rushEnd', (m) => leaveRush(m, m));
    room.onMessage('rushBack', (m) => leaveRush(m, null));
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r && r.char.blox) playEmoteOn(r.char.blox, m.id); });
    room.onMessage('chat', (m) => { const r = remotes.get(m.s); if (r) chatBubble(r.char.root, m.text); else if (m.s === room.sessionId && me) chatBubble(me.root, m.text); });
    room.onLeave((code) => {
        if (code === 4000) { $('#connectErr').textContent = 'You joined from somewhere else.'; }
        else $('#connectErr').textContent = 'Lost the connection to the server.';
        $('#start').hidden = false; $('#connectErr').hidden = false; $('#retryBtn').hidden = false; $('#loading').textContent = '';
        running = false;
    });
    return room;
}
// a Shard Pad: Shards, then home to the spawn
async function onPadOk(m) {
    playAsmr('chime', 0.8, 1);
    sfx('win');
    shardPop(m.n);
    flyShards(m.n);
    FX.coinBurst(FX.tmpV.set(P.b.x, P.b.y + 3, P.b.z));
    confetti(P.b);
    screenConfetti(40);
    S.shards += m.n; S.totalShards += m.n;
    updateHud();
    switching = true;
    await sleep(380);
    await fadeOut();
    switching = false;
    resetRun();
    teleport(m.x, 0, m.z, Math.PI);
    fadeIn();
    FX.sparkleColumn(P.b, 0x7af4ff);
    const nx = SHOES[S.shoes];
    if (nx && S.shards >= nx.shards) setTimeout(() => toast('👟 You can afford ' + nx.name + ': step on the pad on the right!', '#7dff6b'), 1000);
    else if (S.shards >= rebirthCost(S.rebirths)) setTimeout(() => toast('🔄 You can Rebirth!', '#7af4ff'), 1000);
    setTimeout(offerDaily, 2500);
}
// the daily reward pops up only at the spawn, on the ground (never mid-run)
function offerDaily() {
    if (!running || R || P.onRun || !P.b.onGround || anyPopup() || offerDaily.done) return;
    if (!dailyStatus(S.daily, net.now()).can) return;
    offerDaily.done = true;
    openPanel('daily');
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubbleLbl) { group.remove(group.userData.bubbleLbl); group.userData.bubbleLbl.material.map.dispose(); }
    const lb = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#10203a', px: 44 }], 9, 1024, new V3(0, 11, 0), group);
    group.userData.bubbleLbl = lb;
    setTimeout(() => { if (group.userData.bubbleLbl === lb) { group.remove(lb); lb.material.map.dispose(); group.userData.bubbleLbl = null; } }, 5000);
}

// =====================================================================================
// Every frame
// =====================================================================================
let floatX = 0, floatZ = 0, clockT = 0, hudT = 0, metaT = 20, slowT = 0, pingT = 0, musicOnRun = false;
function update(dt) {
    clockT += dt;
    const t = clockT;
    CU.uNow.value = rel(net.now());
    pumpAvatars();
    updateMe(dt);
    updatePrompt();
    syncRemotes(dt, t);
    contactShadows();
    updateEffects(dt, P.b.x - floatX, P.b.z - floatZ);
    floatX = P.b.x; floatZ = P.b.z;
    updateFx(dt);
    tickGlass();
    if (view) view.update();
    if (R && R.view) R.view.update();
    animateCounters(dt);
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) $('#flash').style.opacity = '0'; }
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateMarks(); updatePaneBar(); }
    slowT -= dt;
    if (slowT <= 0) {
        slowT = 1;
        S.x2 = (S.x2Until || 0) > net.now(); S.x2s = (S.x2sUntil || 0) > net.now();
        updateHud();
        if (view && !R) view.setProgress(S, net.now());
    }
    pingT -= dt;
    if (pingT <= 0) { pingT = pingEvery(); pingSend(); }
    metaT -= dt;
    if (metaT <= 0) { metaT = 30; sendMeta(); }
    // a driving song on the Run, an easy one at the spawn (the same tune)
    if (!R && P.onRun !== musicOnRun) { musicOnRun = P.onRun; setMusicIntensity(musicOnRun ? 1 : 0); }
}
// contact shadows (Low quality)
function contactShadows() {
    if (!view || switching) return;
    const b = P.b, low = getQuality() === 'low';
    SH.shadowsOn(low);
    SH.begin();
    if (low) {
        SH.add(b.x, 0, b.z, b.y, 3);
        for (const r of remotes.values()) if (r.here && r.x !== undefined && r.char.shown) SH.add(r.x, 0, r.z, r.y, 3);
    }
    SH.end();
}
const AMB = [{ color: 0xf8ffe0, dir: 0.35, snow: false }, { color: 0xffe0b0, dir: 0.3, snow: false }, { color: 0xffffff, dir: -0.9, snow: true }, { color: 0xff9a4a, dir: 1.4, snow: false }];
function updateCameraAll(dt) {
    updateCamera(dt);
    const t = clockT;
    if (shadowDue()) snapShadow(FX.tmpV.set(P.b.x, P.b.y, P.b.z));
    updateSky(camera.position, t, dt);
    updateAmbient(camera.position, t, AMB[R ? R.w : S.world] || AMB[0]);
    lineKick = Math.max(0, lineKick - dt * 3);
    const sp = Math.hypot(P.b.vx, P.b.vz);
    setSpeedLines(Math.max(lineKick * 0.8, sp > 36 ? Math.min(0.7, (sp - 36) / 40) : 0), dt);
}

// ----- play stats: how the game runs on this device and any error it hit -----
const fpsWin = { sum: 0, n: 0 }, errSeen = new Set(), errQueue = [];
let metaFirst = true, loadSecs = 0, lastFps = 60;
function noteError(msg, src, line, col) {
    const file = src ? String(src).split('/').pop().split('?')[0] : '';
    const k = String(msg || '?').slice(0, 150) + (file ? ' @' + file + ':' + (line || 0) + ':' + (col || 0) : '');
    if (errSeen.has(k) || errSeen.size >= 20) return;
    errSeen.add(k); errQueue.push(k);
}
window.addEventListener('error', (e) => noteError(e.message, e.filename, e.lineno, e.colno));
window.addEventListener('unhandledrejection', (e) => noteError('promise: ' + ((e.reason && e.reason.message) || e.reason)));
addEventListener('pagehide', () => { if (running) sendMeta(); });
let gpuNameCache = null;
function gpuName() {
    if (gpuNameCache !== null) return gpuNameCache;
    gpuNameCache = GPU_NAME.slice(0, 90) + (renderer.getContext().getContextAttributes().antialias ? '' : ' (no AA)');
    return gpuNameCache;
}
function sendMeta() {
    const m = { touch: isTouch, fps: fpsWin.n ? Math.round(fpsWin.sum / fpsWin.n) : lastFps, q: getQuality(), errs: errQueue.splice(0, 5) };
    fpsWin.sum = 0; fpsWin.n = 0;
    if (metaFirst) { metaFirst = false; Object.assign(m, { gpu: gpuName(), load: loadSecs, dpr: Math.round(devicePixelRatio * 100) / 100, w: innerWidth, h: innerHeight, cores: navigator.hardwareConcurrency || 0, mem: navigator.deviceMemory || 0 }); }
    net.send('meta', m);
}

// ----- the smoothness watch (every half second): the resolution adapts first, then the quality -----
const fpsWatch = { t: 0, avg: 60, low: 0, good: 0, trial: null, cpuUntil: 0, fails: 0, upAt: -99, upFrom: 1, ceil: 1, ceilUntil: 0, holdUntil: 0, lows: 0 };
// a world switch builds things for a moment: the watcher looks away for a few seconds
function holdFpsWatch(secs) { fpsWatch.holdUntil = fpsWatch.t + (secs || 4); fpsWatch.avg = Math.max(fpsWatch.avg, 58); }
let watchOff = false;
function watchFps(fps) {
    if (!running || document.hidden || watchOff) return;
    const w = fpsWatch;
    w.t += 0.5;
    // a single stall (one slow half-second) doesn't count: only two in a row do
    w.lows = fps < 45 ? w.lows + 1 : 0;
    if (w.lows === 1 && fps < 45) return;
    w.avg += (fps - w.avg) * 0.35;
    if (w.t < 3 || w.t < w.holdUntil) return;
    if (w.t > w.ceilUntil) w.ceil = 1;
    if (w.trial) {
        if (w.t - w.trial.at < 2) return;
        if (w.avg < w.trial.fps * 1.06) { setResScale(w.trial.prev); w.fails++; w.cpuUntil = w.t + Math.min(240, 30 * w.fails); } else w.fails = 0;
        w.trial = null;
        return;
    }
    const scale = getResScale();
    // high frame rates first: below 54 a 60 Hz screen is already missing frames
    if (w.avg < 54 && w.t > w.cpuUntil && scale > 0.56) {
        if (w.t - w.upAt < 6) { w.ceil = w.upFrom; w.ceilUntil = w.t + 60; }
        w.trial = { at: w.t, fps: w.avg, prev: scale };
        setResScale(scale * 0.85);
        w.good = 0;
        return;
    }
    if (w.avg >= 57) {
        w.good += 0.5;
        if (w.good >= 6 && scale < w.ceil - 0.01) { w.good = 0; w.upAt = w.t; w.upFrom = scale; setResScale(Math.min(w.ceil, scale / 0.88)); }
    } else w.good = 0;
    if (!autoQualityAllowed()) return;
    w.low = w.avg < 45 && (scale <= 0.56 || w.t < w.cpuUntil) ? w.low + 0.5 : 0;
    if (w.low < 3) return;
    w.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true, w.t < 45);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
// Even frame pacing: on a fast screen (120 Hz and up) a frame that misses the refresh waits for the next one, so
// a game running between half and full rate shows frames of uneven length (a stutter, though the FPS is high).
// When most frames miss and some don't, it draws every other refresh instead: an even 72 on a 144 Hz screen.
const ivs = [];
let refreshMs = 0, paceN = 0, strikes = 0, pacedAt = 0, paced = false, trial = false;
function noteInterval(ms) { if (ms > 2 && ms < 60 && ivs.length < 400) ivs.push(ms); }
function pace() {
    if (!running || document.hidden || isTouch) return;
    const now = performance.now();
    // paced a while: try the full rate again (the scene may be lighter now)
    if (paced) { if (now - pacedAt > 30000) { paced = false; skipOdd = false; trial = true; ivs.length = 0; } return; }
    if (ivs.length < 200) return;
    paceN++;
    const s = ivs.slice().sort((a, b) => a - b), p10 = s[Math.floor(s.length * 0.1)];
    refreshMs = refreshMs ? Math.min(refreshMs, p10) : p10;
    const late = s.filter((v) => v > refreshMs * 1.5).length / s.length;
    ivs.length = 0;
    // a fast screen (refresh under 9 ms) and a quarter to most of the frames late: uneven
    const uneven = refreshMs < 9 && late > 0.25 && late < 0.9;
    strikes = uneven ? strikes + 1 : 0;
    if ((trial && uneven) || (paceN > 3 && strikes >= 2 && fpsWatch.t >= fpsWatch.holdUntil)) {
        paced = true; skipOdd = true; pacedAt = now; strikes = 0;
        console.info('[pace] every other refresh (' + Math.round(500 / refreshMs) + ' FPS), ' + Math.round(late * 100) + '% of frames were late');
    }
    trial = false;
}
const perf = { n: 0, sum: 0, max: 0, last: 0 };
const spikes = [], slowParts = [];
let secAvg = {};
let frameErrors = 0, lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, skipOdd = false, oddFrame = false;
function frame(now) {
    requestAnimationFrame(frame);
    if (skipOdd) { oddFrame = !oddFrame; if (oddFrame) return; }
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    if (lastFrame && !skipOdd) noteInterval(now - lastFrame);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) {
        const fps = fpsFrames / fpsAcc;
        lastFps = Math.round(fps);
        if (running && !document.hidden) { fpsWin.sum += fps; fpsWin.n++; }
        if (showFps) $('#fps').textContent = lastFps + ' FPS';
        if (isTouch && !skipOdd && fps > 100) skipOdd = true;
        pace();
        watchFps(fps); fpsAcc = 0; fpsFrames = 0;
    }
    if (lastFrame && now - lastFrame > 45 && spikes.length < 60) spikes.push({ at: Math.round(now), ms: Math.round(now - lastFrame), work: +perf.last.toFixed(1), res: getResScale() });
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    if (running) {
        const w0 = performance.now();
        try {
            prof.start();
            update(dt);
            prof.mark('update');
            updateCameraAll(dt);
            prof.mark('camera+sky');
            render();
            prof.mark('render');
        } catch (e) {
            if (frameErrors++ < 5) console.error('[frame]', e);
            const at = String((e && e.stack) || '').split('\n').find((l) => /:\d+:\d+/.test(l)) || '';
            noteError('[frame] ' + ((e && e.message) || e), '', 0, 0);
            if (at) noteError('[frame at] ' + at.trim().slice(-120));
        }
        const w = performance.now() - w0;
        perf.n++; perf.sum += w; perf.max = Math.max(perf.max, w); perf.last = w;
        for (let i = 0; i < prof.parts.length; i += 2) secAvg[prof.parts[i]] = (secAvg[prof.parts[i]] || 0) + prof.parts[i + 1];
        secAvg.n = (secAvg.n || 0) + 1;
        if (w > 50 && slowParts.length < 20) { const o = {}; for (let i = 0; i < prof.parts.length; i += 2) o[prof.parts[i]] = +(o[prof.parts[i]] || 0) + +prof.parts[i + 1].toFixed(1); slowParts.push({ at: Math.round(now), ms: Math.round(w), calls: renderer.info.render.calls, prog: renderer.info.programs.length, ...o }); }
    }
}

// =====================================================================================
// Boot: build everything behind the loading screen, join, play (no start menu)
// =====================================================================================
function loadingText(t) { $('#loading').textContent = t; }
let joining = false, joinTask = null, worldReady = null;
async function joinServer() {
    const endpointTask = serverEndpoint();
    endpointTask.catch(() => {});
    await waitForLogin(400);
    const saved = (storageGet('g1_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved, attempt === 0 ? await endpointTask : null); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            loadingText('Waking up a server…');
            await sleep(2000 * (attempt + 1));
        }
    }
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => { const t0 = performance.now(); (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })(); });
}
async function play() {
    if (joining || running) return;
    joining = true;
    $('#connectErr').hidden = true; $('#retryBtn').hidden = true;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try {
        await worldReady;
        loadingText('Joining a server…');
        $('#loadBar').style.width = '92%';
        BX.loadingStep('Joining a server…');
        await joinTask;
        const t0 = performance.now();
        while (!gotProfile && performance.now() - t0 < 6000) await sleep(50);
    } catch (e) {
        joinTask = null;
        console.error(e);
        joining = false;
        loadingText('');
        $('#connectErr').hidden = false;
        $('#connectErr').textContent = 'Could not reach the game server. Check your connection and try again.';
        $('#retryBtn').hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    // your world (the one you were in last time)
    if (S.world !== view.w) buildView(S.world);
    running = true;
    S.joinedAt = Date.now();
    if (!me) buildMe();
    const p = net.room.state.players.get(net.room.sessionId);
    teleport(p ? p.x : W.spawn.x, 0, p ? p.z : W.spawn.z, Math.PI);
    cam.yaw = 0; cam.pitch = 0.28;
    loadingText('Almost there…');
    $('#loadBar').style.width = '100%';
    await primeFrames();
    fpsAcc = 0; fpsFrames = 0;
    // until a song's first loop is rendered it plays note by note (~100 audio nodes a second): fine on a PC, not on
    // a phone or a weak laptop (Low), which waits for the loop in silence
    allowLiveMusic(getQuality() !== 'low');
    startMusic();
    setMusicMode('plaza'); setMusicIntensity(0);
    $('#start').hidden = true;
    $('#start').style.opacity = '';
    $('#hud').hidden = false;
    measureHud();
    updateHud();
    showTips();
    if (!S.pads) {
        setTimeout(() => bigText('RUN!', '#7af4ff'), 500);
        setTimeout(() => toast('⚡ Every step gives you Speed. Speed is what breaks glass!', '#ffffff'), 1600);
        setTimeout(() => toast('🪟 Run north, smash the panes, grab the Shards behind them', '#7dff6b'), 7000);
    } else toast('👋 Welcome back, ' + (S.name || 'runner') + '!', '#ffffff');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Tap anywhere for the sound!', '#7de8ff'); }, 3500);
    // the daily reward: straight away for someone back, after the first pad for someone new
    if (S.pads) setTimeout(offerDaily, 1500);
    canvas.focus();
    loadSecs = Math.round(performance.now() / 100) / 10;
    metaT = 8;
    BX.loadingEnd();
}
async function primeFrames() {
    $('#start').style.opacity = '0.985';
    $('#hud').hidden = false;
    try { await Promise.race([renderer.compileAsync(scene, camera), sleep(1500)]); } catch (e) { /* compiles on first use */ }
    for (let i = 0; i < 4; i++) await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 120); });
    const gl = renderer.getContext();
    if (!gl.fenceSync) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const t0 = performance.now();
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 1500) await sleep(15);
    gl.deleteSync(sync);
}
function showTips() {
    if (isTouch) return;
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = k('WASD', 'Run') + k('Space', 'Jump') + k('Drag', 'Camera') + k('E', 'Use') + k('T', 'Auto Run') + k('P', 'Glass Rush') + k('R', 'Back to spawn');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 12000);
    setTimeout(() => { el.hidden = true; }, 12900);
}
function unlockAudioOnGesture() {
    const unlock = () => { resumeAudio(); if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true); };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (running) spawnHome(); }
        else if (event === 'open_daily') openPanel('daily');
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { if (me) playEmoteOn(me.blox, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}
// The HUD's words and emoji painted for a few frames behind the loading screen, in the fonts and sizes
// the game uses: the first time a glyph (an emoji above all, on Windows) is drawn costs a long pause.
async function warmHudText() {
    const lines = [['🎁💎🔄👟🌈🌍⭐🎡🌿🏙️❄️🌋', 3.4], ['🔷👟🔄🎁🔒✅🎯💪🚧⚡🏃🎟️⚙️🔊👋🌈', 1.15], ['🛒📋🔄✨📅🌈🌍⚙️🎁💎🏃👟', 2.3], ['🔊🔇🏆🔥🎯✅⭐🎡🪟🔷🏁👑', 1.8], ['🥉🥈🥇💠🔒🌿🏙️❄️🌋⚡⏱💬👋🛍️', 1.4], ['🚧🏳️💪🎟️🚫⌛🔓✓✕−+', 2.6]];
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:3000px;opacity:0.01;pointer-events:none;z-index:1';
    d.innerHTML = lines.map(([em, s]) => `<div style="font-size:${s}rem;white-space:nowrap">${em}</div>`).join('')
        + [['var(--chunky)', 3, 400, 'o'], ['var(--chunky)', 2, 400, 'o'], ['var(--font)', 2.3, 700, 'o'], ['var(--font)', 1.1, 700, 'o1']]
            .map(([f, s, w, c]) => `<div class="${c}" style="font-family:${f};font-size:${s}rem;font-weight:${w};white-space:nowrap">Level Up! (→) SHARDS FOR FREE! X2 SPEED PLAY AUTO RUN: 0123456789 Progress Speed HP / K M B 1st 2nd 3rd GO!</div>`).join('');
    document.body.appendChild(d);
    for (let i = 0; i < 3; i++) await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 150); });
    d.remove();
    // and once in a canvas (name tags, chat bubbles and signs are drawn there)
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 140;
    const cx = cv.getContext('2d');
    for (const px of [40, 44, 52, 70, 76]) { cx.font = '700 ' + px + 'px Fredoka, "Arial Rounded MT Bold", sans-serif'; cx.fillText('💬🥉🥈🥇💠💎👑🔒🏆✓ Lv. 0123456789 Speed Shards', 4, 100); }
}
async function prepareWorld() {
    const step = (t, k) => { loadingText(t); BX.loadingStep(t); if (k) $('#loadBar').style.width = Math.round(k * 100) + '%'; };
    step('Loading fonts…', 0.08);
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('400 40px "Luckiest Guy"')]), sleep(2500)]); } catch (e) { /* fallback font */ }
    await warmHudText();
    step('Polishing the panes…', 0.18);
    initShards(getQuality() === 'low' ? 700 : 1800);
    buildView(0);
    SH.initShadows();
    await pause();
    step('Tuning the sound of breaking glass…', 0.36);
    await buildAsmr(pause);
    prerenderMusic();
    // every HUD screen and panel painted once, invisibly (the browser compiles how to draw them now)
    step('Lacing up the sneakers…', 0.55);
    {
        const hud = $('#hud');
        hud.hidden = false; hud.classList.add('warmui');
        measureHud();
        const endPanels = warmPanels();
        for (let i = 0; i < 4; i++) await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 120); });
        endPanels();
        hud.classList.remove('warmui'); hud.hidden = true;
    }
    // the warm-up: every shader the game uses (scenery plain and batched, the glass, the shards, every effect)
    // compiled and drawn once now, not in play
    step('Warming up the treadmills…', 0.75);
    const extras = [fxWarmGroup(), glassWarmGroup()];
    for (const g of extras) { g.position.set(0, -60, 0); scene.add(g); }
    view.setPane(0);
    try {
        const base = await Promise.race([loadBase(), sleep(4000)]);
        const a = base ? await createAvatar(null) : null;
        if (a) { a.root.position.set(0, -60, 10); a.update(1 / 60, { t: 0 }); scene.add(a.root); extras.push(a.root); }
    } catch (e) { /* the avatar's shaders compile when it first shows */ }
    fxShowAll(true);
    camera.position.set(0, 60, 130); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    gpuName();
    try { await Promise.race([renderer.compileAsync(scene, camera), sleep(1500)]); } catch (e) { /* later */ }
    const culled = [];
    scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    render();
    for (const o of culled) o.frustumCulled = true;
    await pause();
    fxShowAll(false);
    glassWarmDone();
    for (const g of extras) scene.remove(g);
    setMood(WORLDS[view.w].mood, true);
    paneFog(); shardFog();
    console.info('[prewarm] ready,', renderer.info.programs.length, 'shaders');
}
async function boot() {
    installIcons();
    BX.initBloxity();
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    addEventListener('pagehide', () => { try { if (net.room) net.room.leave(true); } catch (e) { /* closing anyway */ } });
    $('#retryBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// =====================================================================================
// The pilot: Auto Run for players (it runs the loop for you: treadmill when you're slow, the Run, the pad, the next
// sneakers), and QA's autopilot. It speaks in world directions; the camera turns them, so that's undone here.
// =====================================================================================
function mapInput(o) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const f = o.mx * fx + o.mz * fz, r = o.mx * rx + o.mz * rz;
    return { mx: fx * f + rx * r, mz: fz * f + rz * r, jump: o.jump, hold: o.hold };
}
let rushAim = 0, rushAimAt = 0, rushRow = -1;
function pilot() {
    const b = P.b, out = { mx: 0, mz: 0, jump: false, hold: false };
    if (!view || switching) return out;
    let tgt = null;
    if (R) {
        if (R.phase === 'ready') return out;
        const row = R.layout.rows[R.row];
        if (!row) tgt = { x: b.x, z: R.layout.finish - 10 };
        else {
            // the pane it can get through soonest: chosen once a row, again only if someone else's hole opens up
            if (rushRow !== row.i || clockT > rushAimAt) {
                rushRow = row.i; rushAimAt = clockT + 0.5;
                let bv = 1e18;
                for (const p of row.panes) {
                    if (p.kind === 'steel') continue;
                    const mid = (p.x0 + p.x1) / 2, v = (R.hp[row.i][p.c] / R.power) + Math.abs(mid - b.x) / 26 + (p.kind === 'gold' ? -0.3 : 0);
                    if (v < bv) { bv = v; rushAim = row.boss ? clamp(b.x, -20, 20) : mid; }
                }
            }
            tgt = { x: rushAim, z: row.z - 8 };
        }
    } else {
        const Tw = view.T, pn = Tw.panes[P.pane], inRun = b.z < W.front;
        const clearedStage = Math.floor(P.pane / 5) - 1;
        if (!inRun) {
            const nx = SHOES[S.shoes], topT = [...treads].filter((x) => x.reb <= S.rebirths).pop();
            const goal = Tw.panes[Math.min(Tw.n - 1, Math.min(5, (S.best[Tw.w] || 0)) * 5 + 4)];
            const train = P.trainT < 22 && S.speed < goal.hp / 5;
            if (nx && S.shards >= nx.shards) tgt = shoePads[S.shoes];
            else if (P.tread || train) {
                if (!P.tread) tgt = { x: topT.x, z: topT.z + topT.l / 2 + 4, via: topT };
                if (P.tread && !train) tgt = { x: 0, z: W.front - 6 };
                if (!P.tread && Math.abs(b.x - topT.x) < 2 && b.z < topT.z + topT.l / 2 + 6) tgt = { x: topT.x, z: topT.z };
                if (!P.tread && treadAt(b.x, b.z)) tgt = null;
            } else tgt = { x: 0, z: W.front - 6 };
            if (!train && P.trainT >= 22 && !P.tread) P.trainT = 0;
        } else if (pn) {
            const secs = P.hp / smashRate(S.speed);
            if (secs > 9 && clearedStage >= 0) tgt = Tw.stages[clearedStage].pad;
            else tgt = { x: clamp(b.x, -6, 4), z: pn.z - 4 };
        } else tgt = Tw.stages[Tw.stages.length - 1].pad;
    }
    if (tgt) {
        const dx = tgt.x - b.x, dz = tgt.z - b.z, d = Math.hypot(dx, dz);
        if (d > 1) { out.mx = dx / d; out.mz = dz / d; }
    }
    return mapInput(out);
}
actions.pilot = pilot;
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        P, S, cam, net, scene, camera, renderer: () => renderer, audio: () => audioDebug(), actions, view: () => view, race: () => R,
        state: () => {
            const Tw = view && view.T;
            return { world: S.world, x: +P.b.x.toFixed(2), y: +P.b.y.toFixed(2), z: +P.b.z.toFixed(2), onGround: P.b.onGround, pane: P.pane, hp: Math.round(P.hp), pushing: P.pushing, tread: P.tread && P.tread.mult, speed: Math.round(S.speed), shards: S.shards, gems: S.gems, lv: S.lv, xp: S.xp, rebirths: S.rebirths, shoes: S.shoes, best: S.best, pads: S.pads, panes: S.panes, rushes: S.rushes, rushWins: S.rushWins, queued: !!S.queued, snaps: P.snaps, programs: renderer.info.programs.length, prompt: activePrompt && activePrompt.label(), q: getQuality(), others: remotes.size, n: Tw ? Tw.n : 0, race: R ? { id: R.id, phase: R.phase, row: R.row, rows: R.layout.rows.length, w: R.w, lv: R.lv, place: R.place, smashed: R.smashed, z: +P.b.z.toFixed(1), finish: R.layout.finish } : null };
        },
        auto: (on) => { P.auto = on === false ? null : pilot; },
        key: (code, down) => { keys[code] = !!down; if (down && code === 'Space') P.jumpPress = clockT; },
        jump: () => { P.jumpPress = clockT; },
        teleport: (x, y, z, yaw, pane) => { net.send('qa', { tp: [x, y, z], pane }); if (pane !== undefined) setPane(pane); teleport(x, y, z, yaw); },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; if (dist !== undefined) cam.dist = dist; },
        quality: (q) => setQuality(q),
        give: (o) => net.send('qa', o),
        send: (type, m) => net.send(type, m || {}),
        panel: (k, tab) => openPanel(k, tab),
        close: () => { let n = 0; while (closeTop() && n < 9) n++; return n; },
        world: (w) => switchWorld(w, W.spawn.x, W.spawn.z),
        play: (map) => net.send('play', map !== undefined ? { map } : {}),
        perf: (reset) => { const r = { frames: perf.n, avgMs: +(perf.sum / Math.max(1, perf.n)).toFixed(2), maxMs: +perf.max.toFixed(1), fps: lastFps, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; if (reset) { perf.n = 0; perf.sum = 0; perf.max = 0; } return r; },
        diag: () => { renderer.info.reset(); renderer.info.autoReset = false; render(); const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio: renderer.getPixelRatio(), programs: renderer.info.programs.length }; renderer.info.autoReset = true; return r; },
        errors: () => [...errSeen],
        noWatch: (on) => { watchOff = on === undefined ? true : !!on; },
        hud: (on) => { $('#hud').style.display = on ? '' : 'none'; $('#touch').style.display = on ? '' : 'none'; },
        mood: (m) => setMood(m, true),
        res: (k) => setResScale(k),
        gpu: () => gpuName(),
        spikes: () => spikes.splice(0),
        slow: () => slowParts.splice(0),
        sections: () => { const n = secAvg.n || 1, o = {}; for (const k in secAvg) if (k !== 'n') o[k] = +(secAvg[k] / n).toFixed(2); secAvg = {}; return o; },
        avatars: () => avatarsPending(),
        toggle: (what, on) => { if (what === 'floaters') window.__noFloat = !on; if (what === 'shadows') sun.castShadow = !!on; if (what === 'points') scene.traverse((o) => { if (o.isPoints) o.visible = !!on; }); if (what === 'world' && view) view.group.visible = !!on; if (what === 'chars') { if (me) me.root.visible = !!on; for (const r of remotes.values()) r.char.root.visible = !!on; } },
    };
}
void T; void QUESTS; void TREADS; void worldOpen; void treads;
