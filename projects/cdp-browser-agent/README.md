# cdp-browser-agent

I built a browser automation library to learn how the underlying idea works. This is a learning project.

## Try it

Install Node.js 22 or newer and Chrome, then run:

On Linux, set `CHROME_PATH` to your Chrome or Chromium executable. To compare a local model, install and start Ollama and make a model available in it, then run `OLLAMA_MODEL=<model-name> npm run benchmark`. The benchmark sends the task and page outline to the local Ollama server at `http://127.0.0.1:11434`. It does not download a model for you. Results depend on the model and can fail; the script reports errors instead of counting them as successes.

## Use the library

Playwright controls the browser; the Chrome DevTools Protocol (CDP) is Chrome's lower-level debugging interface. The library uses both. Actions use CSS selectors, and a snapshot returns accessible roles and names that a model can read. Create a Playwright page and pass it to the agent:

```ts
import { chromium } from 'playwright-core';
import { BrowserAgent } from 'cdp-browser-agent';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage();
  const agent = await BrowserAgent.create(page);
  try {
    await agent.act({ type: 'navigate', url: 'https://example.com' });
    console.log(await agent.snapshot());
    console.log(await agent.act({ type: 'extract', selector: 'h1' }));
  } finally { await agent.close(); }
} finally { await browser.close(); }
```

`click` and `fill` take a selector; `fill` also takes a value. Locators are resolved again when an element is replaced, and timeout or detached-element errors are retried once by default. Set `timeoutMs` and `retries` when creating the agent. Other errors are returned to the caller. `agent.events` holds up to 1,000 CDP network request and console events. These can contain URLs or page data, so handle them carefully.

## Tests and limits

There are 2 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.

No project-specific GitHub Actions workflow was retained. The local test sources remain in this folder.
