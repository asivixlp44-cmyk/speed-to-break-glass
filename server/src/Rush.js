// Glass Rush on the server: the queue (everyone who presses PLAY at about the same time goes in one race; it says
// how many were found), the start line (a late PLAY still takes a bot's place until the gun), the race itself (shared
// panes, every push of everyone counted here, a racer can't get past glass that's still standing), the finish, the
// prizes. Bots only fill the empty places, and take over from a player who leaves.
import { PlayerState } from './schema.js';
import { CFG, WORLDS, PLACES, rushInfo, rushPower, rushPrize, clamp, BOT_NAMES } from '../../shared/config.js';
import { RUSH, KINDS, rushLayout, paneIn, startX } from '../../shared/rush.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const BOT_SKIN = () => JSON.stringify({ e: { skinId: String(Math.floor(Math.random() * 21)) }, p: { height: Math.round(rnd(0.92, 1.08) * 100) / 100 } });
// how long a racer's reported position may stay past glass the server hasn't seen break yet (network jitter)
const OVERRUN_MS = 900;

export class Rush {
    constructor(room) {
        this.room = room;
        this.queue = null;
        this.matches = new Map();
        this.nextId = 1;
        // race maps take turns, so even a new player gets to see the later worlds
        this.nextMap = Math.floor(Math.random() * WORLDS.length);
    }
    send(s, type, m) { this.room.sendTo(s, type, m); }

    // ----- the queue -----
    press(s, m) {
        if (s.match) return;
        // a race on its start line takes you at once, in a bot's place
        for (const mt of this.matches.values()) if (mt.phase === 'ready' && mt.humans.size < mt.spots) { this.joinMatch(mt, s); return; }
        const now = Date.now();
        if (!this.queue) {
            const w = m && Number.isInteger(m.map) && process.env.QA === '1' && !process.env.BLOXITY_GAME_ID ? clamp(m.map, 0, WORLDS.length - 1) : (this.nextMap++) % WORLDS.length;
            this.queue = { list: [], startAt: now + CFG.rushQueue * 1000, w, sec: 0 };
        }
        const q = this.queue;
        if (!q.list.includes(s)) q.list.push(s);
        s.queued = true;
        if (q.list.length >= CFG.rushSpots) q.startAt = Math.min(q.startAt, now + CFG.rushFull * 1000);
        else if (q.list.length > 1) q.startAt = Math.max(q.startAt, now + 3000);
        this.tellQueue();
    }
    cancel(s) {
        const q = this.queue;
        if (!q || !q.list.includes(s)) return;
        q.list.splice(q.list.indexOf(s), 1);
        s.queued = false;
        this.send(s, 'rushQueue', { off: true });
        if (!q.list.length) this.queue = null; else this.tellQueue();
    }
    tellQueue() {
        const q = this.queue;
        if (!q) return;
        const lv = this.raceLevel(q.list), D = rushInfo(lv), msg = { found: q.list.length, spots: CFG.rushSpots, at: q.startAt, lv, rows: D.rows, map: q.w };
        for (const s of q.list) this.send(s, 'rushQueue', msg);
    }
    raceLevel(list) {
        if (!list.length) return 1;
        return Math.round(list.reduce((a, s) => a + s.profile.lv, 0) / list.length);
    }

    // ----- a race -----
    startMatch(q) {
        const now = Date.now(), lv = this.raceLevel(q.list), id = this.nextId++;
        const powers = q.list.map((s) => rushPower(s.profile.speed, s.profile.rebirths));
        const base = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length), seed = 1 + Math.floor(Math.random() * 2e9);
        const mt = {
            id, seed, lv, w: q.w, base, spots: CFG.rushSpots, phase: 'ready', goAt: now + CFG.rushReady * 1000, endAt: 0, wrapAt: 0,
            racers: [], humans: new Set(), order: 0, hits: new Map(), hitAt: 0,
            layout: rushLayout(seed, lv, base, CFG.rushSpots),
        };
        mt.hp = mt.layout.rows.map((r) => r.panes.map((p) => p.hp));
        this.matches.set(id, mt);
        // the players on the line first, bots in every empty place
        q.list.forEach((s, i) => this.addHuman(mt, s, i));
        for (let i = q.list.length; i < mt.spots; i++) this.addBot(mt, i, null);
        for (const r of mt.racers) if (r.s) { r.s.queued = false; this.sendStart(mt, r); }
        return mt;
    }
    addHuman(mt, s, spot) {
        const x = startX(spot, mt.spots), pw = rushPower(s.profile.speed, s.profile.rebirths);
        const r = { s, spot, power: pw, x, z: RUSH.startZ, row: 0, smashed: 0, place: -1, over: 0, id: s.id };
        mt.racers.push(r);
        mt.humans.add(s);
        s.match = mt; s.racer = r;
        s.player.match = mt.id; s.player.prog = 0;
        s.last = { x, y: 0, z: RUSH.startZ }; s.lastAt = Date.now(); s.homeAt = Date.now();
        return r;
    }
    addBot(mt, spot, from) {
        const id = 'rb' + mt.id + '_' + spot + '_' + Math.floor(Math.random() * 1e6), pl = new PlayerState();
        const taken = new Set(mt.racers.map((r) => r.name || (r.s && r.s.profile.name)));
        let name = from ? from.name : BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        for (let i = 0; !from && taken.has(name) && i < 20; i++) name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        const x = from ? from.x : startX(spot, mt.spots), z = from ? from.z : RUSH.startZ;
        Object.assign(pl, { name, bot: true, pid: this.room.freePid(), lv: from ? from.lv : Math.max(1, mt.lv + Math.round(rnd(-3, 3))), tr: from ? from.tr : rnd(5, 900), x, y: 0, z, ry: Math.PI, t: Date.now(), world: mt.w, match: mt.id, shoes: Math.floor(rnd(0, 8)), trail: Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 7) : 0 });
        pl.av = from && from.av ? from.av : BOT_SKIN();
        this.room.state.players.set(id, pl);
        const b = {
            s: null, id, pl, spot, name, power: Math.round(from ? from.power : mt.base * rnd(0.82, 1.08)), x, z, row: from ? from.row : 0, smashed: from ? from.smashed : 0, place: -1,
            skill: rnd(0.6, 0.95) + Math.min(0.2, mt.lv * 0.005), lane: x, reactAt: 0, pace: rnd(0.87, 1.01), off: rnd(-3.5, 3.5), boost: 0, boostAt: 0, stuck: 0,
        };
        mt.racers.push(b);
        return b;
    }
    // a late PLAY: the race hasn't started, so you take a bot's place on the line
    joinMatch(mt, s) {
        const bot = mt.racers.find((r) => !r.s);
        if (!bot) return;
        this.removeBot(mt, bot);
        if (this.queue && this.queue.list.includes(s)) this.cancel(s);
        const r = this.addHuman(mt, s, bot.spot);
        this.sendStart(mt, r);
        for (const o of mt.humans) if (o !== s) this.send(o, 'rushJoined', { name: s.profile.name, found: mt.humans.size });
    }
    removeBot(mt, b) {
        this.room.state.players.delete(b.id);
        mt.racers.splice(mt.racers.indexOf(b), 1);
    }
    sendStart(mt, r) {
        const pos = { x: startX(r.spot, mt.spots), z: RUSH.startZ };
        this.send(r.s, 'rushStart', { id: mt.id, seed: mt.seed, lv: mt.lv, w: mt.w, base: mt.base, n: mt.spots, spot: r.spot, x: pos.x, z: pos.z, goAt: mt.goAt, power: r.power, found: mt.humans.size });
        this.send(r.s, 'rushQueue', { off: true });
    }
    // a human leaves (quits or drops): a bot carries on from where they were
    leave(s, quit) {
        const mt = s.match, r = s.racer;
        if (this.queue && this.queue.list.includes(s)) this.cancel(s);
        if (!mt) return;
        mt.humans.delete(s);
        s.match = null; s.racer = null;
        if (s.player) { s.player.match = 0; s.player.prog = 0; }
        if (r) {
            mt.racers.splice(mt.racers.indexOf(r), 1);
            if (mt.phase !== 'done') {
                const b = this.addBot(mt, r.spot, { name: s.profile.name, x: r.x, z: r.z, lv: s.profile.lv, tr: s.profile.totalShards, power: r.power, row: r.row, smashed: r.smashed, av: s.player && s.player.av });
                b.place = r.place;
            }
        }
        if (!mt.humans.size) this.closeMatch(mt);
        else for (const o of mt.humans) if (quit) this.send(o, 'rushLeft', { name: s.profile.name });
        void quit;
    }
    closeMatch(mt) {
        for (const r of [...mt.racers]) if (!r.s) this.room.state.players.delete(r.id);
        this.matches.delete(mt.id);
    }

    // where a racer says they are: never past the line before the gun, never faster than the fastest run, never
    // through glass that's standing (a little grace: they break it on their screen a moment before it's seen here)
    move(s, m, dt) {
        const mt = s.match, r = s.racer, L = s.last, now = Date.now();
        if (s.homeAt) {
            if (now - s.homeAt < 5000 && Math.hypot(m.x - L.x, m.z - L.z) > 8) return true;
            s.homeAt = 0;
        }
        const reach = (CFG.rushRunMax * 1.3 + 6) * dt + 5;
        let bad = Math.hypot(m.x - L.x, m.z - L.z) > reach || Math.abs(m.x) > RUSH.half + 2 || m.y > 26 || m.y < -10;
        if (mt.phase === 'ready' && m.z < RUSH.startZ - 3) bad = true;
        if (!bad) {
            // a row in between: the pane at that x must be down, or this racer pushing it right now
            for (let i = r.row; i < mt.layout.n; i++) {
                const row = mt.layout.rows[i];
                if (m.z > row.z - 1) break;
                const c = row.boss ? 0 : paneIn(row, m.x).c;
                if (mt.hp[i][c] > 0) {
                    if (!r.over) { r.over = now; r.overR = i; r.overC = c; }
                    if (now - r.over > OVERRUN_MS) bad = true;
                    break;
                }
                r.row = i + 1;
            }
        }
        if (bad) {
            if (now - s.snapAt > 300) {
                s.snapAt = now;
                const row = r.over ? mt.layout.rows[r.overR] : null, sz = row ? row.z + RUSH.touch : L.z;
                r.over = 0;
                L.z = sz; r.z = sz;
                this.send(s, 'snap', { x: L.x, y: 0, z: sz, rush: row ? { r: row.i, c: r.overC, hp: mt.hp[row.i][r.overC] } : null });
                if (process.env.QA === '1') console.log('[rush snap]', s.profile.name, row ? 'past pane' : 'too far');
            }
            return true;
        }
        r.x = m.x; r.z = m.z;
        s.player.prog = clamp(r.row, 0, 255);
        // the finish line (only behind the giant pane)
        if (r.place < 0 && mt.phase === 'race' && m.z <= mt.layout.finish && mt.hp[mt.layout.n - 1][0] <= 0) this.finish(mt, r);
        return false;
    }
    finish(mt, r) {
        r.place = mt.order++;
        for (const s of mt.humans) this.send(s, 'rushFinish', { name: r.s ? r.s.profile.name : r.name, place: r.place, me: r.s === s });
        if (r.s) this.room.toast(r.s, 'You finished ' + PLACES[r.place] + '!', '#ffe24a');
    }
    // 20 times a second
    update(now, dt) {
        const q = this.queue;
        if (q) {
            if (now >= q.startAt) { this.queue = null; if (q.list.length) this.startMatch(q); } else {
                q.sec += dt;
                if (q.sec >= 1) { q.sec = 0; this.tellQueue(); }
            }
        }
        for (const mt of this.matches.values()) this.tick(mt, now, dt);
    }
    tick(mt, now, dt) {
        if (mt.phase === 'ready') {
            if (now >= mt.goAt) {
                mt.phase = 'race'; mt.endAt = now + mt.layout.limit * 1000;
                for (const s of mt.humans) this.send(s, 'rushGo', { at: now, limit: mt.layout.limit });
            }
            return;
        }
        if (mt.phase === 'done') {
            if (now >= mt.wrapAt) this.endMatch(mt);
            return;
        }
        for (const r of mt.racers) {
            if (!r.s) this.driveBot(mt, r, now, dt);
            this.push(mt, r, dt, now);
        }
        this.flushHits(mt, now);
        // all the players home, or the clock's run out
        const open = [...mt.humans].some((s) => s.racer && s.racer.place < 0);
        if (!open || now >= mt.endAt) { mt.phase = 'done'; mt.wrapAt = now + (open ? 200 : 1600); }
    }
    // a racer at a standing pane pushes it
    push(mt, r, dt, now) {
        if (r.place >= 0) return;
        const row = mt.layout.rows[r.row];
        if (!row) return;
        const pn = paneIn(row, r.x), c = pn.c, d = r.z - row.z;
        if (d > RUSH.touch + 0.6) { r.over = 0; return; }
        const hp = mt.hp[r.row][c];
        if (hp <= 0) { if (d < -0.5) r.row++; r.over = 0; return; }
        if (pn.kind === 'steel') return;
        const v = hp - r.power * dt;
        mt.hp[r.row][c] = v;
        if (v <= 0) {
            mt.hp[r.row][c] = 0;
            r.smashed++;
            r.over = 0;
            mt.hits.delete(r.row * 16 + c);
            for (const s of mt.humans) this.send(s, 'rushBreak', { r: r.row, c, by: r.s ? r.s.id : r.id, x: +r.x.toFixed(1) });
            if (r.s) this.room.onRushSmash(r.s, pn);
            if (!r.s) r.boost = Math.min(1, r.boost + 0.15);
        } else mt.hits.set(r.row * 16 + c, { r: r.row, c, hp: +v.toFixed(1), x: +r.x.toFixed(1) });
        void now;
    }
    flushHits(mt, now) {
        if (now - mt.hitAt < 180 || !mt.hits.size) return;
        mt.hitAt = now;
        const list = [...mt.hits.values()];
        mt.hits.clear();
        for (const s of mt.humans) this.send(s, 'rushHit', { l: list });
    }
    // a bot: picks the pane it can get through soonest (how sure it is grows with its skill), runs at it
    driveBot(mt, b, now, dt) {
        if (b.place >= 0) { this.easeBot(b, now, dt, b.x, b.z - 4, 0.25); return; }
        const row = mt.layout.rows[b.row];
        if (!row) {
            this.easeBot(b, now, dt, b.x, mt.layout.finish - 2, 1);
            if (b.z <= mt.layout.finish) this.finish(mt, b);
            return;
        }
        if (now >= b.reactAt) {
            b.reactAt = now + rnd(240, 620) / b.skill;
            let best = 0, bv = Infinity;
            row.panes.forEach((p, i) => {
                const hp = mt.hp[row.i][i];
                if (p.kind === 'steel') return;
                const mid = (p.x0 + p.x1) / 2;
                // a mistake now and then: a less skilled bot misreads the glass
                const v = hp / b.power + Math.abs(mid - b.x) / 34 + (1 - b.skill) * Math.random() * 1.4;
                if (v < bv) { bv = v; best = i; }
            });
            b.lane = row.boss ? startX(b.spot, mt.spots) * 0.9 : (row.panes[best].x0 + row.panes[best].x1) / 2 + b.off;
        }
        const pn = paneIn(row, b.x), standing = mt.hp[b.row][pn.c] > 0;
        const tz = standing ? row.z + RUSH.touch - 0.4 : row.z - 8;
        // the pack stays round the players: a bot well out in front eases off, one far behind picks up
        let best = Infinity;
        for (const s of mt.humans) if (s.racer && s.racer.place < 0 && s.racer.z < best) best = s.racer.z;
        const lead = best === Infinity ? 0 : best - b.z;
        this.easeBot(b, now, dt, b.lane, tz, lead > 45 ? 0.8 : lead < -70 ? 1.12 : 1);
        if (b.z < row.z - 0.5 && !standing) { b.row++; b.pl.prog = clamp(b.row, 0, 255); }
    }
    easeBot(b, now, dt, tx, tz, k) {
        b.boost = Math.max(0, b.boost - dt * 0.2);
        const run = CFG.rushRun * b.pace * (1 + b.boost * 0.35) * k, dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
        if (d > 0.3) {
            const step = Math.min(d, run * dt);
            b.x += dx / d * step; b.z += dz / d * step;
            b.pl.ry = Math.atan2(dx / d, dz / d); b.pl.anim = 1;
        } else b.pl.anim = 3;
        b.x = clamp(b.x, -RUSH.half + 1, RUSH.half - 1);
        b.pl.x = b.x; b.pl.y = 0; b.pl.z = b.z; b.pl.t = now;
    }
    endMatch(mt) {
        // anyone not home: placed by how far they got
        const left = mt.racers.filter((r) => r.place < 0).sort((a, b) => a.z - b.z);
        for (const r of left) r.place = mt.order++;
        const rows = mt.racers.slice().sort((a, b) => a.place - b.place).map((r) => ({ n: r.s ? r.s.profile.name : r.name, place: r.place, smashed: r.smashed, bot: !r.s }));
        for (const s of [...mt.humans]) {
            const r = s.racer, prize = rushPrize(r.place, r.smashed, mt.lv, s.profile);
            this.room.onRushEnd(s, r, prize, rows, mt);
            s.match = null; s.racer = null;
            s.player.match = 0; s.player.prog = 0;
        }
        this.closeMatch(mt);
    }
    info() { return { queue: this.queue ? this.queue.list.length : 0, matches: this.matches.size }; }
}
void KINDS;
