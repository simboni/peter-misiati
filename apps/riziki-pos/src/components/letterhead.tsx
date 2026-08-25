import { logoSrc } from "@/lib/brand";

/**
 * The top of every document that leaves the shop.
 *
 * An invoice, a quotation and a statement are three different documents with
 * one letterhead between them, and they had three copies of it — so the logo
 * would have arrived on whichever one was edited and quietly not on the others.
 * One component, three callers.
 *
 * The lockup carries the trading name in its own type, and the registered name
 * still has to be printed under it: the wordmark says RIZIKI CHEMICALS and a
 * KRA-compliant invoice needs whatever the business is actually registered as,
 * which the owner sets in Settings and may not be the same string. So the name
 * is demoted rather than dropped — small and bold under the mark, the way a
 * printed letterhead sets it, instead of competing with it at full size.
 *
 * Without a logo file this renders exactly what it rendered before: the name at
 * full size with the details beneath. `logoSrc` checks the filesystem on the
 * server, so a missing file is a smaller header and never a broken image on a
 * document a customer is holding.
 *
 * Deliberately a plain `<img>`, not `next/image`: this is printed. The
 * optimiser serves a srcset sized for the viewport, and a browser printing to
 * A5 has picked its image long before it knows the paper size — which is how a
 * letterhead ends up crisp on screen and soft on paper.
 */
export function Letterhead({
  business,
  /** "Invoice", "Quotation", "Statement of account" — the right-hand block. */
  kind,
  reference,
  date,
  /** Bigger for a quotation, which is a selling document, not a record. */
  size = "normal",
}: {
  business: { name: string; address?: string; phone?: string; kraPin?: string };
  kind: string;
  reference?: string;
  date?: string;
  size?: "normal" | "large";
}) {
  const logo = logoSrc();
  const logoHeight = size === "large" ? "h-16" : "h-12";

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={business.name}
            className={`${logoHeight} w-auto max-w-[240px] object-contain object-left`}
          />
        ) : null}

        <div
          className={
            logo
              ? "mt-1.5 text-[11px] font-bold tracking-tight"
              : size === "large"
                ? "text-xl font-extrabold tracking-tight text-brand-deep"
                : "text-base font-extrabold tracking-tight"
          }
        >
          {business.name}
        </div>

        {business.address ? (
          <div className="text-[11px] leading-snug text-muted">{business.address}</div>
        ) : null}
        {business.phone ? <div className="text-[11px] text-muted">{business.phone}</div> : null}
        {business.kraPin ? (
          <div className="text-[11px] text-muted">KRA PIN {business.kraPin}</div>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{kind}</div>
        {reference ? (
          <div className={`font-extrabold tnum ${size === "large" ? "text-lg" : "text-base"}`}>
            {reference}
          </div>
        ) : null}
        {date ? <div className="text-[11px] text-muted">{date}</div> : null}
      </div>
    </div>
  );
}
