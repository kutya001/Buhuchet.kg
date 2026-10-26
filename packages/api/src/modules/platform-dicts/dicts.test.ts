import { databaseAvailable, seedPlatformDictionaries } from '@buhuchet/db/testing';
import {
  Authorities,
  ProductionCalendarYear,
  ReportBases,
  ReportTypes,
  TaxBenefits,
  TaxOffices,
  TaxRegimes,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Число записей и отключённых значений — как в spec/data/refDB.json (проверка наполнения — в пакете db).
const DICTS = [
  ['/api/report-types', ReportTypes, 145, ['pvt', 'ims', 'imu', 'trn', 'zem', 't1q', 'pre', 'inv']],
  ['/api/tax-regimes', TaxRegimes, 12, 1],
  ['/api/tax-benefits', TaxBenefits, 31, 0],
  ['/api/report-bases', ReportBases, 14, 1],
  ['/api/tax-offices', TaxOffices, 65, 7],
  ['/api/authorities', Authorities, 15, 0],
] as const;

describe.skipIf(!databaseAvailable())('Справочники платформы для контрагентов и отчётов', () => {
  let f: Fixture;
  let cookie: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedPlatformDictionaries(f.t.admin.db);
    cookie = await signIn(f.app, 'acc-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('по умолчанию — только действующие значения; all=true — все, по порядку справочника', async () => {
    for (const [path, schema, total, disabled] of DICTS) {
      const active = schema.parse(await (await apiRequest(f.app, 'GET', path, cookie)).json());
      const all = schema.parse(
        await (await apiRequest(f.app, 'GET', `${path}?all=true`, cookie)).json(),
      );
      const off = all.items.filter((i) => !i.active).map((i) => i.code);
      expect(all.items, path).toHaveLength(total);
      if (typeof disabled === 'number') expect(off, path).toHaveLength(disabled);
      else expect(off, path).toEqual(disabled);
      expect(active.items.map((i) => i.code)).toEqual(
        all.items.filter((i) => i.active).map((i) => i.code),
      );
      const explicit = schema.parse(
        await (await apiRequest(f.app, 'GET', `${path}?all=false`, cookie)).json(),
      );
      expect(explicit.items).toHaveLength(active.items.length);
    }
  });

  it('вид отчёта ссылается на орган, режимы и основания кодами', async () => {
    const res = await apiRequest(f.app, 'GET', '/api/report-types', cookie);
    const { items } = ReportTypes.parse(await res.json());
    const nds = items.find((t) => t.code === 'nds')!;
    expect(nds).toMatchObject({ period: 'M', act: 'both', shiftToWorkday: true });
    const authorities = Authorities.parse(
      await (await apiRequest(f.app, 'GET', '/api/authorities', cookie)).json(),
    ).items.map((a) => a.code);
    expect(authorities).toContain(nds.authorityCode);
    const regimes = TaxRegimes.parse(
      await (await apiRequest(f.app, 'GET', '/api/tax-regimes?all=true', cookie)).json(),
    ).items.map((r) => r.code);
    for (const t of items) {
      for (const code of [...t.regimes, ...t.notForRegimes]) expect(regimes).toContain(code);
    }
  });

  it('администратор платформы тоже читает справочники', async () => {
    const admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    const res = await apiRequest(f.app, 'GET', '/api/tax-offices', admin);
    expect(res.status).toBe(200);
    const { items } = TaxOffices.parse(await res.json());
    expect(items.every((o) => o.active)).toBe(true);
  });

  it('производственный календарь 2026: праздники, переносы и рабочие субботы из refDB.json', async () => {
    const res = await apiRequest(f.app, 'GET', '/api/production-calendar?year=2026', cookie);
    expect(res.status).toBe(200);
    const { year, days } = ProductionCalendarYear.parse(await res.json());
    expect(year).toBe(2026);
    const byDate = new Map(days.map((d) => [d.date, d]));
    expect(byDate.get('2026-01-01')).toMatchObject({ kind: 'holiday', everyYear: true });
    expect(byDate.get('2026-03-09')).toMatchObject({ kind: 'transfer', everyYear: false });
    expect(byDate.get('2026-03-14')).toMatchObject({ kind: 'workday', everyYear: false });
    expect(byDate.get('2026-03-20')?.kind).toBe('holiday');
    expect(days.every((d) => d.date.startsWith('2026-'))).toBe(true);
    expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort());

    // В другой год приходят только праздники «каждый год».
    const next = ProductionCalendarYear.parse(
      await (await apiRequest(f.app, 'GET', '/api/production-calendar?year=2030', cookie)).json(),
    );
    expect(next.days.length).toBeGreaterThan(0);
    expect(next.days.every((d) => d.everyYear && d.kind === 'holiday')).toBe(true);
  });

  it('неверный год или признак — 400; без входа — 401', async () => {
    for (const q of ['', '?year=abc', '?year=1999', '?year=2026.5']) {
      const res = await apiRequest(f.app, 'GET', `/api/production-calendar${q}`, cookie);
      expect(res.status, q).toBe(400);
    }
    expect((await apiRequest(f.app, 'GET', '/api/report-types?all=yes', cookie)).status).toBe(400);
    for (const [path] of DICTS) {
      expect((await apiRequest(f.app, 'GET', path)).status, path).toBe(401);
    }
    expect((await apiRequest(f.app, 'GET', '/api/production-calendar?year=2026')).status).toBe(401);
  });
});
