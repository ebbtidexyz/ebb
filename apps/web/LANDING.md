# Landing — motion & art direction

The landing (`/`) is the showpiece. Reference bar: GSAP showcase sites (A24 by Ravi Klaassens — 3D objects driven by scroll; Unseen Studio — preloader + enter gate; Revelatio — editorial type reveals). Content, numbers and vocabulary come from `/SPEC.md` §1, §2, §6.2. Read SPEC first.

## Stack
- `gsap` 3.15 (all plugins are free and ship in the `gsap` package): **ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, ScrambleTextPlugin, Flip, Draggable, InertiaPlugin, Observer, CustomEase, TextPlugin**. Use `@gsap/react` is NOT installed — write a tiny `useGsap(scopeRef, fn, deps)` hook around `gsap.context()` + revert on unmount.
- `three` 0.186 with `GLTFLoader`. The GLBs are **meshopt-compressed with WebP textures** (~0.7–1 MB each): call `loader.setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`. Models are not centered/scaled consistently — normalize each with a `Box3` (center at origin, fit to unit size) after load. Use `RoomEnvironment` for PBR reflections, ACES tone mapping, sRGB output. One shared WebGL canvas fixed behind the content (`position: fixed; inset: 0; pointer-events: none; z-index: 0`) rendering whichever model is "on stage"; ScrollTrigger timelines drive model transforms. Pause rendering when tab hidden; cap DPR at 1.75; lazy-load models after first paint.
- All landing code lives in `components/landing/**` as client components; `app/page.tsx` composes them. Register plugins once in `lib/gsap.ts` (client only).

## Assets (`public/media`, `public/models`)
| file | use |
|---|---|
| `sea-loop.mp4` / `.webm` / `sea-poster.jpg` | hero background video, seamless 6.5 s loop, muted autoplay playsinline |
| `hero-moon.jpg` | fallback / reduced-motion hero, also footer |
| `chart.jpg` | nautical chart texture: section backgrounds at 6–12 % opacity, parallax |
| `tidepool.jpg` (4:5) | "Ebb" section, the water level mask |
| `trench.jpg` | "The Trench" section, zoom-into-abyss scrub |
| `lighthouse.jpg` | "Bulkheads" section, beam sweep overlay |
| `logbook.jpg` | "Logbook / Soundings" section |
| `models/nautilus.glb` | hero object: glossy ivory shell with burnt-orange bands (the spiral = time); the star of the page |
| `models/compass.glb` | polished brass gimbal compass ring; "Current" loop centerpiece + "Charted course" |
| `models/buoy.glb` | weathered red/cream buoy with brass lamp; "Depth" tiers, bobs on a sine |
Use `next/image` for stills (priority on hero poster), `sizes` set properly.

## Global motion system
- **ScrollSmoother** (`smooth: 1.1, effects: true, smoothTouch: 0.1`) wrapping the landing (`#smooth-wrapper > #smooth-content`). Fixed elements (nav, canvas, cursor) live OUTSIDE the wrapper.
- **CustomEase** named `tide` = `"M0,0 C0.25,0.1 0.25,1 1,1"` and `ebb` = `"M0,0 C0.5,0 0.1,1 1,1"`; use everywhere instead of defaults.
- **Text**: every section heading uses SplitText (`type: "lines,words,chars", mask: "lines"`) rising from below the mask on enter (stagger 0.02, ease `tide`). Eyebrows/numerals use ScrambleText with chars `"0123456789·~≈"`.
- **Cursor**: brass ring (24 px) following with `gsap.quickTo` (x/y, 0.35 s), grows over links/buttons, magnetic pull on primary CTAs (±12 px). Hidden on touch.
- **Velocity**: a thin marquee of live figures under the hero whose speed and skew follow `ScrollTrigger` velocity (clamped).
- **Section index**: a fixed left rail with Roman numerals I–XI; the active one is brass, progress line fills with scroll (scrub).
- **prefers-reduced-motion**: `gsap.matchMedia()` — no smoother, no pins, no scrub; content simply visible; the 3D canvas renders one static frame.
- **Mobile (< 768px)**: keep SplitText + simple reveals; pinned sequences become stacked cards; 3D canvas at lower DPR, only the nautilus.

## Sequence, section by section
0. **Preloader** (first visit per session): full-screen abyss; a brass tide-gauge ring draws with DrawSVG while a counter ScrambleTexts 000 → 100 tied to real asset loading (video canplay + nautilus GLB progress). On complete, the ring morphs (MorphSVG) into the compass-rose mark, then a water line sweeps up (clip-path `inset()` tween) revealing the hero. Then an "Enter" is NOT required — go straight in.
1. **Hero** (pinned 150 vh): video background with a slow scale 1.08 → 1 on load; nautilus floats center-right, slow idle rotation + mouse parallax (quickTo on rotation). Headline "Spend it, or the tide takes it." via SplitText chars rising from a water-line mask. Live tide gauge (UTC clock, tide #, countdown) top-right with ScrambleText ticking. CA box + CTAs. On scroll out: nautilus rotates 180°, scales down and sinks while the video darkens and the headline lines drift up at different speeds (`data-speed`).
2. **Marquee** of live counters (granted all-time · burned · current tide · chain head) — velocity-reactive.
3. **I · Undertow**: the leak. Big number "82–87%" counts up (snap 1) when in view. "Two roads" diagram: SVG fork; DrawSVG draws the left road (pay out → sell pressure, coral) then the right (burn → buy pressure, kelp) on scrub. Them-vs-Ebb table rows stagger in; the trust row ("an immutable contract, not a wallet") gets a brass highlight sweep.
4. **II · Current** (pinned, ~300 vh): circular chart with 8 stations (Inflow → Basin → Split → Tide → Flood → Spend → Ebb → Trench). A glowing droplet travels the ring with MotionPathPlugin, scrubbed; each station lights and its caption card swaps (Flip) as the droplet passes. The compass model sits at the ring's center, its needle (model rotation Y) pointing at the active station. Clickable stations jump scroll to that progress (ScrollSmoother.scrollTo).
5. **III · Ebb** (pinned 250 vh): the tidepool image inside a rounded frame; an SVG water layer whose level falls with scrub from hour 0 → 168. A readout (ScrambleText) shows hour, $ spendable, $ spent on AI, $ bought+burned. Kelp-colored ticks for spending events appear along the way; at 168 the remaining water drains coral down into a narrow "Trench" slot. Also Draggable handle for manual scrubbing (with InertiaPlugin), synced to the same timeline (`tl.progress()`). Four facts (FIFO, not transferable, not cash, not revivable) reveal as cards.
6. **IV · Tide tables**: four Draggable rotary dials (volume, your $EBB, eligible supply %, spend share) with Inertia + snapping to detents; changing any dial re-"prints" the almanac strip — rows roll in via Flip, figures ScrambleText to their new values. Math exactly per SPEC §1 (1.7% of volume to vault, 70/30, pro-rata by share of eligible supply, 48 tides/day).
7. **V · The Trench** (pinned 200 vh): `trench.jpg` scales 1 → 1.6 with scrub while a vignette closes in (camera descends). Over it, the `burnExpired` code block types line by line (TextPlugin) and each step lights: swap USDG→ETH→$EBB → `burn()` → `totalSupply` drops → tip. Three pipes as SVG pipes drawn with DrawSVG. Burned-so-far counter.
8. **VI · Depth**: a vertical sounding line (DrawSVG on scrub) down the left with tier marks Shore · Reef · Shelf · Abyss at proportional depths (log scale); the buoy model bobs at the surface (sine yoyo) and its tether lengthens to the selected tier. "Try a bag" slider (Draggable, horizontal) moves a lead weight down the line; the tier card updates with Flip.
9. **VII · Charts**: sankey for $100k — every flow path draws (DrawSVG) in order with labels counting up; the spend-share slider reflows widths (attr tween on stroke-width). Treasury split 35/20/15/20/10 as a ring whose segments draw sequentially.
10. **VIII · Hull** (horizontal scroll): pin the section and translate a track of 3 panels (Chain · Our servers · Outside) horizontally (`containerAnimation`). Inside, arrows draw with DrawSVG as their panel enters, labels ScrambleText. Mobile: vertical list.
11. **IX · Bulkheads**: `lighthouse.jpg` with an SVG beam (conic gradient wedge) rotating with scroll (scrub) that "illuminates" invariant cards I1–I8 as it passes (card opacity tied to beam angle). Attack/defence table rows reveal.
12. **X · Logbook & Soundings**: `logbook.jpg` parallax; live reserve equation `vault USDG = open credits` from `/api/soundings` — the two numbers ScrambleText in, the `=` sign draws; a "read on-chain" badge with block number. Latest 5 logbook rows slide in.
13. **XI · Charted course**: horizontal route on the chart texture; a small ship glyph follows a MotionPath along a dotted route through 5 phase waypoints as you scroll; each waypoint expands its card.
14. **Footer**: giant "EBB" wordmark with chars on a sine wave (stagger from center, repeat yoyo, very slow) masked by the moon image; links; disclaimer.

## Performance & quality gates
- Lighthouse-ish: LCP is the hero poster image; video `preload="metadata"`; models loaded after LCP; no layout shift from SplitText (set `aria-label` on the original element, `aria-hidden` on split chars or use `SplitText` with `aria: "auto"`).
- Kill every ScrollTrigger/context on route change (`ctx.revert()`); `ScrollTrigger.refresh()` after fonts + images load.
- No horizontal page scroll at 375 px. 60 fps target: animate transforms/opacity only (and SVG attrs where needed).
- Test: desktop 1440, laptop 1280, tablet 768, phone 375; dark + light; reduced motion.
