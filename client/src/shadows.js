// Soft contact shadows under everyone and the beach balls, for Low quality (no shadow map there): one instanced
// mesh of soft dark discs on the ground, smaller and fainter the higher the thing above it. With the shadow map on
// they aren't drawn (the real shadows do it).
import { T, scene } from './engine.js';

const MAX = 48, m4 = new T.Matrix4();
let mesh = null, n = 0, on = false;
function discTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(26,16,48,0.55)'); g.addColorStop(0.55, 'rgba(26,16,48,0.32)'); g.addColorStop(1, 'rgba(26,16,48,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
}
export function initShadows() {
    mesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: discTexture(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), MAX);
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    // one disc for the warm-up (the shader compiles at load)
    mesh.setMatrixAt(0, m4.makeTranslation(0, -100, 0)); mesh.count = 1;
    scene.add(mesh);
}
export function shadowsOn(v) { on = !!v; }
export const begin = () => { n = 0; };
// something above (x, gy, z), its height above the ground h, its size
export function add(x, gy, z, h, size) {
    if (!on || n >= MAX || h > 40) return;
    const k = size * (1 - Math.min(0.6, h / 30));
    m4.makeScale(k, 1, k).setPosition(x, gy + 0.05, z);
    mesh.setMatrixAt(n++, m4);
}
export function end() { if (!mesh) return; mesh.count = n; mesh.visible = n > 0; if (n) mesh.instanceMatrix.needsUpdate = true; }
