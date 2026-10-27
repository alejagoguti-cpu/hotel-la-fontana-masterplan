import * as THREE from 'three';

/**
 * CatalogModels — modelos paramétricos 1:1 de la matriz de amoblamiento (medidas y materiales EXACTOS de la especificación).
 * Cada modelo se dibuja centrado en el origen, apoyado en y = 0, en metros. Sirven tanto al catálogo como al recorrido
 * (el recorrido los coloca en la posición del Revit). Un modelo bien hecho se replica con el mismo método para el resto de la matriz.
 *
 * MA-01 Mesa de noche · Studio Inc o similar · ø 40 cm × H 60 cm
 *   Base inferior tapizada en cuero (Dekor Group 335x4680) sobre lámina de espuma de alta densidad + superficie en piedra
 *   sinterizada Altea Phantom Dark Grey.
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
  const R = 0.20, H = 0.60, plinth = 0.03, slab = 0.02;
  // cuero cognac con grano, brillo satinado
  const leather = cached(lib, 'cuero', () => {
    const m = lib.realMaterial('cuero_cognac', 0.35, { roughness: 0.62, normalScale: 0.7, envMapIntensity: 0.6 });
    return m;
  });
  const stone = cached(lib, 'phantom', () => {
    const m = lib.realMaterial('piedra_phantom', 0.6, { roughness: 0.22, normalScale: 0.35, envMapIntensity: 1.1 });
    return m;
  });
  const steel = cached(lib, 'acero', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.6 }));
  const mk = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // zócalo retraído en acero negro (el cuerpo parece flotar)
  mk(lathe(roundedProfile(R - 0.03, 0, plinth, 0.004), 48, 2 * Math.PI * R), steel);
  // cuerpo tapizado en cuero sobre espuma: leve abombado y aristas suaves
  const bodyH = H - plinth - slab;
  const prof = []; const e = 0.012, rr = R;
  prof.push([0, plinth]);
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push([rr - e + Math.sin(a) * e, plinth + e - Math.cos(a) * e]); }
  const mid = 12; for (let i = 1; i < mid; i++) { const t = i / mid; prof.push([rr + Math.sin(t * Math.PI) * 0.0025, plinth + e + (bodyH - 2 * e) * t]); }   // abombado ≈2.5 mm
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push([rr - e + Math.cos(a) * e, plinth + bodyH - e + Math.sin(a) * e]); }
  prof.push([0, plinth + bodyH]);
  mk(lathe(prof, 64, 2 * Math.PI * R), leather);
  // costura vertical (junta de la tapicería)
  const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, bodyH - 0.03, 6), new THREE.MeshStandardMaterial({ color: 0x3b261a, roughness: 0.8 }));
  seam.position.set(R * Math.cos(0.55) + 0.0012, plinth + bodyH / 2, R * Math.sin(0.55)); seam.castShadow = false; g.add(seam);
  // tapa de piedra sinterizada pulida con canto biselado
  mk(lathe(roundedProfile(R, 0, slab, 0.004), 64, 2 * Math.PI * R), stone, H - slab);
  return g;
}

export const CATALOG_MODELS = {
  'MA-01': { build: mesaNoche, dims: 'ø 40 cm × H 60 cm' }
};

export function customModel(code, lib) {
  const c = CATALOG_MODELS[code];
  return c ? c.build(lib) : null;
}
