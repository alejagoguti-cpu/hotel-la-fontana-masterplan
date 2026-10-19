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

          if (b.isHotel) {
            // Other wings of Hotel La Fontana: Real Bogotá brick facade with satellite roof
            const mesh = new THREE.Mesh(geo, [roofSatMat, facadeBrickMat]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.upperBuildingGroup.add(mesh);
          } else {
            // Context buildings: pure frosted architectural white volumes with white wireframe edges
            const mesh = new THREE.Mesh(geo, contextWhiteMat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.contextGroup.add(mesh);

            // Crisp white architectural edges
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
            this.contextGroup.add(edges);
          }
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

    // 6. Realistic Architectural Trees (Natural branching structure + organic foliage)
    this.buildRealisticTrees(urbanNetwork.arboles);

    // 7. Realistic Architectural 3D Vehicles (Detailed chassis, glass, wheels, headlights)
    this.buildRealisticVehicles();
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

  buildRealisticTrees(treePoints = []) {
    const treeGroup = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x382c20,
      roughness: 0.92,
      metalness: 0.02
    });

    const speciesMaterials = [
      this.materials.get('TREE_ROBLE'),
      this.materials.get('TREE_CHICALA'),
      this.materials.get('TREE_SAUCO'),
      this.materials.get('TREE_FLOWER_YELLOW')
    ];

    const shadowMat = this.materials.get('TREE_SHADOW');

    // Shared smooth rounded geometries for high-performance rendering of 500+ trees
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 2.6, 8);
    const branchGeo = new THREE.CylinderGeometry(0.08, 0.15, 1.5, 6);
    // Detail level 2 for soft rounded organic canopy look
    const canopyCenterGeo = new THREE.IcosahedronGeometry(1.6, 2);
    const canopyLobeGeo = new THREE.IcosahedronGeometry(1.15, 2);
    const shadowGeo = new THREE.PlaneGeometry(6.2, 6.2);

    const pts = (Array.isArray(treePoints) && treePoints.length > 0)
      ? treePoints
      : [[10, 4], [22, 5], [12, -4], [24, -3], [-16, -22], [18, -22], [64, -16]];

    for (let i = 0; i < pts.length; i++) {
      const [tx, tz] = pts[i];
      const tree = new THREE.Group();

      // Deterministic natural variation per tree
      const hash = Math.abs(Math.sin(tx * 12.9898 + tz * 78.233) * 43758.5453);
      const scale = 0.85 + (hash % 1) * 0.45;
      const rot = (hash % 6.28);

      // Distribute species: Roble 40%, Chicalá 30%, Sauco 20%, Guayacán Amarillo 10%
      let mat;
      const spVal = (hash * 100) % 100;
      if (spVal < 40) {
        mat = speciesMaterials[0] || speciesMaterials[1];
      } else if (spVal < 70) {
        mat = speciesMaterials[1];
      } else if (spVal < 90) {
        mat = speciesMaterials[2] || speciesMaterials[1];
      } else {
        mat = speciesMaterials[3] || speciesMaterials[1];
      }

      // 1. Soft radial ground contact shadow decal (Crucial for aerial realism)
      if (shadowMat) {
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, 0.02, 0);
        shadow.scale.set(scale, scale, 1);
        tree.add(shadow);
      }

      // 2. Trunk & Structural Branches
      const trunkH = 2.3 * scale;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = trunkH / 2;
      trunk.scale.set(scale, scale, scale);
      trunk.castShadow = true;
      tree.add(trunk);

      const b1 = new THREE.Mesh(branchGeo, trunkMat);
      b1.position.set(0.32 * scale, trunkH * 0.85, 0.22 * scale);
      b1.rotation.set(0.4, 0.2, -0.6);
      b1.scale.set(scale, scale, scale);

      const b2 = new THREE.Mesh(branchGeo, trunkMat);
      b2.position.set(-0.28 * scale, trunkH * 0.9, -0.22 * scale);
      b2.rotation.set(-0.5, 0.3, 0.5);
      b2.scale.set(scale, scale, scale);
      tree.add(b1, b2);

      // 3. Volumetric Botanical Foliage (Cloud canopy with central buoyant crown + organic lobes)
      const foliage = new THREE.Group();

      const centerCrown = new THREE.Mesh(canopyCenterGeo, mat);
      centerCrown.position.set(0, trunkH + 1.35 * scale, 0);
      centerCrown.scale.set(scale * 1.1, scale * 0.95, scale * 1.1);
      centerCrown.castShadow = true;
      centerCrown.receiveShadow = true;
      foliage.add(centerCrown);

      const lobeOffsets = [
        [0.85 * scale, trunkH + 1.0 * scale, 0.65 * scale, 0.95],
        [-0.8 * scale, trunkH + 1.05 * scale, -0.6 * scale, 0.92],
        [0.65 * scale, trunkH + 1.5 * scale, -0.75 * scale, 0.88],
        [-0.75 * scale, trunkH + 1.45 * scale, 0.7 * scale, 0.9]
      ];

      for (const [lx, ly, lz, lobeScale] of lobeOffsets) {
        const lobe = new THREE.Mesh(canopyLobeGeo, mat);
        lobe.position.set(lx, ly, lz);
        lobe.scale.set(scale * lobeScale, scale * lobeScale, scale * lobeScale);
        lobe.castShadow = true;
        lobe.receiveShadow = true;
        foliage.add(lobe);
      }

      tree.add(foliage);
      tree.position.set(tx, 0.08, tz);
      tree.rotation.y = rot;
      treeGroup.add(tree);
    }

    this.contextGroup.add(treeGroup);
  }

  buildRealisticVehicles() {
    const carGroup = new THREE.Group();

    // Vehicle paint colors (realistic urban palette)
    const paintColors = [
      0x1c2024, // Obsidian Black
      0xdfdfdf, // Polar White
      0x4a525d, // Slate Grey Metallic
      0x8c1d24, // Crimson Red
      0x1e3a5f, // Deep Blue Metallic
      0xf4c430  // Taxi Yellow Bogota
    ];

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x111620,
      roughness: 0.1,
      metalness: 0.9,
      transmission: 0.2
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.8, roughness: 0.2 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xcc1111 });

    const carSpots = [
      // Av. Calle 127 (East-West traffic)
      [-42, 45.2, 0, 0],
      [8, 45.2, 0, 1],
      [58, 45.2, 0, 2],
      [-18, 51.8, Math.PI, 3],
      [36, 51.8, Math.PI, 4],
      [94, 51.8, Math.PI, 5],
      // Calle 124
      [-24, -30.5, 0, 1],
      [28, -30.5, 0, 2],
      // Av. Carrera 15 (North-South traffic)
      [74.5, -34, Math.PI / 2, 0],
      [74.5, 14, Math.PI / 2, 5],
      [81.5, -12, -Math.PI / 2, 4],
      [81.5, 62, -Math.PI / 2, 3]
    ];

    for (let i = 0; i < carSpots.length; i++) {
      const [cx, cz, rot, colorIdx] = carSpots[i];
      const car = new THREE.Group();

      const bodyMat = new THREE.MeshStandardMaterial({
        color: paintColors[colorIdx % paintColors.length],
        metalness: 0.65,
        roughness: 0.25
      });

      // 1. Lower Chassis (hood + fenders + trunk)
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.68, 1.85), bodyMat);
      chassis.position.y = 0.52;
      chassis.castShadow = true;
      car.add(chassis);

      // 2. Cabin Greenhouse
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.65, 1.55), bodyMat);
      cabin.position.set(-0.25, 1.15, 0);
      cabin.castShadow = true;

      // Windshield & Rear glass
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 1.48), glassMat);
      windshield.position.set(0.92, 1.14, 0);
      windshield.rotation.z = -0.35;

      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 1.48), glassMat);
      rearGlass.position.set(-1.42, 1.14, 0);
      rearGlass.rotation.z = 0.35;

      // Side windows
      const sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.48, 0.08), glassMat);
      sideGlassL.position.set(-0.25, 1.18, 0.76);
      const sideGlassR = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.48, 0.08), glassMat);
      sideGlassR.position.set(-0.25, 1.18, -0.76);

      car.add(cabin, windshield, rearGlass, sideGlassL, sideGlassR);

      // 3. 4 Wheels with rubber tires and rims
      const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16);
      wheelGeo.rotateX(Math.PI / 2);
      const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.24, 12);
      rimGeo.rotateX(Math.PI / 2);

      const wheelPositions = [
        [1.3, 0.34, 0.88], [1.3, 0.34, -0.88],
        [-1.3, 0.34, 0.88], [-1.3, 0.34, -0.88]
      ];

      for (const [wx, wy, wz] of wheelPositions) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(wx, wy, wz);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.set(wx, wy, wz);
        wheel.castShadow = true;
        car.add(wheel, rim);
      }

      // 4. Headlights & Taillights
      const hlLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.35), headlightMat);
      hlLeft.position.set(2.14, 0.62, 0.62);
      const hlRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.35), headlightMat);
      hlRight.position.set(2.14, 0.62, -0.62);

      const tlLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), taillightMat);
      tlLeft.position.set(-2.14, 0.62, 0.62);
      const tlRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), taillightMat);
      tlRight.position.set(-2.14, 0.62, -0.62);

      car.add(hlLeft, hlRight, tlLeft, tlRight);

      car.position.set(cx, 0, cz);
      car.rotation.y = rot;
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
