import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

/**
 * RevitRoomFurniture — habitaciones "de render" con geometría REAL de Hotel_la_fontana_contexto.rvt:
 *  · Envolvente: muros con sus enchapes (papel Tessera, Lismore, cabecero nogal Sikuani), piso vinílico
 *    madera, cielos drywall con su moldura, ventanas, puertas y tapetes, recortada a las habitaciones.
 *  · Mobiliario HLF-MOB completo por capas (Doble / Sencilla…), en su posición exacta.
 *  · Materiales PBR: textura del proyecto + mapa normal generado de la propia textura (relieve de
 *    la veta, el tejido y la trama) + rugosidad por material (tela mate, nogal satinado, cromo, mármol).
 *  · Iluminación de interior tipo render: tiras LED ocultas (luces de área en el cabecero), downlights
 *    con haz suave y sombra, luz de ventana filtrada por la cortina; todo cálido (2700–3000 K).
 */
const BASE = './assets/models/furniture/';

// material de Revit → [textura, metros por repetición, tinte, rugosidad, relieve]
const TEX = {
  // mobiliario
  'HLF-MOB TAPIZ TRAILBLAZER 32 MARBLE': ['real/boucle_taupe', 0.45, 0xffffff, 1, 1.0],
  'HLF-MOB LENCERIA BLANCA': ['real/cama_blanca', 0.5, 0xffffff, 1, 0.35],
  'HLF-MOB CUERO CAMEL': ['real/cuero_camel', 0.5, 0x6a4c3a, 0.5, 0.5],
  'HLF-MOB MELAMINA SIKUANI': ['real/nogal', 1.4, 0xffffff, 0.9, 0.6],
  'HLF-MOB QUILT OSCURO': ['hlf_quilt_oscuro.png', 0.45, 0xffffff, 0.8, 1.6],
  'HLF-MOB TEJIDO AVENA': ['real/tejido_avena', 0.45, 0xffffff, 1, 1.0],
  'HLF-MOB CORTINA LINO': ['real/lino_cortina', 0.8, 0xffffff, 1, 0.8],
  'HLF-MOB MARMOL': ['hlf_marmol.png', 1.2, 0xffffff, 0.22, 0.2],
  'HLF-MOB TEJIDO TERRACOTA': ['real/tejido_terracota', 0.45, 0xffffff, 1, 1.0],
  'HLF-MOB TEJIDO OLIVA': ['real/tejido_oliva', 0.45, 0xffffff, 1, 1.0],
  // los trazos del tapete redondo son geometría de la familia: pardo liso, el dibujo lo da el modelo
  'HLF-MOB TAPETE TRAZO CAFE': ['real/tapete_lana', 0.4, 0x6f5233, 1, 0.8],
  'HLF-MOB PIEDRA SINTERIZADA ALTEA PHANTOM DARK': ['hlf_marmol3.png', 1.2, 0xffffff, 0.3, 0.2],
  // envolvente
  'HLF-REF 01 PISO VINILICO MADERA': ['real/piso_madera', 2.0, 0xffffff, 0.9, 0.8],
  'HLF-REF 01 PISO VINILICO MADERA - VETA 090': ['real/piso_madera', 2.0, 0xffffff, 0.9, 0.8],
  'HLF-REF 02 PORCELANATO MOS THE DREAM 30x30 BLANCO': ['hlf_mosaico2.png', 0.3, 0xffffff, 0.35, 0.8],
  'HLF-REF 03 PAPEL COLGADURA TESSERA 1071.27 VESCOM': ['real/papel_tessera', 0.9, 0xffffff, 1, 1.1],
  'HLF-REF 07 PAPEL COLGADURA LISMORE 1097.28 VESCOM': ['real/roble_claro', 1.2, 0xffffff, 0.9, 0.6],
  'HLF-REF 08 CABECERO MELAMINA SIKUANI': ['real/nogal', 1.4, 0xffffff, 0.85, 0.6],
  'HLF-REF 09 PORCELANATO SANTORINI GREY 120x120': ['real/piedra_arena', 1.2, 0xffffff, 0.6, 0.45],
  'HLF-TAPETE TA-01': ['real/tapete_lana', 0.4, 0xffffff, 1, 0.9],
  'HLF-TAPETE TA-02': ['real/tapete_puntos', 0.55, 0xffffff, 1, 0.9],
  'HLF-HALL ALFOMBRA TWEED': ['real/alfombra_hall', 1.6, 0xffffff, 1, 0.9]
};

export const ROOM_LAYERS = [
  { id: 'doble', label: 'Doble', file: '215_doble.glb', room: 'HAB-215' },
  { id: 'sencilla', label: 'Sencilla', file: '216_sencilla.glb', room: 'HAB-216' }
];
const SHELL = { file: 'shell.glb', rooms: ['HAB-215', 'HAB-216'] };

const _tl = new THREE.TextureLoader();
const _texCache = new Map();
const _nrmCache = new Map();
const _roughCache = new Map();

/** Mapa normal a partir de la luminancia de la textura (Sobel): da relieve real a veta, tejido y trama. */
function normalFromImage(img, strength) {
  const S = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const src = ctx.getImageData(0, 0, S, S), p = src.data;
  const L = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) L[i] = (p[i * 4] * 0.3 + p[i * 4 + 1] * 0.59 + p[i * 4 + 2] * 0.11) / 255;
  const out = ctx.createImageData(S, S), o = out.data;
  const at = (x, y) => L[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * S + x) * 4;
    o[k] = (nx * 0.5 + 0.5) * 255; o[k + 1] = (ny * 0.5 + 0.5) * 255; o[k + 2] = (nz * 0.5 + 0.5) * 255; o[k + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function loadTex(file, aniso) {
  if (file.startsWith('real/') && !_texCache.has(file)) {
    // juego fotográfico real: color + normal + rugosidad ya horneados (webp)
    const mk = (suf, srgb) => {
      const t = _tl.load(`./assets/textures/${file}${suf}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    _texCache.set(file, mk('', true)); _nrmCache.set(file, mk('_n', false)); _roughCache.set(file, mk('_r', false));
  }
  if (!_texCache.has(file)) {
    const t = _tl.load(`./assets/textures/${file}`, (tt) => {
      const n = _nrmCache.get(file);
      if (n) { try { n.image = normalFromImage(tt.image, 2.2).image; n.needsUpdate = true; } catch (e) { /* sin relieve */ } }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    _texCache.set(file, t);
    const n = new THREE.Texture(); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.anisotropy = aniso;
    _nrmCache.set(file, n);
  }
  return { map: _texCache.get(file), normal: _nrmCache.get(file), rough: _roughCache.get(file) };
}

/** Material "de render": PBR físico con textura, relieve, brillo y emisión según el material de Revit. */
function upgradeMaterial(src, aniso, isShell) {
  const m = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(m, src);
  m.name = src.name;
  const n = (m.name || '').toUpperCase();
  const spec = TEX[m.name];
  if (spec) {
    const [file, meters, tint, rough, relief] = spec;
    const { map, normal, rough: roughTex } = loadTex(file, aniso);
    const rep = 0.6 / meters; // los UV del GLB están en (metros / 0.6)
    m.map = map.clone(); m.map.repeat.set(rep, rep); m.map.needsUpdate = true;
    m.normalMap = normal.clone(); m.normalMap.repeat.set(rep, rep); m.normalMap.needsUpdate = true;
    if (roughTex) { m.roughnessMap = roughTex.clone(); m.roughnessMap.repeat.set(rep, rep); m.roughnessMap.needsUpdate = true; }
    m.normalScale = new THREE.Vector2(relief, relief);
    m.color.set(tint);
    m.roughness = rough;
    m.metalness = 0;
  }
  if (/TEJIDO|TAPIZ|QUILT|CORTINA|TAPETE|ALFOMBRA/.test(n)) {
    m.sheen = 0.3; m.sheenRoughness = 0.8; m.sheenColor = new THREE.Color(0xf3e8d8);
  }
  // sábanas y edredón: blanco cálido mate; el brillo de tela (sheen) fuerte los "quemaba" en las almohadas
  if (/LENCERIA/.test(n)) { m.sheen = 0.12; m.sheenRoughness = 0.9; m.sheenColor = new THREE.Color(0xf3ece0); m.roughness = 1; m.color.set(0xf4efe6); }
  if (/CUERO/.test(n)) { m.clearcoat = 0.25; m.clearcoatRoughness = 0.45; }
  if (/PIEDRA CLARA/.test(n)) { m.map = null; m.color.set(0xd9d3c8); m.roughness = 0.45; m.clearcoat = 0.3; m.clearcoatRoughness = 0.3; }
  if (/MELAMINA|NOGAL|SIKUANI/.test(n)) { m.clearcoat = 0.08; m.clearcoatRoughness = 0.55; } // nogal satinado, poro abierto
  if (/PISO VINILICO/.test(n)) { m.clearcoat = 0.15; m.clearcoatRoughness = 0.35; }
  if (/MARMOL|PIEDRA SINTER/.test(n)) { m.clearcoat = 0.6; m.clearcoatRoughness = 0.12; }
  if (/CROMO/.test(n)) { m.roughness = 0.1; m.metalness = 1; m.color.set(0xe6e8ea); }
  if (/ORO/.test(n)) { m.roughness = 0.35; m.metalness = 1; m.color.set(0xc9a252); }
  if (/ACERO PINTURA/.test(n)) { m.roughness = 0.45; m.metalness = 0.2; }
  if (/ESPEJO/.test(n)) { m.roughness = 0.02; m.metalness = 1; m.color.set(0xe8ecee); }
  if (/LED/.test(n)) { m.emissive = new THREE.Color(0xffc985); m.emissiveIntensity = 1.6; m.color.set(0x332a20); }
  if (/PANTALLA LAMPARA/.test(n)) { m.emissive = new THREE.Color(0xffd7a0); m.emissiveIntensity = 0.3; }
  if (/PANTALLA TV/.test(n)) { m.roughness = 0.12; m.metalness = 0.1; m.clearcoat = 1; }
  if (/VELO/.test(n)) { m.transparent = true; m.opacity = 0.6; m.side = THREE.DoubleSide; m.depthWrite = false; m.transmission = 0; }
  if (/CORTINA LINO/.test(n)) m.side = THREE.DoubleSide;
  if (/VIDRIO/.test(n)) { m.transparent = true; m.opacity = 0.16; m.roughness = 0.03; m.depthWrite = false; }
  // cielos y pinturas: blanco cálido "Sobre las nubes", sin la textura de ladrillo de la plantilla
  if (/CIELO|PINTURA SOBRE LAS NUBES|HLF-BLANCO|MURO EXISTENTE|DEFAULT WALL|MAMPOSTERIA|CONCRET/.test(n)) {
    m.map = null; m.normalMap = null; m.color.set(0xf1e9dd); m.roughness = 0.95;
    if (/CIELO/.test(n)) { // estuco de cielo raso con micro-relieve
      const { map, normal, rough: rt } = loadTex('real/cielo', aniso), rep = 0.6 / 1.5;
      m.map = map.clone(); m.map.repeat.set(rep, rep); m.normalMap = normal.clone(); m.normalMap.repeat.set(rep, rep);
      m.roughnessMap = rt.clone(); m.roughnessMap.repeat.set(rep, rep); m.normalScale = new THREE.Vector2(0.3, 0.3);
      m.color.set(0xffffff); m.roughness = 1;
    }
  }
  if (/VENTANA MARCO/.test(n)) { m.roughness = 0.5; }
  m.envMapIntensity = /CROMO|ORO|ESPEJO|MARMOL|VIDRIO/.test(n) ? 1.0 : 0.45;
  if (isShell) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; }
  m.needsUpdate = true;
  return m;
}

export class RevitRoomFurniture {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.group.name = 'MobiliarioRevit';
    this.layers = {};
    this.lights = new THREE.Group(); this.lights.name = 'LucesInterior'; this.lights.visible = false;
    this.group.add(this.lights);
    this.aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    RectAreaLightUniformsLib.init();
  }

  _load(file) {
    return new Promise((resolve) => this.loader.load(BASE + file, (g) => resolve(g.scene), undefined, (e) => { console.warn('Modelo Revit no disponible', file, e); resolve(null); }));
  }

  _prepare(root, label, isShell) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = upgradeMaterial(o.material, this.aniso, isShell);
      o.castShadow = !o.material.transparent && !/LED/.test(o.material.name.toUpperCase());
      o.receiveShadow = true;
      o.userData.bim = {
        category: isShell ? 'Envolvente (Revit)' : 'Mobiliario (Revit)', familyAndType: o.material.name,
        level: 'PISO 2 (+3.00 m)', material: o.material.name,
        trustNote: `Geometría real exportada de Hotel_la_fontana_contexto.rvt · ${label}`
      };
    });
  }

  async load() {
    const [shell, ...rooms] = await Promise.all([this._load(SHELL.file), ...ROOM_LAYERS.map((L) => this._load(L.file))]);
    if (shell) { shell.name = 'Envolvente Revit'; this._prepare(shell, 'envolvente', true); this.shell = shell; this.group.add(shell); }
    rooms.forEach((g, i) => {
      if (!g) return;
      const L = ROOM_LAYERS[i];
      g.name = `Capa ${L.label}`;
      this._prepare(g, L.room, false);
      this.layers[L.id] = g;
      this.group.add(g);
    });
    this._buildLights();
    this._buildMirrors();
    return this;
  }

  /** Agrupa los vértices de una malla en islas (celdas de 0.2 m conectadas) → cajas en coordenadas de mundo. */
  _islands(o, cell = 0.2) {
    const pos = o.geometry.attributes.position, v = new THREE.Vector3();
    const cells = new Map();
    o.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const k = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
      let b = cells.get(k); if (!b) cells.set(k, (b = new THREE.Box3()));
      b.expandByPoint(v);
    }
    const seen = new Set(), out = [];
    for (const k of cells.keys()) {
      if (seen.has(k)) continue;
      const box = new THREE.Box3(), stack = [k]; seen.add(k);
      while (stack.length) {
        const q = stack.pop(); box.union(cells.get(q));
        const [x, y, z] = q.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const nk = `${x + dx},${y + dy},${z + dz}`;
          if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      out.push(box);
    }
    return out;
  }

  /** Luces de interior a partir de la geometría real: tiras LED → luces de área; downlights → spots suaves con sombra. */
  _buildLights() {
    const c = new THREE.Vector3(), s = new THREE.Vector3();
    const P2 = 3.02;
    let shadowSpots = 0;
    const emitters = [];
    Object.values(this.layers).forEach((layer) => layer.traverse((o) => {
      if (o.isMesh && /LED|XAL_DIFFUSE|PANTALLA LAMPARA/.test(o.material.name.toUpperCase())) emitters.push(o);
    }));
    emitters.forEach((o) => this._islands(o).forEach((box) => {
      box.getCenter(c); box.getSize(s);
      const long = Math.max(s.x, s.z);
      if (long > 0.6 && s.y < 0.25) {
        // tira LED horizontal (cabecero, closet, nicho): baña el panel de arriba y el de abajo
        const alongX = s.x >= s.z;
        const up = new THREE.RectAreaLight(0xffc27a, 2.0, long, 0.1);
        up.position.copy(c); up.rotation.set(Math.PI / 2, alongX ? 0 : Math.PI / 2, 0, 'YXZ');
        const dn = new THREE.RectAreaLight(0xffc98a, 0.8, long, 0.1);
        dn.position.copy(c); dn.rotation.set(-Math.PI / 2, alongX ? 0 : Math.PI / 2, 0, 'YXZ');
        this.lights.add(up, dn);
      } else if (c.y > P2 + 2.0 && long < 0.35) {
        // downlight empotrado: cono cálido de borde suave
        const sp = new THREE.SpotLight(0xffd3a0, 2.3, 5, Math.PI / 3.4, 1.0, 2);
        sp.position.set(c.x, c.y - 0.03, c.z);
        sp.target.position.set(c.x, c.y - 3, c.z);
        if (shadowSpots < 2) {
          sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.radius = 8;
          sp.shadow.bias = -0.0005; sp.shadow.normalBias = 0.03; shadowSpots++;
        }
        this.lights.add(sp, sp.target);
      } else if (long < 0.6) {
        // lámpara de mesa, aplique o colgante: luz puntual cálida y tenue
        const pl = new THREE.PointLight(0xffc583, 0.35, 2.0, 2);
        pl.position.copy(c);
        this.lights.add(pl);
      }
    }));
    console.info(`[interior] luces creadas: ${this.lights.children.length}`);
  }

  /** Espejos reales: cada espejo de Revit recibe un plano reflectante (Reflector) en su cara hacia la habitación.
   *  Solo se renderizan en modo habitación para no gastar GPU en la vista exterior. */
  _buildMirrors() {
    this.mirrors = new THREE.Group(); this.mirrors.name = 'Espejos'; this.mirrors.visible = false;
    const c = new THREE.Vector3(), s = new THREE.Vector3(), lc = new THREE.Vector3();
    const res = Math.min(1024, Math.round(512 * Math.min(2, window.devicePixelRatio || 1)));
    const centers = Object.values(this.layers).map((l) => new THREE.Box3().setFromObject(l).getCenter(new THREE.Vector3()));
    [...Object.values(this.layers), ...(this.shell ? [this.shell] : [])].forEach((layer) => {
      const mirrors = [];
      layer.traverse((o) => { if (o.isMesh && /ESPEJO/.test((o.material.name || '').toUpperCase())) mirrors.push(o); });
      mirrors.forEach((o) => this._islands(o, 0.3).forEach((box) => {
        box.getCenter(c); box.getSize(s);
        lc.copy(centers.reduce((a, b) => (a.distanceTo(c) < b.distanceTo(c) ? a : b), centers[0] || c));
        const thinX = s.x < s.z, w = thinX ? s.z : s.x;
        if (w < 0.25 || s.y < 0.25) return;
        const r = new Reflector(new THREE.PlaneGeometry(w - 0.01, s.y - 0.01), { textureWidth: res, textureHeight: Math.round(res * s.y / w), color: 0xc9cdcf, clipBias: 0.003 });
        // normal hacia el centro de la habitación
        const sign = thinX ? Math.sign(lc.x - c.x) || 1 : Math.sign(lc.z - c.z) || 1;
        r.position.copy(c);
        if (thinX) { r.position.x += sign * (s.x / 2 + 0.002); r.rotation.y = sign * Math.PI / 2; }
        else { r.position.z += sign * (s.z / 2 + 0.002); r.rotation.y = sign > 0 ? 0 : Math.PI; }
        this.mirrors.add(r);
      }));
    });
    this.group.add(this.mirrors);
    console.info(`[interior] espejos: ${this.mirrors.children.length}`);
  }

  /** Modo habitación (recorrido): enciende las luces de interior y los espejos. */
  setInterior(on) { this.lights.visible = on; if (this.mirrors) this.mirrors.visible = on; }
  setLayer(id, visible) { if (this.layers[id]) this.layers[id].visible = visible; }

  static roomsCovered() { return ROOM_LAYERS.map((L) => L.room); }
}
