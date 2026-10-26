import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Icon } from '../icon';
import { ICONS, type IconName } from '../icons';
import { MenuItems } from '../menu';
import { Popover } from '../popover';
import { AppFrame } from './app-frame';
import { SideFootButton, SideNav, SideOrg } from './side-nav';
import { TabRow, type AddAction } from './tab-row';
import { TopBar, type TopBarProps } from './top-bar';
import type { ShellModule } from './types';

const MODULES: ShellModule[] = [
  { id: 'home', title: 'Главная', icon: 'home', href: '/app/home/today', tabs: [] },
  {
    id: 'reports',
    title: 'Отчеты для сдачи',
    icon: 'file',
    href: '/app/reports/week',
    count: { value: 74, tone: 'red', title: 'Просрочено' },
    tabs: [
      { id: 'week', label: 'На неделе', icon: 'calendar', href: '/app/reports/week' },
      {
        id: 'overdue',
        label: 'Просрочено',
        icon: 'alert',
        href: '/app/reports/overdue',
        count: { value: 0, tone: 'red' },
      },
    ],
  },
];

const LABELS = { nav: 'Модули', expand: 'Раскрыть вкладки', collapse: 'Свернуть вкладки' };

/** Элементы нужного типа внутри разметки (без DOM: компонент без хуков — обычная функция). */
function find<P>(tree: ReactNode, type: string): ReactElement<P>[] {
  const found: ReactElement<P>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<{ children?: ReactNode }>(n)) return;
    if (n.type === type) found.push(n as ReactElement<P>);
    walk(n.props.children);
  };
  walk(tree);
  return found;
}

function sideNav(props: Partial<Parameters<typeof SideNav>[0]> = {}) {
  return {
    mode: 'Business',
    modules: MODULES,
    activeModule: 'reports',
    activeTab: 'week',
    openIds: new Set<string>(),
    onToggle: () => {},
    labels: LABELS,
    footer: <span>низ</span>,
    ...props,
  };
}

describe('SideNav — панель модулей на ПК', () => {
  it('модули в переданном порядке, активный отмечен, у модуля — красный счётчик', () => {
    const html = renderToStaticMarkup(<SideNav {...sideNav()} />);
    expect(html).toContain('aria-label="Модули"');
    expect(html.indexOf('Главная')).toBeLessThan(html.indexOf('Отчеты для сдачи'));
    expect(html).toMatch(/href="\/app\/reports\/week" aria-current="page"/);
    expect(html).not.toMatch(/href="\/app\/home\/today" aria-current/);
    expect(html).toContain('title="Просрочено"');
    expect(html).toContain('>74</span>');
    expect(html).toContain('<span>низ</span></div></aside>');
  });

  it('вкладки скрыты, пока ветка не раскрыта; у модуля без вкладок нет стрелки', () => {
    const html = renderToStaticMarkup(<SideNav {...sideNav()} />);
    expect(html).not.toContain('На неделе');
    expect(html).toContain('aria-label="Раскрыть вкладки: Отчеты для сдачи"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Раскрыть вкладки: Главная');
  });

  it('раскрытая ветка показывает вкладки, активная вкладка отмечена; нулевой счётчик — серый', () => {
    const html = renderToStaticMarkup(<SideNav {...sideNav({ openIds: new Set(['reports']) })} />);
    expect(html).toContain('aria-label="Свернуть вкладки: Отчеты для сдачи"');
    expect(html).toMatch(/href="\/app\/reports\/week" aria-current="page"[^>]*>.*На неделе/);
    expect(html).toMatch(/href="\/app\/reports\/overdue" class="[^"]*text-muted/);
    expect(html).toMatch(/bg-sel text-muted[^"]*">0</);
  });

  it('стрелка раскрывает и сворачивает ветку модуля', () => {
    const onToggle = vi.fn();
    const [toggle] = find<{ onClick: () => void }>(SideNav(sideNav({ onToggle })), 'button');
    toggle!.props.onClick();
    expect(onToggle).toHaveBeenCalledWith('reports');
  });

  it('свой компонент ссылки сайта (Next.js Link) используется для всех ссылок', () => {
    const Link = vi.fn((p: { href: string; children?: ReactNode }) => (
      <a data-own href={p.href}>
        {p.children}
      </a>
    ));
    const html = renderToStaticMarkup(
      <SideNav {...sideNav({ openIds: new Set(['reports']), Link })} />,
    );
    expect(html.match(/data-own/g)).toHaveLength(4);
  });
});

describe('низ левой панели', () => {
  it('организация с ИНН ведёт в профиль организации', () => {
    const html = renderToStaticMarkup(
      <SideOrg
        name="ОсОО «Бухгалтер Плюс»"
        sub="ИНН 01203201910123"
        href="/app/org"
        title="Профиль организации"
      />,
    );
    expect(html).toContain('href="/app/org"');
    expect(html).toContain('title="Профиль организации"');
    expect(html).toContain('ИНН 01203201910123');
  });

  it('«Выйти из аккаунта»: нажатие и неактивное состояние', () => {
    const onClick = vi.fn();
    const [button] = find<{ onClick: () => void }>(
      SideFootButton({ icon: 'logout', label: 'Выйти из аккаунта', onClick }),
      'button',
    );
    button!.props.onClick();
    expect(onClick).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(
      <SideFootButton icon="logout" label="Выйти из аккаунта" onClick={() => {}} disabled />,
    );
    expect(html).toContain('disabled=""');
  });
});

const TOP: TopBarProps = {
  title: 'Отчеты для сдачи',
  tab: 'На неделе',
  menu: { label: 'Меню', onClick: () => {} },
  info: { label: 'Описание модуля', content: <p>Все отчёты</p> },
  search: {
    value: 'НДС',
    onChange: () => {},
    placeholder: 'Поиск по текущей вкладке',
    scope: 'На неделе',
  },
  clock: <time>10:33</time>,
  help: { label: 'Помощь', title: 'Помощь по модулю', content: () => <p>Помощь</p> },
  theme: { label: 'Тема', title: 'Сменить тему', onToggle: () => {} },
};

describe('TopBar — верхняя панель', () => {
  it('«Меню», модуль и вкладка, поиск по вкладке, время, «?» и тема', () => {
    const html = renderToStaticMarkup(<TopBar {...TOP} />);
    expect(html).toContain('<header');
    expect(html).toContain('aria-label="Меню"');
    expect(html).toContain('title="Отчеты для сдачи · На неделе"');
    expect(html).toMatch(/<b[^>]*>Отчеты для сдачи<\/b>/);
    expect(html).toContain('role="search"');
    expect(html).toContain('value="НДС"');
    expect(html).toContain('placeholder="Поиск по текущей вкладке"');
    expect(html).toContain('<time>10:33</time>');
    expect(html).toContain('aria-label="Помощь"');
    expect(html).toContain('aria-label="Тема"');
  });

  it('значок темы выбирается стилями: «луна» в светлой, «солнце» в тёмной', () => {
    const html = renderToStaticMarkup(<TopBar {...TOP} />);
    expect(html).toContain(`<span class="bu-light-only inline-grid"><svg`);
    expect(html).toContain(ICONS.moon);
    expect(html).toContain(`<span class="bu-dark-only"><svg`);
    expect(html).toContain(ICONS.sun);
  });

  it('без вкладки — только название модуля; окошки «ⓘ» и «?» закрыты', () => {
    const html = renderToStaticMarkup(<TopBar {...TOP} tab={null} />);
    expect(html).toContain('title="Отчеты для сдачи"');
    expect(html).not.toContain('Все отчёты');
    expect(html).toContain('aria-expanded="false"');
  });
});

const TABS = MODULES[1]!.tabs;
const ACTIONS: AddAction[] = [
  { id: 'bulk', label: 'Назначить отчёты массово', icon: 'table' },
  { id: 'one', label: 'Разовый отчёт', icon: 'file', sub: 'Вне назначений', badge: 'Бета' },
];

describe('TabRow — вкладки и «+ Добавить»', () => {
  it('вкладки — ссылки с ролью tab, выбранная отмечена', () => {
    const html = renderToStaticMarkup(
      <TabRow
        tabs={TABS}
        activeTab="overdue"
        label="Отчеты"
        addActions={[]}
        addLabel="Добавить"
        onAdd={() => {}}
      />,
    );
    expect(html).toContain('role="tablist" aria-label="Отчеты"');
    expect(html).toMatch(/href="\/app\/reports\/overdue" role="tab" aria-selected="true"/);
    expect(html).toMatch(/href="\/app\/reports\/week" role="tab" aria-selected="false"/);
  });

  it('нет способов добавления — нет и кнопки «Добавить»', () => {
    const html = renderToStaticMarkup(
      <TabRow
        tabs={TABS}
        activeTab="week"
        label="Отчеты"
        addActions={[]}
        addLabel="Добавить"
        onAdd={() => {}}
      />,
    );
    expect(html).not.toContain('Добавить');
  });

  it('несколько способов — «+ Добавить» открывает меню; на телефоне — круглая «+» с подписью', () => {
    const html = renderToStaticMarkup(
      <TabRow
        tabs={TABS}
        activeTab="week"
        label="Отчеты"
        addActions={ACTIONS}
        addLabel="Добавить"
        onAdd={() => {}}
      />,
    );
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    expect(html).toContain('bg-accent text-on-accent');
    expect(html).toContain('<span>Добавить</span>');
    expect(html).toMatch(/aria-label="Добавить"[^>]*class="grid h-\[54px\]/);
    expect(html).toContain('md:hidden');
  });

  it('один способ — кнопка запускает его сразу, без меню', () => {
    const html = renderToStaticMarkup(
      <TabRow
        tabs={TABS}
        activeTab="week"
        label="Отчеты"
        addActions={ACTIONS.slice(0, 1)}
        addLabel="Добавить"
        onAdd={() => {}}
      />,
    );
    expect(html).not.toContain('aria-haspopup');
    expect(html).toContain('title="Назначить отчёты массово"');
  });

  it('отдельный способ — своей кнопкой на ПК рядом с «+ Добавить», на телефоне — в меню «+»', () => {
    const actions = [{ ...ACTIONS[0]!, separate: true }, ACTIONS[1]!];
    const html = renderToStaticMarkup(
      <TabRow
        tabs={TABS}
        activeTab="week"
        label="Отчеты"
        addActions={actions}
        addLabel="Добавить"
        onAdd={() => {}}
      />,
    );
    expect(html).toMatch(
      /<button type="button" title="Назначить отчёты массово" class="[^"]*max-md:hidden/,
    );
    // На ПК в «+ Добавить» остался один способ, у «+» на телефоне — оба (меню).
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(1);
    expect(html).toContain('title="Разовый отчёт"');
  });
});

describe('Popover и меню действий', () => {
  it('закрыто — только кнопка; открыто — окошко с ролью и названием', () => {
    const trigger = ({ open, id }: { open: boolean; id: string }) => (
      <button type="button" aria-expanded={open} aria-controls={id}>
        ⓘ
      </button>
    );
    const closed = renderToStaticMarkup(
      <Popover label="Описание" trigger={trigger}>
        {() => <p>текст</p>}
      </Popover>,
    );
    expect(closed).not.toContain('текст');
    const open = renderToStaticMarkup(
      <Popover label="Добавить" role="menu" placement="bottom-end" defaultOpen trigger={trigger}>
        {() => <p>текст</p>}
      </Popover>,
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/role="menu" aria-label="Добавить" class="[^"]*right-0/);
    expect(open).toContain('<p>текст</p>');
  });

  it('пункты меню: значок, название, метка «Бета», пояснение; выбор передаёт способ', () => {
    const html = renderToStaticMarkup(<MenuItems items={ACTIONS} onSelect={() => {}} />);
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).toContain('Бета</span>');
    expect(html).toContain('Вне назначений</span>');
    const onSelect = vi.fn();
    const items = MenuItems({ items: ACTIONS, onSelect }) as ReactElement<{
      onClick: () => void;
    }>[];
    items[1]!.props.onClick();
    expect(onSelect).toHaveBeenCalledWith('one');
  });
});

describe('AppFrame и значки', () => {
  it('скрытая левая панель отмечается на каркасе; рабочая область названа модулем', () => {
    const html = renderToStaticMarkup(
      <AppFrame navHidden side={<aside />} topBar={<header />} paneLabel="Контрагенты">
        <p>экран</p>
      </AppFrame>,
    );
    expect(html).toMatch(/^<div data-nav="hidden"/);
    expect(html).toContain('<main aria-label="Контрагенты"');
    expect(html).toContain('<p>экран</p>');
    const shown = renderToStaticMarkup(
      <AppFrame navHidden={false} side={null} topBar={null}>
        {null}
      </AppFrame>,
    );
    expect(shown).toMatch(/^<div data-nav="shown"/);
  });

  it('каждый значок прототипа рисуется и скрыт от экранного диктора', () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const html = renderToStaticMarkup(<Icon name={name} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(ICONS[name]);
    }
    expect(Object.keys(ICONS).length).toBeGreaterThan(70);
  });
});
