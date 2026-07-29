import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { articles, projects } from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { Chip } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ArrowRightIcon, CalendarIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "News & Stories",
  description:
    "Updates, reflections and stories from the Kenya Youth Support Association — including writing from our founders and milestones from our projects.",
};

export default function NewsPage() {
  const completedProjects = projects.filter((p) => p.status === "Completed");

  return (
    <>
      <PageHero
        eyebrow="News & stories"
        title="Voices and milestones from KEYSA"
        lede="Reflections from our founders, milestones from the field, and the thinking behind our programs."
      />

      <section className="py-16 sm:py-20">
        <div className="container-page">
          <div className="grid gap-5 md:grid-cols-2">
            {articles.map((article, i) => (
              <Reveal key={article.slug} delay={i * 80}>
                <Link
                  href={`/news/${article.slug}/`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50"
                >
                  {article.image && (
                    <Image
                      src={article.image.src}
                      alt={article.image.alt}
                      width={800}
                      height={450}
                      className="aspect-video w-full border-b border-ink-600 object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-7">
                  <div className="flex items-center gap-2">
                    <Chip tone="green">{article.tag}</Chip>
                    <span className="inline-flex items-center gap-1.5 text-xs text-mist-500">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {article.date}
                    </span>
                  </div>
                  <h2 className="mt-4 font-display text-xl font-bold text-mist-100 group-hover:text-green-300">
                    {article.title}
                  </h2>
                  <p className="mt-2 text-sm font-medium text-mist-500">
                    By {article.author} · {article.authorRole}
                  </p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-mist-400">
                    {article.excerpt}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                    Read more
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                  </div>
                </Link>
              </Reveal>
            ))}

            {completedProjects.map((project, i) => (
              <Reveal key={project.slug} delay={(articles.length + i) * 80}>
                <Link
                  href={`/projects/${project.slug}/`}
                  className="group flex h-full flex-col rounded-2xl border border-ink-600 bg-ink-800 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50"
                >
                  <div className="flex items-center gap-2">
                    <Chip tone="green">Milestone</Chip>
                    <span className="inline-flex items-center gap-1.5 text-xs text-mist-500">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {project.duration}
                    </span>
                  </div>
                  <h2 className="mt-4 font-display text-xl font-bold text-mist-100 group-hover:text-green-300">
                    {project.title}
                  </h2>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-mist-400">
                    {project.summary}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                    See the project
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
