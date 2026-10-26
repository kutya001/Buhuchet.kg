import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast, TOAST_MS, toastLife, ToastProvider } from './toast';

const LABELS = { close: 'Закрыть уведомление', closeTitle: 'Закрыть' };

describe('уведомления внизу экрана (ТЗ «Принципы оформления»)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('исчезает само примерно через 3 секунды', () => {
    const gone = vi.fn();
    toastLife(gone);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(gone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(gone).toHaveBeenCalledOnce();
    expect(TOAST_MS).toBeGreaterThanOrEqual(3000);
    expect(TOAST_MS).toBeLessThanOrEqual(3500);
  });

  it('пока палец держит уведомление, оно не исчезает; отпустили после срока — исчезает', () => {
    const gone = vi.fn();
    const life = toastLife(gone);
    life.hold();
    vi.advanceTimersByTime(TOAST_MS + 2000);
    expect(gone).not.toHaveBeenCalled();
    life.release();
    expect(gone).toHaveBeenCalledOnce();
    life.release();
    expect(gone).toHaveBeenCalledOnce();
  });

  it('отпустили до срока — исчезает в срок', () => {
    const gone = vi.fn();
    const life = toastLife(gone);
    life.hold();
    vi.advanceTimersByTime(1000);
    life.release();
    expect(gone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TOAST_MS);
    expect(gone).toHaveBeenCalledOnce();
  });

  it('убрали крестиком или свайпом — срок больше не срабатывает', () => {
    const gone = vi.fn();
    toastLife(gone).stop();
    vi.advanceTimersByTime(TOAST_MS * 2);
    expect(gone).not.toHaveBeenCalled();
  });

  it('уведомление — для экранного диктора, крестик «Закрыть» виден только на ПК', () => {
    const html = renderToStaticMarkup(
      <Toast message="Сохранено" icon="check" bad={false} labels={LABELS} onGone={() => {}} />,
    );
    expect(html).toMatch(/^<div role="status"/);
    expect(html).toContain('<span>Сохранено</span>');
    expect(html).toMatch(
      /aria-label="Закрыть уведомление" title="Закрыть" class="[^"]*max-md:hidden/,
    );
    expect(html).toContain('bg-toast-bg');
    expect(html).not.toContain('text-brand-red');
    const bad = renderToStaticMarkup(
      <Toast message="Не сохранено" icon="alert" bad labels={LABELS} onGone={() => {}} />,
    );
    expect(bad).toContain('text-brand-red');
  });

  it('уведомления стоят столбиком по центру внизу, на телефоне — над нижней панелью', () => {
    const html = renderToStaticMarkup(
      <ToastProvider labels={LABELS}>
        <main>страница</main>
      </ToastProvider>,
    );
    expect(html).toContain('<main>страница</main>');
    expect(html).toMatch(
      /class="[^"]*fixed[^"]*left-1\/2[^"]*flex-col[^"]*max-md:bottom-\[calc\(84px/,
    );
  });
});
