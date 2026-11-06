import { it, expect } from "vitest";
import { makeHandler, type Store, SimulatedProvider } from "../src/handler";
class Memory implements Store {
  data = new Map<string, Record<string, unknown>>();
  async get(k: string) {
    const v = this.data.get(k);
    return v ? { ...v } : undefined;
  }
  async put(item: Record<string, unknown>) {
    if (this.data.has(item.pk as string)) return false;
    this.data.set(item.pk as string, { ...item });
    return true;
  }
  async transition(k: string, from: string, to: string) {
    const value = this.data.get(k);
    if (value?.state === from) value.state = to;
  }
}
const event = (
  key = "one",
  path = "/payments",
  body = { amount_cents: 500, account: "fictional-student" },
) => ({
  httpMethod: "POST",
  path,
  headers: { "Idempotency-Key": key },
  body: JSON.stringify(body),
});
it("creates once under concurrent retries, refunds once and rejects recapture", async () => {
  const store = new Memory(),
    h = makeHandler(store);
  const results = await Promise.all(
    Array.from({ length: 12 }, () => h(event())),
  );
  expect(results.every((r) => r.statusCode === 201)).toBe(true);
  const id = JSON.parse(results[0].body).id;
  expect(
    [...store.data.keys()].filter((k) => k.startsWith("provider:")),
  ).toHaveLength(1);
  expect((await h(event("refund", `/payments/${id}/refund`))).statusCode).toBe(
    200,
  );
  expect((await h(event("refund2", `/payments/${id}/refund`))).statusCode).toBe(
    200,
  );
  expect((await h(event("retry", `/payments/${id}/retry`))).statusCode).toBe(
    409,
  );
  expect(
    [...store.data.keys()].filter((k) => k.startsWith("provider:")),
  ).toHaveLength(2);
});
it.each(["fail_before", "timeout_after"] as const)(
  "recovers %s without double posting",
  async (failure) => {
    const store = new Memory(),
      h = makeHandler(store, new SimulatedProvider(store), failure);
    expect((await h(event())).statusCode).toBe(503);
    const response = await h(event());
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).state).toBe("captured");
    expect(
      [...store.data.keys()].filter((k) => k.startsWith("provider:")),
    ).toHaveLength(1);
  },
);
it("rejects changed keys, invalid input, and refund before capture", async () => {
  const store = new Memory(),
    h = makeHandler(store);
  await h(event());
  expect(
    (
      await h(
        event("one", "/payments", {
          amount_cents: 501,
          account: "fictional-student",
        }),
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await h(
        event("bad", "/payments", {
          amount_cents: -1,
          account: "fictional-student",
        }),
      )
    ).statusCode,
  ).toBe(400);
  const failed = makeHandler(
    store,
    new SimulatedProvider(store),
    "fail_before",
  );
  const r = await failed(event("pending"));
  const id = [...store.data.values()].find((v) => v.state === "pending")!.id;
  expect(r.statusCode).toBe(503);
  expect(
    (await h(event("refund-pending", `/payments/${id}/refund`))).statusCode,
  ).toBe(409);
});
it("returns structured errors for route, key and storage failures", async () => {
  const store = new Memory(),
    h = makeHandler(store);
  expect((await h({ ...event(), headers: {} })).statusCode).toBe(400);
  expect((await h(event("route", "/wrong"))).statusCode).toBe(404);
  expect((await h({ ...event(), body: "{" })).statusCode).toBe(400);
  store.put = async () => {
    throw Error("storage");
  };
  expect((await h(event())).statusCode).toBe(503);
});
