import type { Page } from 'playwright-core';

export async function setChromeWindowState(page: Page, minimize: boolean) {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    if (minimize || bounds.windowState === 'minimized') {
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: minimize ? 'minimized' : 'normal' } });
    }
  } finally { await session.detach(); }
}
