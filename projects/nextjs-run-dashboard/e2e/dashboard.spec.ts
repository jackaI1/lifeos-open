import { test, expect } from '@playwright/test';
test('filters, paginates and opens a trace with keyboard', async ({page})=>{
 await page.goto('/'); await expect(page.getByRole('heading',{name:'Browser runs'})).toBeVisible();
 await page.getByLabel('Status').selectOption('failed'); await page.getByRole('button',{name:'Apply filters'}).click();
 await expect(page.locator('.count')).toHaveText('9matching runs');
 await page.getByRole('link',{name:/Checkout flow/}).first().focus(); await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Step timeline'})).toBeVisible();
 await expect(page.getByText('The expected confirmation did not appear before the timeout.')).toBeVisible();
 await expect(page.getByAltText(/Screenshot for/).first()).toBeVisible();
 await expect(page.getByText(/steps, .* failed/)).toHaveCount(1);
});
test('shows empty results and navigates pages', async ({page})=>{
 await page.goto('/'); await page.getByRole('link',{name:'Next',exact:true}).click(); await expect(page.getByText('Page 2 of 4')).toBeVisible();
 await page.getByLabel('Search runs').fill('nothing matches this'); await page.getByRole('button',{name:'Apply filters'}).click(); await expect(page.getByText('No runs found')).toBeVisible();
});
