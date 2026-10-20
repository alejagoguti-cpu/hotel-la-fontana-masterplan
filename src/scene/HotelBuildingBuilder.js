import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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
 * Architectural Triplanar UV generator for Red Brick Facades.
 * Eliminates texture stretching, skewing or smearing across extruded geometries.
 * Tiles horizontally and vertically at exact Revit 1.35m x 1.35m architectural scale.
 */
export function applyArchitecturalBrickUVs(geometry, scaleH = 1.35, scaleV = 1.35) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  if (!pos || !uv) return;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    let nx = 0, ny = 1, nz = 0;
    if (norm) {
      nx = Math.abs(norm.getX(i));
      ny = Math.abs(norm.getY(i));
      nz = Math.abs(norm.getZ(i));
    }

    let u = 0, v = 0;
    if (ny > 0.65) {
      // Horizontal roof / floor caps
      u = x / scaleH;
      v = z / scaleH;
    } else if (nx > nz) {
      // Vertical facades facing East/West
      u = z / scaleH;
      v = y / scaleV;
    } else {
      // Vertical facades facing North/South
      u = x / scaleH;
      v = y / scaleV;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
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

  build(architectureData, catastroBuildings = [], urbanNetwork = {}, revitWindows = []) {
    const mainFootprint = architectureData.slabLoops?.[0]?.loops?.[0] || [
      [24840, 3760], [31226, -2626], [28800, -5052], [28800, -11000],
      [32800, -15250], [38900, -15250], [49125, -5025], [29450, 14650],
      [3200, 14650], [3200, 12300], [-14000, 12300], [-14000, 3800]
    ];

    this.buildUrbanContext(catastroBuildings, urbanNetwork);
    this.buildHotelMassing(mainFootprint, revitWindows);
    return this.rootGroup;
  }

  /**
   * Creates the authentic 1:1 Revit window component matching:
   * Family: 'HLF-VENTANA FACHADA BARANDAL'
   * Visual Reference: User photos 1, 2, 3
   */
  createRevitWindowComponent(width = 1.34, height = 1.50, isLit = false) {
    const winGroup = new THREE.Group();
    const frameMat = this.materials.get('REVIT_WIN_FRAME');
    const glassMat = isLit ? this.materials.get('REVIT_WIN_GLASS_LIT') : this.materials.get('REVIT_WIN_GLASS');
    const railingMat = this.materials.get('REVIT_WIN_RAILING');
    const planterMat = this.materials.get('REVIT_WIN_PLANTER');
    const ivyMat = this.materials.get('REVIT_WIN_IVY');

    const fThick = 0.055;
    const fDepth = 0.07;
    const halfW = width / 2;

    // 1. Perimeter Frame (Dark green-slate #333e3b)
    const jambGeo = new THREE.BoxGeometry(fThick, height, fDepth);
    const leftJamb = new THREE.Mesh(jambGeo, frameMat);
    leftJamb.position.set(-halfW + fThick / 2, height / 2, 0);
    const rightJamb = new THREE.Mesh(jambGeo, frameMat);
    rightJamb.position.set(halfW - fThick / 2, height / 2, 0);

    const headGeo = new THREE.BoxGeometry(width, fThick, fDepth);
    const head = new THREE.Mesh(headGeo, frameMat);
    head.position.set(0, height - fThick / 2, 0);

    const baseSillGeo = new THREE.BoxGeometry(width, fThick, fDepth);
    const baseSill = new THREE.Mesh(baseSillGeo, frameMat);
    baseSill.position.set(0, fThick / 2, 0);

    // Horizontal Transom Bar (dividing upper 62% from lower 38%)
    const transomY = height * 0.38;
    const transomGeo = new THREE.BoxGeometry(width - 2 * fThick, 0.045, fDepth);
    const transom = new THREE.Mesh(transomGeo, frameMat);
    transom.position.set(0, transomY, 0);

    winGroup.add(leftJamb, rightJamb, head, baseSill, transom);

    // 2. Upper 62%: Sliding 2-leaf glazed window
    const upperH = height - transomY - fThick;
    const upperW = width - 2 * fThick;
    const leafW = upperW / 2;

    // Center vertical mullion
    const mullionGeo = new THREE.BoxGeometry(0.045, upperH, fDepth * 0.85);
    const mullion = new THREE.Mesh(mullionGeo, frameMat);
    mullion.position.set(0, transomY + upperH / 2, 0);
    winGroup.add(mullion);

    // Upper glass panes
    const glassPaneGeo = new THREE.PlaneGeometry(leafW - 0.03, upperH - 0.03);
    const glassLeft = new THREE.Mesh(glassPaneGeo, glassMat);
    glassLeft.position.set(-leafW / 2, transomY + upperH / 2, 0.015);
    const glassRight = new THREE.Mesh(glassPaneGeo, glassMat);
    glassRight.position.set(leafW / 2, transomY + upperH / 2, -0.015);
    winGroup.add(glassLeft, glassRight);

    // 3. Lower 38%: White Baluster Railing (Barandal de balaustres blancos)
    const lowerH = transomY - fThick;
    const lowerW = width - 2 * fThick;

    const handrailGeo = new THREE.BoxGeometry(lowerW, 0.032, 0.035);
    const handrail = new THREE.Mesh(handrailGeo, railingMat);
    handrail.position.set(0, transomY - 0.02, 0.045);

    const botRailGeo = new THREE.BoxGeometry(lowerW, 0.024, 0.035);
    const botRail = new THREE.Mesh(botRailGeo, railingMat);
    botRail.position.set(0, fThick + 0.015, 0.045);
    winGroup.add(handrail, botRail);

    // Protective glass behind railing
    const lowerGlassGeo = new THREE.PlaneGeometry(lowerW, lowerH);
    const lowerGlass = new THREE.Mesh(lowerGlassGeo, this.materials.get('REVIT_WIN_GLASS'));
    lowerGlass.position.set(0, fThick + lowerH / 2, 0.01);
    winGroup.add(lowerGlass);

    // Vertical Pickets (spaced ~75mm apart)
    const numPickets = Math.max(3, Math.floor(lowerW / 0.075));
    const picketSpacing = lowerW / (numPickets + 1);
    const picketH = lowerH - 0.055;
    const picketGeo = new THREE.BoxGeometry(0.02, picketH, 0.02);

    for (let p = 1; p <= numPickets; p++) {
      const px = -lowerW / 2 + p * picketSpacing;
      const picket = new THREE.Mesh(picketGeo, railingMat);
      picket.position.set(px, fThick + 0.025 + picketH / 2, 0.045);
      winGroup.add(picket);
    }

    // 4. Exterior Cantilevered Concrete Planter Box (Jardinera exterior bajo antepecho)
    const planterW = width + 0.16;
    const planterH = 0.24;
    const planterD = 0.26;
    const planterGeo = new THREE.BoxGeometry(planterW, planterH, planterD);
    const planter = new THREE.Mesh(planterGeo, planterMat);
    planter.position.set(0, -planterH / 2 + 0.02, planterD / 2 + 0.03);
    winGroup.add(planter);

    // 5. Lush Green Hanging Ivy (Hiedra trepadora / enredadera colgante)
    if (ivyMat) {
      const ivyFrontGeo = new THREE.PlaneGeometry(planterW + 0.04, 0.42);
      const ivyFront = new THREE.Mesh(ivyFrontGeo, ivyMat);
      ivyFront.position.set(0, -0.20, planterD + 0.04);

      const ivyTopGeo = new THREE.PlaneGeometry(planterW, planterD * 0.85);
      const ivyTop = new THREE.Mesh(ivyTopGeo, ivyMat);
      ivyTop.rotation.x = -Math.PI / 2;
      ivyTop.position.set(0, 0.02, planterD / 2 + 0.03);

      const ivySideGeo = new THREE.PlaneGeometry(planterD, 0.36);
      const ivyLeft = new THREE.Mesh(ivySideGeo, ivyMat);
      ivyLeft.rotation.y = -Math.PI / 2;
      ivyLeft.position.set(-planterW / 2 - 0.01, -0.16, planterD / 2 + 0.03);

      const ivyRight = new THREE.Mesh(ivySideGeo, ivyMat);
      ivyRight.rotation.y = Math.PI / 2;
      ivyRight.position.set(planterW / 2 + 0.01, -0.16, planterD / 2 + 0.03);

      winGroup.add(ivyFront, ivyTop, ivyLeft, ivyRight);
    }

    return winGroup;
  }

  buildUrbanContext(catastroBuildings = [], urbanNetwork = {}) {
    const facadeBrickMat = this.materials.get('BRICK_FACADE');
    const roofClayMat = this.materials.get('ROOF_CLAY_TILE');
    const timberEavesMat = this.materials.get('ROOF_EAVES_TIMBER');
    const contextWhiteMat = this.materials.get('CONTEXT_WHITE');
    const stoneMat = this.materials.get('REF28');
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
      color: 0xebf0f5,
      roughness: 0.9,
      metalness: 0.02
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundH), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((ORTHO_X_MIN + ORTHO_X_MAX) / 2, -0.06, (ORTHO_Z_MIN + ORTHO_Z_MAX) / 2);
    ground.receiveShadow = true;
    this.contextGroup.add(ground);

    // 2. Real Bogotá Catastro Buildings
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

          if (b.isHotel) {
            // ==============================================================
            // HOTEL ESTELAR LA FONTANA: 100% LADRILLO ROJO BOGOTANO (Revit 1.35m scale)
            // ==============================================================
            applyArchitecturalBrickUVs(geo, 1.35, 1.35);
            const hotelMesh = new THREE.Mesh(geo, [facadeBrickMat, facadeBrickMat]);
            hotelMesh.castShadow = true;
            hotelMesh.receiveShadow = true;
            this.contextGroup.add(hotelMesh);

            // Spanish Terracotta Clay Roof Tiles (Teja de barro roja - Photo 1 & 2)
            const roofGeo = new THREE.ExtrudeGeometry(shape, {
              depth: 1.5,
              bevelEnabled: true,
              bevelSize: -0.35,
              bevelThickness: 0.75,
              bevelSegments: 2
            });
            roofGeo.rotateX(-Math.PI / 2);
            applyArchitecturalBrickUVs(roofGeo, 1.35, 1.35);
            const roofMesh = new THREE.Mesh(roofGeo, [roofClayMat, roofClayMat]);
            roofMesh.position.y = height;
            roofMesh.castShadow = true;
            this.contextGroup.add(roofMesh);

            // Overhanging Dark Timber Eaves Trim
            const eavesGeo = new THREE.ExtrudeGeometry(shape, {
              depth: 0.18,
              bevelEnabled: true,
              bevelSize: 0.22,
              bevelThickness: 0.08,
              bevelSegments: 1
            });
            eavesGeo.rotateX(-Math.PI / 2);
            const eaves = new THREE.Mesh(eavesGeo, timberEavesMat);
            eaves.position.y = height - 0.08;
            this.contextGroup.add(eaves);

            // Add authentic windows on every floor of this hotel wing
            this.addWindowsAlongPolygon(b.pts, 0, height, this.contextGroup);
          } else {
            // Surrounding non-hotel urban context: frosted architectural white volumes
                        const mesh = new THREE.Mesh(geo, contextWhiteMat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.contextGroup.add(mesh);

            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
            this.contextGroup.add(edges);
          }
        } catch (e) {}
      }
    }

    // 3. Official Bogotá Road Network (Calzadas, Andenes, Separadores, Ciclorrutas)
    const calzadaMat = this.materials.get('ROAD_ASPHALT');
    const andenMat = this.materials.get('SIDEWALK_PAVING');
    const alamedaMat = this.materials.get('TURF_GRASS');
    const cicloMat = this.materials.get('BIKEWAY_BLUE');

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

    for (const poly of (urbanNetwork.ciclorrutas || [])) {
      try {
        const shape = ptsToShape(poly);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, cicloMat);
        mesh.position.y = 0.15;
        this.contextGroup.add(mesh);
      } catch (e) {}
    }

    // 4. Photorealistic Road Surface Markings & Signage
    this.buildRoadMarkings();

    // 5. Hotel La Fontana Central Courtyard & Traditional Multi-Tier Stone Fountain (Photos 1, 2, 3)
    this.buildCourtyard(andenMat, stoneMat);

    // 6. Realistic Botanical Trees (5 native Bogota species, varied frondosidad, safe off-road placement)
    this.buildRealisticTrees(urbanNetwork.arboles, urbanNetwork.calzadas);

    // 7. Photorealistic 3D Vehicles (100% inside vehicular calzadas & courtyard parking: Sedans, SUVs, Bogota Taxis, Sports)
    this.buildRealisticVehicles(urbanNetwork.calzadas);
  }

  buildCourtyard(andenMat, stoneMat) {
    const courtyardGeo = new THREE.PlaneGeometry(36, 28);
    const courtyard = new THREE.Mesh(courtyardGeo, andenMat);
    courtyard.rotation.x = -Math.PI / 2;
    courtyard.position.set(16, 0.04, 2);
    courtyard.receiveShadow = true;
    this.contextGroup.add(courtyard);

    // Traditional Multi-Tier Stone Fountain (Photo 3 Reference)
    const fountainGroup = new THREE.Group();
    fountainGroup.position.set(16, 0.04, 2);

    // Outer octagonal stone curb
    const outerCurb = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.42, 8), stoneMat);
    outerCurb.position.y = 0.21;
    fountainGroup.add(outerCurb);

    // Lower tier water basin
    const lowerBasin = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.9, 0.38, 24), stoneMat);
    lowerBasin.position.y = 0.38;
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2288cc,
      roughness: 0.08,
      metalness: 0.4,
      transparent: true,
      opacity: 0.85
    });
    const lowerWater = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.32, 24), waterMat);
    lowerWater.position.y = 0.42;
    fountainGroup.add(lowerBasin, lowerWater);

    // Central stone pedestal & upper basin
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.52, 1.1, 16), stoneMat);
    pedestal.position.y = 0.95;
    const upperBasin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.32, 24), stoneMat);
    upperBasin.position.y = 1.45;
    const upperWater = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.25, 24), waterMat);
    upperWater.position.y = 1.5;
    fountainGroup.add(pedestal, upperBasin, upperWater);

    // Water jet spout
    const spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.22, 0.8, 12),
      new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, transparent: true, opacity: 0.75 })
    );
    spout.position.y = 1.85;
    fountainGroup.add(spout);

    this.contextGroup.add(fountainGroup);

    // Vintage Courtyard Cast-Iron Lamp Posts (Photo 3 Reference)
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.35, metalness: 0.85 });
    const lanternGlassMat = new THREE.MeshStandardMaterial({
      color: 0xffe29a,
      emissive: 0xffba42,
      emissiveIntensity: 0.65,
      roughness: 0.2
    });

    const lampPositions = [
      [7.5, 9.5], [24.5, 9.5], [7.5, -5.5], [24.5, -5.5],
      [16.0, 11.5], [16.0, -7.5], [4.5, 2.0], [27.5, 2.0]
    ];

    lampPositions.forEach(([lx, lz]) => {
      const lamp = new THREE.Group();
      lamp.position.set(lx, 0.04, lz);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 3.2, 8), lampMat);
      pole.position.y = 1.6;
      pole.castShadow = true;

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.32), lanternGlassMat);
      head.position.y = 3.2;

      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.22, 4), lampMat);
      cap.position.y = 3.5;
      cap.rotation.y = Math.PI / 4;

      lamp.add(pole, head, cap);
      this.contextGroup.add(lamp);
    });
  }

  buildRoadMarkings() {
    const markGroup = new THREE.Group();
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf5f7fa });
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xf6c83b });

    const addZebra = (cx, cz, isHoriz, length = 12, width = 4.2) => {
      const stripes = 8;
      const stripeW = 0.45;
      const spacing = isHoriz ? width / stripes : length / stripes;
      for (let s = 0; s < stripes; s++) {
        const sw = isHoriz ? length : stripeW;
        const sh = isHoriz ? stripeW : width;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), whiteMat);
        mesh.rotation.x = -Math.PI / 2;
        const ox = isHoriz ? cx : cx - length / 2 + s * spacing + spacing / 2;
        const oz = isHoriz ? cz - width / 2 + s * spacing + spacing / 2 : cz;
        mesh.position.set(ox, 0.052, oz);
        markGroup.add(mesh);
      }
    };

    addZebra(-12, 42.0, true, 10.5, 4.0);
    addZebra(62, 44.5, true, 11.0, 4.0);
    addZebra(76, -18.0, false, 4.0, 11.5);
    addZebra(76, 12.0, false, 4.0, 11.5);

    const addDashedLine = (x1, z1, x2, z2, mat = whiteMat, dashLen = 3.2, gapLen = 4.5) => {
      const dx = x2 - x1, dz = z2 - z1;
      const totalLen = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      let dist = 0;
      while (dist + dashLen <= totalLen) {
        const mx = x1 + Math.cos(angle) * (dist + dashLen / 2);
        const mz = z1 + Math.sin(angle) * (dist + dashLen / 2);
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(dashLen, 0.16), mat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.rotation.z = -angle;
        stripe.position.set(mx, 0.051, mz);
        markGroup.add(stripe);
        dist += dashLen + gapLen;
      }
    };

    addDashedLine(-85, 33.5, 120, 39.5, whiteMat);
    addDashedLine(-85, 40.5, 120, 47.5, yellowMat);
    addDashedLine(-85, 62.0, 120, 68.0, whiteMat);
    addDashedLine(-85, 69.5, 120, 75.5, whiteMat);
    addDashedLine(82.0, -95, 82.0, 45, whiteMat);

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

    const isInsideRoadway = (x, z) => {
      if (!Array.isArray(calzadaPolys) || calzadaPolys.length === 0) return false;
      for (const poly of calzadaPolys) {
        if (!poly || poly.length < 3) continue;
        if (inPoly([x, z], poly)) return true;
        if (distToPolyEdge([x, z], poly) < 2.0) return true;
      }
      return false;
    };

    const candidatePoints = [];
    if (Array.isArray(treePoints)) {
      for (const pt of treePoints) candidatePoints.push(pt);
    }

    const courtyardTrees = [
      [9.5, 7.5], [22.5, 7.5], [9.5, -3.5], [22.5, -3.5],
      [16, 9.5], [16, -5.5], [7.0, 2.0], [25.0, 2.0],
      [11.5, 4.5], [20.5, 4.5], [11.5, -0.5], [20.5, -0.5]
    ];
    candidatePoints.push(...courtyardTrees);

    for (let x = -75; x <= 0; x += 10.0) candidatePoints.push([x, 19.5]);
    for (let x = -75; x <= 85; x += 9.5) candidatePoints.push([x, 85.0]);
    for (let x = 12; x <= 72; x += 8.5) candidatePoints.push([x, 54.5]);
    for (let z = -90; z <= 25; z += 9.0) candidatePoints.push([100.0, z]);

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

    const cardBaseGeo = new THREE.PlaneGeometry(1, 1);
    const discBaseGeo = new THREE.PlaneGeometry(1, 1);
    const puffBaseGeo = new THREE.PlaneGeometry(1, 1);
    const shadowBaseGeo = new THREE.PlaneGeometry(1, 1);
    const trunkBaseGeo = new THREE.CylinderGeometry(0.14, 0.32, 1, 8);
    const rootBaseGeo = new THREE.CylinderGeometry(0.28, 0.52, 0.35, 8);
    const branchBaseGeo = new THREE.CylinderGeometry(0.06, 0.12, 1, 6);

    for (let i = 0; i < candidatePoints.length; i++) {
      const [tx, tz] = candidatePoints[i];

      if (isInsideRoadway(tx, tz)) continue;
      if (tx >= -16 && tx <= 50 && tz >= -16 && tz <= 15) {
        const inCourtyard = (tx >= 6.5 && tx <= 25.5 && tz >= -5.8 && tz <= 9.8);
        if (!inCourtyard) continue;
      }

      const tree = new THREE.Group();
      const hash1 = Math.abs(Math.sin(tx * 12.9898 + tz * 78.233) * 43758.5453);
      const hash2 = Math.abs(Math.cos(tx * 26.6514 + tz * 45.197) * 28461.1278);
      const rot = (hash1 % 6.28);

      let spIdx = 0;
      const spVal = (hash1 * 100) % 100;
      if (spVal < 30) spIdx = 0;
      else if (spVal < 55) spIdx = 1;
      else if (spVal < 75) spIdx = 2;
      else if (spVal < 90) spIdx = 3;
      else spIdx = 4;

      const spec = speciesConfig[spIdx];
      const sizeMult = 0.82 + (hash2 % 0.38);
      const treeHeight = spec.baseHeight * sizeMult;
      const canopyWidth = spec.baseWidth * sizeMult;
      const trunkH = spec.trunkH * sizeMult;
      const canopyH = treeHeight - trunkH * 0.7;

      if (shadowMat) {
        const shadow = new THREE.Mesh(shadowBaseGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, 0.02, 0);
        shadow.scale.set(canopyWidth * 1.05, canopyWidth * 1.05, 1);
        tree.add(shadow);
      }

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

      const foliageGroup = new THREE.Group();
      const canopyBaseY = trunkH * 0.75;

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
    const carShadowMat = this.materials.get('CAR_SHADOW');

    const carSpots = [
      // Courtyard Parking (Photo 1 reference: vehicles parked in front of entrance/fountain)
      { pos: [10.5, 7.8], rot: 0, type: 'sedan', color: 1 },
      { pos: [13.2, 7.8], rot: 0, type: 'suv', color: 0 },
      { pos: [15.8, 7.8], rot: 0, type: 'taxi', color: 5 },
      { pos: [18.4, 7.8], rot: 0, type: 'sedan', color: 2 },
      { pos: [21.0, 7.8], rot: 0, type: 'suv', color: 3 },

      // Calle 127 South (Eastbound traffic along +X, rot = Math.PI / 2)
      { pos: [-45, 30.5], rot: Math.PI / 2, type: 'sedan', color: 0 },
      { pos: [-15, 31.0], rot: Math.PI / 2, type: 'suv', color: 1 },
      { pos: [15, 36.0], rot: Math.PI / 2 + 0.08, type: 'taxi', color: 5 },
      { pos: [42, 38.5], rot: Math.PI / 2 + 0.12, type: 'sedan', color: 2 },
      { pos: [68, 43.0], rot: Math.PI / 2 + 0.18, type: 'suv', color: 3 },
      { pos: [110, 46.5], rot: Math.PI / 2, type: 'sports', color: 4 },

      // Calle 127 North (Westbound traffic along -X, rot = -Math.PI / 2)
      { pos: [70, 74.0], rot: -Math.PI / 2, type: 'sedan', color: 1 },
      { pos: [35, 68.0], rot: -Math.PI / 2 - 0.08, type: 'taxi', color: 5 },
      { pos: [5, 64.0], rot: -Math.PI / 2, type: 'suv', color: 0 },
      { pos: [-25, 61.0], rot: -Math.PI / 2, type: 'sedan', color: 2 },
      { pos: [-55, 57.0], rot: -Math.PI / 2, type: 'suv', color: 3 },

      // Carrera 15 (Northbound traffic along -Z, rot = Math.PI)
      { pos: [82.0, -45.0], rot: Math.PI, type: 'sports', color: 0 },
      { pos: [82.0, -10.0], rot: Math.PI, type: 'taxi', color: 5 },
      { pos: [82.0, 18.0], rot: Math.PI, type: 'suv', color: 1 },

      // Carrera 15 (Southbound traffic along +Z, rot = 0)
      { pos: [80.0, 5.0], rot: 0, type: 'sedan', color: 2 },
      { pos: [85.0, -25.0], rot: 0, type: 'suv', color: 3 }
    ];

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
    const modelCache = {};

    const loadModel = (url) => loader.loadAsync(url).catch(err => {
      console.warn('Vehicle model load fallback for:', url, err);
      return null;
    });

    Promise.all([
      loadModel('./assets/models/sedan.glb').then(g => { if (g) modelCache.sedan = g; }),
      loadModel('./assets/models/suv.glb').then(g => { if (g) modelCache.suv = g; }),
      loadModel('./assets/models/taxi.glb').then(g => { if (g) modelCache.taxi = g; }),
      loadModel('./assets/models/ferrari.glb').then(g => { if (g) modelCache.sports = g; })
    ]).then(() => {
      for (let i = 0; i < carSpots.length; i++) {
        const spot = carSpots[i];
        const car = new THREE.Group();

        if (carShadowMat) {
          const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.5), carShadowMat);
          shadow.rotation.x = -Math.PI / 2;
          shadow.position.set(0, 0.03, 0);
          shadow.rotation.z = spot.rot;
          car.add(shadow);
        }

        const gltf = modelCache[spot.type] || modelCache.sedan;
        if (gltf && gltf.scene) {
          const modelClone = SkeletonUtils.clone(gltf.scene);

          modelClone.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material = child.material.map(m => m.clone());
                } else {
                  child.material = child.material.clone();
                }
              }

              if (spot.type === 'sports' && child.name === 'body' && child.material) {
                child.material.color.setHex(spot.color === 0 ? 0xcc1824 : 0x181c22);
                child.material.metalness = 0.9;
                child.material.roughness = 0.18;
              }
            }
          });

          if (spot.type === 'sports') {
            modelClone.scale.set(0.96, 0.96, 0.96);
            modelClone.rotation.y = spot.rot + Math.PI;
          } else {
            modelClone.scale.set(0.92, 0.92, 0.92);
            modelClone.rotation.y = spot.rot;
          }

          car.add(modelClone);
        }

        car.position.set(spot.pos[0], 0, spot.pos[1]);
        carGroup.add(car);
      }
    });

    this.contextGroup.add(carGroup);
  }

  buildHotelMassing(footprintMm, revitWindows = []) {
    const shape = loopToShape(footprintMm);
    const pts3D = footprintMm.map(([x, y]) => [x * MM_TO_M, -y * MM_TO_M]);
    const brickMat = this.materials.get('BRICK_FACADE');
    const roofClayMat = this.materials.get('ROOF_CLAY_TILE');
    const timberEavesMat = this.materials.get('ROOF_EAVES_TIMBER');
    const stoneMat = this.materials.get('REF28');

    // ==============================================================
    // 1. Ground floor Podium / Lobby (Y = 0 to 3.0m) - 100% LADRILLO ROJO REVIT
    // ==============================================================
    const p1Geo = new THREE.ExtrudeGeometry(shape, { depth: 2.95, bevelEnabled: false });
    p1Geo.rotateX(-Math.PI / 2);
    applyArchitecturalBrickUVs(p1Geo, 1.35, 1.35);
    const p1Mesh = new THREE.Mesh(p1Geo, [brickMat, brickMat]);
    p1Mesh.castShadow = true;
    p1Mesh.receiveShadow = true;
    this.lowerBuildingGroup.add(p1Mesh);

    // Stone Cornice Band
    const corniceGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.06, bevelSegments: 1 });
    corniceGeo.rotateX(-Math.PI / 2);
    const cornice1 = new THREE.Mesh(corniceGeo, stoneMat);
    cornice1.position.y = 2.88;
    this.lowerBuildingGroup.add(cornice1);

    // Iconic Lobby Entrance Canopy ("HOTEL ESTELAR LA FONTANA") in Courtyard (Photos 2 & 3)
    this.buildEntranceCanopy(16.0, 0, -3.85, 0);

    // Ground floor storefront / restaurant ribbon glazing
    this.addGroundRibbonWindows(pts3D, this.lowerBuildingGroup);

    // ==============================================================
    // 2. Piso 2 Exterior Shell with Real Bogotá Brick Facade & Exact Revit Windows
    // ==============================================================
    const p2ShellGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.92, bevelEnabled: false });
    p2ShellGeo.rotateX(-Math.PI / 2);
    applyArchitecturalBrickUVs(p2ShellGeo, 1.35, 1.35);
    const p2ShellMesh = new THREE.Mesh(p2ShellGeo, [brickMat, brickMat]);
    p2ShellMesh.position.y = 3.02;
    p2ShellMesh.castShadow = true;
    p2ShellMesh.receiveShadow = true;
    this.exteriorShellPiso2.add(p2ShellMesh);

    // Place exact Revit window instances on Piso 2
    if (Array.isArray(revitWindows) && revitWindows.length > 0) {
      revitWindows.forEach((w, idx) => {
        const isLit = (idx % 3 !== 0);
        const win = this.createRevitWindowComponent(w.width || 1.34, 1.50, isLit);
        win.position.set(w.pos[0], 3.02 + 0.85, w.pos[1]);
        win.rotation.y = w.rotY || 0;
        this.exteriorShellPiso2.add(win);
      });
    } else {
      this.addWindowsAlongPolygon(pts3D, 3.02, 2.92, this.exteriorShellPiso2);
    }

    // ==============================================================
    // 3. Upper Floors 3 to 6 with Real Bogotá Brick Facade & Exact Revit Windows
    // ==============================================================
    for (let floor = 3; floor <= 6; floor++) {
      const yBase = (floor - 1) * 3.0;
      const floorGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.88, bevelEnabled: false });
      floorGeo.rotateX(-Math.PI / 2);
      applyArchitecturalBrickUVs(floorGeo, 1.35, 1.35);
      const floorMesh = new THREE.Mesh(floorGeo, [brickMat, brickMat]);
      floorMesh.position.y = yBase;
      floorMesh.castShadow = true;
      floorMesh.receiveShadow = true;
      this.upperBuildingGroup.add(floorMesh);

      const bandMesh = new THREE.Mesh(corniceGeo, stoneMat);
      bandMesh.position.y = yBase + 2.86;
      this.upperBuildingGroup.add(bandMesh);

      if (Array.isArray(revitWindows) && revitWindows.length > 0) {
        revitWindows.forEach((w, idx) => {
          const isLit = ((idx + floor) % 2 === 0);
          const win = this.createRevitWindowComponent(w.width || 1.34, 1.50, isLit);
          win.position.set(w.pos[0], yBase + 0.85, w.pos[1]);
          win.rotation.y = w.rotY || 0;
          this.upperBuildingGroup.add(win);
        });
      } else {
        this.addWindowsAlongPolygon(pts3D, yBase, 2.88, this.upperBuildingGroup);
      }
    }

    // ==============================================================
    // 4. Sloped Spanish Terracotta Clay Tile Roof with Timber Eaves (Photos 1, 2, 3)
    // ==============================================================
    const roofBaseY = 18.0;

    // A. Overhanging Dark Timber Eaves with Rafters
    const eavesGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.28,
      bevelEnabled: true,
      bevelSize: 0.45,
      bevelThickness: 0.14,
      bevelSegments: 1
    });
    eavesGeo.rotateX(-Math.PI / 2);
    const eavesMesh = new THREE.Mesh(eavesGeo, timberEavesMat);
    eavesMesh.position.y = roofBaseY;
    eavesMesh.castShadow = true;
    this.upperBuildingGroup.add(eavesMesh);

    // B. Spanish Terracotta Clay Tile Hip Roof (Teja de barro roja)
    const roofTileGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 2.2,
      bevelEnabled: true,
      bevelSize: -0.65,
      bevelThickness: 1.2,
      bevelSegments: 2
    });
    roofTileGeo.rotateX(-Math.PI / 2);
    applyArchitecturalBrickUVs(roofTileGeo, 1.35, 1.35);
    const roofMesh = new THREE.Mesh(roofTileGeo, [roofClayMat, roofClayMat]);
    roofMesh.position.y = roofBaseY + 0.22;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.upperBuildingGroup.add(roofMesh);

    // C. Traditional Brick Chimneys (Photo 1 Reference)
    const chimneyPositions = [
      [34.0, 10.0], [28.0, 0.0], [12.0, 10.0], [-4.0, 8.0], [42.0, -8.0]
    ];
    chimneyPositions.forEach(([cx, cz]) => {
      const chim = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.4), brickMat);
      applyArchitecturalBrickUVs(chim.geometry, 1.35, 1.35);
      chim.position.set(cx, roofBaseY + 2.4, cz);
      const chimCap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 1.7), stoneMat);
      chimCap.position.set(cx, roofBaseY + 3.55, cz);
      this.upperBuildingGroup.add(chim, chimCap);
    });
  }

  buildEntranceCanopy(cx, cy, cz, rotY = 0) {
    const canopyGroup = new THREE.Group();
    canopyGroup.position.set(cx, cy, cz);
    canopyGroup.rotation.y = rotY;

    const metalMat = this.materials.get('ACERO') || new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.35, metalness: 0.8 });
    const glassRoofMat = new THREE.MeshPhysicalMaterial({ color: 0xddeef5, transparent: true, opacity: 0.6, roughness: 0.1 });
    const lampGlowMat = new THREE.MeshStandardMaterial({ color: 0xffe8a4, emissive: 0xffc448, emissiveIntensity: 1.2 });
    const stepBrickMat = this.materials.get('BRICK_FACADE');

    // Stepped entrance stairs
    for (let s = 0; s < 4; s++) {
      const stepW = 8.5 - s * 0.4;
      const stepD = 2.8 - s * 0.4;
      const step = new THREE.Mesh(new THREE.BoxGeometry(stepW, 0.16, stepD), stepBrickMat);
      step.position.set(0, s * 0.16 + 0.08, s * 0.2);
      canopyGroup.add(step);
    }

    // Glass & steel canopy cantilever
    const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 3.2), glassRoofMat);
    roofMesh.position.set(0, 3.2, 1.6);
    const frameBorder = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.16, 3.3), metalMat);
    frameBorder.position.set(0, 3.2, 1.6);

    // Cantilever support rods
    const rod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6), metalMat);
    rod1.position.set(-3.2, 4.0, 1.2);
    rod1.rotation.x = 0.55;
    const rod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6), metalMat);
    rod2.position.set(3.2, 4.0, 1.2);
    rod2.rotation.x = 0.55;

    // Hanging warm lanterns beneath canopy
    for (let l = -2.4; l <= 2.4; l += 1.6) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), lampGlowMat);
      bulb.position.set(l, 3.0, 1.6);
      canopyGroup.add(bulb);
    }

    // Potted topiary shrubs at entrance stairs
    const potMat = new THREE.MeshStandardMaterial({ color: 0x9b482b, roughness: 0.8 });
    const shrubMat = this.materials.get('TREE_ROBLE');
    [-3.8, 3.8].forEach(px => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 0.6, 12), potMat);
      pot.position.set(px, 0.3, 0.6);
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 12), shrubMat);
      shrub.position.set(px, 0.85, 0.6);
      canopyGroup.add(pot, shrub);
    });

    canopyGroup.add(roofMesh, frameBorder, rod1, rod2);
    this.lowerBuildingGroup.add(canopyGroup);
  }

  addGroundRibbonWindows(pts3D, targetGroup) {
    if (!Array.isArray(pts3D) || pts3D.length < 3) return;
    const frameMat = this.materials.get('REVIT_WIN_FRAME');
    const glassMat = this.materials.get('REVIT_WIN_GLASS_LIT');

    for (let i = 0; i < pts3D.length; i++) {
      const p1 = pts3D[i];
      const p2 = pts3D[(i + 1) % pts3D.length];
      const dx = p2[0] - p1[0];
      const dz = p2[1] - p1[1];
      const len = Math.hypot(dx, dz);
      if (len < 3.5) continue;

      const numBays = Math.max(1, Math.floor(len / 3.2));
      const spacing = len / (numBays + 1);
      const dirX = dx / len;
      const dirZ = dz / len;
      const rotY = Math.atan2(-dirZ, dirX);

      for (let k = 1; k <= numBays; k++) {
        const wx = p1[0] + dirX * k * spacing;
        const wz = p1[1] + dirZ * k * spacing;
        const win = new THREE.Group();

        const f = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 0.12), frameMat);
        const g = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.0), glassMat);
        g.position.z = 0.02;
        win.add(f, g);

        win.position.set(wx, 1.45, wz);
        win.rotation.y = rotY;
        targetGroup.add(win);
      }
    }
  }

  addWindowsAlongPolygon(pts3D, yFloorBase, floorHeight, targetGroup) {
    if (!Array.isArray(pts3D) || pts3D.length < 3) return;

    const winW = 1.34;
    const winH = 1.50;
    const sillY = yFloorBase + 0.85;

    for (let i = 0; i < pts3D.length; i++) {
      const p1 = pts3D[i];
      const p2 = pts3D[(i + 1) % pts3D.length];
      const dx = p2[0] - p1[0];
      const dz = p2[1] - p1[1];
      const len = Math.hypot(dx, dz);
      if (len < 2.5) continue;

      const numWindows = Math.max(1, Math.floor(len / 3.0));
      const spacing = len / (numWindows + 1);
      const dirX = dx / len;
      const dirZ = dz / len;
      const outNx = -dirZ;
      const outNz = dirX;
      const rotY = Math.atan2(outNx, outNz);

      for (let k = 1; k <= numWindows; k++) {
        const distAlong = k * spacing;
        const wx = p1[0] + dirX * distAlong;
        const wz = p1[1] + dirZ * distAlong;
        const wy = sillY;

        const isLit = (k + i) % 3 !== 0;
        const win = this.createRevitWindowComponent(winW, winH, isLit);
        win.position.set(wx, wy, wz);
        win.rotation.y = rotY;
        targetGroup.add(win);
      }
    }
  }
}
