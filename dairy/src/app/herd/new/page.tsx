import { verifySession } from "@/lib/dal";
import { listHerd, registerAnimal } from "@/server/herd";
import { BackLink, PageTitle } from "@/components/ui";
import { AnimalForm, type ParentOption } from "@/components/herd/animal-form";
import { today } from "@/lib/domain/dates";

export const dynamic = "force-dynamic";

/**
 * The Server Action is defined in `@/server/herd` and passed DOWN as a prop, so
 * the client bundle never imports a module that touches the database.
 */
export default async function NewAnimalPage() {
  const session = await verifySession();
  const list = await listHerd(session, { includeExited: true });

  const label = (r: { name: string | null; tag: string }) =>
    r.name ? `${r.name} (${r.tag})` : r.tag;

  const dams: ParentOption[] = list.rows
    .filter((r) => r.sex === "F")
    .map((r) => ({ id: r.id, label: label(r) }));
  const sires: ParentOption[] = list.rows
    .filter((r) => r.sex === "M")
    .map((r) => ({ id: r.id, label: label(r) }));

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <BackLink to="/herd" label="The herd" />
      <PageTitle sub="Two things must be filled in. Everything else can wait.">
        Add an animal
      </PageTitle>

      <AnimalForm action={registerAnimal} dams={dams} sires={sires} today={today()} />
    </main>
  );
}
