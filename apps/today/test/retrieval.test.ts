// @vitest-environment node
import { it, expect, afterEach, vi } from "vitest";
import {
  answer,
  embedding,
  grounded,
  modelAnswer,
  score,
  type Passage,
} from "../lib/retrieval";
import { appRouter } from "../lib/router";
const p: Passage = {
  id: "day#p1",
  title: "Day",
  text: "The day starts at 5 am.",
  source: "day.md",
  score: 0.9,
};
afterEach(() => vi.unstubAllEnvs());
it("normalizes deterministic word vectors", () => {
  expect(embedding("day DAY")).toEqual(embedding("day"));
  expect(Math.hypot(...embedding("day starts"))).toBeCloseTo(1);
  expect(embedding("the")).toEqual(Array(128).fill(0));
});
it("streams cited quotations with source metadata", async () => {
  const events = [];
  for await (const e of answer("day", async () => [p])) events.push(e);
  expect(events).toEqual([
    { kind: "sources", passages: [p] },
    { kind: "text", text: '"The day starts at 5 am." [1]\n' },
  ]);
});
it("abstains on an empty result", async () => {
  const events = [];
  for await (const e of answer("unknown", async () => [])) events.push(e);
  expect(events[1].kind).toBe("uncertain");
});
it("does not expose fabricated model output", async () => {
  const generate = async function* () {
    yield '"The day starts at noon." [1]\n';
  };
  const events = [];
  for await (const e of answer("day", async () => [p], generate))
    events.push(e);
  expect(events.some((e) => e.kind === "text")).toBe(false);
  expect(events[1].kind).toBe("uncertain");
});
it("scores wrong citations, missing hits, and empty answers as failures", () => {
  expect(grounded('"The day starts at 5 am." [2]', [p])).toBe(false);
  expect(grounded("", [p])).toBe(false);
  expect(score("missing", [p], "made up", false)).toEqual({
    retrievalHit: false,
    grounded: false,
  });
  expect(score(null, [], "", true)).toEqual({
    retrievalHit: true,
    grounded: true,
  });
});
it("validates tRPC input and returns typed search results", async () => {
  const caller = appRouter.createCaller({ find: async () => [p] });
  expect(await caller.search({ question: "day starts" })).toEqual([p]);
  await expect(caller.search({ question: "" })).rejects.toThrow();
});
it("handles a real SSE-shaped model stream split across transport chunks", async () => {
  vi.stubEnv("ANSWER_MODEL_URL", "http://127.0.0.1:9999/v1/chat/completions");
  const payload =
    "data: " +
    JSON.stringify({
      choices: [{ delta: { content: '"The day starts at 5 am." [1]\n' } }],
    }) +
    "\n\ndata: [DONE]\n";
  const transport = vi.fn(
    async (_url: unknown, _options?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(payload.slice(0, 20)));
            c.enqueue(new TextEncoder().encode(payload.slice(20)));
            c.close();
          },
        }),
      ),
  );
  let text = "";
  for await (const c of modelAnswer("day", [p], transport)) text += c;
  expect(grounded(text, [p])).toBe(true);
  expect(JSON.parse(transport.mock.calls[0][1]!.body as string).stream).toBe(
    true,
  );
});
it("reports an unavailable model and refuses insecure remote HTTP", async () => {
  vi.stubEnv("ANSWER_MODEL_URL", "http://remote.invalid/model");
  await expect(async () => {
    for await (const c of modelAnswer("day", [p])) void c;
  }).rejects.toThrow("HTTPS");
});
