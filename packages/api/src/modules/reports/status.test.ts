import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  FileManagerList,
  FileUploadTicket,
  OrgPolicy,
  ReportBatchResult,
  ReportCard,
  ReportList,
  ReportSaved,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): сентябрьский НДС (срок 25.10) ещё к сдаче,
// августовский (срок 25.09) — просрочен.
describe.skipIf(!databaseAvailable())(
  'Отчёты: сдача, подтверждение, откат и сумма — методы API',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpChief = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const card = async (cookie: string, id: string) => {
      const res = await call('GET', `/api/reports/${id}`, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return ReportCard.parse(await res.json());
    };
    const list = async (cookie: string, query = '') => {
      const res = await call('GET', `/api/reports?size=all${query}`, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return ReportList.parse(await res.json());
    };
    const reportOf = async (cp: string, type: string, periodStart: string) =>
      (await list(owner)).items.find(
        (r) => r.contractor.id === cp && r.type.code === type && r.periodStart === periodStart,
      )!;
    const act = async (
      cookie: string,
      id: string,
      action: string,
      body: Record<string, unknown>,
      status = 200,
    ) => {
      const res = await call('POST', `/api/reports/${id}/${action}`, cookie, body);
      expect(res.status, await res.clone().text()).toBe(status);
      return res;
    };
    const policy = async () =>
      OrgPolicy.parse(await (await call('GET', '/api/org/policy', owner)).json());

    async function contractor(orgId: string, name: string, inn: string, responsible: string) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: responsible,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { files: true }, reportConfirm: true })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      [owner, chief, acc, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const connect = await call('POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 'soc', 't1m'],
        disconnect: [],
      });
      expect(connect.status, await connect.clone().text()).toBe(200);
      cpA = await contractor(
        f.a.orgId,
        'ОсОО «Ала-Тоо Трейд»',
        '03744097401851',
        employee('acc-a'),
      );
      cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
      for (const [cp, type, rate] of [
        [cpA, 'nds', '12 %'],
        [cpA, 't1m', null],
        [cpChief, 'nds', '12 %'],
      ] as const) {
        const res = await call('POST', '/api/assignments', owner, {
          contractorId: cp,
          reportTypeCode: type,
          rate,
          fromMonth: '2026-08-01',
          markPast: false,
        });
        expect(res.status, await res.clone().text()).toBe(201);
      }
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('вход, права, область и проверка тела', async () => {
      const aug = await reportOf(cpA, 'nds', '2026-08-01');
      const body = { version: aug.version, date: '2026-10-18' };
      expect(
        (await apiRequest(f.app, 'POST', `/api/reports/${aug.id}/submit`, '', body)).status,
      ).toBe(401);
      expect((await failure(await act(senior, aug.id, 'submit', body, 403))).code).toBe(
        'forbidden',
      );
      expect(
        (await act(senior, aug.id, 'amount', { version: aug.version, amount: 1 }, 403)).ok,
      ).toBe(false);
      expect((await act(acc, aug.id, 'confirm', { version: aug.version }, 403)).ok).toBe(false);
      expect(
        (await act(acc, aug.id, 'rollback', { ...body, to: 'todo', reason: 'x' }, 403)).ok,
      ).toBe(false);
      // «Откат статусов» из группы «Общие» без «Просматривать отчёты» отчёт не откатывает.
      expect(
        (
          await failure(
            await act(senior, aug.id, 'rollback', { ...body, to: 'todo', reason: 'x' }, 403),
          )
        ).code,
      ).toBe('forbidden');
      // Чужая организация и контрагент вне области «Свои» — «не найден».
      await act(ownerB, aug.id, 'submit', body, 404);
      const chiefAug = await reportOf(cpChief, 'nds', '2026-08-01');
      await act(acc, chiefAug.id, 'submit', { ...body, version: chiefAug.version }, 404);
      // Неверное тело: дата позже сегодня, лишнее поле, отрицательная сумма, не номер.
      const future = await act(acc, aug.id, 'submit', { ...body, date: '2026-10-19' }, 400);
      expect(await failure(future)).toMatchObject({
        code: 'submit_date_invalid',
        message: 'Укажите дату не позже сегодняшней',
      });
      await act(acc, aug.id, 'submit', { ...body, extra: 1 }, 400);
      await act(acc, aug.id, 'submit', { ...body, amount: -1 }, 400);
      await act(acc, 'no-such', 'submit', body, 400);
      expect(
        (await call('POST', '/api/reports/submit', acc, { date: '2026-10-18', items: [] })).status,
      ).toBe(400);
    });

    it('п. 4 и п. 62: просроченный после «Сдан» уходит из «Просрочено», ждёт подтверждения; свой не подтвердить', async () => {
      const aug = await reportOf(cpA, 'nds', '2026-08-01');
      expect(aug.overdue).toBe(true);
      expect((await list(acc, '&tab=overdue')).items.map((r) => r.id)).toContain(aug.id);
      await act(acc, aug.id, 'submit', {
        version: aug.version,
        date: '2026-10-18',
        amount: 500_000,
      });
      expect((await list(acc, '&tab=overdue')).items.map((r) => r.id)).not.toContain(aug.id);
      const sent = await card(acc, aug.id);
      expect(sent).toMatchObject({
        status: 'submitted',
        mark: 'waiting',
        amount: 500_000,
        submittedBy: { id: employee('acc-a') },
        overdue: false,
      });
      expect((await list(owner, '&tab=waiting')).items.map((r) => r.id)).toContain(aug.id);
      // п. 10: история сдачи и суммы — кто и когда.
      expect(sent.history[0]).toMatchObject({ actor: 'acc-a', action: 'update' });
      expect(sent.history[0]!.changes.map((c) => c.field)).toEqual(['submittedOn', 'amount']);

      // Главный бухгалтер сдал свой отчёт — подтвердить его сам не может.
      const chiefAug = await reportOf(cpChief, 'nds', '2026-08-01');
      const own = await act(chief, chiefAug.id, 'submit', {
        version: chiefAug.version,
        date: '2026-10-18',
      });
      const ownSaved = ReportSaved.parse(await own.json());
      const refused = await act(chief, chiefAug.id, 'confirm', { version: ownSaved.version }, 403);
      expect(await failure(refused)).toMatchObject({
        code: 'report_confirm_own',
        message: 'Свой сданный отчёт подтвердить нельзя: подтверждает другой сотрудник с правом',
      });
      // Подтверждает другой сотрудник с правом.
      await act(chief, aug.id, 'confirm', { version: sent.version, note: 'Проверено' });
      const confirmed = await card(acc, aug.id);
      expect(confirmed).toMatchObject({
        mark: 'confirmed',
        confirmedBy: { id: employee('chief-a') },
        confirmNote: 'Проверено',
      });
      expect(confirmed.statusHistory.at(-1)).toMatchObject({ to: 'confirmed', actor: 'chief-a' });
      const again = await act(chief, aug.id, 'confirm', { version: confirmed.version }, 409);
      expect((await failure(again)).code).toBe('report_not_waiting');
      // Устаревшая версия — «запись изменена другим пользователем».
      expect(
        (await failure(await act(owner, aug.id, 'not-required', { version: sent.version }, 409)))
          .code,
      ).toBe('record_changed');
      // Откат: сначала снимается подтверждение (право «Откат статусов»).
      await act(owner, aug.id, 'rollback', {
        version: confirmed.version,
        to: 'waiting',
        reason: 'Ошибка',
      });
      expect((await card(acc, aug.id)).mark).toBe('waiting');
    });

    it('п. 62: «На исправление» без причины нельзя; с причиной — «Требует исправления» с причиной', async () => {
      const sep = await reportOf(cpA, 'nds', '2026-09-01');
      const sent = ReportSaved.parse(
        await (
          await act(acc, sep.id, 'submit', { version: sep.version, date: '2026-10-17' })
        ).json(),
      );
      const empty = await act(chief, sep.id, 'fix', { version: sent.version, reason: '   ' }, 400);
      expect(await failure(empty)).toMatchObject({
        code: 'report_fix_reason',
        message: 'Укажите, что исправить: без причины вернуть нельзя',
      });
      await act(chief, sep.id, 'fix', { version: sent.version, reason: 'Неверная сумма НДС' });
      const back = await card(acc, sep.id);
      expect(back).toMatchObject({
        status: 'needs_fix',
        mark: null,
        fix: { actor: 'chief-a', reason: 'Неверная сумма НДС' },
      });
    });

    it('п. 3, «Указать сумму» и шаги без окна', async () => {
      const t1 = await reportOf(cpA, 't1m', '2026-08-01');
      expect(await card(acc, t1.id)).toMatchObject({ act: 'sub', lineDefs: [], payments: [] });
      const noAmount = await act(acc, t1.id, 'amount', { version: t1.version, amount: 100 }, 409);
      expect((await failure(noAmount)).code).toBe('report_no_amount');

      const oct = await reportOf(cpA, 'nds', '2026-10-01');
      const sum = ReportSaved.parse(
        await (await act(acc, oct.id, 'amount', { version: oct.version, amount: 125_050 })).json(),
      );
      const started = ReportSaved.parse(
        await (await act(acc, oct.id, 'start', { version: sum.version })).json(),
      );
      expect(await card(acc, oct.id)).toMatchObject({ status: 'in_progress', amount: 125_050 });
      const wrong = await act(acc, oct.id, 'reject', { version: started.version }, 409);
      expect((await failure(wrong)).code).toBe('report_step_invalid');
      await act(acc, oct.id, 'not-required', { version: started.version });
      expect((await card(acc, oct.id)).status).toBe('not_required');
    });

    it('массово: «Отметить сданными» пропускает отчёты без обязательного файла; «Подтвердить» — свои', async () => {
      await f.t.admin.db
        .update(schema.orgReportTypes)
        .set({ needFile: true })
        .where(eq(schema.orgReportTypes.reportTypeCode, 't1m'));
      const t1 = await reportOf(cpA, 't1m', '2026-08-01');
      const nov = await reportOf(cpA, 'nds', '2026-11-01');
      expect((await card(acc, t1.id)).fileRequired).toBe(true);
      const res = await call('POST', '/api/reports/submit', acc, {
        date: '2026-10-18',
        items: [
          { id: t1.id, version: t1.version },
          { id: nov.id, version: nov.version, amount: 300_000 },
        ],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(ReportBatchResult.parse(await res.json())).toEqual({
        done: 1,
        skippedFile: 1,
        skipped: 0,
      });
      const waiting = (await list(chief, '&tab=waiting')).items;
      const confirm = await call('POST', '/api/reports/confirm', chief, {
        items: waiting.map((r) => ({ id: r.id, version: r.version })),
      });
      expect(confirm.status, await confirm.clone().text()).toBe(200);
      // Свой сданный (НДС ИП Садыкова за август) главный бухгалтер пропускает.
      expect(ReportBatchResult.parse(await confirm.json())).toMatchObject({ skipped: 1 });
    });

    it('файл отчёта: загружается в блок «Файлы», сдача с ним; в Файловом менеджере — источник «Отчёт»', async () => {
      const t1 = await reportOf(cpA, 't1m', '2026-08-01');
      await act(acc, t1.id, 'submit', { version: t1.version, date: '2026-10-18' }, 400);
      const started = await call('POST', '/api/files/uploads', acc, {
        name: '1-Т 08.2026.pdf',
        size: 5,
        source: { kind: 'report', id: t1.id },
      });
      expect(started.status, await started.clone().text()).toBe(201);
      const ticket = FileUploadTicket.parse(await started.json());
      const [row] = await f.t.admin.db
        .select({ key: schema.files.storageKey, type: schema.files.contentType })
        .from(schema.files)
        .where(eq(schema.files.id, ticket.id));
      await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
        contentType: row!.type,
      });
      expect((await call('POST', `/api/files/${ticket.id}/complete`, acc)).status).toBe(200);
      // Файлы отчёта другой организации и вне области не видны.
      expect((await call('GET', `/api/files?kind=report&id=${t1.id}`, ownerB)).status).toBe(404);
      const chiefAug = await reportOf(cpChief, 'nds', '2026-08-01');
      expect((await call('GET', `/api/files?kind=report&id=${chiefAug.id}`, acc)).status).toBe(404);

      await act(acc, t1.id, 'submit', {
        version: t1.version,
        date: '2026-10-18',
        fileIds: [ticket.id],
      });
      const done = await card(acc, t1.id);
      expect(done.files).toEqual([{ id: ticket.id, name: '1-Т 08.2026.pdf' }]);
      expect(done.statusHistory.at(-1)!.file).toMatchObject({ id: ticket.id });
      const manager = await call('GET', '/api/files/manager?size=all', acc);
      const items = FileManagerList.parse(await manager.json()).items;
      expect(items.find((x) => x.id === ticket.id)).toMatchObject({
        kind: 'report',
        source: '1-Т · 08.2026',
      });
      expect(done.history.some((h) => h.changes.some((c) => c.field === 'files'))).toBe(true);

      // Отчёты видит («Все»), файлы этого контрагента — нет: имён файлов в карточке нет. Сначала —
      // с правом «Просматривать файлы», но вне области «Файлы» («Свои»), потом — без права.
      const hrRole = f.roleIds.hr;
      const scopeOf = (group: string, scope: 'all' | 'own') =>
        f.t.admin.db
          .update(schema.roleScopes)
          .set({ scope })
          .where(and(eq(schema.roleScopes.roleId, hrRole), eq(schema.roleScopes.permGroup, group)));
      await scopeOf('reports', 'all');
      const hidden = (c: ReportCard) => {
        expect(c).toMatchObject({ files: [], hasFiles: true });
        expect(c.statusHistory.at(-1)!.file).toBeNull();
        expect(c.history.flatMap((h) => h.changes).some((x) => x.field === 'files')).toBe(false);
        expect(c.history.some((h) => h.action === 'file_attach')).toBe(false);
      };
      hidden(await card(await signIn(f.app, 'hr-a', TEST_PASSWORD), t1.id));
      await scopeOf('files', 'all');
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, hrRole),
            eq(schema.rolePermissions.permissionId, 'filesView'),
          ),
        );
      hidden(await card(await signIn(f.app, 'hr-a', TEST_PASSWORD), t1.id));
    });

    it('выключили «Сдача отчётов требует подтверждения» — ждущие подтверждены с записью в истории', async () => {
      const sep = await reportOf(cpChief, 'nds', '2026-09-01');
      await act(chief, sep.id, 'submit', { version: sep.version, date: '2026-10-18' });
      expect((await card(chief, sep.id)).mark).toBe('waiting');
      // Число для вопроса «Выключить подтверждение сдачи?» — по всем отчётам организации и только с
      // правом «Настройки и учётная политика».
      const waitingNow = (await list(owner, '&tab=waiting')).items.length;
      const count = await call('GET', '/api/org/policy/waiting-reports', owner);
      expect(count.status, await count.clone().text()).toBe(200);
      expect(await count.json()).toEqual({ count: waitingNow });
      expect((await call('GET', '/api/org/policy/waiting-reports', senior)).status).toBe(403);
      // Чужая организация: своё число, отчёты организации А не видны.
      const foreign = await call('GET', '/api/org/policy/waiting-reports', ownerB);
      expect(await foreign.json()).toEqual({ count: 0 });
      // Устаревшая версия политики — 409, ждущие отчёты не подтверждены.
      const stale = await call('PATCH', '/api/org/policy', owner, {
        version: (await policy()).version - 1,
        reportConfirm: false,
      });
      expect(stale.status).toBe(409);
      expect((await failure(stale)).code).toBe('record_changed');
      expect((await card(chief, sep.id)).mark).toBe('waiting');
      const res = await call('PATCH', '/api/org/policy', owner, {
        version: (await policy()).version,
        reportConfirm: false,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      // В истории политики — сколько подтверждено (прототип: «…: выключено; считаются подтверждёнными: N»).
      const history = await call('GET', '/api/org/policy/history', owner);
      const [last] = ((await history.json()) as { items: { changes: unknown[] }[] }).items;
      expect(last!.changes).toEqual([
        { field: 'reportConfirm', from: true, to: false },
        { field: 'confirmedReports', to: waitingNow },
      ]);
      const after = await card(chief, sep.id);
      expect(after.mark).toBeNull();
      expect(after.confirmedAt).not.toBeNull();
      expect(after.statusHistory.at(-1)).toMatchObject({
        to: 'confirmed',
        reason: 'Подтверждение выключено в учётной политике',
      });

      // Сдан без подтверждения, потом подтверждение включили — отчёт его не ждёт (прототип repConfSet).
      const oct = await reportOf(cpChief, 'nds', '2026-10-01');
      await act(chief, oct.id, 'submit', { version: oct.version, date: '2026-10-18' });
      expect((await card(chief, oct.id)).confirmedAt).toBeNull();
      const on = await call('PATCH', '/api/org/policy', owner, {
        version: (await policy()).version,
        reportConfirm: true,
      });
      expect(on.status, await on.clone().text()).toBe(200);
      const kept = await card(chief, oct.id);
      expect(kept).toMatchObject({
        mark: 'confirmed',
        confirmedBy: null,
        confirmNote: 'Сдан, когда подтверждение было выключено',
      });
      expect((await list(owner, '&tab=waiting')).items.map((r) => r.id)).not.toContain(oct.id);
    });
  },
);
