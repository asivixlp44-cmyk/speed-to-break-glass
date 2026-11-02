// Glass Rush: one race's course, worked out from its seed on the server and on every racer's screen. Rows of panes
// across a wide track, thin ones and tough ones (and steel you can't break), running north from the start line. A
// pane is shared: once anyone breaks it the hole is there for everyone. The last row is one giant pane everyone
// hammers together, and the finish line is just behind it.
import { rngFrom, rushInfo } from './config.js';

export const RUSH = { half: 30, cols: 5, colW: 12, startZ: 0, firstRow: -46, paneH: 22, touch: 3.1, finishGap: 26 };
// the pane kinds: their health in seconds of an average racer's pushing (steel can't be broken)
export const KINDS = {
    thin: { secs: 0.3, tint: 0xd8f6ff, alpha: 0.32, xp: 1 },
    clear: { secs: 1, tint: 0x7ad8ff, alpha: 0.42, xp: 1 },
    tough: { secs: 2.5, tint: 0x4a7aff, alpha: 0.58, xp: 2 },
    gold: { secs: 1.6, tint: 0xffd84a, alpha: 0.5, xp: 3, bolt: true },
    steel: { secs: 0, tint: 0x5a6478, alpha: 1, steel: true },
    boss: { secs: 0, tint: 0xff7ac8, alpha: 0.5, xp: 5 },
};

// base: the average racer's power in this race; n: how many are racing (the giant pane has to last with all of them on it)
export function rushLayout(seed, lv, base, n) {
    const r = rngFrom(seed), D = rushInfo(lv), rows = [];
    for (let i = 0; i < D.rows; i++) {
        const z = RUSH.firstRow - i * D.gap, cols = [];
        // later rows are tougher than the first ones
        const hard = Math.min(1, D.tough * (0.6 + i / D.rows));
        let open = false;
        for (let c = 0; c < RUSH.cols; c++) {
            const v = r();
            let kind = v < hard * 0.75 ? 'tough' : v < hard * 0.75 + D.steel ? 'steel' : v < 0.72 ? 'clear' : v < 0.93 ? 'thin' : 'gold';
            if (i < 2 && kind === 'steel') kind = 'clear';
            cols.push(kind);
            if (kind !== 'steel') open = true;
        }
        // there's always a way through, and it isn't always straight on
        if (!open) cols[Math.floor(r() * RUSH.cols)] = 'clear';
        // at least one quick way somewhere in most rows, so reading the row pays
        if (!cols.includes('thin') && r() < 0.8) { const c = Math.floor(r() * RUSH.cols); if (cols[c] !== 'steel' || cols.filter((k) => k !== 'steel').length > 1) cols[c] = 'thin'; }
        rows.push({
            i, z,
            panes: cols.map((kind, c) => {
                const K = KINDS[kind];
                return { r: i, c, kind, hp: K.steel ? Infinity : Math.round(base * K.secs * D.hpK * (0.85 + r() * 0.3)), x0: -RUSH.half + c * RUSH.colW, x1: -RUSH.half + (c + 1) * RUSH.colW };
            }),
        });
    }
    // the giant pane
    const bz = RUSH.firstRow - D.rows * D.gap;
    rows.push({ i: D.rows, z: bz, boss: true, panes: [{ r: D.rows, c: 0, kind: 'boss', hp: Math.round(base * 3 * D.hpK * Math.max(2, n || 2)), x0: -RUSH.half, x1: RUSH.half }] });
    // Speed strips on the floor between the rows (running over one is a burst of pace)
    const bolts = [];
    for (let i = 0; i < D.rows; i += 1) { if (r() < 0.55) bolts.push({ i: bolts.length, x: (r() - 0.5) * (RUSH.half * 2 - 8), z: rows[i].z - D.gap * (0.35 + r() * 0.3) }); }
    return { rows, bolts, finish: bz - RUSH.finishGap, n: rows.length, gap: D.gap, limit: D.limit };
}
// the pane at x in a row (a row's panes are side by side; the giant pane is the whole row)
export function paneIn(row, x) {
    const c = row.boss ? 0 : Math.max(0, Math.min(RUSH.cols - 1, Math.floor((x + RUSH.half) / RUSH.colW)));
    return row.panes[c];
}
// the racers' places on the start line
export const startX = (spot, n) => (spot - (n - 1) / 2) * 9;
