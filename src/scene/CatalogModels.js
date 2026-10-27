import * as THREE from 'three';

/**
 * CatalogModels — modelos paramétricos 1:1 de la matriz de amoblamiento. REGLA: nada se inventa. Cada modelo copia la FOTO de
 * referencia de la matriz (forma, color, acabado) con las MEDIDAS de la columna "Medidas"; si la foto y el texto de la
 * especificación no coinciden, manda la foto (indicado por el cliente).
 * Cada modelo se dibuja centrado en el origen, apoyado en y = 0, en metros, con el "frente" hacia +z.
 *
 * MA-01 Mesa de noche · ø 40 cm × H 60 cm — foto: cilindro tapizado en cuero marrón terracota mate con una ranura vertical al frente
 *   (dos paños que se unen), zócalo hundido en sombra y tapa delgada de piedra BLANCA.
 */
const matCache = new WeakMap();
const cached = (lib, key, make) => { let m = matCache.get(lib); if (!m) matCache.set(lib, (m = new Map())); if (!m.has(key)) m.set(key, make()); return m.get(key); };

/** Lathe con perfil (r, y) en metros y UV a escala real (u = perímetro, v = longitud del perfil), para que la textura no se estire. */
function lathe(profile, seg, perimeterM) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, seg);
  const uv = g.attributes.uv; let len = 0; const cum = [0];
  for (let i = 1; i < pts.length; i++) { len += pts[i].distanceTo(pts[i - 1]); cum.push(len); }
  for (let i = 0; i < uv.count; i++) { const row = i % pts.length, col = Math.floor(i / pts.length); uv.setXY(i, (col / seg) * perimeterM, cum[row]); }
  uv.needsUpdate = true; g.computeVertexNormals();
  return g;
}

/** Perfil con aristas redondeadas: tramo recto de radio r entre y0 e y1 y radio de arista e. */
function roundedProfile(r, y0, y1, e, steps = 5) {
  const p = [[0, y0]];
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI / 2; p.push([r - e + Math.sin(a) * e, y0 + e - Math.cos(a) * e]); }
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI / 2; p.push([r - e + Math.cos(a) * e, y1 - e + Math.sin(a) * e]); }
  p.push([0, y1]);
  return p;
}

function mesaNoche(lib) {
  const g = new THREE.Group(); g.name = 'MA-01 Mesa de noche';
  const R = 0.20, H = 0.60, plinth = 0.025, slab = 0.025;
  // cuero marrón terracota mate (como en la foto): grano muy leve
  const leather = cached(lib, 'cuero', () => lib.realMaterial('cuero_cognac', 0.35, { roughness: 0.82, normalScale: 0.1, envMapIntensity: 0.45 }));
  // tapa blanca (como en la foto)
  const top = cached(lib, 'tapa', () => new THREE.MeshStandardMaterial({ color: 0xece8df, roughness: 0.32, metalness: 0, envMapIntensity: 0.9 }));
  // zócalo hundido: en la foto se lee como una sombra oscura
  const shadow = cached(lib, 'zocalo', () => new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.9 }));
  const mk = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };

  mk(lathe(roundedProfile(R - 0.025, 0, plinth, 0.003), 48, 2 * Math.PI * R), shadow);

  // cuerpo: cilindro tapizado con una ranura vertical al frente (+z). La ranura se hunde con perfil suave (v) y recorre toda la altura.
  const bodyH = H - plinth - slab, e = 0.01, seg = 96;
  const prof = [[0, plinth]];
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; prof.push([R - e + Math.sin(a) * e, plinth + e - Math.cos(a) * e]); }
  for (let i = 1; i < 14; i++) prof.push([R, plinth + e + (bodyH - 2 * e) * (i / 14)]);
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; prof.push([R - e + Math.cos(a) * e, plinth + bodyH - e + Math.sin(a) * e]); }
  prof.push([0, plinth + bodyH]);
  const body = lathe(prof, seg, 2 * Math.PI * R);
  const pos = body.attributes.position, depth = 0.014, halfW = 0.028;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    if (r < R * 0.9) continue;                       // solo el manto, no las tapas
    const ang = Math.atan2(x, z);                    // 0 = frente (+z)
    const d = Math.abs(ang) * r;                     // distancia en arco a la ranura
    if (d < halfW) { const k = Math.pow(1 - d / halfW, 1.6) * depth; pos.setXYZ(i, x * (1 - k / r), pos.getY(i), z * (1 - k / r)); }
  }
  pos.needsUpdate = true; body.computeVertexNormals();
  mk(body, leather);

  // tapa delgada blanca con canto suavizado y un pequeño voladizo
  mk(lathe(roundedProfile(R, 0, slab, 0.006), 96, 2 * Math.PI * R), top, H - slab);
  return g;
}

export const CATALOG_MODELS = {
  'MA-01': { build: mesaNoche, dims: 'ø 40 cm × H 60 cm' }
};

export function customModel(code, lib) {
  const c = CATALOG_MODELS[code];
  return c ? c.build(lib) : null;
}
