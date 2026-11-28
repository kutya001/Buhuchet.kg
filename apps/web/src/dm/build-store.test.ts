import { describe, expect, it } from 'vitest';
import { buildTabName } from './build-dialog';
import { buildStore } from './build-store';

// «Собрать запрос» (консоль, этап 2, П9; прототип v167 `dmcBuild`): одно окно на страницу.

describe('buildStore', () => {
  it('окно рисует первый хост; новая просьба — новый номер; «Закрыть» — то же окно закрыто', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    const offA = buildStore.claim(a);
    const offB = buildStore.claim(b);
    expect(buildStore.isHost(a)).toBe(true);
    expect(buildStore.isHost(b)).toBe(false);
    buildStore.open(['reports'], { method: 'GET /x' });
    const first = buildStore.get()!;
    expect(first).toMatchObject({ open: true, names: ['reports'], method: 'GET /x', notes: null });
    buildStore.close();
    expect(buildStore.get()).toMatchObject({ n: first.n, open: false });
    buildStore.open(['contractors']);
    expect(buildStore.get()!.n).toBe(first.n + 1);
    offA();
    expect(buildStore.isHost(b)).toBe(true);
    offB();
    expect(buildStore.isHost(b)).toBe(false);
  });

  it('название вкладки — «Сборка: …», не длиннее 60 знаков', () => {
    const name = (list: string) => `Сборка: ${list}`;
    expect(buildTabName(name, ['reports', 'contractors'])).toBe('Сборка: reports, contractors');
    const long = buildTabName(name, ['one_off_service_payments', 'contractors', 'money_operations']);
    expect(long).toHaveLength(60);
    expect(long.endsWith('…')).toBe(true);
  });
});
