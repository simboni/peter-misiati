import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { helpTopic, HELP_TOPICS } from "@/server/support";
import { PageTitle } from "@/components/ui";

export function generateStaticParams() {
  return HELP_TOPICS.map((t) => ({ slug: t.slug }));
}

// `params` is a promise in Next 16 — synchronous access was removed, not just
// deprecated. Typed explicitly rather than via the global `PageProps` helper,
// which only exists once `next typegen` has seen the route.
export default async function HelpTopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, session] = await Promise.all([params, verifySession()]);
  const topic = helpTopic(slug);
  if (!topic) notFound();

  const sw = session.language === "sw";
  const steps = sw ? topic.stepsSw : topic.steps;

  return (
    <main className="mx-auto max-w-2xl p-5">
      <a href="/support" className="mb-4 inline-block text-sm underline text-ink-2">
        ← {sw ? "Msaada" : "Help"}
      </a>
      <PageTitle>{sw ? topic.titleSw : topic.title}</PageTitle>

      {/* Numbered because these genuinely are a sequence — do this, then this. */}
      <ol className="grid gap-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 rounded-lg border border-line bg-surface p-4">
            <span
              aria-hidden
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand text-sm font-semibold text-white"
            >
              {i + 1}
            </span>
            <span className="text-base leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      {topic.audioUrl ? (
        <div className="mt-5 rounded-lg border border-line bg-surface p-4">
          <p className="mb-2 text-sm font-medium">
            {sw ? "Sikiliza badala ya kusoma" : "Listen instead of reading"}
          </p>
          {/* Audio is not a nice-to-have: text is unusable for first-time
              low-literacy users, and vernacular voice notes are the single
              most-praised feature of the leading Kenyan dairy app. */}
          <audio controls src={topic.audioUrl} className="w-full">
            <track kind="captions" />
          </audio>
        </div>
      ) : null}

      <a
        href={topic.screen}
        className="tap mt-6 inline-flex items-center gap-2 rounded-md bg-brand px-5 py-3 font-semibold text-white"
      >
        {sw ? "Nionyeshe" : "Take me there"}
      </a>
    </main>
  );
}
