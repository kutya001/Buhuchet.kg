import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Bell, bellCountText, bellGroups, type BellProps, type BellRowView } from './bell';

// Колокольчик (доработки 16.11.2026, блок 3; прототип v123 `bellPaint`, `bellCount`, `bellListHtml`).

const labels: BellProps['labels'] = {
  title: 'Уведомления',
  unseen: 'Уведомления: непросмотренных 120',
  readAll: 'Прочитать все',
  close: 'Закрыть',
  tabs: 'Что показать',
  empty: 'Новых уведомлений нет',
  showAll: 'Показать все',
  more: 'Показать ещё',
  unread: 'Не открыто',
  error: 'Ошибка',
  retry: 'Повторить',
};
const props = (over: Partial<BellProps> = {}): BellProps => ({
  unseen: 0,
  open: false,
  onOpenChange: () => {},
  labels,
  tabs: [{ value: 'all', label: 'Все' }],
  tab: 'all',
  onTab: () => {},
  rows: [],
  error: false,
  onRetry: () => {},
  more: false,
  loadingMore: false,
  onMore: () => {},
  canReadAll: false,
  onReadAll: () => {},
  canShowAll: false,
  onRow: () => {},
  ...over,
});

describe('колокольчик', () => {
  it('число на значке: 1–99, дальше «99+»', () => {
    expect(bellCountText(1)).toBe('1');
    expect(bellCountText(99)).toBe('99');
    expect(bellCountText(100)).toBe('99+');
  });

  it('значок: без непросмотренных — серый без числа; с ними — жёлтый с красным числом', () => {
    const quiet = renderToStaticMarkup(<Bell {...props()} />);
    expect(quiet).toContain('aria-label="Уведомления"');
    expect(quiet).not.toContain('data-bell-count');
    expect(quiet).toContain('aria-expanded="false"');
    const loud = renderToStaticMarkup(<Bell {...props({ unseen: 120 })} />);
    expect(loud).toContain('aria-label="Уведомления: непросмотренных 120"');
    expect(loud).toContain('text-warn');
    expect(loud).toMatch(/data-bell-count=""[^>]*>99\+<\/span>/);
  });

  it('группы «Сегодня / Вчера / Раньше» — подряд по списку', () => {
    const row = (id: string, group: string): BellRowView => ({
      id,
      icon: 'info',
      contractor: null,
      text: id,
      at: '',
      group,
      read: true,
    });
    expect(
      bellGroups([row('a', 'Сегодня'), row('b', 'Сегодня'), row('c', 'Вчера'), row('d', 'Раньше')]),
    ).toEqual([
      { group: 'Сегодня', rows: [row('a', 'Сегодня'), row('b', 'Сегодня')] },
      { group: 'Вчера', rows: [row('c', 'Вчера')] },
      { group: 'Раньше', rows: [row('d', 'Раньше')] },
    ]);
  });
});
