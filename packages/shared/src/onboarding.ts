import { ONBOARDING_ANSWERS, ONBOARDING_STATES } from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion } from './common';
import { FeatureSchema } from './org';

/*
 * Первый запуск организации (ТЗ «Моя организация» → «Первый запуск организации»; задача 2.33,
 * docs/decisions.md п. Г-4): приветствие, опросник владельца, «Пройти опросник заново».
 */

export const OnboardingAnswerSchema = z.enum(ONBOARDING_ANSWERS);

/** Ответы опросника: код вопроса из refDB.json (`q-tasks`, …) → «Да», «Нет», «Не знаю». */
export const OnboardingAnswersSchema = z
  .record(z.string().regex(/^q-[a-z0-9-]{1,30}$/), OnboardingAnswerSchema)
  .refine((a) => Object.keys(a).length <= 40, { message: 'Слишком много ответов' });

const OnboardingSubQuestion = z.object({
  id: z.string(),
  q: z.string(),
  x: z.string(),
  on: z.array(FeatureSchema).optional(),
  set: z.literal('taskConfirm').optional(),
});

export const OnboardingQuestionSchema = z.object({
  id: z.string(),
  q: z.string(),
  x: z.string(),
  on: z.array(FeatureSchema),
  sub: OnboardingSubQuestion.optional(),
});

/** Тексты экранов приветствия и вопросы (refDB.json `onboarding`). */
export const OnboardingContentSchema = z.object({
  s1: z.object({
    t: z.string(),
    lead: z.string(),
    points: z.array(z.object({ i: z.string(), t: z.string(), x: z.string() })),
  }),
  s2: z.object({ t: z.string(), lead: z.string(), leadStaff: z.string() }),
  s3: z.object({
    t: z.string(),
    lead: z.string(),
    tAgain: z.string(),
    leadAgain: z.string(),
    planT: z.string(),
    planLead: z.string(),
  }),
  s4: z.object({
    t: z.string(),
    lead: z.string(),
    leadStaff: z.string(),
    howT: z.string(),
    how: z.string(),
  }),
  tax: z.object({ t: z.string(), lead: z.string() }),
  /** Модули, включённые всегда (`home`, `cps`, …, `profile`). */
  always: z.array(z.string()),
  /** Основной набор: значение функции при «Не знаю». */
  base: z.partialRecord(FeatureSchema, z.boolean()),
  questions: z.array(OnboardingQuestionSchema),
});
export type OnboardingContent = z.infer<typeof OnboardingContentSchema>;

/** Приветствие вошедшего: что открыть после входа, состояние опросника, тексты. */
export const Onboarding = z.object({
  /**
   * `quiz` — приветствие с опросником (тому, кто ведёт учётную политику, пока опросник не пройден и не
   * отложен), `tour` — без опросника (первый вход сотрудника); null — ничего, тогда «Что нового».
   */
  welcome: z.enum(['quiz', 'tour']).nullable(),
  /** null — организация создана до приветствия. */
  state: z.enum(ONBOARDING_STATES).nullable(),
  /** Опросник уже пройден — в учётной политике «Пройти опросник заново». */
  quizDone: z.boolean(),
  /** null — тексты не загружены: приветствие не открывается. */
  content: OnboardingContentSchema.nullable(),
  /** Строка «что делает» у модулей (`kbUi.mods`). */
  mods: z.record(z.string(), z.string()),
});
export type Onboarding = z.infer<typeof Onboarding>;

/** «Применить» опросника: план функций целиком и ответы. */
export const ApplyOnboardingRequest = z.object({
  answers: OnboardingAnswersSchema,
  /** Функции по плану; не названные — как в текущей учётной политике. */
  features: z.partialRecord(FeatureSchema, z.boolean()),
  taskConfirm: z.boolean(),
  /** Версия учётной политики, которую видел пользователь. */
  version: RecordVersion,
  /** Опросник пройден заново из учётной политики (в истории — «пройден заново»). */
  again: z.boolean(),
});
export type ApplyOnboardingRequest = z.infer<typeof ApplyOnboardingRequest>;

/** Что изменилось: включённые и выключенные функции (для окна «Функция … включена»). */
export const ApplyOnboardingResult = z.object({
  on: z.array(FeatureSchema),
  off: z.array(FeatureSchema),
  taskConfirm: z.boolean().nullable(),
});
export type ApplyOnboardingResult = z.infer<typeof ApplyOnboardingResult>;
