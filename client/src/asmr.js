// The game's sounds, synthesised sample by sample (no files) into short buffers once while the game loads: glass in
// every stage of breaking (a pane taking a hit, cracks spreading, a pane going, shards tinkling down), footsteps, the
// tick of Speed climbing, the whirr of a treadmill, the Shard Pad's chime. Playing one is a buffer source and a gain
// (and a pan for someone else's); nothing is built note by note while playing.
const SR = 44100;
const rnd = (a, b) => a + Math.random() * (b - a);
let seed = 12345;
const noiseV = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };

// ----- little DSP kit (in place on Float32Arrays) -----
const buf = (secs) => new Float32Array(Math.max(1, Math.round(secs * SR)));
function biquad(x, type, f, q) {
    const w = 2 * Math.PI * Math.min(f, SR * 0.45) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * (q || 0.707));
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
    return x;
}
// a band-pass whose centre moves (f(t) in Hz), for squelches
function sweepBP(x, fOf, q) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const w = 2 * Math.PI * Math.min(fOf(i / SR), SR * 0.45) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
        const v = x[i], y = (al * v - al * x2 + 2 * cs * y1 - (1 - al) * y2) / a0;
        x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
}
function addNoise(x, at, len, amp, env, filt) {
    const n = buf(len);
    for (let i = 0; i < n.length; i++) n[i] = noiseV();
    if (filt) for (const f of filt) biquad(n, f[0], f[1], f[2]);
    const i0 = Math.round(at * SR);
    for (let i = 0; i < n.length && i0 + i < x.length; i++) x[i0 + i] += n[i] * amp * env(i / SR, len);
}
// a sine whose frequency follows f(t), amplitude env(t)
function addTone(x, at, len, f, amp, env) {
    const i0 = Math.round(at * SR);
    let ph = 0;
    for (let i = 0; i < len * SR && i0 + i < x.length; i++) { const t = i / SR; ph += 2 * Math.PI * f(t) / SR; x[i0 + i] += Math.sin(ph) * amp * env(t, len); }
}
const dec = (k, a) => (t) => (a && t < a ? t / a : 1) * Math.exp(-(t - (a && t > a ? a : 0)) * k);
function norm(x, peak) {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    const k = m > 0 ? peak / m : 0;
    // a short fade at the end (no click)
    const f = Math.min(x.length, 220);
    for (let i = 0; i < x.length; i++) x[i] *= k * (i > x.length - f ? (x.length - i) / f : 1);
    return x;
}

// ----- glass -----
// a struck sheet rings: a handful of high partials, quick to die, none harmonic
function glassRing(x, at, f0, amp, decay) {
    for (const [k, a] of [[1, 1], [1.53, 0.7], [2.17, 0.55], [2.91, 0.4], [3.82, 0.28], [5.1, 0.16]]) {
        const f = f0 * k * rnd(0.985, 1.015);
        addTone(x, at + rnd(0, 0.003), Math.min(0.9, 5 / decay), () => f, amp * a, dec(decay * (0.6 + k * 0.4), 0.0006));
    }
}
// a pushing thud with a tap of glass on it
function makeHit() {
    const x = buf(0.2), p = rnd(0.9, 1.15);
    addTone(x, 0, 0.14, (t) => 120 * p * (1 - t * 3), 0.7, dec(30, 0.002));
    addNoise(x, 0, 0.02, 0.5, dec(180), [['bp', 1600 * p, 1.2]]);
    glassRing(x, 0.001, 2300 * p, 0.09, 55);
    return norm(x, 0.7);
}
// a crack running across a pane: a dry tick and a splintering run of tiny ones
function makeCrack() {
    const L = rnd(0.12, 0.24), x = buf(L + 0.05), p = rnd(0.85, 1.2);
    addNoise(x, 0, 0.003, 1, dec(1400), [['hp', 2800 * p, 0.8]]);
    for (let k = 0, c = Math.round(rnd(9, 22)); k < c; k++) {
        const at = Math.pow(Math.random(), 1.4) * L;
        addNoise(x, at, rnd(0.0012, 0.0035), rnd(0.2, 0.8) * (1 - at / L * 0.6), dec(1800), [['hp', rnd(2600, 7000) * p, 0.9]]);
    }
    glassRing(x, 0, 3400 * p, 0.05, 90);
    return norm(x, 0.7);
}
// a pane going: a crack like a shot, a low whump, the sheet ringing out, and a rain of pieces
function makeSmash(big) {
    const L = big ? 1.5 : 1.05, x = buf(L), p = rnd(0.88, 1.12);
    addNoise(x, 0, 0.012, 1, dec(330, 0.0002), [['hp', 900, 0.7]]);
    addNoise(x, 0, 0.09, 0.8, dec(38, 0.001), [['bp', 2400 * p, 0.7]]);
    addTone(x, 0, 0.2, (t) => (big ? 92 : 130) * p * (1 - t * 2.2), big ? 1 : 0.65, dec(22, 0.001));
    for (let k = 0; k < (big ? 9 : 6); k++) glassRing(x, rnd(0, 0.03), rnd(1900, 4400) * p, 0.075, rnd(10, 26));
    // the pieces coming down, thick at first, thinning
    for (let k = 0, c = big ? 150 : 95; k < c; k++) {
        const at = 0.015 + Math.pow(Math.random(), 1.7) * (L - 0.2), f = rnd(2600, 9000) * p;
        addTone(x, at, 0.05, () => f, rnd(0.03, 0.13) * Math.exp(-at * 2.4), dec(rnd(90, 220), 0.0004));
        if (k % 3 === 0) addNoise(x, at, rnd(0.001, 0.003), rnd(0.1, 0.3) * Math.exp(-at * 2.6), dec(1500), [['hp', 4200, 0.8]]);
    }
    return norm(x, big ? 0.95 : 0.85);
}
// a few bits landing a moment later
function makeTinkle() {
    const L = 0.6, x = buf(L), p = rnd(0.9, 1.15);
    for (let k = 0, c = 16; k < c; k++) {
        const at = Math.random() * (L - 0.1), f = rnd(3200, 9500) * p;
        addTone(x, at, 0.06, () => f, rnd(0.05, 0.14), dec(rnd(100, 200), 0.0004));
    }
    return norm(x, 0.5);
}
// ----- running -----
function makeStep() {
    const L = 0.09, x = buf(L), p = rnd(0.85, 1.2);
    addNoise(x, 0, L, 0.6, dec(70, 0.002), [['lp', 900 * p, 0.8], ['hp', 120, 0.7]]);
    addTone(x, 0, 0.06, (t) => 100 * p * (1 - t * 5), 0.6, dec(70, 0.002));
    addNoise(x, 0, 0.006, 0.35, dec(700), [['hp', 2600 * p, 0.7]]);
    return norm(x, 0.5);
}
// the Speed tick (played at higher pitches as a run of steps goes on)
function makeTick() {
    const x = buf(0.22);
    addTone(x, 0, 0.22, () => 1046.5, 0.6, dec(22, 0.001));
    addTone(x, 0, 0.12, () => 2093, 0.25, dec(40, 0.001));
    addTone(x, 0, 0.06, () => 4186, 0.1, dec(70, 0.001));
    return norm(x, 0.45);
}
// a Speed strip: a rising zip
function makeZip() {
    const x = buf(0.3);
    addTone(x, 0, 0.26, (t) => 420 * Math.pow(6, t / 0.26), 0.6, (t, l) => Math.sin(Math.PI * Math.min(1, t / l)));
    addNoise(x, 0, 0.26, 0.2, (t, l) => Math.sin(Math.PI * Math.min(1, t / l)), [['bp', 3200, 0.8]]);
    return norm(x, 0.55);
}
// the jump: a soft spring
function makeBoing() {
    const L = 0.2, x = buf(L);
    addTone(x, 0, L, (t) => 240 * (1 + 0.9 * (1 - Math.exp(-t * 28))), 0.6, dec(18, 0.004));
    addNoise(x, 0, 0.04, 0.12, dec(80), [['bp', 1800, 1.5]]);
    return norm(x, 0.45);
}
function makeLand() {
    const x = buf(0.14), p = rnd(0.9, 1.1);
    addTone(x, 0, 0.1, (t) => 86 * p * (1 - t * 3), 0.8, dec(32, 0.002));
    addNoise(x, 0, 0.05, 0.5, dec(70), [['lp', 700, 0.7]]);
    return norm(x, 0.6);
}
// a Shard Pad: crystal chimes
function makeChime() {
    const x = buf(1.2);
    [1568, 2093, 2637, 3136, 4186].forEach((f, k) => { addTone(x, k * 0.055, 0.9, () => f, 0.5 - k * 0.05, dec(6, 0.001)); addTone(x, k * 0.055, 0.5, () => f * 2.76, 0.08, dec(16, 0.001)); });
    return norm(x, 0.7);
}
// a burst of pace: a whoosh
function makeWhoosh() {
    const L = 0.5, x = buf(L), n = buf(L);
    for (let i = 0; i < n.length; i++) { const t = i / SR; n[i] = noiseV() * Math.sin(Math.PI * t / L); }
    sweepBP(n, (t) => 300 * Math.pow(8, t / L), 1.4);
    for (let i = 0; i < n.length; i++) x[i] = n[i];
    return norm(x, 0.6);
}

// ----- the bank: made while loading (a few at a time, so the page stays responsive) -----
const bank = {};
export async function buildAsmr(pause) {
    const out = (k, f, n) => { bank[k] = []; for (let i = 0; i < n; i++) bank[k].push(f()); };
    out('hit', makeHit, 4); out('crack', makeCrack, 5); if (pause) await pause();
    out('smash', () => makeSmash(false), 3); if (pause) await pause();
    out('smashBig', () => makeSmash(true), 2); if (pause) await pause();
    out('tinkle', makeTinkle, 3); out('step', makeStep, 5); out('tick', makeTick, 1); out('zip', makeZip, 1);
    out('boing', makeBoing, 2); out('land', makeLand, 3); out('chime', makeChime, 1); out('whoosh', makeWhoosh, 1);
    if (pause) await pause();
}
// the AudioBuffers (made once the audio context exists)
const ready = {};
export function asmrBuffer(ctx, key) {
    let list = ready[key];
    if (!list) {
        const raw = bank[key];
        if (!raw) return null;
        list = ready[key] = raw.map((a) => { const b = ctx.createBuffer(1, a.length, SR); b.copyToChannel(a, 0); return b; });
    }
    return list[Math.floor(Math.random() * list.length)];
}
