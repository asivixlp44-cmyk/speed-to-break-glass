// Local mirror of this player's progress. The server owns the real values: everyone's position arrives
// through the room state, private progress in "profile" messages.
export const S = {
    speed: 0, topSpeed: 0, totalSteps: 0, shards: 0, totalShards: 0, gems: 0, xp: 0, lv: 1, need: 40, rebirths: 0, shoes: 0, best: [0, 0, 0, 0], stage: 0,
    spins: 0, spinIn: 0, spinsUsed: 0, tread: 0, pads: 0, panes: 0, rushes: 0, rushWins: 0, podium: 0, world: 0,
    trails: ['none'], trail: 'none', auras: ['none'], aura: 'none', chests: {}, x2Until: 0, x2sUntil: 0, x2: false, x2s: false,
    qi: 0, qv: 0, jq: { day: '', list: [] }, daily: {}, codes: {}, gifts: {}, seen: {}, tut: 0,
    sessionSecs: 0, playtime: 0, firstPlay: Date.now(),
    joinedAt: Date.now(), profileAt: Date.now(), name: '',
};

// Game actions that world objects (the sneaker pads, the portal) and panels trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    rtt: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms (corrected for the round trip, smooth.js), so timers line up for everyone
    fixedNow: null,
    now() { return this.fixedNow ?? Date.now() + this.offset; },
};

// QA: where a slow frame's time went (sections marked as the frame runs)
export const prof = { t: 0, parts: [], on: true, mark(name) { const n = performance.now(); this.parts.push(name, n - this.t); this.t = n; }, start() { this.parts.length = 0; this.t = performance.now(); } };
