import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  applyOnboarding,
  getOnboarding,
  getOrgPolicy,
  markWelcomeSeen,
  onboardingContent,
  onboardingQuizDone,
  postponeOnboarding,
  welcomeSeenByMe,
  withOrgContext,
} from '@buhuchet/db';
import {
  FEATURES,
  featureChangeProblem,
  hasPermission,
  onboardingAnswerIds,
  RecordNotFoundError,
  welcomeAtLogin,
  type Feature,
} from '@buhuchet/domain';
import {
  ApiError,
  ApplyOnboardingRequest,
  ApplyOnboardingResult,
  Onboarding,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не сотрудник организации или нет права', content: error },
} as const;

export const onboardingRoute = createRoute({
  method: 'get',
  path: '/onboarding',
  tags: ['onboarding'],
  summary: 'Приветствие вошедшего: что открыть после входа, тексты экранов и вопросы опросника',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Приветствие, состояние опросника организации, тексты',
      content: { 'application/json': { schema: Onboarding } },
    },
    ...denied,
  },
});

/**
 * Что открыть сразу после входа (ТЗ «Первый запуск организации»; прототип firstLogin): владельцу новой
 * организации — приветствие с опросником, пока опросник не пройден и не отложен; сотруднику — без
 * опросника при самом первом входе; организации, созданной до приветствия, — ничего. Тексты нужны и
 * для «Приветствия и обзора модулей» и «Пройти опросник заново», поэтому приходят всегда.
 */
export function onboardingHandler(deps: ApiDeps): RouteHandler<typeof onboardingRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const canPolicy = hasPermission(c.get('access')!.subject, 'org');
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const [onboarding, seen, ref] = await Promise.all([
        getOnboarding(tx, ctx.orgId),
        welcomeSeenByMe(tx),
        onboardingContent(tx),
      ]);
      const state = onboarding?.state ?? null;
      return {
        welcome: ref ? welcomeAtLogin({ state, canPolicy, seen }) : null,
        state,
        quizDone: await onboardingQuizDone(tx, ctx.orgId, state),
        content: ref?.content ?? null,
        mods: ref?.mods ?? {},
      };
    });
    return c.json(body, 200);
  };
}

export const welcomeSeenRoute = createRoute({
  method: 'post',
  path: '/onboarding/seen',
  tags: ['onboarding'],
  summary: 'Приветствие открылось: при следующем входе само оно не откроется',
  middleware: [requireEmployee] as const,
  responses: { 204: { description: 'Отмечено' }, ...denied },
});

export function welcomeSeenHandler(deps: ApiDeps): RouteHandler<typeof welcomeSeenRoute, AppEnv> {
  return async (c) => {
    await withOrgContext(deps.db, orgContextOf(c), (tx) => markWelcomeSeen(tx));
    return c.body(null, 204);
  };
}

export const onboardingLaterRoute = createRoute({
  method: 'post',
  path: '/onboarding/later',
  tags: ['onboarding'],
  summary: '«Позже»: опросник отложен, действует основной набор модулей',
  middleware: [requirePermission('org')] as const,
  responses: {
    204: { description: 'Опросник отложен (или уже пройден — тогда ничего не меняется)' },
    ...denied,
  },
});

/**
 * «Позже» или «Закрыть» до опросника (прототип: `ORG.onboard.later`): приветствие с опросником больше
 * само не открывается, опросник можно пройти в «Моя организация» → «Учётная политика».
 */
export function onboardingLaterHandler(
  deps: ApiDeps,
): RouteHandler<typeof onboardingLaterRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    await withOrgContext(deps.db, ctx, (tx) => postponeOnboarding(tx, ctx.orgId));
    return c.body(null, 204);
  };
}

export const applyOnboardingRoute = createRoute({
  method: 'post',
  path: '/onboarding/apply',
  tags: ['onboarding'],
  summary: '«Применить» опросника: учётная политика по плану с записью «по опроснику»',
  middleware: [requirePermission('org')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: ApplyOnboardingRequest } } },
  },
  responses: {
    200: {
      description: 'Включённые и выключенные функции',
      content: { 'application/json': { schema: ApplyOnboardingResult } },
    },
    400: {
      description: 'Неизвестный вопрос; функция без нужной ей функции или нужна другой, включённой',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Применить» (ТЗ: «записывает учётную политику с пометкой «по опроснику» в историю изменений»;
 * прототип obApply): меняется только то, что отличается от текущей политики, по тем же правилам, что и
 * переключатели учётной политики (`featureChangeProblem`); данные выключаемых модулей не удаляются.
 * Опросник видит только роль с правом «Настройки и учётная политика».
 */
export function applyOnboardingHandler(
  deps: ApiDeps,
): RouteHandler<typeof applyOnboardingRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const result = await withOrgContext(deps.db, ctx, async (tx) => {
      const ref = await onboardingContent(tx);
      const known = new Set(ref ? onboardingAnswerIds(ref.content.questions) : []);
      const unknown = Object.keys(body.answers).find((id) => !known.has(id));
      if (unknown) apiFail(400, 'onboarding_question', 'Нет такого вопроса', { id: unknown });
      const current = await getOrgPolicy(tx, ctx.orgId);
      if (!current) throw new RecordNotFoundError('org_settings', ctx.orgId);
      const features = Object.fromEntries(
        FEATURES.map((f) => [f, body.features[f] ?? current.features[f]]),
      ) as Record<Feature, boolean>;
      const problem = featureChangeProblem(current.features, features);
      if (problem) apiFail(400, problem.code, problem.message, { feature: problem.feature });
      return applyOnboarding(tx, ctx.orgId, {
        answers: body.answers,
        features,
        taskConfirm: body.taskConfirm,
        version: body.version,
        again: body.again,
      });
    });
    return c.json(result, 200);
  };
}
