// Pure helpers for document numbering. The atomic counter increment lives in
// the DB action (numberSequence table); this just formats.

export type DocType = "invoice" | "quotation" | "receipt" | "delivery_note" | "credit_note";

export const DEFAULT_PREFIXES: Record<DocType, string> = {
  invoice: "INV-",
  quotation: "QUO-",
  receipt: "RCP-",
  delivery_note: "DN-",
  credit_note: "CN-",
};

export function formatDocNumber(prefix: string, n: number, padding = 4): string {
  return `${prefix}${String(n).padStart(padding, "0")}`;
}
