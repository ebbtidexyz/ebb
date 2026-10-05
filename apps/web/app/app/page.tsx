"use client";

import Link from "next/link";
import { useMe, useStats } from "@/lib/queries";
import { genesisFromStats } from "@/lib/tide";
import { compact, tokenNum, usd } from "@/lib/format";
import { TIERS } from "@ebb/shared";
import { TideGauge } from "@/components/landing/tide-gauge";
import { SessionGate } from "@/components/console/session";
import { PageHead, Panel, TierBadge, Kv } from "@/components/console/ui";
import { PoolList } from "@/components/console/pools";
import { IconArrowRight } from "@/components/site/icons";

export default function OverviewPage() {
  return (
    <>
      <PageHead kicker="Console · overview" title="Your tidepools" lede="Credit from every tide, oldest first, each counting down to the Trench." />
      <SessionGate what="your tidepools">
        <Overview />
      </SessionGate>
    </>
  );
}

function Overview() {
  const me = useMe().data!;
  const stats = useStats();
  const tier = TIERS.find((t) => t.id === me.tier?.toLowerCase());
  const pools = me.pools ?? [];
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-3">
          <Figure label="Spendable credit" value={usd(me.credit)} sub={`${pools.length} open pool${pools.length === 1 ? "" : "s"}`} />
          <Figure label="$EBB held" value={compact(tokenNum(me.ebb_balance), 2)} sub={<TierBadge tier={me.tier} />} />
          <Figure label="Limits" value={tier ? `${tier.rpm}/min` : "—"} sub={tier ? `${tier.concurrent} concurrent` : "per depth tier"} />
        </div>
        <Panel title="Tidepools · oldest first" aside={<span className="font-mono text-[11px] text-mist">7-day ebb</span>} pad={false}>
          <PoolList pools={pools} />
        </Panel>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/keys" className="btn btn-brass btn-sm">
            Create a key <IconArrowRight size={14} />
          </Link>
          <Link href="/app/playground" className="btn btn-ghost btn-sm">
            Try the playground
          </Link>
        </div>
      </div>
      <div className="space-y-6">
        <Panel title="Next flood">
          <TideGauge genesis={genesisFromStats(stats.data)} size={260} compact />
          <p className="mt-3 text-center text-[13px] text-mist">Grants for the tide now running land at the next :00 or :30 UTC.</p>
        </Panel>
        <Panel title="Wallet">
          <dl>
            <Kv k="Address" v={me.addr} />
            <Kv k="Tier" v={<TierBadge tier={me.tier} />} />
            <Kv k="Keys" v={String(me.keys?.filter((k) => !k.revoked_at).length ?? 0)} />
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="bg-abyss px-5 py-5">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 font-display text-[2rem] leading-none text-foam tnum" style={{ fontVariationSettings: '"opsz" 72' }}>
        {value}
      </div>
      <div className="mt-2 text-[12.5px] text-mist">{sub}</div>
    </div>
  );
}
