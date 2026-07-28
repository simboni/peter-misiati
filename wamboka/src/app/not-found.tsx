import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start px-5 py-24">
      <p className="font-mono text-xs tracking-[0.2em] text-green-600 uppercase">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-ink-100">
        That page is not on the record
      </h1>
      <p className="mt-3 text-ink-400">
        The entry you are looking for does not exist — or has not been sourced yet.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-green-400 px-5 py-2.5 text-sm font-medium text-on-accent transition hover:bg-green-500"
      >
        Back to the overview
      </Link>
    </div>
  );
}
