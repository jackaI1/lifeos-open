import { test, expect } from "./fixtures";
test("server renders the first day and keyboard links work after refresh", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  expect(await response.text()).toContain("Workshop");
  const feed = await request.get("/api/feed");
  expect(feed.status()).toBe(200);
  expect((await feed.json()).events[0].title).toBe("Workshop");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Schedule", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh day" }).click();
  await expect(page.getByText("Workshop", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/today-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/today-phone.png" });
  await page.getByRole("link", { name: "Deadlines", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#deadlines")).toBeFocused();
  await page.route("**/api/feed", (route) =>
    route.fulfill({ status: 503, json: { error: "offline" } }),
  );
  await page.getByRole("button", { name: "Refresh day" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
});
test("edits the report plan, detects cycles and downloads CSV", async ({
  page,
}) => {
  await page.goto("/plan");
  await expect(page.getByRole("img", { name: /Task timeline/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("lifeos-plan.csv");
  await page.getByText("Edit tasks and dependencies").click();
  await page
    .getByLabel("Tasks as JSON")
    .fill('[{"id":"a","title":"Cycle","duration":1,"dependsOn":["a"]}]');
  await expect(page.locator("main [role=alert]")).toContainText("Circular");
});
test("runs the real Flask simulation twice and compares saved results", async ({
  page,
}) => {
  await page.goto("/picks");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByLabel("Compare run 1")).toBeVisible();
  await page.getByLabel("Gripper tolerance (mm)").fill("2");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByLabel("Compare run 2")).toBeVisible();
  await page.getByLabel("Compare run 1").check();
  await page.getByLabel("Compare run 2").check();
  await expect(page.getByRole("status")).toContainText("percentage points");
});
test("asks the real tRPC and pgvector service and follows a citation", async ({
  page,
}) => {
  test.skip(
    !process.env.CONSOLE_DATABASE_URL,
    "Postgres browser integration runs in CI",
  );
  await page.goto("/questions");
  await page.getByRole("button", { name: "Ask question" }).click();
  await expect(page.locator(".quote").first()).toContainText("5 am");
  const link = page
    .getByRole("list", { name: "Sources" })
    .getByRole("link")
    .first();
  const href = await link.getAttribute("href");
  expect(href).toContain("/api/passages?id=");
  await link.click();
  await expect(page.locator("body")).toContainText("5 am");
});
test("GraphQL and REST expose only authorized fictional balances", async ({
  request,
}) => {
  const query = "{accounts(first:1){nodes{id balanceCents} hasNextPage}}";
  expect(
    (await request.post("/api/graphql", { data: { query } })).status(),
  ).toBe(401);
  const result = await request.post("/api/graphql", {
    headers: { Authorization: "Bearer fictional-student" },
    data: { query },
  });
  expect((await result.json()).data.accounts.nodes[0]).toEqual({
    id: "course",
    balanceCents: 15000,
  });
  const rest = await request.get("/api/accounts", {
    headers: { Authorization: "Bearer fictional-student" },
  });
  expect((await rest.json()).accounts).toHaveLength(1);
});
