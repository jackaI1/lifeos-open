import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Today } from "../components/Today";
import type { TodayView } from "../lib/feed";
const empty: TodayView = {
  day: "2026-10-06",
  timeZone: "America/Toronto",
  events: [],
  deadlines: [],
  unknown: [],
};
it("shows empty sections and keyboard accessible navigation", async () => {
  render(<Today initial={empty} />);
  expect(screen.getByText("No events today.")).toBeInTheDocument();
  expect(screen.getByText("No upcoming deadlines.")).toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Schedule" })).toHaveFocus();
});
it("shows loading and failure when refresh fails", async () => {
  let reject!: (reason: Error) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    ),
  );
  render(<Today initial={empty} />);
  await userEvent.click(screen.getByRole("button", { name: "Refresh day" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  reject(new Error("offline"));
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t load");
  vi.unstubAllGlobals();
});
it("can recover from an initial server failure and move focus with the keyboard", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(empty)));
  render(<Today initial={null} />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Refresh day" }));
  expect(await screen.findByText("No events today.")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Deadlines" });
  link.focus();
  await userEvent.keyboard("{Enter}");
  expect(document.getElementById("deadlines")).toHaveFocus();
  vi.unstubAllGlobals();
});
