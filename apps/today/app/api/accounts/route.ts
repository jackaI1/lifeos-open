import { accounts, viewer } from "../../../lib/accounts";
export async function GET(req: Request) {
  const who = viewer(req.headers.get("authorization"));
  return who
    ? Response.json({ accounts: accounts.rest(who) })
    : Response.json({ error: "Authentication required" }, { status: 401 });
}
