import { ListSkeleton } from "@/components/skeleton";

// Route-level fallback shown instantly while any (app) page streams in.
export default function Loading() {
  return <ListSkeleton />;
}
