import { createHash, randomUUID } from 'node:crypto';
import { DM_TOKEN_MAX_DAYS } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  dmRequests,
  dmTemplateOrgs,
  dmTemplates,
  dmTemplateSql,
  dmTokens,
  FILE_TRASH_HOURS,
  files,
  fileTrash,
  orgSettings,
  storageCheckItems,
  storageCheckRuns,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const denied = expect.objectContaining({
  cause: expect.objectContaining({ code: expect.stringMatching(/^(42501|23514)$/) }),
});
const pgError = (code: string, constraint?: string) =>
  expect.objectContaining({
    cause: expect.objectContaining({
      code,
      ...(constraint ? { constraint_name: constraint } : {}),
    }),
  });
/** Отказ политики RLS или права на таблицу и столбец. */
const rls = pgError('42501');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// «Витрина данных», сверка хранилища и отложенное удаление (доработки 20.11.2026; миграция 0165, этап 0,
// пункты П2 и П3): кто что видит и меняет — решает база.
describe.skipIf(!databaseAvailable())('витрина данных и файлы Админки: таблицы этапа 0', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  const tpl = { all: '', selected: '', draft: '', broken: '', admin: '' };
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);
  const token = (over: Partial<typeof dmTokens.$inferInsert> = {}) => {
    const raw = `bk_${randomUUID().replaceAll('-', '')}`;
    return {
      templateId: tpl.all,
      name: 'Power BI директора',
      tokenHash: hash(raw),
      prefix: raw.slice(0, 7),
      expiresAt: new Date(Date.now() + 30 * DAY),
      ...over,
    };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810470',
      slug: 'dm-a',
      owner: owner('dm-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810471',
      slug: 'dm-b',
      owner: owner('dm-owner-b'),
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dm-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    const add = async (code: string, over: Partial<typeof dmTemplates.$inferInsert>) => {
      const [t] = await asAdmin((tx) =>
        tx
          .insert(dmTemplates)
          .values({ code, name: code, module: 'reports', state: 'published', ...over })
          .returning({ id: dmTemplates.id }),
      );
      await asAdmin((tx) =>
        tx.insert(dmTemplateSql).values({ templateId: t!.id, query: 'select 1 as n' }),
      );
      return t!.id;
    };
    tpl.all = await add('reports-due', {});
    tpl.selected = await add('reports-late', { access: 'selected' });
    tpl.draft = await add('draft-one', { state: 'draft' });
    tpl.broken = await add('broken-one', { state: 'broken' });
    // У шаблона Админки модуля нет (прототип `mod: null`).
    tpl.admin = await add('orgs-admin', { audience: 'admin', module: null });
    await asAdmin((tx) =>
      tx.insert(dmTemplateOrgs).values({ templateId: tpl.selected, orgId: a.orgId }),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('организация видит опубликованные и сломанные шаблоны для организаций, разрешённые ей; текста запроса и итога проверки не видит', async () => {
    const codes = async (fn: typeof inA) =>
      (await fn((tx) => tx.select({ code: dmTemplates.code }).from(dmTemplates)))
        .map((r) => r.code)
        .sort();
    // Черновик и шаблон Админки не видны; сломанный виден (с пометкой «Сломан», прототип `dmSee`).
    expect(await codes(inA)).toEqual(['broken-one', 'reports-due', 'reports-late']);
    expect(await codes(inB)).toEqual(['broken-one', 'reports-due']);
    // Запрос и итог проверки (на какой организации, текст ошибки) — только у администратора.
    await asAdmin((tx) =>
      tx
        .update(dmTemplateSql)
        .set({
          checkedAt: new Date(),
          checkedOrgId: b.orgId,
          checkError: 'column "x" does not exist',
        })
        .where(eq(dmTemplateSql.templateId, tpl.broken)),
    );
    expect(await inA((tx) => tx.select().from(dmTemplateSql))).toEqual([]);
    expect(Object.keys((await inA((tx) => tx.select().from(dmTemplates)))[0]!)).not.toContain(
      'checkError',
    );
    expect((await inB((tx) => tx.select().from(dmTemplateOrgs))).map((r) => r.orgId)).toEqual([]);
    // Организация шаблонов не меняет и доступа себе не даёт.
    expect(
      await inA((tx) =>
        tx.update(dmTemplates).set({ name: 'x' }).returning({ id: dmTemplates.id }),
      ),
    ).toEqual([]);
    await expect(
      inB((tx) => tx.insert(dmTemplateOrgs).values({ templateId: tpl.selected, orgId: b.orgId })),
    ).rejects.toEqual(denied);
    // Свой доступ организация не меняет и не снимает: строка просто не находится.
    expect(
      await inA((tx) =>
        tx
          .update(dmTemplateOrgs)
          .set({ createdBy: a.ownerUserId })
          .returning({ id: dmTemplateOrgs.templateId }),
      ),
    ).toEqual([]);
    expect(
      await inA((tx) => tx.delete(dmTemplateOrgs).returning({ id: dmTemplateOrgs.templateId })),
    ).toEqual([]);
    // Модуль — у шаблона для организаций обязательно, у шаблона Админки — нет.
    await expect(
      asAdmin((tx) =>
        tx.insert(dmTemplates).values({ code: 'no-module', name: 'x', module: null }),
      ),
    ).rejects.toEqual(pgError('23514', 'dm_templates_enum_check'));
    await expect(
      asAdmin((tx) =>
        tx
          .insert(dmTemplates)
          .values({ code: 'admin-module', name: 'x', audience: 'admin', module: 'reports' }),
      ),
    ).rejects.toEqual(pgError('23514', 'dm_templates_enum_check'));
    // Администратор видит всё, вместе с запросами.
    expect(await asAdmin((tx) => tx.select().from(dmTemplates))).toHaveLength(5);
    expect(await asAdmin((tx) => tx.select().from(dmTemplateSql))).toHaveLength(5);
  });

  it('токены: свой — только своей организации; администратор выпускает только токен Админки и видит все; срок — до 180 дней', async () => {
    const [mine] = await inA((tx) =>
      tx.insert(dmTokens).values(token()).returning({ id: dmTokens.id }),
    );
    expect(await inB((tx) => tx.select().from(dmTokens))).toEqual([]);
    expect((await inA((tx) => tx.select().from(dmTokens))).map((t) => t.id)).toEqual([mine!.id]);
    // Выпустить токен за организацию администратор не может — ни в её контексте, ни вне его.
    await expect(
      withOrgContext(db.app.db, { orgId: a.orgId, userId: adminId }, (tx) =>
        tx.insert(dmTokens).values(token()),
      ),
    ).rejects.toEqual(denied);
    await expect(
      asAdmin((tx) => tx.insert(dmTokens).values(token({ orgId: a.orgId }))),
    ).rejects.toEqual(denied);
    await asAdmin((tx) => tx.insert(dmTokens).values(token({ templateId: tpl.admin })));
    expect(await asAdmin((tx) => tx.select().from(dmTokens))).toHaveLength(2);
    // Токен Админки организации не виден.
    expect((await inA((tx) => tx.select().from(dmTokens))).map((t) => t.id)).toEqual([mine!.id]);
    // Шаблон токена — опубликованный и видимый тому, кто выпускает: организации — не шаблон Админки,
    // не черновик, не сломанный и не «Выбранные» чужой организации; администратору — только шаблон Админки.
    for (const templateId of [tpl.admin, tpl.draft, tpl.broken]) {
      await expect(inA((tx) => tx.insert(dmTokens).values(token({ templateId })))).rejects.toEqual(
        rls,
      );
    }
    await expect(
      inB((tx) => tx.insert(dmTokens).values(token({ templateId: tpl.selected }))),
    ).rejects.toEqual(rls);
    await expect(asAdmin((tx) => tx.insert(dmTokens).values(token()))).rejects.toEqual(rls);
    // Срок считается от «сейчас»: выпуск задним или будущим числом не проходит.
    await expect(
      inA((tx) =>
        tx.insert(dmTokens).values(
          token({
            createdAt: new Date(Date.now() + 365 * DAY),
            expiresAt: new Date(Date.now() + 400 * DAY),
          }),
        ),
      ),
    ).rejects.toEqual(rls);
    await expect(
      inA((tx) => tx.insert(dmTokens).values(token({ lastUsedAt: new Date() }))),
    ).rejects.toEqual(rls);
    // Сотрудник не выпускает токен Админки и не подставляет чужого автора.
    await expect(
      withUserContext(db.app.db, a.ownerUserId, (tx) => tx.insert(dmTokens).values(token())),
    ).rejects.toEqual(denied);
    await expect(
      inA((tx) => tx.insert(dmTokens).values(token({ createdBy: b.ownerUserId }))),
    ).rejects.toEqual(denied);
    await expect(
      inA((tx) =>
        tx
          .insert(dmTokens)
          .values(token({ expiresAt: new Date(Date.now() + (DM_TOKEN_MAX_DAYS + 1) * DAY) })),
      ),
    ).rejects.toEqual(pgError('23514', 'dm_tokens_term_check'));
    // После выпуска срок, шаблон, хеш и автор не меняются (права на столбцы).
    for (const set of [
      { expiresAt: new Date(Date.now() + 60 * DAY) },
      { templateId: tpl.selected },
      { tokenHash: hash('other') },
      { createdAt: new Date() },
      { createdBy: b.ownerUserId },
      { lastUsedAt: new Date() },
    ]) {
      await expect(
        inA((tx) => tx.update(dmTokens).set(set).where(eq(dmTokens.id, mine!.id))),
      ).rejects.toEqual(rls);
    }
    // Перевыпуск: старый работает ещё не дольше суток; новый — живой токен той же организации (простой
    // внешний ключ идёт мимо RLS), не сам токен.
    const [next] = await inA((tx) =>
      tx.insert(dmTokens).values(token()).returning({ id: dmTokens.id }),
    );
    const [ofB] = await inB((tx) =>
      tx.insert(dmTokens).values(token()).returning({ id: dmTokens.id }),
    );
    for (const replacedBy of [ofB!.id, mine!.id]) {
      await expect(
        inA((tx) =>
          tx
            .update(dmTokens)
            .set({ replacedBy, graceUntil: new Date(Date.now() + HOUR) })
            .where(eq(dmTokens.id, mine!.id)),
        ),
      ).rejects.toEqual(pgError('23514', 'dm_tokens_guard'));
    }
    await expect(
      inA((tx) =>
        tx
          .update(dmTokens)
          .set({ replacedBy: next!.id, graceUntil: new Date(Date.now() + 25 * HOUR) })
          .where(eq(dmTokens.id, mine!.id)),
      ),
    ).rejects.toEqual(rls);
    await inA((tx) =>
      tx
        .update(dmTokens)
        .set({
          name: 'Power BI (старый)',
          replacedBy: next!.id,
          graceUntil: new Date(Date.now() + 23 * HOUR),
        })
        .where(eq(dmTokens.id, mine!.id)),
    );
    // Перевыпуск один раз: снять его или продлить нельзя — иначе старый токен «оживает».
    for (const set of [
      { replacedBy: null, graceUntil: null },
      { graceUntil: new Date(Date.now() + 22 * HOUR) },
    ]) {
      await expect(
        inA((tx) => tx.update(dmTokens).set(set).where(eq(dmTokens.id, mine!.id))),
      ).rejects.toEqual(pgError('23514', 'dm_tokens_guard'));
    }
    // Отзыв — сейчас, не будущей датой.
    await expect(
      inA((tx) =>
        tx
          .update(dmTokens)
          .set({ revokedAt: new Date('2099-01-01T00:00:00Z'), revokedBy: a.ownerUserId })
          .where(eq(dmTokens.id, next!.id)),
      ),
    ).rejects.toEqual(pgError('23514', 'dm_tokens_guard'));
    // Свой токен отзывает сотрудник своей организации от своего имени.
    expect(
      await inA((tx) =>
        tx
          .update(dmTokens)
          .set({ revokedAt: new Date(), revokedBy: a.ownerUserId })
          .where(eq(dmTokens.id, next!.id))
          .returning({ id: dmTokens.id }),
      ),
    ).toEqual([{ id: next!.id }]);
    // Отзывает тот, кто вошёл; отозванный не возвращается; токены не удаляются.
    await expect(
      inA((tx) =>
        tx
          .update(dmTokens)
          .set({ revokedAt: new Date(), revokedBy: b.ownerUserId })
          .where(eq(dmTokens.id, mine!.id)),
      ),
    ).rejects.toEqual(denied);
    await asAdmin((tx) =>
      tx
        .update(dmTokens)
        .set({ revokedAt: new Date(), revokedBy: adminId })
        .where(eq(dmTokens.id, mine!.id)),
    );
    expect(
      await inA((tx) =>
        tx
          .update(dmTokens)
          .set({ revokedAt: null, revokedBy: null })
          .where(eq(dmTokens.id, mine!.id))
          .returning({ id: dmTokens.id }),
      ),
    ).toEqual([]);
    await expect(inA((tx) => tx.delete(dmTokens).where(eq(dmTokens.id, mine!.id)))).rejects.toEqual(
      denied,
    );
  });

  it('журнал запросов пишет только исполнитель Витрины; организация видит свои строки, Админка — все', async () => {
    await expect(
      inA((tx) => tx.insert(dmRequests).values({ orgId: a.orgId, via: 'screen', outcome: 'ok' })),
    ).rejects.toEqual(denied);
    await db.admin.db.insert(dmRequests).values([
      { orgId: a.orgId, templateId: tpl.all, via: 'api', outcome: 'ok', rowCount: 5 },
      { orgId: b.orgId, templateId: tpl.all, via: 'screen', outcome: 'ok', rowCount: 1 },
      { orgId: null, templateId: tpl.admin, via: 'api', outcome: 'rate' },
    ]);
    expect((await inA((tx) => tx.select().from(dmRequests))).map((r) => r.orgId)).toEqual([
      a.orgId,
    ]);
    expect(await asAdmin((tx) => tx.select().from(dmRequests))).toHaveLength(3);
    await expect(inA((tx) => tx.delete(dmRequests))).rejects.toEqual(denied);
  });

  it('«Внешний доступ по API» сначала выключен', async () => {
    const [s] = await inA((tx) => tx.select({ extApi: orgSettings.extApi }).from(orgSettings));
    expect(s!.extApi).toBe(false);
  });

  it('сверка хранилища: пишут только функции задачи, читает только администратор платформы', async () => {
    await expect(inA((tx) => tx.insert(storageCheckRuns).values({}))).rejects.toEqual(denied);
    const [run] = await db.admin.db
      .insert(storageCheckRuns)
      .values({})
      .returning({ id: storageCheckRuns.id });
    await db.admin.db.insert(storageCheckItems).values({
      kind: 'extra',
      key: `org/${a.orgId}/files/${randomUUID()}`,
      keyOrgId: a.orgId,
      sizeBytes: 10,
      firstRunId: run!.id,
      lastRunId: run!.id,
    });
    expect(await inA((tx) => tx.select().from(storageCheckItems))).toEqual([]);
    expect(await asAdmin((tx) => tx.select().from(storageCheckItems))).toHaveLength(1);
    expect(await asAdmin((tx) => tx.select().from(storageCheckRuns))).toHaveLength(1);
    await expect(
      asAdmin((tx) => tx.update(storageCheckItems).set({ resolvedAt: new Date() })),
    ).rejects.toEqual(denied);
  });

  it('«Ждут удаления»: файл стирается не раньше чем через сутки; ставит удаливший, «Вернуть» — администратор; Админка видит все', async () => {
    const id = randomUUID();
    const key = `org/${b.orgId}/files/${id}`;
    await db.admin.db.insert(files).values({
      id,
      orgId: b.orgId,
      sourceKind: 'manual',
      name: 'Договор.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      storageKey: key,
      state: 'deleted',
      createdBy: b.ownerUserId,
      deletedAt: new Date(),
      deletedBy: b.ownerUserId,
    });
    const row = {
      why: 'del' as const,
      fileId: id,
      storageKey: key,
      name: 'Договор.pdf',
      sizeBytes: 100,
    };
    // Раньше суток, от чужого имени, лишний файл — организация не ставит.
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, eraseAt: new Date() })),
    ).rejects.toEqual(denied);
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, deletedBy: a.ownerUserId })),
    ).rejects.toEqual(denied);
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, why: 'extra', fileId: null })),
    ).rejects.toEqual(denied);
    // Задним числом (тогда «не раньше суток» не держится) и с попытками стирания — тоже нет.
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, deletedAt: new Date(Date.now() - DAY) })),
    ).rejects.toEqual(rls);
    await expect(inB((tx) => tx.insert(fileTrash).values({ ...row, attempts: 1 }))).rejects.toEqual(
      rls,
    );
    // Ключ — только в папке своей организации; у удалённого файла — его ключ, и файл уже удалён.
    await expect(
      inB((tx) =>
        tx.insert(fileTrash).values({
          why: 'rep',
          storageKey: `org/${a.orgId}/files/${randomUUID()}`,
          name: 'Чужой.pdf',
          sizeBytes: 1,
        }),
      ),
    ).rejects.toEqual(pgError('23514', 'file_trash_fields_check'));
    await expect(
      inB((tx) =>
        tx.insert(fileTrash).values({ ...row, storageKey: `org/${b.orgId}/files/${randomUUID()}` }),
      ),
    ).rejects.toEqual(rls);
    const live = randomUUID();
    await db.admin.db.insert(files).values({
      id: live,
      orgId: b.orgId,
      sourceKind: 'manual',
      name: 'Живой.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1,
      storageKey: `org/${b.orgId}/files/${live}`,
      createdBy: b.ownerUserId,
      state: 'ready',
    });
    await expect(
      inB((tx) =>
        tx
          .insert(fileTrash)
          .values({ ...row, fileId: live, storageKey: `org/${b.orgId}/files/${live}` }),
      ),
    ).rejects.toEqual(rls);
    // Кроме лишнего файла — только ключ файла или присланного файла, без «..» в пути; прежняя версия —
    // не ключ живого файла (иначе через сутки сотрётся живой).
    for (const storageKey of [
      `org/${b.orgId}/../${a.orgId}/files/${randomUUID()}`,
      `org/${b.orgId}/subs/${randomUUID()}`,
      `org/${b.orgId}/files/${randomUUID()}/x`,
    ]) {
      await expect(
        inB((tx) =>
          tx.insert(fileTrash).values({ why: 'rep', storageKey, name: 'Старый.pdf', sizeBytes: 1 }),
        ),
      ).rejects.toEqual(pgError('23514', 'file_trash_fields_check'));
    }
    await expect(
      inB((tx) =>
        tx.insert(fileTrash).values({
          why: 'rep',
          storageKey: `org/${b.orgId}/files/${live}`,
          name: 'Живой.pdf',
          sizeBytes: 1,
        }),
      ),
    ).rejects.toEqual(rls);
    await inB((tx) =>
      tx.insert(fileTrash).values({
        why: 'auto',
        storageKey: `org/${b.orgId}/sent/${randomUUID()}.chk-${randomUUID()}`,
        name: 'Не принят.pdf',
        sizeBytes: 1,
      }),
    );
    // Контрагент — только существующий своей организации (составной внешний ключ).
    await expect(
      inB((tx) =>
        tx.insert(fileTrash).values({ ...row, contractorId: randomUUID(), contractorBound: true }),
      ),
    ).rejects.toEqual(pgError('23503', 'file_trash_contractor_fk'));
    const [t1] = await inB((tx) => tx.insert(fileTrash).values(row).returning());
    expect(t1!.eraseAt.getTime() - t1!.deletedAt.getTime()).toBe(FILE_TRASH_HOURS * HOUR);
    // Тот же объект второй раз не ждёт; чужая организация строку не видит.
    await expect(inB((tx) => tx.insert(fileTrash).values(row))).rejects.toEqual(
      expect.objectContaining({ cause: expect.objectContaining({ code: '23505' }) }),
    );
    expect(await inA((tx) => tx.select().from(fileTrash))).toEqual([]);
    // Сама организация не возвращает и не стирает; администратор возвращает от своего имени.
    expect(
      await inB((tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: new Date(), restoredBy: b.ownerUserId })
          .returning({ id: fileTrash.id }),
      ),
    ).toEqual([]);
    await expect(inB((tx) => tx.delete(fileTrash))).rejects.toEqual(denied);
    // Прежнюю версию после замены вернуть нельзя.
    const rep = await inB((tx) =>
      tx
        .insert(fileTrash)
        .values({
          why: 'rep',
          storageKey: `org/${b.orgId}/files/${randomUUID()}`,
          name: 'Старый.pdf',
          sizeBytes: 5,
        })
        .returning({ id: fileTrash.id }),
    );
    await expect(
      asAdmin((tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: new Date(), restoredBy: adminId })
          .where(eq(fileTrash.id, rep[0]!.id)),
      ),
    ).rejects.toEqual(denied);
    // Администратор меняет только отметки «Вернуть» и только от своего имени.
    await expect(
      asAdmin((tx) =>
        tx
          .update(fileTrash)
          .set({ eraseAt: new Date(Date.now() + 2 * DAY) })
          .where(eq(fileTrash.id, t1!.id)),
      ),
    ).rejects.toEqual(rls);
    await expect(
      asAdmin((tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: new Date(), restoredBy: b.ownerUserId })
          .where(eq(fileTrash.id, t1!.id)),
      ),
    ).rejects.toEqual(rls);
    await asAdmin((tx) =>
      tx
        .update(fileTrash)
        .set({ restoredAt: new Date(), restoredBy: adminId })
        .where(eq(fileTrash.id, t1!.id)),
    );
    // Возвращённый второй раз не возвращается.
    expect(
      await asAdmin((tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: new Date(), restoredBy: adminId })
          .where(eq(fileTrash.id, t1!.id))
          .returning({ id: fileTrash.id }),
      ),
    ).toEqual([]);
    // Лишний файл хранилища без организации — только администратор.
    await asAdmin((tx) =>
      tx.insert(fileTrash).values({
        why: 'extra',
        storageKey: 'org/x/files/y',
        name: 'y',
        sizeBytes: 1,
        source: 'Лишний файл хранилища',
      }),
    );
    // Без организации нет и контрагента.
    await expect(
      asAdmin((tx) =>
        tx.insert(fileTrash).values({
          why: 'extra',
          storageKey: 'org/x/files/z',
          contractorId: randomUUID(),
          contractorBound: true,
          name: 'z',
          sizeBytes: 1,
        }),
      ),
    ).rejects.toEqual(pgError('23514', 'file_trash_fields_check'));
    expect(await asAdmin((tx) => tx.select().from(fileTrash))).toHaveLength(4);
  });

  it('файлы всех организаций для Админки — без ключа хранилища и незагруженных; сотруднику — ничего', async () => {
    const ids = { ready: randomUUID(), pending: randomUUID() };
    for (const [state, id] of Object.entries(ids))
      await db.admin.db.insert(files).values({
        id,
        orgId: a.orgId,
        sourceKind: 'manual',
        name: `${state}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 1,
        storageKey: `org/${a.orgId}/files/${id}`,
        createdBy: a.ownerUserId,
        state: state as 'ready' | 'pending',
      });
    const rows = await asAdmin((tx) =>
      tx.execute<Record<string, unknown>>(
        sql`select * from app.admin_files where org_id = ${a.orgId}`,
      ),
    );
    expect(rows.map((r) => r.id)).toEqual([ids.ready]);
    expect(Object.keys(rows[0]!)).not.toContain('storage_key');
    expect(await inA((tx) => tx.execute(sql`select * from app.admin_files`))).toHaveLength(0);
    expect(
      await withUserContext(db.app.db, a.ownerUserId, (tx) =>
        tx.execute(sql`select * from app.admin_files`),
      ),
    ).toHaveLength(0);
  });
});
