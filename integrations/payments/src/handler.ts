import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
export interface Payment extends Record<string, unknown> {
  pk: string;
  id: string;
  amount_cents: number;
  account: string;
  state: "pending" | "captured" | "refunded";
}
export interface Store {
  get(key: string): Promise<Record<string, unknown> | undefined>;
  put(item: Record<string, unknown>): Promise<boolean>;
  transition(key: string, from: string, to: string): Promise<void>;
}
export class DynamoStore implements Store {
  constructor(
    private client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: process.env.AWS_REGION ?? "us-east-1",
        ...(process.env.AWS_ENDPOINT_URL
          ? { endpoint: process.env.AWS_ENDPOINT_URL }
          : {}),
      }),
    ),
    private table = process.env.PAYMENTS_TABLE ?? "lifeos-payments",
  ) {}
  async get(pk: string) {
    return (
      await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { pk },
          ConsistentRead: true,
        }),
      )
    ).Item;
  }
  async put(item: Record<string, unknown>) {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === "ConditionalCheckFailedException")
        return false;
      throw e;
    }
  }
  async transition(pk: string, from: string, to: string) {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk },
          UpdateExpression: "SET #s=:to",
          ConditionExpression: "#s=:from",
          ExpressionAttributeNames: { "#s": "state" },
          ExpressionAttributeValues: { ":to": to, ":from": from },
        }),
      );
    } catch (e) {
      if (e instanceof Error && e.name === "ConditionalCheckFailedException")
        return;
      throw e;
    }
  }
}
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export type Failure = "none" | "fail_before" | "timeout_after";
export class SimulatedProvider {
  constructor(private store: Store) {}
  async post(
    id: string,
    operation: "capture" | "refund",
    failure: Failure = "none",
  ) {
    const pk = `provider:${id}:${operation}`;
    const previous = await this.store.get(pk);
    if (previous?.state === "applied") return;
    if (failure === "fail_before" && !previous) {
      if (await this.store.put({ pk, state: "attempted" }))
        throw new ApiError(
          503,
          "PROVIDER_RETRY",
          "Simulated provider failed before posting. Retry with the same key.",
        );
    }
    if (!previous) await this.store.put({ pk, state: "applied" });
    await this.store.transition(pk, "attempted", "applied");
    if (failure === "timeout_after" && !previous)
      throw new ApiError(
        503,
        "PROVIDER_TIMEOUT",
        "Simulated reply was lost after posting. Retry safely.",
      );
  }
}
const createInput = z
  .object({
    amount_cents: z.number().int().min(1).max(1000000),
    account: z.literal("fictional-student"),
  })
  .strict();
export function makeHandler(
  store: Store,
  provider = new SimulatedProvider(store),
  failure: Failure = "none",
) {
  return async (event: {
    httpMethod?: string;
    path?: string;
    headers?: Record<string, string | undefined>;
    body?: string | null;
  }) => {
    const reply = (statusCode: number, body: unknown) => ({
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(body),
    });
    try {
      if (event.httpMethod !== "POST")
        throw new ApiError(405, "METHOD", "Use POST.");
      const key =
        event.headers?.["Idempotency-Key"] ??
        event.headers?.["idempotency-key"];
      if (!key || !/^[-a-zA-Z0-9_]{1,100}$/.test(key))
        throw new ApiError(
          400,
          "KEY",
          "Supply an Idempotency-Key with letters, digits, _ or -.",
        );
      const path = event.path ?? "";
      const route = path.match(/^\/payments\/([a-f0-9]{24})\/(retry|refund)$/);
      if (path !== "/payments" && !route)
        throw new ApiError(404, "ROUTE", "Payment route not found.");
      const input =
        path === "/payments"
          ? createInput.parse(JSON.parse(event.body ?? "{}"))
          : null;
      const id = route?.[1] ?? digest("payment:" + key).slice(0, 24);
      const operation = route?.[2] ?? "create";
      const requestHash = digest(JSON.stringify({ operation, id, input }));
      const requestKey = "request:" + key;
      await store.put({ pk: requestKey, hash: requestHash, id });
      const original = await store.get(requestKey);
      if (original?.hash !== requestHash)
        throw new ApiError(
          409,
          "KEY_CONFLICT",
          "This key belongs to a different request.",
        );
      if (input)
        await store.put({
          pk: "payment:" + id,
          id,
          ...input,
          state: "pending",
        });
      let payment = (await store.get("payment:" + id)) as Payment | undefined;
      if (!payment) throw new ApiError(404, "MISSING", "Payment not found.");
      if (operation === "refund") {
        if (payment.state === "pending")
          throw new ApiError(
            409,
            "TRANSITION",
            "Capture the payment before refunding it.",
          );
        if (payment.state !== "refunded") {
          await provider.post(id, "refund", failure);
          await store.transition(payment.pk, "captured", "refunded");
        }
      } else if (payment.state === "pending") {
        await provider.post(id, "capture", failure);
        await store.transition(payment.pk, "pending", "captured");
      } else if (operation === "retry" && payment.state === "refunded")
        throw new ApiError(
          409,
          "TRANSITION",
          "A refunded payment cannot be captured again.",
        );
      payment = (await store.get(payment.pk)) as Payment;
      console.info(
        JSON.stringify({
          event: "payment_result",
          id,
          state: payment.state,
          operation,
        }),
      );
      return reply(operation === "create" ? 201 : 200, {
        id: payment.id,
        amount_cents: payment.amount_cents,
        account: payment.account,
        state: payment.state,
        fictional: true,
      });
    } catch (e) {
      if (e instanceof ApiError)
        return reply(e.status, { error: { code: e.code, message: e.message } });
      if (e instanceof z.ZodError || e instanceof SyntaxError)
        return reply(400, {
          error: {
            code: "INPUT",
            message:
              "Send a fictional-student account and integer amount_cents from 1 to 1000000.",
          },
        });
      console.error(
        JSON.stringify({
          event: "payment_error",
          error_type: e instanceof Error ? e.name : "Unknown",
        }),
      );
      return reply(503, {
        error: {
          code: "UNAVAILABLE",
          message: "Storage unavailable. Retry with the same key.",
        },
      });
    }
  };
}
export const handler = makeHandler(new DynamoStore());
