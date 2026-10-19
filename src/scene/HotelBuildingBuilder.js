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

  buildUrbanContext(catastroBuildings = [], urbanNetwork = {}) {
    const roofSatMat = this.materials.get('ROOF_SATELLITE');
    const facadeBrickMat = this.materials.get('BRICK_FACADE');
    const contextWhiteMat = this.materials.get('CONTEXT_WHITE');
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65
    });

    const ORTHO_X_MIN = -380.03;
    const ORTHO_X_MAX = 396.58;
    const ORTHO_Z_MIN = -282.00;
    const ORTHO_Z_MAX = 315.10;

    // 1. High-Resolution Satellite Aerial Photography Ground Plane
    const groundW = ORTHO_X_MAX - ORTHO_X_MIN;
    const groundH = ORTHO_Z_MAX - ORTHO_Z_MIN;
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.materials.getTexture('./assets/textures/satellite_ortho_la_fontana.jpg', 1, 1, true),
      roughness: 0.9,
      metalness: 0.02
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundH), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((ORTHO_X_MIN + ORTHO_X_MAX) / 2, -0.06, (ORTHO_Z_MIN + ORTHO_Z_MAX) / 2);
    ground.receiveShadow = true;
    this.contextGroup.add(ground);

    // 2. Real Bogotá Catastro Buildings: Pure Frosted Architectural White Volumes with Crisp White Edges
    if (Array.isArray(catastroBuildings) && catastroBuildings.length > 0) {
      for (let i = 0; i < catastroBuildings.length; i++) {
        const b = catastroBuildings[i];
        if (!b.pts || b.pts.length < 3) continue;

        // Skip the main Revit wing so it doesn't double-render
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

          // All context buildings: pure frosted architectural white volumes with white wireframe edges ("mejor deja todos los volumenes blancos")
          const mesh = new THREE.Mesh(geo, contextWhiteMat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.contextGroup.add(mesh);

          // Crisp white architectural edges
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
          this.contextGroup.add(edges);
        } catch (e) {
          // Skip invalid polygon
        }
      }
    }

    // 3. Official Bogotá Road Network (Calzadas, Andenes, Separadores, Ciclorrutas)
    const calzadaMat = this.materials.get('ROAD_ASPHALT');
    const andenMat = this.materials.get('SIDEWALK_PAVING');
    const alamedaMat = this.materials.get('TURF_GRASS');
    const cicloMat = this.materials.get('BIKEWAY_BLUE');

    // A. Calzadas (Vehicular Roadways, Y = 0 to 0.04m)
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

    // 4. Photorealistic Urban Road Markings (Señalización vial Bogotá)
    this.buildRoadMarkings();

    // 5. Hotel Courtyard Plazoleta & Stone Fountain
    const stoneMat = this.materials.get('REF28');
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

    // 6. Realistic Architectural Trees (Safe setbacks, varied species, heights, and frondosidad)
    this.buildRealisticTrees(urbanNetwork.arboles, urbanNetwork.calzadas);

    // 7. Realistic Architectural 3D Vehicles (100% inside vehicular calzadas, modern styling, wheels, mirrors, lights)
    this.buildRealisticVehicles(urbanNetwork.calzadas);
  }

  buildRoadMarkings() {
    const markGroup = new THREE.Group();
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf5f7fa });
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xf6c83b });

    // Helper: Zebra Pedestrian Crossing
    const addZebra = (cx, cz, isHoriz, length = 12, width = 4.2) => {
      const stripes = 8;
      const stripeW = 0.55;
      const gap = (width - stripes * stripeW) / (stripes - 1);
      for (let i = 0; i < stripes; i++) {
        const offset = -width / 2 + i * (stripeW + gap) + stripeW / 2;
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(isHoriz ? stripeW : length, 0.01, isHoriz ? length : stripeW),
          whiteMat
        );
        stripe.position.set(
          isHoriz ? cx + offset : cx,
          0.05,
          isHoriz ? cz : cz + offset
        );
        markGroup.add(stripe);
      }
    };

    // Major Crosswalks at Av. Calle 127 and Calle 124 intersections
    addZebra(16, 42, true, 14, 4.8);   // Av. Calle 127 crossing
    addZebra(-38, 42, false, 4.8, 12); // Calle 127 con Cra 15A
    addZebra(72, 42, false, 4.8, 14);  // Calle 127 con Cra 15
    addZebra(16, -28, true, 11, 4.2);  // Calle 124 crossing
    addZebra(-38, -28, false, 4.2, 10);
    addZebra(72, -28, false, 4.2, 12);

    // Dashed & Continuous Lane Markings
    const addLaneLine = (startX, startZ, endX, endZ, isYellow = false, isDashed = true) => {
      const dx = endX - startX;
      const dz = endZ - startZ;
      const len = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      const mat = isYellow ? yellowMat : whiteMat;

      if (!isDashed) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, 0.18), mat);
        line.position.set((startX + endX) / 2, 0.05, (startZ + endZ) / 2);
        line.rotation.y = -angle;
        markGroup.add(line);
      } else {
        const dashLen = 3.2;
        const gap = 3.8;
        const totalStep = dashLen + gap;
        const steps = Math.floor(len / totalStep);
        const uX = dx / len;
        const uZ = dz / len;

        for (let i = 0; i < steps; i++) {
          const t = (i * totalStep + dashLen / 2) / len;
          const px = startX + dx * t;
          const pz = startZ + dz * t;
          const dash = new THREE.Mesh(new THREE.BoxGeometry(dashLen, 0.01, 0.18), mat);
          dash.position.set(px, 0.05, pz);
          dash.rotation.y = -angle;
          markGroup.add(dash);
        }
      }
    };

    // Av. Calle 127 (Major arterial double yellow divider + white lane dividers)
    addLaneLine(-120, 48.5, 160, 48.5, true, false);  // Continuous yellow center line
    addLaneLine(-120, 44.5, 160, 44.5, false, true);  // Eastbound lane dash
    addLaneLine(-120, 52.5, 160, 52.5, false, true);  // Westbound lane dash

    // Calle 124 (Secondary street)
    addLaneLine(-100, -32, 140, -32, true, true);

    // Av. Carrera 15 (North-South arterial)
    addLaneLine(78, -120, 78, 140, true, false);
    addLaneLine(74, -120, 74, 140, false, true);
    addLaneLine(82, -120, 82, 140, false, true);

    // Carrera 15A
    addLaneLine(-44, -100, -44, 120, true, true);

    this.contextGroup.add(markGroup);
  }

  buildRealisticTrees(treePoints = [], calzadaPolys = []) {
    const treeGroup = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x362b21,
      roughness: 0.94,
      metalness: 0.02
    });

    const speciesConfig = [
      // 0: Roble Sabanero (Quercus humboldtii) - Majestic spreading mature oak
      {
        mat: this.materials.get('TREE_ROBLE'),
        name: 'Roble',
        baseHeight: 8.2,
        baseWidth: 7.8,
        trunkH: 2.8,
        cards: 8,
        discs: 4,
        puffs: 6
      },
      // 1: Urapán / Sauco (Fraxinus chinensis) - Tall upright columnar crown
      {
        mat: this.materials.get('TREE_SAUCO'),
        name: 'Urapan',
        baseHeight: 7.4,
        baseWidth: 4.8,
        trunkH: 2.6,
        cards: 6,
        discs: 2,
        puffs: 3
      },
      // 2: Chicalá (Tecoma stans) - Dense compact rounded spring green
      {
        mat: this.materials.get('TREE_CHICALA'),
        name: 'Chicala',
        baseHeight: 5.2,
        baseWidth: 5.4,
        trunkH: 2.0,
        cards: 6,
        discs: 3,
        puffs: 4
      },
      // 3: Guayacán Amarillo en flor (Handroanthus chrysanthus) - Radiant golden floral canopy
      {
        mat: this.materials.get('TREE_FLOWER_YELLOW'),
        name: 'Guayacan',
        baseHeight: 6.8,
        baseWidth: 7.2,
        trunkH: 2.4,
        cards: 8,
        discs: 3,
        puffs: 5
      },
      // 4: Acacia Japonesa / Árbol Joven - Light, airy, bright chartreuse
      {
        mat: this.materials.get('TREE_ACACIA'),
        name: 'Acacia',
        baseHeight: 4.0,
        baseWidth: 3.8,
        trunkH: 1.8,
        cards: 4,
        discs: 2,
        puffs: 2
      }
    ];

    const shadowMat = this.materials.get('TREE_SHADOW');

    // Helper: Point in polygon
    const inPoly = (pt, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], zi = poly[i][1];
        const xj = poly[j][0], zj = poly[j][1];
        const intersect = ((zi > pt[1]) !== (zj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // Helper: Distance from point to polygon boundary
    const distToPolyEdge = (pt, poly) => {
      let minD = 999;
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % poly.length];
        const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
        const len2 = dx * dx + dz * dz;
        let t = len2 === 0 ? 0 : ((pt[0] - p1[0]) * dx + (pt[1] - p1[1]) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const projX = p1[0] + t * dx;
        const projZ = p1[1] + t * dz;
        const d = Math.hypot(pt[0] - projX, pt[1] - projZ);
        if (d < minD) minD = d;
      }
      return minD;
    };

    // Safe road clearance check: return true if inside or too close to a vehicular roadway
    const isInsideRoadway = (x, z) => {
      if (!Array.isArray(calzadaPolys) || calzadaPolys.length === 0) return false;
      for (const poly of calzadaPolys) {
        if (!poly || poly.length < 3) continue;
        if (inPoly([x, z], poly)) return true;
        if (distToPolyEdge([x, z], poly) < 2.0) return true;
      }
      return false;
    };

    // Collect planting coordinates
    const candidatePoints = [];

    // 1. Official JBB georeferenced urban trees
    if (Array.isArray(treePoints)) {
      for (const pt of treePoints) {
        candidatePoints.push(pt);
      }
    }

    // 2. Hotel La Fontana Central Courtyard & Patio de la Fontana (Around central fountain at 16, 2)
    const courtyardTrees = [
      [9.5, 7.5], [22.5, 7.5], [9.5, -3.5], [22.5, -3.5],
      [16, 9.5], [16, -5.5], [7.0, 2.0], [25.0, 2.0],
      [11.5, 4.5], [20.5, 4.5], [11.5, -0.5], [20.5, -0.5]
    ];
    candidatePoints.push(...courtyardTrees);

    // 3. Wide Sidewalks & Medians at safe setback from road curbs
    // Calle 127 South Sidewalk (Z ~ 19.5m, well south of road at Z > 22.6)
    for (let x = -75; x <= 0; x += 10.0) {
      candidatePoints.push([x, 19.5]);
    }
    // Calle 127 North Sidewalk (Z ~ 85m, north of road at Z < 82.5)
    for (let x = -75; x <= 85; x += 9.5) {
      candidatePoints.push([x, 85.0]);
    }
    // Central Separador Verde (median between westbound and eastbound lanes)
    for (let x = 12; x <= 72; x += 8.5) {
      candidatePoints.push([x, 54.5]);
    }
    // Cra 15 East Sidewalk (X ~ 100m, well clear of roadway)
    for (let z = -90; z <= 25; z += 9.0) {
      candidatePoints.push([100.0, z]);
    }
    // Park Groves (dense clumps in the expansive public green areas)
    const addSafeGrove = (cx, cz, count, radius) => {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.sin(i * 3.7) * 0.5;
        const r = (0.25 + 0.75 * Math.abs(Math.cos(i * 2.3))) * radius;
        candidatePoints.push([+(cx + Math.cos(angle) * r).toFixed(2), +(cz + Math.sin(angle) * r).toFixed(2)]);
      }
    };
    addSafeGrove(-85, 10, 16, 14);
    addSafeGrove(45, -18, 12, 10);
    addSafeGrove(-30, -55, 15, 12);
    addSafeGrove(115, 75, 18, 15);

    // Shared geometries for performance
    const cardBaseGeo = new THREE.PlaneGeometry(1, 1);
    const discBaseGeo = new THREE.PlaneGeometry(1, 1);
    const puffBaseGeo = new THREE.PlaneGeometry(1, 1);
    const shadowBaseGeo = new THREE.PlaneGeometry(1, 1);
    const trunkBaseGeo = new THREE.CylinderGeometry(0.14, 0.32, 1, 8);
    const rootBaseGeo = new THREE.CylinderGeometry(0.28, 0.52, 0.35, 8);
    const branchBaseGeo = new THREE.CylinderGeometry(0.06, 0.12, 1, 6);

    for (let i = 0; i < candidatePoints.length; i++) {
      const [tx, tz] = candidatePoints[i];

      // STRICT SAFETY FILTER: NEVER plant a tree on a road or inside the hotel wing!
      if (isInsideRoadway(tx, tz)) continue;
      // Skip if inside hotel guest room wings
      if (tx >= -16 && tx <= 50 && tz >= -16 && tz <= 15) {
        const inCourtyard = (tx >= 6.5 && tx <= 25.5 && tz >= -5.8 && tz <= 9.8);
        if (!inCourtyard) continue;
      }

      const tree = new THREE.Group();

      // Deterministic natural variation per tree
      const hash1 = Math.abs(Math.sin(tx * 12.9898 + tz * 78.233) * 43758.5453);
      const hash2 = Math.abs(Math.cos(tx * 26.6514 + tz * 45.197) * 28461.1278);
      const rot = (hash1 % 6.28);

      // Select species:
      // Roble (30%), Urapan (25%), Chicala (20%), Guayacan en flor (15%), Acacia (10%)
      let spIdx = 0;
      const spVal = (hash1 * 100) % 100;
      if (spVal < 30) spIdx = 0;
      else if (spVal < 55) spIdx = 1;
      else if (spVal < 75) spIdx = 2;
      else if (spVal < 90) spIdx = 3;
      else spIdx = 4;

      const spec = speciesConfig[spIdx];

      // Calculate distinct height, canopy width, and frondosidad
      const sizeMult = 0.82 + (hash2 % 0.38); // 0.82 to 1.20
      const treeHeight = spec.baseHeight * sizeMult;
      const canopyWidth = spec.baseWidth * sizeMult;
      const trunkH = spec.trunkH * sizeMult;
      const canopyH = treeHeight - trunkH * 0.7;

      // 1. Soft radial ground contact shadow decal
      if (shadowMat) {
        const shadow = new THREE.Mesh(shadowBaseGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, 0.02, 0);
        shadow.scale.set(canopyWidth * 1.05, canopyWidth * 1.05, 1);
        tree.add(shadow);
      }

      // 2. Trunk, root flare, and structural branches
      const trunk = new THREE.Mesh(trunkBaseGeo, trunkMat);
      trunk.position.y = trunkH / 2;
      trunk.scale.set(sizeMult, trunkH, sizeMult);
      trunk.castShadow = true;
      tree.add(trunk);

      const roots = new THREE.Mesh(rootBaseGeo, trunkMat);
      roots.position.y = 0.16 * sizeMult;
      roots.scale.set(sizeMult, sizeMult, sizeMult);
      tree.add(roots);

      const b1 = new THREE.Mesh(branchBaseGeo, trunkMat);
      b1.position.set(0.35 * sizeMult, trunkH * 0.78, 0.22 * sizeMult);
      b1.rotation.set(0.48, 0.25, -0.55);
      b1.scale.set(sizeMult, 1.8 * sizeMult, sizeMult);
      b1.castShadow = true;

      const b2 = new THREE.Mesh(branchBaseGeo, trunkMat);
      b2.position.set(-0.32 * sizeMult, trunkH * 0.82, -0.2 * sizeMult);
      b2.rotation.set(-0.45, 0.2, 0.58);
      b2.scale.set(sizeMult, 1.7 * sizeMult, sizeMult);
      b2.castShadow = true;

      tree.add(b1, b2);

      // 3. Species-Specific Botanical Canopy
      const foliageGroup = new THREE.Group();
      const canopyBaseY = trunkH * 0.75;

      // A. Vertical radial intersecting foliage cards
      const numCards = spec.cards;
      for (let a = 0; a < numCards; a++) {
        const angle = (a * Math.PI) / numCards;
        const card = new THREE.Mesh(cardBaseGeo, spec.mat);
        card.position.set(0, canopyBaseY + canopyH / 2, 0);
        card.rotation.y = angle;
        card.scale.set(canopyWidth, canopyH, 1);
        card.castShadow = true;
        card.receiveShadow = true;
        foliageGroup.add(card);
      }

      // B. Horizontal crown discs for lush aerial perspective
      const numDiscs = spec.discs;
      for (let d = 0; d < numDiscs; d++) {
        const t = (d + 1) / (numDiscs + 1);
        const disc = new THREE.Mesh(discBaseGeo, spec.mat);
        disc.rotation.x = -Math.PI / 2 + (d % 2 === 0 ? 0.12 : -0.12);
        disc.rotation.z = (d * 0.4);
        disc.position.set(0, canopyBaseY + canopyH * t, 0);
        const discW = canopyWidth * (1.0 - Math.abs(t - 0.5) * 0.65);
        disc.scale.set(discW, discW, 1);
        disc.castShadow = true;
        foliageGroup.add(disc);
      }

      // C. Satellite puff quads for natural irregular silhouette
      const numPuffs = spec.puffs;
      for (let p = 0; p < numPuffs; p++) {
        const pAngle = (p / numPuffs) * Math.PI * 2 + 0.3;
        const pRad = canopyWidth * 0.35;
        const px = Math.cos(pAngle) * pRad;
        const pz = Math.sin(pAngle) * pRad;
        const py = canopyBaseY + canopyH * (0.35 + (p % 3) * 0.2);

        const puffW = canopyWidth * 0.55;
        const puffH = canopyH * 0.55;

        const puff1 = new THREE.Mesh(puffBaseGeo, spec.mat);
        puff1.position.set(px, py, pz);
        puff1.rotation.y = pAngle;
        puff1.scale.set(puffW, puffH, 1);
        puff1.castShadow = true;

        const puff2 = new THREE.Mesh(puffBaseGeo, spec.mat);
        puff2.position.set(px, py, pz);
        puff2.rotation.y = pAngle + Math.PI / 2;
        puff2.scale.set(puffW, puffH, 1);
        puff2.castShadow = true;

        foliageGroup.add(puff1, puff2);
      }

      // Organic subtle tilt
      foliageGroup.rotation.z = (hash1 % 0.1) - 0.05;
      foliageGroup.rotation.x = (hash2 % 0.1) - 0.05;

      tree.add(foliageGroup);
      tree.position.set(tx, 0.08, tz);
      tree.rotation.y = rot;
      treeGroup.add(tree);
    }

    this.contextGroup.add(treeGroup);
  }

  buildRealisticVehicles(calzadaPolys = []) {
    const carGroup = new THREE.Group();

    // Automotive paint colors (high-end architectural palette)
    const paintColors = [
      0x181c22, // Obsidian Black
      0xedeef2, // Polar White Metallic
      0x4a525d, // Slate Grey Metallic
      0x8c1b22, // Crimson Red
      0x1c385c  // Deep Navy Metallic
    ];

    const taxiColor = 0xf6c83b; // Radiant Bogotá Taxi Yellow

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x141a24,
      roughness: 0.08,
      metalness: 0.85,
      transmission: 0.3
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.85, roughness: 0.2 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xdd1818 });
    const carShadowMat = this.materials.get('CAR_SHADOW');
    const taxiSignMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const trimBlackMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.7 });

    // 100% VERIFIED CALZADA COORDINATES (Strictly inside vehicular road lanes)
    const carSpots = [
      // Calle 127 South (Eastbound traffic, heading 0 to 0.18 rad)
      { pos: [-45, 30.5], rot: 0, type: 'sedan', color: 0 },
      { pos: [-15, 31.0], rot: 0, type: 'suv', color: 1 },
      { pos: [15, 36.0], rot: 0.08, type: 'taxi', color: 5 },
      { pos: [42, 38.5], rot: 0.12, type: 'sedan', color: 2 },
      { pos: [68, 43.0], rot: 0.18, type: 'suv', color: 3 },
      { pos: [110, 46.5], rot: 0, type: 'sedan', color: 4 },

      // Calle 127 North (Westbound traffic, heading PI to PI-0.08 rad)
      { pos: [70, 74.0], rot: Math.PI, type: 'sedan', color: 1 },
      { pos: [35, 68.0], rot: Math.PI - 0.08, type: 'taxi', color: 5 },
      { pos: [5, 64.0], rot: Math.PI, type: 'suv', color: 0 },
      { pos: [-25, 61.0], rot: Math.PI, type: 'sedan', color: 2 },
      { pos: [-55, 57.0], rot: Math.PI, type: 'suv', color: 3 },

      // Carrera 15 (Northbound traffic, heading PI/2 rad)
      { pos: [82.0, -45.0], rot: Math.PI / 2, type: 'sedan', color: 4 },
      { pos: [82.0, -10.0], rot: Math.PI / 2, type: 'taxi', color: 5 },
      { pos: [82.0, 18.0], rot: Math.PI / 2, type: 'suv', color: 0 },

      // Carrera 15 (Southbound traffic, heading -PI/2 rad)
      { pos: [80.0, 5.0], rot: -Math.PI / 2, type: 'sedan', color: 1 },
      { pos: [85.0, -25.0], rot: -Math.PI / 2, type: 'suv', color: 2 }
    ];

    for (let i = 0; i < carSpots.length; i++) {
      const spot = carSpots[i];
      const car = new THREE.Group();
      const isTaxi = spot.type === 'taxi';
      const isSUV = spot.type === 'suv';

      const bodyColor = isTaxi ? taxiColor : paintColors[spot.color % paintColors.length];
      const bodyMat = new THREE.MeshStandardMaterial({
        color: bodyColor,
        metalness: isTaxi ? 0.35 : 0.72,
        roughness: isTaxi ? 0.3 : 0.22
      });

      const length = isSUV ? 4.5 : 4.3;
      const width = isSUV ? 1.95 : 1.82;
      const height = isSUV ? 1.58 : 1.38;

      // 1. Underbody Ground Contact Shadow Decal on Asphalt
      if (carShadowMat) {
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.5), carShadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, 0.03, 0);
        car.add(shadow);
      }

      // 2. Lower Chassis Body (sloping hood, fenders, trunk)
      const chassisH = height * 0.44;
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(length, chassisH, width), bodyMat);
      chassis.position.y = 0.32 + chassisH / 2;
      chassis.castShadow = true;
      car.add(chassis);

      // Front bumper / grille recess
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.12, chassisH * 0.65, width * 0.65), trimBlackMat);
      grille.position.set(length / 2 + 0.02, 0.32 + chassisH * 0.4, 0);
      car.add(grille);

      // 3. Cabin Greenhouse with Sloped Windshield
      const cabinL = length * 0.54;
      const cabinH = height * 0.54;
      const cabinW = width * 0.86;
      const cabinY = 0.32 + chassisH + cabinH / 2;

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinL, cabinH, cabinW), bodyMat);
      cabin.position.set(-length * 0.06, cabinY, 0);
      cabin.castShadow = true;

      // Windshield & Rear glass
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.12, cabinH * 0.92, cabinW * 0.94), glassMat);
      windshield.position.set(-length * 0.06 + cabinL / 2 + 0.02, cabinY, 0);
      windshield.rotation.z = -0.38;

      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(0.12, cabinH * 0.9, cabinW * 0.94), glassMat);
      rearGlass.position.set(-length * 0.06 - cabinL / 2 - 0.02, cabinY, 0);
      rearGlass.rotation.z = 0.38;

      // Side glass
      const sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(cabinL * 0.92, cabinH * 0.72, 0.08), glassMat);
      sideGlassL.position.set(-length * 0.06, cabinY, cabinW / 2 + 0.02);
      const sideGlassR = new THREE.Mesh(new THREE.BoxGeometry(cabinL * 0.92, cabinH * 0.72, 0.08), glassMat);
      sideGlassR.position.set(-length * 0.06, cabinY, -cabinW / 2 - 0.02);

      car.add(cabin, windshield, rearGlass, sideGlassL, sideGlassR);

      // 4. Side View Mirrors
      const mirrorGeo = new THREE.BoxGeometry(0.18, 0.12, 0.22);
      const mirrorL = new THREE.Mesh(mirrorGeo, bodyMat);
      mirrorL.position.set(-length * 0.06 + cabinL / 2 - 0.1, cabinY - 0.08, width / 2 + 0.12);
      const mirrorR = new THREE.Mesh(mirrorGeo, bodyMat);
      mirrorR.position.set(-length * 0.06 + cabinL / 2 - 0.1, cabinY - 0.08, -width / 2 - 0.12);
      car.add(mirrorL, mirrorR);

      // 5. 4 Detailed Wheels with Rubber Tires & Metallic Alloy Rims
      const tireR = 0.34;
      const wheelGeo = new THREE.CylinderGeometry(tireR, tireR, 0.24, 16);
      wheelGeo.rotateX(Math.PI / 2);
      const rimGeo = new THREE.CylinderGeometry(tireR * 0.65, tireR * 0.65, 0.26, 12);
      rimGeo.rotateX(Math.PI / 2);

      const wheelX = length * 0.32;
      const wheelZ = width / 2 + 0.02;
      const wheelPositions = [
        [wheelX, tireR, wheelZ], [wheelX, tireR, -wheelZ],
        [-wheelX, tireR, wheelZ], [-wheelX, tireR, -wheelZ]
      ];

      for (const [wx, wy, wz] of wheelPositions) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(wx, wy, wz);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.set(wx, wy, wz);
        wheel.castShadow = true;
        car.add(wheel, rim);
      }

      // 6. Dual Xenon/LED Headlights & Taillights
      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), headlightMat);
      hlL.position.set(length / 2 + 0.02, 0.32 + chassisH * 0.6, width * 0.35);
      const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), headlightMat);
      hlR.position.set(length / 2 + 0.02, 0.32 + chassisH * 0.6, -width * 0.35);

      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), taillightMat);
      tlL.position.set(-length / 2 - 0.02, 0.32 + chassisH * 0.62, width * 0.34);
      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), taillightMat);
      tlR.position.set(-length / 2 - 0.02, 0.32 + chassisH * 0.62, -width * 0.34);

      car.add(hlL, hlR, tlL, tlR);

      // 7. Taxi Rooftop Sign
      if (isTaxi) {
        const taxiSign = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.8), taxiSignMat);
        taxiSign.position.set(-length * 0.06, cabinY + cabinH / 2 + 0.1, 0);
        taxiSign.castShadow = true;
        car.add(taxiSign);
      }

      car.position.set(spot.pos[0], 0, spot.pos[1]);
      car.rotation.y = spot.rot;
      carGroup.add(car);
    }

    this.contextGroup.add(carGroup);
  }

  buildHotelMassing(footprintMm) {
    const shape = loopToShape(footprintMm);
    const brickMat = this.materials.get('BRICK_FACADE');
    const stoneMat = this.materials.get('REF28');
    const windowMat = this.materials.get('WINDOW_EXT');
    const darkMetalMat = this.materials.get('ACERO');
    const slateMat = this.materials.get('ROOF_SLATE');

    // 1. Ground floor Podium / Lobby (Y = 0 to 3.0m)
    const p1Geo = new THREE.ExtrudeGeometry(shape, { depth: 2.95, bevelEnabled: false });
    p1Geo.rotateX(-Math.PI / 2);
    const p1Mesh = new THREE.Mesh(p1Geo, [stoneMat, stoneMat]);
    p1Mesh.castShadow = true;
    p1Mesh.receiveShadow = true;
    this.lowerBuildingGroup.add(p1Mesh);

    // Stone Cornice Band
    const corniceGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.06, bevelSegments: 1 });
    corniceGeo.rotateX(-Math.PI / 2);
    const cornice1 = new THREE.Mesh(corniceGeo, stoneMat);
    cornice1.position.y = 2.88;
    this.lowerBuildingGroup.add(cornice1);

    // 2. Piso 2 Exterior Shell with Real Bogotá Brick Facade
    const p2ShellGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.92, bevelEnabled: false });
    p2ShellGeo.rotateX(-Math.PI / 2);
    const p2ShellMesh = new THREE.Mesh(p2ShellGeo, [brickMat, stoneMat]);
    p2ShellMesh.position.y = 3.02;
    p2ShellMesh.castShadow = true;
    p2ShellMesh.receiveShadow = true;
    this.exteriorShellPiso2.add(p2ShellMesh);
    this.addFacadeWindowsAlongFootprint(footprintMm, 3.02, 2.92, this.exteriorShellPiso2, windowMat, darkMetalMat);

    // 3. Upper Floors 3 to 6 with Real Bogotá Brick Facade & Windows
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

    // 4. Mansard / Roof Crown with Satellite Texture
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
