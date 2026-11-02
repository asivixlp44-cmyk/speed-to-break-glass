// Other players far away (300-400 ms round trip): the server's clock, corrected for the round trip, and
// every other player or bot drawn a little in the past on that clock, between two of their snapshots.
// A snapshot carries the server time it was taken (the mover's own clock, corrected); the delay behind
// "now" follows how late snapshots actually arrive (the slowest tenth of the last ones, plus a margin).
import { net } from './state.js';

// ----- the clock: ping the server; the answers with the shortest round trip are the most exact -----
const samples = [];
let pingN = 0;
export function pingSend() { net.send('ping', { c: Date.now() }); pingN++; }
export function onPong(m) {
    const now = Date.now(), rtt = now - m.c;
    if (rtt < 0 || rtt > 10000) return;
    samples.push({ rtt, off: m.s + rtt / 2 - now });
    if (samples.length > 12) samples.shift();
    // the best few samples, averaged
    const best = samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    const off = best.reduce((a, s) => a + s.off, 0) / best.length;
    // the first estimate jumps; later ones glide (no visible hop in the timers)
    net.offset = pingN <= 2 ? off : net.offset + (off - net.offset) * 0.3;
    net.rtt = best[0].rtt;
}
// how often to ping: quickly at first, then every few seconds
export const pingEvery = () => (pingN < 6 ? 0.6 : 3);

// ----- the delay: how far behind the server's "now" others are drawn -----
const late = new Float32Array(64);
let lateN = 0, delay = 160, delayAt = 0;
export function noteLateness(ms) { late[lateN++ % late.length] = ms; }
// worked out at most four times a second (it sorts the samples)
export function updateDelay() {
    const n = Math.min(lateN, late.length), now = performance.now();
    if (n < 6 || now - delayAt < 250) return delay;
    delayAt = now;
    const v = Array.from(late.subarray(0, n)).sort((a, b) => a - b);
    const want = Math.min(700, Math.max(90, v[Math.floor(n * 0.9)] + 45));
    delay += (want - delay) * 0.1;
    return delay;
}
export const renderDelay = () => delay;

// ----- one mover's snapshots -----
export class Track {
    constructor() { this.q = []; this.lt = -1; }
    // a snapshot (server time t); returns true when it was new
    push(t, x, y, z, ry, a) {
        if (t <= this.lt) return false;
        // how late it arrived counts only while they keep moving: the first snapshot, or one after they stood
        // still a while, carries an old stamp that says nothing about the network
        if (this.lt > 0 && t - this.lt < 400) noteLateness(net.now() - t);
        this.lt = t;
        this.q.push({ t, x, y, z, ry, a });
        if (this.q.length > 24) this.q.shift();
        return true;
    }
    // where it was at server time rt (out: { x, y, z, ry, a, speed })
    sample(rt, out) {
        const q = this.q;
        if (!q.length) return false;
        let a = q[0], b = q[q.length - 1];
        if (rt >= b.t) {
            // late: carry on along the last movement for a moment, then stop
            const p = q.length > 1 ? q[q.length - 2] : b, dt = Math.max(1, b.t - p.t), ex = Math.min(rt - b.t, 220) / dt;
            out.x = b.x + (b.x - p.x) * ex; out.y = b.y; out.z = b.z + (b.z - p.z) * ex; out.ry = b.ry; out.a = b.a;
            out.speed = Math.hypot(b.x - p.x, b.z - p.z) / dt * 1000 * (rt - b.t < 220 ? 1 : 0);
            return true;
        }
        if (rt <= a.t) { out.x = a.x; out.y = a.y; out.z = a.z; out.ry = a.ry; out.a = a.a; out.speed = 0; return true; }
        for (let i = q.length - 1; i > 0; i--) if (q[i - 1].t <= rt) { a = q[i - 1]; b = q[i]; break; }
        const k = (rt - a.t) / Math.max(1, b.t - a.t);
        if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 > 900) { out.x = b.x; out.y = b.y; out.z = b.z; out.ry = b.ry; }
        else {
            out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
            let d = b.ry - a.ry;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            out.ry = a.ry + d * k;
        }
        out.a = k < 0.5 ? a.a : b.a;
        out.speed = Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1, b.t - a.t) * 1000;
        return true;
    }
    reset() { this.q.length = 0; this.lt = -1; }
}
