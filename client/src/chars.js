// A character on screen: you, someone else in your world, a rival in a race. The Bloxity avatar (the top games'
// run / jump / land animation), squash and stretch on every jump and landing, the name tag, their trail behind them
// as they run and their aura.
import { T, V3, scene, billboard, buildRig, animRig, airPose, lerpAngle } from './engine.js';
import { createAvatar, unpackAvatar } from './avatar.js';
import * as FX from './fx.js';
import { TRAILS, AURAS, RANKS, rankOf } from '../../shared/config.js';
class Pet { update() {} dispose() {} }

const PIVOT = 2.6;
const KIT = { shirt: 0x2a8aff, shorts: 0x26263e, socks: 0xffffff, hair: 0x3a2618, skin: 0xf2c9a0 };
const rankIcon = (tr) => RANKS[rankOf(tr)].icon;
export const nameLines = (name, lv, tr, color) => [{ t: rankIcon(tr) + ' Lv. ' + (lv || 1), c: '#ffe24a', s: '#3a2400', px: 40 }, { t: name || ' ', c: color || '#ffffff', s: '#10203a', px: 52 }];

// Avatars are built one a frame at most (a whole climb's worth at once was a long frame on a slow laptop);
// main.js pumps the queue every frame, and waits for it behind the fade into a climb
const avQueue = [];
let avBusy = false;
export function pumpAvatars() {
    if (avBusy || !avQueue.length) return;
    const job = avQueue.shift();
    if (job.char.dead) return;
    avBusy = true;
    createAvatar(job.data).then((a) => { avBusy = false; job.done(a); }, () => { avBusy = false; job.done(null); });
}
export const avatarsPending = () => avQueue.length + (avBusy ? 1 : 0);

export class Char {
    // o: { name, lv, tr, local, color (the name's), noLabel }
    constructor(o) {
        o = o || {};
        this.root = new T.Group();
        this.sq = new T.Group();                        // squash and stretch round the feet
        this.root.add(this.sq);
        const pivot = new T.Group(); pivot.position.y = PIVOT; this.sq.add(pivot);
        const body = buildRig(o.kit || KIT); body.position.y = -PIVOT; pivot.add(body);
        this.body = body; this.pivot = pivot;
        scene.add(this.root);
        this.blox = null; this.av = null; this.loading = false; this.dead = false;
        this.labelKey = '';
        this.label = o.noLabel ? null : billboard(nameLines(o.name, o.lv, o.tr, o.color), 6, 512, new V3(0, 8.6, 0), this.root);
        if (this.label) this.label.renderOrder = 9;
        this.pets = []; this.petKey = '';
        this.trail = null; this.trailIdx = -1; this.aura = 0;
        this.squashV = 0; this.squashX = 0; this.phase = 0;
        this.feet = new V3();
    }
    setLabel(name, lv, tr, color) {
        if (!this.label) return;
        const k = name + '|' + lv + '|' + tr + '|' + (color || '');
        if (k === this.labelKey) return;
        this.labelKey = k;
        this.label.userData.set(nameLines(name, lv, tr, color));
    }
    // a packed avatar (someone else's), or an avatar object made already (yours)
    setAvatar(packed) {
        if (packed === this.av && (this.blox || this.loading)) return;
        this.av = packed;
        const data = packed ? unpackAvatar(packed) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        avQueue.push({ char: this, data, done: (a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.wear(a);
            if (this.av !== packed) this.setAvatar(this.av);
        } });
    }
    wear(a) {
        if (this.blox && this.blox !== a) this.blox.dispose();
        this.blox = a;
        // the blocky stand-in body goes for good (its parts share their geometry and colours: nothing to free)
        for (const c of [...this.body.children]) if (c !== a.root) this.body.remove(c);
        this.body.add(a.root);
    }
    setPets(ids) {
        const key = (ids || []).join(',');
        if (key === this.petKey) return;
        this.petKey = key;
        for (const p of this.pets) p.dispose();
        this.pets = (ids || []).slice(0, 3).map((id, i) => new Pet(id, i, scene));
    }
    setTrail(i) {
        if (i === this.trailIdx) return;
        this.trailIdx = i;
        const T0 = TRAILS[i];
        if (!T0 || T0.id === 'none') { if (this.trail) { this.trail.dispose(); this.trail = null; } return; }
        if (!this.trail) this.trail = FX.makeTrail(T0.c1);
        this.trail.setColor(T0.c1, !!T0.rainbow);
        this.trail.width = 0.9;
    }
    setAura(i) { this.aura = AURAS[i] && AURAS[i].id !== 'none' ? i : 0; }
    // the jump: a stretch up; a landing: a squash (k 0..1.5)
    stretch(k) { this.squashV = -0.22 * Math.min(1, k); this.squashX = 0; }
    squash(k) { this.squashV = 0.32 * Math.min(1.5, k); this.squashX = 0; }
    // st: { x, y, z, ry, air, moving, speed, vy, jump, airJump, sprint, ground (y under the pets), far (simpler:
    // no pets or trail, animated every other frame) }
    update(dt, t, st) {
        const r = this.root;
        r.position.set(st.x, st.y, st.z);
        if (st.ry !== undefined) r.rotation.y = st.snapRy ? st.ry : lerpAngle(r.rotation.y, st.ry, 1 - Math.exp(-dt * 14));
        // squash and stretch: a spring back to round
        this.squashX += (-this.squashV * 180 - this.squashX * 16) * dt;
        this.squashV += this.squashX * dt;
        const s = Math.max(-0.35, Math.min(0.45, this.squashV));
        this.sq.scale.set(1 + s * 0.55, 1 - s, 1 + s * 0.55);
        this.phase += dt * (st.moving && !st.air ? Math.min(18, 4 + (st.speed || 0) * 0.3) : 0);
        this.skip = st.far ? !this.skip : false;
        this.animDt = (this.animDt || 0) + dt;
        if (this.blox) { if (!this.skip) { this.blox.update(this.animDt, { moving: st.moving && !st.air, air: st.air, vy: st.vy, speed: st.speed, hspeed: st.speed, jump: st.jump, airJump: st.airJump, t, sprint: st.sprint }); this.animDt = 0; } }
        else if (st.air) airPose(this.body); else if (st.moving) animRig(this.body, this.phase, 0.85); else animRig(this.body, 0, 0);
        this.feet.set(st.x, st.y, st.z);
        for (const p of this.pets) { p.mesh.visible = !st.far; if (!st.far) p.update(dt, t, this.feet, r.rotation.y, st.ground ?? st.y); }
        if (this.trail) { FX.tmpV.set(st.x, st.y + 2.6, st.z); this.trail.update(FX.tmpV, (!!st.air || (st.moving && (st.speed || 0) > 12)) && !st.far, dt, t); }
        if (this.aura) { const A = AURAS[this.aura]; FX.auraColor(this.feet, A.c1, !!A.rainbow, dt); }
    }
    // hidden (far off, another world): out of the scene too, so its bones and parts aren't worked out every frame
    setVisible(on) {
        if (on === this.shown) return;
        this.shown = on;
        this.root.visible = on;
        if (on && !this.root.parent && !this.dead) scene.add(this.root); else if (!on && this.root.parent) scene.remove(this.root);
        for (const p of this.pets) p.mesh.visible = on;
        if (this.trail && !on) this.trail.reset();
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        scene.remove(this.root);
        if (this.label && this.label.userData.ownTex) this.label.material.map.dispose();
        for (const p of this.pets) p.dispose();
        if (this.trail) this.trail.dispose();
    }
}
