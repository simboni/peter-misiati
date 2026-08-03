import { SubmitButton } from "@/components/submit-button";
import { setUserRoleAction, setUserDisabledAction } from "@/server/actions/admin";

type Row = {
  id: string;
  name: string;
  email: string;
  workspaces: number;
  isPlatformAdmin: boolean;
  isSuperAdmin: boolean;
  disabled: boolean;
  joined: string;
};

export function UserRow({ user, isSelf }: { user: Row; isSelf: boolean }) {
  const currentRole = user.isSuperAdmin ? "super" : user.isPlatformAdmin ? "admin" : "none";
  return (
    <tr className="border-b border-line last:border-0 align-middle">
      <td className="td">
        <span className="font-semibold text-ink">{user.name}</span>
        {isSelf && <span className="ml-1 badge bg-brand-50 text-brand-700">you</span>}
        {user.disabled && <span className="ml-1 badge bg-red-50 text-red-700">disabled</span>}
        <div className="text-xs text-muted">{user.email}</div>
      </td>
      <td className="td text-right tabular-nums">{user.workspaces}</td>
      <td className="td text-xs text-muted">{user.joined}</td>
      <td className="td">
        <form action={setUserRoleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <select name="role" defaultValue={currentRole} className="input !w-auto py-1 text-xs">
            <option value="none">Vendor</option>
            <option value="admin">Admin</option>
            <option value="super">Super admin</option>
          </select>
          <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
        </form>
      </td>
      <td className="td text-right">
        {!isSelf && (
          <form action={setUserDisabledAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="disabled" value={user.disabled ? "false" : "true"} />
            <SubmitButton className={user.disabled ? "btn-ghost btn-sm" : "btn-danger btn-sm"}>
              {user.disabled ? "Enable" : "Disable"}
            </SubmitButton>
          </form>
        )}
      </td>
    </tr>
  );
}
