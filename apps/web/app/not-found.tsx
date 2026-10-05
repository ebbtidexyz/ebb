import Link from "next/link";
import { CompassRose } from "@/components/site/compass";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <CompassRose size={56} />
      <p className="eyebrow mt-6">Uncharted · 404</p>
      <h1 className="mt-3 font-display text-4xl text-foam">No soundings at this position.</h1>
      <p className="mt-3 max-w-md text-mist">The page you were steering for is not on the chart.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn btn-brass">Back to the chart</Link>
        <Link href="/docs" className="btn btn-ghost">Docs</Link>
      </div>
    </main>
  );
}
