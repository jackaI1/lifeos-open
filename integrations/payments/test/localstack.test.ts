import { it, expect } from "vitest";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoStore, makeHandler, SimulatedProvider } from "../src/handler";
it.skipIf(!process.env.AWS_ENDPOINT_URL)(
  "real DynamoDB conditional writes survive concurrent retries and lost provider replies",
  async () => {
    const table = "lifeos-payments-test-" + Date.now();
    const client = new DynamoDBClient({
      endpoint: process.env.AWS_ENDPOINT_URL,
      region: "us-east-1",
    });
    const doc = DynamoDBDocumentClient.from(client);
    try {
      await client.send(
        new CreateTableCommand({
          TableName: table,
          KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
          AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
          BillingMode: "PAY_PER_REQUEST",
        }),
      );
      await waitUntilTableExists(
        { client, maxWaitTime: 30 },
        { TableName: table },
      );
      const store = new DynamoStore(doc, table),
        handler = makeHandler(
          store,
          new SimulatedProvider(store),
          "timeout_after",
        );
      const event = {
        httpMethod: "POST",
        path: "/payments",
        headers: { "Idempotency-Key": "same" },
        body: JSON.stringify({
          amount_cents: 200,
          account: "fictional-student",
        }),
      };
      expect((await handler(event)).statusCode).toBe(503);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => handler(event)),
      );
      expect(
        results.every(
          (r) =>
            r.statusCode === 201 && JSON.parse(r.body).state === "captured",
        ),
      ).toBe(true);
      const id = JSON.parse(results[0].body).id;
      const refund = {
        ...event,
        path: `/payments/${id}/refund`,
        headers: { "Idempotency-Key": "refund" },
      };
      expect((await handler(refund)).statusCode).toBe(503);
      expect((await handler(refund)).statusCode).toBe(200);
      const scan = await doc.send(new ScanCommand({ TableName: table }));
      expect(
        scan.Items?.filter((i) => String(i.pk).startsWith("provider:")),
      ).toHaveLength(2);
    } finally {
      await client.send(new DeleteTableCommand({ TableName: table }));
      client.destroy();
    }
  },
  60000,
);
