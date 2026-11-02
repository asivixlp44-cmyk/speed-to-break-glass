// Procedural soundtrack, effects and the ASMR sounds (Web Audio, no asset files).
//
// Music: in the worlds "Tailwind", a sunny 118 BPM groove in G (G - D - Em - C): plucked guitar-ish arpeggios, an
// electric piano, a round bass and a light kit. In a race "Shatterpoint", a driving 150 BPM chase in A minor
// (Am - F - C - G): stabbing saws, a pulsing bass, four-on-the-floor, a lead that comes in for the last stretch. How much
// of it plays follows the moment (setMusicIntensity): calm before the gun, full near the finish. Each song is
// rendered once in the background into eight-bar loops (one per intensity) and plays from those (see "the songs as loops").
//
// The game's sounds (asmr.js) are synthesised once into buffers; playAsmr plays one with a gain and a pan.
// The effects: buying, levels, the queue, the countdown, stages, the win and lose stings.
import { asmrBuffer } from './asmr.js';

let ctx = null, master, comp, musicBus, musicOut, duckFilter, sfxBus, asmrBus, reverb, roomVerb, delay;
let noiseBuf = null, meter = null;
let musicOn = false, schedTimer = null, seqStep = 0, nextTime = 0, ducked = false;
const settings = { music: 0.5, sfx: 0.8, asmr: 0.9, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('g1_audio') || '{}')); } catch (e) { /* defaults */ }

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const R = (a, b) => a + Math.random() * (b - a);
let intensity = 1;
// 0 calm (before GO), 1 climbing, 2 near the summit
export function setMusicIntensity(k) { intensity = Math.max(0, Math.min(2, k | 0)); }

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 11000; warm.Q.value = 0.3;
    musicOut = ctx.createGain();
    musicBus.connect(warm).connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    asmrBus = ctx.createGain(); asmrBus.connect(comp);
    applyVolumes();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    reverb = ctx.createConvolver(); reverb.buffer = makeIR(ctx, 1.8, 3.2);
    const revGain = ctx.createGain(); revGain.gain.value = 0.24;
    reverb.connect(revGain).connect(musicBus);
    roomVerb = ctx.createConvolver(); roomVerb.buffer = makeIR(ctx, 1.1, 3);
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.25;
    roomVerb.connect(roomGain).connect(sfxBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = 0.3;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 3600;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.2;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}
function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.5 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
    asmrBus.gain.setTargetAtTime((settings.asmr ?? 1) * 1.1 * m, t, 0.05);
}
function save() { try { localStorage.setItem('g1_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) { settings[kind] = Math.max(0, Math.min(1, v)); save(); applyVolumes(); }
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings }, intensity, song: song === SONGS.climb ? 'climb' : 'plaza', loops: { plaza: !!loops.plaza, climb: !!loops.climb }, loopStats, player: player ? nameOf(player.song) + ':' + player.k : '' });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}

// ----- building blocks -----
function noise(t, dur, type, freq, q, gain, out, freqEnd, attack) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return { f, g };
}
function tone(t, type, f0, f1, dur, gain, out, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.32);
    noise(t, 0.012, 'lowpass', 1400, 0.7, gain * 0.25, musicBus);
}
function clap(t, gain) {
    for (let k = 0; k < 3; k++) noise(t + k * 0.01, 0.02, 'bandpass', 1500, 1.4, gain * (k === 2 ? 1 : 0.7), musicBus);
    noise(t + 0.03, 0.25, 'highpass', 3000, 0.5, gain * 0.25, reverb);
}
function snare(t, gain) { noise(t, 0.14, 'bandpass', 1900, 0.9, gain, musicBus); tone(t, 'triangle', 220, 140, 0.08, gain * 0.6, musicBus, 0.002); noise(t + 0.01, 0.3, 'highpass', 3000, 0.5, gain * 0.25, reverb); }
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.035, 'highpass', 8000, 0.7, gain, musicBus); }
function crash(t, gain) { noise(t, 1.2, 'highpass', 5000, 0.4, gain, musicBus, 0, 0.005); }
function bass(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(260, t + dur); f.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(musicBus);
    for (const [type, k, a] of [['sawtooth', 1, 0.6], ['sine', 0.5, 0.8]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
}
function bell(t, n, dur, gain) {
    const g = ctx.createGain(), len = Math.max(0.6, dur * 1.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a, d] of [[1, 1, 1], [2, 0.45, 0.4], [3, 0.22, 0.22], [4.2, 0.08, 0.1]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k;
        og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, len * d));
        o.connect(og).connect(g); o.start(t); o.stop(t + len + 0.05);
    }
}
function pad(t, notes, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1600; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25); g.gain.setValueAtTime(gain, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const n of notes) for (const det of [-8, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n - 12); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.2;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.3);
    }
}
function saw(t, n, dur, gain, cut) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(cut, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.35), t + dur); f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(musicBus);
    for (const det of [-9, 9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
}
function pluck(t, n, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.25); f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    f.connect(g); g.connect(musicBus); g.connect(delay);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = midi(n); o.connect(f); o.start(t); o.stop(t + 0.32);
}

// a mallet (marimba): a sine and its fourth harmonic, quick to die away
function mallet(t, n, gain, out) {
    const g = ctx.createGain(), len = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(out || musicBus); g.connect(reverb);
    for (const [k, a, d] of [[1, 1, 1], [4, 0.28, 0.25], [10, 0.06, 0.1]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k;
        og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + len * d);
        o.connect(og).connect(g); o.start(t); o.stop(t + len + 0.05);
    }
}
// an electric piano: a bell-ish sine pair with a soft body
function epiano(t, n, dur, gain) {
    const g = ctx.createGain(), len = Math.max(0.5, dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(musicBus); g.connect(reverb);
    for (const [k, a] of [[1, 1], [2.001, 0.3], [3, 0.08]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + len + 0.05);
    }
}
function snap(t, gain) { noise(t, 0.05, 'bandpass', 2600, 1.8, gain, musicBus); noise(t + 0.005, 0.2, 'highpass', 3500, 0.6, gain * 0.3, reverb); }

// ----- the two songs -----
const SONGS = {
    plaza: {
        bpm: 118,
        chords: [{ root: 43, notes: [67, 71, 74, 79] }, { root: 38, notes: [66, 69, 74, 78] }, { root: 40, notes: [67, 71, 76, 79] }, { root: 36, notes: [67, 72, 76, 79] }],
        lead: [[[0, 86, 2], [2, 83, 2], [4, 79, 2], [6, 83, 2], [8, 86, 3], [12, 88, 4]], [[0, 86, 2], [2, 81, 2], [4, 78, 2], [6, 81, 2], [8, 85, 2], [10, 86, 6]], [[0, 88, 2], [2, 83, 2], [4, 79, 2], [6, 83, 2], [8, 88, 3], [12, 91, 4]], [[0, 88, 2], [2, 84, 2], [4, 79, 4], [8, 84, 2], [10, 86, 2], [12, 83, 4]]],
    },
    climb: {
        bpm: 150,
        chords: [{ root: 33, notes: [69, 72, 76] }, { root: 29, notes: [69, 72, 77] }, { root: 36, notes: [67, 72, 76] }, { root: 31, notes: [67, 71, 74] }],
        lead: [[[0, 88, 2], [2, 84, 1], [3, 88, 1], [4, 93, 4], [8, 91, 2], [10, 88, 2], [12, 84, 4]], [[0, 89, 2], [2, 84, 1], [3, 89, 1], [4, 93, 4], [8, 96, 2], [10, 93, 2], [12, 89, 4]], [[0, 91, 2], [2, 88, 1], [3, 91, 1], [4, 96, 4], [8, 95, 2], [10, 91, 2], [12, 88, 4]], [[0, 86, 2], [2, 83, 1], [3, 86, 1], [4, 91, 4], [8, 86, 2], [10, 83, 2], [12, 79, 4]]],
    },
};
let song = SONGS.plaza, songNext = SONGS.plaza, STEP = 60 / song.bpm / 4;
// 'plaza' or 'climb': the song changes at the next bar
export function setMusicMode(name) { if (SONGS[name]) songNext = SONGS[name]; }
function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, ch = song.chords[bar % 4], k = intensity;
    if (song === SONGS.plaza) {
        // arpeggios that run on over the chords, an easy backbeat
        if (i === 0) pad(t, ch.notes.slice(0, 3), STEP * 16, 0.022);
        if (i % 2 === 0) pluck(t, ch.notes[(i / 2) % 4] + (i % 8 >= 4 ? 12 : 0), 0.017);
        if (i === 4 || i === 10) ch.notes.slice(0, 3).forEach((n, j) => epiano(t + j * 0.008, n, STEP * 3, 0.018));
        if (k === 0) { if (i % 4 === 2) hat(t, 0.01); return; }
        if (i === 0 || i === 6 || i === 10) kick(t, 0.22);
        if (i === 4 || i === 12) snap(t, 0.06);
        hat(t, i % 4 === 2 ? 0.015 : 0.008, i === 14);
        if (i === 0 || i === 3 || i === 6 || i === 10 || i === 14) bass(t, ch.root - (i === 14 ? 5 : 0), STEP * 1.8, 0.14);
        if (bar % 8 >= 4) for (const [at, n, len] of song.lead[bar % 4]) if (at === i) mallet(t, n - 12, 0.05 + len * 0.002);
        return;
    }
    // the race: a kick on every beat, offbeat bass, stabs, the lead for the last stretch
    const fill = bar % 8 === 7 && i >= 12;
    if (i % 2 === 0) mallet(t, ch.notes[(i >> 1) % 3] + (i % 8 >= 4 ? 12 : 0), k === 0 ? 0.024 : 0.03);
    if (k === 0) { if (i % 8 === 0) kick(t, 0.16); if (i === 0) pad(t, ch.notes, STEP * 16, 0.028); return; }
    if (i % 4 === 0 && !fill) kick(t, 0.32);
    if (i === 4 || i === 12) clap(t, 0.075);
    if (fill) snare(t, 0.05 + (i - 12) * 0.018);
    hat(t, i % 2 ? 0.009 : 0.018, i % 4 === 2);
    if (i % 2 === 1 || i === 2) bass(t, ch.root + (i % 8 === 7 ? 12 : 0), STEP * 0.9, 0.16);
    if (i === 0 || i === 3 || i === 6 || i === 11) ch.notes.forEach((n) => saw(t, n - 12, STEP * 1.2, 0.012, 2600));
    if (k >= 2) for (const [at, n, len] of song.lead[bar % 4]) if (at === i) saw(t, n - 12, STEP * len * 0.9, 0.032, 4200);
    if (i === 0 && bar % 8 === 0) crash(t, 0.045);
}

// ----- the songs as loops -----
// Every part repeats after eight bars, so each song is rendered once per intensity (in the background, an
// OfflineAudioContext) into an eight-bar loop, and the loops play from buffers, in step, crossfading as the
// intensity changes. Played live, a note at a time, a song builds about a hundred audio nodes a
// second: a few percent of every frame on a weak laptop's main thread, and the audio thread's work on top.
// Until a song's loops are ready it plays live, as it always did.
const LOOP_STEPS = 128, LOOP_RATE = 24000;
const KS = { plaza: [0, 1], climb: [0, 1, 2] };
const loops = { plaza: null, climb: null };
let player = null;     // the loops playing: { song, srcs, gains, k }
const nameOf = (sg) => (sg === SONGS.climb ? 'climb' : 'plaza');
// the loop for an intensity: the nearest one rendered so far
const loopK = (sg, k) => Math.min(k, (loops[nameOf(sg)] || KS[nameOf(sg)]).length - 1);
function scheduler() {
    while (nextTime < ctx.currentTime + 0.2) {
        // (no live notes: the next song waits until its loops are ready, the one playing carries on)
        if (seqStep % 16 === 0 && song !== songNext && (liveMusic || loops[nameOf(songNext)])) {
            // the new song from its first bar; the old one's loops stop there
            song = songNext; STEP = 60 / song.bpm / 4; seqStep = 0;
            if (player) stopPlayer(nextTime);
        }
        if (player && globalThis.__ovtLegacy) stopPlayer(nextTime);
        // more of this song's loops ready since it started: picked up at the bar line, seamlessly
        if (player && seqStep % 16 === 0 && loops[nameOf(song)] && loops[nameOf(song)].length > player.srcs.length) stopPlayer(nextTime);
        if (!player && loops[nameOf(song)] && seqStep % 16 === 0 && !globalThis.__ovtLegacy) startPlayer(nextTime, (seqStep % LOOP_STEPS) * STEP);
        if (!player && liveMusic) playStep(seqStep, nextTime);
        nextTime += STEP;
        seqStep++;
    }
    if (player) {
        const k = Math.min(loopK(song, intensity), player.gains.length - 1);
        if (k !== player.k) { player.k = k; player.gains.forEach((g, i) => g.gain.setTargetAtTime(i === k ? 1 : 0, ctx.currentTime, 0.12)); }
    }
}
function startPlayer(t, offset) {
    const k = loopK(song, intensity), srcs = [], gains = [];
    loops[nameOf(song)].forEach((buf, i) => {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; src.loop = true;
        g.gain.value = i === k ? 1 : 0;
        src.connect(g).connect(musicBus);
        src.start(t, offset);
        srcs.push(src); gains.push(g);
    });
    player = { song, srcs, gains, k };
}
function stopPlayer(t) {
    for (const g of player.gains) { g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.06); }
    for (const src of player.srcs) src.stop(t + 0.08);
    player = null;
}
function makeIR(c, secs, decay) {
    const len = Math.round(c.sampleRate * secs), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
}
// the time left before the next frame (none known: a few ms)
// the idle time left before the next frame; a game using all of every frame (a weak laptop) has none,
// so then a short slice every tenth of a second
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback((d) => r(d), { timeout: 100 }) : setTimeout(() => r(null), 50)));
// behind the loading screen the loops get big slices (nothing else is drawing yet); in play, idle moments only
let loadingFast = false;
const slice = () => (loadingFast ? new Promise((r) => setTimeout(() => r({ fast: true }), 0)) : idle());
let loopIR = null;
const PRE_STEPS = 16;
// One song at one intensity: its eight bars after two bars of run-up (the end of the loop, so the loop
// starts with its own last notes' echoes still ringing, as it will when it goes round), the notes laid
// out a few at a time in idle moments, then the eight bars kept.
// QA: how long each loop took (the notes laid out on the main thread, in ms; its slices; the audio rendering)
const loopStats = [];
async function renderLoop(sg, k) {
    const w0 = performance.now(); let js = 0, slices = 0;
    const step = 60 / sg.bpm / 4, len = Math.round(LOOP_STEPS * step * LOOP_RATE), pre = Math.round(PRE_STEPS * step * LOOP_RATE);
    const oc = new OfflineAudioContext(2, pre + len, LOOP_RATE);
    const bus = oc.createGain(); bus.connect(oc.destination);
    const rv = oc.createConvolver(); rv.buffer = loopIR || (loopIR = makeIR(oc, 1.8, 3.2));
    const rg = oc.createGain(); rg.gain.value = 0.24; rv.connect(rg).connect(bus);
    const dl = oc.createDelay(1); dl.delayTime.value = 0.3;
    const fb = oc.createGain(); fb.gain.value = 0.3;
    const lf = oc.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 3600;
    const dg = oc.createGain(); dg.gain.value = 0.2;
    dl.connect(lf).connect(fb).connect(dl); lf.connect(dg).connect(bus);
    for (let s = -PRE_STEPS; s < LOOP_STEPS;) {
        const d = await slice(), until = performance.now() + (d && d.fast ? 12 : d && !d.didTimeout ? Math.min(6, Math.max(1, d.timeRemaining() - 1)) : 2);
        // the note builders draw on these: pointed at the offline graph while they build, all in one go
        // (the live music never sees them)
        const live = { ctx, musicBus, reverb, delay, song, STEP, intensity };
        ctx = oc; musicBus = bus; reverb = rv; delay = dl; song = sg; STEP = step; intensity = k;
        const j0 = performance.now(); slices++;
        try { do { playStep((s + LOOP_STEPS) % LOOP_STEPS, (s + PRE_STEPS) * step); s++; } while (s < LOOP_STEPS && performance.now() < until); } finally { ({ ctx, musicBus, reverb, delay, song, STEP, intensity } = live); }
        js += performance.now() - j0;
    }
    const r0 = performance.now(), out = await oc.startRendering();
    loopStats.push({ song: nameOf(sg), k, js: Math.round(js), slices, render: Math.round(performance.now() - r0), wall: Math.round(performance.now() - w0) });
    const loop = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: LOOP_RATE });
    for (let c = 0; c < 2; c++) loop.copyToChannel(out.getChannelData(c).subarray(pre, pre + len), c);
    return loop;
}
let loopsStarted = false;
// on a slow device (Low quality) the music waits for its loops in silence rather than being played note by note
let liveMusic = true;
export function allowLiveMusic(on) { liveMusic = !!on; }
async function renderLoops() {
    if (loopsStarted || typeof OfflineAudioContext === 'undefined') return;
    loopsStarted = true;
    try {
        // the calmest loop of the song playing now, then the other song's, then the rest: a song plays as soon as
        // it has one (the music starts several times sooner than waiting for all of them)
        const order = nameOf(song) === 'climb' ? ['climb', 'plaza'] : ['plaza', 'climb'];
        for (let i = 0; i < Math.max(KS.plaza.length, KS.climb.length); i++) {
            for (const name of order) {
                if (i >= KS[name].length) continue;
                const buf = await renderLoop(SONGS[name], KS[name][i]);
                (loops[name] || (loops[name] = [])).push(buf);
            }
        }
    } catch (e) { console.warn('[music] loops', e); }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    seqStep = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 30);
    // a few seconds in, not while the game is still settling after loading
    loadingFast = false;
    if (!loopsStarted) setTimeout(renderLoops, 5000);
}
// while the game loads: the songs' loops start rendering now, in big slices, so the music never has to be
// played note by note (that builds about a hundred audio nodes a second: a real cost on a slow phone)
export function prerenderMusic() { if (!ctx || loopsStarted) return; loadingFast = true; renderLoops(); }
export function stopMusic() { musicOn = false; clearInterval(schedTimer); if (player) stopPlayer(ctx.currentTime); }


// =====================================================================================
// The game's sounds: key ('smash', 'crack', 'step', 'boing'...), gain, rate (pitch), pan -1..1, delay (s)
// =====================================================================================
let voices = 0;
const MAX_VOICES = 22;
export function playAsmr(key, gain, rate, pan, delay) {
    if (!ctx || ctx.state !== 'running' || (settings.asmr ?? 1) <= 0 || voices >= MAX_VOICES) return;
    const b = asmrBuffer(ctx, key);
    if (!b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate || 1;
    const g = ctx.createGain();
    g.gain.value = gain ?? 1;
    let out = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
    src.connect(g);
    out.connect(asmrBus);
    voices++;
    src.onended = () => { voices--; src.disconnect(); g.disconnect(); if (out !== g) out.disconnect(); };
    src.start(ctx.currentTime + 0.003 + (delay || 0));
}

// =====================================================================================
// Sound effects (sfx(name, arg): arg is a pitch / combo number for some)
// =====================================================================================
const SFX = {
    click(t) { tone(t, 'sine', 720, 1250, 0.05, 0.13); noise(t, 0.01, 'bandpass', 2400, 1, 0.08, sfxBus); },
    open(t) { tone(t, 'sine', 520, 900, 0.08, 0.1); noise(t, 0.12, 'bandpass', 1200, 1, 0.05, sfxBus, 3000, 0.02); },
    close(t) { tone(t, 'sine', 900, 500, 0.08, 0.08); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.08); tone(t + 0.14, 'square', 180, 120, 0.18, 0.08); },
    buy(t) { tone(t, 'square', midi(88), null, 0.06, 0.04); [88, 95, 100].forEach((n, i) => tone(t + 0.05 + i * 0.06, 'sine', midi(n), null, 0.4, 0.08)); noise(t, 0.4, 'highpass', 6000, 0.7, 0.04, sfxBus, 0, 0.05); },
    equip(t) { tone(t, 'triangle', midi(79), midi(84), 0.12, 0.1); noise(t, 0.04, 'bandpass', 3000, 2, 0.08, sfxBus); },
    reward(t) { [84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.4, 0.09)); tone(t, 'triangle', 800, 3200, 0.3, 0.04); },
    gem(t) { [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.045, 'sine', midi(n), null, 0.4, 0.07)); tone(t, 'triangle', 800, 3200, 0.3, 0.04); },
    task(t) { [84, 88, 91].forEach((n, i) => tone(t + i * 0.07, 'triangle', midi(n), null, 0.35, 0.1)); SFX.gem(t + 0.2); },
    levelup(t) { [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => { tone(t + i * 0.06, 'triangle', midi(n), null, 0.35, 0.08); tone(t + i * 0.06, 'sine', midi(n + 12), null, 0.2, 0.03); }); [60, 64, 67, 72].forEach((n) => tone(t + 0.45, 'triangle', midi(n), null, 1.2, 0.06)); noise(t + 0.4, 0.8, 'highpass', 6000, 0.6, 0.05, sfxBus, 0, 0.2); },
    rankup(t) { [64, 67, 71, 76, 79, 83, 88].forEach((n, i) => tone(t + i * 0.08, 'sawtooth', midi(n), null, 0.3, 0.035)); [52, 59, 64, 71].forEach((n) => tone(t + 0.6, 'triangle', midi(n), null, 1.6, 0.08)); noise(t + 0.55, 1.2, 'highpass', 5000, 0.6, 0.06, sfxBus, 0, 0.1); },
    whoosh(t) { noise(t, 0.3, 'bandpass', 400, 1.6, 0.12, sfxBus, 1800, 0.08); },
    queue(t) { tone(t, 'sine', midi(81), null, 0.1, 0.07); tone(t + 0.1, 'sine', midi(88), null, 0.16, 0.07); },
    found(t) { [76, 81, 85, 88].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.3, 0.09)); },
    beep(t) { tone(t, 'square', midi(69), null, 0.22, 0.07); tone(t, 'sine', midi(81), null, 0.22, 0.06); },
    go(t) { [81, 88, 93].forEach((n) => { tone(t, 'square', midi(n), null, 0.6, 0.045); tone(t, 'sine', midi(n), null, 0.8, 0.07); }); noise(t, 0.5, 'highpass', 4000, 0.5, 0.08, sfxBus, 0, 0.01); },
    // a stage cleared: a rising chime (higher the further along)
    wall(t, n) { const b = 72 + Math.min(12, (n || 1)); [0, 4, 7, 12].forEach((d, i) => tone(t + i * 0.05, 'triangle', midi(b + d), null, 0.35, 0.09)); noise(t, 0.3, 'highpass', 6000, 0.6, 0.04, sfxBus, 0, 0.02); },
    summit(t) { [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => { tone(t + i * 0.07, 'square', midi(n), null, 0.3, 0.045); tone(t + i * 0.07, 'triangle', midi(n + 12), null, 0.25, 0.04); }); [60, 64, 67, 72].forEach((n) => tone(t + 0.55, 'triangle', midi(n), null, 1.6, 0.07)); noise(t, 1, 'highpass', 5000, 0.6, 0.06, sfxBus, 0, 0.1); },
    win(t) { [72, 76, 79, 84, 79, 84, 88, 91].forEach((n, i) => tone(t + i * 0.1, 'square', midi(n), null, 0.3, 0.05)); [60, 64, 67, 72, 76].forEach((n) => tone(t + 0.8, 'triangle', midi(n), null, 1.8, 0.07)); noise(t + 0.8, 1.6, 'highpass', 5000, 0.5, 0.07, sfxBus, 0, 0.05); },
    lose(t) { [67, 66, 65, 64].forEach((n, i) => tone(t + i * 0.28, 'sawtooth', midi(n - 12), null, i === 3 ? 0.9 : 0.3, 0.05)); },
    pass(t) { noise(t, 0.35, 'bandpass', 900, 2.5, 0.08, sfxBus, 2600, 0.04); [84, 91].forEach((n, i) => tone(t + 0.08 + i * 0.07, 'triangle', midi(n), null, 0.25, 0.06)); },
    dash(t) { noise(t, 0.28, 'bandpass', 900, 1.4, 0.14, sfxBus, 3200, 0.02); },
    respawn(t) { for (let i = 0; i < 9; i++) tone(t + i * 0.03, 'sine', midi(72 + i * 3), null, 0.16, 0.05); noise(t, 0.4, 'bandpass', 600, 1.5, 0.08, sfxBus, 5000, 0.05); },
    snap(t) { tone(t, 'sine', 500, 300, 0.08, 0.06); },
};
export function sfx(name, arg) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005, arg);
}
