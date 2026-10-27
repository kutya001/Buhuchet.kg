import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminAnswerDictRequest,
  countNewDictRequests,
  listAdminDictRequestsPage,
} from './admin-dict-requests';
import {
  adminDictCreate,
  adminDictDelete,
  adminDictHistory,
  adminDictMove,
  adminDictSetActive,
  adminDictUpdate,
  adminDictUsage,
  exportAdminDict,
  getAdminDictValue,
  listAdminDictPage,
  listAdminDictValues,
} from './admin-platform-dicts';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { createDictRequest, listDictRequests } from './dict-requests';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  authorities,
  countryPhoneCodes,
  dueChangeReasons,
  orgAccounts,
  ownershipForms,
  reportTypeBases,
  taxOffices,
  taxRegimes,
  users,
} from './schema';
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

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

let seq = 0;
const random = () => `t${++seq}`;

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы»: правит только администратор платформы',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    let adminId: string;
    let blockedAdminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedAllPlatformDictionaries(db.admin.db);
      const [admin, blocked] = await db.admin.db
        .insert(users)
        .values([
          { login: 'platform', passwordHash: '!', isPlatformAdmin: true },
          { login: 'platform-old', passwordHash: '!', isPlatformAdmin: true, blocked: true },
        ])
        .returning({ id: users.id });
      adminId = admin!.id;
      blockedAdminId = blocked!.id;
      org = await createOrganization(db.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash: '!' },
      });
    });

    afterAll(async () => {
      await db?.drop();
    });

    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(db.app.db, adminId, fn);
    const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
      withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);

    it('список формы собственности: «№» по порядку, «Используется», «Статус», по умолчанию — по «№»', async () => {
      const page = await asAdmin((tx) => listAdminDictPage(tx, 'forms', query(), t));
      expect(page.total).toBeGreaterThan(20);
      expect(page.rows.slice(0, 3).map((x) => [x.n, x.code, x.name])).toEqual([
        [1, 'ФС-01', 'ОсОО'],
        [2, 'ФС-02', 'ИП'],
        [3, 'ФС-03', 'ОАО'],
      ]);
      expect(page.rows[0]!.data).toMatchObject({ declarationFor: 'org' });
      expect(page.rows[0]!.audit.createdAt).toBeNull();
      const ip = await asAdmin((tx) =>
        listAdminDictPage(
          tx,
          'forms',
          query({ filters: { declarationFor: { type: 'enum', vals: ['ip'] } } }),
          t,
        ),
      );
      expect(ip.rows.map((x) => x.data.declarationFor)).toEqual(ip.rows.map(() => 'ip'));
      const values = await asAdmin((tx) => listAdminDictValues(tx, 'forms', 'declarationFor', t));
      expect(values.items.map((x) => x.label)).toEqual(
        expect.arrayContaining(['Организация', 'ИП']),
      );
    });

    it('УГНС — без «№», по умолчанию по региону; «Контрагентов» и «Используется»', async () => {
      const page = await asAdmin((tx) => listAdminDictPage(tx, 'ugns', query(), t));
      expect(page.rows.every((x) => x.n === null)).toBe(true);
      const regions = page.rows.map((x) => x.data.region as string);
      expect(regions).toEqual([...regions].sort((a, b) => a.localeCompare(b, 'ru')));
      const linked = page.rows.find((x) => x.usage.total > 0);
      // Ссылки льгот на управление — «Используется», но не «Контрагентов».
      if (linked) expect(linked.usage.contractors).toBe(0);
      const file = await asAdmin((tx) =>
        exportAdminDict(tx, 'ugns', query(), ['gnsCode', 'name', 'active'], t),
      );
      expect(file.rows.length).toBe(page.total);
      expect(file.rows.some((r) => r[0] === '—')).toBe(true);
    });

    it('«Используется»: орган, на который ссылаются виды отчётов, считается', async () => {
      const usage = await asAdmin((tx) => adminDictUsage(tx, 'organs'));
      expect(usage.get('ОРГ-01')?.total ?? 0).toBeGreaterThan(0);
    });

    it('новое значение: код по порядку, в конце списка, «Создано» и «Создал», в истории', async () => {
      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'reasons',
          { name: '  Решение суда ', data: { note: 'По решению' } },
          random,
        ),
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.record).toMatchObject({
        code: 'ПРЧ-006',
        name: 'Решение суда',
        data: { note: 'По решению' },
        active: true,
        version: 1,
      });
      expect(created.record.n).toBe(6);
      expect(created.record.audit.createdAt).toBeInstanceOf(Date);
      expect(created.record.audit.createdBy).toBe('Администратор платформы');
      const history = await asAdmin((tx) => adminDictHistory(tx, 'reasons', 12));
      expect(history.items[0]).toMatchObject({
        action: 'create',
        code: 'ПРЧ-006',
        label: 'Решение суда',
        changes: expect.arrayContaining([{ field: 'name', to: 'Решение суда' }]),
      });
    });

    it('повтор названия — «Такое значение уже есть», ничего не записано', async () => {
      const taken = await asAdmin((tx) =>
        adminDictCreate(tx, 'forms', { name: 'ИП', data: formData() }, random),
      );
      expect(taken).toEqual({
        ok: false,
        reason: 'taken',
        problems: [{ field: 'name', code: 'taken' }],
      });
    });

    it('переименование и поля: новая версия, «было → стало»; устаревшая версия — changed', async () => {
      const before = (await asAdmin((tx) => getAdminDictValue(tx, 'organs', 'ОРГ-03')))!;
      const saved = await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'organs',
          'ОРГ-03',
          {
            name: 'Нацстатком КР',
            data: {
              ...before.data,
              contacts: [
                { label: 'Приёмная', value: '0 (312) 32-46-31' },
                { label: ' ', value: '' },
              ],
              site: 'https://stat.gov.kg',
            },
          },
          before.version,
        ),
      );
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.record.version).toBe(before.version + 1);
      expect(saved.record.data.contacts).toEqual([
        { label: 'Приёмная', value: '0 (312) 32-46-31' },
      ]);
      const history = await asAdmin((tx) => adminDictHistory(tx, 'organs', 12));
      expect(history.items[0]!.changes).toEqual(
        expect.arrayContaining([
          { field: 'name', from: before.name, to: 'Нацстатком КР' },
          { field: 'site', from: before.data.site, to: 'https://stat.gov.kg' },
        ]),
      );
      const stale = await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'organs',
          'ОРГ-03',
          { name: 'Другое', data: before.data },
          before.version,
        ),
      );
      expect(stale).toEqual({ ok: false, reason: 'changed' });
      const [row] = await db.admin.db
        .select({ updatedBy: authorities.updatedBy })
        .from(authorities)
        .where(eq(authorities.code, 'ОРГ-03'));
      // «Изменил» задан — наполнение `db:seed --update` правку не затрёт.
      expect(row?.updatedBy).toBe(adminId);
    });

    it('«Выше» и «Ниже»: место с соседним, в истории — с № на №; первому «Выше» некуда', async () => {
      const second = (await asAdmin((tx) => getAdminDictValue(tx, 'forms', 'ФС-02')))!;
      const moved = await asAdmin((tx) => adminDictMove(tx, 'forms', 'ФС-02', -1, second.version));
      expect(moved.ok && moved.record.n).toBe(1);
      const first = (await asAdmin((tx) => getAdminDictValue(tx, 'forms', 'ФС-01')))!;
      expect(first.n).toBe(2);
      const history = await asAdmin((tx) => adminDictHistory(tx, 'forms', 12));
      expect(history.items[0]).toMatchObject({
        code: 'ФС-02',
        changes: [{ field: 'n', from: 2, to: 1 }],
      });
      const top = (await asAdmin((tx) => getAdminDictValue(tx, 'forms', 'ФС-02')))!;
      expect(await asAdmin((tx) => adminDictMove(tx, 'forms', 'ФС-02', -1, top.version))).toEqual({
        ok: false,
        reason: 'not_found',
      });
      // У УГНС порядка нет (docs/deviations.md, п. Д-2).
      const ugns = (await asAdmin((tx) => getAdminDictValue(tx, 'ugns', 'ugns-bishkek-lenin')))!;
      expect(
        await asAdmin((tx) => adminDictMove(tx, 'ugns', 'ugns-bishkek-lenin', 1, ugns.version)),
      ).toEqual({ ok: false, reason: 'not_found' });
    });

    it('равные номера порядка выравниваются перед перестановкой', async () => {
      await db.admin.db
        .update(dueChangeReasons)
        .set({ sortOrder: 1 })
        .where(sql`${dueChangeReasons.code} in ('ПРЧ-001', 'ПРЧ-002')`);
      const b = (await asAdmin((tx) => getAdminDictValue(tx, 'reasons', 'ПРЧ-002')))!;
      expect(b.n).toBe(2);
      const moved = await asAdmin((tx) => adminDictMove(tx, 'reasons', 'ПРЧ-002', -1, b.version));
      expect(moved.ok && moved.record.n).toBe(1);
      const orders = await db.admin.db
        .select({ code: dueChangeReasons.code, sortOrder: dueChangeReasons.sortOrder })
        .from(dueChangeReasons);
      expect(new Set(orders.map((o) => o.sortOrder)).size).toBe(orders.length);
    });

    it('отключение и включение — в истории; то же состояние — без новой версии', async () => {
      const x = (await asAdmin((tx) => getAdminDictValue(tx, 'forms', 'ФС-24')))!;
      const off = await asAdmin((tx) => adminDictSetActive(tx, 'forms', 'ФС-24', false, x.version));
      expect(off.ok && off.record.active).toBe(false);
      const same = await asAdmin((tx) =>
        adminDictSetActive(tx, 'forms', 'ФС-24', false, x.version + 1),
      );
      expect(same.ok && same.record.version).toBe(x.version + 1);
      const history = await asAdmin((tx) => adminDictHistory(tx, 'forms', 1));
      expect(history.items[0]!.changes).toEqual([{ field: 'active', from: true, to: false }]);
    });

    it('удалить можно только неиспользуемое: орган видов отчётов — used, новое — удаляется', async () => {
      const gns = (await asAdmin((tx) => getAdminDictValue(tx, 'organs', 'ОРГ-01')))!;
      const used = await asAdmin((tx) => adminDictDelete(tx, 'organs', 'ОРГ-01', gns.version));
      expect(used).toMatchObject({ ok: false, reason: 'used' });
      // Функция базы откажет и без проверки сервера.
      await expect(
        asAdmin((tx) =>
          tx.execute(sql`select app.admin_dict_delete('organs', 'ОРГ-01', ${gns.version})`),
        ),
      ).rejects.toThrow();
      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'organs',
          {
            name: 'Минфин',
            data: { description: '', contacts: [], hours: '', site: '', contactsNote: '' },
          },
          random,
        ),
      );
      if (!created.ok) throw new Error('не создано');
      expect(created.record.code).toBe('ОРГ-16');
      const deleted = await asAdmin((tx) =>
        adminDictDelete(tx, 'organs', created.record.code, created.record.version),
      );
      expect(deleted).toEqual({ ok: true });
      const history = await asAdmin((tx) => adminDictHistory(tx, 'organs', 12));
      expect(history.items[0]).toMatchObject({ action: 'delete', label: 'Минфин' });
    });

    it('банковские провайдеры: «Тип» и «Переводы по номеру», код по типу, номер в реквизите — «Используется»', async () => {
      const page = await asAdmin((tx) => listAdminDictPage(tx, 'banks', query(), t));
      expect(page.rows[0]).toMatchObject({ code: 'БНК-01', n: 1, data: { kind: 'bank' } });
      const kinds = await asAdmin((tx) => listAdminDictValues(tx, 'banks', 'kind', t));
      expect(kinds.items.map((v) => v.label)).toEqual(['Банк', 'Электронный кошелёк']);
      const phone = await asAdmin((tx) =>
        listAdminDictPage(
          tx,
          'banks',
          query({ filters: { byPhone: { type: 'enum', vals: ['yes'] } } }),
          t,
        ),
      );
      expect(phone.total).toBeGreaterThan(0);
      expect(phone.rows.every((x) => x.data.byPhone === true)).toBe(true);

      const wallet = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'banks',
          { name: 'Тест Кошелёк', data: { kind: 'wallet', byPhone: true, note: '' } },
          random,
        ),
      );
      if (!wallet.ok) throw new Error('не создано');
      expect(wallet.record).toMatchObject({
        code: 'КШЛ-06',
        n: 38,
        data: { kind: 'wallet', byPhone: true },
      });
      const bank = await asAdmin((tx) =>
        adminDictCreate(tx, 'banks', { name: 'Тест Банк', data: { note: '' } }, random),
      );
      expect(bank.ok && bank.record).toMatchObject({
        code: 'БНК-33',
        data: { kind: 'bank', byPhone: false },
      });

      // Номер перевода, привязанный к кошельку: ссылка массивом кодов — тоже «Используется».
      await db.admin.db.insert(orgAccounts).values({
        orgId: org.orgId,
        kind: 'phone',
        phone: '+996700123456',
        phoneBanks: ['КШЛ-06'],
      });
      const used = (await asAdmin((tx) => getAdminDictValue(tx, 'banks', 'КШЛ-06')))!;
      expect(used.usage.total).toBe(1);
      expect(await asAdmin((tx) => adminDictDelete(tx, 'banks', 'КШЛ-06', used.version))).toEqual({
        ok: false,
        reason: 'used',
        usage: { total: 1, contractors: 0 },
      });

      const off = await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'banks',
          'КШЛ-06',
          { name: 'Тест Кошелёк', data: { kind: 'wallet', byPhone: false, note: '' } },
          used.version,
        ),
      );
      expect(off.ok && off.record.data.byPhone).toBe(false);
      const history = await asAdmin((tx) => adminDictHistory(tx, 'banks', 12));
      expect(history.items[0]).toMatchObject({
        action: 'update',
        label: 'Тест Кошелёк',
        changes: [{ field: 'byPhone', from: true, to: false }],
      });
    });

    it('удаление ждёт, пока сохраняется реквизит с этим банком, и тогда отказывает — «Используется»', async () => {
      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'banks',
          { name: 'Кошелёк на удаление', data: { kind: 'wallet', byPhone: true, note: '' } },
          random,
        ),
      );
      if (!created.ok) throw new Error('не создано');
      const { code, version } = created.record;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let inserted!: () => void;
      const ready = new Promise<void>((resolve) => (inserted = resolve));
      // Организация сохраняет номер перевода с этим кошельком, транзакция ещё не закончена.
      const writer = db.admin.db.transaction(async (w) => {
        await w.insert(orgAccounts).values({
          orgId: org.orgId,
          kind: 'phone',
          phone: '+996700654321',
          phoneBanks: [code],
        });
        inserted();
        await held;
      });
      await ready;
      const deleting = asAdmin((tx) => adminDictDelete(tx, 'banks', code, version));
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await writer;
      expect(await deleting).toEqual({
        ok: false,
        reason: 'used',
        usage: { total: 1, contractors: 0 },
      });
      expect(await asAdmin((tx) => getAdminDictValue(tx, 'banks', code))).not.toBeNull();
    });

    it('УГНС: пустой код ГНС — null, повтор кода — «Такой код уже есть»', async () => {
      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'ugns',
          {
            name: 'УГНС по новому району',
            data: { shortName: 'Новый р-н', gnsCode: '', region: 'г. Бишкек' },
          },
          random,
        ),
      );
      expect(created.ok && created.record.code).toMatch(/^ugns-t\d+$/);
      expect(created.ok && created.record.data.gnsCode).toBeNull();
      const taken = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'ugns',
          { name: 'УГНС ещё', data: { shortName: 'Ещё', gnsCode: '002', region: 'г. Бишкек' } },
          random,
        ),
      );
      expect(taken).toMatchObject({ reason: 'taken', problems: [{ field: 'gnsCode' }] });
    });

    it('режимы: «Тип» подписью, «Для бухгалтера» без подписи в начале; сохранение без правки — без новой версии', async () => {
      const page = await asAdmin((tx) => listAdminDictPage(tx, 'regimes', query(), t));
      expect(page.rows.slice(0, 2).map((x) => [x.n, x.code, x.name, x.data.kind])).toEqual([
        [1, 'РЕЖ-01', 'ОНР', 'general'],
        [2, 'РЕЖ-02', 'Патент', 'special'],
      ]);
      // ОНР указан у видов отчётов — «Используется».
      expect(page.rows[0]!.usage.total).toBeGreaterThan(0);
      expect(page.rows.map((x) => x.data.accountantNote)).not.toContainEqual(
        expect.stringMatching(/^Для бухгалтера/),
      );
      const kinds = await asAdmin((tx) => listAdminDictValues(tx, 'regimes', 'kind', t));
      expect(kinds.items.map((x) => x.label).sort()).toEqual(['Общий', 'Специальный']);

      const onr = page.rows[0]!;
      const same = await asAdmin((tx) =>
        adminDictUpdate(tx, 'regimes', onr.code, { name: onr.name, data: onr.data }, onr.version),
      );
      expect(same.ok && same.record.version).toBe(onr.version);
      const [stored] = await db.admin.db
        .select({ note: taxRegimes.accountantNote })
        .from(taxRegimes)
        .where(eq(taxRegimes.code, onr.code));
      expect(stored!.note).toMatch(/^Для бухгалтера: /);

      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'regimes',
          {
            name: 'Новый режим',
            data: { fullName: 'Налог на новое', accountantNote: 'Для бухгалтера: один отчёт' },
          },
          random,
        ),
      );
      expect(created.ok && [created.record.code, created.record.n]).toEqual(['РЕЖ-13', 13]);
      expect(created.ok && created.record.data).toMatchObject({
        kind: 'special',
        accountantNote: 'один отчёт',
        frees: '',
      });
    });

    it('основания: виды отчётов — связь «Основание» вида, правится из основания; привязанное не удаляется', async () => {
      const page = await asAdmin((tx) => listAdminDictPage(tx, 'bases', query(), t));
      // Без «№» (docs/deviations.md п. Д-2) — в порядке справочника.
      expect(page.rows[0]).toMatchObject({ n: null, code: 'employees', data: { types: ['soc'] } });
      expect(page.rows[0]!.usage).toEqual({ total: 1, contractors: 0 });
      const transport = page.rows.find((x) => x.code === 'transport')!;
      expect([transport.data.types, transport.usage.total]).toEqual([[], 0]);
      const file = await asAdmin((tx) =>
        exportAdminDict(tx, 'bases', query(), ['name', 'types'], t),
      );
      expect(file.rows[0]).toEqual(['Есть наёмные сотрудники', 'Соцфонд']);
      expect(file.rows.find((r) => r[0] === transport.name)?.[1]).toBe('—');

      // Не сквозной вид (НДС — режимный) — отказ, ничего не записано.
      const bad = await asAdmin((tx) =>
        adminDictCreate(tx, 'bases', { name: 'Есть НДС', data: { types: ['nds'] } }, random),
      );
      expect(bad).toEqual({ ok: false, reason: 'bad_link', field: 'types' });

      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'bases',
          { name: 'Есть роялти', data: { description: 'Недра', types: ['bon', 'roy', 'roy'] } },
          random,
        ),
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      // Коды — в порядке каталога, без повторов; вид отчёта видит основание у себя.
      expect(created.record.code).toMatch(/^base-t\d+$/);
      expect(created.record.data.types).toEqual(['roy', 'bon']);
      const links = await db.admin.db
        .select()
        .from(reportTypeBases)
        .where(eq(reportTypeBases.baseCode, created.record.code));
      expect(links.map((l) => l.reportTypeCode).sort()).toEqual(['bon', 'roy']);
      const used = await asAdmin((tx) =>
        adminDictDelete(tx, 'bases', created.record.code, created.record.version),
      );
      expect(used).toMatchObject({
        ok: false,
        reason: 'used',
        usage: { total: 2, contractors: 0 },
      });

      // Убрать вид — новая версия, «было → стало» в истории; без видов основание удаляется.
      const updated = await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'bases',
          created.record.code,
          { name: 'Есть роялти', data: { ...created.record.data, types: ['bon'] } },
          created.record.version,
        ),
      );
      expect(updated.ok && [updated.record.version, updated.record.data.types]).toEqual([
        created.record.version + 1,
        ['bon'],
      ]);
      const history = await asAdmin((tx) => adminDictHistory(tx, 'bases', 5));
      expect(history.items[0]!.changes).toEqual([
        { field: 'types', from: ['roy', 'bon'], to: ['bon'] },
      ]);
      const emptied = await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'bases',
          created.record.code,
          { name: 'Есть роялти', data: { types: [] } },
          created.record.version + 1,
        ),
      );
      expect(emptied.ok).toBe(true);
      const deleted = await asAdmin((tx) =>
        adminDictDelete(tx, 'bases', created.record.code, created.record.version + 2),
      );
      expect(deleted).toEqual({ ok: true });
    });

    it('коды стран: «+код», «Цифр», «Пример»; Кыргызстан не отключается, коды не удаляются', async () => {
      const page = await asAdmin((tx) => listAdminDictPage(tx, 'phones', query(), t));
      expect(page.rows[0]).toMatchObject({
        n: null,
        code: 'KG',
        name: 'Кыргызстан',
        data: { dialCode: '996', mask: 'XXX XXX XXX' },
      });
      const file = await asAdmin((tx) =>
        exportAdminDict(tx, 'phones', query(), ['name', 'dialCode', 'digits', 'example'], t),
      );
      expect(file.rows[0]).toEqual(['Кыргызстан', '+996', 9, '+996 555 123 456']);

      const kg = page.rows[0]!;
      const off = await asAdmin((tx) => adminDictSetActive(tx, 'phones', 'KG', false, kg.version));
      expect(off).toEqual({ ok: false, reason: 'fixed' });
      const kept = await asAdmin((tx) => adminDictDelete(tx, 'phones', 'KG', kg.version));
      expect(kept).toEqual({ ok: false, reason: 'undeletable' });

      const taken = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'phones',
          { name: 'Кыргызстан', data: { dialCode: '996', mask: 'XXX XXX XXX', flag: '' } },
          random,
        ),
      );
      expect(taken).toMatchObject({ ok: false, reason: 'taken' });
      const created = await asAdmin((tx) =>
        adminDictCreate(
          tx,
          'phones',
          { name: 'Монголия', data: { dialCode: '976', mask: 'XXXX XXXX', flag: '🇲🇳' } },
          random,
        ),
      );
      expect(created.ok && [created.record.code, created.record.data]).toEqual([
        'X-01',
        { flag: '🇲🇳', dialCode: '976', mask: 'XXXX XXXX' },
      ]);
      if (!created.ok) throw new Error('не создано');
      const disabled = await asAdmin((tx) =>
        adminDictSetActive(tx, 'phones', 'X-01', false, created.record.version),
      );
      expect(disabled.ok && disabled.record.active).toBe(false);
      // Отключённая страна остаётся в таблице: сохранённые номера с ней не меняются.
      const [stored] = await db.admin.db
        .select({ active: countryPhoneCodes.active })
        .from(countryPhoneCodes)
        .where(eq(countryPhoneCodes.code, 'X-01'));
      expect(stored).toEqual({ active: false });
      // Неверный код или маску не пропустит и база.
      await expect(
        asAdmin((tx) =>
          tx.execute(
            sql`select app.admin_dict_insert('phones', 'X-02', '{"name":"Ошибка","dial_code":"99999","mask":"XX"}'::jsonb)`,
          ),
        ),
      ).rejects.toThrow();
      // Две правки подряд: в истории — вся строка кода страны до и после каждой (прототип).
      const masked = await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'phones',
          'X-01',
          { name: 'Монголия', data: { dialCode: '976', mask: 'XX XX XXXX', flag: '🇲🇳' } },
          disabled.ok ? disabled.record.version : 0,
        ),
      );
      if (!masked.ok) throw new Error('не сохранено');
      await asAdmin((tx) =>
        adminDictUpdate(
          tx,
          'phones',
          'X-01',
          { name: 'Монголия', data: { dialCode: '977', mask: 'XX XX XXXX', flag: '🇲🇳' } },
          masked.record.version,
        ),
      );
      const history = await asAdmin((tx) => adminDictHistory(tx, 'phones', 5));
      expect(history.items.slice(0, 3).map((h) => [h.action, h.label, h.summary])).toEqual([
        [
          'update',
          'Монголия',
          { from: 'Монголия +976 XX XX XXXX', to: 'Монголия +977 XX XX XXXX' },
        ],
        ['update', 'Монголия', { from: 'Монголия +976 XXXX XXXX', to: 'Монголия +976 XX XX XXXX' }],
        ['update', 'Монголия', undefined],
      ]);
    });

    it('связи пишет только администратор платформы', async () => {
      const links = JSON.stringify({ types: ['nds'] });
      expect(
        await asOwner((tx) =>
          tx.execute(
            sql`select app.admin_dict_set_links('bases', 'employees', ${links}::jsonb) as ok`,
          ),
        ),
      ).toEqual([{ ok: null }]);
      await expect(
        asOwner((tx) =>
          tx.insert(reportTypeBases).values({ reportTypeCode: 'nds', baseCode: 'employees' }),
        ),
      ).rejects.toThrow();
    });

    it('не администратору — ни списка, ни правки; таблицы справочников роль приложения не меняет', async () => {
      expect(await asOwner((tx) => adminDictUsage(tx, 'organs'))).toEqual(new Map());
      const [row] = await asOwner((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_dict_insert('forms', 'ФС-99', '{"name":"Взлом"}'::jsonb) as v`,
        ),
      );
      expect(row?.v).toBeNull();
      const [edits] = await asOwner((tx) =>
        tx.execute<{ u: number | null; m: number | null; d: boolean | null }>(
          sql`select app.admin_dict_update('forms', 'ФС-01', '{"name":"Взлом"}'::jsonb, 1) as u,
                     app.admin_dict_move('forms', 'ФС-02', -1, 1) as m,
                     app.admin_dict_delete('reasons', 'ПРЧ-001', 1) as d`,
        ),
      );
      expect(edits).toEqual({ u: null, m: null, d: null });
      const [blocked] = await withUserContext(db.app.db, blockedAdminId, (tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_dict_set_active('forms', 'ФС-01', false, 1) as v`,
        ),
      );
      expect(blocked?.v).toBeNull();
      await expect(
        asAdmin((tx) =>
          tx.update(ownershipForms).set({ name: 'Взлом' }).where(eq(ownershipForms.code, 'ФС-01')),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        asAdmin((tx) => tx.execute(sql`select * from app.platform_dict_specs`)),
      ).rejects.toEqual(permissionDenied);
      await expect(
        asAdmin((tx) => tx.execute(sql`select * from app.platform_dict_links`)),
      ).rejects.toEqual(permissionDenied);
      // Неизвестный справочник — пусто.
      const [unknown] = await asAdmin((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_dict_insert('users', 'x', '{}'::jsonb) as v`,
        ),
      );
      expect(unknown?.v).toBeNull();
      const users = await asAdmin((tx) =>
        tx.execute(sql`select * from app.admin_dict_usage('users')`),
      );
      expect(users.length).toBe(0);
      const [office] = await db.admin.db
        .select({ name: taxOffices.name })
        .from(taxOffices)
        .where(eq(taxOffices.code, 'ugns-large'));
      expect(office?.name).toBeTruthy();
    });

    it('«Запросы»: администратор видит запросы всех организаций и отвечает; организация видит ответ', async () => {
      await asOwner((tx) =>
        createDictRequest(tx, { dict: 'forms', what: 'Фонд', comment: 'Для НКО' }),
      );
      expect(await asOwner((tx) => countNewDictRequests(tx))).toBe(0);
      expect(await asAdmin((tx) => countNewDictRequests(tx))).toBe(1);
      const page = await asAdmin((tx) => listAdminDictRequestsPage(tx, query(), t));
      const request = page.rows[0]!;
      expect(request).toMatchObject({
        orgName: 'ОсОО «Альфа»',
        dict: 'forms',
        what: 'Фонд',
        status: 'new',
        audit: { createdBy: 'Асанов Асан' },
      });
      // При отказе без ответа функция базы не сохраняет.
      const empty = await asAdmin((tx) =>
        adminAnswerDictRequest(tx, {
          id: request.id,
          status: 'rejected',
          answer: ' ',
          version: request.version,
        }),
      );
      expect(empty).toEqual({ ok: false, reason: 'changed' });
      const answered = await asAdmin((tx) =>
        adminAnswerDictRequest(tx, {
          id: request.id,
          status: 'rejected',
          answer: 'Есть как «Учреждение»',
          version: request.version,
        }),
      );
      expect(answered.ok && answered.record).toMatchObject({
        status: 'rejected',
        answer: 'Есть как «Учреждение»',
        audit: { updatedBy: 'Администратор платформы' },
      });
      const mine = await asOwner((tx) => listDictRequests(tx));
      expect(mine[0]).toMatchObject({ status: 'rejected', answer: 'Есть как «Учреждение»' });
      // Организация чужие запросы через представление Админки не видит.
      expect((await asOwner((tx) => listAdminDictRequestsPage(tx, query(), t))).total).toBe(0);
      const [denied] = await asOwner((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_answer_dict_request(${request.id}, 'added', '', ${request.version + 1}) as v`,
        ),
      );
      expect(denied?.v).toBeNull();
    });
  },
);

function formData() {
  return { fullName: '', shortName: '', declarationFor: 'org', note: '' };
}
