import type { GridViewSettings } from '@buhuchet/domain';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActionList, menuPosition } from '../action-menu';
import { DataGrid, GridFooter, type DataGridProps } from './data-grid';
import { ColumnsPanel, GridToolbar } from './grid-toolbar';
import type { GridColumn, GridLabels } from './types';

interface Person {
  id: string;
  name: string;
  login: string;
  role: string;
  active: boolean;
  balance: number;
  by: string;
  at: string;
}

const COLUMNS: GridColumn<Person>[] = [
  { key: 'name', label: 'ФИО', type: 'text', width: 270, text: (p) => p.name },
  {
    key: 'login',
    label: 'Логин',
    type: 'text',
    width: 100,
    text: (p) => p.login,
    className: 'font-mono',
  },
  { key: 'role', label: 'Роль', type: 'enum', width: 170, text: (p) => p.role },
  {
    key: 'active',
    label: 'Статус',
    type: 'enum',
    text: (p) => (p.active ? 'Активен' : 'Заблокирован'),
  },
  {
    key: 'balance',
    label: 'Баланс',
    type: 'money',
    text: (p) => String(p.balance),
    total: (v) => `${v} сом`,
  },
  { key: 'by', label: 'Создал', type: 'enum', audit: 'created', text: (p) => p.by },
  { key: 'at', label: 'Создано', type: 'datetime', audit: 'created', text: (p) => p.at },
];
const DEFAULT_VISIBLE = ['name', 'role', 'active'];
const BY_CREATED = { key: 'at', dir: 'desc' } as const;

const LABELS: GridLabels = {
  count: (n) => `${n} сотрудников`,
  view: 'Вид списка',
  table: 'Таблица',
  cards: 'Карточки',
  viewTo: (name) => `Вид списка: ${name}`,
  columns: 'Столбцы',
  columnsHint: 'Галочка — показать столбец.',
  system: 'системный',
  moveUp: 'Выше',
  moveDown: 'Ниже',
  dragHint: 'Перетащите, чтобы поменять порядок',
  viewOptions: 'Настройки вида',
  viewOptionsHint: 'Плотность и ширина',
  densityNormal: 'Обычно',
  densityCompact: 'Компактно',
  widthFull: 'На весь экран',
  widthCenter: 'По центру',
  resetView: 'Сбросить вид',
  resetViewSub: 'Столбцы, порядок, ширины, сортировка, плотность',
  sortBy: (label) => `Сортировать: ${label}`,
  columnWidth: 'Ширина столбца',
  actions: 'Действия',
  shown: (from, to, total) => `Показано ${from} – ${to} из ${total}`,
  perPage: 'На странице',
  allRows: 'Все записи',
  prev: 'Назад',
  next: 'Вперёд',
  loadError: 'Не удалось загрузить список',
  loadErrorText: 'Проверьте подключение к интернету и попробуйте ещё раз.',
  retry: 'Повторить',
  totalByFilter: (n) => `Итого по фильтру · ${n}`,
  createdLine: (t) => `Создал: ${t}`,
  updatedLine: (t) => `Изменил: ${t}`,
};

const people = (n: number): Person[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Сотрудник ${i + 1}`,
    login: `user${i + 1}`,
    role: 'Бухгалтер',
    active: i % 2 === 0,
    balance: 100,
    by: 'Кутман О.',
    at: '12.03.2026 10:15',
  }));

function grid(over: Partial<DataGridProps<Person>> = {}) {
  const props: DataGridProps<Person> = {
    columns: COLUMNS,
    defaultVisible: DEFAULT_VISIBLE,
    defaultSort: BY_CREATED,
    settings: {},
    onSettingsChange: () => {},
    onResetView: () => {},
    data: { items: people(25), total: 250, page: 1, totals: {} },
    onPageChange: () => {},
    empty: <p>пусто</p>,
    rowKey: (p) => p.id,
    label: 'Сотрудники',
    labels: LABELS,
    ...over,
  };
  return renderToStaticMarkup(<DataGrid {...props} />);
}

/** Заголовки таблицы по порядку. */
const headers = (html: string) =>
  [...html.matchAll(/<th scope="col" data-column="(\w+)"/g)].map((m) => m[1]);

type Clickable = ReactElement<{
  onClick?: () => void;
  onChange?: (e: { target: { value: string; checked?: boolean } }) => void;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  disabled?: boolean;
  title?: string;
  children?: ReactNode;
}>;

/** Элементы нужного тега внутри разметки (компонент без хуков вызывается как функция). */
function find(tree: ReactNode, tag: string): Clickable[] {
  const found: Clickable[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<{ children?: ReactNode }>(n)) return;
    if (n.type === tag) found.push(n as Clickable);
    walk(n.props.children);
  };
  walk(tree);
  return found;
}

describe('UnifiedDataGrid: таблица (ТЗ «Списки записей», прототип ui/grid.js)', () => {
  it('видны столбцы по умолчанию, остальные — в «Столбцы (видно / всего)»', () => {
    const html = grid();
    expect(headers(html)).toEqual(['name', 'role', 'active']);
    expect(html).toContain('Столбцы (3/7)');
    expect(html).toContain('250 сотрудников');
    expect(html).toContain('aria-label="Сотрудники"');
  });

  it('выбор пользователя: скрытые, порядок, ширина и плотность', () => {
    const settings: GridViewSettings = {
      shown: ['login', 'name'],
      hidden: ['role', 'active', 'balance', 'by', 'at'],
      order: ['login', 'name'],
      widths: { name: 320 },
      density: 'compact',
    };
    const html = grid({ settings });
    expect(headers(html)).toEqual(['login', 'name']);
    expect(html).toContain('<col style="width:100px"/><col style="width:320px"/>');
    expect(html).toContain('style="width:420px"');
    expect(html).toContain('data-density="compact"');
    expect(html).toContain('h-[31px]');
    expect(html).toContain('font-mono');
  });

  it('сортировка: стрелка у столбца и aria-sort', () => {
    const html = grid({ settings: { sort: { key: 'name', dir: 'asc' } } });
    expect(html).toMatch(/data-column="name"[^>]*aria-sort="ascending"/);
    expect(html).toMatch(/data-column="role"[^>]*aria-sort="none"/);
    expect(html).toContain('title="Сортировать: ФИО"');
  });

  it('в ответе только текущая страница; внизу — «Показано», «На странице» и страницы', () => {
    const html = grid({ data: { items: people(25), total: 250, page: 2, totals: {} } });
    expect(html.match(/<tr data-id=/g)).toHaveLength(25);
    expect(html).toContain('Показано 26 – 50 из 250');
    expect(html).toContain('2 / 10');
    expect(html).toContain('<option value="all">Все записи</option>');
  });

  it('действия записи — столбец «⋯»; без открытия строка не выглядит нажимаемой', () => {
    const withActions = grid({ actions: () => [], onOpen: () => {} });
    expect(withActions).toContain('aria-label="Действия"');
    expect(withActions).toContain('data-row-menu');
    expect(withActions).toContain('cursor-pointer');
    const plain = grid();
    expect(plain).not.toContain('data-row-menu');
    expect(plain).not.toMatch(/<tr data-id="p1" tabindex="0"[^>]*cursor-pointer/);
  });

  it('итоги по фильтру — закреплённая строка внизу из ответа сервера', () => {
    const html = grid({
      settings: { shown: ['name', 'balance'] },
      data: { items: people(3), total: 3, page: 1, totals: { balance: 300 } },
    });
    expect(html).toContain('<tfoot>');
    expect(html).toContain('Итого по фильтру · 3');
    expect(html).toContain('300 сом');
  });

  it('приглушённая строка (заблокированный сотрудник)', () => {
    const html = grid({ rowTone: (p) => (p.active ? undefined : 'muted') });
    expect(html).toMatch(/data-id="p2"[^>]*\[&amp;&gt;td\]:text-faint/);
    expect(html).not.toMatch(/data-id="p1"[^>]*\[&amp;&gt;td\]:text-faint/);
  });
});

describe('UnifiedDataGrid: состояния', () => {
  it('загрузка — заготовка строк, без страниц', () => {
    const html = grid({ data: undefined });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('animate-shimmer');
    expect(html).not.toContain('Показано');
  });

  it('ошибка — «Не удалось загрузить список» и «Повторить»', () => {
    const html = grid({ error: true, onRetry: () => {} });
    expect(html).toContain('Не удалось загрузить список');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('250 сотрудников');
  });

  it('пустой список — пустое состояние экрана', () => {
    const html = grid({ data: { items: [], total: 0, page: 1, totals: {} } });
    expect(html).toContain('<p>пусто</p>');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('Показано');
  });
});

describe('UnifiedDataGrid: карточки', () => {
  it('заголовок, пары «подпись — значение», строка «Создал»', () => {
    const html = grid({
      settings: { view: 'cards', shown: ['name', 'role', 'by', 'at'] },
      titleKey: 'name',
      data: { items: people(2), total: 2, page: 1, totals: {} },
    });
    expect(html).toContain('data-grid-cards');
    expect(html).not.toContain('<table');
    expect(html).toContain('<dt class="text-faint">Роль</dt>');
    expect(html).not.toContain('<dt class="text-faint">ФИО</dt>');
    expect(html).toContain('Создал: Кутман О., 12.03.2026 10:15');
    expect(html).toContain('data-view="cards"');
  });

  it('закреплённый вид — без переключателя «Таблица / Карточки»', () => {
    const html = grid({ fixedView: 'table', settings: { view: 'cards' } });
    expect(html).toContain('data-view="table"');
    expect(html).not.toContain('aria-label="Вид списка"');
  });
});

describe('панель над списком', () => {
  const toolbar = (over: Partial<Parameters<typeof GridToolbar<Person>>[0]> = {}) =>
    GridToolbar<Person>({
      columns: COLUMNS,
      defaultVisible: DEFAULT_VISIBLE,
      settings: {},
      onSettingsChange: () => {},
      onResetView: () => {},
      view: 'table',
      phone: false,
      total: 250,
      labels: LABELS,
      ...over,
    });

  it('ПК: «Таблица» и «Карточки» подписаны, выбор запоминается в настройках', () => {
    const change = vi.fn();
    const seg = find(toolbar({ onSettingsChange: change }), 'button');
    expect(seg.map((b) => b.props['aria-pressed'])).toEqual([true, false]);
    seg[1]!.props.onClick!();
    expect(change).toHaveBeenCalledWith({ view: 'cards' });
  });

  it('телефон: одна кнопка-значок вида с подписью для диктора', () => {
    const change = vi.fn();
    const html = renderToStaticMarkup(
      toolbar({ phone: true, view: 'cards', onSettingsChange: change }),
    );
    expect(html).toContain('aria-label="Вид списка: Таблица"');
    expect(html).toContain('aria-label="Столбцы (3/7)"');
    expect(html).toContain('aria-label="Настройки вида"');
    expect(html).not.toContain('<span>Таблица</span>');
  });
});

describe('меню «Столбцы» (прототип colsPop)', () => {
  const panel = (settings: GridViewSettings, onSettingsChange = vi.fn()) =>
    renderToStaticMarkup(
      <ColumnsPanel
        columns={COLUMNS}
        defaultVisible={DEFAULT_VISIBLE}
        settings={settings}
        onSettingsChange={onSettingsChange}
        labels={LABELS}
      />,
    );

  it('все столбцы по порядку с галочками; служебные помечены «системный»', () => {
    const html = panel({});
    expect([...html.matchAll(/data-column="(\w+)"/g)].map((m) => m[1])).toEqual([
      'name',
      'login',
      'role',
      'active',
      'balance',
      'by',
      'at',
    ]);
    expect(html.match(/<input type="checkbox"[^>]*checked=""/g)).toHaveLength(3);
    expect(html.match(/>системный</g)).toHaveLength(2);
    expect(html).toContain('disabled="" aria-label="Выше: ФИО"');
  });

  it('последний видимый столбец скрыть нельзя', () => {
    const html = panel({ hidden: ['role', 'active'] });
    const boxes = html.match(/<input type="checkbox"[^>]*>/g)!;
    expect(boxes.filter((b) => b.includes('checked=""'))).toHaveLength(1);
    expect(boxes.filter((b) => b.includes('disabled=""'))).toEqual(
      boxes.filter((b) => b.includes('checked=""')),
    );
  });
});

describe('низ списка', () => {
  it('«Назад» и «Вперёд» листают, «На странице» меняет размер', () => {
    const go = vi.fn();
    const size = vi.fn();
    const tree = GridFooter({
      page: 1,
      total: 250,
      size: 25,
      onPageChange: go,
      onSizeChange: size,
      labels: LABELS,
    });
    const [prev, next] = find(tree, 'button');
    expect(prev!.props.disabled).toBe(true);
    expect(next!.props.disabled).toBe(false);
    next!.props.onClick!();
    expect(go).toHaveBeenCalledWith(2);
    const [select] = find(tree, 'select');
    select!.props.onChange!({ target: { value: 'all' } });
    select!.props.onChange!({ target: { value: '100' } });
    expect(size.mock.calls).toEqual([['all'], [100]]);
  });

  it('«Все записи» — одна страница', () => {
    const html = renderToStaticMarkup(
      <GridFooter
        page={1}
        total={250}
        size="all"
        onPageChange={() => {}}
        onSizeChange={() => {}}
        labels={LABELS}
      />,
    );
    expect(html).toContain('Показано 1 – 250 из 250');
    expect(html).toContain('1 / 1');
  });
});

describe('меню действий записи (прототип ui/popups.js, menu и openPop)', () => {
  it('опасное — красным, недоступное — с причиной, группы — через черту', () => {
    const run = vi.fn();
    const pick = vi.fn();
    const items = [
      { id: 'open', label: 'Открыть', icon: 'eye' as const, run },
      { id: 'sep', separator: true as const },
      { id: 'block', label: 'Заблокировать', icon: 'lock' as const, danger: true, run },
      {
        id: 'reset',
        label: 'Сбросить пароль',
        icon: 'key' as const,
        disabled: true,
        reason: 'Пароль владельца сбрасывает администратор платформы',
        run,
      },
    ];
    const html = renderToStaticMarkup(<ActionList items={items} onPick={pick} />);
    expect(html).toContain('role="separator"');
    expect(html).toMatch(/<button[^>]*text-danger[^>]*>.*Заблокировать/);
    expect(html).toContain('Пароль владельца сбрасывает администратор платформы');
    expect(html).toMatch(/<button type="button" role="menuitem" disabled=""/);
    const [open] = find(ActionList({ items, onPick: pick }), 'button');
    open!.props.onClick!();
    expect(pick).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it('меню в точке нажатия и у кнопки — не ближе 8 px к краям окна', () => {
    const viewport = { w: 390, h: 844 };
    const size = { w: 220, h: 200 };
    expect(menuPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
    expect(menuPosition({ x: 300, y: 800 }, size, viewport)).toEqual({ x: 162, y: 636 });
    const anchor = (r: Partial<DOMRect>) =>
      ({ getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, ...r }) }) as never;
    // Под кнопкой по левому краю; не помещается справа — по правому краю кнопки.
    expect(
      menuPosition(
        { anchor: anchor({ left: 20, right: 47, top: 50, bottom: 77 }) },
        size,
        viewport,
      ),
    ).toEqual({
      x: 20,
      y: 83,
    });
    expect(
      menuPosition(
        { anchor: anchor({ left: 340, right: 367, top: 50, bottom: 77 }) },
        size,
        viewport,
      ),
    ).toEqual({ x: 147, y: 83 });
    // Не помещается снизу — над кнопкой.
    expect(
      menuPosition(
        { anchor: anchor({ left: 20, right: 47, top: 760, bottom: 787 }) },
        size,
        viewport,
      ),
    ).toEqual({ x: 20, y: 554 });
  });
});
