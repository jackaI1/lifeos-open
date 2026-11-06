import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const directory = await mkdtemp(
  path.join(os.tmpdir(), "lifeos-study-browser-"),
);
const children = [];
let closing = false;
async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? undefined
        : new Promise((resolve) => {
            child.once("exit", resolve);
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 5000);
            timer.unref();
          }),
    ),
  );
  await rm(directory, { recursive: true, force: true });
  process.exit(code);
}
for (const [command, args, port, extra] of [
  [
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "-p",
      "3217",
    ],
    3217,
    {},
  ],
  [
    path.resolve("../../services/study/.venv/bin/python"),
    [
      "-m",
      "flask",
      "--app",
      "robot:create_app()",
      "run",
      "--host",
      "127.0.0.1",
      "--port",
      "5001",
    ],
    5001,
    {
      cwd: path.resolve("../../services/study"),
      env: {
        ...process.env,
        PICK_DATABASE: path.join(directory, "picks.sqlite"),
      },
    },
  ],
]) {
  const child = spawn(command, args, { stdio: "inherit", ...extra });
  children.push(child);
  console.log(
    JSON.stringify({
      owner: "LifeOS study desk browser tests",
      pid: child.pid,
      start: new Date().toISOString(),
      port,
      cleanup: `kill -TERM ${child.pid}`,
    }),
  );
  child.once("exit", (code) => {
    if (!closing) void cleanup(code || 1);
  });
  child.once("error", () => void cleanup(1));
}
process.once("SIGTERM", () => void cleanup());
process.once("SIGINT", () => void cleanup());
