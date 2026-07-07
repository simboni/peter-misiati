import { getAuth } from "@/server/auth";

// better-auth handles all /api/auth/* endpoints. Built per request (D1 binding).
export async function GET(req: Request) {
  const auth = await getAuth();
  return auth.handler(req);
}

export async function POST(req: Request) {
  const auth = await getAuth();
  return auth.handler(req);
}
