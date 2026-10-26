import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Справочники платформы для контрагентов и отчётов (задача #20): наполнение из spec/data/refDB.json,
// отключённое значение не предлагается для новых записей, производственный календарь.
type Entry = { active: boolean };
type RefDB = {
  reportTypes: (Entry & { id: string })[];
  dictionaries: Record<'regimes' | 'benefits' | 'bases' | 'ugns' | 'organs', { items: Entry[] }>;
  holidays: Record<string, string>;
  workingSaturdays: string[];
};
const refDB = JSON.parse(
  readFileSync(new URL('../spec/data/refDB.json', import.meta.url), 'utf8'),
) as RefDB;
const d = refDB.dictionaries;

const DICTS: [string, Entry[]][] = [
  ['/api/report-types', refDB.reportTypes],
  ['/api/tax-regimes', d.regimes.items],
  ['/api/tax-benefits', d.benefits.items],
  ['/api/report-bases', d.bases.items],
  ['/api/tax-offices', d.ugns.items],
  ['/api/authorities', d.organs.items],
];

type Item = { code: string; active: boolean };
type CalendarDay = { date: string; kind: string; name: string; everyYear: boolean };

test.describe('Этап 1: справочники платформы', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await signIn(request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
  });

  test('после наполнения число записей в каждой таблице совпадает с refDB.json, отключённое значение не приходит в списке для новых записей', async ({
    request,
  }) => {
    for (const [path, entries] of DICTS) {
      const all = (await (await request.get(`${path}?all=true`)).json()) as { items: Item[] };
      expect(all.items, path).toHaveLength(entries.length);
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const { items } = (await res.json()) as { items: Item[] };
      const off = entries.filter((e) => !e.active).length;
      expect(items, path).toHaveLength(entries.length - off);
      expect(
        items.every((i) => i.active),
        path,
      ).toBe(true);
    }
    // Отключённые виды отчётов (например, «Т-1 квартальная») есть только в полном списке.
    const types = (await (await request.get('/api/report-types')).json()) as { items: Item[] };
    const disabled = refDB.reportTypes.filter((t) => !t.active).map((t) => t.id);
    expect(disabled.length).toBeGreaterThan(0);
    expect(types.items.map((t) => t.code)).not.toEqual(expect.arrayContaining([disabled[0]]));
  });

  test('производственный календарь 2026 знает праздники и рабочие субботы из refDB.json', async ({
    request,
  }) => {
    const res = await request.get('/api/production-calendar?year=2026');
    expect(res.status()).toBe(200);
    const { days } = (await res.json()) as { days: CalendarDay[] };
    const byDate = new Map(days.map((x) => [x.date, x]));

    for (const [key, name] of Object.entries(refDB.holidays)) {
      const date = key.length === 5 ? `2026-${key}` : key;
      if (!date.startsWith('2026-')) {
        expect(byDate.has(date), date).toBe(false);
        continue;
      }
      expect(byDate.get(date), date).toMatchObject({ name, everyYear: key.length === 5 });
    }
    const saturdays = refDB.workingSaturdays.filter((k) => k.startsWith('2026-'));
    expect(saturdays.length).toBeGreaterThan(0);
    for (const date of saturdays) expect(byDate.get(date)?.kind, date).toBe('workday');
    // Перенос выходного — отдельный вид дня.
    expect(byDate.get('2026-03-09')?.kind).toBe('transfer');
    expect(byDate.get('2026-01-01')?.kind).toBe('holiday');
  });
});
