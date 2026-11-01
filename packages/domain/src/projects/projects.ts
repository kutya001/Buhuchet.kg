import { addDays, type IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import { MONEY_AMOUNT_MAX } from '../money/tax';

/*
 * Проекты контрагентов (задача 2.26; ТЗ «Модуль Проекты контрагентов»; прототип modules/projects.js —
 * `projVisible`, `projActive`, `workOver`, `projTabs`, `projActions`, `openProject`, `projectDlg`;
 * modules/services.js — `projPaid`, `projLeft`, `projOver`; ui/status-scale.js — шкала `proj`). Проект —
 * разовая работа по одному контрагенту: срок, ответственные (один из них главный), работы, планируемая
 * стоимость; статус — шкала `project` (`src/common/status.ts`).
 */

export const PROJECT_STATUSES = ['planned', 'in_progress', 'done', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Статус нового проекта (прототип `projectDlg`: «Планируется» или «В работе»). */
export const PROJECT_NEW_STATUSES = ['planned', 'in_progress'] as const satisfies readonly ProjectStatus[];
export type ProjectNewStatus = (typeof PROJECT_NEW_STATUSES)[number];

export const PROJECT_NAME_MAX = 300;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const PROJECT_WORK_NAME_MAX = 300;
/** Работ у проекта и ответственных — не больше (защита от слишком большого запроса). */
export const PROJECT_WORKS_MAX = 200;
export const PROJECT_MEMBERS_MAX = 100;
/** Срок по умолчанию у нового проекта: сегодня + 60 дней (прототип `projectDlg`). */
export const PROJECT_DEFAULT_DAYS = 60;

/** Активный проект — «Планируется» или «В работе» (прототип `projActive`). */
export const projectActive = (status: ProjectStatus): boolean =>
  status === 'planned' || status === 'in_progress';

/** Срок проекта прошёл: он ещё «В работе», а окончание раньше сегодня (прототип `projOver`). */
export const projectOverdue = (p: { status: ProjectStatus; endsOn: IsoDate }, today: IsoDate) =>
  p.status === 'in_progress' && p.endsOn < today;

/** Работа просрочена: не сделана, срок есть и прошёл (прототип `workOver`). */
export const projectWorkOverdue = (w: { done: boolean; due: IsoDate | null }, today: IsoDate) =>
  !w.done && w.due !== null && w.due < today;

/** Остаток к получению: план минус получено, не меньше нуля; без плана — 0 (прототип `projLeft`). */
export const projectLeft = (plan: Tyiyn | null, paid: Tyiyn): Tyiyn =>
  plan ? Math.max(0, plan - paid) : 0;

/** Процент полосы «Работы» и «Деньги по проекту» (прототип: `Math.round(done / all * 100)`, не больше 100). */
export const projectPercent = (done: number, all: number): number =>
  all > 0 ? Math.min(100, Math.round((done / all) * 100)) : 0;

/** Отказы правил проекта: ключ текста словаря `err.<код>`. */
export type ProjectRefusal =
  | 'project_name_required'
  | 'project_contractor_required'
  | 'project_dates_required'
  | 'project_dates_order'
  | 'project_members_required'
  | 'project_lead_invalid'
  | 'project_plan_invalid'
  | 'project_plan_less'
  | 'project_work_invalid'
  | 'project_status_invalid'
  | 'project_cancelled'
  | 'project_work_add_forbidden';

/** Тексты отказов — как у полей окна проекта в прототипе (`projectDlg`: `setErr`). */
export const PROJECT_MESSAGES: Readonly<Record<ProjectRefusal, string>> = {
  project_name_required: 'Введите название',
  project_contractor_required: 'Выберите контрагента',
  project_dates_required: 'Укажите даты',
  project_dates_order: 'Окончание раньше начала',
  project_members_required: 'Выберите хотя бы одного ответственного',
  project_lead_invalid: 'Главный ответственный — один из ответственных',
  project_plan_invalid: 'Введите сумму или оставьте пустым',
  project_plan_less: 'Не меньше уже полученного: {amount}',
  project_work_invalid: 'У работы нет названия, исполнителя или неверный срок',
  project_status_invalid: 'Такой смены статуса у проекта нет',
  project_cancelled: 'Проект отменён',
  project_work_add_forbidden: 'Добавлять и отмечать работы может ответственный проекта или сотрудник с правом «Вести проекты и разовые услуги»',
};

export interface ProjectProblem {
  field: 'name' | 'contractor' | 'dates' | 'members' | 'lead' | 'plan' | 'works';
  problem: ProjectRefusal;
  /** Сумма для текста отказа (`{amount}`), в тыйынах. */
  amount?: Tyiyn;
}

/** Работа в окне проекта: название, исполнитель, срок. */
export interface ProjectWorkInput {
  name: string;
  executorEmployeeId: string;
  due: IsoDate | null;
}

/** Поля окна «Новый проект» и «Изменить проект». */
export interface ProjectFields {
  name: string;
  /** Контрагент — только у нового проекта; null — не выбран. */
  contractorId?: string | null;
  startsOn: IsoDate | '';
  endsOn: IsoDate | '';
  members: readonly string[];
  lead: string | null;
  /**
   * Планируемая стоимость в тыйынах; null — не задана (пусто); `'invalid'` — введено не число или
   * отрицательное.
   */
  plan: Tyiyn | null | 'invalid';
  works: readonly ProjectWorkInput[];
}

const validPlan = (n: Tyiyn) => Number.isInteger(n) && n >= 0 && n <= MONEY_AMOUNT_MAX;

/**
 * Проверки окна проекта (прототип `projectDlg`): название, контрагент (у нового), обе даты и окончание не
 * раньше начала, хотя бы один ответственный, главный — один из них, стоимость — сумма или пусто и не
 * меньше уже полученного (`paid`). Работы без названия отбрасываются (прототип: `works.filter(w =>
 * w.n.trim())`); у оставшихся проверяются исполнитель и срок. Все отказы сразу — у своих полей.
 */
export function projectProblems(f: ProjectFields, paid: Tyiyn = 0): ProjectProblem[] {
  const out: ProjectProblem[] = [];
  if (!f.name.trim()) out.push({ field: 'name', problem: 'project_name_required' });
  if (f.contractorId !== undefined && !f.contractorId)
    out.push({ field: 'contractor', problem: 'project_contractor_required' });
  if (!f.startsOn || !f.endsOn) out.push({ field: 'dates', problem: 'project_dates_required' });
  else if (f.endsOn < f.startsOn) out.push({ field: 'dates', problem: 'project_dates_order' });
  if (!f.members.length) out.push({ field: 'members', problem: 'project_members_required' });
  else if (f.lead !== null && !f.members.includes(f.lead))
    out.push({ field: 'lead', problem: 'project_lead_invalid' });
  if (f.plan === 'invalid' || (f.plan !== null && !validPlan(f.plan)))
    out.push({ field: 'plan', problem: 'project_plan_invalid' });
  else if (f.plan !== null && f.plan < paid)
    out.push({ field: 'plan', problem: 'project_plan_less', amount: paid });
  if (projectWorksClean(f.works).some((w) => !w.executorEmployeeId))
    out.push({ field: 'works', problem: 'project_work_invalid' });
  return out;
}

/** Работы окна для сохранения: без пустых названий, название без пробелов по краям. */
export function projectWorksClean(works: readonly ProjectWorkInput[]): ProjectWorkInput[] {
  return works
    .filter((w) => w.name.trim())
    .map((w) => ({ name: w.name.trim(), executorEmployeeId: w.executorEmployeeId, due: w.due || null }));
}

/**
 * Значения нового проекта (прототип `projectDlg` без `p0`): с сегодня по сегодня + 60 дней,
 * «Планируется», ответственный и главный — ответственный контрагента (из карточки контрагента) или тот,
 * кто создаёт.
 */
export function projectFormDefaults(
  today: IsoDate,
  who: { contractorResponsible: string | null; me: string | null },
): {
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: ProjectNewStatus;
  members: string[];
  lead: string | null;
} {
  const first = who.contractorResponsible ?? who.me;
  return {
    startsOn: today,
    endsOn: addDays(today, PROJECT_DEFAULT_DAYS),
    status: 'planned',
    members: first ? [first] : [],
    lead: first,
  };
}

/**
 * Нажатие на сотрудника в «Ответственных» (прототип `projectDlg`: `#pd-resp`): добавить или убрать;
 * если главный ушёл из списка — главным становится первый оставшийся.
 */
export function projectMemberToggle(
  members: readonly string[],
  lead: string | null,
  id: string,
): { members: string[]; lead: string | null } {
  const next = members.includes(id) ? members.filter((m) => m !== id) : [...members, id];
  return { members: next, lead: lead !== null && next.includes(lead) ? lead : (next[0] ?? null) };
}

/** Исполнитель новой работы по умолчанию (прототип `openProject`: я, если я ответственный, иначе главный). */
export const projectWorkExecutor = (
  p: { members: readonly string[]; lead: string },
  me: string | null,
): string => (me && p.members.includes(me) ? me : p.lead);

/** Можно ли «Отменить проект» (прототип `projActions`: из «Планируется» и «В работе»). */
export const projectCancelable = (status: ProjectStatus): boolean => projectActive(status);

/**
 * Какие проекты предлагает поле «Проект» формы задачи (прототип `taskDlg`, `projsOf`; ТЗ: «только
 * активные проекты выбранного контрагента»): не «Отменён» и не «Завершён», кроме уже выбранного у
 * задачи.
 */
export const projectOfferedForTask = (
  p: { id: string; status: ProjectStatus },
  current: string | null,
): boolean => p.status !== 'cancelled' && (p.status !== 'done' || p.id === current);

/** Кто смотрит на проект: сотрудник, право «Вести проекты», область группы «Проекты контрагентов». */
export interface ProjectViewer {
  employeeId: string | null;
  canKeep: boolean;
  /** Область «Все контрагенты» группы «Проекты контрагентов». */
  seeAll: boolean;
}

/**
 * Виден ли проект (прототип `projVisible`): область «Все», ответственный контрагента или один из
 * ответственных проекта.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export function projectVisible(
  v: ProjectViewer,
  p: { members: readonly string[]; contractorResponsible: string | null },
): boolean {
  if (v.seeAll) return true;
  if (!v.employeeId) return false;
  return p.contractorResponsible === v.employeeId || p.members.includes(v.employeeId);
}

/**
 * Может ли отмечать работы сделанными и добавлять работы в карточке (прототип `openProject`: `mine =
 * ed || p.resps.includes(S.me)`), — и добавлять файлы проекта.
 */
export const projectWorksEditable = (
  v: ProjectViewer,
  p: { members: readonly string[]; status: ProjectStatus },
): boolean => v.canKeep || (v.employeeId !== null && p.members.includes(v.employeeId));
