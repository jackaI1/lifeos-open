// @vitest-environment node
import { it, expect } from "vitest";
import { parse } from "graphql";
import {
  createAccounts,
  executeAccounts,
  checkDepth,
  viewer,
} from "../lib/accounts";
const student = { owner: "student", staff: false },
  staff = { owner: "staff", staff: true };
it("paginates accounts and supports a cursor", async () => {
  const s = createAccounts();
  const a = await executeAccounts(
    s,
    "{ accounts(first:1) { nodes { id name } endCursor hasNextPage } }",
    student,
  );
  expect(a).toMatchObject({
    data: {
      accounts: {
        endCursor: "course",
        hasNextPage: true,
        nodes: [{ id: "course" }],
      },
    },
  });
  const b = await executeAccounts(
    s,
    '{ accounts(first:1,after:"course") { nodes { id } hasNextPage } }',
    student,
  );
  expect(b).toMatchObject({
    data: { accounts: { nodes: [{ id: "house" }], hasNextPage: false } },
  });
});
it("protects sensitive fields independently from public account names", async () => {
  const r = await executeAccounts(
    createAccounts(),
    '{ account(id:"house") { name balanceCents } }',
    student,
  );
  expect(r.errors?.[0].message).toContain("Not authorized");
  expect(r).toMatchObject({
    data: { account: { name: "Shared house example", balanceCents: null } },
  });
});
it("validates mutations, updates balances and paginates transactions", async () => {
  const s = createAccounts();
  const mutation =
    "mutation($input:AddTransaction!){addTransaction(input:$input){id amountCents}}";
  const r = await executeAccounts(s, mutation, student, {
    input: {
      accountId: "course",
      amountCents: -500,
      memo: "Fictional notebook",
    },
  });
  expect(r).toMatchObject({
    data: { addTransaction: { id: "1", amountCents: -500 } },
  });
  expect(s.rest(student)[0].balanceCents).toBe(14500);
  expect(
    (
      await executeAccounts(s, mutation, student, {
        input: { accountId: "house", amountCents: 100, memo: "x" },
      })
    ).errors,
  ).toHaveLength(1);
  expect(
    (
      await executeAccounts(s, mutation, student, {
        input: { accountId: "course", amountCents: 0, memo: "" },
      })
    ).errors,
  ).toHaveLength(1);
  expect(
    await executeAccounts(
      s,
      '{account(id:"course"){transactions(first:1){nodes{memo} endCursor}}}',
      student,
    ),
  ).toMatchObject({
    data: {
      account: {
        transactions: {
          endCursor: "1",
          nodes: [{ memo: "Fictional notebook" }],
        },
      },
    },
  });
});
it("requires authentication and applies staff permissions", async () => {
  const s = createAccounts();
  expect(
    (await executeAccounts(s, "{accounts{nodes{id}}}", null)).errors,
  ).toHaveLength(1);
  expect(s.rest(staff)).toHaveLength(2);
  expect(viewer("Bearer invented")).toBeNull();
});
it("rejects bad cursors and page sizes", async () => {
  for (const args of ["first:0", "first:51", 'after:"missing"'])
    expect(
      (
        await executeAccounts(
          createAccounts(),
          `{accounts(${args}){nodes{id}}}`,
          student,
        )
      ).errors,
    ).toHaveLength(1);
});
it("counts depth through fragments and inline fragments", () => {
  expect(() =>
    checkDepth(parse("{a{...F}} fragment F on X { b{c{d{e{f{g}}}}}}")),
  ).toThrow("depth");
  expect(() => checkDepth(parse("{a{... on X{b{c{d{e{f{g}}}}}}}}"))).toThrow(
    "depth",
  );
  expect(() => checkDepth(parse("{a{...F}} fragment F on X {...F}"))).toThrow(
    "Circular",
  );
});
