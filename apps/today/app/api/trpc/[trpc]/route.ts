import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../../../../lib/router";
import { search } from "../../../../lib/retrieval";
function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ({ find: search }),
  });
}
export { handler as GET, handler as POST };
