import { FEATURE_REQUIRES } from '../org/policy';
import { FEATURES, type Feature } from '../roles/permissions';

/*
 * Первый запуск организации (задача 2.33; ТЗ «Моя организация» → «Первый запуск организации»; прототип
 * modules/onboard.js): приветствие, опросник владельца, план функций и «Выбор налогов». Тексты экранов,
 * вопросы и основной набор — refDB.json `onboarding` (`platform_reference`), здесь — их форма и правила.
 */

/** Ответ на вопрос опросника: «Да», «Нет», «Не знаю» (значение основного набора). */
export const ONBOARDING_ANSWERS = ['yes', 'no', 'unk'] as const;
export type OnboardingAnswer = (typeof ONBOARDING_ANSWERS)[number];
export type OnboardingAnswers = Record<string, OnboardingAnswer>;

/** Вопрос, который задаётся при «Да» на основной: свои функции или «Задачи требуют подтверждения». */
export interface OnboardingSubQuestion {
  id: string;
  q: string;
  x: string;
  on?: Feature[];
  set?: 'taskConfirm';
}

export interface OnboardingQuestion {
  id: string;
  /** Вопрос и строка пояснения, что включится. */
  q: string;
  x: string;
  on: Feature[];
  sub?: OnboardingSubQuestion;
}

/** Состояние приветствия организации: создана с приветствием, опросник отложен «Позже», пройден. */
export const ONBOARDING_STATES = ['new', 'later', 'done'] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** Экраны приветствия (прототип welcomeOpen, `WL.screens`). */
export const WELCOME_SCREENS = ['hello', 'mods', 'quiz', 'plan', 'start', 'taxes'] as const;
export type WelcomeScreen = (typeof WELCOME_SCREENS)[number];

/** Что показать вошедшему: приветствие с опросником (владелец) или без него (сотрудник, повтор). */
export type WelcomeKind = 'quiz' | 'tour';

/** Функции по плану опросника и «Задачи требуют подтверждения». */
export interface OnboardingPlan {
  features: Record<Feature, boolean>;
  taskConfirm: boolean;
}

/** Все коды ответов: вопросы и их подвопросы по порядку. */
export function onboardingAnswerIds(questions: readonly OnboardingQuestion[]): string[] {
  return questions.flatMap((q) => [q.id, ...(q.sub ? [q.sub.id] : [])]);
}

/** Ответы первого запуска — везде «Не знаю» (прототип obAnsInit(false)). */
export function onboardingFreshAnswers(
  questions: readonly OnboardingQuestion[],
): OnboardingAnswers {
  return Object.fromEntries(onboardingAnswerIds(questions).map((id) => [id, 'unk']));
}

/**
 * Ответы «Пройти опросник заново» — по текущей учётной политике (ТЗ «ответы подставлены по текущей
 * политике»; прототип obAnsInit(true)): «Да», если включены все функции вопроса.
 */
export function onboardingAnswersOf(
  questions: readonly OnboardingQuestion[],
  features: Readonly<Record<Feature, boolean>>,
  taskConfirm: boolean,
): OnboardingAnswers {
  const all = (keys: readonly Feature[] | undefined) => (keys ?? []).every((k) => features[k]);
  const answers: OnboardingAnswers = {};
  for (const q of questions) {
    answers[q.id] = all(q.on) ? 'yes' : 'no';
    if (q.sub) {
      const on = q.sub.set === 'taskConfirm' ? taskConfirm : all(q.sub.on);
      answers[q.sub.id] = on ? 'yes' : 'no';
    }
  }
  return answers;
}

/**
 * План «Что будет включено» по ответам (прототип obPlan): «Не знаю» — значение основного набора;
 * подвопрос действует только при «Да» на основной, при «Нет» его функции выключаются; функция без
 * нужной ей функции выключается («Виртуальные счета» без «Учёта оплаты налогов»).
 */
export function onboardingPlan(
  questions: readonly OnboardingQuestion[],
  base: Readonly<Partial<Record<Feature, boolean>>>,
  answers: Readonly<OnboardingAnswers>,
): OnboardingPlan {
  const features = Object.fromEntries(FEATURES.map((f) => [f, !!base[f]])) as Record<
    Feature,
    boolean
  >;
  let taskConfirm = true;
  for (const q of questions) {
    const a = answers[q.id] ?? 'unk';
    if (a !== 'unk') for (const k of q.on) features[k] = a === 'yes';
    if (q.sub && a === 'yes') {
      const b = answers[q.sub.id] ?? 'unk';
      if (q.sub.set === 'taskConfirm') taskConfirm = b !== 'no';
      else if (b !== 'unk') for (const k of q.sub.on ?? []) features[k] = b === 'yes';
    }
    if (q.sub && a === 'no') for (const k of q.sub.on ?? []) features[k] = false;
  }
  for (const f of FEATURES) {
    if ((FEATURE_REQUIRES[f] ?? []).some((d) => !features[d])) features[f] = false;
  }
  return { features, taskConfirm };
}

/**
 * План «Пройти опросник заново» (ТЗ: «ответы подставлены по текущей политике, меняется только то, что
 * изменили»): начало — текущая учётная политика, действуют только ответы, которые пользователь поменял
 * (подвопрос — и когда поменяли основной), по правилам первого прохождения: «Не знаю» — значение
 * основного набора, при «Нет» на основной функции подвопроса выключаются. Без изменений план равен
 * политике: функции без вопроса («Страница контрагента по ссылке») и вопросы с частично включёнными
 * функциями не трогаются. Прототип считает и этот план от основного набора — docs/deviations.md п. Г-5.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-5
export function onboardingRetakePlan(
  questions: readonly OnboardingQuestion[],
  base: Readonly<Partial<Record<Feature, boolean>>>,
  current: { features: Readonly<Record<Feature, boolean>>; taskConfirm: boolean },
  initial: Readonly<OnboardingAnswers>,
  answers: Readonly<OnboardingAnswers>,
): OnboardingPlan {
  const features = { ...current.features };
  let taskConfirm = current.taskConfirm;
  const changed = (id: string) => (answers[id] ?? 'unk') !== (initial[id] ?? 'unk');
  const set = (keys: readonly Feature[], answer: OnboardingAnswer) => {
    for (const k of keys) features[k] = answer === 'unk' ? !!base[k] : answer === 'yes';
  };
  for (const q of questions) {
    const a = answers[q.id] ?? 'unk';
    if (changed(q.id)) set(q.on, a);
    if (!q.sub || !(changed(q.id) || changed(q.sub.id))) continue;
    // Подвопрос задаётся только при «Да»; при «Не знаю» на основной он — как в основном наборе.
    const b: OnboardingAnswer = a === 'yes' ? (answers[q.sub.id] ?? 'unk') : a;
    if (q.sub.set === 'taskConfirm') {
      if (a !== 'no') taskConfirm = b !== 'no';
    } else set(q.sub.on ?? [], b);
  }
  for (const f of FEATURES) {
    if ((FEATURE_REQUIRES[f] ?? []).some((d) => !features[d])) features[f] = false;
  }
  return { features, taskConfirm };
}

/**
 * Переключатель функции на экране «Что будет включено» (прототип wlChange): выключили функцию —
 * выключаются и те, что без неё не работают; включили — включаются нужные ей.
 */
export function onboardingPlanToggle(
  plan: OnboardingPlan,
  feature: Feature,
  on: boolean,
): OnboardingPlan {
  const features = { ...plan.features, [feature]: on };
  for (const f of FEATURES) {
    const needs = FEATURE_REQUIRES[f] ?? [];
    if (!on && needs.includes(feature)) features[f] = false;
    if (on && f === feature) for (const d of needs) features[d] = true;
  }
  return { ...plan, features };
}

/** Что изменит «Применить»: включаемые и выключаемые функции, новое «Задачи требуют подтверждения». */
export interface OnboardingChanges {
  on: Feature[];
  off: Feature[];
  /** null — не меняется (или «Задачи» выключены: тогда подтверждение не трогается). */
  taskConfirm: boolean | null;
}

/**
 * Разница плана и текущей учётной политики (прототип obApply): меняется только то, что отличается;
 * подтверждение задач — только при включённых «Задачах».
 */
export function onboardingChanges(
  current: { features: Readonly<Record<Feature, boolean>>; taskConfirm: boolean },
  plan: OnboardingPlan,
): OnboardingChanges {
  const on = FEATURES.filter((f) => plan.features[f] && !current.features[f]);
  const off = FEATURES.filter((f) => !plan.features[f] && current.features[f]);
  const taskConfirm =
    plan.features.tasks && plan.taskConfirm !== current.taskConfirm ? plan.taskConfirm : null;
  return { on, off, taskConfirm };
}

/**
 * Что открыть сразу после входа (прототип firstLogin, obQuiz): у организации, созданной до
 * приветствия (`state` пусто), — ничего; тому, кто ведёт учётную политику, пока опросник не пройден и
 * не отложен — приветствие с опросником; остальным — приветствие без опросника при самом первом входе.
 */
export function welcomeAtLogin(o: {
  state: OnboardingState | null;
  canPolicy: boolean;
  seen: boolean;
}): WelcomeKind | null {
  if (!o.state) return null;
  if (o.canPolicy && o.state === 'new') return 'quiz';
  return o.seen ? null : 'tour';
}

/**
 * Экраны приветствия (прототип welcomeOpen): у владельца новой организации — шесть («Выбор налогов» —
 * с правом «Вести справочники организации»), у сотрудников и при повторном открытии — «Добро
 * пожаловать», «Модули», «С чего начать»; «Пройти опросник заново» — только опросник и план.
 */
export function welcomeScreens(o: {
  kind: WelcomeKind | 'retake';
  canDicts: boolean;
}): WelcomeScreen[] {
  if (o.kind === 'retake') return ['quiz', 'plan'];
  if (o.kind === 'tour') return ['hello', 'mods', 'start'];
  return ['hello', 'mods', 'quiz', 'plan', 'start', ...(o.canDicts ? ['taxes' as const] : [])];
}
