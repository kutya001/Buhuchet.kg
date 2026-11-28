import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Вкладки консоли (доработки 27.11.2026: консоль запросов, блок 1, пункты 2 и 5; прототип v166 `DMC`,
// `dmcState`, `dmConOpen`): свои у каждого входа, держатся в памяти страницы и в браузере как удобство.

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
  };
}

let storage: ReturnType<typeof fakeStorage>;

// Первый импорт модуля (с `@buhuchet/domain`) под нагрузкой `pnpm check` идёт дольше 5 с предела
// теста: прогреваем его один раз заранее, тесты потом берут модуль заново (`vi.resetModules`) быстро.
beforeAll(async () => {
  vi.stubGlobal('window', { localStorage: fakeStorage() });
  await import('./console-store');
  vi.unstubAllGlobals();
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  storage = fakeStorage();
  vi.stubGlobal('window', { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

const load = () => import('./console-store');

describe('consoleStore', () => {
  it('первый вход — одна вкладка с начальным запросом; новая и закрытая вкладка; последнюю закрыть — снова одна', async () => {
    const { consoleStore, CONSOLE_START_SQL } = await load();
    consoleStore.ensure('u1');
    let s = consoleStore.get();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ name: '', n: 1, sql: CONSOLE_START_SQL });
    consoleStore.add();
    s = consoleStore.get();
    expect(s.tabs.map((x) => x.n)).toEqual([1, 2]);
    expect(s.cur).toBe(1);
    consoleStore.close(0);
    expect(consoleStore.get().cur).toBe(0);
    consoleStore.close(0);
    s = consoleStore.get();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.n).toBe(3);
  });

  it('текст вкладки сохраняется в браузере и возвращается после перезагрузки страницы; у другого входа — свои', async () => {
    const first = await load();
    first.consoleStore.ensure('u1');
    const id = first.consoleStore.get().tabs[0]!.id;
    first.consoleStore.patch(id, { sql: 'SELECT 1', params: { a: '1' } });
    expect(JSON.parse(storage.data.get('bh_dmcon_u1')!).tabs[0].sql).toBe('SELECT 1');

    vi.resetModules();
    const again = await load();
    again.consoleStore.ensure('u1');
    expect(again.consoleStore.get().tabs[0]).toMatchObject({
      id,
      sql: 'SELECT 1',
      params: { a: '1' },
    });
    again.consoleStore.ensure('u2');
    expect(again.consoleStore.get().tabs[0]!.sql).toBe(again.CONSOLE_START_SQL);
  });

  it('хранилища нет или в нём мусор — консоль работает без него', async () => {
    storage.data.set('bh_dmcon_u1', '{not json');
    const { consoleStore } = await load();
    consoleStore.ensure('u1');
    expect(consoleStore.get().tabs).toHaveLength(1);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    consoleStore.add();
    expect(consoleStore.get().tabs).toHaveLength(2);
  });

  it('«Открыть в консоли»: шаблон и запрос «Моих запросов» — в свою же вкладку, иначе — новая; окно шаблона — по просьбе', async () => {
    const { consoleOpen, consoleStore } = await load();
    const tpl = { id: 't1', name: 'Шаблон', builtin: false };
    consoleOpen('u1', { sql: 'SELECT 1', name: 'Шаблон', tpl });
    consoleOpen('u1', { sql: 'SELECT 2', name: 'Шаблон', tpl, params: { a: 'x' } });
    let s = consoleStore.get();
    expect(s.tabs.filter((x) => x.tpl?.id === 't1')).toHaveLength(1);
    expect(s.tabs[s.cur]).toMatchObject({ sql: 'SELECT 2', params: { a: 'x' } });

    consoleOpen('u1', { sql: 'SELECT 3', name: 'Мой', mine: { id: 'm1', version: 1 } });
    consoleOpen('u1', { sql: 'SELECT 4', name: 'Мой 2', mine: { id: 'm1', version: 2 } });
    s = consoleStore.get();
    expect(s.tabs.filter((x) => x.mine?.id === 'm1')).toHaveLength(1);
    expect(s.tabs[s.cur]).toMatchObject({ sql: 'SELECT 4', name: 'Мой 2', mine: { version: 2 } });

    consoleOpen('u1', { sql: 'SELECT 5', name: 'Метод', toTemplate: true });
    s = consoleStore.get();
    const id = s.tabs[s.cur]!.id;
    expect(consoleStore.takeToTemplate()).toBe(id);
    expect(consoleStore.takeToTemplate()).toBeNull();

    consoleStore.forgetMine('m1');
    expect(consoleStore.get().tabs.some((x) => x.mine)).toBe(false);
  });

  it('вкладка «Заготовок» и «Собрать запрос» помнит, откуда она; из браузера — только известное (этап 2, П8–П9)', async () => {
    const { consoleOpen, consoleStore } = await load();
    consoleOpen('u1', { sql: 'SELECT 1', name: 'Заготовка', src: 'pre' });
    consoleOpen('u1', { sql: 'SELECT 2', name: 'Сборка: reports', src: 'build' });
    expect(consoleStore.get().tabs.map((x) => x.src)).toEqual([null, 'pre', 'build']);
    const saved = JSON.parse(storage.data.get('bh_dmcon_u1')!) as { tabs: { src: unknown }[] };
    saved.tabs[1]!.src = 'evil';
    storage.data.set('bh_dmcon_u1', JSON.stringify(saved));
    vi.resetModules();
    const again = await load();
    again.consoleStore.ensure('u1');
    expect(again.consoleStore.get().tabs.map((x) => x.src)).toEqual([null, null, 'build']);
  });

  it('«Выполнять как» запоминается в браузере у своего входа; не строка — администратор (этап 2, П7)', async () => {
    const first = await load();
    first.consoleStore.ensure('u1');
    expect(first.consoleStore.get().as).toBeNull();
    first.consoleStore.setAs('org-1');
    expect(JSON.parse(storage.data.get('bh_dmcon_u1')!).as).toBe('org-1');

    vi.resetModules();
    const again = await load();
    again.consoleStore.ensure('u1');
    expect(again.consoleStore.get().as).toBe('org-1');
    again.consoleStore.ensure('u2');
    expect(again.consoleStore.get().as).toBeNull();

    for (const junk of [42, '', { id: 'org-1' }]) {
      const saved = JSON.parse(storage.data.get('bh_dmcon_u1')!) as Record<string, unknown>;
      storage.data.set('bh_dmcon_u1', JSON.stringify({ ...saved, as: junk }));
      vi.resetModules();
      const next = await load();
      next.consoleStore.ensure('u1');
      expect(next.consoleStore.get().as, JSON.stringify(junk)).toBeNull();
    }
  });

  it('выход стирает вкладки всех входов; без входа в браузер ничего не пишется', async () => {
    const { consoleStore, consoleOpen, forgetConsoleTabs } = await load();
    consoleStore.ensure('u1');
    consoleStore.add();
    consoleOpen('u2', { sql: 'SELECT 2', name: 'Второй' });
    storage.data.set('bh_other', 'x');
    expect([...storage.data.keys()].filter((k) => k.startsWith('bh_dmcon_'))).toHaveLength(2);
    forgetConsoleTabs();
    expect([...storage.data.keys()]).toEqual(['bh_other']);
    consoleOpen('', { sql: 'SELECT 3', name: 'Без входа' });
    expect([...storage.data.keys()]).toEqual(['bh_other']);
  });
});
