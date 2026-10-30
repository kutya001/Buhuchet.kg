import { describe, expect, it } from 'vitest';
import { defaultOrgPolicy } from '../org/policy';
import { FEATURES, type Feature } from '../roles/permissions';
import oracle from './__fixtures__/onboarding.json';
import {
  onboardingAnswerIds,
  onboardingAnswersOf,
  onboardingChanges,
  onboardingFreshAnswers,
  onboardingPlan,
  onboardingPlanToggle,
  onboardingRetakePlan,
  welcomeAtLogin,
  welcomeScreens,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from './onboarding';

// Вопросы и основной набор — как в refDB.json `onboarding`.
const QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'q-tasks',
    q: 'Даёте поручения сотрудникам и хотите видеть, что выполнено?',
    x: '',
    on: ['tasks'],
    sub: { id: 'q-tconf', q: '', x: '', set: 'taskConfirm' },
  },
  {
    id: 'q-money',
    q: 'Клиенты переводят вам деньги, а вы сами платите их налоги?',
    x: '',
    on: ['taxpay', 'finops'],
    sub: { id: 'q-acc', q: '', x: '', on: ['accounts'] },
  },
  { id: 'q-fee', q: '', x: '', on: ['fee'] },
  { id: 'q-proj', q: '', x: '', on: ['projects'] },
  { id: 'q-kpi', q: '', x: '', on: ['indicators'] },
  { id: 'q-files', q: '', x: '', on: ['files'] },
  { id: 'q-tg', q: '', x: '', on: ['telegram'] },
  { id: 'q-cal', q: '', x: '', on: ['calendar'] },
];
const BASE: Partial<Record<Feature, boolean>> = {
  tasks: true,
  calendar: true,
  telegram: true,
  files: true,
  taxpay: false,
  accounts: false,
  fee: false,
  finops: false,
  projects: false,
  indicators: false,
  cppage: false,
};

const flags = (x: Record<string, boolean>) => x as Record<Feature, boolean>;

describe('опросник владельца — как в прототипе (onboard.js)', () => {
  it('список функций прототипа совпадает с продуктом', () => {
    expect(oracle.features).toEqual([...FEATURES]);
  });

  it('основной набор опросника — учётная политика новой организации', () => {
    expect(defaultOrgPolicy().features).toEqual({ ...BASE });
  });

  it('при первом запуске все ответы «Не знаю», подвопросы тоже', () => {
    expect(onboardingAnswerIds(QUESTIONS)).toHaveLength(10);
    expect(Object.values(onboardingFreshAnswers(QUESTIONS))).toEqual(Array(10).fill('unk'));
  });

  it.each(oracle.plans.map((p, i) => [i, p] as const))(
    'план по ответам — obPlan, случай %i',
    (_, p) => {
      expect(onboardingPlan(QUESTIONS, BASE, p.answers as OnboardingAnswers)).toEqual({
        features: p.features,
        taskConfirm: p.taskConfirm,
      });
    },
  );

  it('п. 47: «Нет» на проекты и показатели, «Да» на деньги клиентов — включены «Учёт оплаты налогов» и «Финансовые операции», нет «Проектов» и «Показателей»', () => {
    const plan = onboardingPlan(QUESTIONS, BASE, {
      ...onboardingFreshAnswers(QUESTIONS),
      'q-proj': 'no',
      'q-kpi': 'no',
      'q-money': 'yes',
    });
    expect(plan.features).toMatchObject({
      taxpay: true,
      finops: true,
      accounts: false,
      projects: false,
      indicators: false,
      tasks: true,
    });
  });

  it.each(oracle.retakes.map((r, i) => [i, r] as const))(
    '«Пройти опросник заново»: ответы по текущей политике — obAnsInit(true), случай %i',
    (_, r) => {
      expect(
        onboardingAnswersOf(QUESTIONS, flags(r.policy.features), r.policy.taskConfirm),
      ).toEqual(r.answers);
    },
  );

  it.each(oracle.toggles.map((t, i) => [i, t] as const))(
    'переключатель на экране «Что будет включено» — wlChange, случай %i',
    (_, t) => {
      const plan = { features: flags(t.before), taskConfirm: true };
      expect(onboardingPlanToggle(plan, t.feature as Feature, t.checked).features).toEqual(t.after);
    },
  );
});

describe('«Пройти опросник заново»: меняется только то, что изменили (docs/deviations.md п. Г-5)', () => {
  const current = {
    features: flags({
      ...BASE,
      cppage: true,
      taxpay: true,
      finops: false,
      tasks: true,
    } as Record<string, boolean>),
    taskConfirm: false,
  };
  const initial = onboardingAnswersOf(QUESTIONS, current.features, current.taskConfirm);

  it('ответы не меняли — план равен учётной политике: «Страница контрагента» и частично включённые деньги не трогаются', () => {
    const plan = onboardingRetakePlan(QUESTIONS, BASE, current, initial, initial);
    expect(plan).toEqual({ features: current.features, taskConfirm: false });
    expect(onboardingChanges(current, plan)).toEqual({ on: [], off: [], taskConfirm: null });
  });

  it('поменяли ответ — меняются функции только этого вопроса', () => {
    const plan = onboardingRetakePlan(QUESTIONS, BASE, current, initial, {
      ...initial,
      'q-proj': 'yes',
      'q-files': 'no',
    });
    expect(onboardingChanges(current, plan)).toEqual({
      on: ['projects'],
      off: ['files'],
      taskConfirm: null,
    });
  });

  it('«Да» на деньги включает обе функции; подвопрос «Виртуальные счета» — по ответу', () => {
    const yes = onboardingRetakePlan(QUESTIONS, BASE, current, initial, {
      ...initial,
      'q-money': 'yes',
      'q-acc': 'yes',
    });
    expect(onboardingChanges(current, yes).on).toEqual(['accounts', 'finops']);
    const after = { ...current, features: yes.features };
    const again = onboardingAnswersOf(QUESTIONS, after.features, after.taskConfirm);
    expect(again).toMatchObject({ 'q-money': 'yes', 'q-acc': 'yes' });
    const no = onboardingRetakePlan(QUESTIONS, BASE, after, again, { ...again, 'q-money': 'no' });
    expect(no.features).toMatchObject({ taxpay: false, finops: false, accounts: false });
  });

  it('подтверждение задач — когда поменяли подвопрос или основной вопрос', () => {
    expect(
      onboardingRetakePlan(QUESTIONS, BASE, current, initial, { ...initial, 'q-tconf': 'yes' })
        .taskConfirm,
    ).toBe(true);
    // «Не знаю» на основной — значение основного набора: «Задачи» с подтверждением.
    expect(
      onboardingRetakePlan(QUESTIONS, BASE, current, initial, { ...initial, 'q-tasks': 'unk' }),
    ).toEqual({ features: current.features, taskConfirm: true });
  });

  it('поменяли ответ на «Не знаю» — функции вопроса как в основном наборе', () => {
    // Политика: «Задачи» выключены, «Файлы» выключены, «Учёт оплаты налогов» включён.
    const off = {
      ...current,
      features: flags({ ...current.features, tasks: false, files: false }),
    };
    const was = onboardingAnswersOf(QUESTIONS, off.features, off.taskConfirm);
    expect(was).toMatchObject({ 'q-tasks': 'no', 'q-files': 'no', 'q-money': 'no' });
    const plan = onboardingRetakePlan(QUESTIONS, BASE, off, was, {
      ...was,
      'q-tasks': 'unk',
      'q-files': 'unk',
      'q-money': 'unk',
    });
    expect(onboardingChanges(off, plan)).toEqual({
      on: ['tasks', 'files'],
      off: ['taxpay'],
      taskConfirm: true,
    });
  });
});

describe('«Применить»: меняется только то, что отличается', () => {
  const current = { features: defaultOrgPolicy().features, taskConfirm: true };

  it('включаемые и выключаемые функции', () => {
    const plan = onboardingPlan(QUESTIONS, BASE, {
      ...onboardingFreshAnswers(QUESTIONS),
      'q-money': 'yes',
      'q-tg': 'no',
    });
    expect(onboardingChanges(current, plan)).toEqual({
      on: ['taxpay', 'finops'],
      off: ['telegram'],
      taskConfirm: null,
    });
  });

  it('без изменений — пусто', () => {
    const plan = onboardingPlan(QUESTIONS, BASE, onboardingFreshAnswers(QUESTIONS));
    expect(onboardingChanges(current, plan)).toEqual({ on: [], off: [], taskConfirm: null });
  });

  it('«Задачи требуют подтверждения» меняется только при включённых «Задачах»', () => {
    const answers = { ...onboardingFreshAnswers(QUESTIONS), 'q-tasks': 'yes', 'q-tconf': 'no' };
    const plan = onboardingPlan(QUESTIONS, BASE, answers as OnboardingAnswers);
    expect(onboardingChanges(current, plan).taskConfirm).toBe(false);
    const off = { ...plan, features: { ...plan.features, tasks: false } };
    expect(onboardingChanges(current, off)).toEqual({ on: [], off: ['tasks'], taskConfirm: null });
  });
});

describe('что открыть после входа и какие экраны', () => {
  it('организация, созданная до приветствия, его не получает', () => {
    expect(welcomeAtLogin({ state: null, canPolicy: true, seen: false })).toBeNull();
  });

  it('владельцу — с опросником, пока он не пройден и не отложен, даже если приветствие уже видел', () => {
    expect(welcomeAtLogin({ state: 'new', canPolicy: true, seen: true })).toBe('quiz');
    expect(welcomeAtLogin({ state: 'later', canPolicy: true, seen: true })).toBeNull();
    expect(welcomeAtLogin({ state: 'done', canPolicy: true, seen: true })).toBeNull();
  });

  it('сотруднику — без опросника и только при первом входе', () => {
    expect(welcomeAtLogin({ state: 'new', canPolicy: false, seen: false })).toBe('tour');
    expect(welcomeAtLogin({ state: 'done', canPolicy: false, seen: true })).toBeNull();
    expect(welcomeAtLogin({ state: 'later', canPolicy: true, seen: false })).toBe('tour');
  });

  it('у владельца шесть экранов, «Выбор налогов» — последний и только с правом справочников', () => {
    expect(welcomeScreens({ kind: 'quiz', canDicts: true })).toEqual([
      'hello',
      'mods',
      'quiz',
      'plan',
      'start',
      'taxes',
    ]);
    expect(welcomeScreens({ kind: 'quiz', canDicts: false })).toHaveLength(5);
    expect(welcomeScreens({ kind: 'tour', canDicts: true })).toEqual(['hello', 'mods', 'start']);
    expect(welcomeScreens({ kind: 'retake', canDicts: true })).toEqual(['quiz', 'plan']);
  });
});
