import { JOB_STATES, RUN_PERIODS, RUN_STATUSES } from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { ListExportParams, ListQueryParams, ListValuesQuery, listPageSchema } from './list';

/*
 * Админка → «Запуски» (решение заказчика 17.11.2026; ТЗ «Доработки 17.11.2026», блок «Админка: запуски
 * по расписанию и переписка бота», пункты 1–2; прототип v132 admin/runs.js; docs/decisions.md п. Т-15):
 * задачи по расписанию и журнал их запусков. Только просмотр, только администратору платформы.
 */

/**
 * Задача по расписанию: название и «Что делает» — тексты словаря, «Как часто» — словами, последний
 * запуск с итогом, последний успех, неудач подряд и состояние («Работает», «Падает», «Не запускалась»).
 */
export const AdminJobRow = z.object({
  name: z.string(),
  title: z.string(),
  every: z.string(),
  what: z.string(),
  lastAt: z.iso.datetime().nullable(),
  lastStatus: z.enum(RUN_STATUSES).nullable(),
  okAt: z.iso.datetime().nullable(),
  fails: z.number().int().nonnegative(),
  state: z.enum(JOB_STATES),
});
export type AdminJobRow = z.infer<typeof AdminJobRow>;

export const AdminJobList = listPageSchema(AdminJobRow);
export type AdminJobList = z.infer<typeof AdminJobList>;

/** Плашки над задачами: «Работают N из M», «Падают», «Не запускались», «Ошибок за сутки». */
export const AdminJobSummary = z.object({
  total: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  failing: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  dayErrors: z.number().int().nonnegative(),
});
export type AdminJobSummary = z.infer<typeof AdminJobSummary>;

/** Период журнала запусков: 1 (сегодня по Бишкеку), 7 или 30 дней; по умолчанию — 7. */
const RunDays = z.enum(RUN_PERIODS.map(String) as [string, ...string[]]);

/**
 * Что показывает журнал запусков сверх поиска и фильтров: период и «Важные · Все» (`all=1` — все;
 * иначе только ошибки, идущие сейчас и запуски, которые что-то сделали).
 */
const runScope = {
  days: RunDays.optional(),
  all: z.enum(['0', '1']).optional(),
};
export const AdminRunQuery = ListQueryParams.extend(runScope);
export const AdminRunValuesQuery = ListValuesQuery.extend(runScope);
export const AdminRunExportQuery = ListExportParams.extend(runScope);

/**
 * Номер запуска для окна «Запуск»: «задача:время по расписанию в миллисекундах:попытка». Каждая попытка
 * запуска — своя строка журнала.
 */
export const AdminRunId = z.string().regex(/^[a-z][a-z0-9.-]{0,63}:\d{1,15}:[1-9]\d?$/);

/** Строка журнала запусков: одна попытка. `done` — сколько записей обработано (0 — «Нечего делать»). */
export const AdminRunRow = z.object({
  id: z.string(),
  job: z.string(),
  title: z.string(),
  slot: z.iso.datetime(),
  attempt: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(RUN_STATUSES),
  /** Длительность, мс; null — ещё выполняется. */
  ms: z.number().int().nonnegative().nullable(),
  done: z.number().int().nonnegative().nullable(),
  /** «Что сделано» словами: «Отправлено сообщений: 3», «Нечего делать»; null — задача этого не считает. */
  doneText: z.string().nullable(),
  error: z.string().nullable(),
});
export type AdminRunRow = z.infer<typeof AdminRunRow>;

export const AdminRunList = listPageSchema(AdminRunRow);
export type AdminRunList = z.infer<typeof AdminRunList>;

/**
 * Окно «Запуск»: попытка, «Как часто» её задачи, другие попытки того же запуска и сообщение о сбое
 * администраторам (номер строки журнала Telegram), если оно ушло после этой попытки.
 */
export const AdminRunCard = z.object({
  run: AdminRunRow,
  every: z.string().nullable(),
  attempts: z.array(AdminRunRow),
  alert: z.object({ id: Uuid, at: z.iso.datetime() }).nullable(),
});
export type AdminRunCard = z.infer<typeof AdminRunCard>;
