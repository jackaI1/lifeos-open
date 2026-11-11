// Health check for the LifeOS public demo container.
// Used by the Azure workflow after each deploy and by the local container test.
//
//   node deploy/azure/healthcheck.mjs https://example.azurecontainerapps.io
//
// It asks /healthz for JSON with status "ok" and checks the security headers
// the public demo sends. It retries because a scaled-to-zero app takes a few
// seconds to wake up.

export async function checkHealth(baseUrl, {
  fetchImpl = globalThis.fetch,
  attempts = 1,
  delayMs = 0,
  timeoutMs = 10000,
} = {}) {
  const url = new URL('/healthz', baseUrl).href;
  let lastError = 'no attempts made';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
      if (response.status !== 200) {
        lastError = `HTTP ${response.status}`;
      } else {
        const body = await response.json();
        if (body?.status !== 'ok') {
          lastError = `unexpected body status: ${String(body?.status)}`;
        } else {
          return { ok: true, url, attempt, mode: body.mode ?? null };
        }
      }
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { ok: false, url, attempt: attempts, error: lastError };
}

async function main() {
  const baseUrl = process.argv[2] ?? process.env.DEMO_URL;
  if (!baseUrl) {
    console.error('Usage: node deploy/azure/healthcheck.mjs <base-url>');
    process.exit(2);
  }
  const result = await checkHealth(baseUrl, {
    attempts: Number(process.env.HEALTH_ATTEMPTS ?? 12),
    delayMs: Number(process.env.HEALTH_DELAY_MS ?? 5000),
  });
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
