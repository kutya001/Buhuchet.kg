'use client';

import { formatDateRu, formatSom, projectLeft } from '@buhuchet/domain';
import {
  Box,
  buttonClass,
  EmptyState,
  Icon,
  MiniTable,
  Note,
  StatusPill,
  type MiniColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { statusPillView } from '../status/status-view';
import { useProjectActions } from './project-actions';
import { contractorProjectsQuery } from './projects-data';

/**
 * Вкладка «Проекты» карточки контрагента (задача 2.26; ТЗ «Карточка контрагента»; прототип
 * modules/contractor-card.js, `st.tab === 'projects'`): «Проектов: N», кнопка «Новый проект» (право
 * «Вести проекты и разовые услуги», контрагент не в архиве); таблица — проект, срок, статус, главный,
 * а тому, кто видит деньги, — план, получено, остаток; строка открывает карточку проекта. Пустая —
 * «Проектов пока нет» с пояснением.
 */
export function ContractorProjectsTab({
  contractor,
}: {
  contractor: { id: string; name: string };
}) {
  const t = useT();
  const query = useQuery(contractorProjectsQuery(contractor.id));
  const projects = useProjectActions();
  const data = query.data;
  const add = () => projects.newProject(contractor);

  if (query.isError) return <Note tone="bad">{t('proj.load_error')}</Note>;
  if (!data) return null;
  if (!data.items.length)
    return (
      <>
        <EmptyState
          icon="briefcase"
          title={t('proj.cp.empty')}
          text={t('proj.cp.empty_text')}
          actions={
            data.canCreate
              ? [{ id: 'add', icon: 'plus', label: t('proj.cp.new'), primary: true, onClick: add }]
              : []
          }
        />
        {projects.dialogs}
      </>
    );

  const columns: MiniColumn[] = [
    { key: 'name', label: t('proj.cp.col.name') },
    { key: 'term', label: t('proj.cp.col.term') },
    { key: 'status', label: t('proj.cp.col.status') },
    { key: 'lead', label: t('proj.cp.col.lead') },
    ...(data.money
      ? [
          { key: 'plan', label: t('proj.cp.col.plan'), numeric: true },
          { key: 'paid', label: t('proj.cp.col.paid'), numeric: true },
          { key: 'left', label: t('proj.cp.col.left'), numeric: true },
        ]
      : []),
  ];
  return (
    <div data-cp-projects={contractor.id} className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-muted">
          {t('proj.cp.count', { n: data.items.length })}
        </span>
        <div className="flex-1" />
        {data.canCreate ? (
          <button
            type="button"
            data-cp-project-add=""
            className={buttonClass('cta', 'sm')}
            onClick={add}
          >
            <Icon name="plus" size="sm" />
            {t('proj.cp.new')}
          </button>
        ) : null}
      </div>
      <Box>
        <MiniTable
          label={t('cp.card.tab.projects')}
          empty={t('proj.cp.empty')}
          onOpen={(id) => projects.openCard(id)}
          columns={columns}
          rows={data.items.map((p) => ({
            key: p.id,
            cells: {
              name: <span data-cp-project={p.id}>{p.name}</span>,
              term: `${formatDateRu(p.startsOn)} – ${formatDateRu(p.endsOn)}`,
              status: <StatusPill {...statusPillView(t, 'project', p.status)} size="sm" />,
              lead: p.leadName,
              ...(p.money
                ? {
                    plan: p.money.plan ? (
                      <span className="tabular-nums">{formatSom(p.money.plan)}</span>
                    ) : (
                      <span className="text-faint">{t('proj.cp.plan_none')}</span>
                    ),
                    paid: <span className="tabular-nums">{formatSom(p.money.paid)}</span>,
                    left: p.money.plan ? (
                      <span className="tabular-nums">
                        {formatSom(projectLeft(p.money.plan, p.money.paid))}
                      </span>
                    ) : (
                      '—'
                    ),
                  }
                : {}),
            },
          }))}
        />
      </Box>
      {projects.dialogs}
    </div>
  );
}
