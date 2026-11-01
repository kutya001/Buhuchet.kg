'use client';

import { formatDateRu, formatMomentRu, formatSom, type ListSort } from '@buhuchet/domain';
import type { ProjectRow } from '@buhuchet/shared';
import {
  Icon,
  Pill,
  StatusMini,
  StatusMiniNone,
  StatusPill,
  type GridAudit,
  type GridColumn,
  type GridRowTone,
} from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { miniView, statusName } from '../status/status-view';

/** Сортировка по умолчанию — по окончанию, раньше — выше (прототип `sort: { key: 'to', dir: 1 }`). */
export const PROJECT_DEFAULT_SORT: ListSort = { key: 'to', dir: 'asc' };

/**
 * Видимые по умолчанию — как в прототипе (`projCols` без `hide`): проект, контрагент, статус, начало,
 * окончание, ответственные, «Получено / план» (тому, кто видит деньги).
 */
export const PROJECT_DEFAULT_VISIBLE = ['name', 'cp', 'status', 'from', 'to', 'resps', 'paid'];

/** Компактная шкала статуса проекта (прототип `scaleMini('proj', …)`). */
export function ProjectStatusMini({ t, status }: { t: Translate; status: ProjectRow['status'] }) {
  const view = miniView(t, { scale: 'project', status, history: [] });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}

/** «срок прошёл» красной меткой (прототип `projOver`). */
export function ProjectOverPill({ t, card = false }: { t: Translate; card?: boolean }) {
  return (
    <Pill tone="bad" icon="alert" size={card ? 'md' : 'sm'}>
      {t(card ? 'proj.over_card' : 'proj.over')}
    </Pill>
  );
}

const faint = (text: string) => <span className="text-faint">{text}</span>;

/**
 * Столбцы списка проектов — как в прототипе (modules/projects.js, `projCols`), ключи — как на сервере.
 * Денежные — только тому, кто видит деньги проектов (прототип `moneyVis`). Служебные «Создал»,
 * «Изменил», «Создано», «Изменено» добавляет сам список (`PROJECT_AUDIT`).
 */
export function projectColumns(t: Translate, money: boolean): GridColumn<ProjectRow>[] {
  const som = (v: number) => formatSom(v);
  const cols: GridColumn<ProjectRow>[] = [
    {
      key: 'name',
      label: t('proj.col.name'),
      type: 'text',
      width: 280,
      text: (r) => r.name,
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    {
      key: 'cp',
      label: t('proj.col.cp'),
      type: 'enum',
      width: 210,
      text: (r) => r.contractor.name,
    },
    {
      key: 'status',
      label: t('proj.col.status'),
      type: 'enum',
      width: 170,
      text: (r) => statusName(t, 'project', r.status),
      cell: (r) => (
        <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
          <ProjectStatusMini t={t} status={r.status} />
          {r.overdue ? <ProjectOverPill t={t} /> : null}
        </span>
      ),
    },
    {
      key: 'from',
      label: t('proj.col.from'),
      type: 'date',
      width: 110,
      text: (r) => formatDateRu(r.startsOn),
    },
    {
      key: 'to',
      label: t('proj.col.to'),
      type: 'date',
      width: 120,
      text: (r) => formatDateRu(r.endsOn),
      cell: (r) => (
        <span
          data-overdue={r.overdue ? '' : undefined}
          className={r.overdue ? 'font-semibold text-danger' : ''}
        >
          {formatDateRu(r.endsOn)}
        </span>
      ),
    },
    {
      key: 'lead',
      label: t('proj.col.lead'),
      type: 'enum',
      width: 130,
      text: (r) => r.lead.name,
    },
    {
      key: 'resps',
      label: t('proj.col.resps'),
      type: 'text',
      width: 190,
      text: (r) => r.members.map((m) => m.name).join(', '),
    },
    {
      key: 'desc',
      label: t('proj.col.desc'),
      type: 'text',
      width: 240,
      text: (r) => r.description,
    },
    {
      key: 'works',
      label: t('proj.col.works'),
      type: 'int',
      width: 130,
      text: (r) =>
        r.worksTotal ? t('proj.works.of', { done: r.worksDone, total: r.worksTotal }) : '',
      cell: (r) =>
        r.worksTotal ? (
          <span className="inline-flex items-center gap-1">
            {t('proj.works.of', { done: r.worksDone, total: r.worksTotal })}
            {r.worksOverdue ? (
              <span className="text-danger" title={t('proj.works.over')}>
                <Icon name="alert" size="sm" />
              </span>
            ) : null}
          </span>
        ) : (
          faint('—')
        ),
    },
    {
      key: 'nworks',
      label: t('proj.col.nworks'),
      type: 'int',
      width: 110,
      text: (r) => String(r.worksTotal),
    },
    {
      key: 'pfiles',
      label: t('proj.col.files'),
      type: 'int',
      width: 90,
      text: (r) => String(r.files),
    },
    {
      key: 'tasks',
      label: t('proj.col.tasks'),
      type: 'int',
      width: 120,
      text: (r) => String(r.tasksOpen),
    },
  ];
  if (!money) return cols;
  cols.push(
    {
      key: 'plan',
      label: t('proj.col.plan'),
      type: 'money',
      width: 170,
      total: som,
      text: (r) => (r.plan ? formatSom(r.plan) : ''),
      cell: (r) =>
        r.plan ? (
          <span className="tabular-nums">{formatSom(r.plan)}</span>
        ) : (
          faint(t('proj.plan_none'))
        ),
    },
    {
      key: 'paid',
      label: t('proj.col.paid'),
      type: 'money',
      width: 170,
      total: som,
      text: (r) => formatSom(r.paid ?? 0),
      cell: (r) => (
        <span className="tabular-nums">
          {formatSom(r.paid ?? 0)}
          {r.plan ? <span className="text-faint"> / {formatSom(r.plan, 'auto')}</span> : null}
        </span>
      ),
    },
    {
      key: 'left',
      label: t('proj.col.left'),
      type: 'money',
      width: 130,
      total: som,
      text: (r) => (r.plan ? formatSom(projectRowLeft(r)) : ''),
      cell: (r) => {
        if (!r.plan) return faint('—');
        const left = projectRowLeft(r);
        return left > 0 ? (
          <span className="font-semibold tabular-nums">{formatSom(left)}</span>
        ) : (
          faint(formatSom(0))
        );
      },
    },
  );
  return cols;
}

/** Остаток строки (прототип `projLeft`): план минус получено, не меньше нуля. */
const projectRowLeft = (r: ProjectRow) => Math.max(0, (r.plan ?? 0) - (r.paid ?? 0));

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Значения служебных столбцов; «Изменил» у записи без правок — тот, кто создал. */
export const PROJECT_AUDIT: GridAudit<ProjectRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => moment(r.audit.createdAt),
  updatedAt: (r) => moment(r.audit.updatedAt),
};

/** Подсветка строки (прототип `rowClass`): срок прошёл — красным, завершён и отменён — приглушённо. */
export function projectTone(r: ProjectRow): GridRowTone | undefined {
  if (r.overdue) return 'overdue';
  return r.status === 'done' || r.status === 'cancelled' ? 'muted' : undefined;
}
