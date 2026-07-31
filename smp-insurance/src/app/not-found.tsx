import Link from "next/link";
import { Container, btnPrimary, btnOutline } from "@/components/ui";
import { ArrowRightIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <section className="py-24 sm:py-32">
      <Container className="max-w-xl text-center">
        <p className="font-display text-6xl font-extrabold text-navy-200">404</p>
        <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
          This page isn&apos;t covered
        </h1>
        <p className="mt-3 text-slate-500">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
          Luckily, everything important is one click away.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className={btnOutline}>
            Back home
          </Link>
          <Link href="/quote/" className={btnPrimary}>
            Get a quote <ArrowRightIcon className="h-5 w-5" />
          </Link>
        </div>
      </Container>
    </section>
  );
}
