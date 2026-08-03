import { verifySession } from "@/lib/dal";
import { can } from "@/lib/dal";
import { TaskTile } from "@/components/ui";
import { signOut } from "@/server/auth";

/**
 * Home.
 *
 * A flat grid of task tiles and nothing else. No hamburger menu, no nested
 * tabs, maximum two levels deep anywhere in the app — the HCI literature on
 * low-literacy and novice users is unambiguous that menu hierarchy is where
 * these users get lost, and the SARAL guidelines say flatten it.
 *
 * Every tile carries a figurative icon, a word and a fixed position, so the
 * screen is navigable with the text ignored entirely.
 */
export default async function HomePage() {
  const session = await verifySession();
  const money = can(session.role, "VIEW_MONEY");
  const admin = can(session.role, "ADMIN");
  const first = session.fullName.split(" ")[0];

  return (
    <main className="mx-auto max-w-3xl p-5">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Habari, {first}</h1>
          <p className="text-sm text-ink-2">What are you recording?</p>
        </div>
        <form action={signOut}>
          <button className="text-sm underline text-ink-2">Not you?</button>
        </form>
      </header>

      <nav className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Capture — what a herdsman opens twice a day, first and largest. */}
        <TaskTile href="/milk" icon="🥛" label="Milk" detail="Record a milking" />
        <TaskTile href="/feed" icon="🌾" label="Feed" detail="Issue and stock" />
        <TaskTile href="/health" icon="💉" label="Health" detail="Treat and dip" />
        <TaskTile href="/breeding" icon="♥" label="Breeding" detail="Heat and service" />
        <TaskTile href="/herd" icon="🐄" label="Herd" detail="Every animal" />
        <TaskTile href="/sales/round" icon="🛵" label="Delivery" detail="Today's round" />

        {money ? (
          <>
            <TaskTile href="/sales" icon="🧾" label="Sales" detail="Where the milk went" />
            <TaskTile href="/money" icon="💰" label="Money" detail="In and out" />
            <TaskTile href="/reports" icon="📊" label="Reports" detail="How the farm is doing" />
          </>
        ) : null}

        {admin ? (
          <>
            <TaskTile href="/people" icon="👥" label="People" detail="Staff and pay" />
            <TaskTile href="/trading" icon="🔁" label="Buy & sell" detail="Animals" />
          </>
        ) : null}

        <TaskTile href="/support" icon="💬" label="Help" detail="Ask a question" />
      </nav>
    </main>
  );
}
