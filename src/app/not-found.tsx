import Link from "next/link";
import { Button } from "@/components/ui";
import { ArrowRightIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-grid" aria-hidden />
      <div className="absolute inset-0 glow-bg" aria-hidden />
      <div className="container-page relative flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <p className="font-display text-7xl font-bold text-green-400/30">404</p>
        <h1 className="mt-4 font-display text-3xl font-bold text-mist-100">
          This page has wandered off
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-mist-400">
          The page you’re looking for doesn’t exist or has moved. The mission,
          however, is exactly where you left it.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href="/">
            Back to the homepage
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
          <Link
            href="/programs/"
            className="inline-flex items-center rounded-full border border-ink-500 px-6 py-3 text-sm font-semibold text-mist-200 transition-colors hover:border-green-400"
          >
            Explore our programs
          </Link>
        </div>
      </div>
    </section>
  );
}
