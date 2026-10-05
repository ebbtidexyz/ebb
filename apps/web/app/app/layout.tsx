import type { Metadata } from "next";
import { ConsoleProviders } from "@/components/console/providers";
import { ConsoleShell } from "@/components/console/shell";
import { ConsolePrelaunch } from "@/components/console/prelaunch";
import { PRELAUNCH } from "@/lib/env";

export const metadata: Metadata = { title: { default: "Console", template: "%s · Ebb console" } };

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  if (PRELAUNCH) return <ConsolePrelaunch />;
  return (
    <ConsoleProviders>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProviders>
  );
}
