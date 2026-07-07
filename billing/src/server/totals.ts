import { mulDiv, allocateProportional } from "./money";

// ---------------------------------------------------------------------------
// The single source of truth for invoice/quotation arithmetic.
// All inputs/outputs are integers (minor units, thousandths, basis points).
// VAT is applied to the discounted line base, so mixed exempt/standard lines
// and a global discount all reconcile to the cent.
// ---------------------------------------------------------------------------

export type LineInput = {
  quantityMilli: number; // thousandths
  unitPrice: number; // minor units
  taxRateBps: number; // basis points (0 = exempt/zero-rated)
};

export type LineTotals = LineInput & {
  lineSubtotal: number; // qty * price
  discountAllocated: number; // share of the global discount on this line
  taxAmount: number; // VAT on (lineSubtotal - discountAllocated)
  lineTotal: number; // lineSubtotal + taxAmount (informational)
};

export type DiscountType = "percent" | "fixed" | null | undefined;
export type DepositType = "none" | "percent" | "fixed";

export type TotalsInput = {
  lines: LineInput[];
  discountType?: DiscountType;
  discountValue?: number; // bps if percent, minor units if fixed
  depositType?: DepositType;
  depositValue?: number; // bps if percent, minor units if fixed
};

export type Totals = {
  lines: LineTotals[];
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  total: number;
  depositAmount: number;
};

export function calcLineSubtotal(line: LineInput): number {
  return mulDiv(line.unitPrice, line.quantityMilli, 1000);
}

export function calcTotals(input: TotalsInput): Totals {
  const subtotals = input.lines.map(calcLineSubtotal);
  const subtotal = subtotals.reduce((a, b) => a + b, 0);

  // Global discount at the subtotal level
  let discountAmount = 0;
  if (input.discountType === "percent") {
    discountAmount = mulDiv(subtotal, input.discountValue ?? 0, 10000);
  } else if (input.discountType === "fixed") {
    discountAmount = Math.min(Math.max(input.discountValue ?? 0, 0), subtotal);
  }
  discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);

  // Distribute the discount across lines proportional to their subtotal
  const allocated = allocateProportional(discountAmount, subtotals);

  const lines: LineTotals[] = input.lines.map((line, i) => {
    const lineSubtotal = subtotals[i];
    const discountAllocated = allocated[i];
    const taxable = lineSubtotal - discountAllocated;
    const taxAmount = mulDiv(taxable, line.taxRateBps, 10000);
    return {
      ...line,
      lineSubtotal,
      discountAllocated,
      taxAmount,
      lineTotal: lineSubtotal + taxAmount,
    };
  });

  const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);
  const total = subtotal - discountAmount + taxTotal;

  // Required deposit / downpayment
  let depositAmount = 0;
  if (input.depositType === "percent") {
    depositAmount = mulDiv(total, input.depositValue ?? 0, 10000);
  } else if (input.depositType === "fixed") {
    depositAmount = Math.min(Math.max(input.depositValue ?? 0, 0), total);
  }
  depositAmount = Math.min(Math.max(depositAmount, 0), total);

  return { lines, subtotal, discountAmount, taxTotal, total, depositAmount };
}

/** Derive invoice status from money + due date after a payment changes. */
export function deriveInvoiceStatus(opts: {
  type: "invoice" | "quotation";
  currentStatus: string;
  total: number;
  amountPaid: number;
  dueDate?: Date | null;
  now?: Date;
}): string {
  if (opts.type === "quotation") return opts.currentStatus;
  if (opts.currentStatus === "void") return "void";
  const now = opts.now ?? new Date();
  if (opts.amountPaid <= 0) {
    if (opts.dueDate && opts.dueDate < now) return "overdue";
    return opts.currentStatus === "draft" ? "draft" : "sent";
  }
  if (opts.amountPaid >= opts.total) return "paid";
  // partially paid
  if (opts.dueDate && opts.dueDate < now) return "overdue";
  return "partial";
}
