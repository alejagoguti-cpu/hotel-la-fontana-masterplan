import * as THREE from 'three';

/**
 * RoomDoors — par de puertas de entrada de las habitaciones 215 y 216 (plano general AI-100, Piso 2).
 *
 * En el plano las dos puertas van juntas en el muro del pasillo, al fondo del vestíbulo de cada habitación, bajo un solo marco
 * ("apertura de marco completo entre dos puertas", spec INT-701/702): hojas planas de melamina Sikuani, paño de madera entre
 * ellas, recuadro de roble claro con riel LED por dentro, luz fría bajo las hojas, manija negra, y placa de número oscura con
 * aplique a cada lado (INT-626).
 *
 * El GLB de Revit no exporta puertas y trae ese muro macizo: el hueco se abre con un recorte (planos de corte de material en
 * forma de caja), y las hojas se abren al tocarlas. Con la hoja abierta se puede caminar por el vano (FloorTour._blocked).
 *   x, z   → centro de la hoja sobre el eje del muro (z = −12,33 m) · w → ancho de hoja
 *   hinge  → lado de la bisagra en el eje local (+1 / −1) · out → hacia el pasillo
 *   plate  → [x, z] de la placa sobre el muro exterior
 */
const P2 = 3.02;
const DOOR_H = 2.1;
const OPEN_ANGLE = 1.75;   // ≈100°, hacia el vestíbulo de la habitación

export const ROOM_DOORS = {
  'HAB-215': { number: '215', x: -1.055, z: -12.33, w: 0.9, hinge: 1, plate: [-2.1, -12.64], out: [0, -1] },
  'HAB-216': { number: '216', x: 0.395, z: -12.33, w: 0.8, hinge: -1, plate: [1.28, -12.64], out: [0, -1] }
};

function metricUV(geo, w, h, d) {
  const uv = geo.attributes.uv, sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * sizes[f][0], uv.getY(i) * sizes[f][1]); }
  uv.needsUpdate = true;
}

function plateTexture(text) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#221a16'; g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#e2b4ae'; g.font = '600 92px "Roboto", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...text].forEach((ch, i) => g.fillText(ch, 64, 96 + i * 128));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class RoomDoors {
  constructor(app, tour) {
    this.app = app; this.tour = tour;
    this.doors = [];
    this.group = new THREE.Group(); this.group.name = 'PuertasHabitacion';
    this.ray = new THREE.Raycaster();
    this.down = null;
    this.carved = false;
    this.carveBox = null;
  }

  build(lib, rooms) {
    const ids = new Set((rooms || []).map((r) => r.id));
    // materiales propios: el recorte del hueco se aplica a los materiales de los muros y no debe cortar las hojas ni el marco
    const wood = lib.get('NOGAL').clone(), oak = lib.get('WALL_LISMORE').clone(), steel = lib.get('ACERO').clone();
    const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc487).multiplyScalar(2.2), toneMapped: false });
    const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe0ff).multiplyScalar(1.6), toneMapped: false });
    const sconce = new THREE.MeshStandardMaterial({ color: 0xcaa89c, roughness: 0.5, metalness: 0.1, emissive: 0xffc98a, emissiveIntensity: 0.35 });
    const mk = (parent, bw, bh, bd, mat, x, y, z) => {
      const geo = new THREE.BoxGeometry(bw, bh, bd); metricUV(geo, bw, bh, bd);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
    };
    const active = Object.entries(ROOM_DOORS).filter(([id]) => ids.has(id));
    if (!active.length) return this.group;

    for (const [id, d] of active) {
      const g = new THREE.Group();
      const w = d.w, yC = P2 + DOOR_H / 2, hs = d.hinge || 1;
      // hoja: el pivote está en el borde de la bisagra; las piezas cuelgan hacia el otro lado
      const pivot = new THREE.Group(); pivot.position.set(hs * w / 2, 0, 0); g.add(pivot);
      const px = (x) => x - hs * w / 2;
      const leaf = mk(pivot, w, DOOR_H, 0.045, wood, px(0), yC, 0);
      leaf.userData.doorId = id;
      mk(pivot, w * 0.94, 0.012, 0.05, cool, px(0), P2 + 0.014, 0.004);
      const hx = -hs * (w / 2 - 0.07);
      for (const s of [1, -1]) {
        mk(pivot, 0.045, 0.045, 0.012, steel, px(hx), P2 + 1.0, s * 0.028);
        mk(pivot, 0.13, 0.02, 0.02, steel, px(hx - hs * 0.065), P2 + 1.0, s * 0.05);
      }
      g.position.set(d.x, 0, d.z);
      g.rotation.y = Math.atan2(d.out[0], d.out[1]);   // +Z local → hacia el pasillo
      this.group.add(g);

      // placa de número y aplique, sobre el muro exterior
      const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(d.number), roughness: 0.55, metalness: 0.05 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.02), plateMat);
      plate.position.set(d.plate[0], P2 + 1.42, d.plate[1]); plate.rotation.y = g.rotation.y; this.group.add(plate);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), sconce);
      lamp.position.set(d.plate[0], P2 + 1.86, d.plate[1] - d.out[1] * 0.04); this.group.add(lamp);

      this.doors.push({ id, d, pivot, leaf, hs, open: false, tween: null,
        // zona de paso (mundo): solo cuenta como libre cuando la puerta está abierta
        rect: { x0: d.x - w / 2 - 0.05, x1: d.x + w / 2 + 0.05, z0: d.z - 0.6, z1: d.z + 0.55 } });
    }

    // marco único del par: recuadro de roble claro, paño de madera entre hojas y riel LED por dentro
    const x0 = Math.min(...active.map(([, d]) => d.x - d.w / 2)), x1 = Math.max(...active.map(([, d]) => d.x + d.w / 2));
    const z = active[0][1].z, tr = 0.07, ld = 0.014, depth = 0.17, H = DOOR_H, yC = P2 + H / 2;
    const frame = new THREE.Group(); frame.position.set(0, 0, z); this.group.add(frame);
    mk(frame, tr, H + tr, depth, oak, x0 - ld - tr / 2, yC + tr / 2, 0);
    mk(frame, tr, H + tr, depth, oak, x1 + ld + tr / 2, yC + tr / 2, 0);
    mk(frame, x1 - x0 + 2 * (ld + tr), tr, depth, oak, (x0 + x1) / 2, P2 + H + tr / 2, 0);
    for (const zz of [depth / 2 + 0.004, -depth / 2 - 0.004]) {
      mk(frame, ld, H + ld, 0.012, led, x0 - ld / 2, yC + ld / 2, zz);
      mk(frame, ld, H + ld, 0.012, led, x1 + ld / 2, yC + ld / 2, zz);
      mk(frame, x1 - x0 + 2 * ld, ld, 0.012, led, (x0 + x1) / 2, P2 + H + ld / 2, zz);
    }
    // paño de madera entre las dos hojas (entre sus bordes interiores)
    const inner = active.map(([, d]) => [d.x - d.w / 2, d.x + d.w / 2]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < inner.length; i++) {
      const a = inner[i][1], b = inner[i + 1][0];
      if (b - a > 0.05) mk(frame, b - a, H, depth, wood, (a + b) / 2, yC, 0);
    }
    // hueco en el muro macizo del GLB: caja de recorte
    this.carveBox = { x0, x1, y0: P2 + 0.03, y1: P2 + H + 0.06, z0: z - 0.3, z1: z + 0.3 };
    return this.group;
  }

  /** Abre el hueco: los materiales de los muros descartan lo que cae dentro de la caja (planos de corte en intersección). */
  applyCarve() {
    if (this.carved || !this.carveBox) return;
    const b = this.carveBox;
    const planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -b.x1), new THREE.Plane(new THREE.Vector3(-1, 0, 0), b.x0),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.y1), new THREE.Plane(new THREE.Vector3(0, -1, 0), b.y0),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -b.z1), new THREE.Plane(new THREE.Vector3(0, 0, -1), b.z0)
    ];
    const box = new THREE.Box3(new THREE.Vector3(b.x0 - 0.05, b.y0, b.z0 - 0.05), new THREE.Vector3(b.x1 + 0.05, b.y1, b.z1 + 0.05));
    const seen = new Set(), tmp = new THREE.Box3();
    this.app.renderer.localClippingEnabled = true;
    this.app.scene.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.isShaderMaterial) return;
      let p = o, mine = false; while (p) { if (p === this.group) { mine = true; break; } p = p.parent; }
      if (mine) return;
      tmp.setFromObject(o);
      if (!tmp.intersectsBox(box)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (seen.has(m)) continue; seen.add(m);
        m.clippingPlanes = planes; m.clipIntersection = true; m.needsUpdate = true;
      }
    });
    this.carved = true;
  }

  /** ¿está (x,z) dentro de un vano con la puerta abierta? → FloorTour no lo trata como muro. */
  passable(x, z) {
    return this.doors.some((o) => o.open && x > o.rect.x0 && x < o.rect.x1 && z > o.rect.z0 && z < o.rect.z1);
  }

  /** Hoja cerrada: bloquea el paso. */
  blocks(x, z) {
    return this.doors.some((o) => !o.open && x > o.rect.x0 && x < o.rect.x1 && Math.abs(z - o.d.z) < 0.2);
  }

  toggle(o) {
    o.open = !o.open;
    o.tween?.kill?.();
    const to = o.open ? -o.hs * OPEN_ANGLE : 0;
    if (window.gsap) o.tween = window.gsap.to(o.pivot.rotation, { y: to, duration: 0.9, ease: 'power2.inOut' });
    else o.pivot.rotation.y = to;
  }

  _pick(ev) {
    const el = this.app.renderer.domElement, r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.app.camera);
    this.ray.far = 6;
    const hit = this.ray.intersectObjects(this.doors.map((o) => o.leaf), false)[0];
    return hit ? this.doors.find((o) => o.leaf === hit.object) : null;
  }

  /** Clic (sin arrastrar) sobre una hoja la abre o la cierra. */
  attach() {
    const el = this.app.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      const dn = this.down; this.down = null;
      if (!dn || this.tour.mode !== 'room' || !this.group.parent?.visible) return;
      if (Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 6) return;      // fue un arrastre para mirar
      const o = this._pick(e);
      if (o) this.toggle(o);
    });
    let last = 0;
    el.addEventListener('pointermove', (e) => {
      if (this.tour.mode !== 'room' || e.buttons || performance.now() - last < 120) return;
      last = performance.now();
      el.style.cursor = this._pick(e) ? 'pointer' : '';
    });
  }
}
