import {mkdir} from 'node:fs/promises';
import {assert, button, go, saved} from './helpers.mjs';

export default async function({page: p}) {
  // A real task mutation must reach both charts via the normal navigation path.
  await go(p, 'school');
  await button(p, 'New task').click();
  await p.getByLabel('Task title', {exact: true}).fill('Plan the fictional prototype');
  await p.getByLabel('Due date', {exact: true}).fill('2026-10-20');
  await p.getByLabel('Estimated minutes', {exact: true}).fill('90');
  await button(p, 'Save task').click(); await saved(p);
  await p.getByRole('link', {name: 'Week workload', exact: true}).click();
  await p.getByRole('heading', {name: 'Week workload', exact: true}).waitFor();
  assert.equal(await p.locator('.workload-day').count(), 7);
  assert.ok(await p.locator('.workload-cell').count() >= 14);
  assert.ok(await p.locator('.calendar-bar').evaluateAll(nodes => nodes.some(n => +n.getAttribute('width') > 0)));
  assert.ok(await p.locator('.task-bar').evaluateAll(nodes => nodes.some(n => +n.getAttribute('width') > 0)));
  assert.ok(await p.locator('.workload-axis .tick').count() > 20, 'D3 axes rendered');
  const tuesday = p.locator('.workload-day').nth(1);
  await tuesday.click();
  await p.getByRole('region', {name: 'Selected deadlines'}).getByRole('link', {name: 'Plan the fictional prototype'}).waitFor();
  assert.match(await tuesday.getAttribute('aria-label'), /1\.5 h remaining/);
  // Tab is the actual input; focus must reach a mark and show the same tooltip.
  await tuesday.press('Tab');
  assert.equal(await p.locator('.workload-day').nth(2).evaluate(n => n === document.activeElement), true);
  await p.getByRole('tooltip').waitFor();
  await p.keyboard.press('Enter');
  assert.match(await p.getByRole('region', {name: 'Selected deadlines'}).innerText(), /Wed/);
  await p.keyboard.press('Escape');
  assert.equal(await p.getByRole('tooltip').isVisible(), false);
  await p.locator('.workload-cell').nth(0).click();
  await p.keyboard.press('Tab');
  assert.equal(await p.locator('.workload-cell').nth(1).evaluate(n => n === document.activeElement), true);
  await p.keyboard.press('Space');
  await p.getByRole('region', {name: 'Selected deadlines'}).getByRole('link', {name: 'Plan the fictional prototype'}).waitFor();
  await mkdir('.runtime/e2e/workload', {recursive: true});
  const viewport = p.viewportSize().width < 600 ? 'phone' : 'desktop';
  await p.locator('.workload-chart').nth(1).scrollIntoViewIfNeeded();
  await p.screenshot({path: `.runtime/e2e/workload/heat-${viewport}.png`, animations: 'disabled'});
  // Empty future weeks must clear the previous chart data and offer a way back.
  await button(p, 'Next week').click();
  assert.ok(await p.locator('.task-bar').evaluateAll(nodes => nodes.every(n => +n.getAttribute('width') === 0)));
  assert.ok(await p.locator('.workload-cell text').evaluateAll(nodes => nodes.every(n => n.textContent === '0')));
  await button(p, 'Previous week').click();
  assert.match(await p.locator('.workload-day').nth(1).getAttribute('aria-label'), /1\.5 h remaining/);
  await button(p, 'Next week').click(); await button(p, 'This week').click();
  await p.reload({waitUntil: 'networkidle'});
  assert.match(await p.locator('.workload-day').nth(1).getAttribute('aria-label'), /1\.5 h remaining/);
  // The seeded task also has saved instructions and an assignment brief.
  await p.locator('.workload-day').nth(2).click();
  await p.getByRole('region', {name: 'Selected deadlines'}).getByRole('link', {name: 'Map the feedback loop'}).click();
  await p.getByRole('heading', {name: 'Map the feedback loop', exact: true}).waitFor();
  await button(p, 'Academics').click();
  await p.getByRole('link', {name: 'Week workload', exact: true}).click();
  await p.locator('.workload-chart').first().scrollIntoViewIfNeeded();
  await p.screenshot({path: `.runtime/e2e/workload/timeline-${viewport}.png`, animations: 'disabled'});
  const fit = await p.locator('.workload-view').evaluate(n => ({width: innerWidth, right: n.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > innerWidth}));
  assert.equal(fit.overflow, false);
  assert.ok(fit.right <= fit.width);
}
