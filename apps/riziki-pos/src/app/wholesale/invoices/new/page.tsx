import { redirect } from "next/navigation";

/** As above: one builder, reached from either section. */
export default async function NewInvoiceRoute(props: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await props.searchParams;
  redirect(`/wholesale/new?mode=invoice${from ? `&from=${from}` : ""}`);
}
