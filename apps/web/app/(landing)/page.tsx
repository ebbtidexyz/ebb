import { Hero, HeroBackdrop } from "@/components/landing/hero";
import { Marquee } from "@/components/landing/marquee";
import { Undertow } from "@/components/landing/undertow";
import { Current } from "@/components/landing/current";
import { EbbScrubber } from "@/components/landing/ebb-scrubber";
import { TideTables } from "@/components/landing/tide-tables";
import { Trench } from "@/components/landing/trench";
import { Depth } from "@/components/landing/depth";
import { Charts } from "@/components/landing/charts";
import { Hull } from "@/components/landing/hull";
import { Bulkheads } from "@/components/landing/bulkheads";
import { Soundings } from "@/components/landing/soundings";
import { Course } from "@/components/landing/course";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { Preloader } from "@/components/landing/preloader";
import { Cursor, SectionRail, SmoothInit } from "@/components/landing/motion";
import { Stage } from "@/components/landing/three/stage";

/* The landing. Order matters: SmoothInit is the first sibling so its layout
   effect creates the ScrollSmoother before any section builds a ScrollTrigger.
   Everything fixed (backdrop, WebGL stage, nav, rail, cursor, preloader) lives
   outside #smooth-wrapper. */
export default function Home() {
  return (
    <>
      <noscript>
        <style>{"[data-preloader]{display:none!important}"}</style>
      </noscript>
      <SmoothInit />
      <Preloader />
      <HeroBackdrop />
      <Stage />
      <LandingNav />
      <SectionRail />
      <Cursor />
      <div id="smooth-wrapper">
        <div id="smooth-content">
          <main id="main">
            <Hero />
            <Marquee />
            <Undertow />
            <Current />
            <EbbScrubber />
            <TideTables />
            <Trench />
            <Depth />
            <Charts />
            <Hull />
            <Bulkheads />
            <Soundings />
            <Course />
          </main>
          <LandingFooter />
        </div>
      </div>
    </>
  );
}
