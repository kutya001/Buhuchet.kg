import type { MenuModuleId } from '../org/modules';
import type { KbStepDef } from './catalog';
import { KB_READY_MODULES, KB_STEP_RULES, type KbStepRule } from './ready';

/*
 * Условие отметки шага (ТЗ «Админка → База знаний (содержимое)» → «Шаги уроков»: «выбирается из
 * списка событий системы …; сами события задаёт разработчик»; прототип modules/kb-lessons.js, `KB_EV`,
 * `KB_MAP`, `kbBind`). Событие истории отмечает шаг тем же правилом, что у шага, к которому оно
 * относится в `KB_STEP_RULES`: событие работает, когда работает его шаг (правило стыков,
 * docs/decisions.md п. Г-2). Так администратор платформы меняет условие у шага и добавляет свои шаги,
 * а правила событий остаются в коде.
 */

/** Событие истории → шаг, правило которого его отмечает (прототип `KB_MAP`), по порядку `KB_EV`. */
export const KB_EVENT_STEPS = {
  'org.main': 'profile',
  'org.acc': 'accs',
  'org.policy': 'policy',
  'org.settings': 'settings',
  'emp.notify': 'nmode',
  'type.on': 'types',
  'type.cfg': 'typecfg',
  'role.save': 'roles',
  'emp.new': 'emps',
  'cp.new': 'cp1',
  'cp.import': 'import',
  'cp.resp': 'resp',
  'cp.tariff': 'tariff',
  'cp.oneoff': 'oneoff',
  'cp.page': 'cppage',
  'r.assign': 'assign',
  'r.sub': 'submit',
  'r.acc': 'accept',
  'r.ver': 'ver',
  'r.na': 'na',
  'in.new': 'in',
  'in.split': 'split',
  'r.pay': 'pay',
  's.new': 'svc',
  'fee.pay': 'feepay',
  't.new': 'mtask',
  't.done': 'tdone',
  't.conf': 'tconf',
  'p.new': 'proj',
  'p.work': 'works',
  'p.pay': 'tranche',
  'k.setup': 'kset',
  'k.val': 'kval',
  'k.who': 'kwho',
  'k.xls': 'kxls',
  'k.check': 'kchk',
  'f.upload': 'upload',
} as const;

export type KbHistoryEvent = keyof typeof KB_EVENT_STEPS;

/**
 * Условия без события истории: `open` — «Перейти» и 3 секунды на экране шага, показ до конца или
 * статья шага; `use` — первое использование функции; `state` — условие в данных пользователя (его
 * задаёт разработчик у своего шага); `hand` — только показом или статьёй.
 */
export const KB_LOOK_EVENTS = ['open', 'use', 'state', 'hand'] as const;

export type KbEvent = KbHistoryEvent | (typeof KB_LOOK_EVENTS)[number];

/** Все условия по порядку списка «Условие отметки». */
export const KB_EVENTS: readonly KbEvent[] = [
  ...(Object.keys(KB_EVENT_STEPS) as KbHistoryEvent[]),
  ...KB_LOOK_EVENTS,
];

export function isKbEvent(value: string): value is KbEvent {
  return (KB_EVENTS as readonly string[]).includes(value);
}

type Rules = Readonly<Record<string, KbStepRule>>;

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** Шаг события истории и его правило, если событие уже отмечает шаги. */
function eventOf(evk: string | undefined, rules: Rules) {
  const step = evk ? own<string>(KB_EVENT_STEPS, evk) : undefined;
  const rule = step ? own(rules, step) : undefined;
  return step && rule?.done ? { step, rule } : undefined;
}

/** «Перейти» и 3 секунды, показ или статья: отметки без события. */
const isLook = (evk: string | undefined) => evk === 'open' || evk === 'hand';

/**
 * Работает ли условие у шага: у шага разработчика (`own`) — любое из списка; у шага, добавленного
 * администратором, — событие, которое уже отмечает шаги, или отметка показом и статьёй (первое
 * использование и условие в данных у такого шага задать нечем).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-25
export function kbEventWorks(evk: KbEvent, own: boolean, rules: Rules = KB_STEP_RULES): boolean {
  return own || isLook(evk) || !!eventOf(evk, rules);
}

/**
 * Правило шага в программе (прототип kbBind):
 * - шаг разработчика (`KB_STEP_RULES`) со своим событием — как есть; с событием другого шага — правило
 *   того события (модуль и право шага остаются); с отметкой показом или статьёй — без события;
 *   первое использование, условие в данных и событие, которое ещё не работает, — как есть;
 * - шаг, добавленный администратором, — модуль «Места для «Перейти»» (`mod`, только уже сделанный
 *   модуль) и правило события; без работающего условия шага в программе нет.
 */
export function kbStepRule(
  step: Pick<KbStepDef, 'id' | 'evk' | 'mod'>,
  rules: Rules = KB_STEP_RULES,
): KbStepRule | undefined {
  const base = own(rules, step.id);
  const event = eventOf(step.evk, rules);
  const policy = event?.rule.policy ? { policy: event.rule.policy } : {};
  if (base) {
    if (event && event.step !== step.id) {
      return {
        module: base.module,
        ...(base.permission ? { permission: base.permission } : {}),
        done: event.rule.done!,
        ...policy,
      };
    }
    if (isLook(step.evk) && (base.done || base.savedUnchanged)) {
      const { done: _done, savedUnchanged: _saved, ...look } = base;
      return look;
    }
    return base;
  }
  if (!step.mod || !KB_READY_MODULES.has(step.mod)) return undefined;
  const module = step.mod as MenuModuleId;
  if (event) return { module, done: event.rule.done!, ...policy };
  return isLook(step.evk) ? { module } : undefined;
}
