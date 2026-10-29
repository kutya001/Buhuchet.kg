import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { kbAddKnown, kbKnownKeys, kbResetKnown, kbShowContent } from '@buhuchet/db';
import { KB_KNOWN_LIMIT, kbOnStepScreen, kbProgramSteps } from '@buhuchet/domain';
import {
  ApiError,
  KbCode,
  KbKnownAddRequest,
  KbKnownCount,
  KbKnownList,
  KbMarkResult,
  KbScreenShowRequest,
  KbShowContent,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { asLearner, markSteps, programContext, programStep } from './state';

/*
 * «Показать как» и «Обзор экрана» (задача 2.31, ТЗ «База знаний» → «Показать как», «Знакомые
 * элементы»; docs/decisions.md п. Г-5): сценарии и тексты облачков, свои знакомые элементы и отметка
 * шагов «Посмотреть», пройденных показом до конца. Показ идёт в браузере по живому экрану; сервер
 * проверяет, что шаг в программе пользователя, и засчитывает его.
 */

const error = { 'application/json': { schema: ApiError } };
const common = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Сотрудник организации или администратор платформы', content: error },
} as const;

export const kbShowsRoute = createRoute({
  method: 'get',
  path: '/kb/shows',
  tags: ['kb'],
  summary: 'Сценарии «Показать как» и тексты облачков',
  responses: {
    200: {
      description: 'Активные сценарии шагов и тексты элементов экрана (refDB.json)',
      content: { 'application/json': { schema: KbShowContent } },
    },
    ...common,
  },
});

/** Сценарии одинаковы для всех: что показывать, решает программа пользователя на экране. */
export function kbShowsHandler(deps: ApiDeps): RouteHandler<typeof kbShowsRoute, AppEnv> {
  return async (c) => {
    const body = await asLearner(deps, c, (tx) => kbShowContent(tx));
    return c.json(body, 200);
  };
}

export const kbKnownRoute = createRoute({
  method: 'get',
  path: '/kb/known',
  tags: ['kb'],
  summary: 'Свои знакомые элементы показов',
  responses: {
    200: {
      description: 'Ключи элементов, которые пользователю уже объяснили',
      content: { 'application/json': { schema: KbKnownList } },
    },
    ...common,
  },
});

export function kbKnownHandler(deps: ApiDeps): RouteHandler<typeof kbKnownRoute, AppEnv> {
  return async (c) => {
    const keys = await asLearner(deps, c, (tx) => kbKnownKeys(tx));
    return c.json({ keys, limit: KB_KNOWN_LIMIT }, 200);
  };
}

export const kbKnownAddRoute = createRoute({
  method: 'post',
  path: '/kb/known',
  tags: ['kb'],
  summary: 'Запомнить знакомые элементы',
  request: {
    body: { required: true, content: { 'application/json': { schema: KbKnownAddRequest } } },
  },
  responses: {
    200: {
      description: 'Сколько знакомых элементов теперь',
      content: { 'application/json': { schema: KbKnownCount } },
    },
    400: { description: 'Неверные ключи', content: error },
    ...common,
  },
});

/**
 * Облачко, с которого ушли «Далее» или «Готово», становится знакомым (ТЗ «Знакомые элементы»). Список
 * у пользователя и общий для ПК и телефона; больше предела не запоминается.
 */
export function kbKnownAddHandler(deps: ApiDeps): RouteHandler<typeof kbKnownAddRoute, AppEnv> {
  return async (c) => {
    const { keys } = c.req.valid('json');
    const count = await asLearner(deps, c, (tx) => kbAddKnown(tx, keys));
    return c.json({ count }, 200);
  };
}

export const kbKnownResetRoute = createRoute({
  method: 'delete',
  path: '/kb/known',
  tags: ['kb'],
  summary: '«Показывать всё заново»',
  responses: {
    200: {
      description: 'Знакомых элементов больше нет; `removed` — сколько их было',
      content: { 'application/json': { schema: KbKnownCount } },
    },
    ...common,
  },
});

/** Показы снова проходят по всем элементам; выполненные шаги и уровень не меняются. */
export function kbKnownResetHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbKnownResetRoute, AppEnv> {
  return async (c) => {
    const removed = await asLearner(deps, c, (tx) => kbResetKnown(tx));
    return c.json({ count: 0, removed }, 200);
  };
}

const marked = {
  description: 'Программа после отметки, новые засчитанные шаги и новый уровень',
  content: { 'application/json': { schema: KbMarkResult } },
};

export const kbStepShowRoute = createRoute({
  method: 'post',
  path: '/kb/steps/{id}/show',
  tags: ['kb'],
  summary: '«Показать как» шага «Посмотреть» пройден до конца',
  request: { params: z.object({ id: KbCode }) },
  responses: {
    200: marked,
    400: { description: 'Шаг «Сделать» засчитывается сохранением', content: error },
    ...common,
    404: { description: 'Шага нет в программе пользователя', content: error },
  },
});

/**
 * «Готово» в конце показа засчитывает шаг «Посмотреть» способом «показом» (ТЗ: «проход до «Готово»
 * засчитывает»); «Закончить показ» раньше — запроса нет. Шаг «Сделать» показ не засчитывает.
 */
export function kbStepShowHandler(deps: ApiDeps): RouteHandler<typeof kbStepShowRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await asLearner(deps, c, async (tx, learner) => {
      const ctx = await programContext(tx, learner);
      const step = programStep(ctx, id);
      if (!step.learn) {
        apiFail(400, 'validation_failed', 'Шаг «Сделать» засчитывается, когда действие сохранено');
      }
      return markSteps(tx, ctx, [{ step, how: 'show' }], deps.clock.now(), { congrats: true });
    });
    return c.json(body, 200);
  };
}

export const kbScreenShowRoute = createRoute({
  method: 'post',
  path: '/kb/screens/show',
  tags: ['kb'],
  summary: '«Обзор экрана» пройден до конца',
  request: {
    body: { required: true, content: { 'application/json': { schema: KbScreenShowRequest } } },
  },
  responses: {
    200: marked,
    400: { description: 'Неверный экран', content: error },
    ...common,
  },
});

/**
 * Обзор экрана не засчитывает шаги, кроме шагов «Посмотреть» этого экрана (ТЗ; прототип tourEnd):
 * засчитываются «показом» шаги программы, у которых этот экран (или его модуль) — экран шага.
 */
export function kbScreenShowHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbScreenShowRoute, AppEnv> {
  return async (c) => {
    const { screen } = c.req.valid('json');
    const [module, tab = null] = screen.split('.') as [string, string?];
    const body = await asLearner(deps, c, async (tx, learner) => {
      const ctx = await programContext(tx, learner);
      const marks = kbProgramSteps(ctx.program)
        .filter((s) => s.learn && kbOnStepScreen(s.def, module, tab))
        .map((step) => ({ step, how: 'show' as const }));
      return markSteps(tx, ctx, marks, deps.clock.now(), { congrats: true });
    });
    return c.json(body, 200);
  };
}
