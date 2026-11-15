import {
  CP_FAQ_ACTS,
  CP_FAQ_SECS,
  CP_HELP_HINT_KEYS,
  CP_HELP_MAX,
  CP_HELP_WELCOME_KEYS,
  CP_TOUR_SECS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion } from './common';

/*
 * Подсказки и обучение на странице контрагента (доработки 15.11.2026; прототип v120
 * modules/cp-help.js, admin/cp-help-admin.js): тексты «Добро пожаловать», облачка обзора, частые
 * вопросы «Помощи», «Словарик» и подсказки в окнах — раздел справочника `cpHelp`, один для всех
 * организаций. Страница получает их после кода; Админка → «База знаний (содержимое)» → «Страница
 * контрагента» правит их по одной записи с версией раздела.
 */

const Id = z.string().min(1).max(64);

export const CpTourStepSchema = z.object({
  id: Id,
  sec: z.enum(CP_TOUR_SECS),
  t: z.string().max(CP_HELP_MAX.tourTitle),
  x: z.string().max(CP_HELP_MAX.tourText),
  x2: z.string().max(CP_HELP_MAX.tourText).optional(),
  on: z.boolean(),
});

export const CpFaqSchema = z.object({
  id: Id,
  q: z.string().max(CP_HELP_MAX.question),
  a: z.string().max(CP_HELP_MAX.answer),
  sec: z.enum(CP_FAQ_SECS),
  act: z.enum(CP_FAQ_ACTS),
  ord: z.number().int(),
  on: z.boolean(),
});

export const CpGlossSchema = z.object({
  w: z.string().max(CP_HELP_MAX.word),
  x: z.string().max(CP_HELP_MAX.glossText),
  also: z.string().max(CP_HELP_MAX.also).optional(),
});

export const CpHelpSchema = z.object({
  welcome: z.partialRecord(z.enum(CP_HELP_WELCOME_KEYS), z.string().max(CP_HELP_MAX.text)),
  tour: z.array(CpTourStepSchema),
  faq: z.array(CpFaqSchema),
  gloss: z.array(CpGlossSchema),
  hints: z.partialRecord(z.enum(CP_HELP_HINT_KEYS), z.string().max(CP_HELP_MAX.text)),
});
export type CpHelpData = z.infer<typeof CpHelpSchema>;

/** Экран ввода кода: «Что это за страница?» и объяснение под ней (до кода — только эти два текста). */
export const CpCodeHelp = z.object({ what: z.string(), whatX: z.string() });
export type CpCodeHelp = z.infer<typeof CpCodeHelp>;

/**
 * «Контрагент посмотрел обзор страницы» или «…закрыл обзор на шаге N из M» — строка истории
 * контрагента (прототип `cphTourEnd`). Только числа: свободного текста от клиента нет.
 */
export const PublicPageTourInput = z
  .object({
    full: z.boolean(),
    step: z.number().int().min(1).max(CP_TOUR_SECS.length),
    of: z.number().int().min(1).max(CP_TOUR_SECS.length),
  })
  .refine((v) => v.step <= v.of, { path: ['step'], message: 'cph.tour.step' });

export const PublicPageTourOk = z.object({ ok: z.literal(true) });

/* ───────────── Админка ───────────── */

/** Тексты «Страницы контрагента» Админки с версией раздела. */
export const AdminCpHelp = z.object({ help: CpHelpSchema, version: RecordVersion });
export type AdminCpHelp = z.infer<typeof AdminCpHelp>;

const req = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/**
 * Правка одной записи раздела той версии, что видел администратор (прототип cphTextDlg, cphTourDlg,
 * cphFaqDlg, cphGlossDlg и пункты меню строк): текст «Приветствия» или «Подсказок в окнах», облачко
 * обзора, частый вопрос (без `id` — новый), слово «Словарика» (без `was` — новое), «Выше» / «Ниже» и
 * «Удалить».
 */
export const AdminCpHelpEdit = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('welcome'),
    key: z.enum(CP_HELP_WELCOME_KEYS),
    text: req(CP_HELP_MAX.text, 'cph.adm.err.text'),
    version: RecordVersion,
  }),
  z.object({
    op: z.literal('hint'),
    key: z.enum(CP_HELP_HINT_KEYS),
    text: req(CP_HELP_MAX.text, 'cph.adm.err.text'),
    version: RecordVersion,
  }),
  z.object({
    op: z.literal('tour'),
    id: Id,
    t: req(CP_HELP_MAX.tourTitle, 'cph.adm.err.title'),
    x: req(CP_HELP_MAX.tourText, 'cph.adm.err.text'),
    x2: z.string().trim().max(CP_HELP_MAX.tourText).optional(),
    on: z.boolean(),
    version: RecordVersion,
  }),
  z.object({
    op: z.literal('tourMove'),
    id: Id,
    dir: z.union([z.literal(-1), z.literal(1)]),
    version: RecordVersion,
  }),
  z.object({
    op: z.literal('faq'),
    id: Id.optional(),
    q: req(CP_HELP_MAX.question, 'cph.adm.err.question'),
    a: req(CP_HELP_MAX.answer, 'cph.adm.err.answer'),
    sec: z.enum(CP_FAQ_SECS),
    act: z.enum(CP_FAQ_ACTS),
    on: z.boolean(),
    version: RecordVersion,
  }),
  z.object({
    op: z.literal('faqMove'),
    id: Id,
    dir: z.union([z.literal(-1), z.literal(1)]),
    version: RecordVersion,
  }),
  z.object({ op: z.literal('faqDelete'), id: Id, version: RecordVersion }),
  z.object({
    op: z.literal('gloss'),
    was: z.string().max(CP_HELP_MAX.word).optional(),
    w: req(CP_HELP_MAX.word, 'cph.adm.err.word'),
    x: req(CP_HELP_MAX.glossText, 'cph.adm.err.gloss_text'),
    also: z.string().max(CP_HELP_MAX.also),
    version: RecordVersion,
  }),
  z.object({
    op: z.literal('glossDelete'),
    w: z.string().min(1).max(CP_HELP_MAX.word),
    version: RecordVersion,
  }),
]);
export type AdminCpHelpEdit = z.infer<typeof AdminCpHelpEdit>;
