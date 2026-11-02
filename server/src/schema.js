import { schema, t } from '@colyseus/schema';

// Public, synced to every client: the server's clock and everyone running round the worlds (players and the
// bots) or racing (match: the race they're in). Private progress (Speed, Shards, Gems, sneakers, quests...) goes
// only to its owner in "profile". Positions carry a server-time stamp (t): other clients smooth them on that timeline.
export const PlayerState = schema({
    name: t.string().default(''),
    pid: t.uint8().default(0),
    bot: t.boolean().default(false),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.float32().default(0),
    t: t.float64().default(0),       // when they were there (server ms)
    anim: t.uint8().default(0),      // 0 idle, 1 run, 2 air, 3 pushing glass
    lv: t.uint16().default(1),
    tr: t.float64().default(0),      // Shards collected (the rank on the name tag)
    world: t.uint8().default(0),
    prog: t.uint8().default(0),      // the pane they're up to (the progress bar)
    match: t.uint16().default(0),    // the Glass Rush they're in (0: none)
    shoes: t.uint8().default(0),     // how many sneakers they own (the pair on their feet)
    trail: t.uint8().default(0),
    aura: t.uint8().default(0),
    av: t.string().default(''),      // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    now: t.float64().default(0),     // the server's clock, every patch
    players: t.map(PlayerState),
}, 'GameState');
