'use client';

import {
  ADMIN_DICT_COLUMNS,
  ADMIN_DICT_META,
  adminDictDefaultSort,
  DEFAULT_PHONE_COUNTRY,
  formatMomentRu,
  phoneCodeExample,
  type AdminValueDict,
  type GridKey,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminDictValue } from '@buhuchet/shared';
import {
  ConfirmDialog,
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Note,
  StatusPill,
  Tag,
  useToast,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { api, callApi, type ApiResult } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels, type CountKey } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { DictHistory } from './dict-history-box';
import {
  fetchAdminDict,
  fetchAdminDictValues,
  reportTypeOptionsQuery,
  usePdictsRefresh,
} from './pdicts-data';
import { ValueDialog } from './value-dialog';

const pd = api.api.admin['platform-dicts'];

/** Ширины столбцов по умолчанию, px — как в прототипе (renderPDicts0, `w`). */
const WIDTHS: Readonly<Record<string, number>> = {
  n: 70,
  code: 100,
  name: 300,
  shortName: 120,
  declarationFor: 130,
  fullName: 280,
  note: 340,
  contacts: 260,
  hours: 200,
  site: 180,
  contactsNote: 220,
  gnsCode: 90,
  region: 170,
  kind: 170,
  byPhone: 150,
  frees: 260,
  who: 300,
  how: 260,
  combines: 260,
  accountantNote: 340,
  article: 100,
  description: 340,
  types: 220,
  dialCode: 90,
  mask: 160,
  digits: 90,
  example: 200,
  contractors: 130,
  used: 130,
  active: 130,
};

/** Свои ширины справочника: у режима краткое название узкое. */
const DICT_WIDTHS: Partial<Record<AdminValueDict, Readonly<Record<string, number>>>> = {
  bases: { code: 130, name: 260, description: 320, note: 240, contractors: 120 },
  regimes: { code: 90, name: 180, kind: 120 },
  phones: { code: 90, name: 200 },
};

/** Столбцы моноширинным шрифтом: коды, маски и номера. */
const MONO = new Set(['code', 'gnsCode', 'dialCode', 'mask', 'example']);

/** «Цифр» в номере по маске (прототип: число «X»). */
const maskDigits = (mask: string) => mask.split('X').length - 1;

const ugnsName = (dict: AdminValueDict, x: AdminDictValue) =>
  dict === 'ugns' ? `${x.data.gnsCode ?? ''} ${x.data.shortName ?? ''}`.trim() : x.name;

/** Значение столбца строкой — для подсказки, карточки и «—» у пустого. */
function cellText(
  dict: AdminValueDict,
  key: string,
  x: AdminDictValue,
  t: Translate,
  names: ReadonlyMap<string, string>,
): string {
  switch (key) {
    case 'types': {
      const types = x.data.types ?? [];
      return types.length ? types.map((code) => names.get(code) ?? code).join(', ') : '—';
    }
    case 'n':
      return x.n === null ? '' : String(x.n);
    case 'code':
      return x.code;
    case 'name':
      return x.name;
    case 'used':
      return String(x.used);
    case 'contractors':
      return String(x.contractors);
    case 'active':
      return t(x.active ? 'pdicts.status.on' : 'pdicts.status.off');
    case 'declarationFor':
      return x.data.declarationFor ? t(`dicts.platform.end.${x.data.declarationFor}`) : '';
    case 'kind': {
      const kind = ADMIN_DICT_META[dict].kind;
      return kind && x.data.kind ? t(`${kind.text}.${x.data.kind}` as UiTextKey) : '';
    }
    case 'byPhone':
      return t(x.data.byPhone ? 'pdicts.bank.by_phone.yes' : 'pdicts.bank.by_phone.no');
    case 'contacts':
      return (x.data.contacts ?? []).map((c) => `${c.label}: ${c.value}`).join('; ');
    case 'gnsCode':
      return x.data.gnsCode || '—';
    case 'dialCode':
      return `+${x.data.dialCode ?? ''}`;
    case 'digits':
      return String(maskDigits(x.data.mask ?? ''));
    case 'example':
      return phoneCodeExample(x.data.dialCode ?? '', x.data.mask ?? '');
    default: {
      const v = (x.data as Record<string, unknown>)[key];
      return typeof v === 'string' ? v : '';
    }
  }
}

/**
 * Столбцы списка — ключи и подписи общие с сервером (`ADMIN_DICT_COLUMNS`); `names` — краткие названия
 * видов отчётов для «Виды отчётов» основания.
 */
export function adminDictColumns(
  dict: AdminValueDict,
  t: Translate,
  names: ReadonlyMap<string, string> = new Map(),
): GridColumn<AdminDictValue>[] {
  return ADMIN_DICT_COLUMNS[dict].map((c) => {
    const column: GridColumn<AdminDictValue> = {
      key: c.key,
      label: t(c.label as UiTextKey),
      type: c.type,
      width: DICT_WIDTHS[dict]?.[c.key] ?? WIDTHS[c.key],
      text: (x) => cellText(dict, c.key, x, t, names),
    };
    if (c.key === 'name') {
      column.cell =
        dict === 'phones'
          ? (x) => (
              <span>
                {x.data.flag} <span className="font-semibold">{x.name}</span>
                {x.code === DEFAULT_PHONE_COUNTRY ? (
                  <>
                    {' '}
                    <Tag>{t('pdicts.phone.default_tag')}</Tag>
                  </>
                ) : null}
              </span>
            )
          : (x) => <span className="font-semibold">{x.name}</span>;
    }
    if (MONO.has(c.key)) column.className = MONO_CLASS;
    if (c.key === 'byPhone') {
      column.cell = (x) =>
        x.data.byPhone ? (
          <StatusPill tone="green" icon="phone" label={t('pdicts.bank.by_phone.yes')} size="sm" />
        ) : (
          <span className="text-faint">{t('pdicts.bank.by_phone.no')}</span>
        );
    }
    if (c.key === 'active') {
      column.cell = (x) =>
        x.active ? (
          <StatusPill tone="green" icon="check" label={t('pdicts.status.on')} size="sm" />
        ) : (
          <StatusPill tone="faint" icon="ban" label={t('pdicts.status.off')} size="sm" />
        );
    }
    return column;
  });
}

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Служебные столбцы; у значений из наполнения «Создано» пусто (docs/deviations.md п. 48). */
const AUDIT: GridAudit<AdminDictValue> = {
  createdBy: (x) => x.audit.createdBy ?? '',
  updatedBy: (x) => x.audit.updatedBy ?? x.audit.createdBy ?? '',
  createdAt: (x) => moment(x.audit.createdAt),
  updatedAt: (x) => moment(x.audit.updatedAt),
};

const COUNT: Readonly<Record<AdminValueDict, CountKey>> = {
  bases: 'pdicts.bases_count',
  regimes: 'pdicts.regimes_count',
  forms: 'pdicts.count',
  phones: 'pdicts.phones_count',
  organs: 'pdicts.count',
  reasons: 'pdicts.count',
  ugns: 'pdicts.ugns_count',
  banks: 'pdicts.count',
};

/**
 * Список и на телефоне — таблицей, без «Таблица / Карточки» (прототип `fixedView: 'table'`): короткие
 * справочники, основания и коды стран; режимы и УГНС — карточками.
 */
const TABLE_ONLY: ReadonlySet<AdminValueDict> = new Set([
  'bases',
  'forms',
  'phones',
  'organs',
  'banks',
  'reasons',
]);

/** Пояснение над списком (прототип: у шаблонов для организаций и у УГНС). */
const NOTES: Partial<Record<AdminValueDict, UiTextKey>> = {
  bases: 'pdicts.note.bases',
  regimes: 'pdicts.note.regimes',
  reasons: 'pdicts.note.reasons',
  ugns: 'pdicts.note.ugns',
};

/** Способ «+ Добавить» на вкладке справочника (прототип pdAdd): «Значение», «Режим», «Налоговый орган». */
const ADD_ACTION: Partial<Record<AdminValueDict, string>> = {
  bases: 'base',
  regimes: 'regime',
  phones: 'phone',
  ugns: 'ugns',
};

/** Тексты справочника вместо общих («Значение отключено», «Значение нигде не используется…»). */
const OFF_TOAST: Partial<Record<AdminValueDict, UiTextKey>> = {
  bases: 'pdicts.toast.off_base',
  regimes: 'pdicts.toast.off_regime',
  phones: 'pdicts.toast.off_phone',
  ugns: 'pdicts.toast.off_ugns',
};
const DELETE_TEXT: Partial<Record<AdminValueDict, UiTextKey>> = {
  bases: 'pdicts.delete.text_base',
  regimes: 'pdicts.delete.text_regime',
  ugns: 'pdicts.delete.text_ugns',
};

/** Пояснение «Отключить»: что будет с отключённым значением. */
const OFF_SUB: Partial<Record<AdminValueDict, UiTextKey>> = {
  bases: 'pdicts.action.off_sub_base',
  phones: 'pdicts.action.off_sub_phone',
  ugns: 'pdicts.action.off_sub_ugns',
};

/**
 * Почему удалить нельзя (прототип): у УГНС и основания — «Указан (отмечено) у N контрагентов», у
 * основания, привязанного только к видам отчётов, — «Привязано к видам отчётов»; у остальных — «Используется
 * в N записях».
 */
function usedReason(dict: AdminValueDict, x: AdminDictValue, t: Translate): string {
  if (dict === 'ugns' && x.contractors > 0)
    return t('pdicts.delete.used_ugns', { n: x.contractors });
  if (dict === 'bases') {
    return x.contractors > 0
      ? t('pdicts.delete.used_base', { n: x.contractors })
      : t('pdicts.delete.linked_base');
  }
  return t('pdicts.delete.used', { n: x.used });
}

/** «+ Добавить» → способ добавления вкладки справочника. */
function useValueAddRequest(dict: AdminValueDict, run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'pdicts' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === (ADD_ACTION[dict] ?? 'value')) run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * Админка → «Справочники платформы» → формы собственности, органы, УГНС, банковские провайдеры,
 * причины изменения срока (ТЗ «Общие правила для всех справочников»; прототип admin/platform-dicts.js
 * renderPDicts0): «№» по порядку справочника (только у коротких — решение заказчика 27.10.2026,
 * docs/deviations.md п. Д-2; УГНС — по региону), «Используется», «Статус»; отключённые —
 * приглушённо. Действия: «Изменить»/«Переименовать», «Выше» и «Ниже», «Отключить»/«Включить»,
 * «Удалить» — только неиспользуемое, после вопроса. Под списком — «История изменений».
 */
export function ValueDictList({ dict }: { dict: AdminValueDict }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  const gridKey = `pdicts.${dict}` as GridKey;
  const { ordered, fixed, undeletable } = ADMIN_DICT_META[dict];
  const labels = useGridLabels(COUNT[dict]);
  const types = useQuery({ ...reportTypeOptionsQuery, enabled: dict === 'bases' });
  const columns = useMemo(
    () => adminDictColumns(dict, t, new Map((types.data ?? []).map((x) => [x.code, x.shortName]))),
    [dict, t, types.data],
  );
  const defaultVisible = useMemo(
    () => ADMIN_DICT_COLUMNS[dict].filter((c) => !c.hidden).map((c) => c.key),
    [dict],
  );
  const defaultSort = adminDictDefaultSort(dict);
  const view = useViewSettings(gridKey);
  const { search, clearSearch } = useShell();
  const fetchPage = useMemo(() => fetchAdminDict(dict), [dict]);
  const loadValues = useMemo(() => fetchAdminDictValues(dict), [dict]);
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      pd[':dict'].export.$get({ param: { dict }, query: { ...params, cols: visible.join(',') } }),
    [dict, params, visible],
  );
  const exporter = useListExport(sendExport);
  const [edit, setEdit] = useState<DialogSlot<AdminDictValue | null> | null>(null);
  const [askDelete, setAskDelete] = useState<AdminDictValue | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const open = (x: AdminDictValue | null) => setEdit(openSlot(x));
  useValueAddRequest(dict, () => open(null));
  // Всего значений в справочнике (без фильтров): «Ниже» у последнего по «№» недоступно.
  const count = (list.data as { count?: number } | undefined)?.count ?? 0;

  /** Действие строки: одно за раз; ответ — уведомлением, список и история перечитываются. */
  const act = async (
    x: AdminDictValue,
    send: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
    done?: UiTextKey,
  ) => {
    if (pending.has(x.code)) return;
    setPending((p) => new Set(p).add(x.code));
    let res: ApiResult<unknown>;
    try {
      res = await callApi(send);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(x.code);
        return next;
      });
    }
    refresh(dict);
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    if (done) toast(t(done), { icon: 'check' });
  };
  const param = (x: AdminDictValue) => ({ dict, code: x.code });
  const move = (x: AdminDictValue, step: -1 | 1) =>
    act(x, () =>
      pd[':dict'][':code'].move.$post({ param: param(x), json: { step, version: x.version } }),
    );
  const setActive = (x: AdminDictValue, active: boolean) =>
    act(
      x,
      () =>
        pd[':dict'][':code'].active.$post({
          param: param(x),
          json: { active, version: x.version },
        }),
      active ? undefined : (OFF_TOAST[dict] ?? 'pdicts.toast.off'),
    );
  const remove = (x: AdminDictValue) =>
    act(
      x,
      () =>
        pd[':dict'][':code'].$delete({ param: param(x), query: { version: String(x.version) } }),
      'pdicts.toast.deleted',
    );

  const actions = (x: AdminDictValue): ActionEntry[] => {
    const ugns = dict === 'ugns';
    const edit: ActionEntry = {
      id: 'edit',
      label: t(
        dict === 'forms' ||
          dict === 'banks' ||
          dict === 'regimes' ||
          dict === 'bases' ||
          dict === 'phones' ||
          ugns
          ? 'pdicts.action.edit'
          : 'pdicts.action.rename',
      ),
      icon: 'edit',
      run: () => open(x),
    };
    const order: ActionEntry[] = ordered
      ? [
          {
            id: 'up',
            label: t('pdicts.action.up'),
            icon: 'up',
            disabled: x.n === 1,
            run: () => void move(x, -1),
          },
          {
            id: 'down',
            label: t('pdicts.action.down'),
            icon: 'dn',
            disabled: x.n === count,
            run: () => void move(x, 1),
          },
        ]
      : [];
    return [
      edit,
      ...order,
      { id: 'sep', separator: true },
      x.active
        ? {
            id: 'off',
            label: t('pdicts.action.off'),
            icon: 'ban',
            sub: t(OFF_SUB[dict] ?? 'pdicts.action.off_sub'),
            ...(x.code === fixed
              ? { disabled: true, reason: t('pdicts.action.off_fixed_phone') }
              : {}),
            run: () => void setActive(x, false),
          }
        : {
            id: 'on',
            label: t('pdicts.action.on'),
            icon: 'check',
            run: () => void setActive(x, true),
          },
      // Коды стран не удаляются — только отключаются (прототип).
      ...(undeletable
        ? []
        : [
            {
              id: 'delete',
              label: t('pdicts.action.delete'),
              icon: 'trash',
              danger: true,
              disabled: x.used > 0,
              ...(x.used > 0 ? { reason: usedReason(dict, x, t) } : {}),
              run: () => setAskDelete(x),
            } satisfies ActionEntry,
          ]),
    ];
  };
  const note = NOTES[dict];

  return (
    <div className="flex flex-col gap-3.5">
      {note ? <Note icon="info">{t(note)}</Note> : null}
      <DataGrid
        columns={columns}
        audit={AUDIT}
        defaultVisible={defaultVisible}
        defaultSort={defaultSort}
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
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="book" title={t('grid.empty')} />}
        rowKey={(x) => x.code}
        titleKey="name"
        label={t(`pdicts.title.${dict}`)}
        labels={labels}
        rowTone={(x) => (x.active ? undefined : 'muted')}
        actions={actions}
        onOpen={(x) => open(x)}
        {...(TABLE_ONLY.has(dict) ? { fixedView: 'table' as const } : {})}
      />
      <DictHistory dict={dict} />
      {/* Прототип: у кодов стран пояснение — под списком и историей. */}
      {dict === 'phones' ? <Note icon="info">{t('pdicts.note.phones')}</Note> : null}
      {edit ? (
        <ValueDialog
          key={`edit-${edit.n}`}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          dict={dict}
          item={edit.data}
          onDone={() => refresh(dict)}
        />
      ) : null}
      <ConfirmDialog
        open={askDelete !== null}
        onClose={() => setAskDelete(null)}
        title={t('pdicts.delete.title', { name: askDelete ? ugnsName(dict, askDelete) : '' })}
        text={t(DELETE_TEXT[dict] ?? 'pdicts.delete.text')}
        ok={t('pdicts.action.delete')}
        danger
        onConfirm={() => askDelete && void remove(askDelete)}
      />
    </div>
  );
}
