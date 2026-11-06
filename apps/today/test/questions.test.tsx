import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, afterEach } from "vitest";
import { Questions } from "../components/Questions";
const query = vi.hoisted(() => vi.fn());
vi.mock("@trpc/client", () => ({
  createTRPCClient: () => ({ answer: { query } }),
  httpBatchStreamLink: () => ({}),
}));
afterEach(() => query.mockReset());
it("shows an empty prompt, streams citations, and reuses cached query data", async () => {
  query.mockImplementation(async () =>
    (async function* () {
      yield {
        kind: "sources",
        passages: [{ id: "day#p1", title: "Day", source: "day.md" }],
      };
      yield { kind: "text", text: '"Starts at 5 am" [1]' };
    })(),
  );
  render(<Questions />);
  expect(screen.getByText(/Ask about the day/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Ask question" }));
  expect(await screen.findByText('"Starts at 5 am" [1]')).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Day" })).toHaveAttribute(
    "href",
    "/api/passages?id=day%23p1",
  );
});
it("shows loading and uncertain states", async () => {
  let release!: () => void;
  query.mockImplementation(async () =>
    (async function* () {
      await new Promise<void>((r) => {
        release = r;
      });
      yield { kind: "uncertain", text: "Not enough evidence." };
    })(),
  );
  render(<Questions />);
  await userEvent.click(screen.getByRole("button", { name: "Ask question" }));
  expect(screen.getByRole("status")).toHaveTextContent("Looking up");
  release();
  expect(await screen.findByText("Not enough evidence.")).toBeInTheDocument();
});
it("shows a service error", async () => {
  query.mockRejectedValue(Error("offline"));
  render(<Questions />);
  await userEvent.click(screen.getByRole("button", { name: "Ask question" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "service is unavailable",
  );
});
