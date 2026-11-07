import type { Page, CDPSession } from 'playwright-core';

export type Action = { type: 'navigate'; url: string } | { type: 'click'; selector: string } | { type: 'fill'; selector: string; value: string } | { type: 'extract'; selector: string };
export type RecordedEvent = { kind: 'network' | 'console'; timestamp: number; message: string };
export class BrowserAgent {
  readonly events: RecordedEvent[] = [];
  private constructor(private page: Page, private cdp: CDPSession, private timeoutMs: number, private retries: number) {}
  static async create(page: Page, options: { timeoutMs?: number; retries?: number } = {}) {
    const cdp = await page.context().newCDPSession(page);
    const agent = new BrowserAgent(page, cdp, options.timeoutMs ?? 5000, options.retries ?? 1);
    await cdp.send('Network.enable'); await cdp.send('Runtime.enable'); await cdp.send('Accessibility.enable');
    cdp.on('Network.requestWillBeSent', e => agent.record('network', `${e.request.method} ${e.request.url}`));
    cdp.on('Runtime.consoleAPICalled', e => agent.record('console', e.args.map(a => String(a.value ?? a.description ?? '')).join(' ')));
    return agent;
  }
  private record(kind: RecordedEvent['kind'], message: string) { this.events.push({ kind, timestamp: Date.now(), message }); if (this.events.length > 1000) this.events.shift(); }
  async snapshot() { const { nodes } = await this.cdp.send('Accessibility.getFullAXTree'); return nodes.filter(n => !n.ignored).map(n => ({ role: n.role?.value, name: n.name?.value, value: n.value?.value, nodeId: n.nodeId })); }
  async act(action: Action): Promise<string | void> {
    for (let attempt = 0; ; attempt++) {
      try {
        if (action.type === 'navigate') { await this.page.goto(action.url, { timeout: this.timeoutMs, waitUntil: 'domcontentloaded' }); return; }
        // A fresh locator on each attempt resolves a replaced element again.
        const locator = this.page.locator(action.selector);
        if (action.type === 'click') await locator.click({ timeout: this.timeoutMs });
        else if (action.type === 'fill') await locator.fill(action.value, { timeout: this.timeoutMs });
        else return await locator.innerText({ timeout: this.timeoutMs });
        return;
      } catch (error) {
        if (attempt >= this.retries || !(error instanceof Error) || !/timeout|detached|not attached/i.test(error.message)) throw error;
      }
    }
  }
  async close() { await this.cdp.detach(); }
}
