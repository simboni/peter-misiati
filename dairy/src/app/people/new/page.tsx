import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { createEmployeeAction, FARM_ROLES, roleLabel } from "@/server/people";
import { EmployeeForm } from "@/components/people/people-forms";
import { BackLink, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  await verifySession();

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <BackLink to="/people" label="People" />
      <PageTitle sub="A name, a job and a start date is enough. The paperwork can follow.">
        Add someone
      </PageTitle>

      <EmployeeForm
        action={createEmployeeAction}
        roles={FARM_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
        today={today()}
      />
    </main>
  );
}
