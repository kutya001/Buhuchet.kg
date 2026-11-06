'use client';

import { formatMomentRu, formatPhone, type ListSort } from '@buhuchet/domain';
import type { AdminLead } from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  linkButtonClass,
  Note,
  StatusMini,
  StatusMiniNone,
  StatusPill,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api-client';
import { PhoneLinks } from '../contractors/contractor-columns';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { phoneCodesQuery } from '../staff/staff-data';
import { miniView, statusName } from '../status/status-view';
import { useLeadActions } from './lead-actions';
import { fetchLeadValues, fetchLeads, leadSummaryQuery, useLeadsRefresh } from './leads-data';
import { NewOrganizationDialog } from './new-org-dialog';
import { useOrgsAddRequest } from './orgs-list';

/**
 * От новых к старым (прототип `sort: {key: 'at', dir: -1}`; при служебных столбцах — по «Создано»,
 * у заявки это одно и то же время).
 */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/** Видимые по умолчанию — все столбцы заявки (прототип: у `adm-leads` нет списка в SHOW). */
const DEFAULT_VISIBLE = [
  'at',
  'name',
  'firm',
  'phone',
  'size',
  'telegram',
  'note',
  'status',
  'org',
];

const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Статус заявки — компактная шкала «2/3 В работе» (прототип `scaleMini('lead', …)`). */
function LeadStatusMini({ t, l }: { t: Translate; l: AdminLead }) {
  const last = l.lastStatus;
  const view = miniView(t, {
    scale: 'lead',
    status: l.status,
    history: last
      ? [
          {
            at: new Date(last.at),
            from: null,
            to: l.status,
            rollback: false,
            reason: null,
            actor: last.by,
          },
        ]
      : [],
  });
  if (view.kind === 'mini') return <StatusMini {...view.props} />;
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  return <StatusPill {...view.pill} size="sm" />;
}

/**
 * Столбцы — как в прототипе (admin/leads.js, renderLeads), ключи — как на сервере. Служебные
 * «Создал» (посетитель сайта), «Изменил», «Создано», «Изменено» добавляет сам список.
 */
function leadColumns(
  t: Translate,
  phone: (raw: string) => string,
  toOrgs: () => void,
): GridColumn<AdminLead>[] {
  return [
    {
      key: 'at',
      label: t('leads.col.at'),
      type: 'text',
      width: 130,
      text: (l) => moment(l.at),
      cell: (l) => <span className="tabular-nums">{moment(l.at)}</span>,
    },
    {
      key: 'name',
      label: t('leads.col.name'),
      type: 'text',
      width: 190,
      text: (l) => l.name,
      cell: (l) => <span className="font-semibold">{l.name}</span>,
    },
    { key: 'firm', label: t('leads.col.firm'), type: 'text', width: 220, text: (l) => l.firm },
    {
      key: 'phone',
      label: t('leads.col.phone'),
      type: 'text',
      width: 170,
      text: (l) => phone(l.phone),
      cell: (l) => <PhoneLinks t={t} phone={l.phone} text={phone(l.phone)} />,
    },
    { key: 'size', label: t('leads.col.size'), type: 'enum', width: 110, text: (l) => l.size },
    {
      key: 'telegram',
      label: t('leads.col.telegram'),
      type: 'text',
      width: 130,
      text: (l) => l.telegram ?? '',
    },
    {
      key: 'note',
      label: t('leads.col.note'),
      type: 'text',
      width: 240,
      text: (l) => l.note ?? '',
    },
    {
      key: 'status',
      label: t('leads.col.status'),
      type: 'enum',
      width: 170,
      text: (l) => statusName(t, 'lead', l.status),
      cell: (l) => <LeadStatusMini t={t} l={l} />,
    },
    {
      key: 'org',
      label: t('leads.col.org'),
      type: 'text',
      width: 200,
      text: (l) => l.org?.name ?? '',
      cell: (l) =>
        l.org ? (
          <button
            type="button"
            data-lead-org=""
            className={linkButtonClass()}
            onClick={(e) => {
              e.stopPropagation();
              toOrgs();
            }}
          >
            {l.org.name}
          </button>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];
}

const LEADS_AUDIT: GridAudit<AdminLead> = {
  createdBy: (l) => l.audit.createdBy ?? '',
  updatedBy: (l) => l.audit.updatedBy ?? l.audit.createdBy ?? '',
  createdAt: (l) => moment(l.audit.createdAt),
  updatedAt: (l) => moment(l.audit.updatedAt),
};

/**
 * Админка → «Организации» → «Заявки» (ТЗ «Админка» → «Вкладка «Заявки»»; прототип admin/leads.js,
 * renderLeads): пояснение над списком, заявки с лендинга от новых к старым с поиском, фильтрами,
 * группировкой и «В Excel»; «Отказ» — приглушённо. Нажатие на строку — окно заявки, «⋯» — действия;
 * «+ Добавить» → «Организация» — как на вкладке «Организации».
 */
export function LeadsList() {
  const t = useT();
  const router = useRouter();
  const labels = useGridLabels('leads.count');
  const codes = useQuery(phoneCodesQuery);
  const phone = useCallback((raw: string) => formatPhone(raw, codes.data ?? []), [codes.data]);
  const toOrgs = useCallback(() => router.push(tabHref('orgs', 'list')), [router]);
  const columns = useMemo(() => leadColumns(t, phone, toOrgs), [t, phone, toOrgs]);
  const view = useViewSettings('orgs.leads');
  const { search, clearSearch, openProfile } = useShell();
  const summary = useQuery(leadSummaryQuery);
  const leads = useLeadActions();
  const list = useListPage({
    gridKey: 'orgs.leads',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchLeads,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.admin.leads.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const refresh = useLeadsRefresh();
  const [create, setCreate] = useState<DialogSlot<null> | null>(null);
  useOrgsAddRequest(() => setCreate(openSlot(null)));

  return (
    <div className="flex flex-col gap-3.5">
      {summary.data?.recipients === 0 ? (
        // Ни у одного администратора платформы не привязан Telegram (прототип v74 renderLeads).
        // Как `.note.warn` прототипа: текст, сразу за ним кнопка в той же строке, по верхнему краю.
        <Note tone="warn" icon="alert">
          <div data-leads-notg="" className="flex items-start gap-[9px]">
            <span className="min-w-0">{t('leads.no_tg')}</span>
            <button
              type="button"
              className={`${buttonClass('default', 'sm')} shrink-0`}
              onClick={openProfile}
            >
              <Icon name="user" size="sm" />
              {t('profile.title')}
            </button>
          </div>
        </Note>
      ) : null}
      <Note>{t('leads.note')}</Note>
      <DataGrid
        columns={columns}
        audit={LEADS_AUDIT}
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
        loadValues={fetchLeadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="send" title={t('grid.empty')} />}
        rowKey={(l) => l.id}
        titleKey="name"
        rowTone={(l) => (l.status === 'rejected' ? 'muted' : undefined)}
        label={t('tab.orgs.leads')}
        labels={labels}
        actions={leads.actions}
        onOpen={(l) => leads.openCard(l.id)}
      />
      {leads.dialogs}
      {create ? (
        <NewOrganizationDialog
          key={`create-${create.n}`}
          open={create.open}
          onClose={() => setCreate(closeSlot)}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}
