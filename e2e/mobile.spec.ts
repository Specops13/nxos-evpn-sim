import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(() => localStorage.removeItem('nxos-evpn-lab-v1'));
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  mkdirSync('e2e-results', { recursive: true });
  await page.screenshot({ path: `e2e-results/${info.project.name}-topology.png` });
});

test('phone tabs do not overflow and the CLI accepts a command', async ({ page }, info) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(overflow).toBe(true);

  await page.getByTestId('tab-cli').click();
  await expect(page.getByTestId('command-input')).toBeVisible();
  await expect(page.getByTestId('device-select')).toBeVisible();
  await page.screenshot({ path: `e2e-results/${info.project.name}-cli.png` });
  await page.getByTestId('command-input').fill('show vlan');
  await page.getByTestId('send-command').click();
  await expect(page.getByTestId('terminal')).toContainText('VLAN Name');

  await page.getByTestId('tab-devices').click();
  await expect(page.getByTestId('example-clos-ibgp')).toBeVisible();
  await page.screenshot({ path: `e2e-results/${info.project.name}-devices.png` });
  const devicesOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(devicesOverflow).toBe(true);
});

test('tap-to-place and drag work on the topology', async ({ page }, info) => {
  const before = await page.getByTestId(/^device-/).count();
  await page.getByTestId('add-host').click();
  await expect(page.getByTestId('place-hint')).toBeVisible();
  const canvas = page.getByTestId('topology-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas missing');
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.72);
  await expect(page.getByTestId(/^device-/)).toHaveCount(before + 1);

  const node = page.getByTestId('device-leaf1');
  const start = await node.boundingBox();
  if (!start) throw new Error('leaf1 missing');
  await page.touchscreen.tap(start.x + 20, start.y + 20);
  const fromX = start.x + start.width / 2;
  const fromY = start.y + start.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 40, fromY + 30, { steps: 8 });
  await page.mouse.up();
  const moved = await node.boundingBox();
  expect(moved && start && (Math.abs(moved.x - start.x) > 2 || Math.abs(moved.y - start.y) > 2)).toBe(true);
  await page.screenshot({ path: `e2e-results/${info.project.name}-after-touch.png` });
});
