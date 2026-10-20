import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * PostFX — Cadena de posproceso tipo "cinematic" (equivalente a Post Process Volume de Unreal):
 *  · MSAA 4x en el render target.
 *  · GTAO (Ground-Truth Ambient Occlusion): oclusión de contacto en esquinas, aleros,
 *    ventanas, bordillos y bajo los carros — es lo que más quita el aspecto "videojuego".
 *  · Bloom suave solo en luces muy brillantes (faroles, semáforos, sol en vidrios).
 *  · Gradación de color: curva fílmica, saturación contenida, balance cálido y viñeta.
 *  · Tone mapping AgX (rango dinámico realista, sin colores quemados).
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.06 },
    uSaturation: { value: 0.9 },
    uWarm: { value: new THREE.Vector3(1.02, 1.0, 0.975) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.012 },
    uTime: { value: 0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast, uSaturation, uVignette, uGrain, uTime; uniform vec3 uWarm;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWarm;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;          // contraste alrededor del gris medio (lineal)
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain * (0.3 + l);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`
};

export class PostFX {
  constructor(renderer, scene, camera, container) {
    this.renderer = renderer;
    const w = container.clientWidth, h = container.clientHeight;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;

    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));

    if (!mobile) {
      this.ao = new GTAOPass(scene, camera, w, h);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 2.0, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.ao);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.45, 0.92);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    if (this.ao) this.ao.setSize(w, h);
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
