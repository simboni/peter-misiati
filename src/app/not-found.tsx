import { Button } from "@/components/ui";
import { Mark } from "@/components/logo";
import { ArrowUpRightIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <section className="relative overflow-hidden bg-cream-100 glow-warm">
      <div className="container-page flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
        <Mark className="h-16 w-14" />
        <div className="mt-6 font-display text-6xl font-semibold text-terra-600 sm:text-7xl">404</div>
        <h1 className="mt-4 font-display text-3xl font-semibold text-ink-900 sm:text-4xl">
          This page could not be found
        </h1>
        <p className="mt-4 max-w-md text-ink-600">
          The link may be broken or the page may have moved. Let us guide you back to the
          mission.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href="/" variant="primary" size="lg" withArrow>
            Back home
          </Button>
          <Button href="/ministries" variant="outline" size="lg">
            <ArrowUpRightIcon className="h-4 w-4" /> Our ministries
          </Button>
        </div>
      </div>
    </section>
  );
}
