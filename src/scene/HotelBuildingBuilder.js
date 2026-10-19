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

  build(architectureData, catastroBuildings = []) {
    const mainFootprint = architectureData.slabLoops?.[0]?.loops?.[0] || [
      [24840, 3760], [31226, -2626], [28800, -5052], [28800, -11000],
      [32800, -15250], [38900, -15250], [49125, -5025], [29450, 14650],
      [3200, 14650], [3200, 12300], [-14000, 12300], [-14000, 3800]
    ];

    this.buildUrbanContext(catastroBuildings);
    this.buildHotelMassing(mainFootprint);
    return this.rootGroup;
  }

  buildUrbanContext(catastroBuildings) {
    const contextArchMat = this.materials.get('CONTEXT_ARCH');
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35
    });

    const brickMat = this.materials.get('BRICK_FACADE');
    const stoneMat = this.materials.get('REF28');
    const slateMat = this.materials.get('ROOF_SLATE');

    // 1. Ground plane (Bogotá Usaquén base)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(16, -0.1, 8);
    ground.receiveShadow = true;
    this.contextGroup.add(ground);

    // 2. Real Bogotá Catastro Buildings from const.gpkg
    if (Array.isArray(catastroBuildings) && catastroBuildings.length > 0) {
      for (const b of catastroBuildings) {
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
            // Other wings of Hotel La Fontana complex: Rendered with architectural hotel finish
            const mesh = new THREE.Mesh(geo, [brickMat, slateMat]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.upperBuildingGroup.add(mesh);
          } else {
            // Surrounding Bogotá buildings: Sleek Umbra3D frosted architectural massing
            const mesh = new THREE.Mesh(geo, contextArchMat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.contextGroup.add(mesh);

            // Subtle crisp white wireframe edges (Umbra3D signature)
            if (height > 6.0) {
              const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
              this.contextGroup.add(edges);
            }
          }
        } catch (e) {
          // Skip invalid polygon
        }
      }
    }

    // 3. Hotel Courtyard & Gardens
    const gardenMat = new THREE.MeshStandardMaterial({
      color: 0x3d6635,
      roughness: 0.88
    });
    const gardenPad = new THREE.Mesh(new THREE.BoxGeometry(64, 0.08, 52), gardenMat);
    gardenPad.position.set(18, -0.04, 2);
    gardenPad.receiveShadow = true;
    this.contextGroup.add(gardenPad);

    // Central Plazoleta & Fountain
    const courtyard = new THREE.Mesh(new THREE.BoxGeometry(24, 0.12, 20), stoneMat);
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

    // 4. Clean Architectural Streets (Calle 124, Av. Calle 127, Cra 15, Cra 15A)
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.88 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xd4d8e0 });

    const roads = [
      { x: 16, z: -32, w: 220, d: 13, label: 'Calle 124' },
      { x: 16, z: 46, w: 220, d: 16, label: 'Av. Calle 127' },
      { x: -44, z: 6, w: 14, d: 180, label: 'Carrera 15A' },
      { x: 78, z: 6, w: 16, d: 180, label: 'Av. Carrera 15' }
    ];

    for (const r of roads) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.08, r.d), roadMat);
      road.position.set(r.x, -0.02, r.z);
      road.receiveShadow = true;
      this.contextGroup.add(road);

      const isHoriz = r.w > r.d;
      const steps = Math.floor((isHoriz ? r.w : r.d) / 7);
      for (let i = -steps / 2; i < steps / 2; i++) {
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(isHoriz ? 3.0 : 0.25, 0.1, isHoriz ? 0.25 : 3.0),
          lineMat
        );
        dash.position.set(
          isHoriz ? r.x + i * 7 : r.x,
          0.02,
          isHoriz ? r.z : r.z + i * 7
        );
        this.contextGroup.add(dash);
      }
    }

    // 5. Stylized Architectural Trees
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d3024, roughness: 0.92 });
    const crownMat1 = new THREE.MeshStandardMaterial({ color: 0x2e5c2b, roughness: 0.85 });
    const crownMat2 = new THREE.MeshStandardMaterial({ color: 0x3e7339, roughness: 0.82 });

    const treePositions = [
      [-16, -22], [-6, -22], [6, -22], [18, -22], [28, -22],
      [-26, 22], [-14, 24], [4, 25], [18, 25], [32, 24], [46, 22],
      [64, -16], [66, 0], [64, 18], [-32, -6], [-32, 12],
      [10, 4], [22, 5], [12, -4], [24, -3]
    ];

    for (let i = 0; i < treePositions.length; i++) {
      const [tx, tz] = treePositions[i];
      const tree = new THREE.Group();
      const s = 0.85 + (i % 3) * 0.18;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 2.4 * s, 8), trunkMat);
      trunk.position.y = 1.2 * s;
      trunk.castShadow = true;

      const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7 * s, 1), i % 2 === 0 ? crownMat1 : crownMat2);
      c1.position.y = 3.1 * s;
      c1.castShadow = true;

      tree.add(trunk, c1);
      tree.position.set(tx, 0, tz);
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
    const roofMesh = new THREE.Mesh(roofGeo, [slateMat, slateMat]);
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
