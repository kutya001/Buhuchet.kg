import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { kbMarkArticleRead, kbReadArticles, kbScreenUi } from '@buhuchet/db';
import {
  kbArticleBlocks,
  kbArticleText,
  kbProgramSteps,
  kbScreenBlocks,
  kbStepArticle,
} from '@buhuchet/domain';
import {
  ApiError,
  KbArticle,
  KbArticleList,
  KbArticleReadRequest,
  KbArticleReadResult,
  KbCode,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { asLearner, markSteps, programContext, visibleArticles } from './state';

const error = { 'application/json': { schema: ApiError } };
const params = z.object({ id: KbCode });
const common = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Сотрудник организации или администратор платформы', content: error },
} as const;

export const kbArticlesRoute = createRoute({
  method: 'get',
  path: '/kb/articles',
  tags: ['kb'],
  summary: 'Статьи «Базы знаний»',
  responses: {
    200: {
      description:
        'Статьи, видные пользователю (режим, модули меню, права, функции), с текстом без разметки для поиска',
      content: { 'application/json': { schema: KbArticleList } },
    },
    ...common,
  },
});

/**
 * Вкладка «Статьи» (прототип renderKB → arts): поиск по названию и тексту идёт на экране — статей
 * немного, текст без разметки приходит сразу. Статьи о модулях не из меню и о модулях, которых ещё
 * нет, не отдаются.
 */
export function kbArticlesHandler(deps: ApiDeps): RouteHandler<typeof kbArticlesRoute, AppEnv> {
  return async (c) => {
    const items = await asLearner(deps, c, async (tx, learner) => {
      const read = await kbReadArticles(tx, learner.userId);
      return (await visibleArticles(tx, learner.access)).map((a) => ({
        id: a.id,
        section: a.sec,
        title: a.t,
        module: a.mod ?? null,
        text: kbArticleText(a.html),
        read: read.has(a.id),
      }));
    });
    return c.json({ items }, 200);
  };
}

export const kbArticleRoute = createRoute({
  method: 'get',
  path: '/kb/articles/{id}',
  tags: ['kb'],
  summary: 'Статья целиком',
  request: { params },
  responses: {
    200: {
      description: 'Статья блоками (без HTML) и описания экранов модулей из справочника kbUi',
      content: { 'application/json': { schema: KbArticle } },
    },
    ...common,
    404: { description: 'Статьи нет или она не видна пользователю', content: error },
  },
});

/**
 * Окно статьи (прототип kbArtDlg): текст — блоками, разметку из справочника на страницу не вставляем;
 * метка описания экрана разворачивается из `kbUi` (как в «Показать как»).
 */
export function kbArticleHandler(deps: ApiDeps): RouteHandler<typeof kbArticleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await asLearner(deps, c, async (tx, learner) => {
      const article = (await visibleArticles(tx, learner.access)).find((a) => a.id === id);
      if (!article) apiFail(404, 'not_found', 'Статья не найдена');
      const blocks = kbArticleBlocks(article.html);
      const ui = await kbScreenUi(tx);
      const screens = Object.fromEntries(
        blocks.flatMap((b) =>
          b.type === 'screen' ? [[b.module, kbScreenBlocks(ui, b.module)]] : [],
        ),
      );
      const read = await kbReadArticles(tx, learner.userId);
      return {
        id: article.id,
        section: article.sec,
        title: article.t,
        module: article.mod ?? null,
        read: read.has(article.id),
        blocks,
        screens,
      };
    });
    return c.json(body, 200);
  };
}

export const kbArticleReadRoute = createRoute({
  method: 'post',
  path: '/kb/articles/{id}/read',
  tags: ['kb'],
  summary: 'Статья прочитана до конца',
  request: {
    params,
    body: { required: true, content: { 'application/json': { schema: KbArticleReadRequest } } },
  },
  responses: {
    200: {
      description: 'Статья отмечена прочитанной; связанные шаги «Посмотреть» засчитаны',
      content: { 'application/json': { schema: KbArticleReadResult } },
    },
    400: { description: 'Неверный запрос', content: error },
    ...common,
    404: { description: 'Статьи нет или она не видна пользователю', content: error },
  },
});

/**
 * Статья прочитана — открыта и прокручена до конца (ТЗ); засчитывает шаги «Посмотреть», к которым она
 * привязана, и шаг, из которого её открыли, если это его статья (прототип kbArtRead).
 */
export function kbArticleReadHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbArticleReadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { stepId } = c.req.valid('json');
    const body = await asLearner(deps, c, async (tx, learner) => {
      const articles = await visibleArticles(tx, learner.access);
      const article = articles.find((a) => a.id === id);
      if (!article) apiFail(404, 'not_found', 'Статья не найдена');
      const first = await kbMarkArticleRead(tx, article.id);
      const ctx = await programContext(tx, learner);
      const marks = kbProgramSteps(ctx.program)
        .filter(
          (s) =>
            s.learn &&
            (s.def.art === article.id ||
              (s.def.id === stepId && kbStepArticle(s, articles)?.id === article.id)),
        )
        .map((step) => ({ step, how: 'art' as const }));
      const result = await markSteps(tx, ctx, marks, deps.clock.now(), { congrats: true });
      return { ...result, first };
    });
    return c.json(body, 200);
  };
}
