import { verifySession, can } from "@/lib/dal";
import { listTickets, supportChannels, HELP_TOPICS } from "@/server/support";
import { BackLink, Card, PageTitle, Chip, EmptyState } from "@/components/ui";
import { TicketForm } from "./ticket-form";

export default async function SupportPage() {
  const session = await verifySession();
  const channels = supportChannels();
  const sw = session.language === "sw";
  // Herdsmen see their own help and can ask for it; only managers see the
  // farm's whole ticket list.
  const seesAll = can(session.role, "ADMIN");
  const tickets = seesAll ? await listTickets(session, { limit: 20 }) : [];

  return (
    <main className="mx-auto max-w-2xl p-5">
      <BackLink to="/" />
      <PageTitle sub={channels.responseTime}>
        {sw ? "Msaada" : "Help"}
      </PageTitle>

      {channels.whatsappUrl || channels.phone ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {channels.whatsappUrl ? (
            <a
              href={channels.whatsappUrl}
              className="tap flex items-center gap-3 rounded-lg border border-line bg-surface p-4 hover:border-brand"
            >
              <span aria-hidden className="text-3xl">💬</span>
              <span>
                <span className="block font-semibold">WhatsApp</span>
                <span className="text-sm text-ink-3">{channels.phone}</span>
              </span>
            </a>
          ) : null}
          {channels.phone ? (
            <a
              href={`tel:${channels.phone.replace(/\s/g, "")}`}
              className="tap flex items-center gap-3 rounded-lg border border-line bg-surface p-4 hover:border-brand"
            >
              <span aria-hidden className="text-3xl">📞</span>
              <span>
                <span className="block font-semibold">{sw ? "Piga simu" : "Call us"}</span>
                <span className="text-sm text-ink-3">{channels.phone}</span>
              </span>
            </a>
          ) : null}
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">
          {sw ? "Jinsi ya kufanya" : "How to do things"}
        </h2>
        <ul className="grid gap-2">
          {HELP_TOPICS.map((t) => (
            <li key={t.slug}>
              <a
                href={`/support/${t.slug}`}
                className="tap flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-brand"
              >
                <span className="font-medium">{sw ? t.titleSw : t.title}</span>
                <span aria-hidden className="text-ink-3">→</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">
          {sw ? "Kuna tatizo?" : "Something wrong?"}
        </h2>
        <TicketForm language={session.language} />
      </section>

      {seesAll ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Messages from the farm</h2>
          {tickets.length === 0 ? (
            <EmptyState title="Nothing reported yet." />
          ) : (
            <ul className="grid gap-2">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm">{t.message}</p>
                      <Chip tone={t.status === "OPEN" ? "warn" : "ok"}>
                        {t.status === "OPEN" ? "Open" : "Sorted"}
                      </Chip>
                    </div>
                    <p className="mt-2 text-xs text-ink-3">
                      {t.raisedByName}
                      {t.screen ? ` · on ${t.screen}` : ""}
                      {t.raisedAt ? ` · ${new Date(t.raisedAt).toLocaleDateString("en-KE")}` : ""}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
