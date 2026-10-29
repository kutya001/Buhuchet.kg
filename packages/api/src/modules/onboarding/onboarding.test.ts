import { schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedKbReference } from '@buhuchet/db/testing';
import { defaultOrgPolicy } from '@buhuchet/domain';
import {
  ApiError,
  ApplyOnboardingResult,
  KbMarkResult,
  MeResponse,
  Onboarding,
  OrgPolicy,
  OrgPolicyHistory,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Первый запуск организации: API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let ownerB: string;
  let admin: string;

  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const ok = async (res: Response, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return status === 204 ? null : res.json();
  };
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ApiError.parse(await res.json()).error;
  };
  const onboarding = async (cookie: string) =>
    Onboarding.parse(await ok(await call('GET', '/api/onboarding', cookie)));
  const policy = async (cookie: string) =>
    OrgPolicy.parse(await ok(await call('GET', '/api/org/policy', cookie)));
  const apply = (cookie: string, body: Record<string, unknown>) =>
    call('POST', '/api/onboarding/apply', cookie, body);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedKbReference(f.t.admin.db);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа — 401; администратору платформы и без права «Настройки и учётная политика» — 403', async () => {
    expect((await call('GET', '/api/onboarding')).status).toBe(401);
    expect((await call('POST', '/api/onboarding/apply', undefined, {})).status).toBe(401);
    expect((await call('GET', '/api/onboarding', admin)).status).toBe(403);
    expect((await call('POST', '/api/onboarding/seen', admin)).status).toBe(403);
    expect((await call('POST', '/api/onboarding/later', acc)).status).toBe(403);
    const body = { answers: {}, features: {}, taskConfirm: true, version: 1, again: false };
    expect((await apply(acc, body)).status).toBe(403);
  });

  it('владельцу новой организации — приветствие с опросником, сотруднику — без него при первом входе', async () => {
    const own = await onboarding(owner);
    expect(own).toMatchObject({ welcome: 'quiz', state: 'new', quizDone: false });
    expect(own.content?.questions).toHaveLength(8);
    expect(own.content?.s1.t).toBe('Добро пожаловать в Buhuchet.kg');
    expect(own.mods.kb).toMatch(/^Обучение/);
    expect(await onboarding(acc)).toMatchObject({ welcome: 'tour', state: 'new' });

    // Приветствие открылось: сотруднику оно больше само не откроется, владельцу — пока опросник не пройден.
    await ok(await call('POST', '/api/onboarding/seen', acc), 204);
    await ok(await call('POST', '/api/onboarding/seen', owner), 204);
    expect((await onboarding(acc)).welcome).toBeNull();
    expect((await onboarding(owner)).welcome).toBe('quiz');
  });

  it('неверные данные — 400: неизвестный вопрос, неверный ответ, функция без нужной ей', async () => {
    const base = { features: {}, taskConfirm: true, version: 1, again: false };
    expect(
      (await fail(await apply(owner, { ...base, answers: { 'q-xyz': 'yes' } }), 400)).code,
    ).toBe('onboarding_question');
    expect((await apply(owner, { ...base, answers: { 'q-tasks': 'maybe' } })).status).toBe(400);
    expect((await apply(owner, { ...base, answers: [] })).status).toBe(400);
    const lonely = await fail(
      await apply(owner, { ...base, answers: {}, features: { accounts: true } }),
      400,
    );
    expect(lonely).toMatchObject({
      code: 'feature_requires',
      message: 'Сначала включите «Учёт оплаты налогов»',
    });
    expect((await policy(owner)).version).toBe(1);
  });

  it('п. 47: «Применить» — в меню «Финансовые операции», нет «Проектов» и «Показателей»; в истории учётной политики «по опроснику»', async () => {
    const features = { ...defaultOrgPolicy().features, taxpay: true, finops: true };
    const result = ApplyOnboardingResult.parse(
      await ok(
        await apply(owner, {
          answers: { 'q-proj': 'no', 'q-kpi': 'no', 'q-money': 'yes' },
          features,
          taskConfirm: true,
          version: 1,
          again: false,
        }),
      ),
    );
    expect(result).toEqual({ on: ['taxpay', 'finops'], off: [], taskConfirm: null });
    expect((await policy(owner)).features).toMatchObject({
      finops: true,
      projects: false,
      indicators: false,
    });
    const me = MeResponse.parse(await ok(await call('GET', '/api/auth/me', owner)));
    expect(me.modules).toContain('fin');
    expect(me.modules).not.toContain('projects');
    expect(me.modules).not.toContain('kpi');
    const history = OrgPolicyHistory.parse(
      await ok(await call('GET', '/api/org/policy/history', owner)),
    );
    expect(history.items[0]?.changes).toContainEqual({ field: 'quiz', to: 'first' });

    // Опросник пройден: приветствие с ним больше не открывается; шаг «Пройти опросник…» засчитан.
    expect(await onboarding(owner)).toMatchObject({ welcome: null, state: 'done', quizDone: true });
    const sync = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/sync', owner, { reason: 'saved' })),
    );
    expect(sync.fresh.map((d) => d.id)).toContain('policy');
  });

  it('устаревшая версия учётной политики — 409; «Позже» после опросника ничего не меняет', async () => {
    const stale = await fail(
      await apply(owner, {
        answers: {},
        features: defaultOrgPolicy().features,
        taskConfirm: true,
        version: 1,
        again: true,
      }),
      409,
    );
    expect(stale.code).toBe('record_changed');
    await ok(await call('POST', '/api/onboarding/later', owner), 204);
    expect((await onboarding(owner)).state).toBe('done');
  });

  it('«Позже»: опросник больше сам не открывается; у другой организации своё приветствие', async () => {
    expect((await onboarding(ownerB)).welcome).toBe('quiz');
    await ok(await call('POST', '/api/onboarding/seen', ownerB), 204);
    await ok(await call('POST', '/api/onboarding/later', ownerB), 204);
    expect(await onboarding(ownerB)).toMatchObject({ welcome: null, state: 'later' });
    expect((await onboarding(owner)).state).toBe('done');
    // Отметка «видел» — своя у каждого: владелец Б видит только свою строку.
    const rows = await withOrgContext(
      f.t.app.db,
      { orgId: f.b.orgId, userId: f.b.ownerUserId },
      (tx) => tx.select().from(schema.welcomeSeen),
    );
    expect(rows.map((r) => r.userId)).toEqual([f.b.ownerUserId]);
  });
});
