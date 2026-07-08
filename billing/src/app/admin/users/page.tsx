export const dynamic = "force-dynamic";
import { requireSuperAdmin } from "@/server/admin";
import { listUsers } from "@/server/admin-queries";
import { fmtDate } from "@/server/queries";
import { UserRow } from "@/components/admin/user-row";

export const metadata = { title: "Users & admins · Admin" };

export default async function AdminUsers() {
  const { db, user } = await requireSuperAdmin();
  const users = await listUsers(db);
  const adminCount = users.filter((u) => u.isPlatformAdmin || u.isSuperAdmin).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Users &amp; admins</h1>
        <p className="text-sm text-muted">
          {users.length} users · {adminCount} with admin access. Only super-admins can change roles.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th">User</th>
              <th className="th text-right">Workspaces</th>
              <th className="th">Joined</th>
              <th className="th">Role</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={{
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  workspaces: u.workspaces,
                  isPlatformAdmin: u.isPlatformAdmin,
                  isSuperAdmin: u.isSuperAdmin,
                  disabled: u.disabled,
                  joined: fmtDate(u.createdAt),
                }}
                isSelf={u.id === user.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
