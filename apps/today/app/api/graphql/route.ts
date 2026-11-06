import { accounts, executeAccounts, viewer } from "../../../lib/accounts";
import { z } from "zod";
export async function POST(req: Request) {
  const who = viewer(req.headers.get("authorization"));
  if (!who)
    return Response.json(
      { errors: [{ message: "Authentication required" }] },
      { status: 401 },
    );
  try {
    const { query, variables } = z
      .object({
        query: z.string().max(12000),
        variables: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await req.json());
    return Response.json(
      await executeAccounts(accounts, query, who, variables),
    );
  } catch {
    return Response.json(
      { errors: [{ message: "Send a query string and optional variables." }] },
      { status: 400 },
    );
  }
}
