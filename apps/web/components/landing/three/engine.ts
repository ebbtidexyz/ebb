/* The single WebGL stage. Loaded with a dynamic import so three.js never sits
   in the landing's first JS. One renderer, one scene, three models; each model
   is pinned to a DOM anchor (centre + size) and dressed by the shared store. */
import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { stage, type ModelName } from "./store";

const FILES: Record<ModelName, string> = {
  nautilus: "/models/nautilus.glb",
  compass: "/models/compass.glb",
  buoy: "/models/buoy.glb",
};

/** Resting orientation per model so it reads well from the front. */
const BASE: Record<ModelName, { rx: number; ry: number; rz: number }> = {
  nautilus: { rx: 0.12, ry: -0.42, rz: -0.08 },
  compass: { rx: 0, ry: 0, rz: 0 },
  buoy: { rx: 0.08, ry: 0.4, rz: 0 },
};

interface Slot {
  pivot: Group; // position, scale, tilt
  spinner: Group; // rotation about Y
  materials: Material[];
}

export interface Engine {
  load(name: ModelName): Promise<void>;
  frame(t: number): void;
  resize(): void;
  dispose(): void;
}

const FOV = 30;
const CAM_Z = 12;

export function createEngine(canvas: HTMLCanvasElement, opts: { mobile: boolean; reduced: boolean }): Engine | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: !opts.mobile, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.62;

  // warm brass key, cool moonlit rim, a low sea-and-sky fill
  const key = new DirectionalLight(0xffc27a, 2.1);
  key.position.set(4, 5, 6);
  const rim = new DirectionalLight(0x7fb2ff, 3.4);
  rim.position.set(-5, 1.8, -5);
  const rim2 = new DirectionalLight(0x9cc8ff, 1.2);
  rim2.position.set(5, -2, -4);
  const fill = new HemisphereLight(0xb8c9d6, 0x07131f, 0.35);
  scene.add(key, rim, rim2, fill);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const slots: Partial<Record<ModelName, Slot>> = {};
  const pending: Partial<Record<ModelName, Promise<void>>> = {};
  let w = 1;
  let h = 1;
  let worldPerPx = 1;
  let disposed = false;
  let lastSig = "";
  let drewSomething = false;

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.mobile ? 1.25 : 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    worldPerPx = (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * CAM_Z) / h;
    lastSig = "";
  }
  resize();

  function load(name: ModelName): Promise<void> {
    if (pending[name]) return pending[name]!;
    const p = new Promise<void>((resolve, reject) => {
      loader.load(
        FILES[name],
        async (gltf) => {
          if (disposed) return resolve();
          const model = gltf.scene;
          // normalise: centre at origin, largest side = 1 unit
          const box = new Box3().setFromObject(model);
          const size = box.getSize(new Vector3());
          const centre = box.getCenter(new Vector3());
          model.position.sub(centre);
          const wrap = new Group();
          wrap.add(model);
          wrap.scale.setScalar(1 / Math.max(size.x, size.y, size.z));

          const materials: Material[] = [];
          model.traverse((o: Object3D) => {
            const m = o as Mesh;
            if (!m.isMesh) return;
            const mats = (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[];
            for (const mat of mats) {
              // opaque by default: Meshy base-colour alpha at UV seams makes jagged silhouettes when blended
              mat.transparent = false;
              mat.alphaTest = 0;
              mat.depthWrite = true;
              if ("envMapIntensity" in mat) mat.envMapIntensity = name === "compass" ? 1.25 : 1;
              materials.push(mat);
            }
          });

          const spinner = new Group();
          spinner.add(wrap);
          const pivot = new Group();
          pivot.add(spinner);
          pivot.visible = true;
          scene.add(pivot);
          slots[name] = { pivot, spinner, materials };
          // upload textures and compile programs before the model is ever shown
          try {
            pivot.scale.setScalar(0.0001);
            await renderer.compileAsync(scene, camera);
          } catch {}
          pivot.visible = false;
          stage.progress[name] = 1;
          stage.loaded[name] = true;
          stage.emit();
          resolve();
        },
        (e) => {
          if (e.total) {
            stage.progress[name] = Math.min(0.95, (e.loaded / e.total) * 0.95);
            stage.emit();
          }
        },
        (err) => {
          stage.progress[name] = 1;
          if (name === "nautilus") stage.failed = true;
          stage.emit();
          reject(err);
        },
      );
    });
    pending[name] = p;
    return p;
  }

  function frame(t: number) {
    if (disposed) return;
    let any = false;
    let sig = "";
    for (const name of Object.keys(slots) as ModelName[]) {
      const slot = slots[name]!;
      const s = stage.models[name];
      const a = s.anchor;
      const show = s.show * s.show2;
      if (!a || show < 0.004) {
        slot.pivot.visible = false;
        continue;
      }
      const r = a.getBoundingClientRect();
      if (r.width === 0 || r.bottom < -h * 0.6 || r.top > h * 1.6) {
        slot.pivot.visible = false;
        continue;
      }
      any = true;
      const motion = !opts.reduced;
      const base = BASE[name];
      const fit = Math.min(r.width, r.height || r.width);
      const floatY = motion ? Math.sin(t * s.bob) * s.float * fit : 0;
      const cx = r.left + r.width / 2 + s.drift * r.width;
      const cy = r.top + r.height / 2 + (s.sink + s.sink2) * r.height + floatY;
      slot.pivot.visible = true;
      slot.pivot.position.set((cx - w / 2) * worldPerPx, -(cy - h / 2) * worldPerPx, 0);
      const sc = fit * worldPerPx * s.scale * s.scale2 * (0.86 + 0.14 * show);
      slot.pivot.scale.setScalar(Math.max(0.0001, sc));
      const sway = motion ? Math.sin(t * s.bob * 0.7 + 1.3) * 0.05 : 0;
      slot.pivot.rotation.set(base.rx + s.rx + s.py + (name === "buoy" ? sway * 0.6 : 0), 0, base.rz + s.rz + (name === "buoy" ? sway : 0));
      slot.spinner.rotation.y = base.ry + s.ry + s.ry2 + s.px + (motion ? Math.sin(t * 0.32) * s.spin : 0);
      const fading = show < 0.995;
      for (const m of slot.materials) {
        if (m.transparent !== fading) {
          m.transparent = fading;
          m.needsUpdate = true;
        }
        m.opacity = fading ? show : 1;
      }
      if (opts.reduced) sig += `${name}:${cx.toFixed(1)},${cy.toFixed(1)},${sc.toFixed(4)},${show.toFixed(3)},${(s.ry + s.ry2 + s.rx).toFixed(3)}|`;
    }
    if (!any) {
      // clear once after the last model leaves, then idle
      if (drewSomething) {
        renderer.render(scene, camera);
        drewSomething = false;
      }
      return;
    }
    if (opts.reduced) {
      if (sig === lastSig) return;
      lastSig = sig;
    }
    renderer.render(scene, camera);
    drewSomething = true;
  }

  function dispose() {
    disposed = true;
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          Object.values(mat).forEach((v) => {
            if (v && typeof v === "object" && "isTexture" in v) (v as { dispose(): void }).dispose();
          });
          mat.dispose();
        });
      }
    });
    envRT.dispose();
    pmrem.dispose();
    renderer.dispose();
  }

  return { load, frame, resize, dispose };
}
