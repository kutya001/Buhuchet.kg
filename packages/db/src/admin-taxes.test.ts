import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminTaxInfo,
  exportAdminTaxes,
  listAdminTaxPage,
  listAdminTaxValues,
} from './admin-taxes';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы» → «Налоги и ставки»: справка по НК КР',
  () => {
    let db: TestDatabase;
    let adminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedAllPlatformDictionaries(db.admin.db);
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'platform', passwordHash: '!', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
    });

    afterAll(async () => {
      await db?.drop();
    });

    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(db.app.db, adminId, fn);

    it('налоги и платежи: по коду, «Что это» из справки, виды отчётов кратко, «Сверить»', async () => {
      const page = await asAdmin((tx) => listAdminTaxPage(tx, 'taxes', query(), t));
      expect(page.total).toBe(30);
      expect(page.rows[0]!.id).toBe('НАЛ-01');
      const first = page.rows[0]!.values;
      expect(first.name).toBe('Подоходный налог, налоговый агент');
      expect(String(first.about).length).toBeGreaterThan(0);
      expect(first.verify).toBe('yes');
      expect(first.verify_text).toBe('Сверить');
      // Виды отчётов каталога — краткими названиями, не кодами.
      expect(String(first.types)).not.toMatch(/^\s*$/);
      expect(String(first.types)).not.toContain('rt_');

      const verify = await asAdmin((tx) => listAdminTaxValues(tx, 'taxes', 'verify', t));
      expect(verify.items.map((x) => x.label).sort()).toEqual(['Сверить', '—']);

      const found = await asAdmin((tx) =>
        listAdminTaxPage(tx, 'taxes', query({ search: { q: 'НДС', keys: [] } }), t),
      );
      expect(found.total).toBeGreaterThan(0);
      expect(found.total).toBeLessThan(30);

      const grouped = await asAdmin((tx) =>
        listAdminTaxPage(tx, 'taxes', query({ group: ['group'] }), t),
      );
      expect(grouped.groups?.map((g) => g.label)).toContain('Общегосударственные налоги');
    });

    it('ставки единого налога: по коду, «Когда применяется», ставка, условие и статья', async () => {
      const page = await asAdmin((tx) => listAdminTaxPage(tx, 'en_rates', query(), t));
      expect(page.total).toBe(20);
      expect(page.rows[0]!.values).toMatchObject({
        code: 'ЕНС-01',
        activity: 'Торговля, выручка за 12 месяцев до 50 млн сом',
        rate: '0,5 %',
        art: 'ст. 423 ч. 1 п. 1 «а»',
      });
    });

    it('ставки налога на имущество: сомы за м² — в тыйынах, по области; в выгрузке — деньги', async () => {
      const page = await asAdmin((tx) => listAdminTaxPage(tx, 'property_rates', query(), t));
      expect(page.total).toBe(73);
      const regions = page.rows.map((r) => String(r.values.region));
      expect(regions).toEqual([...regions].sort((a, b) => a.localeCompare(b, 'ru')));
      const city = page.rows.find((r) => r.id === 'ИМН-01')!.values;
      expect(city).toMatchObject({
        place: 'г. Джалал-Абад',
        homeA: 5050,
        homeB: 3400,
        homeLand: 120,
        bizA: 11600,
      });

      const file = await asAdmin((tx) =>
        exportAdminTaxes(
          tx,
          'property_rates',
          query({ search: { q: 'Джалал-Абад', keys: ['place'] } }),
          ['place', 'homeA'],
          t,
        ),
      );
      expect(file.total).toBe(1);
      expect(file.rows).toEqual([['г. Джалал-Абад', 5050]]);
    });

    it('пояснения вкладки: размер бизнеса, кто не может применять ЕН, ставки на имущество', async () => {
      const info = await asAdmin((tx) => adminTaxInfo(tx));
      expect(info.bizSize.map((x) => x.name)).toEqual(['Малый', 'Средний', 'Крупный']);
      expect(info.bizSize[0]!.rule).toBe('выручка за 12 месяцев до 8 млн сом');
      expect(info.enRates).toHaveLength(2);
      expect(info.enRates[0]).toMatch(/^Кто не может применять ЕН/);
      expect(info.propertyRates.length).toBeGreaterThan(0);
    });
  },
);
