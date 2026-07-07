"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { saveDeliveryNoteAction, type FormState } from "@/server/actions/delivery-notes";
import type { Client, Item, DeliveryNote } from "@/server/db/schema";

type EditorLine = { key: string; itemId: string; description: string; quantity: string; unit: string };
let c = 0;
const key = () => `d${c++}`;
const toDate = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

export function DeliveryNoteEditor({
  clients,
  items,
  invoices,
  note,
  lines: existing,
}: {
  clients: Pick<Client, "id" | "name">[];
  items: Pick<Item, "id" | "name" | "unit">[];
  invoices: { id: string; number: string }[];
  note?: DeliveryNote;
  lines?: { itemId: string | null; description: string; quantityMilli: number; unit: string }[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveDeliveryNoteAction, {});
  const [rows, setRows] = useState<EditorLine[]>(() =>
    existing && existing.length
      ? existing.map((l) => ({
          key: key(),
          itemId: l.itemId ?? "",
          description: l.description,
          quantity: String(l.quantityMilli / 1000),
          unit: l.unit,
        }))
      : [{ key: key(), itemId: "", description: "", quantity: "1", unit: "unit" }],
  );

  const update = (k: string, patch: Partial<EditorLine>) =>
    setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const pick = (k: string, id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return update(k, { itemId: "" });
    update(k, { itemId: id, description: it.name, unit: it.unit });
  };
  const add = () => setRows((rs) => [...rs, { key: key(), itemId: "", description: "", quantity: "1", unit: "unit" }]);
  const remove = (k: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== k) : rs));

  const linesJson = JSON.stringify(
    rows.map((r) => ({ itemId: r.itemId || null, description: r.description, quantity: r.quantity, unit: r.unit })),
  );

  return (
    <form action={formAction} className="space-y-6">
      {note && <input type="hidden" name="id" value={note.id} />}
      <input type="hidden" name="lines" value={linesJson} />

      <section className="card grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="clientId">
            Client *
          </label>
          <select id="clientId" name="clientId" className="input" defaultValue={note?.clientId ?? ""} required>
            <option value="" disabled>
              Choose a client…
            </option>
            {clients.map((cl) => (
              <option key={cl.id} value={cl.id}>
                {cl.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="deliveryDate">
            Delivery date
          </label>
          <input
            id="deliveryDate"
            name="deliveryDate"
            type="date"
            className="input"
            defaultValue={toDate(note?.deliveryDate)}
          />
        </div>
        <div>
          <label className="label" htmlFor="invoiceId">
            Linked invoice (optional)
          </label>
          <select id="invoiceId" name="invoiceId" className="input" defaultValue={note?.invoiceId ?? ""}>
            <option value="">— none —</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.number}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" className="input" defaultValue={note?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="delivered">Delivered</option>
          </select>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="border-b border-line bg-canvas">
              <tr>
                <th className="th">Item / description</th>
                <th className="th w-28 text-right">Quantity</th>
                <th className="th w-28">Unit</th>
                <th className="th w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <td className="td">
                    {items.length > 0 && (
                      <select
                        className="input mb-1 text-xs"
                        value={r.itemId}
                        onChange={(e) => pick(r.key, e.target.value)}
                      >
                        <option value="">— pick a saved item —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      className="input"
                      placeholder="Description"
                      value={r.description}
                      onChange={(e) => update(r.key, { description: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input text-right"
                      inputMode="decimal"
                      value={r.quantity}
                      onChange={(e) => update(r.key, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input"
                      value={r.unit}
                      onChange={(e) => update(r.key, { unit: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <button
                      type="button"
                      onClick={() => remove(r.key)}
                      className="text-muted hover:text-red-600"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line p-3">
          <button type="button" onClick={add} className="btn-ghost btn-sm">
            + Add line
          </button>
        </div>
      </section>

      <section className="card grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="receivedBy">
            Received by (name)
          </label>
          <input id="receivedBy" name="receivedBy" className="input" defaultValue={note?.receivedBy ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <input id="notes" name="notes" className="input" defaultValue={note?.notes ?? ""} />
        </div>
      </section>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="flex gap-3">
        <SubmitButton>{note ? "Save delivery note" : "Create delivery note"}</SubmitButton>
        <Link href="/delivery-notes" className="btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
