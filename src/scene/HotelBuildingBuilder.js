import * as THREE from 'three';

const MM_TO_M = 0.001;

/**
 * Converts a 2D Revit polygon loop ([[x_mm, y_mm], ...]) into a THREE.Shape
 * Note: Revit (X, Y) maps to Three.js (X = x*0.001, Z = -y*0.001).
 * When extruding along +Z and rotating X by -PI/2, shape (x, y) maps to world (x, -y) in (X, Z),
 * so shape(x_m, y_m) rotated -PI/2 around X gives world (x_m, height, -y_m)!
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

export class HotelBuildingBuilder {
  constructor(materials) {
    this.materials = materials;
    this.rootGroup = new THREE.Group();
    this.lowerBuildingGroup = new THREE.Group();
    this.upperBuildingGroup = new THREE.Group(); // Floors 3-6 + Roof (fades/lifts in Piso 2 cutaway mode)
    this.exteriorShellPiso2 = new THREE.Group(); // Exterior brick skin of Piso 2
    this.contextGroup = new THREE.Group();

    this.rootGroup.add(this.contextGroup);
    this.rootGroup.add(this.lowerBuildingGroup);
    this.rootGroup.add(this.exteriorShellPiso2);
    this.rootGroup.add(this.upperBuildingGroup);
  }

  build(architectureData) {
    const mainFootprint = architectureData.slabLoops?.[0]?.loops?.[0] || [
      [24840, 3760], [31226, -2626], [28800, -5052], [28800, -11000],
      [32800, -15250], [38900, -15250], [49125, -5025], [29450, 14650],
      [3200, 14650], [3200, 12300], [-14000, 12300], [-14000, 3800]
    ];

    this.buildUrbanContext();
    this.buildHotelMassing(mainFootprint);
    return this.rootGroup;
  }

  buildHotelMassing(footprintMm) {
    const shape = loopToShape(footprintMm);
    const brickMat = this.materials.get('BRICK_FACADE');
    const stoneMat = this.materials.get('REF28');
    const windowMat = this.materials.get('WINDOW_EXT');
    const darkMetalMat = this.materials.get('ACERO');
    const slateMat = this.materials.get('ROOF_SLATE');
    const ivyMat = this.materials.get('IVY');

    // 1. Piso 1 (Ground floor / Lobby / Porte-cochère, Y = 0 to 3.0m)
    const p1Geo = new THREE.ExtrudeGeometry(shape, { depth: 2.95, bevelEnabled: false });
    p1Geo.rotateX(-Math.PI / 2);
    const p1Mesh = new THREE.Mesh(p1Geo, [stoneMat, brickMat]);
    p1Mesh.castShadow = true;
    p1Mesh.receiveShadow = true;
    this.lowerBuildingGroup.add(p1Mesh);

    // Cornice band between Piso 1 & Piso 2 (Y = 2.88m to 3.04m)
    const corniceGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.06, bevelSegments: 1 });
    corniceGeo.rotateX(-Math.PI / 2);
    const cornice1 = new THREE.Mesh(corniceGeo, stoneMat);
    cornice1.position.y = 2.88;
    this.lowerBuildingGroup.add(cornice1);

    // 2. Piso 2 Exterior Brick Shell (shown in Exterior view; hidden in Interior Cutaway view so real interior walls shine)
    const p2ShellGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.92, bevelEnabled: false });
    p2ShellGeo.rotateX(-Math.PI / 2);
    const p2ShellMesh = new THREE.Mesh(p2ShellGeo, [stoneMat, brickMat]);
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
      const floorMesh = new THREE.Mesh(floorGeo, [stoneMat, brickMat]);
      floorMesh.position.y = yBase;
      floorMesh.castShadow = true;
      floorMesh.receiveShadow = true;
      this.upperBuildingGroup.add(floorMesh);

      // Stone slab band
      const bandMesh = new THREE.Mesh(corniceGeo, stoneMat);
      bandMesh.position.y = yBase + 2.86;
      this.upperBuildingGroup.add(bandMesh);

      // Windows on every floor
      this.addFacadeWindowsAlongFootprint(footprintMm, yBase, 2.88, this.upperBuildingGroup, windowMat, darkMetalMat);
    }

    // 4. Mansard / Roof Crown & Mechanical Penthouse (Y = 18.0m to 20.4m)
    const roofGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.65,
      bevelEnabled: true,
      bevelSize: -0.45,
      bevelThickness: 0.85,
      bevelSegments: 2
    });
    roofGeo.rotateX(-Math.PI / 2);
    const roofMesh = new THREE.Mesh(roofGeo, [stoneMat, slateMat]);
    roofMesh.position.y = 18.05;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.upperBuildingGroup.add(roofMesh);

    // Rooftop mechanical / elevator cores (like in Centrum screenshot)
    const corePositions = [
      [-8.0, 8.5, 4.5, 4.2],
      [4.5, 8.5, 4.0, 3.8],
      [28.0, 9.2, 5.2, 4.6],
      [37.5, -2.5, 4.8, 4.4],
      [35.0, -11.5, 5.0, 4.2]
    ];
    for (const [cx, cz, w, d] of corePositions) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), darkMetalMat);
      box.position.set(cx, 20.2, -cz);
      box.castShadow = true;
      this.upperBuildingGroup.add(box);
    }

    // Lush Ivy Planter Boxes along Piso 1-2 facade
    const planterPositions = [
      [-5.0, 3.5, 16.0, 1.2],
      [18.0, -6.5, 10.0, 1.4],
      [35.5, -15.6, 8.0, 1.2]
    ];
    for (const [px, py, w, d] of planterPositions) {
      const planter = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), ivyMat);
      planter.position.set(px, 0.55, -py);
      planter.castShadow = true;
      this.lowerBuildingGroup.add(planter);
    }
  }

  addFacadeWindowsAlongFootprint(footprintMm, yBase, floorHeight, targetGroup, windowMat, frameMat) {
    const winHeight = 1.65;
    const winWidth = 1.45;
    const sillOffset = 0.72;

    for (let i = 0; i < footprintMm.length; i++) {
      const [x1, y1] = footprintMm[i];
      const [x2, y2] = footprintMm[(i + 1) % footprintMm.length];
      const p1 = new THREE.Vector2(x1 * MM_TO_M, -y1 * MM_TO_M);
      const p2 = new THREE.Vector2(x2 * MM_TO_M, -y2 * MM_TO_M);
      const segLen = p1.distanceTo(p2);
      if (segLen < 3.2) continue;

      const count = Math.floor(segLen / 3.4);
      const dir = p2.clone().sub(p1).normalize();
      const normal = new THREE.Vector2(dir.y, -dir.x); // outward normal in XZ
      const angle = Math.atan2(-dir.y, dir.x);

      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const pos2D = p1.clone().lerp(p2, t).addScaledVector(normal, 0.06);

        const winGroup = new THREE.Group();
        winGroup.position.set(pos2D.x, yBase + sillOffset + winHeight / 2, pos2D.y);
        winGroup.rotation.y = angle;

        const glass = new THREE.Mesh(new THREE.BoxGeometry(winWidth, winHeight, 0.08), windowMat);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(winWidth + 0.14, winHeight + 0.14, 0.05), frameMat);
        winGroup.add(frame, glass);
        targetGroup.add(winGroup);
      }
    }
  }

  buildUrbanContext() {
    const ivyMat = this.materials.get('IVY');
    const brickMat = this.materials.get('BRICK_FACADE');
    const stoneMat = this.materials.get('REF28');
    const darkMetalMat = this.materials.get('ACERO');

    // Ground plane (Usaquén / Santa Bárbara urban block)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c322b, roughness: 0.92 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(16, -0.08, 0);
    ground.receiveShadow = true;
    this.contextGroup.add(ground);

    // Hotel Courtyard & Gardens ( lush green grass + ivy )
    const gardenMat = new THREE.MeshStandardMaterial({
      map: this.materials.getTexture('./assets/textures/hlf_hiedra.png', 14, 14, true),
      color: 0x6ea15a,
      roughness: 0.88
    });
    const gardenPad = new THREE.Mesh(new THREE.BoxGeometry(92, 0.12, 68), gardenMat);
    gardenPad.position.set(17, -0.02, 2);
    gardenPad.receiveShadow = true;
    this.contextGroup.add(gardenPad);

    // Central Courtyard Plazoleta (Stone paths & fountain)
    const courtyard = new THREE.Mesh(new THREE.BoxGeometry(28, 0.16, 22), stoneMat);
    courtyard.position.set(14, 0.02, 2);
    courtyard.receiveShadow = true;
    this.contextGroup.add(courtyard);

    const fountainRim = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.55, 24), stoneMat);
    fountainRim.position.set(14, 0.28, 2);
    const fountainWater = new THREE.Mesh(
      new THREE.CylinderGeometry(3.0, 3.0, 0.45, 24),
      new THREE.MeshStandardMaterial({ color: 0x2986cc, roughness: 0.12, metalness: 0.25 })
    );
    fountainWater.position.set(14, 0.32, 2);
    this.contextGroup.add(fountainRim, fountainWater);

    // Streets around Hotel La Fontana (Calle 124, Av. 127, Cra 15, Cra 15A)
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x383c42, roughness: 0.85 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe6e8ec });

    const roads = [
      { x: 16, z: -26, w: 140, d: 11, label: 'Calle 124' },
      { x: 16, z: 32, w: 140, d: 14, label: 'Av. Calle 127' },
      { x: -32, z: 2, w: 12, d: 120, label: 'Carrera 15A' },
      { x: 66, z: 2, w: 14, d: 120, label: 'Av. Carrera 15' }
    ];

    for (const r of roads) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.1, r.d), roadMat);
      road.position.set(r.x, -0.01, r.z);
      road.receiveShadow = true;
      this.contextGroup.add(road);

      // Dashed road markings
      const isHoriz = r.w > r.d;
      const steps = Math.floor((isHoriz ? r.w : r.d) / 6);
      for (let i = -steps / 2; i < steps / 2; i++) {
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(isHoriz ? 2.6 : 0.22, 0.12, isHoriz ? 0.22 : 2.6),
          lineMat
        );
        dash.position.set(
          isHoriz ? r.x + i * 6 : r.x,
          0.01,
          isHoriz ? r.z : r.z + i * 6
        );
        this.contextGroup.add(dash);
      }
    }

    // Surrounding Context Buildings (combining textured brick neighbors + white translucent Umbra3D context blocks)
    const ghostMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef2f7,
      transparent: true,
      opacity: 0.62,
      roughness: 0.25,
      metalness: 0.05
    });
    const ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });

    const neighborBuildings = [
      // Immediate brick & stone buildings (like in Centrum screenshot)
      { x: -54, z: -8, w: 22, d: 34, h: 28, style: 'brick' },
      { x: -54, z: 28, w: 24, d: 24, h: 34, style: 'brick' },
      { x: 88, z: -6, w: 24, d: 38, h: 32, style: 'brick' },
      { x: 88, z: 32, w: 26, d: 26, h: 38, style: 'brick' },
      // Unicentro Mall & Santa Bárbara translucent white context blocks (Umbra3D signature look)
      { x: -18, z: -56, w: 54, d: 28, h: 16, style: 'ghost' }, // Unicentro commercial volume
      { x: 42, z: -56, w: 42, d: 26, h: 22, style: 'ghost' },
      { x: -12, z: 62, w: 34, d: 22, h: 42, style: 'ghost' },
      { x: 32, z: 62, w: 32, d: 22, h: 46, style: 'ghost' },
      { x: 78, z: -52, w: 26, d: 24, h: 36, style: 'ghost' },
      { x: -62, z: -52, w: 28, d: 26, h: 30, style: 'ghost' }
    ];

    for (const b of neighborBuildings) {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mat = b.style === 'brick' ? [brickMat, brickMat, darkMetalMat, darkMetalMat, brickMat, brickMat] : ghostMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.contextGroup.add(mesh);

      if (b.style === 'ghost') {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), ghostEdgeMat);
        edges.position.copy(mesh.position);
        this.contextGroup.add(edges);
      }
    }

    // Lush 3D Trees around the hotel & streets
    const treeCoords = [
      [-18, -18], [-8, -19], [4, -19], [16, -18], [26, -19],
      [-22, 16], [-10, 18], [4, 19], [18, 19], [30, 19], [44, 16],
      [54, -12], [55, 2], [54, 14], [-22, -4], [-22, 8],
      [10, 3], [19, 4], [14, -4], [22, -2]
    ];
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x523a28, roughness: 0.9 });
    const crownMat1 = new THREE.MeshStandardMaterial({ color: 0x3b6e38, roughness: 0.85 });
    const crownMat2 = new THREE.MeshStandardMaterial({ color: 0x4d8446, roughness: 0.82 });

    for (let i = 0; i < treeCoords.length; i++) {
      const [tx, tz] = treeCoords[i];
      const tree = new THREE.Group();
      const scale = 0.85 + (i % 4) * 0.16;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.34 * scale, 2.6 * scale, 8), trunkMat);
      trunk.position.y = 1.3 * scale;
      trunk.castShadow = true;

      const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.9 * scale, 1), i % 2 === 0 ? crownMat1 : crownMat2);
      c1.position.y = 3.4 * scale;
      c1.castShadow = true;

      const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.35 * scale, 1), crownMat2);
      c2.position.set(0.6 * scale, 4.3 * scale, 0.4 * scale);
      c2.castShadow = true;

      tree.add(trunk, c1, c2);
      tree.position.set(tx, 0, tz);
      this.contextGroup.add(tree);
    }

    // Stylized Cars on Calle 124 and Cra 15 (like in Centrum screenshot)
    const carColors = [0x1c1e22, 0xd8dce2, 0x242830, 0x8e1b22, 0xf2f4f8];
    const carSpots = [
      [-14, -24.2, 0], [4, -24.2, 0], [28, -27.8, Math.PI],
      [-8, 30.2, 0], [22, 33.8, Math.PI], [64.2, -10, Math.PI / 2], [67.8, 12, -Math.PI / 2]
    ];
    carSpots.forEach(([cx, cz, rot], idx) => {
      const car = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({
        color: carColors[idx % carColors.length],
        roughness: 0.25,
        metalness: 0.6
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.75, 1.85), bodyMat);
      base.position.y = 0.55;
      base.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 1.55), bodyMat);
      cabin.position.set(-0.2, 1.15, 0);
      car.add(base, cabin);
      car.position.set(cx, 0, cz);
      car.rotation.y = rot;
      this.contextGroup.add(car);
    });
  }
}
