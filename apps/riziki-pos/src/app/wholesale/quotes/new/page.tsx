import { redirect } from "next/navigation";

/** The builder lives in one place; the section keeps a tidy URL onto it. */
export default async function NewQuoteRoute(props: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await props.searchParams;
  redirect(`/wholesale/new?mode=quote${from ? `&from=${from}` : ""}`);
}
