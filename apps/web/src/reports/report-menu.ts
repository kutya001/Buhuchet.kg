import {
  OPEN_REPORT_STATUSES,
  reportBack,
  reportConfirmRefusal,
  reportHasAmount,
  reportNotRequiredAllowed,
  reportSubmittable,
  reportWaiting,
  scaleNext,
  type ReportFacts,
} from '@buhuchet/domain';
import type { ReportRow } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { statusName } from '../status/status-view';

/** Действия с отчётом из меню, кнопок карточки и шагов шкалы. */
export type ReportAction =
  | 'open'
  | 'submit'
  | 'start'
  | 'confirm'
  | 'fix'
  | 'reject'
  | 'due'
  | 'amount'
  | 'file'
  | 'revision'
  | 'rollback'
  | 'not_required';

/** Что делают пункты меню отчёта: открывают окно или спрашивают. */
export type ReportMenuRun = Record<ReportAction, (r: ReportRow) => void>;

/** Строка списка (прежних версий в списке нет) или карточка отчёта. */
export type ReportMenuRow = ReportRow & { superseded?: boolean };

/**
 * Кто действует: права пунктов меню, учётная политика (подтверждение сдачи, «Файлы в карточках»),
 * вошедший сотрудник (свой сданный отчёт он не подтверждает, кроме владельца).
 */
export interface ReportActor {
  employeeId: string | null;
  isOwner: boolean;
  confirmOn: boolean;
  filesOn: boolean;
  can: Readonly<
    Record<
      'changeStatus' | 'repDue' | 'repConfirm' | 'changeSum' | 'rollback' | 'filesUpload',
      boolean
    >
  >;
}

/** Отчёт глазами правил: подтверждён ли и кто сдал (сотрудник). */
export const reportFacts = (r: ReportMenuRow): ReportFacts => ({
  status: r.status,
  act: r.act,
  superseded: r.superseded ?? false,
  confirmed: r.confirmedAt !== null,
  submittedBy: r.submittedBy?.id ?? null,
});

/** Почему нельзя «Подтвердить» и «На исправление» (прототип repConfWhy); null — можно. */
export function confirmRefusal(r: ReportMenuRow, actor: ReportActor) {
  return reportConfirmRefusal(
    reportFacts(r),
    { canConfirm: actor.can.repConfirm, userId: actor.employeeId, isOwner: actor.isOwner },
    actor.confirmOn,
  );
}

/** Куда откатить на шаг (прототип scBack): шаг, отказ «сначала уточнённую версию» или null. */
export const reportBackOf = (r: ReportMenuRow, actor: ReportActor) =>
  reportBack(reportFacts(r), actor.confirmOn);

const locked = (ok: boolean, reason: string): Partial<ActionItem> =>
  ok ? {} : { disabled: true, reason };

/**
 * Пункты меню отчёта (прототип modules/reports.js, `reportActions`): «Открыть карточку»; у несданного
 * со сдачей — «Отметить сданным», у «К сдаче» — «Взять в работу»; у ждущего подтверждения —
 * «Подтвердить» и «На исправление»; у сданного — «Требует исправления»; «Изменить срок»; у вида с
 * уплатой — «Указать сумму»; «Прикрепить файл» (с «Файлами в карточках» и правом «Загружать файлы»);
 * у сданного — «Создать уточнённый»; черта; у сданного — «Снять подтверждение» или «Откатить в «…»»;
 * «Не требуется». Без права пункт виден бледным с причиной. У прежней версии (её открывают из «Версий»
 * карточки) сервер действия отклоняет — в меню только «Прикрепить файл» и откат с причиной. `card` —
 * меню «Ещё действия» карточки, без «Открыть карточку». Деньги добавит задача 2.19.
 */
export function reportMenuEntries({
  t,
  actor,
  run,
  card = false,
}: {
  t: Translate;
  actor: ReportActor;
  run: ReportMenuRun;
  card?: boolean;
}): (r: ReportMenuRow) => ActionEntry[] {
  const no = t('report.menu.no_status');
  return (r) => {
    const facts = reportFacts(r);
    const cs = actor.can.changeStatus;
    // У вида «Уплата» шкалы сдачи нет (прототип `st = '—'`).
    const st = r.act === 'pay' ? null : r.status;
    const item = (id: ReportAction, rest: Omit<ActionItem, 'id' | 'run'>): ActionItem => ({
      id,
      ...rest,
      run: () => run[id](r),
    });
    const items: ActionEntry[] = card
      ? []
      : [item('open', { label: t('report.act.open'), icon: 'file' })];
    const file =
      actor.filesOn && actor.can.filesUpload
        ? [item('file', { label: t('report.act.file'), icon: 'clip' })]
        : [];
    const rollback = st === 'submitted' ? [rollbackItem(t, r, actor, item)] : [];
    // ОТКЛОНЕНИЕ: docs/deviations.md#Б-7 — в прототипе у прежней версии меню как у последней.
    if (facts.superseded) {
      return [...items, ...file, ...(rollback.length ? [SEP, ...rollback] : [])];
    }
    if (st && OPEN_REPORT_STATUSES.has(st))
      items.push(
        item('submit', { label: t('report.act.submit'), icon: 'send', ...locked(cs, no) }),
      );
    if (st === 'todo')
      items.push(item('start', { label: t('report.act.start'), icon: 'clock', ...locked(cs, no) }));
    if (reportWaiting(facts, actor.confirmOn)) {
      const why = confirmRefusal(r, actor);
      const lock = locked(!why, why ? t(`err.${why}`) : '');
      items.push(
        item('confirm', {
          label: t('report.act.confirm'),
          icon: 'check',
          sub: t('report.act.confirm_sub'),
          ...lock,
        }),
        item('fix', {
          label: t('report.act.fix'),
          icon: 'refresh',
          sub: t('report.act.fix_sub'),
          ...lock,
        }),
      );
    }
    if (st === 'submitted')
      items.push(
        item('reject', {
          label: t('report.act.reject'),
          icon: 'alert',
          sub: t('report.act.reject_sub'),
          ...locked(cs, no),
        }),
      );
    if (r.act !== 'pay' && OPEN_REPORT_STATUSES.has(r.status))
      items.push(
        item('due', {
          label: t('report.menu.due'),
          icon: 'calendar',
          ...locked(actor.can.repDue, t('report.menu.due_no')),
        }),
      );
    if (reportHasAmount(r.act) && r.status !== 'not_required')
      items.push(
        item('amount', {
          label: t('report.act.amount'),
          icon: 'coins',
          ...locked(actor.can.changeSum, t('report.act.amount_no')),
        }),
      );
    items.push(...file);
    if (st === 'submitted')
      items.push(
        item('revision', { label: t('report.menu.revision'), icon: 'repeat', ...locked(cs, no) }),
      );
    const tail: ActionEntry[] = [...rollback];
    if (reportNotRequiredAllowed(facts, actor.confirmOn))
      tail.push(
        item('not_required', {
          label: t('report.act.not_required'),
          icon: 'ban',
          ...locked(cs, no),
        }),
      );
    return tail.length ? [...items, SEP, ...tail] : items;
  };
}

const SEP: ActionEntry = { id: 'sep', separator: true };

/** «Снять подтверждение» или «Откатить в «…»» (прототип: без права — с причиной, у прежней версии — «—»). */
function rollbackItem(
  t: Translate,
  r: ReportMenuRow,
  actor: ReportActor,
  item: (id: ReportAction, rest: Omit<ActionItem, 'id' | 'run'>) => ActionItem,
): ActionItem {
  const back = reportBackOf(r, actor);
  const to = back && 'to' in back ? back.to : null;
  const label =
    to === 'waiting'
      ? t('status.unconfirm')
      : t('status.rollback_to', { name: to ? statusName(t, 'report', to) : '—' });
  const reason = !actor.can.rollback
    ? t('status.need_rollback_right')
    : back && 'refusal' in back
      ? t(`err.${back.refusal}`)
      : '';
  return item('rollback', { label, icon: 'history', ...locked(!reason && !!to, reason) });
}

/** Кнопки внизу карточки (прототип openReport, `primary`): «Отметить сданным» или «Подтвердить». */
export interface ReportCardButtons {
  primary: 'submit' | 'confirm' | null;
  /** «Отметить сданным» без права «Менять статус сдачи» — видна, но недоступна. */
  disabled: boolean;
  /** «На исправление» рядом с «Подтвердить». */
  fix: boolean;
}

export function reportCardButtons(r: ReportMenuRow, actor: ReportActor): ReportCardButtons {
  const facts = reportFacts(r);
  if (reportSubmittable(facts))
    return { primary: 'submit', disabled: !actor.can.changeStatus, fix: false };
  if (reportWaiting(facts, actor.confirmOn) && !confirmRefusal(r, actor))
    return { primary: 'confirm', disabled: false, fix: true };
  return { primary: null, disabled: false, fix: false };
}

/**
 * Шаги шкалы, которые можно нажать (прототип scNext, stepTo): «В работе» — сразу, «Сдан» — окно
 * «Отметить сданным»; не у прежней версии. Без права «Менять статус сдачи» шаг нажимается, но карточка
 * отвечает «Нет права менять статус», как прототип.
 */
export function reportScaleSteps(r: ReportMenuRow): Partial<Record<string, 'start' | 'submit'>> {
  if (r.superseded || r.act === 'pay') return {};
  const steps: Partial<Record<string, 'start' | 'submit'>> = {};
  for (const to of scaleNext('report', r.status))
    steps[to] = to === 'in_progress' ? 'start' : 'submit';
  return steps;
}

/** Шаг отката на шкале — только с правом «Откат статусов» (прототип scaleFull, `bk`). */
export function reportScaleBack(r: ReportMenuRow, actor: ReportActor): string | null {
  if (!actor.can.rollback) return null;
  const back = reportBackOf(r, actor);
  return back && 'to' in back ? back.to : null;
}

/**
 * Последствия отката (прототип rollbackDlg): снять подтверждение — отчёт снова ждёт подтверждения; шаг
 * назад — регулярная задача снова открыта (у «Не требуется» — отчёт снова активен), у просроченного —
 * снова в просроченных, у сданного снимается дата сдачи, «Требует исправления» снова ждёт
 * подтверждения; файлы не удаляются.
 */
export function reportRollbackEffect(
  t: Translate,
  r: ReportMenuRow,
  to: string,
  o: { confirmOn: boolean; today: string },
): string {
  if (to === 'waiting') {
    return r.confirmedBy
      ? t('report.rollback.unconfirm_by', { who: r.confirmedBy.shortName })
      : t('status.unconfirm_effect');
  }
  const st = r.status;
  return [
    t(st === 'not_required' ? 'report.rollback.effect_none' : 'report.rollback.effect_task'),
    r.dueDate < o.today && (to === 'todo' || to === 'in_progress') && st !== 'needs_fix'
      ? t('report.rollback.effect_todo')
      : '',
    st === 'submitted' ? t('report.rollback.effect_date') : '',
    st === 'needs_fix' && o.confirmOn ? t('report.rollback.effect_wait') : '',
    t('report.rollback.effect_files'),
  ]
    .filter(Boolean)
    .join(' ');
}

/** «НДС · ОсОО «Ала-Тоо» · сентябрь 2026» под заголовком окон отчёта (прототип `sub`). */
export const reportSub = (r: ReportRow, name: 'short' | 'full' = 'short') =>
  `${name === 'full' ? r.type.name : r.type.shortName} · ${r.contractor.name} · ${r.periodFull}`;
