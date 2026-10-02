import TargetCursor from "@/components/TargetCursor";
import ClickSpark from "@/components/ClickSpark";
import { useEffect, useState } from "react";
import { CursorZones, Fx } from "@/components/landing/site/primitives";
import { Grain } from "@/components/landing/site/texture";
import { Hero, SiteNav } from "@/components/landing/site/hero";
import { Context } from "@/components/landing/site/context";
import { HowItWorks } from "@/components/landing/site/how";
import { Features } from "@/components/landing/site/features";
import { ClosingCTA, FAQ, Footer } from "@/components/landing/site/closing";

export default function Landing() {
  // The bracket cursor shows only inside cursor zones; the system cursor stays everywhere else.
  const [inZone, setInZone] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [cursorEnabled, setCursorEnabled] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => {
      setMotionEnabled(query.matches);
      setCursorEnabled(query.matches && pointer.matches);
    };
    update();
    query.addEventListener("change", update);
    pointer.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
      pointer.removeEventListener("change", update);
    };
  }, []);
  const zones = { enter: () => setInZone(true), leave: () => setInZone(false) };
  return (
    <Fx.Provider value={motionEnabled}>
      <CursorZones.Provider value={zones}>
        <div className="relative min-h-screen overflow-x-clip bg-landing-page font-sans text-landing-ink antialiased">
          {cursorEnabled && (
            <TargetCursor
              targetSelector=".cursor-target"
              cursorColor="#F4F4F5"
              cursorColorOnTarget="#0C64FF"
              spinDuration={3}
              hideDefaultCursor={false}
              visible={inZone}
            />
          )}
          <ClickSpark
            sparkColor="#0C64FF"
            sparkSize={9}
            sparkRadius={18}
            sparkCount={motionEnabled ? 8 : 0}
            duration={420}
          >
            <Grain alpha={10} />
            <div className="relative">
              <SiteNav />
              <main id="main-content">
                <Hero />
                <Context />
                <HowItWorks />
                <Features />
                <FAQ />
                <ClosingCTA />
              </main>
              <Footer />
            </div>
          </ClickSpark>
        </div>
      </CursorZones.Provider>
    </Fx.Provider>
  );
}
