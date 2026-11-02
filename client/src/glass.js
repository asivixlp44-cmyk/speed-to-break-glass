// The glass. Every standing pane of a world (or a race) is one instance of one quad in one draw: its tint, its
// health and where it was first hit are per-instance numbers, and nothing is drawn or uploaded unless a pane changes.
// Cracks come from one texture: every crack line stores when it appears (how much damage it takes), so cracks grow out
// from the impact and thicken as the pane gets weaker, for one texture read per pixel. No reflections and no
// environment map: the sheen is two painted bands, the pane is unlit.
//
// When a pane goes, its shards fly on the graphics card: each is a triangle with a start, a velocity and a spin,
// written once; the vertex shader works out where it is (gravity, a bounce off the floor, shrinking away at the end).
// A burst costs a few small uploads and no work per frame after that.
import { T, scene } from './engine.js';
import { CU } from './clock.js';

// ----- the crack map: R when a line appears (1 first .. 0 last), G a soft dark halo round it -----
const CRACK_SIZE = 72;      // studs across
function crackTexture() {
    const N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
    x.globalCompositeOperation = 'lighten';
    x.lineCap = 'round'; x.lineJoin = 'round';
    let s = 77;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const C = N / 2, R = N * 0.5;
    // one piece of crack, from (a) to (b): its order follows how far out it is
    const seg = (ax, ay, bx, by, w) => {
        const d = Math.hypot((ax + bx) / 2 - C, (ay + by) / 2 - C) / R, v = Math.max(0.02, 1 - d * 0.98), g = Math.round(v * 255);
        x.strokeStyle = 'rgb(0,' + g + ',0)'; x.lineWidth = w + 7;
        x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
        x.strokeStyle = 'rgb(' + g + ',0,0)'; x.lineWidth = w;
        x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
    };
    // the rays from the impact, wandering, forking
    const rays = 15;
    for (let i = 0; i < rays; i++) {
        const a0 = (i + rnd() * 0.6) / rays * Math.PI * 2;
        const walk = (px, py, a, left, w) => {
            while (left > 0) {
                const l = 22 + rnd() * 30, na = a + (rnd() - 0.5) * 0.7;
                const qx = px + Math.cos(na) * l, qy = py + Math.sin(na) * l;
                seg(px, py, qx, qy, w);
                if (rnd() < 0.16 && w > 1.4) walk(qx, qy, na + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), left * (0.3 + rnd() * 0.4), w * 0.7);
                px = qx; py = qy; a = na; left -= l; w = Math.max(1.2, w * 0.985);
            }
        };
        walk(C, C, a0, R * (0.75 + rnd() * 0.45), 3.2);
    }
    // the rings between the rays, like a web (farther out, later)
    for (let ring = 1; ring <= 5; ring++) {
        const rr = R * (ring * ring * 0.022 + ring * 0.05 + 0.03), n = 7 + ring * 3;
        let lastx = 0, lasty = 0;
        for (let i = 0; i <= n; i++) {
            const a = i / n * Math.PI * 2, jit = 1 + (rnd() - 0.5) * 0.22, qx = C + Math.cos(a) * rr * jit, qy = C + Math.sin(a) * rr * jit;
            if (i && rnd() < 0.72) seg(lastx, lasty, qx, qy, 1.7);
            lastx = qx; lasty = qy;
        }
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.NoColorSpace;
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    t.anisotropy = 4;
    return t;
}
const crackTex = crackTexture();

const PANE_VERT = `attribute vec4 aTint; attribute vec4 aDmg; varying vec2 vUv; varying vec3 vW; varying vec4 vTint; varying vec4 vDmg; varying vec2 vSize; varying float vFog;
    void main() {
        vUv = uv; vTint = aTint; vDmg = aDmg;
        vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        vec4 w = instanceMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
    }`;
const PANE_FRAG = `uniform sampler2D uCrack; uniform vec3 uFogC; uniform float uFogN; uniform float uFogF; uniform float uNow;
    varying vec2 vUv; varying vec3 vW; varying vec4 vTint; varying vec4 vDmg; varying vec2 vSize; varying float vFog;
    void main() {
        vec3 col = vTint.rgb;
        float a = vTint.a;
        // the sheen: painted bands across the pane, drifting slowly
        float b = vW.x * 0.055 + vW.y * 0.085 + vW.z * 0.02 + uNow * 0.03;
        float s1 = smoothstep(0.46, 0.5, fract(b)) * (1.0 - smoothstep(0.5, 0.62, fract(b)));
        float s2 = smoothstep(0.74, 0.76, fract(b * 1.0 + 0.1)) * (1.0 - smoothstep(0.76, 0.79, fract(b + 0.1)));
        float sheen = s1 * 0.55 + s2 * 0.4;
        col = mix(col, vec3(1.0), sheen * 0.6);
        a += sheen * 0.22;
        // a bright edge, so the sheet reads against anything
        vec2 e = min(vUv, 1.0 - vUv) * vSize;
        float edge = 1.0 - smoothstep(0.0, 0.5, min(e.x, e.y));
        col = mix(col, vec3(1.0), edge * 0.65);
        a += edge * 0.4;
        // a soft brighter bloom low down where the floor lights it
        a += (1.0 - smoothstep(0.0, 0.5, vUv.y)) * 0.08;
        float dmg = vDmg.x;
        if (dmg > 0.003) {
            vec2 cuv = (vW.xy - vDmg.yz) / ${CRACK_SIZE.toFixed(1)} + 0.5;
            vec4 cm = texture2D(uCrack, cuv);
            float th = 1.0 - dmg;
            float halo = smoothstep(th, th + 0.03, cm.g) * step(0.01, cm.g);
            float line = smoothstep(th, th + 0.02, cm.r) * step(0.01, cm.r);
            col = mix(col, vec3(0.05, 0.12, 0.3), halo * 0.55);
            a = max(a, halo * 0.62);
            col = mix(col, vec3(1.0), line);
            a = max(a, line * 0.98);
            // straining: a hot tint spreading from the hit as it's about to go
            float near = 1.0 - smoothstep(0.0, 26.0 * dmg + 2.0, distance(vW.xy, vDmg.yz));
            col = mix(col, vec3(1.0, 0.72, 0.5), near * dmg * dmg * 0.55);
            a += near * dmg * 0.2;
        }
        a = min(a, 1.0);
        col = mix(col, uFogC, smoothstep(uFogN, uFogF, vFog));
        gl_FragColor = vec4(col, a * (1.0 - smoothstep(uFogN * 0.9, uFogF * 0.75, vFog)));
        #include <colorspace_fragment>
    }`;
const paneU = { uCrack: { value: crackTex }, uFogC: { value: new T.Color() }, uFogN: { value: 200 }, uFogF: { value: 600 }, uNow: CU.uNow };
export function paneFog() { const f = scene.fog; paneU.uFogC.value.copy(f.color); paneU.uFogN.value = f.near; paneU.uFogF.value = f.far; }
const paneMat = new T.ShaderMaterial({ uniforms: paneU, vertexShader: PANE_VERT, fragmentShader: PANE_FRAG, transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true });
paneMat.customProgramCacheKey = () => 'g1-pane';
const unit = new T.PlaneGeometry(1, 1);
const m4 = new T.Matrix4(), tc = new T.Color(), ZERO = new T.Matrix4().makeScale(0, 0, 0);

export class Panes {
    // list: panes in the order you meet them: { x, y (middle), z, w, h, tint, alpha }. They're stored last to first, so
    // the far ones are drawn first and the near one over them
    constructor(parent, list) {
        const n = list.length;
        this.list = list; this.n = n;
        const g = unit.clone();
        this.tintA = new T.InstancedBufferAttribute(new Float32Array(n * 4), 4);
        this.dmgA = new T.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(T.DynamicDrawUsage);
        g.setAttribute('aTint', this.tintA); g.setAttribute('aDmg', this.dmgA);
        this.mesh = new T.InstancedMesh(g, paneMat, n);
        this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 4;
        this.mesh.castShadow = false; this.mesh.receiveShadow = false;
        this.shown = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const p = list[i], k = n - 1 - i;
            tc.set(p.tint);
            this.tintA.setXYZW(k, tc.r, tc.g, tc.b, p.alpha ?? 0.34);
            this.dmgA.setXYZW(k, 0, p.x, p.y, 0);
            this.mesh.setMatrixAt(k, ZERO);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        parent.add(this.mesh);
    }
    // on (or off) screen
    show(i, on) {
        if (!!this.shown[i] === !!on) return;
        this.shown[i] = on ? 1 : 0;
        const k = this.n - 1 - i, p = this.list[i];
        if (on) this.mesh.setMatrixAt(k, m4.makeScale(p.w, p.h, 1).setPosition(p.x, p.y, p.z)); else this.mesh.setMatrixAt(k, ZERO);
        const a = this.mesh.instanceMatrix;
        a.addUpdateRange(k * 16, 16); a.needsUpdate = true;
    }
    // how broken (0..1), and where it was hit (x, y in the world)
    damage(i, d, x, y) {
        const k = this.n - 1 - i, a = this.dmgA;
        if (x !== undefined) { a.setY(k, x); a.setZ(k, y); }
        a.setX(k, d);
        a.addUpdateRange(k * 4, 4); a.needsUpdate = true;
    }
    // the update ranges three.js keeps are cleared once they've gone up
    tick() {
        const a = this.mesh.instanceMatrix, d = this.dmgA;
        if (!a.needsUpdate && a.updateRanges.length) a.clearUpdateRanges();
        if (!d.needsUpdate && d.updateRanges.length) d.clearUpdateRanges();
    }
    dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

// ----- the shards -----
const SHARD_VERT = `attribute vec4 aO; attribute vec4 aV; attribute vec3 aC; attribute vec3 aR; uniform float uNow; uniform vec4 uFog;
    varying vec3 vC; varying float vF;
    const float LIFE = 1.9, G = 62.0;
    void main() {
        float t = uNow - aO.w;
        if (t < 0.0 || t > LIFE) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); vF = 0.0; return; }
        // slows in the air, a touch
        vec3 p = aO.xyz + aV.xyz * (t - 0.12 * t * t) ;
        p.y = aO.y + aV.y * t - 0.5 * G * t * t;
        // off the floor: a low skip
        float ground = 0.08;
        if (p.y < ground) p.y = ground + (ground - p.y) * 0.12;
        float s = aV.w * (1.0 - smoothstep(LIFE * 0.62, LIFE, t));
        float ang = t * length(aR) * (p.y <= ground + 0.05 ? 0.2 : 1.0);
        vec3 ax = normalize(aR);
        vec3 v = position * s;
        float c = cos(ang), n = sin(ang);
        v = v * c + cross(ax, v) * n + ax * dot(ax, v) * (1.0 - c);
        vec4 mv = viewMatrix * vec4(p + v, 1.0);
        vec3 fn = normalize(cross(ax, vec3(0.3, 1.0, 0.2)) * c + vec3(0.2, 0.3, 1.0) * n);
        vC = aC * (0.86 + 0.34 * abs(fn.z));
        vF = smoothstep(uFog.x, uFog.y, -mv.z);
        gl_Position = projectionMatrix * mv;
    }`;
const SHARD_FRAG = `varying vec3 vC; varying float vF; uniform vec3 uFogC;
    void main() {
        gl_FragColor = vec4(mix(vC, uFogC, vF), 0.86);
        #include <colorspace_fragment>
    }`;
const shardU = { uNow: CU.uNow, uFog: { value: new T.Vector4(200, 600, 0, 0) }, uFogC: paneU.uFogC };
export function shardFog() { shardU.uFog.value.set(scene.fog.near, scene.fog.far, 0, 0); }
class ShardPool {
    constructor(max) {
        this.max = max; this.head = 0;
        const g = new T.InstancedBufferGeometry();
        // a jagged sliver: two triangles, one bigger than the other
        g.setAttribute('position', new T.Float32BufferAttribute([-0.9, -0.6, 0, 0.8, -0.8, 0.06, 0.1, 0.95, -0.04, 0.1, 0.95, -0.04, 0.8, -0.8, 0.06, 0.9, 0.6, 0.12], 3));
        g.instanceCount = 0;
        const attr = (name, size) => { const a = new T.InstancedBufferAttribute(new Float32Array(max * size), size); a.setUsage(T.DynamicDrawUsage); g.setAttribute(name, a); return a; };
        this.o = attr('aO', 4); this.v = attr('aV', 4); this.c = attr('aC', 3); this.r = attr('aR', 3);
        const m = new T.ShaderMaterial({ uniforms: shardU, vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true });
        m.customProgramCacheKey = () => 'g1-shard';
        this.mesh = new T.Mesh(g, m);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 7;
        this.mesh.visible = false;
        scene.add(this.mesh);
        this.liveUntil = 0;
    }
    // a pane going: n slivers from the rectangle (x0..x1, y0..y1) at z, flying away from the hit (ix, iy) along dz
    burst(x0, x1, y0, y1, z, ix, iy, dz, color, n, power) {
        const now = CU.uNow.value, R = Math.random, a = tc.set(color);
        const cr = a.r, cg = a.g, cb = a.b, start = this.head;
        const w = x1 - x0, h = y1 - y0;
        for (let i = 0; i < n; i++) {
            const k = this.head;
            this.head = (this.head + 1) % this.max;
            const px = x0 + R() * w, py = y0 + Math.pow(R(), 0.85) * h;
            const ddx = px - ix, ddy = py - iy, dist = Math.hypot(ddx, ddy), prox = Math.max(0, 1 - dist / (w * 0.6));
            const rearward = R() < 0.14 ? -0.3 : 1;
            const kick = (6 + 34 * prox * prox + R() * 8) * power;
            this.o.setXYZW(k, px, py, z + (R() - 0.5) * 0.6, now);
            // the bigger pieces near the rim, a spray of small ones at the hit
            const size = (0.32 + R() * R() * 1.5) * (0.65 + (1 - prox) * 0.7) * Math.min(1.5, Math.sqrt(w * h) / 16);
            this.v.setXYZW(k, ddx * (0.35 + R() * 0.5) + (R() - 0.5) * 5, ddy * 0.35 + 5 + R() * 12, dz * kick * rearward, size);
            this.r.setXYZ(k, (R() - 0.5) * 16, (R() - 0.5) * 16, (R() - 0.5) * 16);
            const white = 0.35 + R() * 0.65;
            this.c.setXYZ(k, cr + (1 - cr) * white, cg + (1 - cg) * white, cb + (1 - cb) * white);
        }
        for (const at of [this.o, this.v, this.c, this.r]) {
            at.clearUpdateRanges();
            if (start + n <= this.max) at.addUpdateRange(start * at.itemSize, n * at.itemSize);
            else { at.addUpdateRange(start * at.itemSize, (this.max - start) * at.itemSize); at.addUpdateRange(0, (start + n - this.max) * at.itemSize); }
            at.needsUpdate = true;
        }
        this.mesh.geometry.instanceCount = this.max;
        this.mesh.visible = true;
        this.liveUntil = now + 2;
    }
    // nothing flying: nothing drawn
    tick() { if (this.mesh.visible && CU.uNow.value > this.liveUntil) this.mesh.visible = false; }
}
let pool = null;
export function initShards(max) { pool = new ShardPool(max); return pool; }
export function shardBurst(...a) { if (pool) pool.burst(...a); }
export function tickGlass() { if (pool) pool.tick(); }
// the shader warm-up: one pane and one sliver, drawn behind the loading screen
export function glassWarmGroup() {
    const g = new T.Group();
    const p = new Panes(g, [{ x: 0, y: 2, z: 0, w: 6, h: 6, tint: 0xffffff, alpha: 0.4 }]);
    p.show(0, true); p.damage(0, 0.5, 0, 2);
    if (pool) { pool.mesh.visible = true; pool.mesh.geometry.instanceCount = 1; pool.o.setXYZW(0, 0, -60, 0, CU.uNow.value); pool.o.needsUpdate = true; }
    return g;
}
export function glassWarmDone() { if (pool) { pool.mesh.visible = false; pool.mesh.geometry.instanceCount = pool.max; } }
