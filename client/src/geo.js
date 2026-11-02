// Geometry helpers: a "voxel kit" that writes coloured boxes straight into one vertex array (one
// mesh, one draw, one material for a whole prop), rounded blocks, and merging.
import { T, selfLit } from './engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tc = new T.Color(), te = new T.Euler(), tq = new T.Quaternion(), tv = new T.Vector3(), tn = new T.Vector3();
// unit cube corners per face: normal, then 4 corners (counter-clockwise seen from outside)
const FACES = [
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
];
// Shading baked into the vertex colours (the reference's blocky plants have it): tops a touch
// brighter, bottoms darker, so stacked cubes read as separate blocks even in the shade
const SHADE = [0.94, 0.86, 1.06, 0.72, 0.98, 0.9];

export class Kit {
    constructor(o) {
        o = o || {};
        this.pos = []; this.nor = []; this.col = []; this.uv = [];
        this.part = o.parts ? [] : null;    // per-vertex part (plants: 0 soil, 1 stem, 2 leaf, 3 fruit)
        this.glow = o.glow ? [] : null;     // per-vertex glow (0 lit, 1 glowing / unlit, 2 glowing and bobbing)
        this.cen = o.parts ? [] : null;     // per-vertex pivot the part scales round (fruit centres)
        this.noShade = !!o.noShade;
    }
    // A box centred at (x, y, z), size (sx, sy, sz), colour c; o: { part, cx, cy, cz (pivot), rx, ry, rz (turn), shade,
    // uv: [u0,v0,u1,v1] (every face), tile: world size of one texture tile (studs line up on every face) }
    box(x, y, z, sx, sy, sz, c, o) {
        o = o || {};
        tc.set(c);
        const turned = o.rx || o.ry || o.rz;
        if (turned) tq.setFromEuler(te.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ'));
        const part = o.part || 0, pcx = o.cx ?? x, pcy = o.cy ?? y, pcz = o.cz ?? z;
        const shade = o.shade ?? 1;
        // o.soft: a bevelled block (softBlockGeo), its face shading blending across the bevels
        if (o.soft) {
            const S = softTemplate();
            for (let v = 0; v < S.n; v++) {
                tv.set(S.pos[v * 3] * sx, S.pos[v * 3 + 1] * sy, S.pos[v * 3 + 2] * sz);
                tn.set(S.nor[v * 3] / sx, S.nor[v * 3 + 1] / sy, S.nor[v * 3 + 2] / sz).normalize();
                if (turned) { tv.applyQuaternion(tq); tn.applyQuaternion(tq); }
                const k = (this.noShade || o.glow ? 1 : SHADE[S.face[v]]) * shade;
                this.pos.push(x + tv.x, y + tv.y, z + tv.z);
                this.nor.push(tn.x, tn.y, tn.z);
                this.col.push(tc.r * k, tc.g * k, tc.b * k);
                this.uv.push(0, 0);
                if (this.part) { this.part.push(part); this.cen.push(pcx, pcy, pcz); }
                if (this.glow) this.glow.push(o.glow || 0);
            }
            return this;
        }
        for (let f = 0; f < 6; f++) {
            const [n, corners] = FACES[f];
            tn.set(n[0], n[1], n[2]);
            if (turned) tn.applyQuaternion(tq);
            const k = (this.noShade || o.glow ? 1 : SHADE[f]) * shade;
            const idx = [0, 1, 2, 0, 2, 3];
            for (const i of idx) {
                const cn = corners[i];
                tv.set(cn[0] * sx / 2, cn[1] * sy / 2, cn[2] * sz / 2);
                if (turned) tv.applyQuaternion(tq);
                this.pos.push(x + tv.x, y + tv.y, z + tv.z);
                this.nor.push(tn.x, tn.y, tn.z);
                this.col.push(tc.r * k, tc.g * k, tc.b * k);
                if (o.uv) { const [u0, v0, u1, v1] = o.uv; this.uv.push(i === 0 || i === 3 ? u0 : u1, i < 2 ? v0 : v1); }
                else if (o.tile) { const fw = f < 2 ? sz : sx, fh = f === 2 || f === 3 ? sz : sy; this.uv.push(i === 0 || i === 3 ? 0 : fw / o.tile, i < 2 ? 0 : fh / o.tile); }
                else this.uv.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
                if (this.part) { this.part.push(part); this.cen.push(pcx, pcy, pcz); }
                if (this.glow) this.glow.push(o.glow || 0);
            }
        }
        return this;
    }
    // a flat square (leaf, decal) lying in xz at height y, turned ry
    flat(x, y, z, sx, sz, c, o) { return this.box(x, y, z, sx, 0.12, sz, c, o); }
    // a quad through four corners [x, y, z] (counter-clockwise seen from its front) with one flat normal;
    // o: { uv: [u0, v0, u1, v1], glow, shade, c2 (the colour of the far edge, c..d) }
    quad(a, b, c, d, color, o) {
        o = o || {};
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        tc.set(color);
        const r0 = tc.r, g0 = tc.g, b0 = tc.b;
        if (o.c2 !== undefined) tc.set(o.c2);
        const k = o.shade ?? 1, uv = o.uv || [0, 0, 1, 1];
        const P = [a, b, c, a, c, d], U = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
        for (let i = 0; i < 6; i++) {
            const p = P[i], far = p === c || p === d;
            this.pos.push(p[0], p[1], p[2]);
            this.nor.push(nx, ny, nz);
            if (far && o.c2 !== undefined) this.col.push(tc.r * k, tc.g * k, tc.b * k); else this.col.push(r0 * k, g0 * k, b0 * k);
            this.uv.push(U[i][0], U[i][1]);
            if (this.part) { this.part.push(0); this.cen.push(0, 0, 0); }
            if (this.glow) this.glow.push(o.glow || 0);
        }
        return this;
    }
    // a vertex-coloured geometry (bakeVC's, say) placed by matrix m4, into this kit; glow as box's o.glow
    addGeo(g, m4, glow) {
        const src = g.index ? g.toNonIndexed() : g, p = src.attributes.position, n = src.attributes.normal, c = src.attributes.color;
        const nm = new T.Matrix3().getNormalMatrix(m4);
        for (let i = 0; i < p.count; i++) {
            tv.fromBufferAttribute(p, i).applyMatrix4(m4);
            this.pos.push(tv.x, tv.y, tv.z);
            tn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
            this.nor.push(tn.x, tn.y, tn.z);
            if (c) this.col.push(c.getX(i), c.getY(i), c.getZ(i)); else this.col.push(1, 1, 1);
            this.uv.push(0, 0);
            if (this.part) { this.part.push(0); this.cen.push(0, 0, 0); }
            if (this.glow) this.glow.push(glow || 0);
        }
        if (src !== g) src.dispose();
        return this;
    }
    // the same quad, wound so its front faces the direction want [x, y, z] (a triangle: pass c twice)
    faceTo(a, b, c, d, want, color, o) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = (d === a ? c : d)[0] - a[0], vy = (d === a ? c : d)[1] - a[1], vz = (d === a ? c : d)[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) return this.quad(a, b, c, d, color, o);
        return this.quad(a, d, c, b, color, o);
    }
    // A body lofted through cross-sections (a car's shell): rings [{ z, pts: [[x, y], ...] }] in order along z,
    // the same number of points each, round the section. color(r, f): the colour of the face between ring r
    // and r + 1 on side f (or null: leave it out, e.g. for glass drawn in another kit); caps both ends
    // (cap: the colour of the front and back faces). Every face points out from the section's middle.
    loft(rings, color, cap, o) {
        const mid = (R) => { let y0 = 1e9, y1 = -1e9; for (const p of R.pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return (y0 + y1) / 2; };
        for (let r = 0; r < rings.length - 1; r++) {
            const A = rings[r], B = rings[r + 1], m = A.pts.length, cy = (mid(A) + mid(B)) / 2;
            for (let f = 0; f < m; f++) {
                const c = color(r, f);
                if (c === null) continue;
                const a0 = A.pts[f], a1 = A.pts[(f + 1) % m], b0 = B.pts[f], b1 = B.pts[(f + 1) % m];
                const want = [(a0[0] + a1[0] + b0[0] + b1[0]) / 4, (a0[1] + a1[1] + b0[1] + b1[1]) / 4 - cy, 0];
                this.faceTo([a0[0], a0[1], A.z], [a1[0], a1[1], A.z], [b1[0], b1[1], B.z], [b0[0], b0[1], B.z], want, c, o);
            }
        }
        if (cap !== undefined && cap !== null) {
            for (const [R, dir] of [[rings[0], Math.sign(rings[0].z - rings[1].z)], [rings[rings.length - 1], Math.sign(rings[rings.length - 1].z - rings[rings.length - 2].z)]]) {
                const cy = mid(R), m = R.pts.length;
                for (let f = 0; f < m; f++) {
                    const a = R.pts[f], b = R.pts[(f + 1) % m];
                    this.faceTo([0, cy, R.z], [a[0], a[1], R.z], [b[0], b[1], R.z], [b[0], b[1], R.z], [0, 0, dir], cap, o);
                }
            }
        }
        return this;
    }
    get count() { return this.pos.length / 3; }
    geometry() {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
        if (this.glow) g.setAttribute('aGlow', new T.Float32BufferAttribute(this.glow, 1));
        if (this.part) {
            g.setAttribute('aPart', new T.Float32BufferAttribute(this.part, 1));
            g.setAttribute('aC', new T.Float32BufferAttribute(this.cen, 3));
        }
        g.computeBoundingSphere();
        return g;
    }
}

// A cube with rounded edges (one bevel step, smooth normals), centred, side `size`, bevel r
export function roundedBlockGeo(size, r) {
    const h = size / 2, i = h - r;
    const pos = [], nor = [], idx = [];
    const faces = [
        [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const ts = [-h, -i, i, h];
    for (const [N, Uu, V] of faces) {
        const base = pos.length / 3;
        for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
            const u = ts[a], v = ts[b];
            const p = [N[0] * h + Uu[0] * u + V[0] * v, N[1] * h + Uu[1] * u + V[1] * v, N[2] * h + Uu[2] * u + V[2] * v];
            const q = p.map((x) => Math.max(-i, Math.min(i, x)));
            const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], l = Math.hypot(d[0], d[1], d[2]);
            const nn = l > 1e-6 ? d.map((x) => x / l) : N;
            pos.push(q[0] + nn[0] * r, q[1] + nn[1] * r, q[2] + nn[2] * r);
            nor.push(nn[0], nn[1], nn[2]);
        }
        for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
            const k = base + b * 4 + a;
            idx.push(k, k + 1, k + 5, k, k + 5, k + 4);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
}
// rounded box (w x h x l)
export function rbox(w, h, l, r) { const g = roundedBlockGeo(1, r ?? 0.2); g.scale(w, h, l); return g; }

// the bevelled block as flat arrays for Kit.box({ soft }): positions, normals, and the face each vertex
// belongs to (its shading)
let softT = null;
function softTemplate() {
    if (softT) return softT;
    const g = softBlockGeo(0.24).toNonIndexed(), p = g.attributes.position.array, n = g.attributes.normal.array, cnt = p.length / 3, face = new Uint8Array(cnt);
    for (let v = 0; v < cnt; v++) { const nx = n[v * 3], ny = n[v * 3 + 1], nz = n[v * 3 + 2]; face[v] = nx > 0.5 ? 0 : nx < -0.5 ? 1 : ny > 0.5 ? 2 : ny < -0.5 ? 3 : nz > 0.5 ? 4 : 5; }
    softT = { pos: Float32Array.from(p), nor: Float32Array.from(n), face, n: cnt };
    g.dispose();
    return softT;
}
// A unit cube with chamfered edges and corners (24 vertices, 44 triangles): each face keeps its own
// normal and the chamfers blend between them, so under the light it reads as a soft, rounded block
// (the reference's smooth-plastic trees and hedges) at well under half the triangles of a rounded one.
export function softBlockGeo(r) {
    const h = 0.5, i = 0.5 - r, pos = [], nor = [], id = new Map(), idx = [];
    const vert = (a, s) => id.get(a + ':' + s.join(','));
    for (let a = 0; a < 3; a++) for (const sa of [-1, 1]) for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
        const s = [0, 0, 0], p = [0, 0, 0], n = [0, 0, 0], [b, c] = [(a + 1) % 3, (a + 2) % 3];
        s[a] = sa; s[b] = s1; s[c] = s2;
        p[a] = sa * h; p[b] = s1 * i; p[c] = s2 * i; n[a] = sa;
        id.set(a + ':' + s.join(','), pos.length / 3);
        pos.push(...p); nor.push(...n);
    }
    const tri = (A, B, C) => {
        // wind every triangle to face outward (the block is convex round its centre)
        const P = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]], [p, q, w] = [P(A), P(B), P(C)];
        const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (n[0] * (p[0] + q[0] + w[0]) + n[1] * (p[1] + q[1] + w[1]) + n[2] * (p[2] + q[2] + w[2]) < 0) idx.push(A, C, B); else idx.push(A, B, C);
    };
    const quad = (A, B, C, D) => { tri(A, B, C); tri(A, C, D); };
    const S = (a, va, b, vb, c, vc) => { const s = [0, 0, 0]; s[a] = va; s[b] = vb; s[c] = vc; return s; };
    for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3, c = (a + 2) % 3;
        for (const sa of [-1, 1]) {
            // the face
            quad(vert(a, S(a, sa, b, -1, c, -1)), vert(a, S(a, sa, b, 1, c, -1)), vert(a, S(a, sa, b, 1, c, 1)), vert(a, S(a, sa, b, -1, c, 1)));
            // the chamfer between this face and the face on axis b
            for (const sb of [-1, 1]) quad(vert(a, S(a, sa, b, sb, c, -1)), vert(a, S(a, sa, b, sb, c, 1)), vert(b, S(a, sa, b, sb, c, 1)), vert(b, S(a, sa, b, sb, c, -1)));
        }
    }
    // the corners
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const s = [sx, sy, sz]; tri(vert(0, s), vert(1, s), vert(2, s)); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
}
// a flat face (facing +z) on both sides: itself and a copy turned round, so the text on it reads right
// from the front and from behind (a one-sided material, still one draw; a double-sided one mirrors it)
export function twoSided(g) { return mergeGeometries([g, g.clone().rotateY(Math.PI)]); }

// Several geometries (already placed) as one; drops attributes they don't all share
export function merge(list) {
    const keys = Object.keys(list[0].attributes).filter((k) => list.every((g) => g.attributes[k]));
    const ready = list.map((g) => {
        const x = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(x.attributes)) if (!keys.includes(k)) x.deleteAttribute(k);
        return x;
    });
    return mergeGeometries(ready);
}

// A seeded random (the same layout every visit)
export function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Bakes every mesh under root into ONE vertex-coloured mesh (each part keeps its material's colour):
// a blocky figure or prop becomes a single draw. root keeps its transform.
export function bakeVC(root, material) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4(), list = [], done = [];
    root.traverse((o) => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
        const c = o.material.color || new T.Color(1, 1, 1), n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        g.setAttribute('color', new T.BufferAttribute(col, 3));
        list.push(g); done.push(o);
    });
    for (const o of done) o.parent.remove(o);
    for (const c of [...root.children]) if (c.isGroup && !c.children.length) root.remove(c);
    const mesh = new T.Mesh(mergeGeometries(list), material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
    for (const g of list) g.dispose();
    return mesh;
}

// Kits that share a material (a track's stretches of road, its areas of scenery) as one BatchedMesh: each
// kit is still culled on its own when it's off screen (and out of the sun's shadow view), but everything
// in view goes to the graphics card in a single draw. On a weak laptop a draw costs the CPU far more than
// its triangles cost the GPU: a track was ~110 draws, now one per material.
// The batch's own culling is off: it uploads its list of what to draw every frame (a texture upload per
// batch per frame cost more than the draws saved). cullBatches tests the kits here and changes the list
// only when one comes into view or goes out of it.
const batches = new Set();
export function batchKits(kits, material, cast) {
    const list = kits.filter((k) => k.count).map((k) => k.geometry());
    if (!list.length) return null;
    // QA only (__qa.legacy): a mesh per kit, as it was, to measure against
    if (globalThis.__ovtLegacy) {
        const g = new T.Group();
        for (const geo of list) { const m = new T.Mesh(geo, material); m.castShadow = !!cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m); }
        return g;
    }
    let mesh;
    if (list.length === 1) mesh = new T.Mesh(list[0], material);
    else {
        // indexed geometry needs index space too
        let nv = 0, ni = 0;
        for (const g of list) { nv += g.attributes.position.count; if (g.index) ni += g.index.count; }
        mesh = new T.BatchedMesh(list.length, nv, ni, material);
        mesh.perObjectFrustumCulled = false; mesh.sortObjects = false;
        const spheres = [], ids = [];
        for (const g of list) { ids.push(mesh.addInstance(mesh.addGeometry(g))); spheres.push(g.boundingSphere.clone()); g.dispose(); }
        mesh.userData.cull = { spheres, ids };
        batches.add(mesh);
        const dispose = mesh.dispose.bind(mesh);
        mesh.dispose = () => { batches.delete(mesh); return dispose(); };
    }
    mesh.castShadow = !!cast; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    return mesh;
}
const cullF = new T.Frustum(), shadowF = new T.Frustum(), cullM = new T.Matrix4();
// Before each frame: each batched kit is drawn when the camera sees it, or (shadowCam: the sun's shadow
// view, when shadows are on) when it may throw a shadow into view
export function cullBatches(camera, shadowCam) {
    if (!batches.size) return;
    camera.updateMatrixWorld();
    cullF.setFromProjectionMatrix(cullM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (shadowCam) shadowF.setFromProjectionMatrix(cullM.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse));
    for (const b of batches) {
        if (!b.parent) continue;
        const { spheres, ids } = b.userData.cull, sh = shadowCam && b.castShadow;
        for (let i = 0; i < spheres.length; i++) b.setVisibleAt(ids[i], cullF.intersectsSphere(spheres[i]) || (sh && shadowF.intersectsSphere(spheres[i])));
    }
}
// what to dispose of a mesh a track made: a batch owns its own data textures as well
export const disposable = (m) => (m.isBatchedMesh || m.isInstancedMesh ? m : m.geometry);

// One material for lit, glowing (unlit, a touch bright) and glowing-and-bobbing vertex-coloured parts,
// so a whole prop with neon trims and floating arrows is a single draw. Kit({ glow: true }), box o.glow:
// 0 lit, 1 glowing, 2 glowing and bobbing, 3.xx lit and gently bouncing (phase .xx: the shop keepers),
// 4 lit and swaying in the wind by height above the ground (grass tufts, palm fronds), 5.xx neon: glowing, a wave of
// brightness chasing along it (phase .xx).
export function glowVCMaterial(uNow) {
    const m = new T.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uNow = uNow;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aGlow; uniform float uNow; varying float vGlow; varying float vPulse;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow > 4.9 ? 1.0 : aGlow > 2.5 ? 0.0 : min(aGlow, 1.0);
vPulse = aGlow > 4.9 ? 0.5 + 0.5 * sin(uNow * 3.2 + fract(aGlow) * 6.2832 + (position.x + position.z) * 0.16) : 0.0;
if (aGlow > 4.9) { }
else if (aGlow > 3.9) { float w = sin(uNow * 2.1 + position.x * 0.31 + position.z * 0.23) + 0.4 * sin(uNow * 3.3 + position.z * 0.5); float hh = clamp(position.y - 0.05, 0.0, 1.5); transformed.x += w * 0.09 * hh; transformed.z += w * 0.05 * hh; }
else if (aGlow > 2.5) transformed.y += abs(sin(uNow * 1.6 + fract(aGlow) * 6.2832)) * 0.14;
else if (aGlow > 1.5) transformed.y += sin(uNow * 3.0 + position.x * 0.07 + position.z * 0.05) * 0.35;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vGlow; varying float vPulse;`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlow * (1.15 + vPulse * 0.6);
diffuseColor.rgb *= 1.0 - vGlow;`);
    };
    m.customProgramCacheKey = () => 'gae-glowvc';
    return selfLit(m);
}
