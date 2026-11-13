import {
  fixBotMessage,
  periodFull,
  taskBotMessage,
  type IsoDate,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { botText } from './bot';
import type { TelegramEvent } from './events';

/*
 * Вид сообщений сотруднику с кнопками (поток Т, задача Т2; прототип v97 modules/tg-staff.js): адреса
 * кнопок «Открыть», названия отчётов и сообщения о событиях сайта — «Новая задача» и возврат «На
 * исправление». Отдельно от обработчиков нажатий (`staff-actions.ts`), чтобы модули задач и отчётов
 * брали отсюда только вид.
 */

/** Адрес записи на сайте для кнопки «Открыть»; null — адрес сайта не https (кнопка-ссылка невозможна). */
export function botSiteUrl(
  deps: { config: Pick<ApiDeps['config'], 'APP_BASE_URL'> },
  path: string,
): string | null {
  const url = new URL(path, deps.config.APP_BASE_URL);
  return url.protocol === 'https:' ? url.href : null;
}
export const reportSiteUrl = (deps: ApiDeps, id: string) =>
  botSiteUrl(deps, `/app/reports/all?report=${id}`);
export const taskSiteUrl = (deps: ApiDeps, id: string) =>
  botSiteUrl(deps, `/app/tasks/mine?task=${id}`);

/** «НДС за октябрь 2026» и «НДС за октябрь 2026, ОсОО Ромашка» (прототип `tgRepName`, `tgRepFull`). */
export function botReportNames(
  facts: { typeShort: string; period: ReportPeriod; periodStart: IsoDate; contractorName: string },
  t: Translate,
): { name: string; full: string } {
  const name = t('telegram.item.report_name', {
    type: facts.typeShort,
    period: periodFull({ period: facts.period, start: facts.periodStart }, t),
  });
  return { name, full: t('telegram.item.report_full', { name, contractor: facts.contractorName }) };
}

/**
 * Сообщение о возврате «На исправление» с кнопками отчёта («Сдан», «Открыть»; прототип `tgFixMsg`): им
 * пользуется возврат и с сайта, и из чата.
 */
export async function fixView(
  deps: ApiDeps,
  reportId: string,
): Promise<Pick<TelegramEvent, 'view'>> {
  const [done, open] = await Promise.all([botText(deps, 'tgBtnDone'), botText(deps, 'tgBtnOpen')]);
  const url = reportSiteUrl(deps, reportId);
  return { view: (body) => fixBotMessage(reportId, body, { done, open }, url) };
}

/**
 * Сообщение исполнителю о новой задаче с кнопками (прототип `tgTaskMsg`): название — заголовком, текст
 * шаблона — под ним; «Взять в работу» (только у «К выполнению»), «Выполнена», ниже — «Открыть задачу».
 */
export async function taskView(
  deps: ApiDeps,
  task: { id: string; title: string; todo: boolean },
): Promise<Pick<TelegramEvent, 'view'>> {
  const [work, done, open] = await Promise.all([
    botText(deps, 'tgBtnTaskWork'),
    botText(deps, 'tgBtnTaskDone'),
    botText(deps, 'tgBtnTaskOpen'),
  ]);
  const url = taskSiteUrl(deps, task.id);
  return {
    view: (body) => taskBotMessage(task, body, { work, done, open }, url),
  };
}
