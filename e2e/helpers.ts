import { expect, type Locator, type Page } from '@playwright/test';

// Общее для сквозных тестов интерфейса: палец на телефоне и положение элемента после анимации.

export interface Point {
  x: number;
  y: number;
}

/**
 * Палец по экрану. `drag` — настоящие касания через протокол отладки Chromium: ведём по 12 px за кадр
 * и перед отпусканием останавливаемся (рывка нет); `holding` выполняется, пока палец ещё на экране.
 * `flick` — быстрый рывок с частотой экрана
 * 120 Гц: без экрана Chromium доставляет касания протокола раз в ~50 мс, и рывок вышел бы медленным,
 * поэтому события касания создаются на странице с нужными промежутками.
 */
export async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
  return {
    async drag(from: Point, to: Point, holding?: () => Promise<void>) {
      const steps = Math.max(4, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 12));
      await send('touchStart', from);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        });
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(150);
      await holding?.();
      await send('touchEnd');
    },
    flick: (from: Point, to: Point) =>
      page.evaluate(
        async ([a, b]) => {
          const target = document.elementFromPoint(a.x, a.y)!;
          let last = new Touch({ identifier: 1, target, clientX: a.x, clientY: a.y });
          const fire = (type: string, touches: Touch[]) =>
            target.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches,
                targetTouches: touches,
                changedTouches: [last],
              }),
            );
          fire('touchstart', [last]);
          for (let i = 1; i <= 6; i++) {
            await new Promise((r) => setTimeout(r, 8));
            last = new Touch({
              identifier: 1,
              target,
              clientX: a.x + ((b.x - a.x) * i) / 6,
              clientY: a.y + ((b.y - a.y) * i) / 6,
            });
            fire('touchmove', [last]);
          }
          fire('touchend', []);
        },
        [from, to] as const,
      ),
  };
}

/** Положение элемента, когда анимация появления закончилась (два одинаковых замера подряд). */
export async function settledBox(locator: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const now = JSON.stringify(box);
      const same = box !== null && now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return (await locator.boundingBox())!;
}
