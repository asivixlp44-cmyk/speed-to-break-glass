// Moving and jumping, shared: your own character runs it on your screen every frame, the server runs it for
// the bots. A body is a box (HW wide each way, PH tall) against axis-aligned boxes (the plaza's props, a
// tower's walls), with the top games' feel: the velocity eases toward where you steer (quick on the ground,
// floatier in the air), a little coyote time, steps up small ledges, and a jump released early stops rising
// at a hop's speed (tap for quick hops, hold for your full power).
import { CFG, jumpV } from './config.js';

export const HW = 1, PH = 5, STEP = 1.25;

export function newBody(x, y, z) {
    return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, ground: null, coyote: 0, rising: false, airJumps: 0, airT: 0, dashT: 0, pound: false, wasGround: true };
}

const overlaps = (c, x, y, z) => c.max[0] > x - HW && c.min[0] < x + HW && c.max[1] > y && c.min[1] < y + PH && c.max[2] > z - HW && c.min[2] < z + HW;
function freeAt(list, x, y, z) { for (const c of list) if (overlaps(c, x, y, z)) return false; return true; }
const AX = { x: 0, y: 1, z: 2 };
function moveAxis(b, list, axis, d) {
    if (d === 0) return;
    const i = AX[axis];
    b[axis] += d;
    for (const c of list) {
        if (!overlaps(c, b.x, b.y, b.z)) continue;
        if (axis === 'y') {
            if (d < 0) { if (c.max[1] - b.y > Math.max(STEP, -d + 0.05)) continue; b.y = c.max[1]; if (b.vy < 0) b.vy = 0; b.onGround = true; b.ground = c; }
            else { if (b.y + PH - c.min[1] > d + 0.05) continue; b.y = c.min[1] - PH - 1e-4; if (b.vy > 0) b.vy = 0; b.rising = false; }
        } else {
            // a small ledge: step up onto it (walking, or falling past its edge)
            const rise = c.max[1] - b.y;
            if (rise > 0 && rise <= STEP && !c.noStep && (b.onGround || b.vy <= 0) && freeAt(list, b.x, c.max[1] + 0.01, b.z)) { b.y = c.max[1] + 0.001; continue; }
            b[axis] = d > 0 ? c.min[i] - HW - 1e-4 : c.max[i] + HW + 1e-4;
            if (axis === 'x') b.vx = 0; else b.vz = 0;
        }
    }
}
function groundProbe(b, list, maxDrop, floorY) {
    let best = -Infinity, bs = null;
    for (const c of list) {
        if (c.max[0] <= b.x - HW || c.min[0] >= b.x + HW || c.max[2] <= b.z - HW || c.min[2] >= b.z + HW) continue;
        if (c.max[1] <= b.y + 0.01 && c.max[1] >= b.y - maxDrop && c.max[1] > best) { best = c.max[1]; bs = c; }
    }
    if (!bs && floorY !== null && b.y - maxDrop <= floorY) { best = floorY; bs = FLOOR; }
    if (bs) { b.y = best; b.onGround = true; b.ground = bs; if (b.vy < 0) b.vy = 0; }
}
const FLOOR = { min: [0, 0, 0], max: [0, 0, 0], floor: true };

// One step. inp: { mx, mz (where to go, length <= 1), jump (pressed this step), hold (jump still held),
// power (your jump power), double (has Double Jump), dash (dash pressed), pound (pound pressed), speed (x walk) }
// world: { solids (boxes {min:[x,y,z], max:[x,y,z]}), floor (y of an endless floor, or null), clamp(b) }
// Returns what happened: 0 nothing, 1 jumped off the ground, 2 jumped in the air, 3 landed, 4 landed from a pound
export function stepBody(b, inp, dt, world) {
    let ev = 0;
    const list = world.solids;
    if (b.onGround) { b.coyote = 0.1; b.airJumps = 0; b.airT = 0; } else { b.coyote -= dt; b.airT += dt; }
    if (inp.jump) {
        if (b.onGround || b.coyote > 0) { b.vy = jumpV(inp.power); b.onGround = false; b.ground = null; b.coyote = 0; b.rising = true; ev = 1; }
        else if (inp.double && b.airJumps < 1 && !b.pound) { b.airJumps++; b.vy = jumpV(inp.power) * 0.75; b.rising = true; ev = 2; }
    }
    // let go early: a hop
    if (b.rising && !inp.hold && b.vy > CFG.hopV) b.vy = CFG.hopV;
    if (b.vy <= 0) b.rising = false;
    if (inp.pound && !b.onGround && !b.pound) { b.pound = true; b.vy = -CFG.fallMax * 0.85; b.rising = false; }
    if (inp.dash && !b.onGround && b.dashT <= 0) {
        const l = Math.hypot(inp.mx, inp.mz) || 1, fx = inp.fx ?? inp.mx / l, fz = inp.fz ?? inp.mz / l;
        b.vx = fx * CFG.airDash; b.vz = fz * CFG.airDash; b.dashT = 0.22; if (b.vy < 6) b.vy = 6;
    }
    b.vy = Math.max(-CFG.fallMax, b.vy - CFG.grav * dt);
    const ws = CFG.walk * (inp.speed || 1);
    // inp.grip: the ground under you (1 normal, below 1 slippery: soap, slime; above 1 grippy: sand)
    const grip = b.onGround ? 30 * (inp.grip ?? 1) : 12;
    if (b.dashT > 0) b.dashT -= dt;
    else {
        b.vx += (inp.mx * ws - b.vx) * Math.min(1, dt * grip);
        b.vz += (inp.mz * ws - b.vz) * Math.min(1, dt * grip);
    }
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vz), Math.abs(b.vy)) * dt / 0.5)), sdt = dt / n;
    const wasOn = b.onGround;
    b.onGround = false; b.ground = null;
    for (let i = 0; i < n; i++) {
        moveAxis(b, list, 'x', b.vx * sdt); moveAxis(b, list, 'z', b.vz * sdt);
        moveAxis(b, list, 'y', b.vy * sdt);
        if (world.floor !== null && b.y <= world.floor) { b.y = world.floor; if (b.vy < 0) b.vy = 0; b.onGround = true; b.ground = FLOOR; }
        if (world.clamp) world.clamp(b);
    }
    if (!b.onGround && wasOn && b.vy <= 0) groundProbe(b, list, 0.7, world.floor);
    else if (!b.onGround && b.vy <= 0) groundProbe(b, list, 0.05, world.floor);
    if (b.onGround && !wasOn) { ev = b.pound ? 4 : 3; b.pound = false; b.dashT = 0; }
    return ev;
}
