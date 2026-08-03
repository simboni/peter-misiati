// Shared, client-safe constants for document look (used by the Settings picker
// and the document renderer). No server imports here.

export const TEMPLATES = [
  { id: "aria", name: "Aria", desc: "Modern minimal — air & hairlines." },
  { id: "meridian", name: "Meridian", desc: "Classic & structured, bold total." },
  { id: "vertex", name: "Vertex", desc: "Confident colour-block header." },
  { id: "column", name: "Column", desc: "Coloured sidebar for identity & totals." },
  { id: "boutique", name: "Boutique", desc: "Elegant serif, understated." },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];

export const ACCENTS = [
  { name: "Emerald", hex: "#0e9f6e" },
  { name: "Royal Blue", hex: "#2563eb" },
  { name: "Ink / Navy", hex: "#0f172a" },
  { name: "Teal", hex: "#0d9488" },
  { name: "Gold", hex: "#b08d57" },
  { name: "Rose", hex: "#e11d48" },
  { name: "Violet", hex: "#7c3aed" },
  { name: "Amber", hex: "#ea580c" },
] as const;

export const DEFAULT_TEMPLATE: TemplateId = "column";
export const DEFAULT_ACCENT = "#0e9f6e";
