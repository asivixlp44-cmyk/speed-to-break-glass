import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const T = THREE;
export const V3 = THREE.Vector3;
const elCache = new Map();
export const $ = (s) => { let e = elCache.get(s); if (!e || !e.isConnected) { e = document.querySelector(s); if (e && /^#[\w-]+$/.test(s)) elCache.set(s, e); } return e; };
export const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

// ----- the graphics chip -----
// Its name, read once from a throwaway context before the game's own exists (asking the game's context
// later makes it wait for the GPU)
export const GPU_NAME = (() => {
    try {
        const c = document.createElement('canvas'), gl = c.getContext('webgl2', { powerPreference: 'high-performance' }) || c.getContext('webgl');
        if (!gl) return '';
        const x = gl.getExtension('WEBGL_debug_renderer_info'), name = String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return name;
    } catch (e) { return ''; }
})();
// software renderers, older integrated chips and phone chips (they start on Low)
export function weakGPUName(name) {
    name = String(name || '').toLowerCase();
    if (/swiftshader|llvmpipe|softpipe|software|basic render|mali|adreno|powervr|videocore/.test(name)) return true;
    // Intel's older integrated chips (HD Graphics, Iris before Xe, UHD 6xx) and AMD's small Vega / R-series ones
    if (/intel/.test(name) && /(^|[^u])hd graphics|iris\(r\) (plus|pro)?\s*graphics [0-9]|iris graphics|uhd graphics 6\d\d/.test(name)) return true;
    if (/radeon\(tm\) (r[2-5]|vega [3-8])\b|radeon r[2-5] graphics/.test(name)) return true;
    return false;
}
// a graphics chip that shares the computer's memory (Intel's, AMD's APUs): fine for the game, but every pixel
// counts, so Medium draws at the window's own pixel size rather than the screen's scaled-up one
export const INTEGRATED_GPU = /intel|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/i.test(GPU_NAME);
export const WEAK_PC = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// The quality the game starts on: your choice in Settings, else Low on phones and weak PCs (fx.js)
export const START_QUALITY = (() => {
    let q = '';
    try { q = localStorage.getItem('g1_quality') || ''; } catch (e) { /* none saved */ }
    return q || (TOUCH || WEAK_PC || weakGPUName(GPU_NAME) ? 'low' : 'medium');
})();

// ----- renderer, scene, camera, lights -----
export const canvas = $('#view');
// A PC or laptop starting on Low draws without multisampling: on an old integrated chip it costs a fifth
// or more of the frame. (It can only be chosen when the context is made.) A phone keeps it: Low already
// draws a phone's screen at a low resolution.
export const renderer = new T.WebGLRenderer({ canvas, antialias: TOUCH || START_QUALITY !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
// Shader error checks cost extra blocking GPU calls per shader; only in development
renderer.debug.checkShaderErrors = import.meta.env.DEV || !!import.meta.env.VITE_QA;
// PCFShadowMap: three r186 removed PCFSoft and switches it at the first shadow frame, which
// recompiles every material at once (a long freeze when the game starts)
renderer.shadowMap.type = T.PCFShadowMap;

export const scene = new T.Scene();
// a soft haze over the far hills (colour and distance follow the mood)
scene.fog = new T.Fog(0xd8f0ff, 300, 1100);
scene.background = new T.Color(0xcfe6ff);

// ----- sky: a gradient from the horizon up, soft clouds drifting by, a glowing haze below the
// horizon; events tint it. Only uniforms change, never the shader. A dome that follows the camera.
function cloudTile() {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const blob = (cx, cy, r, a) => {
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
            const px = cx + ox, py = cy + oy;
            if (px + r < 0 || px - r > N || py + r < 0 || py - r > N) continue;
            const g = x.createRadialGradient(px, py, r * 0.1, px, py, r);
            g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(0.55, 'rgba(255,255,255,' + (a * 0.75) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
    };
    for (let k = 0; k < 34; k++) {
        const cx = rnd() * N, cy = rnd() * N, R = 28 + rnd() * 46;
        for (let j = 0; j < 7; j++) blob(cx + (rnd() - 0.5) * R * 2.2, cy + (rnd() - 0.5) * R * 1.2, R * (0.45 + rnd() * 0.6), 0.55 + rnd() * 0.35);
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.NoColorSpace;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return t;
}
// high in the south-east
const SUN_DIR = new T.Vector3(0.55, 0.68, 0.48).normalize();
const MOON_DIR = new T.Vector3(-0.35, 0.42, 0.6).normalize();
const skyU = {
    uTime: { value: 0 }, uSun: { value: SUN_DIR }, uMoon: { value: MOON_DIR }, uClouds: { value: cloudTile() },
    uZen: { value: new T.Color() }, uHor: { value: new T.Color() }, uHaze: { value: new T.Color() }, uCloud: { value: new T.Color() }, uCloudK: { value: 1 }, uNight: { value: 0 },
    uAurora: { value: 0 }, uMeteor: { value: 0 }, uRain: { value: 0 },
};
const skyMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: skyU,
    vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform vec3 uMoon; uniform sampler2D uClouds;
        uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uHaze; uniform vec3 uCloud; uniform float uCloudK; uniform float uNight; uniform float uAurora; uniform float uMeteor; uniform float uRain; varying vec3 vDir;
        void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(mix(uHor, uHaze, 0.35), uZen, pow(max(h, 0.0), 0.35));
            float s = max(dot(d, uSun), 0.0);
            if (h > -0.02) {
                // a rainbow over the far end of the Run, behind the clouds
                if (uRain > 0.01) {
                    float rt = (acos(clamp(dot(d, vec3(0.2, -0.25, -0.95)), -1.0, 1.0)) - 0.6) / 0.21;
                    if (rt > 0.0 && rt < 1.0) { vec3 rc = clamp(abs(mod(rt * 5.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); col = mix(col, rc, sin(rt * 3.14159) * 0.55 * uRain * smoothstep(0.0, 0.12, h)); }
                }
                // around the sky exactly twice, so the tiling texture meets itself without a seam
                vec2 cuv = vec2(atan(d.z, d.x) / 3.14159265 + uTime * 0.004, h * 3.2);
                vec2 gx = dFdx(cuv), gy = dFdy(cuv);
                if (abs(gx.x) > 0.5) gx.x = 0.0;
                if (abs(gy.x) > 0.5) gy.x = 0.0;
                float c = textureGrad(uClouds, cuv, gx, gy).r * smoothstep(-0.02, 0.08, h) * (1.0 - smoothstep(0.25, 0.65, h));
                col = mix(col, uCloud + vec3(0.2, 0.16, 0.1) * pow(s, 6.0) * (1.0 - uNight), smoothstep(0.25, 0.7, c) * 0.85 * uCloudK);
                if (uNight > 0.01) {
                    vec3 q = floor(d * 260.0);
                    float st = step(0.9962, fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453));
                    col += st * uNight * smoothstep(0.03, 0.3, h) * (0.55 + 0.45 * sin(uTime * 2.5 + q.x)) * vec3(1.0, 0.96, 1.0) * (1.0 - c);
                    // the moon and its glow
                    float m = max(dot(d, uMoon), 0.0);
                    col += uNight * (vec3(1.0, 0.97, 0.88) * smoothstep(0.9991, 0.9994, m) * 1.3 + vec3(0.6, 0.62, 0.8) * pow(m, 60.0) * 0.35);
                }
                // the aurora: green and violet curtains rippling across the sky
                if (uAurora > 0.01) {
                    float az = atan(d.z, d.x);
                    float band = sin(az * 3.0 + sin(az * 7.0 + uTime * 0.3) * 0.6 + uTime * 0.12);
                    float hgt = smoothstep(0.08, 0.3, h) * (1.0 - smoothstep(0.42, 0.75, h + band * 0.08));
                    float rays = 0.55 + 0.45 * sin(az * 60.0 + uTime * 1.5 + sin(az * 13.0) * 3.0);
                    vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.65, 0.35, 1.0), smoothstep(0.2, 0.55, h + band * 0.1));
                    col += ac * hgt * rays * (0.45 + 0.25 * band) * uAurora;
                }
                // meteors streaking down the sky (a Meteor Shower)
                if (uMeteor > 0.01) {
                    for (int i = 0; i < 4; i++) {
                        float fi = float(i);
                        float t = fract(uTime * 0.23 + fi * 0.37);
                        float a0 = fi * 1.7 + floor(uTime * 0.23 + fi * 0.37) * 2.3;
                        vec3 hd = normalize(vec3(cos(a0), 0.75 - t * 0.55, sin(a0)));
                        vec3 tl = normalize(hd + vec3(-sin(a0) * 0.05, 0.16, cos(a0) * 0.05));
                        vec3 ab = tl - hd; float k = clamp(dot(d - hd, ab) / dot(ab, ab), 0.0, 1.0);
                        float dist = length(d - (hd + ab * k));
                        col += vec3(1.0, 0.75, 0.45) * smoothstep(0.004, 0.0, dist) * (1.0 - k) * uMeteor * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.75, 1.0, t)) * 2.0;
                    }
                }
            }
            // below the horizon: a glowing haze over the far ground
            if (h < 0.02) col = mix(col, uHaze, smoothstep(0.02, -0.12, h));
            col += vec3(1.0, 0.95, 0.85) * (pow(s, 1400.0) * 3.0 + pow(s, 90.0) * 0.35) * (1.0 - uNight);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
        }`,
});
const skyDome = new T.Mesh(new T.SphereGeometry(4000, 32, 16), skyMat);
// drawn after everything solid, on the far plane (xyww) with the depth test on: only the pixels where the
// sky actually shows run its shader, not the whole screen (half the screen or more is road and hills)
skyDome.renderOrder = 100;
// QA only (__qa.legacy): the sky drawn first over the whole screen, as it was, to measure against
export function skyLegacy(on) { skyDome.renderOrder = on ? -10 : 100; skyMat.depthTest = !on; }
skyDome.frustumCulled = false;
scene.add(skyDome);
export const SUN_DIRECTION = SUN_DIR;

export const camera = new T.PerspectiveCamera(70, 1, 0.5, 4200);
function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 85 : 70;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// No image-based environment map, no reflections: building one (PMREM blur shaders) froze slow PCs
// for seconds at load. A sky / ground hemisphere light gives the soft fill, the sun adds direction
// and crisp shadows on top, and a little ambient keeps the shade from going dull.
export const hemi = new T.HemisphereLight(0xeaf2ff, 0xb8c0d0, 1.1);
export const ambient = new T.AmbientLight(0xffffff, 0.45);
scene.add(hemi, ambient);
export const sun = new T.DirectionalLight(0xfff4ea, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 420 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2;
scene.add(sun, sun.target);

// ----- moods: the sky, haze, fog and light colours (one per world). The light rig itself is the
// top games' (hemisphere 1.1, ambient 0.45, sun 1.5) everywhere; a mood only tints it. -----
const M = (zen, hor, haze, cloud, fog, sky, ground, sun, night, near, far, aur, met, ck) => ({ zen, hor, haze, cloud, fog, sky, ground, sun, night, near, far, aur: aur || 0, met: met || 0, ck: ck ?? 1, hemi: 1.1, sunI: 1.5, amb: 0.45 });
const MOODS = {
    // Glasshouse Gardens: a bright summer morning, deep blue overhead to a clear horizon
    garden: M(0x1468f0, 0x8adcff, 0xe8f8ff, 0xffffff, 0xd8f0ff, 0xf4fbff, 0xcfe0c0, 0xfff6e4, 0, 300, 1100, 0, 0, 1.1),
    // Skyline Sprint: late afternoon over the city, gold on the horizon
    city: M(0x3a6ad8, 0xffc898, 0xffe4c8, 0xfff4e4, 0xf4d8c0, 0xfff0e0, 0xc8b8c8, 0xffe8c4, 0, 320, 1300, 0, 0, 0.8),
    // Frostpane Peaks: a clean cold sky, an aurora faintly over it
    frost: M(0x2a6ae0, 0xbfe8ff, 0xf0faff, 0xffffff, 0xe0f2ff, 0xf0f8ff, 0xc8e0f4, 0xf4faff, 0.08, 280, 1100, 0.35, 0, 0.9),
    // Ember Foundry: a dark violet dusk, the glow of the furnaces on the haze
    foundry: M(0x241038, 0xff8a4a, 0xffb07a, 0x8a5a6a, 0x5a3038, 0xe8c8c8, 0x7a4a48, 0xffc898, 0.3, 240, 900, 0, 0.4, 0.5),
};
MOODS.garden.rain = 1; MOODS.city.rain = 0.45; MOODS.frost.rain = 0.6; MOODS.foundry.rain = 0;
const moodNow = { rain: 0, zen: new T.Color(), hor: new T.Color(), haze: new T.Color(), cloud: new T.Color(), fog: new T.Color(), sky: new T.Color(), ground: new T.Color(), sunC: new T.Color(), hemi: 1.1, sunI: 1.5, amb: 0.45, night: 0, near: 140, far: 520, aur: 0, met: 0, ck: 1 };
let moodName = 'garden', moodK = 1, fogK = 1;
const tmpMood = new T.Color();
function applyMood(m, k) {
    for (const key of ['zen', 'hor', 'haze', 'cloud', 'fog', 'sky', 'ground']) moodNow[key].lerp(tmpMood.set(m[key]), k);
    moodNow.sunC.lerp(tmpMood.set(m.sun), k);
    for (const key of ['hemi', 'sunI', 'amb', 'night', 'near', 'far', 'aur', 'met', 'ck', 'rain']) moodNow[key] += (m[key] - moodNow[key]) * k;
    skyU.uRain.value = moodNow.rain;
    skyU.uZen.value.copy(moodNow.zen); skyU.uHor.value.copy(moodNow.hor); skyU.uHaze.value.copy(moodNow.haze); skyU.uCloud.value.copy(moodNow.cloud); skyU.uCloudK.value = moodNow.ck;
    skyU.uNight.value = moodNow.night; skyU.uAurora.value = moodNow.aur; skyU.uMeteor.value = moodNow.met;
    scene.fog.color.copy(moodNow.fog); scene.fog.near = moodNow.near * fogK; scene.fog.far = moodNow.far * fogK;
    hemi.color.copy(moodNow.sky); hemi.groundColor.copy(moodNow.ground); hemi.intensity = moodNow.hemi;
    sun.color.copy(moodNow.sunC); sun.intensity = moodNow.sunI; ambient.intensity = moodNow.amb;
}
applyMood(MOODS.garden, 1);
// how far the haze reaches (a tall tower pushes it out, so its top is still in view)
export function setFogScale(k) { fogK = k || 1; scene.fog.near = moodNow.near * fogK; scene.fog.far = moodNow.far * fogK; }
// Fades the sky and the light to a mood over a second or so (instantly when it loads)
export function setMood(name, now) {
    if (!MOODS[name]) return;
    if (now) { moodName = name; moodK = 1; applyMood(MOODS[name], 1); return; }
    if (name !== moodName) { moodName = name; moodK = 0; }
}
export const moodFar = () => moodNow.far;
// how dark it is (0 day .. 1 night): lamps and neon glow brighter at night
export const nightLevel = () => moodNow.night;
export function updateSky(pos, t, dt) {
    skyU.uTime.value = t;
    skyDome.position.copy(pos);
    if (moodK < 1) {
        moodK = Math.min(1, moodK + (dt || 0.016) * 0.9);
        applyMood(MOODS[moodName], moodK >= 1 ? 1 : Math.min(1, (dt || 0.016) * 3));
    }
}

// ----- materials & textures -----
export const UNIT = new T.BoxGeometry(1, 1, 1);
// Glowing parts are drawn unlit and a little brighter than their colour (there is no bloom)
export const NEON_BOOST = 1.25;
const matCache = new Map();
// The bright, soft Roblox look under the top games' light rig (the lights stay hemisphere
// 1.1, ambient 0.45, sun 1.5): every lit surface also gives back a share of its own colour, so the
// colours come out saturated and the shade never goes dull.
export const SELF_LIT = 0.3;
export const SELF_LIT_GLSL = '\ntotalEmissiveRadiance += diffuseColor.rgb * ' + SELF_LIT.toFixed(2) + ';';
export function selfLit(m) {
    if (m.userData.selfLit) return m;
    m.userData.selfLit = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.call(m);
    m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + SELF_LIT_GLSL);
    };
    // its own program key: the wrapper's source is the same for every material it wraps
    m.customProgramCacheKey = () => prevKey + '|sl';
    return m;
}
// Matte, non-reflective plastic (Lambert): cheap to draw and no specular gloss or reflections.
// Takes MeshStandardMaterial-style parameters and drops the ones a matte material doesn't have.
export function matte(p) {
    p = { ...(p || {}) };
    for (const k of ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'envMapIntensity']) delete p[k];
    return selfLit(new T.MeshLambertMaterial(p));
}
// Flat plastic in one colour (Roblox-style), matte; o.neon: unlit and a touch brighter
export function mat(color, o) {
    o = o || {};
    const key = color + '|' + (o.neon ? 1 : 0) + '|' + (o.opacity || 1) + '|' + (o.side || 0) + '|' + (o.emissive || 0) + '|' + (o.boost || 0);
    let m = matCache.get(key);
    if (!m) {
        m = o.neon ? new T.MeshBasicMaterial({ color }) : selfLit(new T.MeshLambertMaterial({ color }));
        if (o.neon) m.color.multiplyScalar(NEON_BOOST * (o.boost || 1));
        if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei ?? 0.5; }
        if (o.opacity && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
        if (o.side) m.side = T.DoubleSide;
        matCache.set(key, m);
    }
    return m;
}
export function texFrom(cv, repeat) {
    const t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
}
// A text texture by its content: the same label is drawn and uploaded to the GPU once and shared
// by every sign that shows it. Never dispose these.
const sharedTexs = new Map();
export function sharedTex(key, draw) {
    let t = sharedTexs.get(key);
    if (!t) { t = texFrom(draw()); sharedTexs.set(key, t); }
    return t;
}

// ----- Roblox studs -----
// One texture tile is 8 x 8 studs (a stud is one world unit: the world boxes use a tile of 8). Like the
// reference's plastic: each stud a flat square with a faint seam round it and a small rounded square
// sunk into its middle; a height field turned into a normal map, so the insets catch the sun and the
// sky light from any angle.
const STUD_TEX = (() => {
    const N = 256, C = 32, HALF = 7.5, RAD = 3, BEVEL = 2.2;
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const qx = Math.abs(x % C + 0.5 - C / 2) - (HALF - RAD), qy = Math.abs(y % C + 0.5 - C / 2) - (HALF - RAD);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RAD;
        h[y * N + x] = d <= 0 ? 0 : Math.min(1, d / BEVEL);
    }
    const albedo = document.createElement('canvas'); albedo.width = albedo.height = N;
    const normal = document.createElement('canvas'); normal.width = normal.height = N;
    const ai = albedo.getContext('2d').createImageData(N, N), ni = normal.getContext('2d').createImageData(N, N);
    const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4, v = at(x, y);
        const lx = x % C, ly = y % C, edge = lx < 1 || ly < 1;
        const g = edge ? 222 : 236 + v * 19;
        ai.data[i] = ai.data[i + 1] = ai.data[i + 2] = g; ai.data[i + 3] = 255;
        const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4, dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
        const len = Math.hypot(dx, dy, 1);
        ni.data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
        ni.data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
        ni.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        ni.data[i + 3] = 255;
    }
    albedo.getContext('2d').putImageData(ai, 0, 0);
    normal.getContext('2d').putImageData(ni, 0, 0);
    const map = texFrom(albedo), nrm = new T.CanvasTexture(normal);
    nrm.colorSpace = T.NoColorSpace;
    for (const t of [map, nrm]) { t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }
    return { map, nrm };
})();
export const STUDS = STUD_TEX;
// Studded plastic for the merged world boxes: one material for every colour (the colour is in the
// vertices), sharing the stud textures, so the whole world needs only a couple of materials
export function studVCMaterial() {
    let m = matCache.get('studvc');
    if (!m) {
        m = matte({ color: 0xffffff, vertexColors: true, map: STUD_TEX.map, normalMap: STUD_TEX.nrm, normalScale: new T.Vector2(0.7, 0.7) });
        matCache.set('studvc', m);
    }
    return m;
}
// Studded plastic in one colour for a single mesh (o.rx / o.ry: tile repeats on plain 0..1 UVs)
export function studMaterial(color, o) {
    o = o || {};
    const rx = Math.max(1, Math.round(o.rx || 1)), ry = Math.max(1, Math.round(o.ry || 1));
    const key = 'stud|' + color + '|' + rx + '|' + ry;
    let m = matCache.get(key);
    if (!m) {
        const map = STUD_TEX.map.clone(), nrm = STUD_TEX.nrm.clone();
        for (const t of [map, nrm]) { t.repeat.set(rx, ry); t.needsUpdate = true; }
        m = matte({ color, map, normalMap: nrm, normalScale: new T.Vector2(0.7, 0.7) });
        matCache.set(key, m);
    }
    return m;
}

// ----- world collections -----
// solids: { min, max, shape?, mat, zone, ... } — boxes, plus round shapes (dome / cyl) with their
// own surface tests (see main.js)
export const solids = [];
export const triggers = []; // { min, max, enter, inside, zone }
export const prompts = [];  // { pos, r, label(), act(), zone }
export const tickers = [];  // per-frame callbacks (dt, t)

export function aabb(x, y, z, sx, sy, sz) {
    return { min: new V3(x - sx / 2, y - sy / 2, z - sz / 2), max: new V3(x + sx / 2, y + sy / 2, z + sz / 2) };
}
export function solidBox(x, y, z, sx, sy, sz, o) {
    const c = aabb(x, y, z, sx, sy, sz);
    Object.assign(c, { zone: -1, mat: 'block' }, o || {});
    solids.push(c);
    return c;
}

// ----- text -----
// Picks the biggest font size (up to px) at which `text`, with its outline (strokeK x the size),
// fits inside maxW pixels; sets it on the canvas and returns it. Every sign uses this, so no
// letters are ever cut off at a board's edge, whatever font actually loaded.
export function fitFont(x, text, maxW, px, weight, family, strokeK) {
    const f = (p) => `${weight} ${p}px ${family}`, k = strokeK || 0;
    x.font = f(px);
    const w = x.measureText(text).width;
    if (w + px * k <= maxW) return px;
    // the width grows with the size: jump straight to the size that fits (one pixel at a time took up
    // to ~100 measures for a long label), then step down if the rounding needs it
    px = Math.max(8, Math.floor(px * maxW / (w + px * k)));
    x.font = f(px);
    while (px > 8 && x.measureText(text).width + px * k > maxW) { px -= 1; x.font = f(px); }
    return px;
}
// drawn on the CPU: these canvases only ever become textures, so nothing has to be read back from the graphics process
export const CPU2D = { willReadFrequently: true };
export function textCanvas(lines, W) { return paintLines(document.createElement('canvas'), lines, W); }
// draws lines onto a canvas (resized to fit them; cleared when it already has that size)
function paintLines(cv, lines, W) {
    const pad = 10;
    let H = pad * 2;
    for (const l of lines) H += l.px * 1.2;
    H = Math.ceil(H);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = cv.getContext('2d', CPU2D);
    x.clearRect(0, 0, W, H);
    let y = pad;
    for (const l of lines) {
        const iw = l.ic ? l.px * 0.95 : 0;
        // f: 'chunky': the big cartoon lettering of the signs and the +1s
        const chunky = l.f === 'chunky';
        const px = fitFont(x, l.t, W - 28 - iw, l.px, chunky ? 400 : l.w || 700, chunky ? '"Luckiest Guy", Fredoka, sans-serif' : 'Fredoka, "Arial Rounded MT Bold", sans-serif', l.s ? 0.28 : 0);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const cy = y + l.px * 0.62;
        let cx = W / 2;
        // an icon drawn before the words (never an emoji: a glyph's first draw stalls the frame)
        if (l.ic) { const tw = x.measureText(l.t).width, s = px * 0.86; cx = W / 2 + (s + px * 0.12) / 2; drawIcon(x, l.ic, cx - tw / 2 - px * 0.12 - s / 2, cy, s); }
        if (l.s) {
            x.lineJoin = 'round'; x.strokeStyle = l.s;
            // chunky: a drop shadow under a thick outline
            if (chunky) { x.lineWidth = Math.max(6, px * 0.3); x.strokeText(l.t, cx, cy + px * 0.07); }
            x.lineWidth = Math.max(4, px * (chunky ? 0.26 : 0.22)); x.strokeText(l.t, cx, cy);
        }
        if (l.g) {
            const g = x.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
            g.addColorStop(0, l.g[0]); g.addColorStop(1, l.g[1]);
            x.fillStyle = g;
        } else x.fillStyle = l.c || '#fff';
        x.fillText(l.t, cx, cy);
        y += l.px * 1.2;
    }
    return cv;
}
// The game's own icons, drawn: 'bolt' (Speed), 'shard' (a Shard), 'shoe' (a sneaker)
export function drawIcon(x, kind, cx, cy, s) {
    x.save();
    x.translate(cx, cy);
    x.lineJoin = 'round'; x.lineCap = 'round';
    if (kind === 'bolt') {
        const p = [[0.12, -0.5], [-0.3, 0.06], [-0.02, 0.06], [-0.12, 0.5], [0.32, -0.08], [0.04, -0.08], [0.16, -0.5]];
        x.beginPath(); p.forEach(([a, b], i) => (i ? x.lineTo(a * s, b * s) : x.moveTo(a * s, b * s))); x.closePath();
        x.lineWidth = s * 0.16; x.strokeStyle = '#06204a'; x.stroke();
        const g = x.createLinearGradient(0, -s / 2, 0, s / 2); g.addColorStop(0, '#f4ffff'); g.addColorStop(0.5, '#6ae8ff'); g.addColorStop(1, '#2a7aff');
        x.fillStyle = g; x.fill();
    } else if (kind === 'shoe') {
        // a red sneaker, side on: sole, body, toe cap, laces
        const u = s / 10;
        x.lineWidth = u * 0.9; x.strokeStyle = '#3a0a14';
        x.beginPath(); x.moveTo(-4.6 * u, 1.2 * u); x.lineTo(-4.4 * u, -3 * u); x.quadraticCurveTo(-3 * u, -3.8 * u, -1.6 * u, -2.6 * u); x.lineTo(1.4 * u, -0.4 * u); x.quadraticCurveTo(4.6 * u, 0 * u, 4.8 * u, 1.6 * u); x.lineTo(4.8 * u, 2.6 * u); x.lineTo(-4.6 * u, 2.6 * u); x.closePath();
        x.fillStyle = '#ff3a4a'; x.fill(); x.stroke();
        x.fillStyle = '#ffffff'; x.fillRect(-4.6 * u, 1.6 * u, 9.4 * u, 1.3 * u); x.strokeRect(-4.6 * u, 1.6 * u, 9.4 * u, 1.3 * u);
        x.strokeStyle = '#ffffff'; x.lineWidth = u * 0.6;
        for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo((-2.2 + i * 1.1) * u, (-1.9 + i * 0.7) * u); x.lineTo((-1.2 + i * 1.1) * u, (-2.6 + i * 0.7) * u); x.stroke(); }
    } else if (kind === 'shard') {
        // a jagged sliver of glass, cold blue with a white edge
        const u = s / 10;
        x.beginPath(); x.moveTo(0.4 * u, -4.8 * u); x.lineTo(3.4 * u, -1.2 * u); x.lineTo(1.8 * u, 4.6 * u); x.lineTo(-1.6 * u, 3.6 * u); x.lineTo(-3.4 * u, -0.6 * u); x.closePath();
        x.lineWidth = u * 1.1; x.strokeStyle = '#0a2a5a'; x.stroke();
        const g = x.createLinearGradient(-3 * u, -4 * u, 3 * u, 4 * u); g.addColorStop(0, '#f0feff'); g.addColorStop(0.5, '#7ae8ff'); g.addColorStop(1, '#2a8aff'); x.fillStyle = g; x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = u * 0.5; x.beginPath(); x.moveTo(0.4 * u, -4 * u); x.lineTo(-0.2 * u, 0.6 * u); x.lineTo(1.6 * u, 3.8 * u); x.stroke();
    } else if (kind === 'crown') {
        const u = s / 10;
        x.beginPath(); x.moveTo(-4.6 * u, 3 * u); x.lineTo(-4.8 * u, -2.6 * u); x.lineTo(-2.2 * u, 0); x.lineTo(0, -3.8 * u); x.lineTo(2.2 * u, 0); x.lineTo(4.8 * u, -2.6 * u); x.lineTo(4.6 * u, 3 * u); x.closePath();
        x.lineWidth = u * 1.1; x.strokeStyle = '#5a2a00'; x.stroke();
        const g = x.createLinearGradient(0, -4 * u, 0, 3 * u); g.addColorStop(0, '#fff6a0'); g.addColorStop(1, '#ffb21e'); x.fillStyle = g; x.fill();
        x.fillStyle = '#ff3a5a'; for (const px of [-2.4, 0, 2.4]) { x.beginPath(); x.arc(px * u, 1.4 * u, 0.7 * u, 0, Math.PI * 2); x.fill(); }
    } else {
        const r = s * 0.46;
        x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2);
        x.lineWidth = s * 0.12; x.strokeStyle = '#5a0a3a'; x.stroke();
        const g = x.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r); g.addColorStop(0, '#ffd0f0'); g.addColorStop(0.55, '#ff5ac0'); g.addColorStop(1, '#d8208a');
        x.fillStyle = g; x.fill();
        x.beginPath();
        const zx = [-0.22, 0.22, -0.22, 0.22, -0.22];
        zx.forEach((a, i) => { const b = -0.24 + i * 0.12; if (i) x.lineTo(a * s, b * s); else x.moveTo(a * s, b * s); });
        x.lineWidth = s * 0.09; x.strokeStyle = '#ffffff'; x.stroke();
    }
    x.restore();
}
// shared: a fixed label whose texture can be shared with others (see sharedTex); its own
// texture is made only when the text changes (set)
export function billboard(lines, worldW, W, pos, parent, shared) {
    W = W || 512;
    const map = shared ? sharedTex('bb|' + W + '|' + JSON.stringify(lines), () => textCanvas(lines, W)) : texFrom(textCanvas(lines, W));
    const cv = map.image;
    const sp = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.set(worldW, worldW * cv.height / cv.width, 1);
    if (pos) sp.position.copy(pos);
    sp.userData.ownTex = !shared;
    sp.userData.set = (nl) => {
        const c2 = textCanvas(nl, W);
        if (sp.userData.ownTex) sp.material.map.dispose();
        sp.userData.ownTex = true;
        sp.material.map = texFrom(c2);
        sp.material.needsUpdate = true;
        sp.scale.set(worldW, worldW * c2.height / c2.width, 1);
        if (!sp.matrixAutoUpdate) sp.updateMatrix();
    };
    (parent || scene).add(sp);
    return sp;
}
export function textPlane(lines, worldW, W, pos, look, parent) {
    const map = sharedTex('tp|' + (W || 512) + '|' + JSON.stringify(lines), () => textCanvas(lines, W || 512));
    const cv = map.image;
    const h = worldW * cv.height / cv.width;
    const m = new T.Mesh(new T.PlaneGeometry(worldW, h), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
    m.position.copy(pos);
    if (look) m.lookAt(look);
    (parent || scene).add(m);
    return m;
}

// ----- blocky fallback body (used until / unless the Bloxity avatar loads) -----
function buildHair(part, c) {
    part(1.3, 0.35, 1.3, 0, 5.33, -0.02, c);
    part(1.3, 0.75, 0.3, 0, 4.95, -0.5, c);
    part(1.3, 0.16, 0.2, 0, 5.16, 0.56, c);
}
export function buildRig(d) {
    const g = new T.Group();
    const part = (sx, sy, sz, x, y, z, c, parent) => {
        const m = new T.Mesh(UNIT, mat(c)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || g).add(m); return m;
    };
    part(2, 2, 1, 0, 3, 0, d.shirt);
    part(2.02, 0.12, 1.02, 0, 2.06, 0, d.shorts);
    const head = new T.Group(); g.add(head);
    part(1.2, 1.2, 1.2, 0, 4.6, 0, d.skin, head);
    for (const sx of [-0.26, 0.26]) {
        part(0.26, 0.24, 0.04, sx, 4.72, 0.605, 0xffffff, head);
        part(0.13, 0.18, 0.04, sx + (sx > 0 ? -0.04 : 0.04), 4.71, 0.625, 0x1a1420, head);
    }
    part(0.36, 0.07, 0.04, 0, 4.34, 0.64, 0x6b2a2a, head);
    buildHair((sx, sy, sz, x, y, z, c) => part(sx, sy, sz, x, y, z, c, head), d.hair ?? 0x3a2618);
    const legs = [], arms = [];
    for (const side of [-0.5, 0.5]) {
        const p = new T.Group(); p.position.set(side, 2, 0); g.add(p);
        part(1, 0.9, 1, 0, -0.45, 0, d.shorts, p);
        part(0.98, 1.1, 0.98, 0, -1.45, 0, d.socks, p);
        part(1.05, 0.42, 1.34, 0, -1.84, 0.12, 0x141418, p);
        legs.push(p);
    }
    for (const side of [-1.5, 1.5]) {
        const p = new T.Group(); p.position.set(side, 3.9, 0); g.add(p);
        part(1, 0.8, 1, 0, -0.4, 0, d.shirt, p);
        part(0.98, 1.2, 0.98, 0, -1.4, 0, d.skin, p);
        arms.push(p);
    }
    g.userData.legs = legs; g.userData.arms = arms; g.userData.head = head;
    return g;
}
export function animRig(g, phase, amt) {
    const s = Math.sin(phase) * amt;
    const u = g.userData;
    u.legs[0].rotation.set(s, 0, 0); u.legs[1].rotation.set(-s, 0, 0);
    u.arms[0].rotation.set(-s * 0.9, 0, 0); u.arms[1].rotation.set(s * 0.9, 0, 0);
}
export function airPose(g) {
    const u = g.userData;
    u.legs[0].rotation.set(0.5, 0, 0); u.legs[1].rotation.set(-0.3, 0, 0);
    u.arms[0].rotation.set(-2.6, 0, 0); u.arms[1].rotation.set(-2.6, 0, 0);
}
// Hands up on the truss, alternating as you climb
export function climbPose(g, phase) {
    const u = g.userData, s = Math.sin(phase);
    u.arms[0].rotation.set(-2.7 + s * 0.4, 0, 0); u.arms[1].rotation.set(-2.7 - s * 0.4, 0, 0);
    u.legs[0].rotation.set(-0.5 - s * 0.4, 0, 0); u.legs[1].rotation.set(-0.5 + s * 0.4, 0, 0);
}
// Holding a tool out in front (right arm)
export function holdPose(g) { g.userData.arms[1].rotation.set(-1.45, 0, 0); }

// ----- floating text -----
// At most a dozen at once, each a sprite from a pool: its canvas is redrawn and its texture refreshed
// (no new canvas, texture or material per harvest). A new one rising where another still is goes
// above it instead of on top of it.
const floaters = [], floatFree = [];
function dropFloater(f) { scene.remove(f.sp); floatFree.push(f); }
// pop: a comic word that bursts in big and settles; icon: 'bolt' / 'coin' before the text
// The numbers are chunky cartoon lettering with a sheen: white to gold (green ones: lime to green)
const FLOAT_GRAD = { '#ffffff': ['#ffffff', '#8ae8ff'], '#7dff6b': ['#eaffc8', '#3ee03a'], '#ffe24a': ['#fff8c0', '#ffb81e'], '#7af4ff': ['#f4ffff', '#3ab4ff'] };
// the same number again ("+1.5" a hundred times) takes the texture it was drawn into before: no canvas drawn, nothing
// sent to the graphics card (a few dozen kept, the oldest let go)
const floatTex = new Map();
function floatTexture(text, color, icon) {
    const key = text + '|' + color + '|' + (icon || '');
    let e = floatTex.get(key);
    if (e) { floatTex.delete(key); floatTex.set(key, e); return e; }
    const cv = textCanvas([{ t: text, c: color, g: FLOAT_GRAD[color], s: '#1a1030', px: 84, ic: icon, f: 'chunky' }], 384);
    e = { t: texFrom(cv), k: cv.height / cv.width };
    floatTex.set(key, e);
    if (floatTex.size > 48) { const [k0, old] = floatTex.entries().next().value; if (!floaters.some((f) => f.sp.material.map === old.t)) { old.t.dispose(); floatTex.delete(k0); } }
    return e;
}
export function floatText(text, color, pos, size, pop, icon) {
    if (floaters.length >= 12) dropFloater(floaters.shift());
    const tx = floatTexture(text, color, icon);
    let f = floatFree.pop();
    if (f) f.sp.material.map = tx.t;
    else {
        const sp = new T.Sprite(new T.SpriteMaterial({ map: tx.t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        sp.renderOrder = 12;
        f = { sp, base: new T.Vector3() };
    }
    const w = size || 5, h = w * tx.k;
    f.sp.position.copy(pos);
    for (let k = 0; k < 6; k++) {
        let hit = null;
        for (const o of floaters) if (Math.abs(o.sp.position.x - f.sp.position.x) < w * 0.6 && Math.abs(o.sp.position.z - f.sp.position.z) < w * 0.6 && Math.abs(o.sp.position.y - f.sp.position.y) < (h + o.h) * 0.5) { hit = o; break; }
        if (!hit) break;
        f.sp.position.y = hit.sp.position.y + (h + hit.h) * 0.55;
    }
    f.sp.scale.set(w, h, 1); f.base.set(w, h, 1); f.h = h;
    f.sp.material.opacity = 1;
    f.t = 1.15; f.pop = !!pop;
    f.sp.scale.set(w * 0.3, h * 0.3, 1);
    scene.add(f.sp);
    floaters.push(f);
}
// every number pops in (overshoots, settles), drifts up slowing down, and fades at the end; a big one pops harder
export function updateEffects(dt, dx, dz) {
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.t -= dt;
        if (dx || dz) { f.sp.position.x += dx; f.sp.position.z += dz; }
        const age = 1.15 - f.t, over = f.pop ? 0.45 : 0.22;
        f.sp.position.y += dt * (1 + 5 * Math.max(0, f.t));
        f.sp.material.opacity = Math.min(1, f.t / 0.35);
        const k = age < 0.09 ? 0.3 + age / 0.09 * (0.7 + over) : age < 0.24 ? 1 + over - (age - 0.09) / 0.15 * over : 1;
        f.sp.scale.set(f.base.x * k, f.base.y * k, 1);
        if (f.t <= 0) { dropFloater(f); floaters.splice(i, 1); }
    }
}

export function lerpAngle(a, b, k) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}

// Merges every mesh under root into one mesh per material (static props): many draw calls become few
export function mergeChildren(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4();
    const buckets = new Map(), done = [];
    root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        const keepColor = !!(o.material.vertexColors && g.attributes.color);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name) && !(keepColor && name === 'color')) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
        if (!buckets.has(o.material)) buckets.set(o.material, { list: [], shadow: false });
        const b = buckets.get(o.material);
        b.list.push(g); b.shadow = b.shadow || o.castShadow;
        done.push(o);
    });
    for (const o of done) o.parent.remove(o);
    for (const [material, b] of buckets) {
        const mesh = new T.Mesh(mergeGeometries(b.list), material);
        mesh.castShadow = b.shadow;
        mesh.receiveShadow = true;
        root.add(mesh);
        for (const g of b.list) g.dispose();
    }
}
