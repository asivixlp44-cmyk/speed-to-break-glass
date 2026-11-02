// +1 Speed to Break Glass: the game's data and formulas, shared by the client and the server.
// The loop: every step gives Speed; Speed is how fast glass breaks (one Speed is one point of a pane's health a
// second); the Shard Pads behind each stage give Shards and send you home; Shards buy better sneakers (more Speed
// a step), trails and rebirths; rebirths open the faster treadmills; clearing a world opens the next one. On top
// of that, Glass Rush: press PLAY, race whoever else pressed it through a field of shared glass.
// Everything is bought with Shards or Gems, all earned in the game. There are no in-app purchases.
export const lookup = (o) => Object.assign(Object.create(null), o);

export const CFG = {
    maxPlayers: 16,
    // moving: walk speed (grows with your Speed, moveSpeed), gravity, the fastest fall
    walk: 22, grav: 110, fallMax: 210, airDash: 46, hopV: 22, jumpPower: 56,
    // a step is counted at most this often (seconds); on a treadmill your feet go faster
    stepGap: 0.3, treadGap: 0.22,
    // the server keeps this many bot runners about when nobody else is (one leaves per player who joins)
    bots: 4,
    x2SpeedGems: 25, x2ShardsGems: 25, x2Mins: 15,
    // a free spin of the wheel every so often while you play (up to a few saved)
    spinMins: 8, spinMax: 3,
    chestMins: 15,
    // a pane you stopped pushing heals after this long, this share of its health a second
    regenAfter: 1, regenRate: 0.5,
    // Glass Rush: places in a race, how long the queue stays open, how long the start line waits
    rushSpots: 6, rushQueue: 9, rushFull: 3, rushReady: 6,
    rushRun: 30, rushRunMax: 48,
};

// ----- Speed -----
// how fast you run: 22 studs a second at nothing, more with every power of ten
export const moveSpeed = (speed) => Math.min(78, 22 + 8.5 * Math.log10(1 + Math.max(0, speed || 0)));
// a pane's health a second
export const smashRate = (speed) => Math.max(2, speed || 0);
export const rebMult = (r) => 1 + 0.5 * (r || 0);
export const jumpH = (p) => Math.max(0, p) * Math.max(0, p) / 392;
export const jumpV = (p) => Math.sqrt(2 * CFG.grav * jumpH(p));
// XP for the next level (panes, pads, races and quests give XP; your Level grows every Glass Rush)
export const xpNeed = (lv) => Math.round(40 * Math.pow(1.16, Math.max(1, lv) - 1));

// ----- sneakers: more Speed a step, for good. Each pad by the spawn sells the next pair (the first is FREE) -----
export const SHOES = [
    { name: 'Canvas Kicks', add: 2, shards: 0, color: 0xff5a5a },
    { name: 'Puddle Jumpers', add: 3, shards: 3, color: 0xffa02a },
    { name: 'Zip Trainers', add: 5, shards: 10, color: 0xffe02a },
    { name: 'Spring Soles', add: 8, shards: 30, color: 0x7ae83a },
    { name: 'Cloud Runners', add: 12, shards: 80, color: 0x3ad8a8 },
    { name: 'Road Rockets', add: 20, shards: 200, color: 0x3ab4ff },
    { name: 'Turbo Tens', add: 30, shards: 480, color: 0x5a7aff },
    { name: 'Gale Sprinters', add: 50, shards: 1100, color: 0xa85aff },
    { name: 'Thunder Treads', add: 75, shards: 2500, color: 0xff5ac8 },
    { name: 'Comet Cleats', add: 120, shards: 6000, color: 0xff7a5a },
    { name: 'Blaze Boosters', add: 180, shards: 14000, color: 0xffb02a },
    { name: 'Star Striders', add: 280, shards: 32000, color: 0xfff06a },
    { name: 'Nova Boots', add: 450, shards: 75000, color: 0x9affa0 },
    { name: 'Warp Wedges', add: 700, shards: 170000, color: 0x6ae8ff },
    { name: 'Hyper High-Tops', add: 1100, shards: 400000, color: 0x8a9aff },
    { name: 'Quasar Kicks', add: 1800, shards: 950000, color: 0xd88aff },
    { name: 'Light Speeders', add: 3000, shards: 2200000, color: 0xffffff },
    { name: 'Infinity Sneaks', add: 5000, shards: 5000000, color: 0xffd028 },
];
export const shoeAdd = (n) => (n > 0 ? SHOES[Math.min(n, SHOES.length) - 1].add : 1);
// what one step gives: your best sneakers, x your rebirths, x the treadmill under you, x2 when boosted
export function perStep(p, tread, x2) {
    return Math.round(shoeAdd(p.shoes) * rebMult(p.rebirths) * (tread || 1) * (x2 ? 2 : 1) * 10) / 10;
}
// ----- rebirths: back to 0 Speed (you keep your sneakers), more Speed a step for good; opens treadmills -----
export const rebirthCost = (r) => Math.round(130 * Math.pow(2.45, r || 0));
// ----- the treadmills by the spawn: step on and your feet do the rest, x mult Speed a step -----
export const TREADS = [
    { id: 't1', mult: 1, reb: 0, color: 0x3ab4ff },
    { id: 't2', mult: 2, reb: 1, color: 0x46ec50 },
    { id: 't3', mult: 3, reb: 2, color: 0xffd028 },
    { id: 't5', mult: 5, reb: 3, color: 0xff9a2a },
    { id: 't8', mult: 8, reb: 5, color: 0xff5a5a },
    { id: 't12', mult: 12, reb: 7, color: 0xff4ab8 },
    { id: 't20', mult: 20, reb: 10, color: 0xa85aff },
    { id: 't35', mult: 35, reb: 14, color: 0xffffff },
];

// ----- the worlds: a spawn, then a long run through six stages of five panes each -----
const stages = (list) => list.map(([name, tint, floor]) => ({ name, tint, floor }));
export const WORLDS = [
    {
        id: 'garden', name: 'Glasshouse Gardens', icon: '🌿', mood: 'garden', ground: 0x7ad65a, hub: 0xf8f4e8, hub2: 0xece6d4, trim: 0x2f9a58, wall: 0xf2ece0, wall2: 0xd8a070,
        stages: stages([['Window Pane', 0xc8f0ff, 0xf6f2e4], ['Greenhouse Panel', 0xb0f4c8, 0xe0f4d0], ['Bottle Green', 0x5ae08a, 0xc8ecb8], ['Rose Window', 0xffa8c8, 0xfbe0e4], ['Double Glazed', 0x9ad0ff, 0xdcecfa], ['Sunroom Dome', 0xffe28a, 0xfcf0c4]]),
    },
    {
        id: 'city', name: 'Skyline Sprint', icon: '🏙️', mood: 'city', ground: 0x5a6478, hub: 0xd8dde8, hub2: 0xc4cad8, trim: 0xffb81e, wall: 0x6a7a9a, wall2: 0x3a4a6a,
        stages: stages([['Shop Front', 0xbfe8ff, 0xd0d6e2], ['Bus Shelter', 0x8ae8e0, 0xc4d0dc], ['Office Tower', 0x6ab8ff, 0xb8c8e4], ['Aquarium Tank', 0x3ad8ff, 0xb0dcee], ['Bank Vault', 0xc8c0ff, 0xccc8e8], ['Skyscraper Curtain', 0xff9ae0, 0xe4c8e8]]),
    },
    {
        id: 'frost', name: 'Frostpane Peaks', icon: '❄️', mood: 'frost', ground: 0xeef6ff, hub: 0xe4f2ff, hub2: 0xcfe6fa, trim: 0x3a8ae8, wall: 0xb8dcf8, wall2: 0x7ab0e0,
        stages: stages([['Frost Sheet', 0xe0f8ff, 0xe8f4ff], ['Snow Globe', 0xc8e8ff, 0xdceeff], ['Glacier Slab', 0x8ae0f8, 0xc8e8fa], ['Polar Prism', 0xb8b0ff, 0xd8dcfa], ['Icefall', 0x6ad0ff, 0xbce4fa], ['Aurora Veil', 0x8affd0, 0xc8f8ec]]),
    },
    {
        id: 'foundry', name: 'Ember Foundry', icon: '🌋', mood: 'foundry', ground: 0x3a2a2e, hub: 0x5a4a50, hub2: 0x4a3a42, trim: 0xff7a1e, wall: 0x4a3238, wall2: 0x2a1c22,
        stages: stages([['Hot Bottle', 0xffb86a, 0x6a5258], ['Lava Lamp', 0xff7a5a, 0x6a4a50], ['Furnace Door', 0xffd24a, 0x6a5040], ['Obsidian Sheet', 0xb06aff, 0x54404e], ['Dragon Scale', 0xff4a6a, 0x644048], ['Starfire Core', 0xfff08a, 0x70604a]]),
    },
];
export const STAGES_PER_WORLD = 6, PANES_PER_STAGE = 5, PANES_PER_WORLD = STAGES_PER_WORLD * PANES_PER_STAGE;
// a pane's health (pane i of world w, 0..29) and the Shards a stage's pad gives (stage k of world w, 0..5)
export const paneHp = (w, i) => Math.round(7 * Math.pow(1.44, i) * Math.pow(1000, w));
export const padShards = (w, k) => Math.round(1.5 * Math.pow(2.3, k) * Math.pow(40, w)) + 1;
// XP for a pane, a stage's pad
export const paneXp = (w, i) => 2 + Math.floor(i / 5) + w * 3;
export const padXp = (w, k) => 8 * (k + 1) + w * 12;
// a world opens when you've cleared the last stage of the one before it
export function worldOpen(p, w) { return w <= 0 || ((p.best && p.best[w - 1]) || 0) >= STAGES_PER_WORLD; }
// how far you've got, as one number: stages cleared counted across the worlds (each world's are 6)
export function stageValue(p) {
    let v = 0;
    for (let w = 0; w < WORLDS.length; w++) if (p.best && p.best[w]) v = Math.max(v, w * STAGES_PER_WORLD + p.best[w]);
    return v;
}
// the best pad you can reach, for prizes that should feel worth having whatever world you're in
export function bestPad(p) {
    const v = stageValue(p);
    if (v <= 0) return padShards(0, 0);
    return padShards(Math.floor((v - 1) / STAGES_PER_WORLD), (v - 1) % STAGES_PER_WORLD);
}

// ----- Glass Rush: what a race is like at a Level. Longer and tougher as you level up, and better paid -----
export function rushInfo(lv) {
    lv = Math.max(1, lv | 0);
    return {
        rows: Math.min(34, 10 + Math.floor(lv * 0.9)), gap: 44,
        // how much of each row is tough glass or steel
        tough: Math.min(0.68, 0.2 + lv * 0.018), steel: lv < 3 ? 0 : Math.min(0.34, 0.06 + lv * 0.009),
        // a pane's health in seconds of pushing, for an average racer in this race
        hpK: Math.min(3, 1.1 + lv * 0.04),
        limit: Math.round(45 + Math.min(34, 10 + lv * 0.9) * 4.5),
    };
}
// your strength in a race: Speed counts, but only so much (a new player can still beat a veteran by picking the
// thin panes and following the holes others made)
export const rushPower = (speed, r) => Math.round(30 + 7 * Math.log2(1 + Math.max(0, speed || 0)) + 3 * (r || 0));
export const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const PLACE_K = [2.2, 1.5, 1.1, 0.8, 0.6, 0.5];
// what a race pays: by your place, the panes you smashed yourself, your Level and how far you've got
export function rushPrize(place, smashed, lv, p) {
    const k = PLACE_K[Math.min(place, PLACE_K.length - 1)], lf = 1 + lv * 0.05;
    return {
        shards: Math.max(3, Math.round(Math.max(4, bestPad(p) * 0.8) * k * lf * (1 + Math.min(0.8, (smashed || 0) * 0.05)))),
        gems: (place === 0 ? 4 : place === 1 ? 2 : place === 2 ? 1 : 0) + Math.floor(lv / 12),
        xp: Math.round((26 + lv * 3) * k),
    };
}

// ----- the wheel: one spin's prizes (weights) -----
export const SPIN = [
    { w: 22, speed: 1, text: 'Speed', color: '#3ab4ff' }, { w: 18, shards: 1, text: 'Shards', color: '#7af4ff' }, { w: 14, gems: 5, text: '5 Gems', color: '#b45aff' },
    { w: 12, speed: 3, text: 'Big Speed', color: '#2a7aff' }, { w: 10, shards: 3, text: 'Big Shards', color: '#2ad8c8' }, { w: 10, x2: 10, text: 'x2 Speed', color: '#46ec50' },
    { w: 8, gems: 15, text: '15 Gems', color: '#7a4aff' }, { w: 6, shards: 10, text: 'Huge Shards', color: '#ffd028' },
];
// a spin's Speed / Shards prize grows with what you've reached
export function spinPrize(s, p) {
    return { speed: s.speed ? Math.round(s.speed * 40 * perStep(p, 1, false) * 3) : 0, shards: s.shards ? Math.round(s.shards * Math.max(2, bestPad(p) * 0.4)) : 0, gems: s.gems || 0, x2: s.x2 || 0 };
}

// ----- trails (behind you when you run) and auras (round you) -----
export const RARITIES = lookup({
    common: { name: 'Common', color: '#c8d0dc' }, rare: { name: 'Rare', color: '#3ab4ff' }, epic: { name: 'Epic', color: '#b45aff' },
    legendary: { name: 'Legendary', color: '#ffc42a' }, mythic: { name: 'Mythic', color: '#ff4a8a' },
});
export const TRAILS = [
    { id: 'none', name: 'No Trail', rarity: 'common', shards: 0, gems: 0, c1: 0xffffff },
    { id: 'chalk', name: 'Chalk Dust', rarity: 'common', shards: 15, gems: 0, c1: 0xf4f4ff },
    { id: 'citrus', name: 'Citrus Zest', rarity: 'common', shards: 60, gems: 0, c1: 0xffc23a },
    { id: 'mint', name: 'Cool Mint', rarity: 'rare', shards: 0, gems: 20, c1: 0x5affc8 },
    { id: 'sky', name: 'Skywriter', rarity: 'rare', shards: 300, gems: 0, c1: 0x5ac8ff },
    { id: 'neon', name: 'Neon Rush', rarity: 'epic', shards: 1500, gems: 0, c1: 0xff4ad8 },
    { id: 'ember', name: 'Ember Streak', rarity: 'epic', shards: 0, gems: 45, c1: 0xff6a2a },
    { id: 'solar', name: 'Solar Flare', rarity: 'legendary', shards: 12000, gems: 0, c1: 0xffd028 },
    { id: 'rainbow', name: 'Prism', rarity: 'mythic', shards: 0, gems: 140, c1: 0xffffff, rainbow: 1 },
];
export const trailById = lookup(Object.fromEntries(TRAILS.map((s) => [s.id, s])));
export const AURAS = [
    { id: 'none', name: 'No Aura', rarity: 'common', shards: 0, gems: 0, c1: 0xffffff },
    { id: 'static', name: 'Static', rarity: 'rare', shards: 150, gems: 0, c1: 0xfff0a8 },
    { id: 'shardlets', name: 'Shardlets', rarity: 'epic', shards: 0, gems: 50, c1: 0x8ae8ff },
    { id: 'roses', name: 'Rose Petals', rarity: 'epic', shards: 2500, gems: 0, c1: 0xff5a9a },
    { id: 'stars', name: 'Starlight', rarity: 'legendary', shards: 0, gems: 120, c1: 0xffe07a },
    { id: 'rainbow', name: 'Prism', rarity: 'mythic', shards: 0, gems: 200, c1: 0xffffff, rainbow: 1 },
];
export const auraById = lookup(Object.fromEntries(AURAS.map((s) => [s.id, s])));

export const RANKS = [
    { name: 'Bronze', min: 0, color: '#d88a4a', icon: '🥉' },
    { name: 'Silver', min: 60, color: '#d8e0ec', icon: '🥈' },
    { name: 'Gold', min: 500, color: '#ffd21e', icon: '🥇' },
    { name: 'Platinum', min: 5000, color: '#7ae8e0', icon: '💠' },
    { name: 'Diamond', min: 80000, color: '#7ab4ff', icon: '💎' },
    { name: 'Champion', min: 2000000, color: '#ff5ab4', icon: '👑' },
];
export function rankOf(shards) {
    let i = 0;
    for (let k = 0; k < RANKS.length; k++) if ((shards || 0) >= RANKS[k].min) i = k;
    return i;
}

// ----- daily tasks -----
export const TASKS = lookup({
    shards: { text: 'Collect Shards', icon: '🔷', n: 30, gems: 6, shards: 5 },
    panes: { text: 'Smash Panes', icon: '🪟', n: 40, gems: 5, shards: 3 },
    steps: { text: 'Take Steps', icon: '👟', n: 600, gems: 5, shards: 3 },
    stage: { text: 'Clear Stage 3', icon: '🏁', n: 3, gems: 6, shards: 5 },
    tread: { text: 'Run on Treadmills', icon: '🏃', n: 200, gems: 5, shards: 3 },
    levels: { text: 'Level Up', icon: '⭐', n: 3, gems: 6, shards: 5 },
    rushes: { text: 'Play Glass Rush', icon: '🥇', n: 3, gems: 8, shards: 6 },
    spins: { text: 'Spin the Wheel', icon: '🎡', n: 2, gems: 5, shards: 3 },
    pads: { text: 'Step on Shard Pads', icon: '🔷', n: 6, gems: 5, shards: 5 },
});
const TASK_POOL = ['panes', 'steps', 'stage', 'tread', 'levels', 'rushes', 'spins', 'pads'];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayLeft = (ms) => 86400 - Math.floor(ms / 1000) % 86400;
export function tasksFor(day) {
    let h = 2166136261;
    for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 16777619); }
    const r = rngFrom(h >>> 0), pool = TASK_POOL.slice(), out = ['shards'];
    while (out.length < 3) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
}

// ----- quests: always a next goal (shown at the top of the screen) -----
export const QUESTS = [
    { kind: 'speed', n: 10, text: 'Run! Build up 10 Speed', gems: 2 },
    { kind: 'panes', n: 5, text: 'Smash all 5 panes of Stage 1', shards: 2 },
    { kind: 'pads', n: 1, text: 'Step on the Shard Pad behind them', gems: 3 },
    { kind: 'shoes', n: 1, text: 'Grab the FREE sneakers by the spawn', shards: 2 },
    { kind: 'tread', n: 30, text: 'Run 30 steps on a treadmill', gems: 3 },
    { kind: 'stage', n: 2, text: 'Clear Stage 2', shards: 6 },
    { kind: 'shoes', n: 2, text: 'Buy the next sneakers', gems: 3 },
    { kind: 'rushes', n: 1, text: 'Press PLAY: try a Glass Rush', gems: 5 },
    { kind: 'stage', n: 3, text: 'Clear Stage 3', shards: 15 },
    { kind: 'lv', n: 5, text: 'Reach Level 5', gems: 5 },
    { kind: 'shoes', n: 4, text: 'Own 4 pairs of sneakers', shards: 30 },
    { kind: 'rebirths', n: 1, text: 'Rebirth once', gems: 10 },
    { kind: 'podium', n: 1, text: 'Finish a Rush in the top 3', gems: 8 },
    { kind: 'stage', n: 4, text: 'Clear Stage 4', shards: 80 },
    { kind: 'spins', n: 3, text: 'Spin the wheel 3 times', gems: 6 },
    { kind: 'rebirths', n: 2, text: 'Rebirth twice', gems: 12 },
    { kind: 'lv', n: 12, text: 'Reach Level 12', shards: 200 },
    { kind: 'stage', n: 5, text: 'Clear Stage 5', gems: 12 },
    { kind: 'rushWins', n: 1, text: 'Win a Glass Rush', gems: 15 },
    { kind: 'shoes', n: 8, text: 'Own 8 pairs of sneakers', shards: 500 },
    { kind: 'stage', n: 6, text: 'Clear the last stage (opens Skyline Sprint)', gems: 25 },
    { kind: 'panes', n: 500, text: 'Smash 500 panes', shards: 2000 },
    { kind: 'lv', n: 20, text: 'Reach Level 20', gems: 20 },
    { kind: 'stage', n: 9, text: 'Clear Stage 3 of Skyline Sprint', shards: 6000 },
    { kind: 'rushWins', n: 5, text: 'Win 5 Glass Rushes', gems: 25 },
    { kind: 'stage', n: 12, text: 'Finish Skyline Sprint (opens Frostpane Peaks)', gems: 40 },
    { kind: 'rebirths', n: 6, text: 'Rebirth 6 times', gems: 25 },
    { kind: 'stage', n: 18, text: 'Finish Frostpane Peaks (opens Ember Foundry)', gems: 60 },
    { kind: 'stage', n: 24, text: 'Break through the Starfire Core', gems: 100 },
];

// ----- rewards: the 7-day daily reward, playtime gifts, codes, the Gem shop -----
export const DAILY = [
    { speed: 300 }, { spins: 2 }, { shards: 15 }, { gems: 10 }, { speed: 3000 }, { x2: 30 }, { shards: 200, gems: 30 },
];
export function dailyStatus(d, now) {
    const today = dayKey(now), yest = dayKey(now - 86400000);
    if (!d || !d.last) return { can: true, day: 0, streak: 0 };
    if (d.last === today) return { can: false, day: d.streak % 7, streak: d.streak };
    const streak = d.last === yest ? d.streak : 0;
    return { can: true, day: streak % 7, streak };
}
// FREE gifts for playing (minutes into this session)
export const GIFTS = [
    { min: 2, speed: 100 }, { min: 5, shards: 10 }, { min: 9, spins: 1 }, { min: 14, gems: 8 }, { min: 20, shards: 60 }, { min: 30, x2: 15 }, { min: 45, shards: 400, gems: 10 },
];
export const CODES = lookup({
    GLASS: { speed: 300 }, SMASH: { gems: 5 }, SHATTER: { shards: 10 }, BLOXITY: { spins: 2 }, LEGION: { gems: 5 }, ZOOM: { shards: 5, speed: 200 },
});
export const PACKS = [
    { id: 'p1', gems: 10, k: 2 }, { id: 'p2', gems: 30, k: 8 }, { id: 'p3', gems: 80, k: 30 },
];
// a Gem pack's Shards: more the further you've got
export const packShards = (pack, p) => Math.max(5 * pack.k, Math.round(bestPad(p) * pack.k));
// HTML: Speed (a bolt) and a Shard are drawn (classes "sc", "dc"), Gems are 💎
export function rewardText(r, plain) {
    return [r.speed ? fmt(r.speed) + (plain ? ' Speed' : ' <i class="sc"></i>') : '', r.shards ? fmtComma(r.shards) + (plain ? ' Shards' : ' <i class="dc"></i>') : '', r.gems ? r.gems + ' 💎' : '', r.spins ? r.spins + (r.spins > 1 ? ' spins' : ' spin') : '', r.x2 ? 'x2 Speed ' + r.x2 + ' min' : ''].filter(Boolean).join(' + ');
}

export const BOT_NAMES = [
    'ZoomZoe', 'Dashiell', 'SprintSam', 'xXCrashXx', 'TurboTess', 'PaneInTheGlass', 'SmashMilo', 'QuickQuinn', 'BoltBella', 'RushRuby',
    'GlassKid22', 'ShardShark', 'Flash_Finn', 'NitroNia', 'HurryHank', 'CrackleCal', 'SpeedySue', 'WindowWes', 'TinkleTom', 'FastFern',
];

// ----- helpers -----
export function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 100) / 100) + u[i];
}
export const fmtComma = (v) => { const s = String(Math.floor(v || 0)); return s.length < 4 || /e/.test(s) ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
