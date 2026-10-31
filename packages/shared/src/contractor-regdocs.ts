import { RD_KEYS, RD_KINDS, RD_MAX_FILES } from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';

/*
 * Создание контрагента «Из свидетельства и выписки» (Бета; задача 2.17; ТЗ «Создание контрагента из
 * свидетельства и выписки (Бета)»; прототип modules/contractor-regdocs.js — regDocsDlg, rdRun; core/regdocs.js
 * — rdToCp): загрузка PDF в хранилище, «Распознать» на сервере и итог, которым заполняется форма.
 */

/** Начать загрузку документа: имя PDF и размер (до 10 МБ). */
export const RegdocsUploadStart = z.strictObject({
  name: z.string().min(1).max(1000),
  size: z.number().int().nonnegative(),
});
export type RegdocsUploadStart = z.infer<typeof RegdocsUploadStart>;

/** «Распознать»: загруженные документы окна, по порядку (до 4). */
export const RegdocsRecognizeRequest = z.strictObject({
  files: z.array(Uuid).min(1).max(RD_MAX_FILES),
});
export type RegdocsRecognizeRequest = z.infer<typeof RegdocsRecognizeRequest>;

/** Почему документ не распознан (прототип rdRun: текст у файла). */
export const REGDOCS_FILE_ERRORS = ['size', 'password', 'read', 'kind', 'ip', 'upload'] as const;
export type RegdocsFileError = (typeof REGDOCS_FILE_ERRORS)[number];

/** Документ после «Распознать»: вид и дата выдачи — или почему не распознан. */
export const RegdocsFile = z.object({
  id: Uuid,
  state: z.enum(['ok', 'bad']),
  kind: z.enum(RD_KINDS).nullable(),
  issued: z.string(),
  error: z.enum(REGDOCS_FILE_ERRORS).nullable(),
});
export type RegdocsFile = z.infer<typeof RegdocsFile>;

const RdKey = z.enum(RD_KEYS);
const RdValue = z.union([z.string(), z.number()]);
const GkedOption = z.object({ code: z.string(), name: z.string() });

/** Итог по документам (прототип rdToCp): реквизиты, откуда они, расхождения, ГКЭД и налоговый орган. */
export const RegdocsResult = z.object({
  v: z.partialRecord(RdKey, RdValue),
  src: z.partialRecord(RdKey, z.enum([...RD_KINDS, 'both'])),
  alt: z.partialRecord(
    RdKey,
    z.array(z.object({ v: RdValue, src: z.enum(RD_KINDS), date: z.string() })),
  ),
  /**
   * Основной ГКЭД: подставленный подкласс (`code`, пусто — не найден), выбор среди подклассов
   * класса или группы, до 5 похожих по названию, код и текст из документа, дополнительные подклассы.
   */
  gk: z
    .object({
      code: z.string(),
      name: z.string(),
      choose: z.array(GkedOption),
      like: z.array(GkedOption),
      raw: z.string(),
      text: z.string(),
      src: z.enum(RD_KINDS),
      more: z.array(GkedOption),
    })
    .nullable(),
  /** Налоговый орган, предложенный по адресу (код); пусто — не найден. */
  ugns: z.string(),
  stopped: z.boolean(),
  status: z.string(),
  phoneBad: z.string(),
});
export type RegdocsResult = z.infer<typeof RegdocsResult>;

/**
 * Ответ «Распознать»: документы по порядку; ошибка итога — два документа одного вида, ни один не
 * распознан, документы разных организаций; итог; контрагент с этим ИНН, если он уже есть (вне области
 * сотрудника — без номера и названия).
 */
export const RegdocsRecognized = z.object({
  files: z.array(RegdocsFile),
  error: z.enum(['same', 'none', 'diff']).nullable(),
  sameKind: z.enum(RD_KINDS).nullable(),
  result: RegdocsResult.nullable(),
  duplicate: z
    .object({
      inn: z.string(),
      id: Uuid.nullable(),
      name: z.string().nullable(),
      archived: z.boolean(),
    })
    .nullable(),
});
export type RegdocsRecognized = z.infer<typeof RegdocsRecognized>;

/**
 * Документы к новому контрагенту: загруженные в окне «Из свидетельства и выписки» (прикрепятся к нему);
 * `recognized` — форма заполнена из них (в истории — «Создан из свидетельства и выписки (бета)»).
 */
export const ContractorRegdocs = z.strictObject({
  files: z.array(Uuid).max(RD_MAX_FILES),
  recognized: z.boolean(),
});
export type ContractorRegdocs = z.infer<typeof ContractorRegdocs>;
