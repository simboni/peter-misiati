import { redirect } from "next/navigation";
import { currentUser, grantedTo } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { MoreMenu } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <PageTitle title="More" subtitle="Everything that isn't a counter task" />
      <MoreMenu isOwner={user.role === "owner"} granted={grantedTo(user)} />
    </div>
  );
}
