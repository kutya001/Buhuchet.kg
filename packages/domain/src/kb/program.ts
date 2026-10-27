import { addDays, type IsoDate } from '../common/dates';
import { ADMIN_MENU_MODULES, menuModules } from '../org/modules';
import { hasPermission, type AccessSubject } from '../roles/access';
import type { Feature, PermissionId } from '../roles/permissions';
import {
  kbFlag,
  type KbCatalog,
  type KbGroupDef,
  type KbLevelDef,
  type KbStepDef,
} from './catalog';
import { KB_STEP_RULES, type KbStepRule } from './ready';

/*
 * Программа обучения пользователя и его уровень (ТЗ «База знаний» → «Главное правило», «Уровни»,
 * «Точные правила подсчёта»; прототип modules/kb-lessons.js: kbVis, ckGroups, kbStat, kbSync, ckNext,
 * kbIsNew). Программа у каждого своя: шаги модулей, включённых в учётной политике, и действий,
 * разрешённых его правами; всё остальное не входит ни в числитель, ни в знаменатель.
 */

/** Что можно пользователю: права, функции учётной политики, модули меню. */
export interface KbAccess {
  /** Администратор платформы: программа режима Админка. */
  admin: boolean;
  /** Владелец организации: группы в порядке первичной настройки. */
  isOwner: boolean;
  can: (permission: PermissionId) => boolean;
  feature: (feature: Feature) => boolean;
  /** Модули меню пользователя. */
  modules: ReadonlySet<string>;
}

/** Доступ сотрудника организации: его права и функции учётной политики (модули — как в меню). */
export function kbBusinessAccess(
  subject: AccessSubject,
  features: Readonly<Partial<Record<Feature, boolean>>>,
): KbAccess {
  return {
    admin: false,
    isOwner: subject.isOwner,
    can: (p) => hasPermission(subject, p),
    feature: (f) => features[f] === true,
    modules: new Set(menuModules(subject, features)),
  };
}

/** Доступ администратора платформы: модули Админки, прав и функций организации нет. */
export function kbAdminAccess(): KbAccess {
  return {
    admin: true,
    isOwner: false,
    can: () => false,
    feature: () => false,
    modules: new Set(ADMIN_MENU_MODULES),
  };
}

/** Как засчитан шаг (ТЗ: «с датой и способом»; прототип `CK_HOW`). */
export const KB_HOWS = ['action', 'data', 'show', 'art', 'use', 'visit'] as const;
export type KbHow = (typeof KB_HOWS)[number];

export function isKbHow(value: string): value is KbHow {
  return (KB_HOWS as readonly string[]).includes(value);
}

/** Отметка шага у пользователя: выполнен (один раз и навсегда) или пропущен. */
export interface KbMark {
  done: { how: KbHow; at: string } | null;
  skipped: boolean;
}

export type KbMarks = ReadonlyMap<string, KbMark>;

export interface KbProgramStep {
  def: KbStepDef;
  rule: KbStepRule;
  /** Модуль шага (статья модуля — статья шага). */
  module: string | null;
  learn: boolean;
  star: boolean;
}

export interface KbProgramGroup {
  def: KbGroupDef;
  steps: KbProgramStep[];
}

/** Группа «Главная и аналитика»: у сотрудников, кроме владельца, — первой. */
const HOME_GROUP = 'home';

/** Функция учётной политики группы шагов (прототип `KB_FEAT`): шаги «Новое» после её включения. */
export const KB_GROUP_FEATURES: Readonly<Record<string, Feature>> = {
  money: 'taxpay',
  fee: 'fee',
  tasks: 'tasks',
  projects: 'projects',
  kpi: 'indicators',
  files: 'files',
};

function isFeature(value: string, access: KbAccess): boolean {
  return access.feature(value as Feature);
}

/**
 * Виден ли шаг в программе (прототип kbVis): шаг работает (`KB_STEP_RULES`), не выключен
 * администратором, есть его право, включена его функция и модуль шага есть в меню.
 */
export function kbStepVisible(
  step: KbStepDef,
  access: KbAccess,
  rules: Readonly<Record<string, KbStepRule>> = KB_STEP_RULES,
): boolean {
  const rule = Object.hasOwn(rules, step.id) ? rules[step.id] : undefined;
  if (!rule || step.active === false) return false;
  if (step.perm && !access.can(step.perm as PermissionId)) return false;
  if (step.featk && !isFeature(step.featk, access)) return false;
  return rule.module === null || access.modules.has(rule.module);
}

/**
 * Программа пользователя по группам (прототип ckGroups): группы его режима (организация или
 * Админка) с видимыми шагами по порядку, пустые группы не показываются. У владельца группы — в
 * порядке первичной настройки, у остальных сотрудников первой идёт «Главная и аналитика».
 */
export function kbProgram(
  catalog: Pick<KbCatalog, 'steps' | 'groups'>,
  access: KbAccess,
  rules: Readonly<Record<string, KbStepRule>> = KB_STEP_RULES,
): KbProgramGroup[] {
  let groups = catalog.groups.filter((g) => kbFlag(g.adm) === access.admin);
  if (!access.admin && !access.isOwner) {
    const home = groups.find((g) => g.id === HOME_GROUP);
    if (home) groups = [home, ...groups.filter((g) => g !== home)];
  }
  return groups
    .map((def) => ({
      def,
      steps: catalog.steps
        .filter((s) => s.g === def.id && kbStepVisible(s, access, rules))
        .sort((a, b) => a.ord - b.ord)
        .map((s) => {
          const rule = rules[s.id]!;
          return {
            def: s,
            rule,
            module: rule.module,
            learn: kbFlag(s.learn),
            star: kbFlag(s.star),
          };
        }),
    }))
    .filter((g) => g.steps.length > 0);
}

export const kbProgramSteps = (program: readonly KbProgramGroup[]): KbProgramStep[] =>
  program.flatMap((g) => g.steps);

const isDone = (marks: KbMarks, id: string) => !!marks.get(id)?.done;
/** Пропущен и не выполнен: выполненный шаг пропущенным не считается. */
const isSkipped = (marks: KbMarks, id: string) => !isDone(marks, id) && !!marks.get(id)?.skipped;

export interface KbStats {
  /** Шагов в программе. */
  total: number;
  done: number;
  /** Процент: выполнено ÷ всего × 100, вниз до целого. */
  pct: number;
  /** Уровень по проценту (индекс в списке уровней). */
  byPct: number;
  /** Текущий уровень: не ниже полученного раньше (уровень не понижается). */
  level: number;
  /** Следующий уровень; null — высший. */
  next: number | null;
  /** Сколько ещё шагов до следующего уровня. */
  need: number;
  /** Прогресс по модулям (группам). */
  groups: { id: string; title: string; done: number; total: number }[];
  stars: { done: number; total: number };
}

/**
 * Уровень и прогресс (прототип kbStat). Уровень даётся только по проценту своей программы;
 * `reached` — высший полученный раньше уровень (null — уровней ещё не записано): он не понижается,
 * когда программа растёт и процент падает (ТЗ «уровень не понижается; следующий уровень даётся по
 * новому проценту»).
 */
export function kbStats(
  program: readonly KbProgramGroup[],
  marks: KbMarks,
  levels: readonly KbLevelDef[],
  reached: number | null,
): KbStats {
  const steps = kbProgramSteps(program);
  const total = steps.length;
  const done = steps.filter((s) => isDone(marks, s.def.id)).length;
  const pct = total ? Math.floor((done * 100) / total) : 0;
  let byPct = 0;
  levels.forEach((l, i) => {
    if (pct >= l.p) byPct = i;
  });
  const level = Math.min(Math.max(byPct, reached ?? 0), levels.length - 1);
  const next = level + 1 < levels.length ? level + 1 : null;
  const need = next === null ? 0 : Math.max(1, Math.ceil((levels[next]!.p * total) / 100) - done);
  const stars = steps.filter((s) => s.star);
  return {
    total,
    done,
    pct,
    byPct,
    level,
    next,
    need,
    groups: program.map((g) => ({
      id: g.def.id,
      title: g.def.t,
      done: g.steps.filter((s) => isDone(marks, s.def.id)).length,
      total: g.steps.length,
    })),
    stars: { done: stars.filter((s) => isDone(marks, s.def.id)).length, total: stars.length },
  };
}

/**
 * Какие уровни записать (прототип kbSync): при первом подсчёте — все до текущего по проценту, без
 * поздравления; потом — каждый новый выше полученного, с поздравлением названием высшего.
 */
export function kbLevelsToRecord(
  stats: Pick<KbStats, 'byPct'>,
  reached: number | null,
): { levels: number[]; congrats: number | null } {
  if (reached === null) {
    return { levels: Array.from({ length: stats.byPct + 1 }, (_, i) => i), congrats: null };
  }
  if (stats.byPct <= reached) return { levels: [], congrats: null };
  const levels: number[] = [];
  for (let i = reached + 1; i <= stats.byPct; i++) levels.push(i);
  return { levels, congrats: stats.byPct };
}

/**
 * Следующий шаг (прототип ckNext): первый не выполненный и не пропущенный после `after` по порядку
 * программы, по кругу; без `after` — с начала. null — все шаги пройдены или пропущены.
 */
export function kbNextStep(
  program: readonly KbProgramGroup[],
  marks: KbMarks,
  after?: string,
): KbProgramStep | null {
  const steps = kbProgramSteps(program);
  const k = after ? steps.findIndex((s) => s.def.id === after) : -1;
  const order = [...steps.slice(k + 1), ...steps.slice(0, k + 1)];
  return order.find((s) => !isDone(marks, s.def.id) && !isSkipped(marks, s.def.id)) ?? null;
}

/** Сколько дней шаги включённой функции отмечены «Новое» (прототип kbIsNew). */
export const KB_NEW_DAYS = 30;

/**
 * «Новое» у шага (ТЗ «Новая функция, добавленная в систему позже, появляется в программе с отметкой
 * «Новое»»): не выполнен и добавлен администратором позже или его функция включена в учётной политике
 * за последние 30 дней. `featureOn` — дата последнего включения функции.
 */
export function kbStepIsNew(
  step: KbProgramStep,
  marks: KbMarks,
  featureOn: Readonly<Partial<Record<Feature, IsoDate>>>,
  today: IsoDate,
): boolean {
  if (isDone(marks, step.def.id)) return false;
  if (step.def.isNew) return true;
  const feature = (step.def.featk || KB_GROUP_FEATURES[step.def.g]) as Feature | undefined;
  const on = feature ? featureOn[feature] : undefined;
  return !!on && on >= addDays(today, -KB_NEW_DAYS);
}

/** Урок пройден (все шаги программы выполнены) или пройден частично (остальные пропущены). */
export function kbGroupStatus(
  group: KbProgramGroup,
  marks: KbMarks,
): { state: 'done'; at: string | null } | { state: 'partial' } | null {
  const done = group.steps.filter((s) => isDone(marks, s.def.id));
  if (done.length === group.steps.length) {
    const at =
      done
        .map((s) => marks.get(s.def.id)!.done!.at)
        .sort()
        .pop() ?? null;
    return { state: 'done', at };
  }
  const skipped = group.steps.filter((s) => isSkipped(marks, s.def.id)).length;
  return done.length + skipped === group.steps.length ? { state: 'partial' } : null;
}

/** Шаг «Посмотреть» на этом экране? `screen` — «модуль.вкладка» (прототип ckOnScr). */
export function kbOnStepScreen(step: KbStepDef, module: string, tab: string | null): boolean {
  const screen = tab ? `${module}.${tab}` : module;
  return (step.at ?? []).some((a) => a === screen || a === module);
}

/**
 * Как засчитывает этот шаг первое использование функции `hit` (прототип ckHit); null — никак: шаг «Сделать» — да,
 * «Посмотреть» — только в разделе «Работа со списками и интерфейсом»; остальные «Посмотреть» —
 * только показом или статьёй. Шаг с событием в истории (`rule.done`) засчитывается только им: в
 * прототипе `ckHit` у них звался после самого действия, а здесь действие видно в истории и без него
 * (ТЗ «Шаг засчитывается только тому, кто сам сделал действие»).
 */
export function kbHitMark(step: KbProgramStep, hit: string): KbHow | null {
  // Сохранение без изменений — тоже действие пользователя (`savedUnchanged`).
  if (step.rule.savedUnchanged && hit === step.def.id) return 'action';
  return step.def.hit === hit && !step.rule.done && (!step.learn || step.def.g === 'lists')
    ? 'use'
    : null;
}
