import type { GridViewSettings } from '@buhuchet/domain';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActionList, menuPosition } from '../action-menu';
import { DataGrid, GridChips, GridFooter, pickRows, type DataGridProps } from './data-grid';
import { FilterPanel } from './grid-filter';
import { GridCards } from './grid-cards';
import { GridTable } from './grid-table';
import { ColumnsPanel, GridBulkBar, GridToolbar, GroupPanel } from './grid-toolbar';
import { rowEvents } from './row-events';
import type { GridColumn, GridLabels, GridRowSelection } from './types';

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
  selected: (n) => `Выбрано: ${n}`,
  clearSelection: 'Снять выбор',
  selectAll: 'Выбрать все на странице',
  selectRow: 'Выбрать строку',
  selectCard: 'Выбрать',
  createdBy: 'Создал',
  updatedBy: 'Изменил',
  createdAt: 'Создано',
  updatedAt: 'Изменено',
  notFound: 'Ничего не найдено',
  notFoundText: 'Под поиск и фильтры не подходит ни одна запись.',
  resetFilters: 'Сбросить фильтры',
  filter: 'Фильтр',
  filterOf: (label) => `Фильтр: ${label}`,
  filterContains: 'Содержит…',
  filterFrom: 'От',
  filterTo: 'До',
  filterBounds: 'Границы включительно',
  filterSince: 'С даты',
  filterUntil: 'По дату',
  filterBadNumber: 'Введите число, например 1 250,50',
  filterFind: 'Найти значение',
  filterAll: 'Выбрать все',
  empty: '(Пусто)',
  filterLoading: 'Загружаю значения…',
  filterLoadError: 'Не удалось загрузить значения.',
  filterMore: (n) => `Показаны первые ${n} значений`,
  clear: 'Очистить',
  apply: 'Применить',
  groupByColumn: 'Группировать по этому столбцу',
  ungroupColumn: 'Убрать группировку по этому столбцу',
  groupReplaced: 'Не больше двух уровней — второй уровень заменён',
  group: 'Группировка',
  groupN: (n) => `Группировка (${n})`,
  groupButtonHint: 'Группировать список по столбцам (до двух уровней)',
  groupLevel1: 'Уровень 1',
  groupLevel2: 'Уровень 2 (внутри первого)',
  groupNone: '— нет —',
  groupAggs: 'Итоги в строке группы',
  groupHint: 'Не больше двух уровней.',
  groupRemove: 'Убрать',
  aggNone: 'Не считать',
  agg: { sum: 'Сумма', avg: 'Среднее', min: 'Минимум', max: 'Максимум', count: 'Количество' },
  groupsShown: (g, n) => `Групп: ${g} · записей: ${n}`,
  expandAll: 'Развернуть все',
  collapseAll: 'Свернуть все',
  chipGroup: 'Группировка:',
  chipSearch: 'Поиск:',
  chipFrom: (v) => `от ${v}`,
  chipTo: (v) => `до ${v}`,
  chipSince: (v) => `с ${v}`,
  chipUntil: (v) => `по ${v}`,
  chipMore: (n) => `+${n}`,
  ungroup: 'Убрать группировку',
  clearSearch: 'Очистить поиск',
  removeFilter: 'Убрать фильтр',
  resetAll: 'Сбросить всё',
  excel: 'В Excel',
  excelHint: 'Скачать файл Excel со всеми отфильтрованными записями',
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

  it('приглушённая строка (заблокированный сотрудник) — не бледнее второстепенного текста', () => {
    const html = grid({ rowTone: (p) => (p.active ? undefined : 'muted') });
    expect(html).toMatch(/data-id="p2"[^>]*\[&amp;&gt;td\]:text-muted/);
    expect(html).not.toMatch(/data-id="p1"[^>]*\[&amp;&gt;td\]:text-muted/);
    expect(html).not.toContain('[&amp;&gt;td]:text-faint');
  });

  it('служебные столбцы «Создал», «Изменил», «Создано», «Изменено» список добавляет сам', () => {
    const own = COLUMNS.filter((c) => !c.audit);
    const html = grid({
      columns: own,
      audit: {
        createdBy: (p) => p.by,
        updatedBy: () => '',
        createdAt: (p) => p.at,
        updatedAt: () => '',
      },
      settings: { shown: ['name', 'createdBy', 'createdAt'] },
    });
    expect(headers(html)).toEqual(['name', 'role', 'active', 'createdBy', 'createdAt']);
    expect(html).toContain('Столбцы (5/9)');
    expect(html).toContain('title="Кутман О."');
    const cards = grid({
      columns: own,
      audit: {
        createdBy: (p) => p.by,
        updatedBy: () => '',
        createdAt: (p) => p.at,
        updatedAt: () => '',
      },
      settings: { view: 'cards', shown: ['createdBy', 'createdAt'] },
    });
    expect(cards).toContain('Создал: Кутман О., 12.03.2026 10:15');
  });
});

describe('выбор строк галочками и массовые действия (ТЗ «Действия над записью», прототип cfg.bulk)', () => {
  const bulk = [{ id: 'confirm', label: 'Подтвердить', run: vi.fn() }];
  const selection = (ids: string[], over: Partial<GridRowSelection<Person>> = {}) => ({
    has: (p: Person) => ids.includes(p.id),
    toggle: vi.fn(),
    allOnPage: false,
    togglePage: vi.fn(),
    ...over,
  });
  const table = (sel: GridRowSelection<Person>, rows = people(3)) =>
    renderToStaticMarkup(
      <GridTable
        columns={COLUMNS.slice(0, 2)}
        allKeys={COLUMNS.map((c) => c.key)}
        rows={rows}
        rowKey={(p) => p.id}
        settings={{}}
        onSettingsChange={() => {}}
        sort={null}
        onSort={() => {}}
        totals={{}}
        total={rows.length}
        hasActions={false}
        clickable={false}
        events={rowEvents({ timer: undefined, start: null, pressed: false }, {})}
        selection={sel}
        label="Сотрудники"
        labels={LABELS}
      />,
    );

  it('без массовых действий галочек нет', () => {
    expect(grid()).not.toContain('Выбрать строку');
  });

  it('с действиями — столбец галочек и «Выбрать все на странице»; пока ничего не выбрано — число записей', () => {
    const html = grid({ bulk });
    expect(html.match(/aria-label="Выбрать строку"/g)).toHaveLength(25);
    expect(html).toContain('aria-label="Выбрать все на странице"');
    expect(html).toContain('<col style="width:38px"/>');
    expect(html).toContain('250 сотрудников');
    expect(html).not.toContain('data-grid-bulk');
  });

  it('отмеченная строка подсвечена; все отмечены — галочка в заголовке', () => {
    const html = table(selection(['p2']));
    expect(html).toMatch(/data-id="p2"[^>]*\[&amp;&gt;td\]:bg-sel/);
    expect(html).not.toMatch(/data-id="p1"[^>]*\[&amp;&gt;td\]:bg-sel/);
    const boxes = html.match(/<input type="checkbox"[^>]*>/g)!;
    expect(boxes.filter((b) => b.includes('checked=""'))).toHaveLength(1);
    const all = table(selection(['p1', 'p2', 'p3'], { allOnPage: true }));
    expect(all).toMatch(
      /<input type="checkbox" aria-label="Выбрать все на странице"[^>]*checked=""/,
    );
  });

  it('галочка строки и «Выбрать все на странице» передают выбор', () => {
    const sel = selection([]);
    const html = table(sel);
    expect(html).toContain('aria-label="Выбрать строку"');
    const tree = GridCards<Person>({
      columns: COLUMNS.slice(0, 3),
      rows: people(2),
      rowKey: (p) => p.id,
      hasActions: false,
      clickable: false,
      events: rowEvents({ timer: undefined, start: null, pressed: false }, {}),
      selection: sel,
      totals: {},
      total: 2,
      labels: LABELS,
    });
    const [box] = find(tree, 'input');
    expect(box!.props['aria-label']).toBe('Выбрать');
    box!.props.onChange!({ target: { value: '', checked: true } });
    expect(sel.toggle).toHaveBeenCalledWith(people(2)[0], true);
  });

  it('выбор по ключу записи: отметить, снять, страница целиком', () => {
    const key = (p: Person) => p.id;
    const [a, b, c] = people(3);
    let picked = pickRows(new Map(), [a!], true, key);
    picked = pickRows(picked, [b!, c!], true, key);
    expect([...picked.keys()]).toEqual(['p1', 'p2', 'p3']);
    picked = pickRows(picked, [b!], false, key);
    expect([...picked.values()]).toEqual([a, c]);
    expect(pickRows(picked, [a!, b!, c!], false, key).size).toBe(0);
  });

  it('панель «Выбрано: N»: действие получает отмеченные строки, «Снять выбор»', () => {
    const run = vi.fn();
    const clear = vi.fn();
    const action = {
      id: 'block',
      label: 'Заблокировать',
      icon: 'lock' as const,
      danger: true,
      run,
    };
    const bar = { count: 2, actions: [bulk[0]!, action], onRun: vi.fn(), onClear: clear };
    const html = renderToStaticMarkup(<GridBulkBar selection={bar} labels={LABELS} />);
    expect(html).toContain('<b>Выбрано: 2</b>');
    expect(html).toContain('role="toolbar"');
    expect(html).toMatch(/<button[^>]*bg-danger-btn[^>]*>.*Заблокировать/);
    const buttons = find(GridBulkBar({ selection: bar, labels: LABELS }), 'button');
    expect(buttons.map((x) => x.props['aria-label'])).toEqual([
      undefined,
      undefined,
      'Снять выбор',
    ]);
    buttons[1]!.props.onClick!();
    expect(bar.onRun).toHaveBeenCalledWith(action);
    buttons[2]!.props.onClick!();
    expect(clear).toHaveBeenCalledOnce();
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
      group: [],
      onGroupChange: () => {},
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

  it('выбраны строки — вместо числа записей панель «Выбрано: N»', () => {
    const html = renderToStaticMarkup(
      toolbar({
        selection: { count: 3, actions: [], onRun: () => {}, onClear: () => {} },
      }),
    );
    expect(html).toContain('Выбрано: 3');
    expect(html).not.toContain('250 сотрудников');
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
    // Выбор на телефоне запоминается отдельно от ПК: переключатель вида — первый элемент с `onChange`.
    const tree = toolbar({ phone: true, view: 'cards', onSettingsChange: change });
    const toggle = (tree.props as { children: ReactNode[] }).children
      .flat()
      .find(
        (n): n is ReactElement<{ onChange: (v: 'table' | 'cards') => void }> =>
          isValidElement<{ onChange?: unknown }>(n) && typeof n.props.onChange === 'function',
      );
    toggle!.props.onChange('table');
    expect(change).toHaveBeenCalledWith({ phoneView: 'table' });
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

describe('поиск, фильтры и группировка (задача #15)', () => {
  const grouped = {
    items: [people(1)[0]!, { ...people(2)[1]!, balance: 125050 }],
    total: 2,
    page: 1,
    totals: {},
    groups: [
      {
        key: 'Бухгалтер',
        label: 'Бухгалтер',
        count: 2,
        aggs: { balance: 125150 },
        sub: [
          { key: 'true', label: 'Активен', count: 1, aggs: { balance: 100 } },
          { key: 'false', label: 'Заблокирован', count: 1, aggs: { balance: 125050 } },
        ],
      },
    ],
    rowGroups: [
      ['Бухгалтер', 'true'],
      ['Бухгалтер', 'false'],
    ],
  };
  const withBalance = { shown: ['name', 'role', 'active', 'balance'] };

  it('группы двух уровней: строки групп с числом записей и итогами, внизу «Групп · записей»', () => {
    const html = grid({ settings: { ...withBalance, group: ['role', 'active'] }, data: grouped });
    expect(html).toContain('data-group="›Бухгалтер" data-group-level="0"');
    expect(html).toContain('data-group="›Бухгалтер›true" data-group-level="1"');
    expect(html).toContain('data-group="›Бухгалтер›false" data-group-level="1"');
    // Название группы — на столбцы до первого числового, итог — под «Балансом».
    expect(html).toMatch(/<td colSpan="3"[^>]*><button type="button" aria-expanded="true"/);
    expect(html).toContain('title="Сумма: Баланс"');
    expect(html).toContain('1 251,50');
    expect(html).toContain('1 250,50');
    // Вложенная группа — с отступом.
    expect(html).toContain('padding-left:22px');
    expect(html.match(/data-id="/g)).toHaveLength(2);
    expect(html).toContain('Групп: 1 · записей: 2');
    expect(html).toContain('Развернуть все');
    expect(html).toContain('Свернуть все');
    expect(html).not.toContain('data-grid-page');
    expect(html).toContain('<b class="font-[650]">Группировка:</b> Роль → Статус');
    expect(html).toContain('Группировка (2)');
  });

  it('«Не считать» у числового столбца — в строке группы пусто', () => {
    const html = grid({
      settings: { ...withBalance, group: ['role'], agg: { balance: 'none' } },
      data: { ...grouped, groups: [{ ...grouped.groups[0]!, sub: undefined }] },
    });
    expect(html).not.toContain('title="Сумма: Баланс"');
    expect(html).not.toContain('1 251,50');
  });

  it('карточки: группы — заголовками с числом записей и итогами', () => {
    const html = grid({
      settings: {
        ...withBalance,
        view: 'cards',
        group: ['role', 'active'],
        agg: { balance: 'max' },
      },
      data: grouped,
    });
    expect(html).toContain('data-grid-groups');
    expect(html).toMatch(/<div data-group="›Бухгалтер" data-group-level="0"/);
    expect(html).toContain('Баланс (максимум):');
    expect(html.match(/data-grid-cards/g)).toHaveLength(2);
  });

  it('фильтры: кнопка у заголовка, у столбца с фильтром — нажата; чипы и «Сбросить всё»', () => {
    const html = grid({
      settings: withBalance,
      filters: {
        name: { type: 'text', q: 'ива' },
        balance: { type: 'num', from: 10000 },
        gone: { type: 'text', q: 'x' },
      },
      onFiltersChange: () => {},
      search: 'Сотр',
    });
    expect(html).toMatch(
      /data-filter-button="name" aria-label="Фильтр: ФИО" title="Фильтр"[^>]*aria-pressed="true"/,
    );
    expect(html).toMatch(/data-filter-button="role"[^>]*aria-pressed="false"/);
    expect(html).toContain('<b class="font-[650]">ФИО:</b> «ива»');
    expect(html).toContain('<b class="font-[650]">Баланс:</b> от 100');
    expect(html).toContain('<b class="font-[650]">Поиск:</b> «Сотр»');
    expect(html).not.toContain('data-chip="gone"');
    expect(html).toContain('Сбросить всё');
  });

  it('без `onFiltersChange` кнопок фильтра нет; без поиска, фильтров и групп нет и чипов', () => {
    const html = grid();
    expect(html).not.toContain('data-filter-button');
    expect(html).not.toContain('data-grid-chips');
  });

  it('пусто под поиском или фильтром — «Ничего не найдено», без них — пустое состояние экрана', () => {
    const none = { items: [], total: 0, page: 1, totals: {} };
    const found = grid({ data: none, search: 'нет такого' });
    expect(found).toContain('Ничего не найдено');
    expect(found).toContain('Под поиск и фильтры не подходит ни одна запись.');
    expect(found).toContain('Сбросить фильтры');
    expect(found).not.toContain('пусто');
    const filtered = grid({
      data: none,
      filters: { name: { type: 'text', q: 'я' } },
      onFiltersChange: () => {},
    });
    expect(filtered).toContain('Ничего не найдено');
    expect(grid({ data: none })).toContain('<p>пусто</p>');
  });

  it('чипы: крестик убирает свой фильтр, группировку или поиск; «Сбросить всё» — фильтры и поиск', () => {
    const remove = vi.fn();
    const ungroup = vi.fn();
    const clear = vi.fn();
    const reset = vi.fn();
    const buttons = find(
      GridChips({
        group: ['Роль'],
        onUngroup: ungroup,
        search: 'ив',
        onClearSearch: clear,
        filters: [{ key: 'active', label: 'Статус', text: 'Активен' }],
        onRemove: remove,
        onResetAll: reset,
        labels: LABELS,
      }),
      'button',
    );
    expect(buttons.map((b) => b.props['aria-label'] ?? 'reset')).toEqual([
      'Убрать группировку',
      'Очистить поиск',
      'Убрать фильтр',
      'reset',
    ]);
    buttons.forEach((b) => b.props.onClick!());
    expect(ungroup).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('active');
    expect(reset).toHaveBeenCalledOnce();
  });

  it('меню столбца по типу: текст — «Содержит…», число — «От» и «До», дата — «С даты» и «По дату»', () => {
    const panel = (key: string, filter?: Parameters<typeof FilterPanel<Person>>[0]['filter']) =>
      renderToStaticMarkup(
        <FilterPanel
          column={COLUMNS.find((c) => c.key === key)!}
          filter={filter}
          grouped={key === 'role'}
          onApply={() => {}}
          onToggleGroup={() => {}}
          labels={LABELS}
        />,
      );
    const text = panel('name', { type: 'text', q: 'ив' });
    expect(text).toContain('placeholder="Содержит…"');
    expect(text).toContain('value="ив"');
    expect(text).toContain('Группировать по этому столбцу');
    expect(text).toContain('Очистить');
    expect(text).toContain('Применить');
    const num = panel('balance', { type: 'num', from: 125050 });
    expect(num).toContain('placeholder="От"');
    expect(num).toContain('placeholder="До"');
    expect(num).toContain('value="1 250,50"');
    expect(num).toContain('Границы включительно');
    const date = panel('at', { type: 'date', to: '2026-03-31' });
    expect(date).toContain('С даты');
    expect(date).toContain('type="date"');
    expect(date).toContain('value="2026-03-31"');
    // Справочник: значения грузятся с сервера; столбец уже в группировке — «Убрать группировку…».
    const enumPanel = panel('role');
    expect(enumPanel).toContain('Убрать группировку по этому столбцу');
  });

  it('окно «Группировка»: два уровня из всех столбцов, итоги у видимых числовых столбцов', () => {
    const html = renderToStaticMarkup(
      <GroupPanel
        columns={COLUMNS}
        keys={COLUMNS.map((c) => c.key)}
        visible={['name', 'role', 'balance']}
        settings={{ group: ['role'], agg: { balance: 'avg' } }}
        onApply={() => {}}
        labels={LABELS}
      />,
    );
    expect(html).toContain('Уровень 1');
    expect(html).toContain('Уровень 2 (внутри первого)');
    expect(html).toContain('<option value="">— нет —</option>');
    expect(html).toContain('<option value="role" selected="">Роль</option>');
    expect(html).toContain('Итоги в строке группы');
    expect(html).toContain('<option value="avg" selected="">Среднее</option>');
    expect(html).toContain('<option value="none">Не считать</option>');
    expect(html).toContain('Убрать');
  });

  it('панель: «Группировка (N)» и «В Excel» — только когда выгрузка разрешена; на телефоне — значки', () => {
    const toolbar = (over: Partial<Parameters<typeof GridToolbar<Person>>[0]>) =>
      renderToStaticMarkup(
        <GridToolbar
          columns={COLUMNS}
          defaultVisible={DEFAULT_VISIBLE}
          settings={{}}
          onSettingsChange={() => {}}
          onResetView={() => {}}
          view="table"
          phone={false}
          total={3}
          group={[]}
          onGroupChange={() => {}}
          labels={LABELS}
          {...over}
        />,
      );
    const desk = toolbar({ onExport: () => {} });
    expect(desk).toContain('title="Группировать список по столбцам (до двух уровней)"');
    expect(desk).toContain('>Группировка<');
    expect(desk).toMatch(
      /title="Скачать файл Excel со всеми отфильтрованными записями"[^>]*>.*В Excel/,
    );
    expect(toolbar({})).not.toContain('data-grid-export');
    const phone = toolbar({ phone: true, group: ['role', 'active'], onExport: () => {} });
    expect(phone).toContain('aria-label="Группировка (2)"');
    expect(phone).toMatch(/aria-hidden="true"[^>]*>2<\/span>/);
    expect(phone).toContain('aria-label="В Excel"');
  });
});
