import * as THREE from 'three';

const MM_TO_M = 0.001;

/**
 * Converts a 2D Revit polygon loop ([[x_mm, y_mm], ...]) into a THREE.Shape
 */
export function loopToShape(loopMm) {
  const shape = new THREE.Shape();
  if (!loopMm || loopMm.length < 3) return shape;
  shape.moveTo(loopMm[0][0] * MM_TO_M, loopMm[0][1] * MM_TO_M);
  for (let i = 1; i < loopMm.length; i++) {
    shape.lineTo(loopMm[i][0] * MM_TO_M, loopMm[i][1] * MM_TO_M);
  }
  shape.closePath();
  return shape;
}

/**
 * Converts 2D world meter points ([[x, z], ...]) into a THREE.Shape
 * For extrusion rotated by -PI/2 around X:
 * Shape (x, y) becomes 3D (x, height, -y)
 */
export function ptsToShape(pts) {
  const shape = new THREE.Shape();
  if (!pts || pts.length < 3) return shape;
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], -pts[i][1]);
  }
  shape.closePath();
  return shape;
}

/**
 * Projects world (X, Z) coordinates onto the roof cap vertices (materialIndex 0)
 * matching the satellite aerial orthophoto bounds
 */
export function applySatelliteRoofUVs(geometry, xMin = -380.03, xMax = 396.58, zMin = -282.00, zMax = 315.10) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!pos || !uv) return;
  const spanX = xMax - xMin;
  const spanZ = zMax - zMin;

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Roof vertices after rotateX(-PI/2) have Y > 0.4
    if (y > 0.4) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const u = (x - xMin) / spanX;
      const v = 1.0 - (z - zMin) / spanZ;
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
}

export class HotelBuildingBuilder {
  constructor(materials) {
    this.materials = materials;
    this.rootGroup = new THREE.Group();
    this.lowerBuildingGroup = new THREE.Group();
    this.upperBuildingGroup = new THREE.Group(); // Floors 3-6 + Roof (hidden in interior mode)
    this.exteriorShellPiso2 = new THREE.Group(); // Exterior brick shell of Piso 2 (hidden in interior mode)
    this.contextGroup = new THREE.Group();

    this.rootGroup.add(this.contextGroup);
    this.rootGroup.add(this.lowerBuildingGroup);
    this.rootGroup.add(this.exteriorShellPiso2);
    this.rootGroup.add(this.upperBuildingGroup);
  }

  build(architectureData, catastroBuildings = [], urbanNetwork = {}) {
    const mainFootprint = architectureData.slabLoops?.[0]?.loops?.[0] || [
      [24840, 3760], [31226, -2626], [28800, -5052], [28800, -11000],
      [32800, -15250], [38900, -15250], [49125, -5025], [29450, 14650],
      [3200, 14650], [3200, 12300], [-14000, 12300], [-14000, 3800]
    ];

    this.buildUrbanContext(catastroBuildings, urbanNetwork);
    this.buildHotelMassing(mainFootprint);
    return this.rootGroup;
  }

    const roofSatMat = this.materials.get('ROOF_SATELLITE');
    const facadeGlassMat = this.materials.get('FACADE_GLASS_TOWER');
    const facadeBrickMat = this.materials.get('FACADE_BRICK_GRID');
    const facadeStoneMat = this.materials.get('FACADE_STONE_GRID');

    const ORTHO_X_MIN = -380.03;
    const ORTHO_X_MAX = 396.58;
    const ORTHO_Z_MIN = -282.00;
    const ORTHO_Z_MAX = 315.10;

    // 1. Ground plane with High-Resolution Satellite Aerial Photography
    const groundW = ORTHO_X_MAX - ORTHO_X_MIN;
    const groundH = ORTHO_Z_MAX - ORTHO_Z_MIN;
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.materials.getTexture('./assets/textures/satellite_ortho_la_fontana.jpg', 1, 1, true),
      roughness: 0.92,
      metalness: 0.02
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundH), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((ORTHO_X_MIN + ORTHO_X_MAX) / 2, -0.06, (ORTHO_Z_MIN + ORTHO_Z_MAX) / 2);
    ground.receiveShadow = true;
    this.contextGroup.add(ground);

    // 2. Real Bogotá Catastro Buildings from const.gpkg with Satellite Roofs & Architectural Facades
    if (Array.isArray(catastroBuildings) && catastroBuildings.length > 0) {
      for (let i = 0; i < catastroBuildings.length; i++) {
        const b = catastroBuildings[i];
        if (!b.pts || b.pts.length < 3) continue;

        // Skip the main Revit wing to avoid overlapping
        if (b.isHotel && Math.hypot(b.center[0] - 16, b.center[1] - 1) < 22) {
          continue;
        }

        try {
          const shape = ptsToShape(b.pts);
          const height = Math.max(3.2, Math.min(b.height, 65));
          const geo = new THREE.ExtrudeGeometry(shape, {
            depth: height,
            bevelEnabled: false
          });
          geo.rotateX(-Math.PI / 2);

          // Apply Satellite Orthophoto planar UV projection to the roof cap
          applySatelliteRoofUVs(geo, ORTHO_X_MIN, ORTHO_X_MAX, ORTHO_Z_MIN, ORTHO_Z_MAX);

          if (b.isHotel) {
            // Other wings of Hotel La Fontana: Brick facade with satellite roof
            const mesh = new THREE.Mesh(geo, [roofSatMat, facadeBrickMat]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.upperBuildingGroup.add(mesh);
          } else {
            // Context buildings: Select facade texture based on height and character
            let sideMat;
            if (height >= 18.0) {
              sideMat = facadeGlassMat; // Tall towers: Glass curtain wall
            } else if (height >= 9.0 || (i % 3 === 0)) {
              sideMat = facadeBrickMat; // Mid-rise: Bogotá red masonry & windows
            } else {
              sideMat = facadeStoneMat; // Low-rise: Contemporary stone/concrete
            }

            // ExtrudeGeometry: Material 0 = Caps (Roof Satellite), Material 1 = Sides (Facade)
            const mesh = new THREE.Mesh(geo, [roofSatMat, sideMat]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.contextGroup.add(mesh);

            // Subtle crisp white architectural edges
            if (height > 6.0) {
              const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
              this.contextGroup.add(edges);
            }
          }
        } catch (e) {
          // Skip invalid polygon
        }
      }
    }

    // 3. Official Bogotá Road Network (Calzadas, Andenes, Separadores, Ciclorrutas)
    const calzadaMat = new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.88 });
    const andenMat = new THREE.MeshStandardMaterial({ color: 0xb8bec7, roughness: 0.72 });
    const alamedaMat = new THREE.MeshStandardMaterial({ color: 0x3e6b35, roughness: 0.86 });
    const cicloMat = new THREE.MeshStandardMaterial({ color: 0x9b3a2a, roughness: 0.78 }); // Red bike path

    // A. Calzadas (Roadways, Y = 0 to 0.04m)
    for (const poly of (urbanNetwork.calzadas || [])) {
      try {
        const shape = ptsToShape(poly);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, calzadaMat);
        mesh.position.y = 0.0;
        mesh.receiveShadow = true;
        this.contextGroup.add(mesh);
      } catch (e) {}
    }

    // B. Andenes (Sidewalks, Y = 0 to 0.16m - raised 3D curbs)
    for (const poly of (urbanNetwork.andenes || [])) {
      try {
        const shape = ptsToShape(poly);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, andenMat);
        mesh.position.y = 0.0;
        mesh.receiveShadow = true;
        this.contextGroup.add(mesh);
      } catch (e) {}
    }

    // C. Separadores & Alamedas (Medians with grass, Y = 0 to 0.18m)
    for (const poly of (urbanNetwork.separadores || [])) {
      try {
        const shape = ptsToShape(poly);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, alamedaMat);
        mesh.position.y = 0.0;
        mesh.receiveShadow = true;
        this.contextGroup.add(mesh);
      } catch (e) {}
    }

    // D. Ciclorrutas (Bogota Bike lanes, Y = 0 to 0.17m)
    for (const poly of (urbanNetwork.ciclorrutas || [])) {
      try {
        const shape = ptsToShape(poly);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.17, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, cicloMat);
        mesh.position.y = 0.0;
        mesh.receiveShadow = true;
        this.contextGroup.add(mesh);
      } catch (e) {}
    }

    // 4. Hotel Courtyard Plazoleta & Fountain
    const courtyard = new THREE.Mesh(new THREE.BoxGeometry(24, 0.18, 20), stoneMat);
    courtyard.position.set(16, 0.02, 2);
    courtyard.receiveShadow = true;
    this.contextGroup.add(courtyard);

    const fountainRim = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.5, 24), stoneMat);
    fountainRim.position.set(16, 0.28, 2);
    const fountainWater = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 2.9, 0.42, 24),
      new THREE.MeshStandardMaterial({ color: 0x2288cc, roughness: 0.1, metalness: 0.3 })
    );
    fountainWater.position.set(16, 0.32, 2);
    this.contextGroup.add(fountainRim, fountainWater);

    // 5. Real Arbolado Urbano from Jardín Botánico de Bogotá (504 georeferenced trees)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d3024, roughness: 0.92 });
    const crownMat1 = new THREE.MeshStandardMaterial({ color: 0x285425, roughness: 0.85 }); // Shaded base
    const crownMat2 = new THREE.MeshStandardMaterial({ color: 0x3d7a36, roughness: 0.82 }); // Zenithal highlight

    const trees = (urbanNetwork.arboles && urbanNetwork.arboles.length > 0)
      ? urbanNetwork.arboles
      : [[10, 4], [22, 5], [12, -4], [24, -3], [-16, -22], [18, -22]];

    for (let i = 0; i < trees.length; i++) {
      const [tx, tz] = trees[i];
      const tree = new THREE.Group();
      // Natural organic variation per tree
      const s = 0.8 + ((Math.abs(tx * 7 + tz * 13) % 100) / 100) * 0.45;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 2.4 * s, 7), trunkMat);
      trunk.position.y = 1.2 * s;
      trunk.castShadow = true;

      // 4-tier canopy structure (ambient occlusion shadow, main volume, top highlight)
      const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.65 * s, 1), crownMat1);
      c1.position.y = 3.0 * s;
      c1.castShadow = true;

      const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15 * s, 1), crownMat2);
      c2.position.set(0.25 * s, 3.8 * s, 0.2 * s);
      c2.castShadow = true;

      tree.add(trunk, c1, c2);
      tree.position.set(tx, 0.1, tz);
      this.contextGroup.add(tree);
    }
  }

  buildHotelMassing(footprintMm) {
    const shape = loopToShape(footprintMm);
    const brickMat = this.materials.get('BRICK_FACADE');
    const stoneMat = this.materials.get('REF28');
    const windowMat = this.materials.get('WINDOW_EXT');
    const darkMetalMat = this.materials.get('ACERO');
    const slateMat = this.materials.get('ROOF_SLATE');

    // 1. Piso 1 (Ground floor / Lobby podium, Y = 0 to 3.0m)
    const p1Geo = new THREE.ExtrudeGeometry(shape, { depth: 2.95, bevelEnabled: false });
    p1Geo.rotateX(-Math.PI / 2);
    const p1Mesh = new THREE.Mesh(p1Geo, [stoneMat, stoneMat]);
    p1Mesh.castShadow = true;
    p1Mesh.receiveShadow = true;
    this.lowerBuildingGroup.add(p1Mesh);

    // Cornice band between Piso 1 & Piso 2 (Y = 2.88m to 3.04m)
    const corniceGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.06, bevelSegments: 1 });
    corniceGeo.rotateX(-Math.PI / 2);
    const cornice1 = new THREE.Mesh(corniceGeo, stoneMat);
    cornice1.position.y = 2.88;
    this.lowerBuildingGroup.add(cornice1);

    // 2. Piso 2 Exterior Shell (Shown in Exterior view; hidden in Interior Cutaway view so real interior shines)
    const p2ShellGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.92, bevelEnabled: false });
    p2ShellGeo.rotateX(-Math.PI / 2);
    const p2ShellMesh = new THREE.Mesh(p2ShellGeo, [brickMat, stoneMat]);
    p2ShellMesh.position.y = 3.02;
    p2ShellMesh.castShadow = true;
    p2ShellMesh.receiveShadow = true;
    this.exteriorShellPiso2.add(p2ShellMesh);
    this.addFacadeWindowsAlongFootprint(footprintMm, 3.02, 2.92, this.exteriorShellPiso2, windowMat, darkMetalMat);

    // 3. Upper Floors: Piso 3, Piso 4, Piso 5, Piso 6 (Y = 6.0m to 18.0m)
    for (let floor = 3; floor <= 6; floor++) {
      const yBase = (floor - 1) * 3.0;
      const floorGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.88, bevelEnabled: false });
      floorGeo.rotateX(-Math.PI / 2);
      const floorMesh = new THREE.Mesh(floorGeo, [brickMat, stoneMat]);
      floorMesh.position.y = yBase;
      floorMesh.castShadow = true;
      floorMesh.receiveShadow = true;
      this.upperBuildingGroup.add(floorMesh);

      const bandMesh = new THREE.Mesh(corniceGeo, stoneMat);
      bandMesh.position.y = yBase + 2.86;
      this.upperBuildingGroup.add(bandMesh);

      this.addFacadeWindowsAlongFootprint(footprintMm, yBase, 2.88, this.upperBuildingGroup, windowMat, darkMetalMat);
    }

    // 4. Mansard / Roof Crown (Y = 18.0m to 20.2m)
    const roofGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.6,
      bevelEnabled: true,
      bevelSize: -0.4,
      bevelThickness: 0.8,
      bevelSegments: 2
    });
    roofGeo.rotateX(-Math.PI / 2);
    applySatelliteRoofUVs(roofGeo, -380.03, 396.58, -282.00, 315.10);
    const roofMesh = new THREE.Mesh(roofGeo, [this.materials.get('ROOF_SATELLITE'), slateMat]);
    roofMesh.position.y = 18.05;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.upperBuildingGroup.add(roofMesh);
  }

  addFacadeWindowsAlongFootprint(footprintMm, yBase, floorHeight, targetGroup, windowMat, frameMat) {
    const winHeight = 1.6;
    const winWidth = 1.4;
    const sillOffset = 0.7;

    for (let i = 0; i < footprintMm.length; i++) {
      const [x1, y1] = footprintMm[i];
      const [x2, y2] = footprintMm[(i + 1) % footprintMm.length];
      const p1 = new THREE.Vector2(x1 * MM_TO_M, -y1 * MM_TO_M);
      const p2 = new THREE.Vector2(x2 * MM_TO_M, -y2 * MM_TO_M);
      const segLen = p1.distanceTo(p2);
      if (segLen < 3.2) continue;

      const count = Math.floor(segLen / 3.4);
      const dir = p2.clone().sub(p1).normalize();
      const normal = new THREE.Vector2(dir.y, -dir.x);
      const angle = Math.atan2(-dir.y, dir.x);

      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const pos2D = p1.clone().lerp(p2, t).addScaledVector(normal, 0.05);

        const winGroup = new THREE.Group();
        winGroup.position.set(pos2D.x, yBase + sillOffset + winHeight / 2, pos2D.y);
        winGroup.rotation.y = angle;

        const glass = new THREE.Mesh(new THREE.BoxGeometry(winWidth, winHeight, 0.08), windowMat);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(winWidth + 0.12, winHeight + 0.12, 0.05), frameMat);
        winGroup.add(frame, glass);
        targetGroup.add(winGroup);
      }
    }
  }
}
