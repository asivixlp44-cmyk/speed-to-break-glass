// A world on screen (shared/world.js has where everything stands): the spawn with its treadmills, sneaker pads,
// leaderboards, worlds portal and Glass Rush gate; then the Run: a long corridor of stages, each its own floor colour,
// its panes of glass in their frames, a gate with the stage's name and a Shard Pad behind the last pane. Each world has
// its own scenery (a glasshouse garden, a city at dusk, a frozen pass, a foundry).
// The static scenery goes into one kit per chunk of the map (batchKits: one draw for everything in view, each chunk
// culled on its own); trees and rocks are instanced soft blocks by square of the map, drawn in one or two calls.
import { T, V3, scene, studVCMaterial, texFrom, drawIcon, fitFont, textCanvas, prompts, CPU2D } from './engine.js';
import { Kit, glowVCMaterial, batchKits, rng } from './geo.js';
import { blob, buildBlobs, releaseBlobs, forestBlobs } from './blobs.js';
import { Panes, paneFog, shardFog } from './glass.js';
import { Aura } from './neon.js';
import { CU } from './clock.js';
import { W, worldFor, treads, shoePads, portal, rushGate, boards, hubChest } from '../../shared/world.js';
import { WORLDS, SHOES, fmt, fmtComma } from '../../shared/config.js';

const GOLD = ['#fff6a0', '#ffc21e'], LIME = ['#eaffc8', '#3ee03a'], ICE = ['#f4ffff', '#6ad8ff'], WHITE = ['#ffffff', '#d8e4f4'], GREY = ['#e8ecf4', '#a8b0c0'];
export const big = (t, g, px, s) => ({ t, c: g[1], g, s: s || '#102040', px, f: 'chunky' });
const mix = (a, b, k) => new T.Color(a).lerp(new T.Color(b), k).getHex();

// ----- signs -----
// Every floating sign of a scene in one draw: one texture, one mesh, each quad turned to face the camera in the vertex
// shader (some bob)
export class Signs {
    // cw, ch: a sign's cell in the texture (the signs that change get a small texture of their own: re-uploading it is cheap)
    constructor(cw, ch) { this.list = []; this.cw = cw || 512; this.ch = ch || 176; }
    add(lines, worldW, pos, bob) { const s = { lines, worldW, pos: pos.clone(), bob: bob ? 1 : 0, on: true, i: this.list.length, h: 0 }; this.list.push(s); return s; }
    build(parent) {
        const n = this.list.length, cols = 4, CW = this.cw, CH = this.ch;
        Object.assign(this, { cols, CW, CH, rows: Math.ceil(n / cols) });
        this.c = document.createElement('canvas'); this.c.width = cols * CW; this.c.height = this.rows * CH;
        this.x = this.c.getContext('2d', CPU2D);
        this.tex = texFrom(this.c);
        const g = new T.BufferGeometry(), idx = [];
        this.pos = new Float32Array(n * 12); this.off = new Float32Array(n * 8); this.uv = new Float32Array(n * 8);
        const bob = new Float32Array(n * 4);
        for (const s of this.list) {
            for (let k = 0; k < 4; k++) { this.pos.set([s.pos.x, s.pos.y, s.pos.z], s.i * 12 + k * 3); bob[s.i * 4 + k] = s.bob; }
            const b = s.i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
            this.paint(s);
        }
        g.setAttribute('position', new T.BufferAttribute(this.pos, 3));
        g.setAttribute('aOff', new T.BufferAttribute(this.off, 2));
        g.setAttribute('uv', new T.BufferAttribute(this.uv, 2));
        g.setAttribute('aBob', new T.BufferAttribute(bob, 1));
        g.setIndex(idx);
        g.computeBoundingSphere();
        g.boundingSphere.radius += 12;
        const m = new T.ShaderMaterial({
            uniforms: { map: { value: this.tex }, uNow: CU.uNow },
            vertexShader: `attribute vec2 aOff; attribute float aBob; uniform float uNow; varying vec2 vUv; varying float vA;
                void main() {
                    vUv = uv;
                    vec3 c = position; c.y += aBob * sin(uNow * 2.0) * 0.4;
                    vec4 mv = modelViewMatrix * vec4(c, 1.0);
                    vA = 1.0 - smoothstep(170.0, 260.0, -mv.z);
                    mv.xy += aOff;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying float vA;
                void main() {
                    vec4 t = texture2D(map, vUv);
                    t.a *= vA;
                    if (t.a < 0.02) discard;
                    gl_FragColor = t;
                    #include <colorspace_fragment>
                }`,
            transparent: true, depthWrite: false,
        });
        m.customProgramCacheKey = () => 'g1-signs';
        this.mesh = new T.Mesh(g, m);
        this.mesh.renderOrder = 5;
        parent.add(this.mesh);
    }
    // a sign's words into its cell, its quad sized to them
    paint(s) {
        const cv = textCanvas(s.lines, 768), k = this.CW / 768, h = Math.min(this.CH, Math.ceil(cv.height * k));
        const cx = (s.i % this.cols) * this.CW, cy = Math.floor(s.i / this.cols) * this.CH;
        this.x.clearRect(cx, cy, this.CW, this.CH);
        this.x.drawImage(cv, cx, cy, this.CW, h);
        s.h = h;
        const W2 = this.c.width, H2 = this.c.height, u0 = cx / W2, u1 = (cx + this.CW) / W2, v1 = 1 - cy / H2, v0 = 1 - (cy + h) / H2;
        this.uv.set([u0, v0, u1, v0, u1, v1, u0, v1], s.i * 8);
        this.quad(s);
    }
    quad(s) {
        const hw = s.on ? s.worldW / 2 : 0, hh = s.on ? s.worldW * s.h / this.CW / 2 : 0;
        this.off.set([-hw, -hh, hw, -hh, hw, hh, -hw, hh], s.i * 8);
    }
    set(s, lines) { s.lines = lines; this.paint(s); this.tex.needsUpdate = true; this.dirty(); }
    // in play: one sign painted a frame, the texture sent up once when the last is done
    later(s, lines) { (this.q || (this.q = [])).push([s, lines]); }
    tick() {
        if (!this.q || !this.q.length) return;
        const [s, lines] = this.q.shift();
        s.lines = lines; this.paint(s);
        if (!this.q.length) { this.tex.needsUpdate = true; this.dirty(); }
    }
    show(s, on) { if (s.on === on) return; s.on = on; this.quad(s); this.dirty(); }
    dirty() { if (!this.mesh) return; const g = this.mesh.geometry; g.attributes.aOff.needsUpdate = true; g.attributes.uv.needsUpdate = true; }
    dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); }
}

// ----- the leaderboards -----
function boardTexture(title, c1, c2) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 600;
    return { c, t: texFrom(c), title, c1, c2, key: '' };
}
// drawn at 768 x 900, stored at 2/3 of that; only when the rows changed
function drawBoard(B, rows) {
    const key = JSON.stringify(rows || []);
    if (key === B.key) return;
    B.key = key;
    const x = B.c.getContext('2d', CPU2D), Wd = 768, H = 900;
    x.setTransform(B.c.width / Wd, 0, 0, B.c.height / H, 0, 0);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, B.c1); g.addColorStop(1, B.c2);
    x.fillStyle = g; x.fillRect(0, 0, Wd, H);
    x.fillStyle = 'rgba(0,20,60,0.14)'; for (let i = 0; i < 12; i++) for (let j = 0; j < 14; j++) { x.beginPath(); x.arc(32 + i * 64, 32 + j * 64, 18, 0, Math.PI * 2); x.fill(); }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    fitFont(x, B.title, Wd - 40, 74, 400, '"Luckiest Guy", Fredoka, sans-serif', 0.2);
    x.lineWidth = 14; x.strokeStyle = '#0a2040'; x.strokeText(B.title, Wd / 2, 70); x.fillStyle = '#fff'; x.fillText(B.title, Wd / 2, 70);
    (rows || []).slice(0, 9).forEach((r, i) => {
        const y = 170 + i * 80;
        x.textAlign = 'left'; x.font = '700 44px Fredoka, sans-serif'; x.lineWidth = 8; x.strokeStyle = '#0a2040';
        const name = '#' + (i + 1) + ' ' + r.n;
        fitFont(x, name, Wd - 300, 44, 700, 'Fredoka, sans-serif', 0);
        x.strokeText(name, 40, y); x.fillStyle = '#ffffff'; x.fillText(name, 40, y);
        x.textAlign = 'right'; x.font = '700 44px Fredoka, sans-serif'; x.strokeText(fmt(r.v), Wd - 40, y); x.fillStyle = '#ffe24a'; x.fillText(fmt(r.v), Wd - 40, y);
    });
    if (!rows || !rows.length) { x.textAlign = 'center'; x.font = '700 46px Fredoka, sans-serif'; x.fillStyle = '#0a2040'; x.fillText('Be the first!', Wd / 2, 200); }
    B.t.needsUpdate = true;
}
// a swirling portal (unlit)
export function portalMesh(w, h, c1, c2) {
    const m = new T.ShaderMaterial({
        uniforms: { uNow: CU.uNow, uA: { value: new T.Color(c1) }, uB: { value: new T.Color(c2) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uNow; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
            void main() {
                vec2 p = (vUv - 0.5) * vec2(1.0, 1.25);
                float r = length(p), a = atan(p.y, p.x);
                float sw = sin(a * 4.0 + r * 14.0 - uNow * 3.5) * 0.5 + 0.5;
                vec3 c = mix(uA, uB, sw);
                c = mix(c, vec3(1.0), smoothstep(0.32, 0.0, r) * 0.7);
                gl_FragColor = vec4(c * 1.1, smoothstep(0.62, 0.5, r) * 0.92);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false, side: T.DoubleSide,
    });
    m.customProgramCacheKey = () => 'g1-portal';
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), m);
    mesh.renderOrder = 3;
    return mesh;
}
// the treadmill belts (one draw): dark rubber with bright bars running back toward you; each its own colour and pace
const beltMat = new T.ShaderMaterial({
    uniforms: { uNow: CU.uNow },
    vertexShader: `attribute vec3 aC; attribute float aP; varying vec2 vUv; varying vec3 vC; varying float vP;
        void main() { vUv = uv; vC = aC; vP = aP; gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uNow; varying vec2 vUv; varying vec3 vC; varying float vP;
        void main() {
            float bar = smoothstep(0.42, 0.5, fract(vUv.y * 7.0 - uNow * vP)) * (1.0 - smoothstep(0.62, 0.7, fract(vUv.y * 7.0 - uNow * vP)));
            float chev = smoothstep(0.44, 0.5, fract(vUv.y * 7.0 + abs(vUv.x - 0.5) * 2.0 - uNow * vP));
            vec3 c = mix(vec3(0.07, 0.08, 0.12), vC, bar * 0.9 + chev * 0.12);
            float e = 1.0 - smoothstep(0.0, 0.04, min(vUv.x, 1.0 - vUv.x));
            c = mix(c, vC * 1.2, e * 0.7);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
        }`,
});
beltMat.customProgramCacheKey = () => 'g1-belt';

// ----- bits of scenery -----
const chevrons = (props, x, z, n, color, gap) => {
    for (let k = 0; k < n; k++) {
        const zz = z - k * (gap || 7);
        props.box(x - 3.2, 0.07, zz, 8.4, 0.1, 2.2, color, { glow: 1, ry: 0.8 });
        props.box(x + 3.2, 0.07, zz, 8.4, 0.1, 2.2, color, { glow: 1, ry: -0.8 });
    }
};
// a sneaker, toe to the south (toward you), for a pad; bouncing gently
function sneaker(props, x, y, z, color, ph) {
    const g = 3 + ph, dark = mix(color, 0x101828, 0.55), S = 1.1;
    props.box(x, y - 0.65 * S, z + 0.4 * S, 2.4 * S, 0.6 * S, 5.4 * S, 0xffffff, { glow: g });
    props.box(x, y, z + 0.1 * S, 2.3 * S, 1.3 * S, 3.2 * S, color, { glow: g, soft: true });
    props.box(x, y - 0.1 * S, z + 2.2 * S, 2.1 * S, 0.95 * S, 1.5 * S, color, { glow: g, soft: true });
    props.box(x, y + 1 * S, z - 0.9 * S, 2.1 * S, 1.5 * S, 1.8 * S, color, { glow: g, soft: true });
    props.box(x, y + 1.7 * S, z - 0.9 * S, 2.2 * S, 0.34 * S, 1.95 * S, 0xffffff, { glow: g });
    for (let k = 0; k < 3; k++) props.box(x, y + 0.72 - k * 0.12, z + 0.1 + k * 0.72, 1.3 * S, 0.14, 0.26, 0xffffff, { glow: g });
    props.box(x + 1.18 * S, y - 0.02, z + 0.2, 0.08, 0.5, 2.6, dark, { glow: g, rx: 0.34 });
    props.box(x - 1.18 * S, y - 0.02, z + 0.2, 0.08, 0.5, 2.6, dark, { glow: g, rx: 0.34 });
    props.box(x, y - 0.66 * S, z + 3.1 * S, 2.2 * S, 0.46 * S, 0.4 * S, dark, { glow: g });
}
// a hexagon of radius r (three crossed boxes)
export const hex = (kit, x, y, z, r, h, c, o) => { for (let k = 0; k < 3; k++) kit.box(x, y, z, r * 1.732, h, r, c, { ...(o || {}), ry: k * Math.PI / 3 }); };
const ZONE = { garden: 0x25305a, city: 0x20263a, frost: 0x1f4080, foundry: 0x1a1016 };
// a Shard: a bobbing crystal (glowing)
export function crystal(props, x, y, z, color, s) {
    const g = 2;
    for (const [dx, dy, dz, sx, sy, sz, rz] of [[0, 0, 0, 1.3, 3.4, 1.3, 0.12], [0.9, -0.5, 0.3, 0.8, 2.2, 0.8, -0.35], [-0.8, -0.6, -0.2, 0.75, 1.9, 0.75, 0.4]]) {
        props.box(x + dx * s, y + dy * s, z + dz * s, sx * s, sy * s, sz * s, color, { glow: g, rz, ry: 0.7 });
    }
}
// ----- each world's scenery. side: -1 west, 1 east; x is the inner face of the corridor's wall on that side -----
const THEMES = {
    garden(env, side, z0, z1, R, hub) {
        const { studs, props } = env, x = side * (W.half + 4), Wd = env.Wd;
        const zm = (z0 + z1) / 2, len = Math.abs(z1 - z0);
        if (!hub) {
            // a cream stone wall, its coping, a hedge along the top
            studs.box(x, 5, zm, 8, 10, len, Wd.wall, { tile: 8 });
            props.box(x, 10.3, zm, 8.6, 0.6, len, 0xfff8ec);
            for (let z = z0 - 8; z > z1; z -= 15) blob(x, 13.2, z, 7, 6.5, 15, 0x3aa858 + (Math.floor(R() * 3) << 8) * 12, { sway: 0.5 });
            // terracotta planters along the foot, with blooms
            for (let z = z0 - 10; z > z1; z -= 24) {
                const px = side * (W.half - 2.2), C = [0xff4a7a, 0xffc62a, 0xc85aff, 0xff7a2a, 0xffffff][Math.floor(R() * 5)];
                props.box(px, 1.1, z, 3.4, 2.2, 3.4, 0xd8703a, { soft: true });
                props.box(px, 2.3, z, 3.7, 0.4, 3.7, 0xe88a50);
                blob(px, 3.6, z, 3.6, 2.8, 3.6, 0x3ab85a, { sway: 0.8 });
                for (let k = 0; k < 5; k++) props.box(px + (R() - 0.5) * 3, 4.3 + R() * 1.2, z + (R() - 0.5) * 3, 0.9, 0.9, 0.9, C, { soft: true, shade: 1.05 });
            }
        }
        // the gardens beyond: lawns stepping up, round trees, topiary
        const out = hub ? env.outer : W.half + 16;
        for (let z = (!hub && z0 > W.front - 5 ? z0 - 26 : z0 - 6); z > z1; z -= 22) {
            const bx = side * (out + 6 + R() * 18);
            blob(bx, 7 + R() * 6, z, 12 + R() * 8, 14 + R() * 10, 12 + R() * 8, [0x3aa858, 0x4ac060, 0x2e9a50][Math.floor(R() * 3)], { sway: 0.6, forest: true });
            props.box(bx, 2.6, z, 1.6, 5.2, 1.6, 0x8a5a3a);
            if (R() < 0.45) { const tx = side * (out + 34 + R() * 40); blob(tx, 12 + R() * 8, z + R() * 10, 18 + R() * 12, 22 + R() * 14, 18 + R() * 12, 0x4ab868, { sway: 0.5, forest: true }); }
        }
    },
    city(env, side, z0, z1, R, hub) {
        const { studs, props } = env, Wd = env.Wd, x0 = hub ? env.outer + 4 : W.half + 1;
        // towers, shoulder to shoulder, windows lit in strips
        for (let z = z0; z > z1;) {
            const d = 26 + R() * 18, h = 34 + R() * 90, wd = 26 + R() * 22, cx = side * (x0 + wd / 2), cz = z - d / 2, col = mix(Wd.wall, Wd.wall2, R());
            studs.box(cx, h / 2, cz, wd, h, d - 0.5, col, { tile: 8 });
            const lit = mix([0xffe6a0, 0xffd27a, 0xbfe8ff][Math.floor(R() * 3)], col, 0.3), dark = mix(col, 0x101828, 0.5), face = side * x0 + (side > 0 ? -0.02 : 0.02);
            for (let y = 5; y < h - 4; y += 5) {
                props.box(face, y, cz, 0.2, 1.7, d - 3, R() < 0.62 ? lit : dark, { glow: 1 });
            }
            for (let dz = -d / 2 + 4; dz < d / 2 - 2; dz += 5) props.box(face + side * -0.04, h / 2, cz + dz, 0.2, h - 4, 0.8, col);
            props.box(cx, h + 0.4, cz, wd + 1, 0.8, d - 0.5, mix(col, 0xffffff, 0.2));
            if (R() < 0.5) { props.box(cx, h + 3, cz, 1, 6, 1, 0x8a94a8); props.box(cx, h + 6.2, cz, 0.9, 0.9, 0.9, 0xff4a4a, { glow: 1 }); }
            z -= d;
        }
        if (!hub) {
            // the curb and street lamps
            const cu = side * (W.half - 0.4);
            props.box(cu, 0.3, (z0 + z1) / 2, 1.2, 0.6, Math.abs(z1 - z0), 0xb8c0cc);
            for (let z = z0 - 12; z > z1; z -= 30) {
                const lx = side * (W.half - 0.8);
                props.box(lx, 6, z, 0.5, 12, 0.5, 0x3a4458);
                props.box(lx - side * 2.2, 12, z, 4.8, 0.4, 0.4, 0x3a4458);
                props.box(lx - side * 4.4, 11.6, z, 1.6, 0.5, 1, 0xfff0b0, { glow: 1 });
            }
        }
    },
    frost(env, side, z0, z1, R, hub) {
        const { studs, props } = env, Wd = env.Wd, x = side * (W.half + 6);
        for (let z = z0; z > z1;) {
            const d = 14 + R() * 12, h = (hub ? 14 : 18) + R() * 20, cz = z - d / 2, col = mix(Wd.wall, Wd.wall2, R() * 0.6);
            if (!hub) {
                studs.box(x + side * R() * 4, h / 2, cz, 12, h, d, col, { tile: 8 });
                props.box(x + side * 2, h + 0.7, cz, 14, 1.4, d + 0.4, 0xffffff, { soft: true });
                // ledge lower down, icicles off it
                const lh = 5 + R() * 4;
                studs.box(side * (W.half + 1.2), lh / 2, cz, 2.4, lh, d, mix(col, 0xffffff, 0.3), { tile: 8 });
                props.box(side * (W.half + 1.2), lh + 0.4, cz, 3, 0.8, d + 0.2, 0xffffff, { soft: true });
                for (let k = 0; k < 3; k++) props.box(side * (W.half - 0.1), lh - 0.8 - R(), cz + (k - 1) * d * 0.28, 0.5, 1.8 + R() * 1.6, 0.5, 0xc8f0ff, { glow: 1 });
            }
            z -= d;
        }
        // pines with snow on them
        for (let z = (!hub && z0 > W.front - 5 ? z0 - 24 : z0 - 8); z > z1; z -= 20) {
            const bx = side * ((hub ? env.outer + 4 : W.half + 18) + R() * 40), hh = 1 + R() * 0.6;
            props.box(bx, 2.5 * hh, z, 1.6, 5 * hh, 1.6, 0x6a4a3a);
            for (let k = 0; k < 3; k++) {
                const wd = (9 - k * 2.6) * hh, yy = (5 + k * 3.6) * hh;
                blob(bx, yy, z, wd, 3.4 * hh, wd, 0x2a6a58, { sway: 0.2, forest: true, ry: k });
                blob(bx, yy + 1.5 * hh, z, wd * 0.84, 1.4 * hh, wd * 0.84, 0xffffff, { sway: 0.1, forest: true, ry: k });
            }
        }
    },
    foundry(env, side, z0, z1, R, hub) {
        const { studs, props } = env, Wd = env.Wd, x = side * (W.half + 5);
        const zm = (z0 + z1) / 2, len = Math.abs(z1 - z0);
        if (!hub) {
            studs.box(x, 8, zm, 10, 16, len, Wd.wall, { tile: 8 });
            // a channel of lava along the foot of the wall (it glows)
            props.box(side * (W.half - 1.3), 0.14, zm, 2.2, 0.16, len, 0xff7a1e, { glow: 1 });
            props.box(side * (W.half - 2.7), 0.4, zm, 0.8, 0.8, len, 0x2a1c22);
            props.box(side * W.half, 0.4, zm, 0.6, 0.8, len, 0x2a1c22);
            for (let z = z0 - 6; z > z1; z -= 18) {
                props.box(side * W.half, 8.5, z, 0.5, 15, 1.5, 0x5a4048);
                props.box(side * (W.half + 0.2), 12 + R() * 2, z - 8, 0.3, 1 + R(), 8, 0xffa84a, { glow: 1 });
            }
        }
        // chimneys and hot blocks beyond the wall
        for (let z = z0 - 10; z > z1; z -= 30) {
            const bx = side * ((hub ? env.outer + 6 : W.half + 20) + R() * 26), h = 30 + R() * 40;
            studs.box(bx, h / 2, z, 10, h, 10, Wd.wall2, { tile: 8 });
            props.box(bx, h + 0.6, z, 11, 1.2, 11, 0xff8a2a, { glow: 1 });
            props.box(bx, h * 0.6, z + side * 0, 10.2, 1, 10.2, 0x6a4048);
            blob(side * ((hub ? env.outer : W.half) + 50 + R() * 40), 8 + R() * 14, z, 22 + R() * 16, 20 + R() * 24, 22 + R() * 16, 0x2a1c26, { sway: 0, forest: true });
        }
    },
};
// the far backdrop: hills all round (and clouds), in the world's colours, a single draw
function backdrop(Wd, R, zFar) {
    const HILL = { garden: [0x5abf70, 0x4aa868], city: [0x7a8aa8, 0x8a98b4], frost: [0xe4f2ff, 0xc8e0f8], foundry: [0x3a2430, 0x2a1a24] }[Wd.mood];
    for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1, z = 120 - (i / 26) * (120 - zFar) + (R() - 0.5) * 40, s = 90 + R() * 130;
        blob(side * (170 + R() * 180), s * 0.28, z, s, s * 0.8, s * (0.9 + R() * 0.5), HILL[i % 2], { far: true, sway: 0, ry: R() * 3 });
    }
    for (let i = 0; i < 6; i++) { const s = 110 + R() * 110; blob(-220 + i * 90, s * 0.3, zFar - 120 - R() * 60, s, s * 0.8, s, HILL[i % 2], { far: true, sway: 0 }); }
    if (Wd.mood !== 'foundry') for (let i = 0; i < 14; i++) {
        const a = i * 2.39996, r = 180 + (i * 53) % 260, sx = 30 + (i * 13) % 34;
        blob(Math.cos(a) * r, 90 + (i * 31) % 90, -300 + Math.sin(a) * 420 - (i * 41) % 200, sx, 9 + (i % 3) * 5, sx * 0.7, 0xffffff, { far: true, sway: 0, ry: a });
    }
}
// one texture for a world's stage labels: over each gate, its number and name
function atlas(Tw) {
    const n = Tw.stages.length, CW = 768, CH = 256;
    const c = document.createElement('canvas'); c.width = CW * 2; c.height = CH * 4;
    const x = c.getContext('2d', CPU2D);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    Tw.stages.forEach((st, i) => {
        const cx = (i % 2) * CW + CW / 2, cy = Math.floor(i / 2) * CH;
        const t1 = 'STAGE ' + (st.k + 1), font = '"Luckiest Guy", Fredoka, sans-serif';
        x.font = '400 94px ' + font;
        x.strokeStyle = '#102040'; x.lineWidth = 24; x.strokeText(t1, cx, cy + 78);
        const gw = x.createLinearGradient(0, cy + 40, 0, cy + 120); gw.addColorStop(0, '#ffffff'); gw.addColorStop(1, '#bfe8ff');
        x.fillStyle = gw; x.fillText(t1, cx, cy + 78);
        fitFont(x, st.name, CW - 60, 72, 400, font, 0.24);
        x.lineWidth = 18; x.strokeText(st.name, cx, cy + 172);
        x.fillStyle = '#' + new T.Color(st.tint).lerp(new T.Color(0xffffff), 0.35).getHexString(); x.fillText(st.name, cx, cy + 172);
    });
    // the two big boards over the spawn's zones
    [['TREADMILLS', 'Stand on one: your feet do the rest', '#8ae8ff'], ['SNEAKERS', 'Step on the next pair to buy them', '#a8ff7a']].forEach(([t1, t2, col], i) => {
        const cx = i * CW + CW / 2, cy = 3 * CH, font = '"Luckiest Guy", Fredoka, sans-serif';
        fitFont(x, t1, CW - 60, 128, 400, font, 0.24);
        x.strokeStyle = '#06102a'; x.lineWidth = 26; x.strokeText(t1, cx, cy + 96);
        const g = x.createLinearGradient(0, cy + 40, 0, cy + 150); g.addColorStop(0, '#ffffff'); g.addColorStop(1, col);
        x.fillStyle = g; x.fillText(t1, cx, cy + 96);
        fitFont(x, t2, CW - 80, 46, 700, 'Fredoka, sans-serif', 0.2);
        x.lineWidth = 10; x.strokeText(t2, cx, cy + 208); x.fillStyle = '#ffffff'; x.fillText(t2, cx, cy + 208);
    });
    const t = texFrom(c);
    t.anisotropy = 8;
    return { t, cols: 2, rows: 4, n };
}
function quad(lp, lu, li, A, i, x, y, z, w, h) {
    const col = i % A.cols, row = Math.floor(i / A.cols), c0 = col / A.cols, c1 = c0 + 1 / A.cols, r0 = 1 - (row + 1) / A.rows, r1 = r0 + 1 / A.rows, b = lp.length / 3;
    lp.push(x - w / 2, y - h / 2, z, x + w / 2, y - h / 2, z, x + w / 2, y + h / 2, z, x - w / 2, y + h / 2, z);
    lu.push(c0, r0, c1, r0, c1, r1, c0, r1);
    li.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

export function buildWorld(wi, opts) {
    const Tw = worldFor(wi), Wd = WORLDS[wi] || WORLDS[0], R = rng(4242 + wi * 991);
    const group = new T.Group(), signs = new Signs(), shoeSigns = new Signs(320, 110), trSigns = new Signs(320, 110), aura = new Aura();
    // one pair of kits per chunk of the map (the spawn, then each stage)
    const studKits = [], propKits = [];
    const chunk = () => { const a = new Kit(), b = new Kit({ glow: true }); studKits.push(a); propKits.push(b); return { studs: a, props: b, Wd, signs, outer: W.floor.x1 }; };
    const theme = THEMES[Wd.id];
    const env0 = chunk(), { studs, props } = env0;
    // ----- the spawn's floor: big checker tiles -----
    const F = W.floor, TILE = 20;
    for (let x = F.x0; x < F.x1; x += TILE) for (let z = F.z0; z < F.z1; z += TILE) {
        const k = (Math.round((x - F.x0) / TILE) + Math.round((z - F.z0) / TILE)) % 2;
        studs.box(x + TILE / 2, -1, z + TILE / 2, TILE, 2, TILE, k ? Wd.hub : Wd.hub2, { tile: 8 });
    }
    // the ground out to the horizon (no studs, one box)
    props.box(0, -2.2, (F.z1 + Tw.end) / 2 - 100, 1800, 2, F.z1 - Tw.end + 1400, Wd.ground);
    // the rim of the spawn, the path north
    for (const [x, z, sx, sz] of [[F.x0 - 1, (F.z0 + F.z1) / 2, 2, F.z1 - F.z0 + 4], [F.x1 + 1, (F.z0 + F.z1) / 2, 2, F.z1 - F.z0 + 4], [0, F.z1 + 1, F.x1 - F.x0 + 4, 2], [-(W.half + F.x1) / 2, F.z0 - 1, F.x1 - W.half, 2], [(W.half + F.x1) / 2, F.z0 - 1, F.x1 - W.half, 2]]) {
        props.box(x, 1, z, sx, 2.4, sz, Wd.trim);
    }
    props.box(0, 0.04, (F.z0 + W.spawn.z) / 2 - 2, 18, 0.06, W.spawn.z - F.z0 + 4, mix(Wd.trim, 0xffffff, 0.45));
    chevrons(props, 0, W.spawn.z - 12, 7, Wd.trim, 9);
    // the plate where you appear
    for (let k = 0; k < 12; k++) { props.box(W.spawn.x, 0.07, W.spawn.z, 13, 0.06, 13, Wd.trim, { ry: k * Math.PI / 24 }); props.box(W.spawn.x, 0.11, W.spawn.z, 10.4, 0.06, 10.4, 0xffffff, { ry: k * Math.PI / 24 }); }
    for (let k = 0; k < 4; k++) props.box(W.spawn.x, 0.15, W.spawn.z - 1, 7 - k * 0.4, 0.05, 1.1, Wd.trim, { ry: (k % 2 ? 1 : -1) * 0.8 });
    // dark platforms for the treadmills and the sneakers: neon needs something dark to glow against
    const zone = (x0, x1, z0, z1, c) => {
        studs.box((x0 + x1) / 2, -0.94, (z0 + z1) / 2, x1 - x0, 2, z1 - z0, ZONE[Wd.id], { tile: 8 });
        for (const [x, z, sx, sz] of [[x0, (z0 + z1) / 2, 0.5, z1 - z0], [x1, (z0 + z1) / 2, 0.5, z1 - z0], [(x0 + x1) / 2, z0, x1 - x0, 0.5], [(x0 + x1) / 2, z1, x1 - x0, 0.5]]) props.box(x, 0.14, z, sx, 0.2, sz, c, { glow: 5.2 });
    };
    zone(-67, -24, -44, 60, 0x3ae8ff);
    zone(23, 69, -32, 60, 0x7dff5a);
    // the big boards, framed in neon
    const board = (x, z, c) => {
        for (const sx of [-1, 1]) props.box(x + sx * 15, 8, z - 1, 1.2, 16, 1.2, 0x2a3450);
        props.box(x, 16.5, z - 0.5, 34, 12, 1, 0x101a3a);
        for (const [bx, by, sx, sy] of [[x, 22.4, 34.6, 0.6], [x, 10.6, 34.6, 0.6], [x - 17.2, 16.5, 0.6, 12.4], [x + 17.2, 16.5, 0.6, 12.4]]) props.box(bx, by, z + 0.05, sx, sy, 0.3, c, { glow: 5.4 });
        aura.glow(x, 16.5, z + 0.3, 24, 11, c, 0.3);
    };
    board(-45, -41, 0x3ae8ff);
    board(46, -32, 0x7dff5a);
    // ----- the treadmills -----
    const belts = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), beltMat, treads.length);
    const bc = new Float32Array(treads.length * 3), bp = new Float32Array(treads.length), m4 = new T.Matrix4(), tc = new T.Color();
    const tr = treads.map((t, i) => {
        const dark = 0x2c3858, frame = 0xaab8e0, ph = 5 + ((i * 0.17) % 0.9);
        props.box(t.x, 0.09, t.z, t.w + 3.4, 0.08, t.l + 2.4, dark);
        for (const sx of [-1, 1]) {
            const rx = t.x + sx * (t.w / 2 + 0.2);
            props.box(rx, 0.65, t.z, 1.2, 1.2, t.l, frame, { soft: true });
            // the neon: along the belt's edge, along the top of the frame, along the handrail
            props.box(t.x + sx * (t.w / 2 - 0.34), 0.22, t.z, 0.5, 0.14, t.l, t.color, { glow: ph });
            props.box(rx, 1.3, t.z, 1.26, 0.14, t.l + 0.04, t.color, { glow: ph });
            for (const dz of [-0.45, 0.45]) props.box(rx, 2.6, t.z + dz * t.l, 0.36, 2.8, 0.36, 0xd8e0f4);
            props.box(rx, 3.95, t.z, 0.46, 0.46, t.l * 0.92, t.color, { glow: ph });
        }
        // the console at the front, its screen glowing, a neon arch over it
        props.box(t.x, 2.2, t.z - t.l / 2 - 1, t.w + 1, 4.4, 2, frame, { soft: true });
        props.box(t.x, 3.1, t.z - t.l / 2 + 0.02, t.w - 1.4, 2, 0.1, t.color, { glow: ph });
        props.box(t.x, 4.55, t.z - t.l / 2 - 1, t.w + 1.3, 0.3, 2.2, t.color, { glow: ph });
        // its glow: a pool on the floor, a low wall of light round it, the screen shining out
        aura.halo2(t.x, 0.2, t.z, t.w * 1.15, t.l * 0.8, t.color, 0.6);
        aura.walls(t.x - t.w / 2 - 0.9, t.x + t.w / 2 + 0.9, t.z - t.l / 2, t.z + t.l / 2, 0.15, 5, t.color, 0.4);
        aura.glow(t.x, 3.1, t.z - t.l / 2 + 0.2, t.w * 0.85, 3.4, t.color, 0.55);
        m4.makeScale(t.w - 0.2, 1, t.l).setPosition(t.x, 0.15, t.z);
        belts.setMatrixAt(i, m4);
        tc.set(t.color);
        bc.set([tc.r, tc.g, tc.b], i * 3); bp[i] = 1.6 + i * 0.35;
        signs.add([big('X' + fmt(t.mult) + ' SPEED', GOLD, 112)], 13, new V3(t.x, 9.4, t.z - t.l / 2 + 1));
        const status = trSigns.add([big('READY', LIME, 80)], 12, new V3(t.x, 7.2, t.z - t.l / 2 + 1));
        return { t, status, state: '' };
    });
    belts.geometry.setAttribute('aC', new T.InstancedBufferAttribute(bc, 3));
    belts.geometry.setAttribute('aP', new T.InstancedBufferAttribute(bp, 1));
    belts.frustumCulled = false;
    group.add(belts);
    // ----- the sneaker pads -----
    const sp = shoePads.map((b) => {
        // a dark plinth you step up on, its top a hexagon of neon, a column of the pair's colour rising off it
        const ph = 5 + ((b.i * 0.11) % 0.9);
        hex(props, b.x, 0.3, b.z, 5.4, 0.6, 0x39435f);
        hex(props, b.x, 0.62, b.z, 4.6, 0.12, mix(b.color, 0x101828, 0.55));
        hex(props, b.x, 0.68, b.z, 4, 0.1, b.color, { glow: ph });
        hex(props, b.x, 0.71, b.z, 2.5, 0.08, mix(b.color, 0xffffff, 0.55), { glow: ph });
        aura.halo(b.x, 0.16, b.z, 10, b.color, 0.55);
        aura.column(b.x, 0.7, b.z, 4.1, 6.5, 6, b.color, 0.6);
        sneaker(props, b.x, 3.5, b.z, b.color, (b.i % 10) / 11);
        const s = shoeSigns.add([big('+' + b.add + ' SPEED', LIME, 86)], 9.5, new V3(b.x, 8.2, b.z));
        return { b, s, state: '' };
    });
    // the arrow over the next pair
    const arrowKit = new Kit({ glow: true });
    arrowKit.box(-1.1, 0, 0, 3.6, 1, 1, 0xffffff, { glow: 2, rz: -0.8 });
    arrowKit.box(1.1, 0, 0, 3.6, 1, 1, 0xffffff, { glow: 2, rz: 0.8 });
    arrowKit.box(0, 2.6, 0, 1, 3, 1, 0xffffff, { glow: 2 });
    const arrow = new T.Mesh(arrowKit.geometry(), glowVCMaterial(CU.uNow));
    arrow.renderOrder = 2;
    group.add(arrow);
    // ----- the leaderboards, the portal, the Rush gate, the chest -----
    const B = [boardTexture('MOST SHARDS', '#5ae0ff', '#1f7fe8'), boardTexture('TOP SPEED', '#ffd02a', '#ff8a1a'), boardTexture('RUSH WINS', '#ff8ad8', '#c83ae0')];
    boards.forEach((bd, i) => {
        studs.box(bd.x, 7.5, bd.z, 13, 15, 2, [0x1f7fe8, 0xff8a1a, 0xc83ae0][i], { tile: 8 });
        const pl = new T.Mesh(new T.PlaneGeometry(11.4, 13.2), new T.MeshBasicMaterial({ map: B[i].t, toneMapped: false }));
        pl.position.set(bd.x, 7.6, bd.z - 1.06); pl.rotation.y = Math.PI;
        group.add(pl);
        drawBoard(B[i], []);
    });
    const arch = (g, c1, c2, title, t2) => {
        for (const sx of [-1, 1]) for (let k = 0; k < 8; k++) props.box(g.x + sx * 8, 1 + k * 2, g.z + 3, 2, 2, 2, k % 2 ? 0xffffff : c1, { soft: true });
        props.box(g.x, 17, g.z + 3, 18, 2, 2, c1, { soft: true });
        const pm = portalMesh(14, 15, c1, c2); pm.position.set(g.x, 8, g.z + 3); pm.rotation.y = Math.PI; group.add(pm);
        signs.add([big(title, ['#ffffff', new T.Color(c2).getStyle()], 116), { t: t2, c: '#ffe24a', s: '#102040', px: 46 }], 17, new V3(g.x, 21.4, g.z + 3));
    };
    arch(portal, 0x3ab4ff, 0x7affb0, 'WORLDS', 'New places to smash');
    arch(rushGate, 0xff4ab8, 0xffd84a, 'GLASS RUSH', 'Race everyone here');
    // a wooden chest, banded in gold
    const c = hubChest;
    props.box(c.x, 0.25, c.z, 8.6, 0.5, 6.6, 0x5a3a2a);
    props.box(c.x, 2.35, c.z, 7, 3.7, 5, 0x7a2e14, { soft: true });
    for (const dy of [1.5, 3]) props.box(c.x, dy, c.z, 7.06, 0.12, 5.06, 0x4a1a0a);
    props.box(c.x, 4.75, c.z, 7.2, 1.4, 5.2, 0x9a3418, { soft: true });
    props.box(c.x, 5.65, c.z, 6.6, 0.8, 4.4, 0x9a3418, { soft: true });
    for (const dx of [-3.1, 3.1]) props.box(c.x + dx, 3.3, c.z, 0.5, 6.1, 5.25, 0xffc828);
    props.box(c.x, 4.12, c.z, 7.3, 0.4, 5.3, 0xffc828);
    props.box(c.x, 3.75, c.z - 2.62, 1.5, 1.7, 0.3, 0xffd84a, { glow: 1 });
    const chestSign = signs.add([big('FREE CHEST!', GOLD, 120, '#4a1a00')], 13, new V3(c.x, 9.2, c.z), true);
    // scenery round the spawn
    theme(env0, -1, F.z1 + 20, F.z0, R, true); theme(env0, 1, F.z1 + 20, F.z0, R, true);
    // the gate into the Run
    for (const sx of [-1, 1]) props.box(sx * (W.half + 1), 15, F.z0, 3, 30, 3, Wd.trim, { soft: true });
    props.box(0, 30, F.z0, W.half * 2 + 8, 4, 3.6, Wd.trim, { soft: true });
    signs.add([big('THE RUN', ['#ffffff', new T.Color(Wd.stages[0].tint).getStyle()], 124), { t: 'Smash the glass · Grab the Shards', c: '#ffffff', s: '#102040', px: 46 }], 32, new V3(0, 37.5, F.z0));
    // ----- the Run: each stage its own chunk -----
    const paneList = [];
    Tw.stages.forEach((st, k) => {
        const env = chunk(), s2 = env.studs, p2 = env.props;
        const z0 = k === 0 ? W.front + 1 : Tw.stages[k - 1].z1, z1 = st.z1, len = z0 - z1, zm = (z0 + z1) / 2;
        s2.box(0, -1, zm, W.half * 2 + 2, 2, len, st.floor, { tile: 8 });
        // a stripe up the middle, chevrons pointing on
        p2.box(0, 0.03, zm, 10, 0.05, len, mix(st.floor, st.tint, 0.5));
        for (let z = z0 - 8; z > z1 + 6; z -= 16) { p2.box(-2.2, 0.06, z, 6, 0.06, 1.3, mix(st.tint, 0xffffff, 0.4), { glow: 1, ry: 0.8 }); p2.box(2.2, 0.06, z, 6, 0.06, 1.3, mix(st.tint, 0xffffff, 0.4), { glow: 1, ry: -0.8 }); }
        theme(env, -1, z0, z1, R, false); theme(env, 1, z0, z1, R, false);
        // the gate: two posts and a beam, the label on it
        const gz = st.z0 + 2, nc = mix(st.tint, 0xffffff, 0.15), np = 5 + (k * 0.15) % 0.9;
        for (const sx of [-1, 1]) { p2.box(sx * (W.half - 0.5), 17, gz, 3, 34, 3, Wd.trim, { soft: true }); p2.box(sx * (W.half - 2.1), 17, gz, 0.3, 34, 0.5, nc, { glow: np }); p2.box(sx * (W.half - 0.7), 0.1, zm, 0.6, 0.14, len, nc, { glow: np }); }
        p2.box(0, 33, gz, W.half * 2 + 2, 3, 3, Wd.trim, { soft: true });
        p2.box(0, 31.3, gz + 1.55, W.half * 2 - 3, 0.4, 0.2, nc, { glow: np });
        // the panes' frames
        for (let i = st.first; i <= st.last; i++) {
            const pn = Tw.panes[i], fc = mix(st.tint, 0x2a3450, 0.55);
            for (const sx of [-1, 1]) p2.box(sx * (W.half + 0.1), W.paneH / 2, pn.z, 1, W.paneH + 1, 1, fc);
            p2.box(0, W.paneH + 0.5, pn.z, W.half * 2 + 1, 1, 1, fc);
            p2.box(0, W.paneH + 0.1, pn.z + 0.56, W.half * 2 - 0.6, 0.3, 0.14, nc, { glow: np });
            for (const sx of [-1, 1]) p2.box(sx * (W.half - 0.3), W.paneH / 2, pn.z + 0.56, 0.3, W.paneH, 0.14, nc, { glow: np });
            p2.box(0, 0.12, pn.z, W.half * 2, 0.24, 1.1, fc);
            paneList.push({ x: 0, y: W.paneH / 2, z: pn.z, w: W.half * 2, h: W.paneH, tint: st.tint, alpha: 0.36 + k * 0.015 });
        }
        // the Shard Pad
        const pd = st.pad, PW = W.padW;
        hex(p2, pd.x, 0.08, pd.z, PW * 0.68, 0.16, 0x102040);
        hex(p2, pd.x, 0.2, pd.z, PW * 0.58, 0.14, st.tint, { glow: np });
        hex(p2, pd.x, 0.28, pd.z, PW * 0.36, 0.14, mix(st.tint, 0xffffff, 0.6), { glow: np });
        crystal(p2, pd.x, 4, pd.z, st.tint, 1.25);
        aura.halo(pd.x, 0.14, pd.z, PW * 1.05, st.tint, 0.6);
        aura.column(pd.x, 0.2, pd.z, PW * 0.6, 13, 6, st.tint, 0.55);
        signs.add([big('+' + fmt(pd.shards) + ' SHARDS', ICE, 104), { t: 'and home', c: '#ffffff', s: '#102040', px: 44 }], 13, new V3(pd.x, 9.4, pd.z), true);
        // chevrons leading to the pad
        for (let i = 0; i < 3; i++) { p2.box(pd.x - 10 + i * 3 - 0.8, 0.07, pd.z - 0.8, 3.6, 0.06, 1.1, 0xffe24a, { glow: 1, ry: -0.8 }); p2.box(pd.x - 10 + i * 3 - 0.8, 0.07, pd.z + 0.8, 3.6, 0.06, 1.1, 0xffe24a, { glow: 1, ry: 0.8 }); }
    });
    // the Run's end: a wall of the world's trim, the way on is the portal back
    const envE = chunk();
    envE.props.box(0, 22, Tw.end - 3, W.half * 2 + 12, 44, 6, Wd.trim);
    forestBlobs(false);
    backdrop(Wd, R, Tw.end);
    // gate labels (one mesh)
    const A = atlas(Tw), lp = [], lu = [], li = [];
    Tw.stages.forEach((st) => quad(lp, lu, li, A, st.k, 0, 27.4, st.z0 + 0.4, 21, 7));
    quad(lp, lu, li, A, 6, -45, 16.5, -40.9, 33, 11);
    quad(lp, lu, li, A, 7, 46, 16.5, -31.9, 33, 11);
    const lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(lp, 3)); lg.setAttribute('uv', new T.Float32BufferAttribute(lu, 2)); lg.setIndex(li);
    lg.computeBoundingSphere();
    const labels = new T.Mesh(lg, new T.MeshBasicMaterial({ map: A.t, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    labels.renderOrder = 3;
    group.add(labels);
    signs.build(group);
    shoeSigns.build(group);
    trSigns.build(group);
    aura.build(group);
    const sm = batchKits(studKits, studVCMaterial(), true);
    if (sm) { sm.receiveShadow = true; group.add(sm); }
    const pm2 = batchKits(propKits, glowVCMaterial(CU.uNow), true);
    if (pm2) group.add(pm2);
    buildBlobs(group, () => Math.random());
    const panes = new Panes(group, paneList);
    // nothing in a world moves as a whole: its matrices are worked out once, not every frame
    group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    group.updateMatrixWorld(true);
    scene.add(group);
    // prompts: the sneaker pads, the portal, the Rush gate
    const PR = [];
    for (const b of shoePads) PR.push({ pos: new V3(b.x, 0, b.z), r: 4.4, label: () => (opts && opts.shoeLabel ? opts.shoeLabel(b) : 'Sneakers'), act: () => opts && opts.shoe && opts.shoe(b), zone: 'world' });
    PR.push({ pos: new V3(portal.x, 0, portal.z), r: 7, label: () => 'Worlds', act: () => opts && opts.worlds && opts.worlds(), zone: 'world' });
    PR.push({ pos: new V3(rushGate.x, 0, rushGate.z), r: 7, label: () => 'Glass Rush: PLAY', act: () => opts && opts.play && opts.play(), zone: 'world' });
    prompts.length = 0; prompts.push(...PR);
    let shown = -1, signsReady = false, mounted = -1;
    const LOCK = ['#ff9a9a', '#ff3a4a'];
    const treadStatus = (rebirths) => {
        for (const k of tr) {
            const st = rebirths < k.t.reb ? 'lock' : mounted === k.t.i ? 'run' : 'ready';
            if (st === k.state) continue;
            k.state = st;
            const lines = st === 'lock' ? [big(k.t.reb + (k.t.reb > 1 ? ' Rebirths' : ' Rebirth') + ' needed', LOCK, 72)] : st === 'run' ? [big('RUNNING', ICE, 92)] : [big('READY', LIME, 80)];
            if (signsReady) trSigns.later(k.status, lines); else trSigns.set(k.status, lines);
        }
    };
    let lastReb = 0;
    return {
        T: Tw, w: wi, group, panes, belts,
        setBoards(m) { drawBoard(B[0], m.shards); drawBoard(B[1], m.speed); drawBoard(B[2], m.rush); },
        // what you've got: the treadmills' locks, the sneaker pads' signs
        setProgress(p, now) {
            lastReb = p.rebirths;
            treadStatus(p.rebirths);
            const nb = shoePads[p.shoes];
            arrow.visible = !!nb;
            if (nb && arrow.userData.i !== nb.i) { arrow.userData.i = nb.i; arrow.position.set(nb.x, 12.2, nb.z); arrow.updateMatrix(); arrow.updateMatrixWorld(true); }
            signs.show(chestSign, ((p.chests && p.chests.hub) || 0) <= now);
            for (const q of sp) {
                const st = q.b.i < p.shoes ? 'own' : q.b.i === p.shoes ? 'next' : 'later';
                if (st === q.state) continue;
                q.state = st;
                const lines = st === 'own' ? [big('+' + fmt(q.b.add), LIME, 72), big('OWNED', WHITE, 52)]
                    : st === 'next' ? [big('+' + fmt(q.b.add) + ' SPEED', LIME, 84), big(q.b.shards ? fmtComma(q.b.shards) + ' SHARDS' : 'FREE!', GOLD, 62)]
                        : [big('+' + fmt(q.b.add) + ' SPEED', GREY, 74), big(fmtComma(q.b.shards) + ' SHARDS', GREY, 50)];
                if (signsReady) shoeSigns.later(q.s, lines); else shoeSigns.set(q.s, lines);
            }
            signsReady = true;
        },
        // the treadmill you're on says RUNNING
        setTread(i) { if (i === mounted) return; mounted = i; treadStatus(lastReb); },
        // the panes ahead of you (from next, a few at a time): the rest aren't drawn
        setPane(next) {
            if (next === shown) return;
            shown = next;
            for (let i = 0; i < Tw.n; i++) panes.show(i, i >= next && i < next + 5);
        },
        visible(on) { group.visible = on; },
        update() { panes.tick(); shoeSigns.tick(); trSigns.tick(); },
        dispose() {
            releaseBlobs(group);
            signs.dispose();
            shoeSigns.dispose();
            trSigns.dispose();
            aura.dispose();
            panes.dispose();
            belts.geometry.dispose(); belts.dispose();
            group.traverse((o) => { if (o.isBatchedMesh) o.dispose(); else if (o.isMesh && !o.isInstancedMesh && o !== signs.mesh && o !== shoeSigns.mesh && o !== trSigns.mesh && o !== aura.mesh) o.geometry.dispose(); if (o.isMesh && o.material && o.material.map && B.some((b) => b.t === o.material.map)) o.material.dispose(); });
            A.t.dispose(); for (const b of B) b.t.dispose();
            scene.remove(group);
        },
    };
}
export { THEMES, backdrop };
void paneFog; void shardFog; void SHOES; void drawIcon;
