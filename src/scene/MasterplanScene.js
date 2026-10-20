import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MaterialLibrary } from './MaterialLibrary.js';
import { HotelBuildingBuilder } from './HotelBuildingBuilder.js';
import { Piso2InteriorBuilder } from './Piso2InteriorBuilder.js';
import { RoomHighlighter } from './RoomHighlighter.js';
import { store } from '../state/store.js';
import { SkyEnvironment } from './SkyEnvironment.js';
import { PostFX } from './PostFX.js';
import { CityContext } from './CityContext.js';

export class MasterplanScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    // Cielo procedural tipo Unreal (Sky Atmosphere + Volumetric Clouds): ver SkyEnvironment
    this.scene.fog = new THREE.Fog(0xc9d6e4, 220, 1400);
    this.clock = new THREE.Clock();

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.5,
      90000
    );
    this.camera.position.set(34, 20, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03; // don't go below ground
    this.controls.minDistance = 5;
    this.controls.maxDistance = 1800;
    this.controls.target.set(16, 4.2, 2);

    this.materials = new MaterialLibrary(this.renderer);
    this.materials.initAll();

    this.buildingBuilder = new HotelBuildingBuilder(this.materials);
    this.interiorBuilder = new Piso2InteriorBuilder(this.materials);
    this.roomHighlighter = new RoomHighlighter(this.scene);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupLighting();
    this.skyEnv = new SkyEnvironment(this.renderer, this.scene, this.sunLight, this.hemiLight);
    // Contexto real de Bogotá: ortofoto, relieve (Cerros Orientales), catastro 3D y arbolado
    try {
      this.city = new CityContext(this.scene, { renderer: this.renderer, mobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) });
      if (this.skyEnv.farGround) this.skyEnv.farGround.visible = false;
    } catch (e) { console.warn('Contexto urbano no disponible', e); }
    try { this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.container); } catch (e) { console.warn('PostFX desactivado', e); }
    this.setupEvents();
    this.animate();
  }

  setupLighting() {
    // Ambient / Skylight dome illumination
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xc8d6e5, 0.55);
    this.hemiLight = hemiLight;
    this.scene.add(hemiLight);

    // Main Sunlight (Bright Bogotá daylight with crisp shadows)
    const sunLight = new THREE.DirectionalLight(0xfffaed, 2.8);
    sunLight.position.set(65, 85, 45);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.normalBias = 0.03;
    sunLight.shadow.radius = 3;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 240;
    sunLight.shadow.camera.left = -65;
    sunLight.shadow.camera.right = 65;
    sunLight.shadow.camera.top = 65;
    sunLight.shadow.camera.bottom = -65;
    sunLight.shadow.bias = -0.0003;
    this.sunLight = sunLight;
    this.scene.add(sunLight);

    // Warm bounce fill light
    const fillLight = new THREE.DirectionalLight(0xe8f0fa, 0.35);
    fillLight.position.set(-50, 40, -40);
    this.scene.add(fillLight);
  }

  async loadData() {
    const [arch, finishes, furn, rooms, catastro, urbanNetwork, revitWindows, roofs] = await Promise.all([
      fetch('./data/geometry/p2-architecture.json').then(r => r.json()),
      fetch('./data/geometry/p2-finishes.json').then(r => r.json()),
      fetch('./data/geometry/p2-furniture.json').then(r => r.json()),
      fetch('./data/rooms-piso2.json').then(r => r.json()),
      fetch('./data/geometry/catastro-buildings-3d.json').then(r => r.json()).catch(() => []),
      fetch('./data/geometry/urban-roads-trees-3d.json').then(r => r.json()).catch(() => ({})),
      fetch('./data/geometry/p2-windows-revit.json').then(r => r.json()).catch(() => []),
      fetch('./data/geometry/hotel-roofs.json').then(r => r.json()).catch(() => null)
    ]);

    // 1. Hotel building exterior + real Catastro urban context + real roads & trees + authentic Revit windows
    //    (los volúmenes blancos del entorno los reemplaza CityContext con el catastro real texturizado)
    const ctxBuildings = this.city ? catastro.filter((b) => b.isHotel) : catastro;
    const building = this.buildingBuilder.build(arch, ctxBuildings, urbanNetwork, revitWindows, roofs);
    if (this.city && this.buildingBuilder.groundPlane) this.buildingBuilder.groundPlane.visible = false;
    this.scene.add(building);

    // 2. Interior Piso 2
    const interior = this.interiorBuilder.build(arch, finishes, furn, rooms);
    this.scene.add(interior);

    // 3. Room highlights
    this.roomHighlighter.build(rooms);

    store.setState({ rooms });
    this.applyViewMode(store.state.viewMode);
  }

  setupEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this.postfx?.setSize(this.container.clientWidth, this.container.clientHeight);
    });

    const onPointerMove = (e) => {
      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Check raycast for room highlights or BIM elements
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const isBimMode = store.state.bimInspectorOpen;

      if (!isBimMode && store.state.showRoomsOverlay) {
        const hits = this.raycaster.intersectObjects(this.roomHighlighter.roomMeshes);
        if (hits.length > 0) {
          const hitRoom = hits[0].object.userData;
          this.roomHighlighter.setHover(hitRoom.roomId);
          this.container.style.cursor = 'pointer';
          this.updateTooltip(e.clientX, e.clientY, `${hitRoom.title} · ${hitRoom.data.areaPrivateM2} m²`);
        } else {
          this.roomHighlighter.setHover(null);
          this.container.style.cursor = 'grab';
          this.hideTooltip();
        }
      }
    };

    const onClick = (e) => {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const isBimMode = store.state.bimInspectorOpen;

      if (isBimMode) {
        // Inspect BIM elements
        const hits = this.raycaster.intersectObjects(this.interiorBuilder.bimElements, true);
        if (hits.length > 0) {
          const hit = hits[0];
          let obj = hit.object;
          while (obj && !obj.userData?.bim && obj.parent) obj = obj.parent;
          if (obj && obj.userData?.bim) {
            store.setState({ selectedBimElement: obj.userData.bim });
          }
        }
      } else if (store.state.showRoomsOverlay) {
        const hits = this.raycaster.intersectObjects(this.roomHighlighter.roomMeshes);
        if (hits.length > 0) {
          const hitRoom = hits[0].object.userData;
          this.selectRoom(hitRoom.roomId);
        }
      }
    };

    this.container.addEventListener('pointermove', onPointerMove);
    this.container.addEventListener('click', onClick);

    // Subscribe to store updates
    store.subscribe((state) => {
      this.roomHighlighter.setVisibility(state.showRoomsOverlay);
      this.roomHighlighter.setSelected(state.selectedRoomId);
      this.applyViewMode(state.viewMode);
    });
  }

  selectRoom(roomId) {
    store.setState({ selectedRoomId: roomId });
    const room = store.rooms?.find(r => r.id === roomId) || store.state.rooms.find(r => r.id === roomId);
    if (!room) return;

    // Fly camera smoothly toward room
    const cx = room.bounds.centerX * 0.001;
    const cz = -room.bounds.centerY * 0.001;

    gsap.to(this.controls.target, {
      x: cx,
      y: 4.5,
      z: cz,
      duration: 1.2,
      ease: 'power2.inOut'
    });

    gsap.to(this.camera.position, {
      x: cx + 24,
      y: 20,
      z: cz + 24,
      duration: 1.2,
      ease: 'power2.inOut'
    });
  }

  applyViewMode(mode) {
    if (mode === 'interior') {
      // Cutaway: hide upper floors and exterior shell of Piso 2
      this.buildingBuilder.upperBuildingGroup.visible = false;
      this.buildingBuilder.exteriorShellPiso2.visible = false;
      gsap.to(this.camera.position, { x: 32, y: 19, z: 28, duration: 1.2, ease: 'power2.inOut' });
      gsap.to(this.controls.target, { x: 16, y: 4.2, z: 2, duration: 1.2, ease: 'power2.inOut' });
    } else if (mode === 'top') {
      this.buildingBuilder.upperBuildingGroup.visible = false;
      this.buildingBuilder.exteriorShellPiso2.visible = false;
      gsap.to(this.camera.position, { x: 16, y: 75, z: 2.1, duration: 1.2, ease: 'power2.inOut' });
      gsap.to(this.controls.target, { x: 16, y: 3.5, z: 2, duration: 1.2, ease: 'power2.inOut' });
    } else {
      // Full exterior 6-story hotel
      this.buildingBuilder.upperBuildingGroup.visible = true;
      this.buildingBuilder.exteriorShellPiso2.visible = true;
      // vista aérea tipo masterplan (el hotel dentro de su barrio, cerros al fondo)
      gsap.to(this.camera.position, { x: -150, y: 135, z: 215, duration: 1.6, ease: 'power2.inOut' });
      gsap.to(this.controls.target, { x: 24, y: 4.0, z: 0, duration: 1.6, ease: 'power2.inOut' });
    }
  }

  updateTooltip(x, y, text) {
    let tip = document.getElementById('room-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'room-tooltip';
      tip.className = 'hover-room-tooltip';
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.left = `${x + 14}px`;
    tip.style.top = `${y + 14}px`;
    tip.classList.add('show');
  }

  hideTooltip() {
    const tip = document.getElementById('room-tooltip');
    if (tip) tip.classList.remove('show');
  }

  /** Plano cercano, niebla y cielo según la distancia de la cámara (de detalle a vista aérea de la ciudad). */
  _updateRange() {
    const cam = this.camera;
    const dist = cam.position.distanceTo(this.controls.target);
    const near = THREE.MathUtils.clamp(dist * 0.012, 0.3, 30);
    if (Math.abs(near - cam.near) > 0.02 * cam.near) { cam.near = near; cam.updateProjectionMatrix(); }
    if (this.scene.fog) {
      this.scene.fog.near = 180 + dist * 0.9;
      this.scene.fog.far = 7000 + dist * 6;
    }
    const s = this.skyEnv;
    if (s) { s.sky?.position.copy(cam.position); s.clouds?.position.copy(cam.position); }
    this._updateProjectTag(dist);
  }

  /** Etiqueta flotante del proyecto (estilo masterplan inmobiliario), visible en vistas aéreas. */
  _updateProjectTag(dist) {
    if (!this._tag) {
      const el = document.createElement('div');
      el.className = 'project-tag';
      el.innerHTML = '<span class="project-tag__pill">Hotel Estelar La Fontana</span><span class="project-tag__stem"></span><span class="project-tag__dot"></span>';
      const css = document.createElement('style');
      css.textContent = `.project-tag{position:fixed;left:0;top:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);transition:opacity .3s;z-index:5}
        .project-tag__pill{background:#d6202e;color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;padding:7px 12px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.35);white-space:nowrap;letter-spacing:.2px}
        .project-tag__stem{width:2px;height:26px;background:rgba(255,255,255,.9)}
        .project-tag__dot{width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid #d6202e}`;
      document.head.appendChild(css);
      document.body.appendChild(el);
      this._tag = el;
      this._tagPos = new THREE.Vector3(18, 26, 2);
    }
    const p = this._tagPos.clone().project(this.camera);
    const show = dist > 140 && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    this._tag.style.opacity = show ? '1' : '0';
    if (show) {
      const r = this.container.getBoundingClientRect();
      this._tag.style.left = `${r.left + (p.x * 0.5 + 0.5) * r.width}px`;
      this._tag.style.top = `${r.top + (-p.y * 0.5 + 0.5) * r.height}px`;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.skyEnv?.update(dt);
    this.buildingBuilder?.update?.(dt);
    this.controls.update();
    this._updateRange();
    if (this.postfx) this.postfx.render(dt); else this.renderer.render(this.scene, this.camera);
  }
}
