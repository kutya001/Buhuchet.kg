import {
  orgMenuSettings,
  ProjectRefusedError,
  projectVisibility,
  withOrgContext,
  type ProjectViewer,
  type Tx,
} from '@buhuchet/db';
import {
  formatText,
  hasPermission,
  PROJECT_MESSAGES,
  scopeOf,
  type AccessSubject,
  type Feature,
} from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';
import type { SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf } from '../../middleware/access';
import { projScopeOf, servicesVisible } from '../finance/services';

/*
 * Общее модуля «Проекты контрагентов» (задача 2.26): кто смотрит, кто видит деньги, транзакция с
 * проверкой функции и отказы правил ответом API.
 */

export const error = { 'application/json': { schema: ApiError } };
export const json = <S>(schema: S) => ({ 'application/json': { schema } });
export const body = <S>(schema: S) => ({ required: true, content: json(schema) });

export const unauthorized = { description: 'Нет входа', content: error };
export const off = (right: string) => ({
  description: `«Проекты контрагентов» выключены в учётной политике или нет права ${right}`,
  content: error,
});
export const notFound = {
  description: 'Нет такого проекта или сотрудник его не видит',
  content: error,
};

/** Кто смотрит (прототип `projVisible`): сотрудник и область группы «Проекты контрагентов». */
export function projectViewerOf(subject: AccessSubject): ProjectViewer {
  return { employeeId: subject.employeeId, seeAll: scopeOf(subject, 'projects') === 'all' };
}

/** Какие проекты сотрудник видит — условие запроса. */
export const projectWhere = (subject: AccessSubject): SQL | undefined =>
  projectVisibility(projectViewerOf(subject));

/**
 * Поле «Проект» в форме задачи: «Проекты контрагентов» включены и есть право «Просматривать проекты»
 * (в прототипе — только функция). Иначе проект задачи не меняется, пока не сменили контрагента.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export const taskProjectsOn = (
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
): boolean => features.projects && hasPermission(subject, 'projView');

/** Где сотрудник создаёт проект: контрагенты области группы «Проекты контрагентов». */
export const projectCreateScope = projScopeOf;

/** Деньги проектов видны (прототип `moneyVis`). */
export const projectMoneyVisible = (
  subject: AccessSubject,
  features: Readonly<Pick<Record<Feature, boolean>, 'fee'>>,
): boolean => servicesVisible(subject, { fee: features.fee });

/**
 * Транши видны (окно транша, его файлы): деньги проектов видны и сотрудник видит проекты в модуле или
 * журнал «Финансовых операций» — там строки траншей (прототип opWin открывается из обоих мест).
 */
export const tranchesSeen = (subject: AccessSubject): boolean =>
  hasPermission(subject, 'projView') || hasPermission(subject, 'finView');

/** «Вести проекты и разовые услуги». */
export const canKeepProjects = (subject: AccessSubject): boolean =>
  hasPermission(subject, 'projects');

/** «Задача по проекту»: включены «Задачи» и есть право «Ставить задачи» (прототип `projActions`). */
export const canTaskProjects = (
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
): boolean => features.tasks && hasPermission(subject, 'tasksCreate');

/** Отказ правил проекта — ответом API: код, текст прототипа с подстановками, поле. */
export async function withProjectErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ProjectRefusedError) {
      apiFail(e.status, e.code, formatText(PROJECT_MESSAGES[e.code], e.params), {
        ...(e.field ? { field: e.field } : {}),
        ...e.params,
      });
    }
    throw e;
  }
}

/**
 * Транзакция модуля: «Проекты контрагентов» выключены в учётной политике — 403 `projects_off` (метод
 * проверяет функцию на сервере, а не только прячет меню); отказы правил — ответом API.
 */
export function inProjects<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, features: Record<Feature, boolean>) => Promise<T>,
  kind?: 'export',
): Promise<T> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    if (!features.projects) apiFail(403, 'projects_off', 'Проекты контрагентов выключены');
    return withProjectErrors(() => fn(tx, features));
  });
}
