"use client";
import { useEffect, useState } from "react";
interface Run {
  id: number;
  success_rate: number;
  successes: number;
  failures: Record<string, number>;
  config: Record<string, number>;
}
const defaults = {
  part_size_mm: 10,
  camera_noise_mm: 1,
  gripper_tolerance_mm: 1,
  trials: 1000,
  seed: 42,
};
const labels = {
  part_size_mm: "Part size (mm)",
  camera_noise_mm: "Camera noise (mm)",
  gripper_tolerance_mm: "Gripper tolerance (mm)",
  trials: "Number of trials",
  seed: "Random seed",
};
export function Picks() {
  const [config, setConfig] = useState(defaults),
    [runs, setRuns] = useState<Run[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/picks", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        setRuns((await r.json()).runs);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Start the Flask pick service to load saved runs.");
      });
    return () => controller.abort();
  }, []);
  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw Error();
      const created: Run = await response.json();
      setRuns((previous) => [created, ...previous].slice(0, 100));
    } catch {
      setError(
        "The pick run failed. Check the values and start the Flask service, then retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  const compared = selected.map((id) => runs.find((r) => r.id === id)!);
  return (
    <main>
      <h1>Compare pick trials</h1>
      <p>
        I use a small simulated pick cell to see how camera error and gripper
        tolerance affect a trial. These are fictional results, not measurements
        from a robot.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {(Object.keys(defaults) as (keyof typeof defaults)[]).map((key) => (
          <label key={key}>
            {labels[key]}
            <input
              type="number"
              required
              step={key === "trials" || key === "seed" ? 1 : 0.01}
              min={
                key === "camera_noise_mm" || key === "seed"
                  ? 0
                  : key === "gripper_tolerance_mm"
                    ? 0.01
                    : 1
              }
              max={
                key === "trials"
                  ? 10000
                  : key === "seed"
                    ? 2147483647
                    : key === "part_size_mm"
                      ? 100
                      : key === "camera_noise_mm"
                        ? 20
                        : 10
              }
              value={config[key]}
              onChange={(e) =>
                setConfig({ ...config, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <button disabled={busy}>Run simulation</button>
      </form>
      {busy && <p role="status">Running trials…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !runs.length && (
        <p>No runs yet. Try the starting values, then change the tolerance.</p>
      )}
      {runs.length > 0 && (
        <>
          <h2>Saved runs</h2>
          <p>Select two runs to compare their success rates.</p>
          <table>
            <thead>
              <tr>
                <th>Compare</th>
                <th>Run</th>
                <th>Success rate</th>
                <th>Failure counts</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Compare run ${r.id}`}
                      checked={selected.includes(r.id)}
                      disabled={
                        selected.length === 2 && !selected.includes(r.id)
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.id]
                            : selected.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <th>{r.id}</th>
                  <td>{(r.success_rate * 100).toFixed(1)}%</td>
                  <td>
                    {Object.entries(r.failures)
                      .map(
                        ([reason, count]) =>
                          `${reason.replaceAll("_", " ")}: ${count}`,
                      )
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {compared.length === 2 && (
        <p role="status">
          Run {compared[1].id} compared with run {compared[0].id}:{" "}
          {(
            (compared[1].success_rate - compared[0].success_rate) *
            100
          ).toFixed(1)}{" "}
          percentage points.
        </p>
      )}
    </main>
  );
}
