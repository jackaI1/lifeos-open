import {
  buildSchema,
  graphql,
  parse,
  validate,
  type DocumentNode,
  type SelectionSetNode,
} from "graphql";
import { z } from "zod";
export const schema = buildSchema(`
  type Account { id: ID!, name: String!, balanceCents: Int, transactions(first: Int = 10, after: ID): TransactionConnection! }
  type Transaction { id: ID!, accountId: ID!, amountCents: Int!, memo: String! }
  type AccountConnection { nodes: [Account!]!, endCursor: ID, hasNextPage: Boolean! }
  type TransactionConnection { nodes: [Transaction!]!, endCursor: ID, hasNextPage: Boolean! }
  type Query { accounts(first: Int = 10, after: ID): AccountConnection!, account(id: ID!): Account }
  input AddTransaction { accountId: ID!, amountCents: Int!, memo: String! }
  type Mutation { addTransaction(input: AddTransaction!): Transaction! }
`);
export type Viewer = { owner: string; staff: boolean };
export function viewer(header: string | null): Viewer | null {
  if (
    header === `Bearer ${process.env.ACCOUNTS_STAFF_TOKEN ?? "fictional-staff"}`
  )
    return { owner: "staff", staff: true };
  if (
    header ===
    `Bearer ${process.env.ACCOUNTS_STUDENT_TOKEN ?? "fictional-student"}`
  )
    return { owner: "student", staff: false };
  return null;
}
type Entry = {
  id: string;
  accountId: string;
  amountCents: number;
  memo: string;
};
const accountRows = [
  { id: "course", name: "Course materials", owner: "student", opening: 15000 },
  {
    id: "house",
    name: "Shared house example",
    owner: "housemate",
    opening: 25000,
  },
];
export function createAccounts() {
  const entries: Entry[] = [];
  let nextId = 1;
  function allowed(id: string, who: Viewer) {
    const a = accountRows.find((a) => a.id === id);
    if (!a || (!who.staff && a.owner !== who.owner))
      throw Error("Not authorized for this account");
    return a;
  }
  function page<T extends { id: string }>(
    rows: T[],
    first = 10,
    after?: string,
  ) {
    if (!Number.isInteger(first) || first < 1 || first > 50)
      throw Error("first must be between 1 and 50");
    const found = after ? rows.findIndex((r) => r.id === after) : -1;
    if (after && found === -1) throw Error("Invalid cursor");
    const nodes = rows.slice(found + 1, found + 1 + first);
    return {
      nodes,
      endCursor: nodes.at(-1)?.id ?? null,
      hasNextPage: found + 1 + first < rows.length,
    };
  }
  function account(row: (typeof accountRows)[number]) {
    return {
      id: row.id,
      name: row.name,
      balanceCents: (_: unknown, who: Viewer) => {
        allowed(row.id, who);
        return (
          row.opening +
          entries
            .filter((e) => e.accountId === row.id)
            .reduce((n, e) => n + e.amountCents, 0)
        );
      },
      transactions: (
        { first, after }: { first?: number; after?: string },
        who: Viewer,
      ) => {
        allowed(row.id, who);
        return page(
          entries.filter((e) => e.accountId === row.id),
          first,
          after,
        );
      },
    };
  }
  const root = {
    accounts: (
      { first, after }: { first?: number; after?: string },
      who: Viewer,
    ) => {
      if (!who) throw Error("Authentication required");
      return page(accountRows.map(account), first, after);
    },
    account: ({ id }: { id: string }, who: Viewer) => {
      if (!who) throw Error("Authentication required");
      const row = accountRows.find((a) => a.id === id);
      return row ? account(row) : null;
    },
    addTransaction: ({ input }: { input: unknown }, who: Viewer) => {
      const data = z
        .object({
          accountId: z.string(),
          amountCents: z
            .number()
            .int()
            .refine((x) => x !== 0 && Math.abs(x) <= 100000),
          memo: z.string().trim().min(1).max(200),
        })
        .parse(input);
      allowed(data.accountId, who);
      const entry = { ...data, id: String(nextId++) };
      entries.push(entry);
      return entry;
    },
  };
  return {
    root,
    rest: (who: Viewer) =>
      accountRows
        .filter((a) => who.staff || a.owner === who.owner)
        .map((a) => ({
          id: a.id,
          name: a.name,
          balanceCents: account(a).balanceCents({}, who),
        })),
  };
}
export function checkDepth(doc: DocumentNode, max = 6) {
  const fragments = new Map(
    doc.definitions
      .filter((d) => d.kind === "FragmentDefinition")
      .map((d) => [d.name.value, d]),
  );
  function walk(set: SelectionSetNode, depth: number, seen: Set<string>) {
    if (depth > max) throw Error("Query depth limit exceeded");
    for (const selection of set.selections) {
      if (selection.kind === "FragmentSpread") {
        if (seen.has(selection.name.value)) throw Error("Circular fragment");
        const f = fragments.get(selection.name.value);
        if (f)
          walk(f.selectionSet, depth, new Set([...seen, selection.name.value]));
      } else if (selection.kind === "InlineFragment")
        walk(selection.selectionSet, depth, seen);
      else if (selection.selectionSet)
        walk(selection.selectionSet, depth + 1, seen);
    }
  }
  for (const def of doc.definitions)
    if (def.kind === "OperationDefinition")
      walk(def.selectionSet, 1, new Set());
}
export async function executeAccounts(
  service: ReturnType<typeof createAccounts>,
  query: string,
  who: Viewer | null,
  variables?: Record<string, unknown>,
) {
  if (!who) return { errors: [{ message: "Authentication required" }] };
  if (query.length > 12000)
    return { errors: [{ message: "Query is too large" }] };
  try {
    const doc = parse(query);
    const errors = validate(schema, doc);
    if (errors.length) return { errors };
    checkDepth(doc);
    return await graphql({
      schema,
      source: query,
      rootValue: service.root,
      contextValue: who,
      variableValues: variables,
    });
  } catch (e) {
    return {
      errors: [{ message: e instanceof Error ? e.message : "Invalid query" }],
    };
  }
}
export const accounts = createAccounts();
