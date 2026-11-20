import {
  DM_MODULES,
  DM_TOKEN_NAME_MAX,
  DM_TOKEN_STATES,
  DM_TOKEN_STOPS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { listPageSchema } from './list';

/*
 * «Витрина данных» → «API Токены» (доработки 20.11.2026: Витрина данных, блок 5; поток Т, этап 1, П14;
 * прототип v153–v155 `modules/vitrina.js`): список, окно «Новый API-токен», токен один раз, окно токена
 * с журналом запросов, «Отозвать» и «Перевыпустить». У организации — `/api/dm/tokens`, в Админке —
 * `/api/admin/dm/tokens`, ответы одинаковые. Самого токена в ответах нет, кроме ответа выпуска.
 */

/** Номер токена в пути. */
export const DmTokenIdParam = z.object({ id: Uuid });

/** Строка списка: состояние посчитано сервером, пояснение под ним — готовым текстом. */
export const DmTokenRow = z.object({
  id: Uuid,
  name: z.string(),
  /** Начало токена «bk_a1b2c3» — показывается как «bk_a1b2c3…». */
  prefix: z.string(),
  state: z.enum(DM_TOKEN_STATES),
  /** Почему остановлен, кто и когда отозвал, до когда работает перевыпущенный; пусто — ничего. */
  note: z.string(),
  /** Организация токена; у токена Админки — «Администратор платформы» (прототип `dmOrgN`). */
  orgName: z.string(),
  tplName: z.string(),
  byName: z.string(),
  createdAt: z.iso.datetime(),
  /** Действует до: срок, у перевыпущенного — конец суток после перевыпуска. */
  till: z.iso.datetime(),
  lastAt: z.iso.datetime().nullable(),
  lastIp: z.string().nullable(),
  n30: z.number().int().nonnegative(),
  /** Токен Админки или своей организации: «Как подключить» и «Перевыпустить» (этап 2). */
  mine: z.boolean(),
  /** Можно ли перевыпустить (свой, не отозван, не истёк, ещё не перевыпущен) и отозвать. */
  canReissue: z.boolean(),
  canRevoke: z.boolean(),
});
export type DmTokenRow = z.infer<typeof DmTokenRow>;

export const DmTokenList = listPageSchema(DmTokenRow);
export type DmTokenList = z.infer<typeof DmTokenList>;

/** Почему токен нельзя выпустить (ключи словаря `err.<код>`). */
export const DM_TOKEN_REFUSALS = [
  'dm_token_demo',
  'dm_token_no_right',
  'dm_token_api_off',
  'dm_token_sub_closed',
  'dm_token_limit',
  'dm_token_no_templates',
] as const;

/** Шаблон в окне «Новый API-токен»: группа — модуль (у Админки — «Для администратора»). */
export const DmTokenTemplateOption = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  module: z.enum(DM_MODULES).nullable(),
});
export type DmTokenTemplateOption = z.infer<typeof DmTokenTemplateOption>;

/** Окно «Новый API-токен» и строка над списком: что мешает, шаблоны, сроки. */
export const DmTokenForm = z.object({
  /** Что мешает выпуску сейчас (прототип `dmNewDlg`); null — можно. */
  refusal: z.enum(DM_TOKEN_REFUSALS).nullable(),
  /** Демо-организация (у организации): вместо списка — «В демо-версии токены не выпускаются». */
  demo: z.boolean(),
  /** «Внешний доступ по API» выключен (у организации): красная строка над списком. */
  apiOff: z.boolean(),
  /** Владелец: в красной строке — «Открыть настройки». */
  owner: z.boolean(),
  /** Действующих — не больше. */
  max: z.number().int().positive(),
  templates: z.array(DmTokenTemplateOption),
  terms: z.array(z.number().int().positive()),
  defaultTerm: z.number().int().positive(),
});
export type DmTokenForm = z.infer<typeof DmTokenForm>;

/** «Создать»: шаблон, название и срок; проверки и тексты отказов — у сервера. */
export const DmTokenCreate = z.object({
  templateId: Uuid,
  name: z.string().max(DM_TOKEN_NAME_MAX * 2),
  term: z.number().int(),
});
export type DmTokenCreate = z.infer<typeof DmTokenCreate>;

/** Запрос журнала токена: параметры — строкой «month=2026-11», итог — «Успешно» или «Ошибка». */
export const DmTokenRequestRow = z.object({
  at: z.iso.datetime(),
  params: z.string(),
  rows: z.number().int().nonnegative().nullable(),
  ms: z.number().int().nonnegative().nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
  ip: z.string().nullable(),
});

/** Окно токена (прототип `dmTokDlg`): строки сведений, журнал запросов (последние 50) и действия. */
export const DmTokenCard = DmTokenRow.extend({
  stop: z.enum(DM_TOKEN_STOPS).nullable(),
  /** Начало токена, который этот заменил при перевыпуске. */
  prevPrefix: z.string().nullable(),
  log: z.object({ total: z.number().int().nonnegative(), items: z.array(DmTokenRequestRow) }),
});
export type DmTokenCard = z.infer<typeof DmTokenCard>;

/** Ответ выпуска и перевыпуска: токен целиком — один раз — и окно нового токена. */
export const DmTokenIssued = z.object({
  token: z.string(),
  item: DmTokenCard,
});
export type DmTokenIssued = z.infer<typeof DmTokenIssued>;
