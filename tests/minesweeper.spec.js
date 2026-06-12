const { test, expect } = require('@playwright/test');

test('homepage links to minesweeper', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: '扫雷' })).toBeVisible();
  await page.getByRole('link', { name: '扫雷' }).click();
  await expect(page).toHaveURL(/\/minesweeper\/index\.html$/);
  await expect(page.getByRole('heading', { name: '扫雷' })).toBeVisible();
});

test('classic difficulties use fixed board sizes and mine counts', async ({ page }) => {
  await page.goto('/minesweeper/index.html');

  await expect(page.locator('.cell')).toHaveCount(81);
  await expect(page.locator('#mineCounter')).toHaveText('10');

  await page.getByRole('button', { name: /中级/ }).click();
  await expect(page.locator('.cell')).toHaveCount(256);
  await expect(page.locator('#mineCounter')).toHaveText('40');

  await page.getByRole('button', { name: /高级/ }).click();
  await expect(page.locator('.cell')).toHaveCount(480);
  await expect(page.locator('#mineCounter')).toHaveText('99');
});

test('first reveal keeps the selected cell and neighbors mine-free', async ({ page }) => {
  await page.goto('/minesweeper/index.html');
  await page.locator('[data-index="40"]').click();

  const state = await page.evaluate(() => window.__minesweeper.getState());
  const center = 40;
  const row = Math.floor(center / state.cols);
  const col = center % state.cols;
  const safeIndexes = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow >= 0 && nextRow < state.rows && nextCol >= 0 && nextCol < state.cols) {
        safeIndexes.push(nextRow * state.cols + nextCol);
      }
    }
  }

  expect(state.status).toBe('playing');
  expect(state.firstReveal).toBe(false);
  expect(safeIndexes.every((index) => !state.cells[index].mine)).toBe(true);
});

test('right click toggles flag mark without revealing the cell', async ({ page }) => {
  await page.goto('/minesweeper/index.html');
  const cell = page.locator('[data-index="10"]');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-mark', 'flag');
  await expect(cell).toHaveText('⚑');
  expect(await page.evaluate(() => window.__minesweeper.getState().flaggedCount)).toBe(1);

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-mark', '');
  expect(await page.evaluate(() => window.__minesweeper.getState().flaggedCount)).toBe(0);
});

test('number quick reveal opens surrounding unflagged safe cells', async ({ page }) => {
  await page.goto('/minesweeper/index.html');

  let scenario;
  for (let attempt = 0; attempt < 8 && !scenario; attempt++) {
    if (attempt > 0) {
      await page.getByRole('button', { name: '新局' }).click();
    }
    await page.locator('[data-index="40"]').click();
    scenario = await page.evaluate(() => {
      const state = window.__minesweeper.getState();
      const neighbors = (index) => {
        const row = Math.floor(index / state.cols);
        const col = index % state.cols;
        const result = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nextRow = row + dr;
            const nextCol = col + dc;
            if (nextRow >= 0 && nextRow < state.rows && nextCol >= 0 && nextCol < state.cols) {
              result.push(nextRow * state.cols + nextCol);
            }
          }
        }
        return result;
      };

      for (const cell of state.cells) {
        if (!cell.revealed || cell.mine || cell.adjacent === 0) continue;
        const around = neighbors(cell.index);
        const mineNeighbors = around.filter((index) => state.cells[index].mine);
        const hiddenSafeNeighbors = around.filter((index) => {
          const next = state.cells[index];
          return !next.mine && !next.revealed;
        });
        if (mineNeighbors.length === cell.adjacent && hiddenSafeNeighbors.length > 0) {
          return {
            numberIndex: cell.index,
            mineNeighbors,
            hiddenSafeNeighbors,
          };
        }
      }
      return null;
    });
  }

  expect(scenario).not.toBeNull();
  for (const index of scenario.mineNeighbors) {
    await page.locator(`[data-index="${index}"]`).click({ button: 'right' });
  }
  await page.locator(`[data-index="${scenario.numberIndex}"]`).click();

  const allOpened = await page.evaluate((indexes) => {
    const state = window.__minesweeper.getState();
    return indexes.every((index) => state.cells[index].revealed);
  }, scenario.hiddenSafeNeighbors);
  expect(allOpened).toBe(true);
});

test('revealing every safe cell wins and stores local best time', async ({ page }) => {
  await page.goto('/minesweeper/index.html');
  await page.evaluate(() => localStorage.removeItem('mini-games-minesweeper-best-beginner'));
  await page.getByRole('button', { name: '新局' }).click();
  await page.locator('[data-index="40"]').click();

  const safeIndexes = await page.evaluate(() => {
    return window.__minesweeper.getState().cells
      .filter((cell) => !cell.mine)
      .map((cell) => cell.index);
  });

  for (const index of safeIndexes) {
    const status = await page.evaluate(() => window.__minesweeper.getState().status);
    if (status === 'won') break;
    await page.locator(`[data-index="${index}"]`).click();
  }

  await expect(page.locator('#statusText')).toHaveText('胜利');
  expect(await page.evaluate(() => window.__minesweeper.getState().status)).toBe('won');
  expect(await page.evaluate(() => localStorage.getItem('mini-games-minesweeper-best-beginner'))).not.toBeNull();
  await expect(page.locator('#bestCounter')).not.toHaveText('--');
});

test.describe('mobile controls', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  test('long press toggles flag mark', async ({ page }) => {
    await page.goto('/minesweeper/index.html');
    const cell = page.locator('[data-index="10"]');
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cell.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    });
    await page.waitForTimeout(500);
    await cell.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    });

    await expect(cell).toHaveAttribute('data-mark', 'flag');
    expect(await page.evaluate(() => window.__minesweeper.getState().flaggedCount)).toBe(1);
  });

  test('expert board keeps playable cell size and scrolls horizontally', async ({ page }) => {
    await page.goto('/minesweeper/index.html');
    await page.getByRole('button', { name: /高级/ }).click();

    const layout = await page.evaluate(() => {
      const viewport = document.getElementById('boardViewport');
      const cell = document.querySelector('.cell');
      return {
        scrollWidth: viewport.scrollWidth,
        clientWidth: viewport.clientWidth,
        cellWidth: cell.getBoundingClientRect().width,
      };
    });

    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(layout.cellWidth).toBeGreaterThanOrEqual(32);
  });
});
