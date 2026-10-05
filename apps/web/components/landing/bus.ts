/* "The hero may start": fired by the preloader when the water line has swept
   up (or at once on repeat visits and with reduced motion). */
const listeners = new Set<() => void>();
let ready = false;

export function onLandingReady(fn: () => void): () => void {
  if (ready) {
    fn();
    return () => {};
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function markLandingReady() {
  if (ready) return;
  ready = true;
  const ls = [...listeners];
  listeners.clear();
  ls.forEach((l) => l());
}

export function isLandingReady() {
  return ready;
}

/** Called when the landing unmounts, so the next visit waits again. */
export function resetLanding() {
  ready = false;
  listeners.clear();
}

/** sessionStorage key: the preloader has played in this session. */
export const PRELOADER_SEEN = "ebb-preloaded";

/** Runs in <head> before paint: hides the preloader on repeat visits in a session. */
export const preloaderSeenScript = `try{if(sessionStorage.getItem('${PRELOADER_SEEN}'))document.documentElement.classList.add('ebb-seen')}catch(e){}`;
