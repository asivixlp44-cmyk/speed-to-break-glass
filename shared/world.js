// A world: the spawn (the treadmills on the west side, the sneaker pads on the east, the leaderboards, the worlds
// portal and the Glass Rush gate behind you) and right in front of it the Run: a long corridor to the north (-z),
// six stages of five panes of glass, each stage ending in a Shard Pad. Both sides build it from these numbers: the
// client draws it and moves you on it, the server checks where you say you are and runs its bots on it.
import { WORLDS, TREADS, SHOES, STAGES_PER_WORLD, PANES_PER_STAGE, paneHp, padShards } from './config.js';

export const W = {
    half: 22,             // the Run's half width
    front: -44,           // where the Run leaves the spawn
    paneGap: 26,          // from pane to pane
    stageGap: 44,         // from a stage's last pane to the next stage's first (the pad's in there)
    paneH: 24,            // a pane's height
    spawn: { x: 0, z: 34 },
    floor: { x0: -82, x1: 82, z0: -44, z1: 76 },
    padW: 12,             // a Shard Pad's size
    touch: 3.1,           // how far in front of a pane's plane you push it (your half width and your arms)
};
// the spawn's things: treadmills in two columns west of the middle, you run north on them
export const treads = TREADS.map((t, i) => ({ ...t, i, x: -34 - (i % 2) * 22, z: 48 - Math.floor(i / 2) * 26, w: 9, l: 16 }));
// the sneaker pads: a double row east of the middle, the first one close to the spawn
export const shoePads = SHOES.map((s, i) => ({ ...s, i, x: 30 + (i % 3) * 16, z: 52 - Math.floor(i / 3) * 15, r: 4 }));
export const portal = { x: -22, z: 68, r: 6 };
export const rushGate = { x: 24, z: 68, r: 7 };
export const boards = [{ x: -56, z: 70 }, { x: -72, z: 70 }, { x: 62, z: 70 }];
export const hubChest = { x: 0, z: 66 };

const cache = new Map();
export function worldFor(w) {
    if (cache.has(w)) return cache.get(w);
    const Wd = WORLDS[w] || WORLDS[0], panes = [], stages = [], solids = [];
    let z = W.front - 36;
    for (let k = 0; k < STAGES_PER_WORLD; k++) {
        const S = Wd.stages[k], st = { k, name: S.name, tint: S.tint, floor: S.floor, z0: z + 18, first: panes.length };
        for (let j = 0; j < PANES_PER_STAGE; j++) {
            const i = panes.length;
            panes.push({ i, k, j, z, hp: paneHp(w, i), tint: S.tint, name: S.name });
            z -= W.paneGap;
        }
        z += W.paneGap;
        st.last = panes.length - 1;
        // the pad: on the right, behind the stage's last pane
        st.pad = { x: W.half - W.padW / 2 - 2, z: z - 16, shards: padShards(w, k) };
        st.z1 = z - W.stageGap + 8;
        stages.push(st);
        z -= W.stageGap;
    }
    const end = z + 8;
    // the treadmills' frames, the boards, the portal's posts
    for (const t of treads) {
        for (const sx of [-1, 1]) solids.push({ min: [t.x + sx * (t.w / 2 + 0.2) - 0.6, 0, t.z - t.l / 2], max: [t.x + sx * (t.w / 2 + 0.2) + 0.6, 2.4, t.z + t.l / 2], rail: true });
        solids.push({ min: [t.x - t.w / 2 - 0.5, 0, t.z - t.l / 2 - 2], max: [t.x + t.w / 2 + 0.5, 4.4, t.z - t.l / 2] });
    }
    solids.push({ min: [hubChest.x - 4, 0, hubChest.z - 3], max: [hubChest.x + 4, 6, hubChest.z + 3] });
    for (const s of shoePads) solids.push({ min: [s.x - 3.6, 0, s.z - 3.6], max: [s.x + 3.6, 0.7, s.z + 3.6] });
    for (const b of boards) solids.push({ min: [b.x - 6.5, 0, b.z - 1], max: [b.x + 6.5, 15, b.z + 1] });
    for (const g of [portal, rushGate]) solids.push({ min: [g.x - 9, 0, g.z + 2], max: [g.x - 7, 16, g.z + 4] }, { min: [g.x + 7, 0, g.z + 2], max: [g.x + 9, 16, g.z + 4] });
    const T = { w, Wd, panes, stages, solids, end, n: panes.length };
    T.world = {
        solids, floor: 0,
        clamp(b) {
            if (b.z < W.front + 0.5) {
                if (b.x < -W.half + 1) { b.x = -W.half + 1; if (b.vx < 0) b.vx = 0; } else if (b.x > W.half - 1) { b.x = W.half - 1; if (b.vx > 0) b.vx = 0; }
                if (b.z < end + 1) { b.z = end + 1; if (b.vz < 0) b.vz = 0; }
            } else {
                if (b.x < W.floor.x0 + 1) { b.x = W.floor.x0 + 1; if (b.vx < 0) b.vx = 0; } else if (b.x > W.floor.x1 - 1) { b.x = W.floor.x1 - 1; if (b.vx > 0) b.vx = 0; }
                if (b.z > W.floor.z1 - 1) { b.z = W.floor.z1 - 1; if (b.vz > 0) b.vz = 0; }
                // the floor's north edge: only the Run goes on from there
                if (Math.abs(b.x) > W.half - 1 && b.z < W.front + 1.5) { b.z = W.front + 1.5; if (b.vz < 0) b.vz = 0; }
            }
        },
    };
    cache.set(w, T);
    return T;
}
// the stage a point on the Run is in (-1 at the spawn)
export function stageAt(T, z) {
    if (z >= W.front) return -1;
    for (const s of T.stages) if (z >= s.z1) return s.k;
    return T.stages.length - 1;
}
// is (x, z) on stage k's Shard Pad?
export function onPad(T, k, x, z) {
    const p = T.stages[k] && T.stages[k].pad;
    return !!p && Math.abs(x - p.x) < W.padW / 2 + 0.6 && Math.abs(z - p.z) < W.padW / 2 + 0.6;
}
export function treadAt(x, z) {
    for (const t of treads) if (Math.abs(x - t.x) < t.w / 2 && Math.abs(z - t.z) < t.l / 2) return t;
    return null;
}
export function shoePadAt(x, z) {
    for (const s of shoePads) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return s;
    return null;
}
