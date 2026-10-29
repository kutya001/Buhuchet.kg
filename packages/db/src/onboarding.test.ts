import { defaultOrgPolicy, RecordChangedError, type Feature } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { readHistory } from './history';
import {
  applyOnboarding,
  getOnboarding,
  markWelcomeSeen,
  onboardingContent,
  onboardingQuizDone,
  postponeOnboarding,
  welcomeSeenByMe,
} from './onboarding';
import { getOrgPolicy, orgPolicyHistory } from './org';
import { createOrganization, type CreatedOrganization } from './organizations';
import { orgOnboarding, welcomeSeen } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedKbReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

describe.skipIf(!databaseAvailable())('Первый запуск организации: приветствие и опросник', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let old: CreatedOrganization;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    await seedKbReference(t.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец Тестовый', login, passwordHash: '!' });
    a = await createOrganization(t.app.db, {
      name: 'ОсОО «Ахти»',
      inn: '01811201810111',
      slug: 'ahti',
      owner: owner('owner-a'),
    });
    b = await createOrganization(t.app.db, {
      name: 'ОсОО «Бета»',
      inn: '01811201810222',
      slug: 'beta',
      owner: owner('owner-b'),
    });
    // Организация, созданная до приветствия: строки приветствия у неё нет.
    old = await createOrganization(t.app.db, {
      name: 'ОсОО «Старая»',
      inn: '01811201810333',
      slug: 'stara',
      owner: owner('owner-old'),
    });
    await t.admin.db.delete(orgOnboarding).where(eq(orgOnboarding.orgId, old.orgId));
  });

  afterAll(async () => {
    await t?.drop();
  });

  const as = <T>(org: CreatedOrganization, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(t.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);

  const plan = (over: Partial<Record<Feature, boolean>> = {}) => ({
    ...defaultOrgPolicy().features,
    ...over,
  });

  it('тексты приветствия и опросника — из refDB.json, описания модулей — из kbUi', async () => {
    const ref = await onboardingContent(t.app.db);
    expect(ref?.content.questions.map((q) => q.id)).toEqual([
      'q-tasks',
      'q-money',
      'q-fee',
      'q-proj',
      'q-kpi',
      'q-files',
      'q-tg',
      'q-cal',
    ]);
    expect(ref?.content.base).toEqual(defaultOrgPolicy().features);
    expect(ref?.mods.reports).toMatch(/^Все отчёты клиентов/);
  });

  it('новая организация получает приветствие с опросником; созданная раньше — нет', async () => {
    expect(await as(a, (tx) => getOnboarding(tx, a.orgId))).toEqual({
      state: 'new',
      answers: {},
      doneAt: null,
    });
    expect(await as(old, (tx) => getOnboarding(tx, old.orgId))).toBeNull();
  });

  it('приветствие чужой организации не видно и не меняется', async () => {
    expect(await as(a, (tx) => getOnboarding(tx, b.orgId))).toBeNull();
    expect(await as(a, (tx) => postponeOnboarding(tx, b.orgId))).toBe(false);
    // Строки у организации `old` нет: отказ — от RLS, а не от первичного ключа.
    await expect(
      as(a, (tx) => tx.insert(orgOnboarding).values({ orgId: old.orgId, state: 'done' })),
    ).rejects.toEqual(permissionDenied);
    expect((await as(b, (tx) => getOnboarding(tx, b.orgId)))?.state).toBe('new');
  });

  it('«приветствие уже видел» — у каждого своё; чужую отметку не поставить, отметки не меняются и не удаляются', async () => {
    expect(await as(a, (tx) => welcomeSeenByMe(tx))).toBe(false);
    await as(a, (tx) => markWelcomeSeen(tx));
    await as(a, (tx) => markWelcomeSeen(tx));
    expect(await as(a, (tx) => welcomeSeenByMe(tx))).toBe(true);
    expect(await as(b, (tx) => welcomeSeenByMe(tx))).toBe(false);
    expect(await as(b, (tx) => tx.select().from(welcomeSeen))).toEqual([]);
    // У владельца `old` отметки нет: отказ — от RLS, а не от первичного ключа.
    await expect(
      as(b, (tx) => tx.insert(welcomeSeen).values({ userId: old.ownerUserId, orgId: old.orgId })),
    ).rejects.toEqual(permissionDenied);
    await expect(as(a, (tx) => tx.update(welcomeSeen).set({ seenAt: new Date() }))).rejects.toEqual(
      permissionDenied,
    );
    await expect(as(a, (tx) => tx.delete(welcomeSeen))).rejects.toEqual(permissionDenied);
    await expect(as(a, (tx) => tx.delete(orgOnboarding))).rejects.toEqual(permissionDenied);
  });

  it('«Позже»: опросник отложен один раз; пройденный не откладывается', async () => {
    expect(await as(b, (tx) => postponeOnboarding(tx, b.orgId))).toBe(true);
    expect(await as(b, (tx) => postponeOnboarding(tx, b.orgId))).toBe(false);
    expect((await as(b, (tx) => getOnboarding(tx, b.orgId)))?.state).toBe('later');
  });

  it('п. 47: «Применить» меняет учётную политику, пишет «по опроснику» в её историю и отмечает опросник пройденным', async () => {
    const answers = { 'q-proj': 'no', 'q-kpi': 'no', 'q-money': 'yes' } as const;
    const changes = await as(a, (tx) =>
      applyOnboarding(tx, a.orgId, {
        answers,
        features: plan({ taxpay: true, finops: true }),
        taskConfirm: true,
        version: 1,
        again: false,
      }),
    );
    expect(changes).toEqual({ on: ['taxpay', 'finops'], off: [], taskConfirm: null });
    const policy = await as(a, (tx) => getOrgPolicy(tx, a.orgId));
    expect(policy).toMatchObject({
      features: { taxpay: true, finops: true, projects: false, indicators: false },
      version: 2,
    });
    const history = await as(a, (tx) => orgPolicyHistory(tx, a.orgId));
    expect(history.items[0]).toMatchObject({
      actor: 'Тестовый В.',
      action: 'update',
      changes: [
        {
          field: 'features',
          from: expect.objectContaining({ taxpay: false }),
          to: expect.objectContaining({ taxpay: true, finops: true }),
        },
        { field: 'quiz', to: 'first' },
      ],
    });
    expect(await as(a, (tx) => getOnboarding(tx, a.orgId))).toMatchObject({
      state: 'done',
      answers,
      doneAt: expect.any(Date),
    });
    const [row] = await t.admin.db
      .select()
      .from(orgOnboarding)
      .where(eq(orgOnboarding.orgId, a.orgId));
    expect(row?.doneBy).toBe(a.ownerUserId);
  });

  it('устаревшая версия учётной политики — «запись изменена», ничего не меняется', async () => {
    await expect(
      as(a, (tx) =>
        applyOnboarding(tx, a.orgId, {
          answers: {},
          features: plan(),
          taskConfirm: true,
          version: 1,
          again: true,
        }),
      ),
    ).rejects.toThrow(RecordChangedError);
    expect((await as(a, (tx) => getOrgPolicy(tx, a.orgId)))?.features.taxpay).toBe(true);
  });

  it('пройден заново без изменений — запись «по опроснику (пройден заново)» всё равно есть', async () => {
    const current = (await as(a, (tx) => getOrgPolicy(tx, a.orgId)))!;
    const changes = await as(a, (tx) =>
      applyOnboarding(tx, a.orgId, {
        answers: {},
        features: current.features,
        taskConfirm: current.taskConfirm,
        version: current.version,
        again: true,
      }),
    );
    expect(changes).toEqual({ on: [], off: [], taskConfirm: null });
    const history = await as(a, (tx) => orgPolicyHistory(tx, a.orgId));
    expect(history.items[0]?.changes).toEqual([{ field: 'quiz', to: 'again' }]);
    expect((await as(a, (tx) => getOrgPolicy(tx, a.orgId)))?.version).toBe(current.version + 1);
  });

  it('«Задачи требуют подтверждения» — по ответу на подвопрос', async () => {
    const current = (await as(a, (tx) => getOrgPolicy(tx, a.orgId)))!;
    await as(a, (tx) =>
      applyOnboarding(tx, a.orgId, {
        answers: { 'q-tasks': 'yes', 'q-tconf': 'no' },
        features: current.features,
        taskConfirm: false,
        version: current.version,
        again: true,
      }),
    );
    expect((await as(a, (tx) => getOrgPolicy(tx, a.orgId)))?.taskConfirm).toBe(false);
  });

  it('организация без приветствия проходит опросник из учётной политики — строка приветствия не появляется, опросник пройден', async () => {
    expect(await as(old, (tx) => onboardingQuizDone(tx, old.orgId, null))).toBe(false);
    await as(old, (tx) =>
      applyOnboarding(tx, old.orgId, {
        answers: { 'q-fee': 'yes' },
        features: plan({ fee: true }),
        taskConfirm: true,
        version: 1,
        again: true,
      }),
    );
    expect((await as(old, (tx) => getOrgPolicy(tx, old.orgId)))?.features.fee).toBe(true);
    expect(await as(old, (tx) => getOnboarding(tx, old.orgId))).toBeNull();
    const entries = await as(old, (tx) => readHistory(tx, 'org_settings', old.orgId));
    expect(entries.at(-1)?.changes.at(-1)).toEqual({ field: 'quiz', to: 'again' });
    expect(await as(old, (tx) => onboardingQuizDone(tx, old.orgId, null))).toBe(true);
    // Запись «по опроснику» чужой организации не считается.
    expect(await as(b, (tx) => onboardingQuizDone(tx, old.orgId, null))).toBe(false);
  });
});
