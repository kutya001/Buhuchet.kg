import {
  kbArticles,
  kbCatalog,
  kbDoneFacts,
  kbFeatureOnDates,
  kbMarkDone,
  kbMarksOf,
  kbReachedOf,
  kbReadArticles,
  kbRecordLevels,
  kbScreenUi,
  orgMenuSettings,
  type KbReachedLevel,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  bishkekDate,
  FEATURES,
  KB_STEP_RULES,
  kbAdminAccess,
  kbArticleVisible,
  kbBusinessAccess,
  kbGroupStatus,
  kbLevelsToRecord,
  kbNextStep,
  kbProgram,
  kbProgramSteps,
  kbStats,
  kbStepArticle,
  kbStepIsNew,
  type KbAccess,
  type KbArticleDef,
  type KbCatalog,
  type KbScreenUi,
  type KbHow,
  type KbLevelDef,
  type KbMarks,
  type KbProgramGroup,
  type KbProgramStep,
  type KbStats,
} from '@buhuchet/domain';
import type { KbFreshStep, KbMarkResult, KbProgress, KbState } from '@buhuchet/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { asSessionUser } from '../../middleware/access';

/*
 * Программа обучения вошедшего (задача 2.30, docs/decisions.md п. Г-2): всё считается на сервере из
 * справочника шагов, прав, функций учётной политики и его отметок — те же правила, что у прототипа
 * (modules/kb-lessons.js), в `@buhuchet/domain`.
 */

/** Кто учится: сотрудник организации (права из сеанса) или администратор платформы. */
export interface KbLearner {
  userId: string;
  orgId: string | null;
  access: KbAccess;
}

/** Программа пользователя в транзакции: каталог, доступ, его шаги и отметки. */
export interface KbProgramContext {
  learner: KbLearner;
  catalog: KbCatalog;
  program: KbProgramGroup[];
  levels: readonly KbLevelDef[];
  marks: KbMarks;
  reached: KbReachedLevel[];
}

/** Сколько минут действие считается «только что сделанным»: способ «действием», а не «раньше». */
export const KB_RECENT_MINUTES = 10;

/**
 * Транзакция от имени вошедшего с его доступом: у сотрудника — права роли и функции учётной политики
 * организации, у администратора платформы — модули Админки. Без сотрудника и не администратор — 403.
 */
export function asLearner<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, learner: KbLearner) => Promise<T>,
): Promise<T> {
  const session = c.get('session')!;
  const access = c.get('access');
  if (!session.isPlatformAdmin && !access) {
    throw new HTTPException(403, {
      res: Response.json(apiError('forbidden', 'Нет права на это действие'), { status: 403 }),
    });
  }
  return asSessionUser(deps, session, async (tx) => {
    if (!session.orgId || !access) {
      return fn(tx, { userId: session.userId, orgId: null, access: kbAdminAccess() });
    }
    const { features, reportConfirm } = await orgMenuSettings(tx, session.orgId);
    return fn(tx, {
      userId: session.userId,
      orgId: session.orgId,
      access: kbBusinessAccess(access.subject, features, { reportConfirm }),
    });
  });
}

export async function programContext(tx: Tx, learner: KbLearner): Promise<KbProgramContext> {
  const catalog = await kbCatalog(tx);
  const marks = (await kbMarksOf(tx, [learner.userId])).get(learner.userId) ?? new Map();
  const reached = (await kbReachedOf(tx, [learner.userId])).get(learner.userId) ?? [];
  return {
    learner,
    catalog,
    program: kbProgram(catalog, learner.access),
    levels: learner.access.admin ? catalog.levels.admin : catalog.levels.business,
    marks,
    reached,
  };
}

const maxReached = (reached: readonly KbReachedLevel[]): number | null =>
  reached.length ? Math.max(...reached.map((r) => r.level)) : null;

export function statsOf(ctx: KbProgramContext): KbStats {
  return kbStats(ctx.program, ctx.marks, ctx.levels, maxReached(ctx.reached));
}

/** Уровень и прогресс для ответа: уровни с датами получения. */
export function progressBody(
  stats: KbStats,
  levels: readonly KbLevelDef[],
  reached: readonly KbReachedLevel[],
): KbProgress {
  return {
    total: stats.total,
    done: stats.done,
    pct: stats.pct,
    level: stats.level,
    next: stats.next,
    need: stats.need,
    stars: stats.stars,
    groups: stats.groups,
    levels: levels.map((l, i) => ({
      name: l.n,
      percent: l.p,
      reachedAt: reached.find((r) => r.level === i)?.at.toISOString() ?? null,
    })),
  };
}

/** Статьи, видные пользователю (прототип kbArts). */
export async function visibleArticles(tx: Tx, access: KbAccess): Promise<KbArticleDef[]> {
  return (await kbArticles(tx)).filter((a) => kbArticleVisible(a, access));
}

/**
 * «Можно включить» (прототип renderKB, `off`): выключенные функции учётной политики с пользой из
 * `kbUi.features`, у которых уже есть работающие уроки — иначе обещание «уроки появятся» неверно
 * (правило стыков: функция появится здесь со своей задачей).
 */
function featureOffers(
  info: KbFeatures,
  ctx: KbProgramContext,
): { feature: string; benefit: string }[] {
  if (ctx.learner.access.admin) return [];
  return FEATURES.filter((f) => {
    const g = info[f]?.g;
    return (
      !ctx.learner.access.feature(f) &&
      !!info[f]?.benefit &&
      !!g &&
      ctx.catalog.steps.some((s) => s.g === g && Object.hasOwn(KB_STEP_RULES, s.id))
    );
  }).map((f) => ({ feature: f, benefit: info[f]!.benefit! }));
}

type KbFeatures = NonNullable<KbScreenUi['features']>;

/**
 * Урок каждой функции учётной политики, который есть в программе (прототип featOnDlg: группа из
 * `kbUi.features[…].g`) — для «Пройти урок» в окне «Функция … включена».
 */
function featureLessons(info: KbFeatures, ctx: KbProgramContext): Record<string, string> {
  const lessons = new Set(ctx.program.map((g) => g.def.id));
  return Object.fromEntries(
    FEATURES.flatMap((f) => {
      const g = info[f]?.g;
      return g && lessons.has(g) ? [[f, g]] : [];
    }),
  );
}

/** Своя программа целиком (вкладки «Мой уровень» и «Уроки», «Мой профиль»). */
export async function stateBody(tx: Tx, ctx: KbProgramContext, now: Date): Promise<KbState> {
  const today = bishkekDate(now);
  const features = (await kbScreenUi(tx)).features ?? {};
  const articles = await visibleArticles(tx, ctx.learner.access);
  const read = await kbReadArticles(tx, ctx.learner.userId);
  const featureOn = ctx.learner.orgId
    ? await kbFeatureOnDates(tx, new Date(`${addDays(today, -31)}T00:00:00+06:00`))
    : {};
  const stepBody = (step: KbProgramStep) => {
    const mark = ctx.marks.get(step.def.id);
    return {
      id: step.def.id,
      title: step.def.t,
      why: step.def.w ?? '',
      star: step.star,
      learn: step.learn,
      isNew: kbStepIsNew(step, ctx.marks, featureOn, today),
      module: step.module,
      screens: step.learn ? [...(step.def.at ?? [])] : [],
      articleId: kbStepArticle(step, articles)?.id ?? null,
      done: mark?.done ?? null,
      skipped: !mark?.done && !!mark?.skipped,
    };
  };
  return {
    admin: ctx.learner.access.admin,
    progress: progressBody(statsOf(ctx), ctx.levels, ctx.reached),
    lessons: ctx.program.map((g) => {
      const status = kbGroupStatus(g, ctx.marks);
      return {
        id: g.def.id,
        title: g.def.t,
        screen: g.def.scr || null,
        status: status?.state ?? null,
        doneAt: status?.state === 'done' ? status.at : null,
        steps: g.steps.map(stepBody),
      };
    }),
    nextStepId: kbNextStep(ctx.program, ctx.marks)?.def.id ?? null,
    articles: { total: articles.length, read: articles.filter((a) => read.has(a.id)).length },
    offers: featureOffers(features, ctx),
    featureLessons: featureLessons(features, ctx),
  };
}

/**
 * Засчитать свои шаги и записать новые уровни (прототип ckMark и kbSync): уровень записывается, когда
 * процент его достиг, и не понижается; в первый раз — без поздравления. `congrats` — только если
 * пользователь видит отклик (не при тихой сверке).
 */
export async function markSteps(
  tx: Tx,
  ctx: KbProgramContext,
  marks: readonly { step: KbProgramStep; how: KbHow }[],
  now: Date,
  options: { congrats: boolean },
): Promise<KbMarkResult> {
  const fresh: KbFreshStep[] = [];
  for (const { step, how } of marks) {
    if (ctx.marks.get(step.def.id)?.done) continue;
    if (await kbMarkDone(tx, step.def.id, how)) {
      fresh.push({ id: step.def.id, title: step.def.t, learn: step.learn, how });
    }
  }
  const updated = fresh.length ? await programContext(tx, ctx.learner) : ctx;
  const stats = statsOf(updated);
  const record = kbLevelsToRecord(stats, maxReached(updated.reached));
  let final = updated;
  if (record.levels.length) {
    await kbRecordLevels(tx, record.levels);
    final = await programContext(tx, ctx.learner);
  }
  const congrats =
    options.congrats && record.congrats !== null
      ? (final.levels[record.congrats]?.n ?? null)
      : null;
  return { state: await stateBody(tx, final, now), fresh, congrats };
}

/**
 * Сверка «Сделать» с историей своих действий (ТЗ «если он уже делал это раньше (есть в истории
 * изменений под его именем), шаг отмечается сразу»): недавнее действие засчитывается «действием»,
 * давнее — «действием, сделанным раньше».
 */
export async function syncSteps(
  tx: Tx,
  ctx: KbProgramContext,
  now: Date,
  options: { congrats: boolean },
): Promise<KbMarkResult> {
  const open = kbProgramSteps(ctx.program).filter(
    (s) => s.rule.done && !ctx.marks.get(s.def.id)?.done,
  );
  const facts = await kbDoneFacts(
    tx,
    ctx.learner.userId,
    open.map((s) => ({ id: s.def.id, rule: s.rule.done! })),
  );
  const recent = now.getTime() - KB_RECENT_MINUTES * 60_000;
  const marks = open.flatMap((step) => {
    const at = facts.get(step.def.id);
    if (!at) return [];
    return [{ step, how: (at.getTime() >= recent ? 'action' : 'data') as KbHow }];
  });
  return markSteps(tx, ctx, marks, now, options);
}

/** Шаг программы пользователя; нет в программе — 404. */
export function programStep(ctx: KbProgramContext, id: string): KbProgramStep {
  const step = kbProgramSteps(ctx.program).find((s) => s.def.id === id);
  if (!step) {
    throw new HTTPException(404, {
      res: Response.json(apiError('not_found', 'Шаг не найден'), { status: 404 }),
    });
  }
  return step;
}
