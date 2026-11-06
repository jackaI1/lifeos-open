import { z } from "zod";
const configuration = z
  .object({
    part_size_mm: z.number().min(1).max(100),
    camera_noise_mm: z.number().min(0).max(20),
    gripper_tolerance_mm: z.number().min(0.01).max(10),
    trials: z.number().int().min(1).max(10000),
    seed: z.number().int().min(0).max(2147483647),
  })
  .strict();
async function proxy(req: Request) {
  const base = process.env.PICK_API_URL ?? "http://127.0.0.1:5001";
  try {
    const response = await fetch(base + "/runs", {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      ...(req.method === "POST"
        ? { body: JSON.stringify(configuration.parse(await req.json())) }
        : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the simulation values."
            : "Start the Flask pick service, then retry.",
      },
      { status: e instanceof z.ZodError ? 400 : 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
