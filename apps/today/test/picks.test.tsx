import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, afterEach } from "vitest";
import { Picks } from "../components/Picks";
afterEach(() => vi.unstubAllGlobals());
it("loads an empty history, posts settings, and compares saved runs", async () => {
  const run = (id: number, rate: number) => ({
    id,
    success_rate: rate,
    successes: rate * 1000,
    failures: { gripper_misalignment: 1000 - rate * 1000 },
    config: {},
  });
  const mock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ runs: [] }))
    .mockResolvedValueOnce(Response.json(run(1, 0.4)))
    .mockResolvedValueOnce(Response.json(run(2, 0.8)));
  vi.stubGlobal("fetch", mock);
  render(<Picks />);
  expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
  expect(await screen.findByText("40.0%")).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Gripper tolerance (mm)"));
  await userEvent.type(screen.getByLabelText("Gripper tolerance (mm)"), "2");
  await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
  expect(await screen.findByText("80.0%")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Compare run 1"));
  await userEvent.click(screen.getByLabelText("Compare run 2"));
  expect(screen.getByRole("status")).toHaveTextContent(
    "40.0 percentage points",
  );
  expect(JSON.parse(mock.mock.calls[2][1].body).gripper_tolerance_mm).toBe(2);
});
it("shows service failure with a retry action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("offline")));
  render(<Picks />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Start the Flask");
  await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("pick run failed");
});
