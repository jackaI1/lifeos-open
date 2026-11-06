import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { answer, search } from "./retrieval";
const t = initTRPC.context<{ find: typeof search }>().create();
const question = z.object({ question: z.string().trim().min(3).max(500) });
export const appRouter = t.router({
  search: t.procedure
    .input(question)
    .query(({ input, ctx }) => ctx.find(input.question)),
  answer: t.procedure.input(question).query(async function* ({ input, ctx }) {
    yield* answer(input.question, ctx.find);
  }),
});
export type AppRouter = typeof appRouter;
