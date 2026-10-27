import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { kbSetSkipped } from '@buhuchet/db';
import { kbHitMark, kbProgramSteps } from '@buhuchet/domain';
import { ApiError, KbCode, KbHit, KbMarkResult, KbState, KbSyncRequest } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { asLearner, markSteps, programContext, programStep, stateBody, syncSteps } from './state';

const error = { 'application/json': { schema: ApiError } };
const stepParams = z.object({ id: KbCode });
const common = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Сотрудник организации или администратор платформы', content: error },
} as const;

export const kbStateRoute = createRoute({
  method: 'get',
  path: '/kb/me',
  tags: ['kb'],
  summary: 'Моя программа обучения: уровень, уроки, следующий шаг',
  responses: {
    200: {
      description: 'Программа из прав и учётной политики с отметками пользователя',
      content: { 'application/json': { schema: KbState } },
    },
    ...common,
  },
});

/** «Мой уровень», «Уроки», блок «Уровень знаний» в «Мой профиль» — только чтение. */
export function kbStateHandler(deps: ApiDeps): RouteHandler<typeof kbStateRoute, AppEnv> {
  return async (c) => {
    const body = await asLearner(deps, c, async (tx, learner) =>
      stateBody(tx, await programContext(tx, learner), deps.clock.now()),
    );
    return c.json(body, 200);
  };
}

export const kbSyncRoute = createRoute({
  method: 'post',
  path: '/kb/sync',
  tags: ['kb'],
  summary: 'Сверить шаги «Сделать» с историей своих действий',
  request: { body: { required: true, content: { 'application/json': { schema: KbSyncRequest } } } },
  responses: {
    200: {
      description: 'Программа после сверки, новые засчитанные шаги и новый уровень',
      content: { 'application/json': { schema: KbMarkResult } },
    },
    400: { description: 'Неверный запрос', content: error },
    ...common,
  },
});

/**
 * После сохранения (`saved`) и при входе (`open`) — шаги «Сделать», условие которых уже есть в
 * истории под именем пользователя, засчитываются (ТЗ «Как считается»). Поздравление с уровнем — только
 * после сохранения: при входе прошлые действия засчитываются тихо (прототип ckBase).
 */
export function kbSyncHandler(deps: ApiDeps): RouteHandler<typeof kbSyncRoute, AppEnv> {
  return async (c) => {
    const { reason } = c.req.valid('json');
    const body = await asLearner(deps, c, async (tx, learner) =>
      syncSteps(tx, await programContext(tx, learner), deps.clock.now(), {
        congrats: reason === 'saved',
      }),
    );
    return c.json(body, 200);
  };
}

export const kbLookRoute = createRoute({
  method: 'post',
  path: '/kb/steps/{id}/look',
  tags: ['kb'],
  summary: '«Посмотреть»: 3 секунды на экране шага после «Перейти»',
  request: { params: stepParams },
  responses: {
    200: {
      description: 'Шаг засчитан (или был засчитан раньше)',
      content: { 'application/json': { schema: KbMarkResult } },
    },
    400: { description: 'У шага нет экрана для просмотра', content: error },
    ...common,
    404: { description: 'Шага нет в программе пользователя', content: error },
  },
});

/**
 * Шаг «Посмотреть» с экраном засчитывается, когда после «Перейти» пользователь 3 секунды смотрит
 * экран шага (решение заказчика 25.10.2026; прототип ckLook). Время считает экран: сервер проверяет,
 * что шаг в программе и у него есть экран.
 */
export function kbLookHandler(deps: ApiDeps): RouteHandler<typeof kbLookRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await asLearner(deps, c, async (tx, learner) => {
      const ctx = await programContext(tx, learner);
      const step = programStep(ctx, id);
      if (!step.learn || !step.def.at?.length) {
        apiFail(400, 'validation_failed', 'У шага нет экрана для просмотра');
      }
      return markSteps(tx, ctx, [{ step, how: 'visit' }], deps.clock.now(), { congrats: true });
    });
    return c.json(body, 200);
  };
}

export const kbHitRoute = createRoute({
  method: 'post',
  path: '/kb/hits/{hit}',
  tags: ['kb'],
  summary: 'Первое использование функции (поиск, столбцы, группировка, «В Excel»…)',
  request: { params: z.object({ hit: KbHit }) },
  responses: {
    200: {
      description: 'Шаги этой функции засчитаны «первым использованием»',
      content: { 'application/json': { schema: KbMarkResult } },
    },
    400: { description: 'Неверное имя функции', content: error },
    ...common,
  },
});

/**
 * Первое использование засчитывает шаг «Сделать» с этой функцией и «Посмотреть» раздела «Работа со
 * списками и интерфейсом»; остальные «Посмотреть» — только экраном, показом или статьёй (прототип
 * ckHit).
 */
export function kbHitHandler(deps: ApiDeps): RouteHandler<typeof kbHitRoute, AppEnv> {
  return async (c) => {
    const { hit } = c.req.valid('param');
    const body = await asLearner(deps, c, async (tx, learner) => {
      const ctx = await programContext(tx, learner);
      const marks = kbProgramSteps(ctx.program).flatMap((step) => {
        const how = kbHitMark(step, hit);
        return how ? [{ step, how }] : [];
      });
      return markSteps(tx, ctx, marks, deps.clock.now(), { congrats: true });
    });
    return c.json(body, 200);
  };
}

const skipResponses = {
  200: {
    description: 'Программа после изменения',
    content: { 'application/json': { schema: KbState } },
  },
  ...common,
  404: { description: 'Шага нет в программе пользователя', content: error },
} as const;

export const kbSkipRoute = createRoute({
  method: 'post',
  path: '/kb/steps/{id}/skip',
  tags: ['kb'],
  summary: '«Пропустить» шаг',
  request: { params: stepParams },
  responses: skipResponses,
});

export const kbUnskipRoute = createRoute({
  method: 'delete',
  path: '/kb/steps/{id}/skip',
  tags: ['kb'],
  summary: '«Вернуть» пропущенный шаг',
  request: { params: stepParams },
  responses: skipResponses,
});

/**
 * Пропущенный шаг серый: в уровень не засчитывается, но и не мешает идти дальше; засчитается сам, если
 * потом выполнить его условие (ТЗ, прототип renderKB → «Пропустить» / «Вернуть»). Выполненный шаг не
 * пропускается.
 */
function skipHandler(deps: ApiDeps, skipped: boolean): RouteHandler<typeof kbSkipRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await asLearner(deps, c, async (tx, learner) => {
      const ctx = await programContext(tx, learner);
      programStep(ctx, id);
      const changed = await kbSetSkipped(tx, id, skipped);
      return stateBody(tx, changed ? await programContext(tx, learner) : ctx, deps.clock.now());
    });
    return c.json(body, 200);
  };
}

export const kbSkipHandler = (deps: ApiDeps) => skipHandler(deps, true);
export const kbUnskipHandler = (deps: ApiDeps) => skipHandler(deps, false);
