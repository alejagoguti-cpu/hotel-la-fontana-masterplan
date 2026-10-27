import * as THREE from 'three';

/**
 * RoomDoors — puerta de entrada con marco LED, manija negra y placa de número, como en los renders
 * (puertas 406/407): hoja plana en nogal Sikuani con veta vertical, recuadro de roble claro con tira LED
 * cálida por dentro, luz fría bajo la hoja, placa oscura con el número apilado en rosa y aplique de pared.
 *
 * El modelo de Revit no exporta las hojas de puerta, así que se crean aquí. La posición de cada entrada
 * (coordenadas de mundo, en metros) es el centro del vano sobre la cara del muro hacia el pasillo:
 *   x, z  → centro de la hoja · w → ancho libre · plate → lado de la placa (-1 izquierda / +1 derecha, mirando al pasillo)
 *   out   → dirección hacia el pasillo (vector unitario en planta)
 */
const P2 = 3.02;
const DOOR_H = 2.1;

export const ROOM_DOORS = {
  'HAB-215': { number: '215', x: -1.22, z: -10.15, w: 0.9, plate: 1, out: [0, -1] },
  'HAB-216': { number: '216', x: 0.57, z: -10.15, w: 0.8, plate: -1, out: [0, -1] }
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

export function buildRoomDoors(lib, parent, rooms) {
  const ids = new Set((rooms || []).map((r) => r.id));
  const wood = lib.get('NOGAL'), oak = lib.get('WALL_LISMORE'), steel = lib.get('ACERO');
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc487).multiplyScalar(2.4), toneMapped: false });
  const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe0ff).multiplyScalar(1.8), toneMapped: false });
  const sconce = new THREE.MeshStandardMaterial({ color: 0xcaa89c, roughness: 0.5, metalness: 0.1, emissive: 0xffc98a, emissiveIntensity: 0.35 });
  const group = new THREE.Group(); group.name = 'PuertasHabitacion';

  for (const [id, d] of Object.entries(ROOM_DOORS)) {
    if (!ids.has(id)) continue;
    const g = new THREE.Group();
    const box = (w, h, dp, mat, x, y, z) => {
      const geo = new THREE.BoxGeometry(w, h, dp); metricUV(geo, w, h, dp);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
    };
    const w = d.w, yC = P2 + DOOR_H / 2;
    // hoja de nogal, veta vertical
    box(w, DOOR_H, 0.045, wood, 0, yC, 0);
    // recuadro de roble claro (6 cm) y tira LED (1.2 cm) pegada a la hoja
    const tr = 0.06, ld = 0.012;
    box(tr, DOOR_H + tr, 0.07, oak, -(w / 2 + ld + tr / 2), yC + tr / 2, 0.012);
    box(tr, DOOR_H + tr, 0.07, oak, (w / 2 + ld + tr / 2), yC + tr / 2, 0.012);
    box(w + 2 * (ld + tr), tr, 0.07, oak, 0, P2 + DOOR_H + tr / 2, 0.012);
    box(ld, DOOR_H + ld, 0.05, led, -(w / 2 + ld / 2), yC + ld / 2, 0.02);
    box(ld, DOOR_H + ld, 0.05, led, (w / 2 + ld / 2), yC + ld / 2, 0.02);
    box(w + 2 * ld, ld, 0.05, led, 0, P2 + DOOR_H + ld / 2, 0.02);
    // franja de luz fría bajo la hoja
    box(w * 0.94, 0.012, 0.05, cool, 0, P2 + 0.014, 0.018);
    // manija negra con roseta
    const hx = -w / 2 + 0.07;
    box(0.045, 0.045, 0.012, steel, hx, P2 + 1.0, 0.028);
    box(0.13, 0.02, 0.02, steel, hx + 0.065, P2 + 1.0, 0.05);
    box(0.045, 0.045, 0.012, steel, hx, P2 + 1.0, -0.028);   // lado habitación
    box(0.13, 0.02, 0.02, steel, hx + 0.065, P2 + 1.0, -0.05);
    // placa de número y aplique, hacia el lado indicado
    const px = d.plate * (w / 2 + ld + tr + 0.13);
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(d.number), roughness: 0.55, metalness: 0.05 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.02), [plateMat, plateMat, plateMat, plateMat, plateMat, plateMat]);
    plate.position.set(px, P2 + 1.42, 0.03); g.add(plate);
    box(0.1, 0.1, 0.1, sconce, px, P2 + 1.86, 0.06);

    // orientar: +Z local → hacia el pasillo
    g.position.set(d.x, 0, d.z);
    g.rotation.y = Math.atan2(d.out[0], d.out[1]);
    group.add(g);
  }
  if (group.children.length) parent.add(group);
  return group;
}
