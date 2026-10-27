'use client';

import { formatDateRu, type ListSort } from '@buhuchet/domain';
import { KbTeamList, ListValues, type KbTeamMember } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  DataGrid,
  EmptyState,
  Modal,
  useWindow,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { kbMemberQuery } from './kb-data';
import { KbBadge, KbBar, KbBox, KbLadder, KbModules, nextText } from './kb-parts';

/** По умолчанию — от высшего уровня (прототип `sort:{key:'lvl',dir:-1}`). */
const DEFAULT_SORT: ListSort = { key: 'level', dir: 'desc' };
const DEFAULT_VISIBLE = ['fullName', 'role', 'level', 'pct', 'steps', 'levelAt'];

/** Столбцы «Уровней сотрудников» — как в прототипе (modules/kb.js, вкладка team), ключи — как на сервере. */
export function teamColumns(t: Translate): GridColumn<KbTeamMember>[] {
  return [
    {
      key: 'fullName',
      label: t('kb.team.col.full_name'),
      type: 'text',
      width: 260,
      text: (m) => m.fullName,
      cell: (m) => <span className="truncate font-semibold">{m.fullName}</span>,
    },
    { key: 'role', label: t('kb.team.col.role'), type: 'enum', width: 170, text: (m) => m.role },
    {
      key: 'level',
      label: t('kb.team.col.level'),
      type: 'enum',
      width: 230,
      text: (m) => m.levelName,
      cell: (m) => <KbBadge level={m.level} name={m.levelName} pct={false} of={m.of} />,
    },
    {
      key: 'pct',
      label: t('kb.team.col.pct'),
      type: 'int',
      width: 120,
      text: (m) => String(m.pct),
    },
    {
      key: 'steps',
      label: t('kb.team.col.steps'),
      type: 'text',
      width: 150,
      text: (m) => t('kb.team.steps', { done: m.done, total: m.total }),
    },
    {
      key: 'levelAt',
      label: t('kb.team.col.level_at'),
      type: 'date',
      width: 170,
      text: (m) => (m.levelAt ? formatDateRu(m.levelAt) : ''),
    },
  ];
}

const fetchTeam: FetchListPage<KbTeamMember> = async (params) => {
  const res = await api.api.kb.team.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return KbTeamList.parse(await res.json());
};

const fetchTeamValues = async (col: string, q?: string) => {
  const res = await api.api.kb.team.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/**
 * «База знаний» → «Уровни сотрудников» (прототип modules/kb.js, вкладка team): уровень, процент и
 * шаги каждого сотрудника по его программе — общим списком с поиском, фильтрами, группировкой и
 * «В Excel»; заблокированные — приглушённо. Строка открывает «Прогресс по модулям». Вкладку видят
 * владелец и роль с правом «Видеть уровни сотрудников» — его же проверяет сервер.
 */
export function KbTeamTab() {
  const t = useT();
  const labels = useGridLabels('staff.count');
  const columns = useMemo(() => teamColumns(t), [t]);
  const view = useViewSettings('kb.team');
  const { search, clearSearch, access } = useShell();
  const allowed = access.can('kbLevels');
  const list = useListPage({
    gridKey: 'kb.team',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready && allowed,
    fetchPage: fetchTeam,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.kb.team.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [member, setMember] = useState<DialogSlot<KbTeamMember> | null>(null);
  const actions = useCallback(
    (m: KbTeamMember): ActionEntry[] => [
      {
        id: 'progress',
        label: t('kb.team.progress'),
        icon: 'grad',
        run: () => setMember(openSlot(m)),
      },
    ],
    [t],
  );

  if (!allowed) {
    return (
      <EmptyState icon="lock" title={t('kb.team.no_access')} text={t('kb.team.no_access_text')} />
    );
  }
  return (
    <>
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={fetchTeamValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="users" title={t('grid.empty')} />}
        rowKey={(m) => m.id}
        titleKey="fullName"
        rowTone={(m) => (m.active ? undefined : 'muted')}
        label={t('tab.kb.team')}
        labels={labels}
        actions={actions}
        onOpen={(m) => setMember(openSlot(m))}
      />
      {member ? (
        <KbMemberDialog
          key={`kb-member-${member.n}`}
          member={member.data}
          open={member.open}
          onClose={() => setMember(closeSlot)}
        />
      ) : null}
    </>
  );
}

/**
 * «Прогресс по модулям» сотрудника (прототип kbUserDlg): уровень, шаги, сколько до следующего уровня,
 * прогресс по модулям и лесенка уровней.
 */
function KbMemberDialog({
  member,
  open,
  onClose,
}: {
  member: KbTeamMember;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const query = useQuery(kbMemberQuery(member.id));
  const p = query.data?.progress;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={member.fullName}
      sub={t('kb.member.sub', { role: member.role })}
      footer={<MemberFooter />}
    >
      {p ? (
        <>
          <Box>
            <div className="flex flex-wrap items-center gap-2.5">
              <KbBadge
                level={p.level}
                name={p.levels[p.level]?.name ?? ''}
                pct={p.pct}
                of={p.levels.length}
                big
              />
              <span className="flex-1" />
              <span className="text-muted">
                {t('kb.member.steps', { done: p.done, total: p.total })}
              </span>
            </div>
            <KbBar pct={p.pct} />
            <span className="text-[11.5px] leading-[1.4] text-faint">
              {t('kb.member.hint', { next: p.next === null ? t('kb.top') : nextText(t, p) })}
            </span>
          </Box>
          <Box title={t('kb.mods.title')}>
            <KbModules progress={p} />
          </Box>
          <Box title={t('kb.levels.title')}>
            <KbLadder progress={p} />
          </Box>
        </>
      ) : null}
    </Modal>
  );
}

function MemberFooter() {
  const t = useT();
  const { close } = useWindow();
  return (
    <>
      <div className="flex-1" />
      <button type="button" className={buttonClass('cta')} onClick={close}>
        {t('kb.member.done')}
      </button>
    </>
  );
}

/**
 * Блок «Уровень знаний» в карточке сотрудника (прототип empCard: `can('kbLevels')||e.id===S.me`):
 * свой — всегда, чужой — с правом «Видеть уровни сотрудников»; с прогрессом по модулям.
 */
export function KbMemberBox({ employeeId }: { employeeId: string }) {
  const { access, employeeId: own } = useShell();
  const allowed = employeeId === own || access.can('kbLevels');
  const query = useQuery({ ...kbMemberQuery(employeeId), enabled: allowed });
  if (!allowed || !query.data) return null;
  return <KbBox progress={query.data.progress} modules />;
}
