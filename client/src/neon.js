// The glow round everything neon: soft pools of light on the floor and columns of colour rising off the pads, all quads in one
// unlit additive draw (no bloom, no post-processing: the glow is painted). They pulse and streak in the shader, and fade out in
// the distance; nothing is written per frame.
import { T } from './engine.js';
import { CU } from './clock.js';

const auraMat = new T.ShaderMaterial({
    uniforms: { uNow: CU.uNow },
    vertexShader: `attribute vec3 aC; attribute vec3 aU; varying vec3 vC; varying vec3 vU; varying float vD;
        void main() { vC = aC; vU = aU; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNow; varying vec3 vC; varying vec3 vU; varying float vD;
        void main() {
            float a;
            if (vU.z < 0.5) { a = max(0.0, 1.0 - length(vU.xy)); a *= a; }
            else { a = pow(max(0.0, 1.0 - vU.y), 1.7) * (0.72 + 0.28 * sin(vU.x * 9.0 + uNow * 1.6)); }
            a *= (0.82 + 0.18 * sin(uNow * 2.6 + vU.z * 37.0)) * (1.0 - smoothstep(150.0, 260.0, vD));
            if (a < 0.004) discard;
            gl_FragColor = vec4(vC, a);
            #include <colorspace_fragment>
        }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true, toneMapped: false,
});
auraMat.customProgramCacheKey = () => 'g1-aura';
const tc = new T.Color();

export class Aura {
    constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; this.phase = 0; }
    quad(a, b, c, d, ua, ub, uc, ud, color, k) {
        const i = this.pos.length / 3;
        tc.set(color).multiplyScalar(k);
        for (const p of [a, b, c, d]) { this.pos.push(p[0], p[1], p[2]); this.col.push(tc.r, tc.g, tc.b); }
        for (const u of [ua, ub, uc, ud]) this.uv.push(u[0], u[1], u[2]);
        this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    next() { this.phase = (this.phase + 0.13) % 0.49; return this.phase; }
    // a pool of light on the floor
    halo(x, y, z, r, color, k) { this.halo2(x, y, z, r, r, color, k); }
    halo2(x, y, z, rx, rz, color, k) {
        const p = this.next();
        this.quad([x - rx, y, z - rz], [x + rx, y, z - rz], [x + rx, y, z + rz], [x - rx, y, z + rz], [-1, -1, p], [1, -1, p], [1, 1, p], [-1, 1, p], color, k);
    }
    // a glow on an upright thing, facing the way you come from
    glow(x, y, z, rx, ry, color, k) {
        const p = this.next();
        this.quad([x - rx, y - ry, z], [x + rx, y - ry, z], [x + rx, y + ry, z], [x - rx, y + ry, z], [-1, -1, p], [1, -1, p], [1, 1, p], [-1, 1, p], color, k);
    }
    // a column of colour rising off a shape of n sides, fading as it goes up
    column(x, y, z, r, h, n, color, k) {
        const p = 0.5 + this.next();
        for (let i = 0; i < n; i++) {
            const a0 = i / n * Math.PI * 2 + Math.PI / 6, a1 = (i + 1) / n * Math.PI * 2 + Math.PI / 6;
            const ax = x + Math.cos(a0) * r, az = z + Math.sin(a0) * r, bx = x + Math.cos(a1) * r, bz = z + Math.sin(a1) * r;
            this.quad([ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az], [i, 0, p], [i + 1, 0, p], [i + 1, 1, p], [i, 1, p], color, k);
        }
    }
    // the same off a rectangle
    walls(x0, x1, z0, z1, y, h, color, k) {
        const p = 0.5 + this.next(), L = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
        L.forEach(([ax, az, bx, bz], i) => { const d = Math.hypot(bx - ax, bz - az) / 4; this.quad([ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az], [i, 0, p], [i + d, 0, p], [i + d, 1, p], [i, 1, p], color, k); });
    }
    build(parent) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('aC', new T.Float32BufferAttribute(this.col, 3));
        g.setAttribute('aU', new T.Float32BufferAttribute(this.uv, 3));
        g.setIndex(this.idx);
        this.mesh = new T.Mesh(g, auraMat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        parent.add(this.mesh);
        this.pos = this.col = this.uv = this.idx = null;
        return this.mesh;
    }
    dispose() { if (this.mesh) this.mesh.geometry.dispose(); }
}
