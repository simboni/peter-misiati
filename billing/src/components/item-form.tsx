"use client";

import { useActionState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { saveItemAction, type FormState } from "@/server/actions/items";
import { formatAmount, formatRate } from "@/server/money";
import type { Item } from "@/server/db/schema";

export function ItemForm({ item, defaultVatRateBps }: { item?: Item; defaultVatRateBps: number }) {
  const [state, formAction] = useActionState<FormState, FormData>(saveItemAction, {});

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      {item && <input type="hidden" name="id" value={item.id} />}

      <div>
        <label className="label" htmlFor="name">
          Name *
        </label>
        <input id="name" name="name" className="input" defaultValue={item?.name ?? ""} required />
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          className="input"
          defaultValue={item?.description ?? ""}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="unitPrice">
            Unit price
          </label>
          <input
            id="unitPrice"
            name="unitPrice"
            className="input"
            inputMode="decimal"
            defaultValue={item ? formatAmount(item.unitPrice) : ""}
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="label" htmlFor="unit">
            Unit
          </label>
          <input
            id="unit"
            name="unit"
            className="input"
            defaultValue={item?.unit ?? "unit"}
            placeholder="hour, piece…"
          />
        </div>
        <div>
          <label className="label" htmlFor="taxRate">
            VAT rate (%)
          </label>
          <input
            id="taxRate"
            name="taxRate"
            className="input"
            inputMode="decimal"
            defaultValue={item ? formatRate(item.taxRateBps) : formatRate(defaultVatRateBps)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="kind">
            Type
          </label>
          <select id="kind" name="kind" className="input" defaultValue={item?.kind ?? "service"}>
            <option value="service">Service</option>
            <option value="good">Good / Product</option>
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-ink">
          <input
            type="checkbox"
            name="active"
            defaultChecked={item ? item.active : true}
            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
          />
          Active (available on new documents)
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <SubmitButton>{item ? "Save changes" : "Add item"}</SubmitButton>
        <Link href="/items" className="btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
