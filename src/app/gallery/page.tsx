import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Section } from "@/components/ui";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Moments from the life and mission of the Canossian Sisters across the North East Africa Province.",
};

const photos = [
  { src: "/images/sisters-arusha.jpg", alt: "Sisters gathered in Arusha", span: "lg:col-span-2 lg:row-span-2" },
  { src: "/images/education.jpg", alt: "A Sister teaching young learners", span: "" },
  { src: "/images/healthcare.jpg", alt: "Pastoral healthcare ministry", span: "" },
  { src: "/images/evangelization.jpg", alt: "Evangelization in Mwanza", span: "lg:col-span-2" },
  { src: "/images/church-1.jpg", alt: "A place of prayer", span: "" },
  { src: "/images/education-class.jpg", alt: "Early-years classroom", span: "" },
  { src: "/images/evangelization-bukoba.jpg", alt: "Community ministry in Bukoba", span: "" },
  { src: "/images/church-2.jpg", alt: "Retreat and recollection", span: "" },
  { src: "/images/daughters.jpg", alt: "Canossian Daughters of Charity", span: "" },
] as const;

export default function GalleryPage() {
  return (
    <>
      <PageHero
        crumb="Gallery"
        eyebrow="In pictures"
        title="Moments from the mission"
        intro="Glimpses of the Sisters at work and at prayer across Tanzania, Kenya, Uganda and Sudan."
      />
      <Section className="bg-cream-50">
        <div className="grid auto-rows-[13rem] grid-cols-2 gap-4 sm:auto-rows-[15rem] lg:grid-cols-4">
          {photos.map((p, i) => (
            <Reveal
              key={p.src + i}
              delay={(i % 4) * 60}
              variant="scale"
              className={`group relative overflow-hidden rounded-2xl border border-line ${p.span}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-900/55 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <span className="absolute bottom-3 left-4 right-4 translate-y-2 text-sm font-medium text-cream-50 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                {p.alt}
              </span>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
