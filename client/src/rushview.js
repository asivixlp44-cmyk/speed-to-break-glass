// A Glass Rush on screen: the wide track, its rows of panes in steel frames, solid steel where steel is, the Speed strips
// on the floor, the giant pane and the finish arch, the map's scenery either side. It's built behind a fade when a race
// starts and thrown away when it ends. shared/rush.js works out the course from the seed.
import { T, V3, scene, studVCMaterial } from './engine.js';
import { Kit, glowVCMaterial, batchKits, rng } from './geo.js';
import { buildBlobs, releaseBlobs, forestBlobs } from './blobs.js';
import { Panes } from './glass.js';
import { CU } from './clock.js';
import { Signs, big, THEMES, backdrop } from './world.js';
import { Aura } from './neon.js';
import { RUSH, KINDS, startX } from '../../shared/rush.js';
import { WORLDS, PLACES } from '../../shared/config.js';

const mix = (a, b, k) => new T.Color(a).lerp(new T.Color(b), k).getHex();
export function buildRush(wi, layout, n) {
    const Wd = WORLDS[wi] || WORLDS[0], R = rng(1000 + wi * 77), group = new T.Group(), signs = new Signs(), aura = new Aura();
    const studKits = [], propKits = [];
    const chunk = () => { const a = new Kit(), b = new Kit({ glow: true }); studKits.push(a); propKits.push(b); return { studs: a, props: b, Wd, signs, outer: RUSH.half + 6 }; };
    const env0 = chunk();
    const H = RUSH.half, startZ = RUSH.startZ, trim = Wd.trim;
    // the far ground, the start apron
    env0.props.box(0, -2.2, (layout.finish) / 2, 1800, 2, -layout.finish + 1400, Wd.ground);
    env0.studs.box(0, -1, startZ + 12, H * 2 + 2, 2, 40, Wd.hub, { tile: 8 });
    // the line, the gate that lifts at the gun is a row of bollards (the server holds you back)
    env0.props.box(0, 0.05, startZ - 3, H * 2, 0.06, 2, 0xffffff, { glow: 1 });
    for (let i = 0; i < n; i++) { const x = startX(i, n); env0.props.box(x, 0.04, startZ + 1.5, 6, 0.05, 6, mix(trim, 0xffffff, 0.3)); }
    for (const sx of [-1, 1]) env0.props.box(sx * (H + 1), 14, startZ - 3, 2.6, 28, 2.6, trim, { soft: true });
    env0.props.box(0, 28, startZ - 3, H * 2 + 6, 3.4, 3, trim, { soft: true });
    env0.props.box(0, 26.1, startZ - 1.4, H * 2 + 2, 0.4, 0.2, 0xffffff, { glow: 5.3 });
    signs.add([big('GLASS RUSH', ['#ffffff', '#ffd84a'], 124)], 34, new V3(0, 34, startZ - 3));
    const paneList = [], index = [];
    const steps = 3, perChunk = Math.max(3, Math.ceil(layout.rows.length / steps));
    let env = chunk();
    layout.rows.forEach((row, ri) => {
        if (ri && ri % perChunk === 0) env = chunk();
        const prev = ri ? layout.rows[ri - 1].z : startZ + 2, z0 = prev - (ri ? 0 : 0), z1 = row.z, s2 = env.studs, p2 = env.props, t = ri / layout.rows.length;
        const floor = ri % 2 ? Wd.hub : Wd.hub2, zm = (z0 + z1) / 2, len = z0 - z1;
        s2.box(0, -1, zm, H * 2 + 2, 2, len, mix(floor, Wd.stages[Math.min(5, Math.floor(t * 6))].floor, 0.5), { tile: 8 });
        p2.box(-H - 1.2, 1.2, zm, 2.4, 2.4, len, trim); p2.box(H + 1.2, 1.2, zm, 2.4, 2.4, len, trim);
        for (const sx of [-1, 1]) p2.box(sx * (H + 0.02), 2.2, zm, 0.14, 0.3, len, mix(trim, 0xffffff, 0.25), { glow: 5 + (ri * 0.09) % 0.9 });
        // the panes in their frames
        const fc = 0x5a6a8a;
        for (const pn of row.panes) {
            const K = KINDS[pn.kind], w = pn.x1 - pn.x0, mid = (pn.x0 + pn.x1) / 2;
            if (pn.kind === 'steel') {
                // solid: dark plate with hazard stripes
                s2.box(mid, RUSH.paneH / 2, row.z, w, RUSH.paneH, 1.2, 0x5a6478, { tile: 8 });
                for (let y = 2; y < RUSH.paneH; y += 5) p2.box(mid, y, row.z + 0.66, w - 0.8, 0.8, 0.1, y % 2 ? 0xffd028 : 0x2a2a3a);
            } else {
                index[ri * 16 + pn.c] = paneList.length;
                paneList.push({ x: mid, y: RUSH.paneH / 2, z: row.z, w, h: RUSH.paneH, tint: K.tint, alpha: K.alpha, r: ri, c: pn.c, kind: pn.kind });
                // its kind in neon along the top, so a row can be read from far off
                p2.box(mid, RUSH.paneH - 0.3, row.z + 0.3, w - 0.8, 0.5, 0.14, K.tint, { glow: 5 + (ri * 0.09) % 0.9 });
                if (pn.kind === 'gold') { p2.box(mid, RUSH.paneH + 1.4, row.z, 2, 2, 2, 0xffd028, { glow: 2 }); aura.glow(mid, RUSH.paneH * 0.45, row.z + 0.4, 8, 12, 0xffd028, 0.3); }
                if (pn.kind === 'boss') aura.glow(0, RUSH.paneH * 0.5, row.z + 0.4, H, 15, 0xff7ac8, 0.3);
            }
        }
        if (!row.boss) for (let c = 0; c <= RUSH.cols; c++) p2.box(-H + c * RUSH.colW, RUSH.paneH / 2, row.z, 0.55, RUSH.paneH + 1, 0.8, fc);
        else for (const sx of [-1, 1]) p2.box(sx * H, RUSH.paneH / 2, row.z, 1.2, RUSH.paneH + 1, 1.2, fc);
        p2.box(0, RUSH.paneH + 0.4, row.z, H * 2 + 1, 0.8, 0.9, fc);
        // a row marker on the floor in front
        if (ri % 2 === 0) p2.box(0, 0.05, row.z + 8, 8, 0.05, 1, mix(trim, 0xffffff, 0.5), { glow: 1 });
        if (ri % 3 === 0) {
            THEMES[Wd.id](env, -1, z0 + 2, row.z - layout.gap * 2, R, true);
            THEMES[Wd.id](env, 1, z0 + 2, row.z - layout.gap * 2, R, true);
        }
    });
    // the Speed strips
    for (const b of layout.bolts) {
        const p2 = propKits[Math.min(propKits.length - 1, Math.floor((b.z / layout.rows[layout.rows.length - 1].z) * propKits.length))];
        p2.box(b.x, 0.06, b.z, 8, 0.05, 8, 0x102040);
        for (let k = 0; k < 3; k++) { p2.box(b.x - 1.6, 0.1, b.z + 2.4 - k * 2.4, 4, 0.06, 0.9, 0x6ae8ff, { glow: 5.1, ry: 0.8 }); p2.box(b.x + 1.6, 0.1, b.z + 2.4 - k * 2.4, 4, 0.06, 0.9, 0x6ae8ff, { glow: 5.1, ry: -0.8 }); }
        aura.halo(b.x, 0.14, b.z, 8, 0x6ae8ff, 0.55);
    }
    // the last stretch and the finish arch
    const last = layout.rows[layout.rows.length - 1], envE = chunk();
    envE.studs.box(0, -1, (last.z + layout.finish) / 2 - 16, H * 2 + 2, 2, last.z - layout.finish + 40, 0xf8f4e8, { tile: 8 });
    for (let i = -6; i < 6; i++) for (let j = 0; j < 2; j++) envE.props.box((i + 0.5) * 5, 0.05, layout.finish + 1.25 - j * 2.5, 5, 0.05, 2.5, (i + j) % 2 ? 0x101828 : 0xffffff);
    for (const sx of [-1, 1]) envE.props.box(sx * (H + 1), 14, layout.finish, 2.6, 28, 2.6, 0xffd028, { soft: true });
    envE.props.box(0, 28, layout.finish, H * 2 + 6, 3.4, 3, 0xffd028, { soft: true });
    envE.props.box(0, 26.1, layout.finish + 1.6, H * 2 + 2, 0.4, 0.2, 0xfff4a0, { glow: 5.3 });
    aura.glow(0, 14, layout.finish + 2, H + 6, 16, 0xffd028, 0.22);
    signs.add([big('FINISH', ['#ffffff', '#ffd028'], 124)], 30, new V3(0, 34, layout.finish));
    signs.add([big('THE GIANT PANE', ['#ffffff', '#ffa8e0'], 104), { t: 'Everyone hits it together', c: '#ffe24a', s: '#102040', px: 46 }], 28, new V3(0, 30, last.z));
    forestBlobs(false);
    backdrop(Wd, R, layout.finish);
    signs.build(group);
    aura.build(group);
    const sm = batchKits(studKits, studVCMaterial(), true);
    if (sm) group.add(sm);
    const pm = batchKits(propKits, glowVCMaterial(CU.uNow), true);
    if (pm) group.add(pm);
    buildBlobs(group, () => Math.random());
    const panes = new Panes(group, paneList);
    group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    group.updateMatrixWorld(true);
    scene.add(group);
    let shown = -1;
    const at = (r, c) => index[r * 16 + c];
    return {
        group, panes, at, paneList,
        // the rows from your row on, a few at a time, are drawn
        setRow(row, gone) {
            if (row === shown) return;
            shown = row;
            for (let i = 0; i < paneList.length; i++) { const p = paneList[i]; panes.show(i, p.r >= row - 1 && p.r < row + 7 && !gone(p.r, p.c)); }
        },
        update() { panes.tick(); },
        dispose() {
            releaseBlobs(group);
            signs.dispose();
            aura.dispose();
            panes.dispose();
            group.traverse((o) => { if (o.isBatchedMesh) o.dispose(); else if (o.isMesh && !o.isInstancedMesh && o !== signs.mesh && o !== aura.mesh) o.geometry.dispose(); });
            scene.remove(group);
        },
    };
}
void PLACES;
