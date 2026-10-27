import * as THREE from 'three';

/**
 * RoomDoors — puerta de entrada con marco LED, manija, placa de número y aplique, como en los renders
 * (puertas 406/407). Se abre al tocarla y se puede caminar por el vano (FloorTour consulta `passages`).
 *
 * Hoja plana en nogal Sikuani (veta vertical), recuadro de roble claro con tira LED cálida junto a la hoja, luz fría
 * bajo la hoja, manija negra, y placa oscura con el número apilado en rosa y aplique de pared al lado.
 * El modelo de Revit no exporta hojas de puerta; la posición sale de los muros del Piso 2:
 *   x, z   → centro del vano sobre la línea de muro del pasillo (z = −12,48 m) · w → ancho libre
 *   hinge  → lado de la bisagra mirando al pasillo (+1 derecha local) · out → hacia el pasillo
 *   plate  → [x, z] de la placa sobre el muro exterior (cara hacia el pasillo)
 */
const P2 = 3.02;
const DOOR_H = 2.1;
const OPEN_ANGLE = 1.75;   // ≈100°, hacia el vestíbulo de la habitación

export const ROOM_DOORS = {
  'HAB-215': { number: '215', x: -1.25, z: -10.14, w: 0.98, plate: [-2.08, -12.64], out: [0, -1] },
  'HAB-216': { number: '216', x: 0.595, z: -10.14, w: 0.85, plate: [1.26, -12.64], out: [0, -1] }
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
  }

  build(lib, rooms) {
    const ids = new Set((rooms || []).map((r) => r.id));
    const wood = lib.get('NOGAL'), oak = lib.get('WALL_LISMORE'), steel = lib.get('ACERO');
    const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc487).multiplyScalar(2.2), toneMapped: false });
    const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe0ff).multiplyScalar(1.6), toneMapped: false });
    const sconce = new THREE.MeshStandardMaterial({ color: 0xcaa89c, roughness: 0.5, metalness: 0.1, emissive: 0xffc98a, emissiveIntensity: 0.35 });

    for (const [id, d] of Object.entries(ROOM_DOORS)) {
      if (!ids.has(id)) continue;
      const g = new THREE.Group();
      const w = d.w, yC = P2 + DOOR_H / 2;
      const box = (parent, bw, bh, bd, mat, x, y, z) => {
        const geo = new THREE.BoxGeometry(bw, bh, bd); metricUV(geo, bw, bh, bd);
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
      };
      // hoja con bisagra en el borde derecho (local +x): el pivote gira, las piezas cuelgan hacia -x
      const pivot = new THREE.Group(); pivot.position.set(w / 2, 0, 0); g.add(pivot);
      const px = (x) => x - w / 2;
      const leaf = box(pivot, w, DOOR_H, 0.045, wood, px(0), yC, 0);
      leaf.userData.doorId = id;
      box(pivot, w * 0.94, 0.012, 0.05, cool, px(0), P2 + 0.014, 0.004);
      const hx = -w / 2 + 0.07;
      for (const s of [1, -1]) {
        box(pivot, 0.045, 0.045, 0.012, steel, px(hx), P2 + 1.0, s * 0.028);
        box(pivot, 0.13, 0.02, 0.02, steel, px(hx + 0.065), P2 + 1.0, s * 0.05);
      }
      // marco fijo: recuadro de roble claro (6 cm) y tira LED (1.2 cm) pegada a la hoja, en la cara hacia el pasillo
      const tr = 0.06, ld = 0.012, zf = 0;
      box(g, tr, DOOR_H + tr, 0.17, oak, -(w / 2 + ld + tr / 2), yC + tr / 2, zf);
      box(g, tr, DOOR_H + tr, 0.17, oak, (w / 2 + ld + tr / 2), yC + tr / 2, zf);
      box(g, w + 2 * (ld + tr), tr, 0.17, oak, 0, P2 + DOOR_H + tr / 2, zf);
      for (const zz of [0.09, -0.09]) {   // tira LED en ambas caras del marco
        box(g, ld, DOOR_H + ld, 0.02, led, -(w / 2 + ld / 2), yC + ld / 2, zz);
        box(g, ld, DOOR_H + ld, 0.02, led, (w / 2 + ld / 2), yC + ld / 2, zz);
        box(g, w + 2 * ld, ld, 0.02, led, 0, P2 + DOOR_H + ld / 2, zz);
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

      this.doors.push({ id, d, pivot, leaf, open: false, tween: null,
        // zona de paso (mundo): solo cuenta como libre cuando la puerta está abierta
        rect: { x0: d.x - w / 2 - 0.05, x1: d.x + w / 2 + 0.05, z0: d.z - 0.55, z1: d.z + 0.5 } });
    }
    return this.group;
  }

  /** ¿está (x,z) dentro de un vano con la puerta abierta? → FloorTour no lo trata como muro. */
  passable(x, z) {
    return this.doors.some((o) => o.open && x > o.rect.x0 && x < o.rect.x1 && z > o.rect.z0 && z < o.rect.z1);
  }

  /** Hoja cerrada: bloquea el paso aunque el vano libre sea ancho. */
  blocks(x, z) {
    return this.doors.some((o) => !o.open && x > o.rect.x0 && x < o.rect.x1 && Math.abs(z - o.d.z) < 0.2);
  }

  toggle(o) {
    o.open = !o.open;
    o.tween?.kill?.();
    const to = o.open ? -OPEN_ANGLE : 0;
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
