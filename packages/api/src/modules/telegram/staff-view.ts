import {
  botPeriodBrief,
  fixBotMessage,
  periodFull,
  taskBotMessage,
  type BotReportRow,
  type IsoDate,
  type ReminderItem,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import type { Db, Tx } from '@buhuchet/db';
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
  /** Внутри открытой транзакции — она сама (docs/decisions.md п. О-46). */
  db: Db | Tx = deps.db,
): Promise<Pick<TelegramEvent, 'view'>> {
  const [done, open] = await Promise.all([
    botText(deps, 'tgBtnDone', {}, db),
    botText(deps, 'tgBtnOpen', {}, db),
  ]);
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
  /** Внутри открытой транзакции — она сама (docs/decisions.md п. О-46). */
  db: Db | Tx = deps.db,
): Promise<Pick<TelegramEvent, 'view'>> {
  const [work, done, open] = await Promise.all([
    botText(deps, 'tgBtnTaskWork', {}, db),
    botText(deps, 'tgBtnTaskDone', {}, db),
    botText(deps, 'tgBtnTaskOpen', {}, db),
  ]);
  const url = taskSiteUrl(deps, task.id);
  return {
    view: (body) => taskBotMessage(task, body, { work, done, open }, url),
  };
}

/** Столбцы таблицы отчётов в сообщении бота и строка «ещё N — на сайте» (задача Т3). */
export function reportTableTexts(t: Translate): {
  columns: readonly [string, string, string];
  more: (n: number) => string;
} {
  return {
    columns: [t('telegram.table.contractor'), t('telegram.table.report'), t('telegram.table.due')],
    more: (n) => t('telegram.table.more', { n }),
  };
}

/**
 * Строка таблицы отчётов (прототип v100 `tgRepCell`): «НДС, окт.» и срок сдачи; у строки оплаты налога —
 * срок оплаты. Пометка «не привязан Telegram» и «ответственный не назначен» — та же, что в строках
 * напоминания; `mark` — «… — оплата» в списке просроченного.
 */
export function botReportRow(
  r: {
    id: string;
    contractorName: string;
    typeShort: string;
    period: ReportPeriod;
    periodStart: IsoDate;
    eventDate?: IsoDate | null;
    eventLabel?: string;
    dueDate: IsoDate;
    payDue: IsoDate | null;
  },
  item: Pick<ReminderItem, 'unlinked'> | null,
  pay: boolean,
  today: IsoDate,
  t: Translate,
  mark = false,
): BotReportRow {
  const cell = t('telegram.table.report_cell', {
    type: r.typeShort,
    period: botPeriodBrief(
      {
        period: r.period,
        start: r.periodStart,
        event: r.eventDate ?? null,
        ...(r.eventLabel ? { eventLabel: r.eventLabel } : {}),
      },
      today,
      t,
    ),
  });
  const marked = mark && pay ? t('telegram.table.pay_mark', { report: cell }) : cell;
  const report = item?.unlinked
    ? item.unlinked.shortName
      ? t('telegram.unlinked', { report: marked, name: item.unlinked.shortName })
      : t('telegram.unassigned', { report: marked })
    : marked;
  return {
    id: r.id,
    contractor: r.contractorName,
    report,
    due: pay && r.payDue ? r.payDue : r.dueDate,
  };
}
