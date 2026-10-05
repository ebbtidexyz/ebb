"use client";

import { SoundingsEquation } from "@/components/landing/soundings-equation";
import { PageHead } from "@/components/console/ui";

export default function SoundingsPage() {
  return (
    <>
      <PageHead
        kicker="Console · soundings"
        title="Soundings"
        lede="The Basin's USDG balance, read from the chain on every request, against everything the books say it holds: open credits, used-but-unsettled requests, booked credit not yet granted, and expired credit waiting for the Trench. The difference should always be zero."
      />
      <SoundingsEquation />
      <div className="mt-8 grid gap-4 text-[13.5px] leading-relaxed text-mist md:grid-cols-2 xl:grid-cols-3">
        <p>
          <strong className="text-foam">Left side.</strong> <code className="font-mono text-[12px] text-foam">usdg.balanceOf(EbbVault)</code> at the block shown.
          Nobody can move it except through the contract&apos;s four exits.
        </p>
        <p>
          <strong className="text-foam">Open credits.</strong> The sum of every unexpired tidepool on every dashboard, the same number your console shows
          for you.
        </p>
        <p>
          <strong className="text-foam">Used, not yet settled.</strong> Requests already served and owed to providers; paid at the next hourly
          settlement with a usage root.
        </p>
        <p>
          <strong className="text-foam">Booked, not yet granted.</strong> USDG harvested into a tide whose grants are not committed yet, or left over
          after rounding. It floods with the tide.
        </p>
        <p>
          <strong className="text-foam">Awaiting the Trench.</strong> Credit past hour 168 that has not been burned yet. Anyone can call burnExpired() for
          it and collect the tip.
        </p>
        <p>
          <strong className="text-foam">Difference.</strong> Reported by the API from all of the above, never recomputed in the browser. Anything other
          than zero is shown with a warning.
        </p>
      </div>
    </>
  );
}
