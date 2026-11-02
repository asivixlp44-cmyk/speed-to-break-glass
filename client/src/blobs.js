// Soft, rounded blocks (smooth-plastic trees, bushes, boulders, rocks and hills): every one in a
// scene is an instance of one bevelled block, in one draw (plus one for the far hills, which cast no
// shadows). Colour per instance, a gentle wind in the leaves and a darker underside (soft
// self-shade) are all in the shader, so a canopy of a few blocks reads as round and full.
import { T, scene, selfLit } from './engine.js';
import { softBlockGeo } from './geo.js';
import { CU } from './clock.js';

// core: near the road (always drawn); forest: further out (Low draws part of it); far: the hills on the
// horizon (no shadows)
const core = [], forest = [], far = [];
// a block centred at (x, y, z), size (sx, sy, sz), colour c; o: { ry, rx, rz, sway (0 stone .. 1 leaves), forest, far }
let forestMode = false;
export function blob(x, y, z, sx, sy, sz, c, o) {
    o = o || {};
    (o.far ? far : (o.forest ?? forestMode) ? forest : core).push([x, y, z, sx, sy, sz, c, o.ry || 0, o.rx || 0, o.rz || 0, o.sway ?? 1]);
}
// while on, new blocks are forest (the trees out to the beach)
export function forestBlobs(on) { forestMode = !!on; }

function blobMaterial() {
    const m = new T.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uNow = CU.uNow;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aSway; uniform float uNow; varying float vUnder;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vUnder = smoothstep(-0.55, 0.45, position.y);
if (aSway > 0.0) {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float w = sin(uNow * 1.25 + ip.x * 0.045 + ip.z * 0.06) + 0.35 * sin(uNow * 2.3 + ip.z * 0.11);
    float k = (position.y + 0.5) * aSway;
    transformed.x += w * 0.035 * k;
    transformed.z += w * 0.025 * k;
}`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vUnder;`).replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix(0.7, 1.06, vUnder);`);
    };
    m.customProgramCacheKey = () => 'j1-blobs';
    return m;
}
export const blobMat = selfLit(blobMaterial());
const tc = new T.Color(), hsl = { h: 0, s: 0, l: 0 };
// Far away a block is a plain box (12 triangles instead of the rounded block's 44): a forest track has 15-18
// thousand of them, by far the most triangles on screen, and past ~150 studs in the haze nobody sees the
// bevel (blobLod). Big blocks (mesas, boulders) and the horizon's hills keep their round edges at any distance.
const LOD_FAR = 170, LOD_NEAR = 150, BIG = 26;
let lowGeo = null;
function mesh(list, geo, shadows, R, lod) {
    const n = list.length;
    const g = geo.clone();
    const sway = new Float32Array(n);
    const im = new T.InstancedMesh(g, blobMat, n);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
    list.forEach(([x, y, z, sx, sy, sz, c, ry, rx, rz, sw], k) => {
        q.setFromEuler(e.set(rx, ry, rz, 'YXZ'));
        im.setMatrixAt(k, m4.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));
        // a touch of variety: no two blocks of a canopy quite the same green
        tc.set(c).getHSL(hsl);
        tc.setHSL(hsl.h + (R() - 0.5) * 0.015, hsl.s, Math.min(1, hsl.l * (0.94 + R() * 0.12)));
        im.setColorAt(k, tc);
        sway[k] = sw;
    });
    const swayAttr = new T.InstancedBufferAttribute(sway, 1);
    g.setAttribute('aSway', swayAttr);
    if (lod) {
        const lo = (lowGeo || (lowGeo = new T.BoxGeometry(1, 1, 1))).clone();
        lo.setAttribute('aSway', swayAttr);
        im.userData.lod = { hi: g, lo, low: false };
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadows; im.receiveShadow = true;
    im.matrixAutoUpdate = false;
    return im;
}
const nears = [];
let detail = 1, blockGeo = null;
// Builds what was placed since the last call into parent (each scene, the plaza and every tower, calls it
// once). The near blocks go in one mesh per square of the map, so the ones off screen (or out of the
// shadow's reach) aren't drawn at all.
const CELL = 380;
export function buildBlobs(parent, R) {
    const geo = blockGeo || (blockGeo = softBlockGeo(0.24)), cells = new Map();
    const put = (list, k) => { for (const b of list) { const key = Math.floor(b[0] / CELL) * 4096 + Math.floor(b[2] / CELL); let c = cells.get(key); if (!c) { c = [[], []]; cells.set(key, c); } c[k].push(b); } };
    // the big ones apart: one mesh, always round, always drawn whole
    const big = (b) => Math.max(b[3], b[4], b[5]) > BIG, bigs = core.filter(big).concat(forest.filter(big));
    put(core.filter((b) => !big(b)), 0); put(forest.filter((b) => !big(b)), 1);
    for (const [c, f] of cells.values()) { const m = mesh(c.concat(f), geo, true, R, true); m.userData.coreN = c.length; nears.push(m); parent.add(m); }
    if (bigs.length) parent.add(mesh(bigs, geo, true, R));
    if (far.length) parent.add(mesh(far, geo, false, R));
    core.length = 0; forest.length = 0; far.length = 0;
    blobDetail(detail);
}
const disposeGeo = (m) => { const L = m.userData.lod; if (L) { L.hi.dispose(); L.lo.dispose(); } else m.geometry.dispose(); };
// Before each frame: each square of the map's blocks round when its nearest edge is close to the camera,
// boxes when it's far (a little apart either way, so a square on the edge doesn't flip back and forth)
export function blobLod(cam) {
    const p = cam.position;
    for (const m of nears) {
        const L = m.userData.lod;
        if (!L || !m.parent) continue;
        const sp = m.boundingSphere, d = sp.center.distanceTo(p) - sp.radius;
        const low = L.low ? d > LOD_NEAR : d > LOD_FAR;
        if (low !== L.low) { L.low = low; m.geometry = low ? L.lo : L.hi; }
    }
}
// a track thrown away: its blocks go too
export function releaseBlobs(group) {
    for (let i = nears.length - 1; i >= 0; i--) {
        let o = nears[i];
        while (o && o !== group) o = o.parent;
        if (o === group || !nears[i].parent) { disposeGeo(nears[i]); nears.splice(i, 1); }
    }
    group.traverse((o) => { if (o.isInstancedMesh && o.material === blobMat) { disposeGeo(o); o.dispose(); } });
}
// Low quality draws the core blocks and part of the forest (the forest was placed in random order, so
// what's left is evenly thinned)
export function blobDetail(k) {
    detail = k;
    for (const m of nears) {
        const n = m.instanceMatrix.count, c = m.userData.coreN;
        m.count = k >= 1 ? n : Math.max(c, Math.round(c + (n - c) * k));
    }
}
void scene;
