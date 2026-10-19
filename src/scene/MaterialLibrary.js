import * as THREE from 'three';

/**
 * Real-life PBR Material Library for Hotel La Fontana
 * Uses the actual Revit appearance textures from ./assets/textures/
 */
export class MaterialLibrary {
  constructor(renderer) {
    this.loader = new THREE.TextureLoader();
    this.maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
    this.textures = new Map();
    this.materials = new Map();
  }

  getTexture(url, repeatX = 1, repeatY = 1, isSRGB = true) {
    const key = `${url}_${repeatX}_${repeatY}`;
    if (this.textures.has(key)) return this.textures.get(key);

    const tex = this.loader.load(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = this.maxAnisotropy;
    if (isSRGB) tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, tex);
    return tex;
  }

  initAll() {
    // 1. Exterior Brick Facade (Bogotá classic brick + bump) - properly tiled at architectural scale
    const brickMap = this.getTexture('./assets/textures/hlf_ladrillo.png', 3.5, 3.5, true);
    const brickBump = this.getTexture('./assets/textures/hlf_ladrillo_bump.png', 3.5, 3.5, false);
    this.materials.set('BRICK_FACADE', new THREE.MeshStandardMaterial({
      map: brickMap,
      bumpMap: brickBump,
      bumpScale: 0.02,
      roughness: 0.78,
      metalness: 0.02
    }));

    // 1B. Architectural Context Buildings (Umbra3D Studio signature frosted white look)
    this.materials.set('CONTEXT_ARCH', new THREE.MeshStandardMaterial({
      color: 0xe6ebf2,
      roughness: 0.32,
      metalness: 0.08,
      transparent: true,
      opacity: 0.78
    }));

    // 1C. Dark Architectural Context / Podium
    this.materials.set('CONTEXT_DARK', new THREE.MeshStandardMaterial({
      color: 0x363a42,
      roughness: 0.5,
      metalness: 0.2
    }));

    // 2. Exterior Ivy Greenery
    const ivyMap = this.getTexture('./assets/textures/hlf_hiedra.png', 0.5, 0.5, true);
    this.materials.set('IVY', new THREE.MeshStandardMaterial({
      map: ivyMap,
      bumpMap: ivyMap,
      bumpScale: 0.04,
      roughness: 0.86,
      metalness: 0.0
    }));

    // 3. REF 01 — Wood Vinyl Bedroom Floor (with real wood grain & bump)
    // ExtrudeGeometry uses meters as UVs, so repeat 0.65 = ~1.5m plank pattern
    const woodMap = this.getTexture('./assets/textures/hlf_piso_madera.png', 0.65, 0.65, true);
    const woodBump = this.getTexture('./assets/textures/hlf_ref01_veta_seamless.png', 0.65, 0.65, false);
    this.materials.set('REF01', new THREE.MeshStandardMaterial({
      map: woodMap,
      bumpMap: woodBump,
      bumpScale: 0.018,
      roughness: 0.48,
      metalness: 0.05
    }));

    // 4. REF 02 — Bathroom Mosaic Porcelain (Mos The Dream 30x30)
    const mosMap = this.getTexture('./assets/textures/hlf_mosaico2.png', 1.4, 1.4, true);
    this.materials.set('REF02', new THREE.MeshStandardMaterial({
      map: mosMap,
      bumpMap: mosMap,
      bumpScale: 0.012,
      roughness: 0.35,
      metalness: 0.08
    }));

    // 5. REF 28 / REF 09 — Santorini Bone / Grey Stone Porcelain
    const boneMap = this.getTexture('./assets/textures/hlf_piedra_bone.png', 0.8, 0.8, true);
    this.materials.set('REF28', new THREE.MeshStandardMaterial({
      map: boneMap,
      roughness: 0.42,
      metalness: 0.05
    }));

    const greyStoneMap = this.getTexture('./assets/textures/hlf_piedra_grey.png', 0.8, 0.8, true);
    this.materials.set('REF09', new THREE.MeshStandardMaterial({
      map: greyStoneMap,
      roughness: 0.45,
      metalness: 0.05
    }));

    // 6. Corridor Tweed Carpet & Marble Border
    const hallCarpetMap = this.getTexture('./assets/textures/hlf_alfombra_hall.jpg', 0.9, 0.9, true);
    this.materials.set('HALL_ALFOMBRA', new THREE.MeshStandardMaterial({
      map: hallCarpetMap,
      bumpMap: hallCarpetMap,
      bumpScale: 0.02,
      roughness: 0.9,
      metalness: 0.0
    }));

    const marbleLightMap = this.getTexture('./assets/textures/hlf_marmol.png', 0.7, 0.7, true);
    this.materials.set('HALL_MARMOL', new THREE.MeshStandardMaterial({
      map: marbleLightMap,
      roughness: 0.22,
      metalness: 0.1
    }));

    // 7. Antik Silver Blue Marble (Countertops & Niches)
    const marbleDarkMap = this.getTexture('./assets/textures/hlf_marmol3.png', 0.9, 0.9, true);
    this.materials.set('MARMOL', new THREE.MeshStandardMaterial({
      map: marbleDarkMap,
      roughness: 0.2,
      metalness: 0.12
    }));

    // 8. Sikuani Walnut Wood (Headboards, Doors, Closets, Consoles)
    const walnutMap = this.getTexture('./assets/textures/hlf_nogal4_v.png', 0.9, 0.9, true);
    this.materials.set('NOGAL', new THREE.MeshStandardMaterial({
      map: walnutMap,
      bumpMap: walnutMap,
      bumpScale: 0.01,
      roughness: 0.46,
      metalness: 0.06
    }));

    // 9. Wallpaper Tessera & Lismore + Paint "Sobre Las Nubes"
    const grassMap = this.getTexture('./assets/textures/hlf_grasscloth.png', 1.2, 1.2, true);
    this.materials.set('WALL_TESSERA', new THREE.MeshStandardMaterial({
      map: grassMap,
      bumpMap: grassMap,
      bumpScale: 0.012,
      roughness: 0.85,
      metalness: 0.0
    }));

    const oakWallMap = this.getTexture('./assets/textures/hlf_roble_claro_v.png', 1.0, 1.0, true);
    this.materials.set('WALL_LISMORE', new THREE.MeshStandardMaterial({
      map: oakWallMap,
      roughness: 0.75,
      metalness: 0.0
    }));

    this.materials.set('WALL_PAINT', new THREE.MeshStandardMaterial({
      color: 0xece5d8,
      roughness: 0.86,
      metalness: 0.0
    }));

    // 10. Rugs TA-01, TA-02, TA-04
    const ta01Map = this.getTexture('./assets/textures/hlf_tapete_ta01.png', 1.2, 1.2, true);
    this.materials.set('TA01', new THREE.MeshStandardMaterial({
      map: ta01Map,
      bumpMap: ta01Map,
      bumpScale: 0.02,
      roughness: 0.92
    }));

    const ta02Map = this.getTexture('./assets/textures/hlf_tapete_ta02.png', 1.0, 1.0, true);
    this.materials.set('TA02', new THREE.MeshStandardMaterial({
      map: ta02Map,
      bumpMap: ta02Map,
      bumpScale: 0.02,
      roughness: 0.92
    }));

    const ta04Map = this.getTexture('./assets/textures/hlf_tapete_ta04.png', 1.0, 1.0, true);
    this.materials.set('TA04', new THREE.MeshStandardMaterial({
      map: ta04Map,
      bumpMap: ta04Map,
      bumpScale: 0.02,
      roughness: 0.92
    }));

    // 11. Furniture Fabrics & Finishes
    const boucleMap = this.getTexture('./assets/textures/hlf_boucle_taupe.png', 2.0, 2.0, true);
    this.materials.set('TAPIZ', new THREE.MeshStandardMaterial({
      map: boucleMap,
      roughness: 0.88
    }));

    const olivaMap = this.getTexture('./assets/textures/hlf_tejido_oliva.png', 2.2, 2.2, true);
    this.materials.set('OLIVA', new THREE.MeshStandardMaterial({
      map: olivaMap,
      roughness: 0.88
    }));

    const avenaMap = this.getTexture('./assets/textures/hlf_tejido_avena.png', 2.2, 2.2, true);
    this.materials.set('AVENA', new THREE.MeshStandardMaterial({
      map: avenaMap,
      roughness: 0.88
    }));

    const terracotaMap = this.getTexture('./assets/textures/hlf_tejido_terracota.png', 2.2, 2.2, true);
    this.materials.set('TERRACOTA', new THREE.MeshStandardMaterial({
      map: terracotaMap,
      roughness: 0.88
    }));

    const quiltMap = this.getTexture('./assets/textures/hlf_quilt_oscuro.png', 1.6, 1.6, true);
    this.materials.set('QUILT', new THREE.MeshStandardMaterial({
      map: quiltMap,
      roughness: 0.78
    }));

    const linoMap = this.getTexture('./assets/textures/hlf_lino_cortina.png', 1.5, 1.5, true);
    this.materials.set('LINO', new THREE.MeshStandardMaterial({
      map: linoMap,
      roughness: 0.88
    }));

    this.materials.set('LENCERIA', new THREE.MeshStandardMaterial({
      color: 0xf6f4ee,
      roughness: 0.82
    }));

    this.materials.set('ACERO', new THREE.MeshStandardMaterial({
      color: 0x222428,
      roughness: 0.35,
      metalness: 0.8
    }));

    this.materials.set('ORO', new THREE.MeshStandardMaterial({
      color: 0xc59b4e,
      roughness: 0.28,
      metalness: 0.85
    }));

    this.materials.set('CROMO', new THREE.MeshStandardMaterial({
      color: 0xd8dce0,
      roughness: 0.15,
      metalness: 0.92
    }));

    this.materials.set('TV', new THREE.MeshStandardMaterial({
      color: 0x0d0f12,
      roughness: 0.12,
      metalness: 0.5
    }));

    this.materials.set('LED', new THREE.MeshStandardMaterial({
      color: 0xffecc4,
      emissive: 0xffd584,
      emissiveIntensity: 0.85,
      roughness: 0.2
    }));

    this.materials.set('VIDRIO', new THREE.MeshPhysicalMaterial({
      color: 0xdcf0f5,
      transparent: true,
      opacity: 0.38,
      roughness: 0.08,
      metalness: 0.1,
      transmission: 0.65
    }));

    this.materials.set('WINDOW_EXT', new THREE.MeshPhysicalMaterial({
      color: 0x243848,
      roughness: 0.12,
      metalness: 0.65,
      transparent: true,
      opacity: 0.82
    }));

    this.materials.set('ROOF_SLATE', new THREE.MeshStandardMaterial({
      color: 0x2d3138,
      roughness: 0.72,
      metalness: 0.18
    }));
  }

  get(key) {
    return this.materials.get(key) || this.materials.get('WALL_PAINT');
  }

  resolveFurnitureMaterial(matCode) {
    if (!matCode) return this.get('NOGAL');
    const c = matCode.toUpperCase();
    if (c.includes('OLIVA')) return this.get('OLIVA');
    if (c.includes('AVENA')) return this.get('AVENA');
    if (c.includes('TERRACOTA')) return this.get('TERRACOTA');
    if (c.includes('TAPIZ') || c.includes('BOUCLE')) return this.get('TAPIZ');
    if (c.includes('QUILT')) return this.get('QUILT');
    if (c.includes('LENCERIA') || c.includes('BLANC')) return this.get('LENCERIA');
    if (c.includes('MARMOL') || c.includes('PIEDRA')) return this.get('MARMOL');
    if (c.includes('ORO') || c.includes('LATON')) return this.get('ORO');
    if (c.includes('CROMO') || c.includes('INOX')) return this.get('CROMO');
    if (c.includes('ACERO') || c.includes('NEGRO')) return this.get('ACERO');
    if (c.includes('TV')) return this.get('TV');
    if (c.includes('LED') || c.includes('LAMPARA')) return this.get('LED');
    if (c.includes('LINO') || c.includes('CORTINA') || c.includes('VELO')) return this.get('LINO');
    if (c.includes('VIDRIO') || c.includes('ESPEJO')) return this.get('VIDRIO');
    return this.get('NOGAL');
  }
}
