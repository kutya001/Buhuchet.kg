'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  bishkekDate,
  formatDateRu,
  formatMomentRu,
  type DictRequestStatus,
  type ListSort,
  type StatusTone,
} from '@buhuchet/domain';
import {
  DictRequestAnswerForm,
  type AdminDictRequest,
  type DictRequestAnswerFormInput,
} from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Field,
  inputClass,
  KeyValues,
  Modal,
  StatusPill,
  useToast,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
  type IconName,
} from '@buhuchet/ui';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { fetchDictRequests, fetchDictRequestValues, usePdictsRefresh } from './pdicts-data';

const requests = api.api.admin['dict-requests'];

/** Сначала новые запросы (прототип v59: `sort: {key: 'at', dir: -1}`). */
const DEFAULT_SORT: ListSort = { key: 'at', dir: 'desc' };

const DEFAULT_VISIBLE = ['at', 'org', 'dict', 'what', 'comment', 'by', 'status', 'answer'];

/** Метка статуса — как в «Моих запросах» организации (прототип REQ_ST). */
const STATUS_LOOK: Record<DictRequestStatus, { tone: StatusTone; icon: IconName }> = {
  new: { tone: 'yellow', icon: 'circle' },
  added: { tone: 'green', icon: 'check' },
  rejected: { tone: 'faint', icon: 'ban' },
};

const dateOf = (r: AdminDictRequest) => formatDateRu(bishkekDate(new Date(r.audit.createdAt)));
const dictOf = (t: Translate, r: AdminDictRequest) => t(`dicts.platform.dict.${r.dict}`);
const dash = <span className="text-faint">—</span>;

function statusPill(t: Translate, r: AdminDictRequest) {
  return (
    <StatusPill {...STATUS_LOOK[r.status]} label={t(`dicts.req.status.${r.status}`)} size="sm" />
  );
}

/** Столбцы «Запросов» — как в прототипе v59 (renderPDicts0 и reqCols); ключи — как на сервере. */
export function requestColumns(t: Translate): GridColumn<AdminDictRequest>[] {
  return [
    { key: 'at', label: t('pdicts.req.col.at'), type: 'date', width: 110, text: dateOf },
    {
      key: 'org',
      label: t('pdicts.req.col.org'),
      type: 'enum',
      width: 240,
      text: (r) => r.orgName,
    },
    {
      key: 'dict',
      label: t('pdicts.req.col.dict'),
      type: 'enum',
      width: 150,
      text: (r) => dictOf(t, r),
    },
    {
      key: 'what',
      label: t('pdicts.req.col.what'),
      type: 'text',
      width: 180,
      text: (r) => r.what,
      cell: (r) => <span className="font-semibold">{r.what}</span>,
    },
    {
      key: 'comment',
      label: t('pdicts.req.col.comment'),
      type: 'text',
      width: 150,
      text: (r) => r.comment,
      cell: (r) => r.comment || dash,
    },
    {
      key: 'by',
      label: t('pdicts.req.col.by'),
      type: 'enum',
      width: 120,
      text: (r) => r.audit.createdBy ?? '',
    },
    {
      key: 'status',
      label: t('pdicts.req.col.status'),
      type: 'enum',
      width: 125,
      text: (r) => t(`dicts.req.status.${r.status}`),
      cell: (r) => statusPill(t, r),
    },
    {
      key: 'answer',
      label: t('pdicts.req.col.answer'),
      type: 'text',
      width: 210,
      text: (r) => r.answer,
      cell: (r) => r.answer || dash,
    },
  ];
}

const moment = (iso: string) => formatMomentRu(new Date(iso));

/** «Изменил» — кто ответил; до ответа — кто отправил. */
const AUDIT: GridAudit<AdminDictRequest> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => moment(r.audit.createdAt),
  updatedAt: (r) => moment(r.audit.updatedAt),
};

type Answer = { request: AdminDictRequest; status: 'added' | 'rejected' };

/**
 * Ответ на запрос (прототип v59 reqAnswerDlg): «Запрос выполнен» или «Отклонить запрос», «Ответ
 * организации» — при отказе обязателен. Организация видит статус и ответ в «Мои запросы».
 */
function AnswerDialog({
  open,
  onClose,
  answer,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  answer: Answer;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const { request: r, status } = answer;
  const no = status === 'rejected';
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<DictRequestAnswerFormInput>({
    resolver: zodResolver(DictRequestAnswerForm),
    defaultValues: { answer: r.answer },
  });

  const submit = (event: FormEvent) =>
    void handleSubmit(async ({ answer: text }) => {
      if (no && !text) {
        const message = t('pdicts.req.answer.required');
        return setError('answer', { type: 'server', message }, { shouldFocus: true });
      }
      const res = await callApi(() =>
        requests[':id'].answer.$post({
          param: { id: r.id },
          json: { status, answer: text, version: r.version },
        }),
      );
      onDone();
      if (!res.ok) return toast(errorText(res.error), { bad: true });
      onClose();
      toast(t('pdicts.req.answer.done'), { icon: no ? 'ban' : 'check' });
    })(event);
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(no ? 'pdicts.req.answer.title_rejected' : 'pdicts.req.answer.title_added')}
      sub={`${r.orgName} · ${r.what}`}
      dirty={isDirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass(no ? 'danger' : 'cta')}
            disabled={isSubmitting}
          >
            {t(no ? 'pdicts.req.answer.ok_rejected' : 'pdicts.req.answer.ok_added')}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Field
          id={`${id}-answer`}
          label={t('pdicts.req.answer.field')}
          required={no}
          hint={t(no ? 'pdicts.req.answer.hint_rejected' : 'pdicts.req.answer.hint_added')}
          error={fieldError(t, errors.answer)}
          full
        >
          {(c) => (
            <textarea
              {...c}
              {...register('answer')}
              className={`${inputClass({ multiline: true })} min-h-[80px]`}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Запрос целиком, только просмотр (прототип v59 reqViewDlg): длинный комментарий и ответ видны полностью. */
function RequestView({
  open,
  onClose,
  request: r,
}: {
  open: boolean;
  onClose: () => void;
  request: AdminDictRequest;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      title={r.what}
      sub={t('pdicts.req.view.sub', { org: r.orgName, dict: dictOf(t, r), date: dateOf(r) })}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <KeyValues
        items={[
          { id: 'status', label: t('pdicts.req.col.status'), value: statusPill(t, r) },
          { id: 'by', label: t('pdicts.req.col.by'), value: r.audit.createdBy ?? '' },
          {
            id: 'comment',
            label: t('pdicts.req.col.comment'),
            value: r.comment || '—',
            wide: true,
          },
          {
            id: 'answer',
            label: t('pdicts.req.col.answer'),
            value: r.answer || t('pdicts.req.view.no_answer'),
            wide: true,
          },
        ]}
      />
    </Modal>
  );
}

/**
 * Админка → «Справочники платформы» → «Запросы» (прототип v59 renderPDicts0; решение заказчика по
 * docs/deviations.md п. 46): запросы «Попросить добавить» всех организаций, сначала новые; поиск,
 * фильтры, группировка и «В Excel». Строка открывает запрос целиком; «Добавлено» и «Отклонить»
 * открывают окно ответа организации.
 */
export function RequestsList() {
  const t = useT();
  const refresh = usePdictsRefresh();
  const labels = useGridLabels('pdicts.req.count');
  const columns = useMemo(() => requestColumns(t), [t]);
  const view = useViewSettings('pdicts.requests');
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: 'pdicts.requests',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchDictRequests,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => requests.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [answer, setAnswer] = useState<DialogSlot<Answer> | null>(null);
  const [viewing, setViewing] = useState<DialogSlot<AdminDictRequest> | null>(null);
  const actions = (r: AdminDictRequest): ActionEntry[] => [
    {
      id: 'added',
      label: t('pdicts.req.action.added'),
      icon: 'check',
      run: () => setAnswer(openSlot<Answer>({ request: r, status: 'added' })),
    },
    {
      id: 'rejected',
      label: t('pdicts.req.action.rejected'),
      icon: 'ban',
      run: () => setAnswer(openSlot<Answer>({ request: r, status: 'rejected' })),
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <DataGrid
        columns={columns}
        audit={AUDIT}
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
        loadValues={fetchDictRequestValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="send" title={t('pdicts.req.empty')} />}
        rowKey={(r) => r.id}
        titleKey="what"
        label={t('tab.pdicts.requests')}
        labels={labels}
        actions={actions}
        onOpen={(r) => setViewing(openSlot(r))}
      />
      {answer ? (
        <AnswerDialog
          key={`answer-${answer.n}`}
          open={answer.open}
          onClose={() => setAnswer(closeSlot)}
          answer={answer.data}
          onDone={() => refresh('requests')}
        />
      ) : null}
      {viewing ? (
        <RequestView
          key={`view-${viewing.n}`}
          open={viewing.open}
          onClose={() => setViewing(closeSlot)}
          request={viewing.data}
        />
      ) : null}
    </div>
  );
}
