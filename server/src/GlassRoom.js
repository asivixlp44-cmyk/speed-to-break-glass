import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, saveSoon, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import { Rush } from './Rush.js';
import {
    CFG, WORLDS, SHOES, TRAILS, trailById, AURAS, auraById, SPIN, spinPrize, rebirthCost, moveSpeed, smashRate, perStep, xpNeed, paneXp, padXp, worldOpen, stageValue,
    rankOf, TASKS, tasksFor, dayKey, QUESTS, DAILY, dailyStatus, GIFTS, CODES, PACKS, packShards, rewardText, clamp, fmt, BOT_NAMES, PANES_PER_WORLD, STAGES_PER_WORLD,
} from '../../shared/config.js';
import { W, worldFor, stageAt, onPad, treadAt, shoePads, treads, hubChest } from '../../shared/world.js';
import { KINDS } from '../../shared/rush.js';
import { newBody, stepBody } from '../../shared/physics.js';

const GREEN = '#7dff6b', GOLD = '#ffd028', RED = '#ff9a8a';
const cleanName = (name) => String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
const randomName = () => 'Runner' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d) => (finite(v) ? v : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const r1 = (v) => Math.round(v * 10) / 10;
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const trailIdx = Object.fromEntries(TRAILS.map((s, i) => [s.id, i]));
const auraIdx = Object.fromEntries(AURAS.map((s, i) => [s.id, i]));
// one token per gap, up to 3 saved: steps that arrive bunched (a hiccup in the network) still count
function takeToken(o, now, gap) {
    o.tokens = Math.min(3, (o.tokens ?? 3) + (now - (o.tokAt || now)) / (gap * 1000));
    o.tokAt = now;
    if (o.tokens < 1) return false;
    o.tokens -= 1;
    return true;
}
// how long a position may stay past a pane the server hasn't seen break yet (they break it on their own screen first)
const OVERRUN_MS = 900;

export const liveRooms = new Set();

// One server: up to 16 players running round the same worlds and racing each other (a few bots keep it lively when
// it's quiet). Moving is client-side; every step, every pane, every Shard and everything that earns or costs
// anything is counted and checked here.
export class GlassRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.bots = [];
        this.rush = new Rush(this);
        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('ping', (client, m) => client.send('pong', { c: num(m.c, 0), s: Date.now() }));
        on('move', this.onMove);
        on('step', this.onStep);
        on('pad', this.onPad);
        on('chest', this.onChest);
        on('shoe', this.onShoe);
        on('rebirth', this.onRebirth);
        on('world', this.onWorld);
        on('play', this.onPlay);
        on('unplay', this.onUnplay);
        on('quit', this.onQuit);
        on('spin', this.onSpin);
        on('buytrail', this.onBuyTrail);
        on('trail', this.onTrail);
        on('buyaura', this.onBuyAura);
        on('aura', this.onAura);
        on('pack', this.onPack);
        on('x2', this.onX2);
        on('tclaim', this.onTaskClaim);
        on('daily', this.onDaily);
        on('gift', this.onGift);
        on('code', this.onCode);
        on('tut', this.onTut);
        on('meta', this.onMeta);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        // QA only (QA=1, never on Legion): give yourself Speed, Shards, Gems, levels...
        if (process.env.QA === '1' && !process.env.BLOXITY_GAME_ID) on('qa', this.onQa);
        this.lastTick = Date.now();
        this.secAcc = 0;
        this.setSimulationInterval(() => this.update(), 50);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.fillBots();
    }

    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup (never with a database)
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        kickOthers(uid, null);
        const player = new PlayerState();
        player.name = profile.name;
        player.pid = this.freePid();
        player.av = cleanAvatar(options.av);
        const now = Date.now();
        Object.assign(player, { x: W.spawn.x + rnd(-4, 4), y: 0, z: W.spawn.z, ry: Math.PI, t: now, world: profile.world || 0 });
        this.state.players.set(client.sessionId, player);
        profile.lastSeen = now;
        const s = {
            id: client.sessionId, client, profile, player, guest, joinedAt: now, lastChat: 0, playSecs: 0, dirtyAt: 0, sealAt: 0,
            gifts: {}, last: { x: player.x, y: 0, z: player.z }, lastAt: now, snapAt: 0, movedAt: 0, spinSecs: 0, match: null, racer: null, queued: false,
            // the Run: the pane you're up to and how much health it has left
            pane: 0, paneHp: 0, pushAt: 0, over: 0,
            stats: {
                fresh: now - (profile.firstPlay || 0) < 60000, steps: 0, shards: 0, pads: 0, best: 0, panes: 0, races: 0, buys: 0, lv0: profile.lv, rb0: profile.rebirths,
                touch: false, fps: 0, fpsSum: 0, fpsN: 0, fpsMin: 0, q: '', gpu: '', load: 0, dev: null, errs: [], firstPadAt: 0,
            },
        };
        this.sessions.set(client.sessionId, s);
        this.resetRun(s);
        this.syncPublic(s);
        client.send('hello', { now, bloxity: uid.startsWith('legion_') });
        this.sendProfile(s, true);
        this.broadcastBoards(client);
        this.fillBots();
    }
    freePid() {
        const used = new Set([...this.state.players.values()].map((p) => p.pid));
        for (let i = 1; i < 255; i++) if (!used.has(i)) return i;
        return 255;
    }
    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['speed', 'topSpeed', 'totalSteps', 'shards', 'totalShards', 'gems', 'xp', 'rebirths', 'shoes', 'spins', 'spinsUsed', 'tread', 'pads', 'panes', 'rushes', 'rushWins', 'podium', 'playtime', 'lastSeen', 'qi', 'tut', 'x2Until', 'world']) if (!finite(p[k]) || p[k] < 0) p[k] = 0;
        p.gems = Math.floor(p.gems);
        p.lv = clamp(Math.floor(num(p.lv, 1)), 1, 9999);
        p.qi = clamp(Math.floor(p.qi), 0, QUESTS.length);
        p.shoes = clamp(Math.floor(p.shoes), 0, SHOES.length);
        p.world = clamp(Math.floor(p.world), 0, WORLDS.length - 1);
        p.best = WORLDS.map((w, i) => clamp(Math.floor(num(arr(p.best)[i], 0)), 0, STAGES_PER_WORLD));
        if (!worldOpen(p, p.world)) p.world = 0;
        for (const k of ['daily', 'codes', 'seen', 'jq', 'chests']) p[k] = obj(p[k]);
        p.trails = [...new Set(['none', ...arr(p.trails).filter((x) => trailById[x])])];
        if (!p.trails.includes(p.trail)) p.trail = 'none';
        p.auras = [...new Set(['none', ...arr(p.auras).filter((x) => auraById[x])])];
        if (!p.auras.includes(p.aura)) p.aura = 'none';
        p.jq = { day: String(p.jq.day || ''), list: arr(p.jq.list).slice(0, 3).map((q) => ({ k: String(q.k), p: Math.max(0, num(q.p, 0)), c: !!q.c })).filter((q) => TASKS[q.k]) };
        if (!finite(p.firstPlay)) p.firstPlay = Date.now();
    }

    onDrop(client) {
        const s = this.sessions.get(client.sessionId);
        // dropped mid-race: a bot takes over at once (if they come back they're home, the race went on without them)
        if (s && (s.match || s.queued)) { s.droppedRace = !!s.match; this.rush.leave(s, true); }
        this.allowReconnection(client, 30).catch(() => {});
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        if (s.droppedRace) { s.droppedRace = false; this.sendHome(s, 'rushBack', {}); }
        this.sendProfile(s, true);
        this.broadcastBoards(client);
    }
    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        if (s) this.rush.leave(s, true);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        this.fillBots();
        if (!s) return;
        const p = s.profile, st = s.stats;
        p.lastSeen = Date.now();
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, touch: st.touch,
            fps: st.fpsN ? Math.round(st.fpsSum / st.fpsN) : st.fps, fpsMin: st.fpsMin, q: st.q, gpu: st.gpu, load: st.load, dev: st.dev, errs: st.errs,
            steps: st.steps, shards: st.shards, pads: st.pads, best: st.best, panes: st.panes, races: st.races, buys: st.buys, lv0: st.lv0, lv: p.lv, rb0: st.rb0, rb: p.rebirths,
            firstPad: st.firstPadAt ? Math.round((st.firstPadAt - s.joinedAt) / 1000) : -1, shoes: p.shoes, qi: p.qi,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(p.uid)) releaseProfile(p.uid, isOnline);
    }
    onDispose() {
        liveRooms.delete(this);
        for (const s of this.sessions.values()) s.profile.lastSeen = Date.now();
        markDirty();
        return saveProfiles();
    }

    // ----- helpers -----
    sendTo(s, type, msg) { try { if (s) s.client.send(type, msg); } catch (e) { /* gone */ } }
    syncPublic(s) {
        const p = s.profile, pl = s.player;
        pl.name = p.name; pl.lv = p.lv; pl.tr = p.totalShards; pl.world = p.world; pl.shoes = p.shoes;
        if (!s.match) pl.prog = clamp(s.pane, 0, 255);
        pl.trail = trailIdx[p.trail] || 0; pl.aura = auraIdx[p.aura] || 0;
    }
    x2On(p, now) { return (p.x2Until || 0) > (now || Date.now()); }
    // The player's private progress: straight away for anything they clicked on, at most four times a
    // second otherwise (dirty())
    sendProfile(s, seal) {
        const p = s.profile, now = Date.now();
        s.dirtyAt = 0;
        this.jqOf(p, now);
        this.checkQuests(s);
        const m = {
            speed: r1(p.speed), topSpeed: r1(p.topSpeed), totalSteps: p.totalSteps, shards: Math.floor(p.shards), totalShards: Math.floor(p.totalShards), gems: p.gems,
            xp: Math.floor(p.xp), lv: p.lv, need: xpNeed(p.lv), rebirths: p.rebirths, shoes: p.shoes, best: p.best, stage: stageValue(p),
            spins: p.spins, spinIn: Math.max(0, CFG.spinMins * 60 - s.spinSecs), tread: p.tread, pads: p.pads, panes: p.panes, rushes: p.rushes, rushWins: p.rushWins, podium: p.podium, world: p.world,
            trails: p.trails, trail: p.trail, auras: p.auras, aura: p.aura, chests: p.chests, x2Until: p.x2Until, x2sUntil: p.x2sUntil,
            qi: p.qi, qv: p.qi < QUESTS.length ? this.questValue(p, QUESTS[p.qi].kind) : 0, jq: p.jq, daily: p.daily, codes: p.codes,
            gifts: s.gifts, sessionSecs: s.playSecs, playtime: p.playtime, tut: p.tut, seen: p.seen, firstPlay: p.firstPlay, now,
        };
        if (!USE_DB && (seal || now - s.sealAt > 10000)) { s.sealAt = now; m.save = sealProfile(p); }
        this.sendTo(s, 'profile', m);
    }
    dirty(s) { if (!s.dirtyAt) s.dirtyAt = Date.now(); markDirty(); }
    changed(s) { this.syncPublic(s); this.sendProfile(s); saveSoon(); }
    toast(s, text, color) { this.sendTo(s, 'toast', { text, color: color || '#ffffff' }); }
    broke(s, need, name, cur) { this.sendTo(s, 'broke', { need: Math.ceil(need), name, cur }); }
    payShards(s, n, name) { const p = s.profile; if (p.shards < n) { this.broke(s, n - p.shards, name, 'shards'); return false; } p.shards -= n; s.stats.buys++; return true; }
    payGems(s, n, name) { const p = s.profile; if (p.gems < n) { this.broke(s, n - p.gems, name, 'gems'); return false; } p.gems -= n; s.stats.buys++; return true; }
    giveSpeed(s, n) { const p = s.profile; p.speed += n; if (p.speed > p.topSpeed) p.topSpeed = p.speed; }
    giveReward(s, r, why) {
        const p = s.profile;
        if (r.speed) this.giveSpeed(s, r.speed);
        if (r.shards) this.addShards(s, r.shards);
        if (r.gems) p.gems += r.gems;
        if (r.spins) p.spins += r.spins;
        if (r.x2) p.x2Until = Math.max(Date.now(), p.x2Until || 0) + r.x2 * 60000;
        if (why) this.sendTo(s, 'reward', { text: rewardText(r), why, gems: r.gems || 0 });
    }
    addShards(s, n) {
        const p = s.profile, before = rankOf(p.totalShards);
        p.shards += n; p.totalShards += n; s.stats.shards += n;
        this.task(s, 'shards', n);
        const after = rankOf(p.totalShards);
        if (after > before) this.sendTo(s, 'rankup', { rank: after });
    }
    addXp(s, n) {
        const p = s.profile;
        p.xp += n;
        let ups = 0;
        while (p.xp >= xpNeed(p.lv)) { p.xp -= xpNeed(p.lv); p.lv++; ups++; if (p.lv % 5 === 0) p.gems += 5; }
        if (ups) { this.task(s, 'levels', ups); this.sendTo(s, 'levelup', { lv: p.lv }); this.syncPublic(s); }
    }

    // ----- daily tasks, quests -----
    jqOf(p, now) {
        const d = dayKey(now);
        if (p.jq.day !== d) p.jq = { day: d, list: tasksFor(d).map((k) => ({ k, p: 0, c: false })) };
        return p.jq;
    }
    task(s, k, n, max) {
        const jq = this.jqOf(s.profile, Date.now());
        for (const q of jq.list) {
            if (q.k !== k || q.c) continue;
            const was = q.p;
            q.p = Math.min(TASKS[k].n, max ? Math.max(q.p, n) : q.p + n);
            if (was < TASKS[k].n && q.p >= TASKS[k].n) this.sendTo(s, 'taskdone', { k });
        }
        this.dirty(s);
    }
    questValue(p, kind) {
        if (kind === 'spins') return p.spinsUsed;
        if (kind === 'stage') return stageValue(p);
        if (kind === 'speed') return Math.floor(p.topSpeed);
        return p[kind] || 0;
    }
    // quests complete themselves: the reward straight away, the next goal on screen
    checkQuests(s) {
        const p = s.profile;
        if (p.qi >= QUESTS.length) return;
        const Q = QUESTS[p.qi];
        if (this.questValue(p, Q.kind) < Q.n) return;
        p.qi++;
        this.addXp(s, 6 + p.qi * 2);
        this.giveReward(s, Q, 'Quest complete!');
        this.sendTo(s, 'questdone', { qi: p.qi - 1 });
    }
    onTaskClaim(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const q = this.jqOf(s.profile, Date.now()).list[m.i | 0];
        if (!q || q.c || q.p < TASKS[q.k].n) return;
        q.c = true;
        this.giveReward(s, TASKS[q.k], 'Daily task done!');
        this.changed(s);
    }

    // ----- 20 times a second: the panes, the bots, the races; every second: playtime, free spins -----
    update() {
        const now = Date.now(), dt = Math.min(0.1, (now - this.lastTick) / 1000);
        this.lastTick = now;
        this.state.now = now;
        for (const b of this.bots) this.driveBot(b, now, dt);
        for (const s of this.sessions.values()) if (!s.match) this.runPane(s, now, dt);
        this.rush.update(now, dt);
        this.secAcc += dt;
        if (this.secAcc >= 1) { this.secAcc -= 1; this.tick(now); }
        for (const s of this.sessions.values()) if (s.dirtyAt && now - s.dirtyAt > 250) { this.syncPublic(s); this.sendProfile(s); }
    }
    tick(now) {
        for (const s of this.sessions.values()) {
            const p = s.profile;
            p.playtime = (p.playtime || 0) + 1;
            p.lastSeen = now;
            s.playSecs++;
            if (p.spins < CFG.spinMax) { s.spinSecs++; if (s.spinSecs >= CFG.spinMins * 60) { s.spinSecs = 0; p.spins++; this.toast(s, '🎡 A free spin is ready!', GOLD); this.dirty(s); } } else s.spinSecs = 0;
            const g = GIFTS.findIndex((x, i) => !s.gifts[i] && s.playSecs >= x.min * 60 && s.playSecs < x.min * 60 + 1);
            if (g >= 0) this.toast(s, '🎁 A FREE gift is ready!', GOLD);
        }
        markDirty();
    }

    // ----- the Run: a player's panes (your glass is yours: everyone else runs through their own) -----
    resetRun(s) {
        const T = worldFor(s.profile.world);
        s.pane = 0; s.paneHp = T.panes[0].hp; s.over = 0; s.pushAt = 0;
    }
    // at a standing pane you push it: its health goes at your Speed; leave it and it heals
    runPane(s, now, dt) {
        const T = worldFor(s.profile.world), pn = T.panes[s.pane];
        if (!pn) return;
        const L = s.last;
        if (L.z <= pn.z + W.touch + 0.6) {
            s.pushAt = now;
            s.paneHp -= smashRate(s.profile.speed) * dt;
            if (s.paneHp <= 0) this.paneDown(s, T, pn);
            else if (L.z < pn.z - 1) {
                // past the plane with the glass still up: a moment's grace (it breaks on their screen first)
                if (!s.over) s.over = now;
                else if (now - s.over > OVERRUN_MS) {
                    s.over = 0;
                    const z = pn.z + W.touch;
                    L.z = z;
                    this.sendTo(s, 'snap', { x: L.x, y: 0, z, pane: s.pane, hp: s.paneHp });
                    if (process.env.QA === '1') console.log('[snap] past pane', s.pane, s.profile.name);
                }
            }
        } else if (s.pushAt && now - s.pushAt > CFG.regenAfter * 1000) {
            s.paneHp = Math.min(pn.hp, s.paneHp + pn.hp * CFG.regenRate * dt);
            if (s.paneHp >= pn.hp) s.pushAt = 0;
        }
    }
    paneDown(s, T, pn) {
        const p = s.profile;
        s.over = 0;
        p.panes++; s.stats.panes++;
        this.task(s, 'panes', 1);
        this.addXp(s, paneXp(T.w, pn.i));
        s.pane = pn.i + 1;
        s.player.prog = clamp(s.pane, 0, 255);
        const nx = T.panes[s.pane];
        s.paneHp = nx ? nx.hp : 0;
        s.pushAt = 0;
        this.sendTo(s, 'pane', { i: s.pane });
        // the stage's last pane: it counts as cleared
        if (pn.j === T.stages[pn.k].last - T.stages[pn.k].first) {
            const was = p.best[T.w] || 0;
            if (pn.k + 1 > was) {
                p.best[T.w] = pn.k + 1;
                s.stats.best = Math.max(s.stats.best, stageValue(p));
                this.sendTo(s, 'stage', { k: pn.k, world: T.w, opens: pn.k + 1 === STAGES_PER_WORLD && T.w + 1 < WORLDS.length ? T.w + 1 : -1 });
            }
            this.task(s, 'stage', pn.k + 1, true);
        }
        this.dirty(s);
    }

    // ----- moving -----
    // where a player says they are: checked against how far they could have moved
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const now = Date.now(), p = s.profile, T = worldFor(p.world), L = s.last;
        const dt = Math.max(0.05, Math.min(1.5, (now - s.lastAt) / 1000));
        s.lastAt = now;
        const pl = s.player;
        const accept = () => {
            pl.x = m.x; pl.y = m.y; pl.z = m.z; pl.ry = finite(m.ry) ? m.ry : 0; pl.anim = finite(m.a) ? clamp(m.a | 0, 0, 3) : 0;
            pl.t = finite(m.ts) ? clamp(m.ts, now - 1500, now + 50) : now;
        };
        if (s.match) {
            if (!this.rush.move(s, m, dt)) { L.x = m.x; L.y = m.y; L.z = m.z; accept(); }
            return;
        }
        // just sent home (a pad, a rebirth, a world, a race): the moves still on their way from where they were
        // are dropped (no snap) until they arrive home
        if (s.homeAt) {
            if (now - s.homeAt < 5000 && Math.hypot(m.x - L.x, m.z - L.z) > 6) return;
            s.homeAt = 0;
        }
        const reach = (moveSpeed(p.speed) * 1.3 + 6) * dt + 5;
        if (Math.hypot(m.x - L.x, m.z - L.z) > reach || m.y > 40 || m.y < -10 || m.z < T.end - 3) {
            if (now - s.snapAt > 300) { s.snapAt = now; this.sendTo(s, 'snap', { x: L.x, y: L.y, z: L.z, pane: s.pane, hp: s.paneHp }); if (process.env.QA === '1') console.log('[snap]', p.name, 'from', [L.x, L.y, L.z].map((v) => +v.toFixed(1)), 'to', [m.x, m.y, m.z].map((v) => +v.toFixed(1)), 'dt', +dt.toFixed(2)); }
            return;
        }
        if ((m.x - L.x) ** 2 + (m.z - L.z) ** 2 > 0.01) s.movedAt = now;
        // back at the spawn: the panes are back up
        if (m.z > W.front + 2 && L.z <= W.front + 2 && s.pane > 0) { this.resetRun(s); this.sendTo(s, 'runreset', {}); }
        L.x = m.x; L.y = m.y; L.z = m.z;
        accept();
    }
    // a step: Speed (x the treadmill you're on, x2 when boosted). It has to be a real one: you moved just now, you're
    // pushing a pane, or you're on a treadmill that's open to you
    onStep(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.match) return;
        const now = Date.now(), p = s.profile, L = s.last;
        let mult = 1, gap = CFG.stepGap;
        if (m.tread) {
            const t = treadAt(L.x, L.z);
            if (!t || p.rebirths < t.reb) return;
            mult = t.mult; gap = CFG.treadGap;
            p.tread++; this.task(s, 'tread', 1);
        } else if (now - s.movedAt > 1200 && now - s.pushAt > 1200) return;
        if (!takeToken(s, now, gap)) return;
        this.giveSpeed(s, perStep(p, mult, this.x2On(p, now)));
        p.totalSteps++; s.stats.steps++;
        this.task(s, 'steps', 1);
        this.dirty(s);
    }
    // a Shard Pad behind a stage: its Shards, and home
    onPad(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.match) return;
        const p = s.profile, T = worldFor(p.world), k = m.k | 0, st = T.stages[k], L = s.last;
        if (!st || s.pane <= st.last || !onPad(T, k, L.x, L.z)) return;
        const x2 = (p.x2sUntil || 0) > Date.now(), n = st.pad.shards * (x2 ? 2 : 1);
        this.addShards(s, n);
        this.addXp(s, padXp(T.w, k));
        p.pads++; s.stats.pads++;
        if (!s.stats.firstPadAt) s.stats.firstPadAt = Date.now();
        this.task(s, 'pads', 1);
        this.sendHome(s, 'padok', { k, n });
        this.changed(s);
    }
    sendHome(s, type, msg) {
        const sx = W.spawn.x + rnd(-5, 5);
        this.resetRun(s);
        s.last = { x: sx, y: 0, z: W.spawn.z }; s.homeAt = Date.now(); s.lastAt = Date.now();
        s.player.prog = 0;
        this.sendTo(s, type, { ...msg, x: sx, z: W.spawn.z });
    }
    // the FREE chest at the spawn: a gift, every 15 minutes
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.match) return;
        const p = s.profile, L = s.last, now = Date.now(), key = 'hub';
        if ((L.x - hubChest.x) ** 2 + (L.z - hubChest.z) ** 2 > 81) return;
        if ((p.chests[key] || 0) > now) return;
        p.chests[key] = now + CFG.chestMins * 60000;
        this.giveReward(s, { speed: Math.round(30 * perStep(p, 1, false)), gems: 3 + Math.floor(stageValue(p) / 3) }, 'FREE chest!');
        this.changed(s);
    }

    // ----- spending Shards: sneakers, rebirths, worlds, trails and auras -----
    onShoe(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.match) return;
        const p = s.profile, b = SHOES[p.shoes], pad = shoePads[p.shoes];
        if (!b) return;
        if (Math.hypot(s.last.x - pad.x, s.last.z - pad.z) > pad.r + 2) { this.toast(s, 'Walk onto the sneaker pad to buy them', RED); return; }
        if (!this.payShards(s, b.shards, b.name)) return;
        p.shoes++;
        this.sendTo(s, 'bought', { what: 'shoe', i: p.shoes - 1 });
        this.changed(s);
    }
    onRebirth(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.match) return;
        const p = s.profile, cost = rebirthCost(p.rebirths);
        if (!this.payShards(s, cost, 'Rebirth')) return;
        p.rebirths++; p.speed = 0;
        this.sendHome(s, 'reborn', { r: p.rebirths });
        this.changed(s);
    }
    onWorld(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.match) return;
        const p = s.profile, w = clamp(m.w | 0, 0, WORLDS.length - 1);
        if (!worldOpen(p, w)) { this.toast(s, '🔒 Clear the last stage of ' + WORLDS[w - 1].name + ' first', RED); return; }
        p.world = w;
        this.sendHome(s, 'warp', { w });
        this.changed(s);
    }
    // ----- Glass Rush -----
    onPlay(client, m) { const s = this.sessions.get(client.sessionId); if (s) this.rush.press(s, m); }
    onUnplay(client) { const s = this.sessions.get(client.sessionId); if (s) this.rush.cancel(s); }
    onQuit(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !s.match) return;
        this.rush.leave(s, true);
        this.sendHome(s, 'rushBack', {});
        this.syncPublic(s);
    }
    onRushSmash(s, pn) {
        const p = s.profile;
        p.panes++; s.stats.panes++;
        this.task(s, 'panes', 1);
        this.addXp(s, 2 + (KINDS[pn.kind].xp || 1));
        this.dirty(s);
    }
    onRushEnd(s, r, prize, rows, mt) {
        const p = s.profile;
        p.rushes++; s.stats.races++;
        if (r.place === 0) p.rushWins++;
        if (r.place <= 2) p.podium++;
        this.task(s, 'rushes', 1);
        this.addShards(s, prize.shards);
        p.gems += prize.gems;
        this.addXp(s, prize.xp);
        this.sendHome(s, 'rushEnd', { rows, place: r.place, smashed: r.smashed, prize, lv: mt.lv });
        this.changed(s);
    }
    onSpin(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.spins < 1) return;
        p.spins--; p.spinsUsed++;
        let r = Math.random() * SPIN.reduce((a, x) => a + x.w, 0), i = 0;
        for (; i < SPIN.length - 1; i++) { r -= SPIN[i].w; if (r < 0) break; }
        const prize = spinPrize(SPIN[i], p);
        this.giveReward(s, prize);
        this.task(s, 'spins', 1);
        this.sendTo(s, 'spun', { i, text: rewardText(prize) });
        this.changed(s);
    }
    buyStyle(s, list, owned, k, kind) {
        if (!k || owned.includes(k.id)) return false;
        if (k.gems ? !this.payGems(s, k.gems, k.name) : !this.payShards(s, k.shards, k.name)) return false;
        owned.push(k.id);
        this.sendTo(s, 'bought', { what: kind, id: k.id });
        return true;
    }
    onBuyTrail(client, m) { const s = this.sessions.get(client.sessionId); if (s && this.buyStyle(s, TRAILS, s.profile.trails, trailById[m.id], 'trail')) { s.profile.trail = m.id; this.changed(s); } }
    onTrail(client, m) { const s = this.sessions.get(client.sessionId); if (s && s.profile.trails.includes(m.id)) { s.profile.trail = m.id; this.changed(s); } }
    onBuyAura(client, m) { const s = this.sessions.get(client.sessionId); if (s && this.buyStyle(s, AURAS, s.profile.auras, auraById[m.id], 'aura')) { s.profile.aura = m.id; this.changed(s); } }
    onAura(client, m) { const s = this.sessions.get(client.sessionId); if (s && s.profile.auras.includes(m.id)) { s.profile.aura = m.id; this.changed(s); } }
    onPack(client, m) {
        const s = this.sessions.get(client.sessionId), k = s && PACKS.find((x) => x.id === m.id);
        if (!k) return;
        const n = packShards(k, s.profile);
        if (!this.payGems(s, k.gems, fmt(n) + ' Shards')) return;
        this.addShards(s, n);
        this.toast(s, '+' + fmt(n) + ' Shards!', GOLD);
        this.changed(s);
    }
    // x2 Speed or x2 Shards, for a while
    onX2(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, shards = m.kind === 'shards', key = shards ? 'x2sUntil' : 'x2Until';
        if (!this.payGems(s, shards ? CFG.x2ShardsGems : CFG.x2SpeedGems, shards ? 'x2 Shards' : 'x2 Speed')) return;
        p[key] = Math.max(Date.now(), p[key] || 0) + CFG.x2Mins * 60000;
        this.toast(s, (shards ? 'x2 Shards' : 'x2 Speed') + ' for ' + CFG.x2Mins + ' minutes!', GOLD);
        this.changed(s);
    }

    // ----- rewards -----
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now(), st = dailyStatus(p.daily, now);
        if (!st.can) return;
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, DAILY[st.day], 'Daily reward: day ' + (st.day + 1) + '!');
        this.changed(s);
    }
    onGift(client, m) {
        const s = this.sessions.get(client.sessionId), i = m.i | 0, g = GIFTS[i];
        if (!s || !g || s.gifts[i] || s.playSecs < g.min * 60 - 2) return;
        s.gifts[i] = true;
        this.giveReward(s, g, 'FREE gift!');
        this.changed(s);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 20), r = CODES[code];
        if (!r) { this.sendTo(s, 'code', { ok: false, text: 'That code doesn\'t work' }); return; }
        if (s.profile.codes[code]) { this.sendTo(s, 'code', { ok: false, text: 'You already used that code' }); return; }
        s.profile.codes[code] = true;
        this.giveReward(s, r);
        this.sendTo(s, 'code', { ok: true, text: 'Code redeemed: ' + rewardText(r, true) });
        this.changed(s);
    }
    onTut(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        if (finite(m.tut)) s.profile.tut = clamp(Math.max(s.profile.tut, m.tut | 0), 0, 99);
        if (typeof m.seen === 'string' && m.seen.length < 24) s.profile.seen[m.seen] = 1;
        this.dirty(s);
    }
    onMeta(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const st = s.stats;
        if (typeof m.touch === 'boolean') st.touch = m.touch;
        if (finite(m.fps)) { const f = clamp(Math.round(m.fps), 0, 240); st.fps = f; st.fpsSum += f; st.fpsN++; st.fpsMin = st.fpsN === 1 ? f : Math.min(st.fpsMin, f); }
        if (typeof m.q === 'string') st.q = m.q.slice(0, 8);
        if (typeof m.gpu === 'string' && !st.gpu) st.gpu = m.gpu.slice(0, 90);
        if (finite(m.load) && !st.load) st.load = clamp(Math.round(m.load * 10) / 10, 0, 600);
        if (!st.dev && finite(m.w)) st.dev = { w: clamp(m.w | 0, 0, 9999), h: clamp(m.h | 0, 0, 9999), dpr: clamp(num(m.dpr, 1), 0, 8), cores: clamp(m.cores | 0, 0, 256), mem: clamp(num(m.mem, 0), 0, 1024) };
        for (const e of arr(m.errs).slice(0, 5)) if (typeof e === 'string' && st.errs.length < 8) st.errs.push(e.slice(0, 220));
    }
    broadcastBoards(client) {
        const row = (key, v) => topProfiles(key).filter((p) => v(p) > 0).map((p) => ({ n: p.name, v: v(p) }));
        const m = { shards: row('totalShards', (p) => Math.floor(p.totalShards || 0)), speed: row('topSpeed', (p) => Math.floor(p.topSpeed || 0)), rush: row('rushWins', (p) => p.rushWins | 0) };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }
    onQa(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (finite(m.speed)) { p.speed = Math.max(0, p.speed + m.speed); p.topSpeed = Math.max(p.topSpeed, p.speed); }
        if (finite(m.setSpeed)) { p.speed = Math.max(0, m.setSpeed); p.topSpeed = Math.max(p.topSpeed, p.speed); }
        if (finite(m.shards)) { p.shards += m.shards; p.totalShards += Math.max(0, m.shards); }
        if (finite(m.gems)) p.gems += m.gems;
        if (finite(m.lv)) { p.lv = clamp(m.lv | 0, 1, 999); p.xp = 0; }
        if (finite(m.xp)) this.addXp(s, m.xp);
        if (finite(m.rebirths)) p.rebirths = clamp(m.rebirths | 0, 0, 99);
        if (finite(m.shoes)) p.shoes = clamp(m.shoes | 0, 0, SHOES.length);
        if (finite(m.spins)) p.spins = clamp(m.spins | 0, 0, 99);
        if (finite(m.qi)) p.qi = clamp(m.qi | 0, 0, QUESTS.length);
        if (finite(m.playSecs)) s.playSecs = m.playSecs | 0;
        if (Array.isArray(m.best)) p.best = WORLDS.map((w, i) => clamp(m.best[i] | 0, 0, STAGES_PER_WORLD));
        if (m.tasks) { const jq = this.jqOf(p, Date.now()); for (const q of jq.list) q.p = TASKS[q.k].n; }
        // a QA teleport: where the next move is checked from (and the pane it's up to)
        if (Array.isArray(m.tp) && m.tp.every(finite)) { s.last = { x: m.tp[0], y: m.tp[1], z: m.tp[2] }; s.lastAt = Date.now(); if (finite(m.pane)) { s.pane = clamp(m.pane | 0, 0, PANES_PER_WORLD); const pn = worldFor(p.world).panes[s.pane]; s.paneHp = pn ? pn.hp : 0; s.over = 0; } }
        this.changed(s);
    }

    // ----- the bots: a few runners about when it's quiet (each real player sends one home) -----
    fillBots() {
        const want = Math.max(0, CFG.bots - this.sessions.size);
        while (this.bots.length > want) { const b = this.bots.pop(); this.state.players.delete(b.id); }
        const used = new Set([...this.state.players.values()].map((p) => p.name));
        while (this.bots.length < want) {
            const id = 'bot' + Math.floor(Math.random() * 1e9);
            let name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
            for (let i = 0; used.has(name) && i < 20; i++) name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (i > 10 ? i : '');
            used.add(name);
            const lv = Math.floor(rnd(2, 22)), pl = new PlayerState();
            Object.assign(pl, { name, bot: true, pid: this.freePid(), lv, tr: Math.floor(rnd(5, 900)), x: rnd(-14, 14), y: 0, z: rnd(10, 50), t: Date.now(), world: 0, shoes: Math.floor(rnd(0, 9)), trail: Math.random() < 0.4 ? 1 + Math.floor(Math.random() * 6) : 0 });
            pl.av = JSON.stringify({ e: { skinId: String(Math.floor(Math.random() * 21)) }, p: { height: Math.round(rnd(0.92, 1.08) * 100) / 100 } });
            this.state.players.set(id, pl);
            const b = { id, pl, body: newBody(pl.x, 0, pl.z), lv, run: rnd(1.1, 1.8), goal: null, until: 0, mode: 'tread', tread: null };
            this.bots.push(b);
        }
    }
    driveBot(b, now, dt) {
        const T = worldFor(0), body = b.body, pl = b.pl;
        const inp = { mx: 0, mz: 0, jump: false, hold: false, power: CFG.jumpPower, speed: b.run };
        // what to do: a spell on a treadmill, then a run down the corridor as far as it feels like, then home
        if (!b.goal || now > b.until) {
            b.tread = null;
            if (b.mode === 'run' || Math.random() < 0.5) {
                b.mode = 'tread';
                const t = treads[Math.floor(Math.random() * 3)];
                b.goal = { x: t.x, z: t.z + t.l / 2 + 3 }; b.next = { x: t.x, z: t.z }; b.until = now + rnd(10000, 22000);
            } else {
                b.mode = 'run';
                const st = T.stages[Math.floor(rnd(0, 3))];
                b.goal = { x: st.pad.x, z: st.pad.z }; b.until = now + 40000;
            }
        }
        const dx = b.goal.x - body.x, dz = b.goal.z - body.z, d = Math.hypot(dx, dz);
        if (d > 1.2) { inp.mx = dx / d; inp.mz = dz / d; } else if (b.next) { b.goal = b.next; b.next = null; } else if (b.mode === 'run') {
            Object.assign(body, newBody(W.spawn.x + rnd(-6, 6), 0, W.spawn.z));
            b.goal = null;
        }
        stepBody(body, inp, dt, T.world);
        pl.x = body.x; pl.y = body.y; pl.z = body.z; pl.t = now;
        if (Math.abs(body.vx) + Math.abs(body.vz) > 1) pl.ry = Math.atan2(body.vx, body.vz);
        else if (b.mode === 'tread' && d <= 1.2 && !b.next) pl.ry = Math.PI;
        // on a treadmill it runs on the spot
        pl.anim = !body.onGround ? 2 : Math.abs(body.vx) + Math.abs(body.vz) > 2 || (b.mode === 'tread' && d <= 1.2 && !b.next) ? 1 : 0;
        const st = stageAt(T, body.z);
        pl.prog = st < 0 ? 0 : (st + 1) * 5;
    }

    // ----- Bloxity -----
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        guestProfile.lastSeen = Date.now();
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        kickOthers(uid, s);
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        s.profile.lastSeen = Date.now();
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(s);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) { const s = this.sessions.get(client.sessionId); if (s && m) s.player.av = cleanAvatar(m.av); }
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
}

// the same player somewhere else (another tab, another server): they leave there
function kickOthers(uid, keep) {
    for (const room of liveRooms) for (const o of room.sessions.values()) if (o.profile.uid === uid && o !== keep) { try { o.client.leave(4000); } catch (e) { /* gone */ } }
}
function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
