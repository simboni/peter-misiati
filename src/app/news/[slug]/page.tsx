import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { articles, getArticle, site } from "@/lib/keysa";
import { Button, Chip, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ArrowRightIcon, HeartIcon } from "@/components/icons";

export function generateStaticParams() {
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: "Article not found" };
  return {
    title: article.title,
    description: article.excerpt,
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    author: { "@type": "Person", name: article.author },
    datePublished: article.isoDate,
    publisher: { "@type": "NGO", name: site.name, url: site.url },
    description: article.excerpt,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <section className="relative overflow-hidden border-b border-ink-600 bg-ink-850">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 glow-bg" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <div className="hero-stagger mx-auto max-w-3xl text-center">
            <Eyebrow className="justify-center">From our founder</Eyebrow>
            <h1 className="font-display text-3xl font-bold tracking-tight text-mist-100 sm:text-5xl text-balance">
              {article.title}
            </h1>
            <p className="mt-5 text-sm font-medium text-mist-500">
              By <span className="text-mist-200">{article.author}</span> ·{" "}
              {article.authorRole} · {article.date}
            </p>
            <div className="mx-auto mt-6 max-w-40">
              <div className="tricolor" aria-hidden />
            </div>
          </div>
        </div>
      </section>

      <article className="py-16 sm:py-20">
        <div className="container-page">
          <div className="prose-ngo mx-auto max-w-2xl text-base text-mist-300">
            {article.body.map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
            <p className="!mb-0 border-t border-ink-600 pt-6 text-sm font-semibold text-mist-500">
              — {article.author}, {article.authorRole}, {site.shortName}
            </p>
          </div>
        </div>
      </article>

      <section className="border-t border-ink-600 bg-ink-850 py-14">
        <div className="container-page">
          <Reveal>
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
              <Chip tone="green">Put these words to work</Chip>
              <h2 className="font-display text-2xl font-bold text-mist-100 text-balance">
                Education draws out what’s already within. Help us reach the youth
                waiting for that chance.
              </h2>
              <div className="flex flex-wrap justify-center gap-3">
                <Button href="/donate/" variant="donate">
                  <HeartIcon className="h-4 w-4" />
                  Donate
                </Button>
                <Button href="/programs/education/" variant="ghost">
                  Our education program
                  <ArrowRightIcon className="h-4 w-4" />
                </Button>
              </div>
              <Link
                href="/news/"
                className="text-sm font-medium text-mist-500 transition-colors hover:text-mist-100"
              >
                ← All news & stories
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
