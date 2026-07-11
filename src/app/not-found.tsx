import { Button } from "@/components/ui";
import { LeafIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <section className="relative overflow-hidden wash-green">
      <div className="container-page flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-forest-100 text-forest-600">
          <LeafIcon className="h-8 w-8" />
        </span>
        <div className="mt-6 font-display text-7xl font-extrabold text-forest-600 sm:text-8xl">
          404
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold text-ink-900 text-balance sm:text-4xl">
          This page took a wrong turn
        </h1>
        <p className="mt-4 max-w-md text-ink-500">
          The link may be broken or the page may have moved. Let&rsquo;s get you
          back to solid ground.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href="/" variant="primary" size="lg" withArrow>
            Back home
          </Button>
          <Button href="/programs" variant="outline" size="lg">
            Our programmes
          </Button>
        </div>
      </div>
    </section>
  );
}
