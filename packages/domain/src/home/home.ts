import type { ListFilterValue } from '../common/list';
import type { IsoDate } from '../common/dates';

/*
 * «Главная» → «Сводка» (задача 2.34; ТЗ «Главная»; прототип modules/home.js, `renderHome`): какие
 * плашки есть и какой список открывает каждая. Число на плашке сервер считает тем же списком с тем же
 * фильтром, что откроется по нажатию, поэтому число на плашке равно числу строк в открытом списке.
 * Кроме «Ждут подтверждения» и «Не заполнены показатели»: их числа — как в прототипе (docs/deviations.md
 * п. Г-12).
 */

/** Плашки «Сводки» по порядку (прототип: `data-plate`). */
export const HOME_PLATES = ['ovr', 'ovp', 'wks', 'wkp', 'wait', 'tpend', 'kmiss', 'tsk'] as const;
export type HomePlate = (typeof HOME_PLATES)[number];

/** Список, который открывает плашка: модуль, вкладка и фильтры столбцов. */
export interface HomePlateTarget {
  module: 'reports' | 'tasks' | 'kpi';
  tab: string;
  filters: Record<string, ListFilterValue>;
}

/** Неделя вкладки «На неделе» (`reportWeek`), сегодня и видит ли сотрудник задачи всех. */
export interface HomePlateContext {
  week: { from: IsoDate; to: IsoDate };
  today: IsoDate;
  /** Право «Видеть задачи всех»: «Ждут подтверждения» открывают «Все», иначе «Мои». */
  tasksAll: boolean;
}

const OPEN_STATUSES = ['todo', 'in_progress', 'needs_fix'];

/**
 * Куда ведёт плашка (прототип renderHome → `body.onclick`): «Просрочено отчётов» и «Просрочено оплат» —
 * «Отчеты для сдачи» → «Просрочено» с фильтром по столбцу «Просрочка»; «Сдать» и «Оплатить на этой
 * неделе» — «На неделе» со статусом и сроком недели (оплатить — только с указанной суммой); «Ожидают
 * подтверждения» — своя вкладка; «Ждут подтверждения» — «Задачи» со статусом «На подтверждении»; «Не
 * заполнены показатели» — вкладка «Не заполнено»; «Мои задачи на сегодня» — открытые мои со сроком не
 * позже сегодня.
 */
export function homePlateTarget(plate: HomePlate, o: HomePlateContext): HomePlateTarget {
  const week = { type: 'date', from: o.week.from, to: o.week.to } as const;
  switch (plate) {
    case 'ovr':
      return {
        module: 'reports',
        tab: 'overdue',
        filters: { overdue: { type: 'enum', vals: ['sub', 'both'] } },
      };
    case 'ovp':
      return {
        module: 'reports',
        tab: 'overdue',
        filters: { overdue: { type: 'enum', vals: ['pay', 'both'] } },
      };
    case 'wks':
      return {
        module: 'reports',
        tab: 'week',
        filters: { status: { type: 'enum', vals: OPEN_STATUSES }, due: week },
      };
    case 'wkp':
      return {
        module: 'reports',
        tab: 'week',
        // «Сумма от 0,01» прототипа — в тыйынах.
        filters: {
          paymentStatus: { type: 'enum', vals: ['unpaid', 'partial'] },
          payDue: week,
          amount: { type: 'num', from: 1 },
        },
      };
    case 'wait':
      return { module: 'reports', tab: 'waiting', filters: {} };
    // ОТКЛОНЕНИЕ: docs/deviations.md#Г-12 — число: только задачи других сотрудников, список: все.
    case 'tpend':
      return {
        module: 'tasks',
        tab: o.tasksAll ? 'all' : 'mine',
        filters: { status: { type: 'enum', vals: ['on_confirm'] } },
      };
    // ОТКЛОНЕНИЕ: docs/deviations.md#Г-12 — число: контрагенты, список: месяцы контрагентов.
    case 'kmiss':
      return { module: 'kpi', tab: 'missing', filters: {} };
    case 'tsk':
      return {
        module: 'tasks',
        tab: 'mine',
        filters: {
          date: { type: 'date', from: null, to: o.today },
          open: { type: 'enum', vals: ['yes'] },
        },
      };
  }
}

/** Блок «Ближайшие сроки сдачи» — девять отчётов (прототип `upcoming.slice(0, 9)`). */
export const HOME_UPCOMING_MAX = 9;
/** Блок «Мои задачи на сегодня» — до пяти задач (прототип `myTasks.slice(0, 5)`). */
export const HOME_TASKS_MAX = 5;

/**
 * Строка «Отчёты со сроком в этом месяце: сдано» (прототип renderHome, `prog`): сотрудник, сколько его
 * отчётов со сроком в этом месяце сдано и всего; без отчётов строки нет.
 */
export interface HomeProgress {
  employeeId: string;
  name: string;
  done: number;
  all: number;
}

/** Доля сданных в процентах для полосы (прототип: `Math.round(done / all * 100)`). */
export function progressPercent(p: Pick<HomeProgress, 'done' | 'all'>): number {
  return p.all ? Math.round((p.done / p.all) * 100) : 0;
}
