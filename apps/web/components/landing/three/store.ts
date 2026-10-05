/* Shared, mutable state for the one WebGL stage. Sections tween these plain
   objects with GSAP (show, rotations, sink…); the engine reads them every
   frame. No React state: nothing here re-renders anything. */

export type ModelName = "nautilus" | "compass" | "buoy";

export interface ModelState {
  /** DOM element the model is centred on and sized to (its width). */
  anchor: HTMLElement | null;
  /** 0..1 presence; 0 hides the model. */
  show: number;
  /** extra rotation, radians */
  rx: number;
  ry: number;
  rz: number;
  /** pointer parallax, radians (quickTo targets) */
  px: number;
  py: number;
  /** vertical offset in anchor heights (+ = down) */
  sink: number;
  /** horizontal offset in anchor widths */
  drift: number;
  /** scale multiplier on top of the anchor size */
  scale: number;
  /** idle float amplitude in anchor heights, and bob speed */
  float: number;
  bob: number;
  /** idle yaw swing about Y, radians (slow sine) */
  spin: number;
  /** a second, scroll-driven layer (so intro tweens and scrubbed tweens never fight) */
  ry2: number;
  sink2: number;
  scale2: number;
  show2: number;
}

function model(partial: Partial<ModelState> = {}): ModelState {
  return { anchor: null, show: 0, rx: 0, ry: 0, rz: 0, px: 0, py: 0, sink: 0, drift: 0, scale: 1, float: 0.025, bob: 0.6, spin: 0, ry2: 0, sink2: 0, scale2: 1, show2: 1, ...partial };
}

export const stage = {
  models: {
    nautilus: model({ float: 0.03, spin: 0.38 }),
    compass: model({ float: 0.015, rx: 1.05 }),
    buoy: model({ float: 0.06, bob: 1.1 }),
  } as Record<ModelName, ModelState>,
  /** 0..1 load progress per model (nautilus drives the preloader) */
  progress: { nautilus: 0, compass: 0, buoy: 0 } as Record<ModelName, number>,
  loaded: { nautilus: false, compass: false, buoy: false } as Record<ModelName, boolean>,
  /** set when WebGL is unavailable or the nautilus failed: the preloader stops waiting */
  failed: false,
  listeners: new Set<() => void>(),
  emit() {
    stage.listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    stage.listeners.add(fn);
    return () => {
      stage.listeners.delete(fn);
    };
  },
};

/** Restore defaults (called when the landing unmounts). */
export function resetStage() {
  Object.assign(stage.models.nautilus, model({ float: 0.03, spin: 0.38 }));
  Object.assign(stage.models.compass, model({ float: 0.015, rx: 1.05 }));
  Object.assign(stage.models.buoy, model({ float: 0.06, bob: 1.1 }));
  stage.progress = { nautilus: 0, compass: 0, buoy: 0 };
  stage.loaded = { nautilus: false, compass: false, buoy: false };
  stage.failed = false;
}
