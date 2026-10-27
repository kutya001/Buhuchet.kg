'use client';

import { formatDateRu, formatMomentRu, monthText } from '@buhuchet/domain';
import { KpiValuesSaved, type KpiEntry } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Field,
  FormGrid,
  Hint,
  inputClass,
  MiniTable,
  Modal,
  Note,
  RecordChangedNotice,
  RollbackDialog,
  StatusHistory,
  StatusPill,
  StatusScale,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import { api, ApiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { RecordFiles } from '../files/record-files';
import { useErrorText, useT } from '../l10n/provider';
import {
  historyLabels,
  historyView,
  rollbackLabels,
  rollbackTitle,
  scaleView,
  statusEvents,
} from '../status/status-view';
import { entryQuery, useKpiRefresh } from './kpi-data';
import { monthName, numberText, parseCell, unitText, valueText } from './kpi-format';
import { InfoTip } from './kpi-table';

/*
 * Окно «контрагент × месяц» (задача 2.27; ТЗ «Значение показателя»; прототип modules/kpi.js, kEditDlg):
 * все показатели контрагента за месяц, комментарий и файлы к значению, шкала «Заполнение месяца» с
 * «Проверено» и откатом, история значений и статусов. Открывают плитка «Ввода за месяц» на телефоне,
 * ячейка «За период» и строка «Не заполнено».
 */

export function useKpiEntry() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [slot, setSlot] = useState<DialogSlot<{ contractorId: string; month: string }> | null>(
    null,
  );

  // Данные загружаются до открытия: поля сразу на месте и фокус — в первом.
  const open = useCallback(
    async (contractorId: string, month: string) => {
      try {
        await client.fetchQuery({ ...entryQuery(contractorId, month), staleTime: 0 });
        setSlot(openSlot({ contractorId, month }));
      } catch (e) {
        toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true });
      }
    },
    [client, toast, errorText, t],
  );

  const dialog = slot ? (
    <EntryDialog
      key={`kpi-entry-${slot.n}`}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
      contractorId={slot.data.contractorId}
      month={slot.data.month}
    />
  ) : null;
  return { open, dialog };
}

type Draft = Record<string, { value: string; note: string }>;

const draftOf = (data: KpiEntry): Draft =>
  Object.fromEntries(
    data.items.map((i) => [
      i.indicator.id,
      { value: numberText(i.indicator.type, i.value), note: i.note },
    ]),
  );

function EntryDialog({
  open,
  onClose,
  contractorId,
  month,
}: {
  open: boolean;
  onClose: () => void;
  contractorId: string;
  month: string;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useKpiRefresh();
  const id = useId();
  const client = useQueryClient();
  const query = useQuery(entryQuery(contractorId, month));
  const data = query.data!;
  /** Значения, с которых начата правка: с ними сервер сверит, не изменил ли их другой. */
  const [base, setBase] = useState(data);
  const start = useMemo(() => draftOf(base), [base]);
  const [draft, setDraft] = useState(start);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [askCheck, setAskCheck] = useState(false);
  const [back, setBack] = useState<{ to: string; open: boolean } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const formId = `${id}-form`;
  const recordName = `${data.contractor.name} · ${monthName(t, month)}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    const values: {
      contractorId: string;
      indicatorId: string;
      month: string;
      value: number | null;
      note: string;
      prev: number | null;
      prevNote: string;
    }[] = [];
    for (const item of base.items) {
      if (item.indicator.archived) continue;
      const d = draft[item.indicator.id]!;
      const value = parseCell(item.indicator.type, d.value);
      if (value === undefined) {
        found[item.indicator.id] = t('err.value_invalid');
        continue;
      }
      // Пусто и строки значения нет — нечего сохранять (прототип: `v==null && !kVal`).
      if (value === null && item.valueId === null) continue;
      if (value !== item.value || d.note.trim() !== item.note) {
        values.push({
          contractorId,
          indicatorId: item.indicator.id,
          month,
          value,
          note: d.note.trim(),
          prev: item.value,
          prevNote: item.note,
        });
      }
    }
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) return document.getElementById(`${id}-v-${first}`)?.focus();
    if (values.length === 0) {
      onClose();
      return toast(t('kpi.entry.no_changes'));
    }
    setBusy(true);
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values } }));
    setBusy(false);
    void refresh();
    if (!res.ok && res.error.code === 'record_changed') return setChanged(true);
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    onClose();
    toast(t('kpi.entry.saved', { n: KpiValuesSaved.parse(res.data).changed }), { icon: 'check' });
  };

  /** «Запись изменена другим пользователем» → «Перечитать»: значения с сервера, своя правка сброшена. */
  const reload = async () => {
    setReloading(true);
    try {
      const fresh = await client.fetchQuery({ ...entryQuery(contractorId, month), staleTime: 0 });
      setBase(fresh);
      setDraft(draftOf(fresh));
      setErrors({});
      setChanged(false);
    } catch (e) {
      toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true });
    } finally {
      setReloading(false);
    }
  };

  const check = async () => {
    if (!data.status) return;
    const res = await callApi(() =>
      api.api.kpi.months.check.$post({
        json: { contractorId, month, version: data.status!.version },
      }),
    );
    void refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('kpi.check.done'), { icon: 'check' });
  };

  const rollback = async (to: string, reason: string) => {
    if (!data.status) return;
    const res = await callApi(() =>
      api.api.kpi.months.rollback.$post({
        json: {
          contractorId,
          month,
          version: data.status!.version,
          to: to as 'empty' | 'filled',
          reason,
        },
      }),
    );
    void refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    setBack((b) => b && { ...b, open: false });
    toast(t('status.rollback_done'), { icon: 'history' });
  };

  const needed = data.status !== null || data.items.some((i) => i.state === 'required');
  const history = statusEvents(data.statusHistory);
  const scale = needed
    ? scaleView(t, {
        scale: 'indicator',
        status: data.status?.code ?? 'empty',
        history,
        next: data.canCheck ? ['checked'] : [],
        back: data.status ? data.back : null,
      })
    : null;
  const names = new Map(data.items.map((i) => [i.indicator.id, i.indicator]));
  const statusHistory = data.status ? historyView(t, 'indicator', history, new Date()) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={data.contractor.name}
      sub={t('kpi.entry.sub', { month: monthName(t, month), due: formatDateRu(data.due) })}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t(data.editable ? 'btn.cancel' : 'btn.close')}
          </button>
          {data.editable ? (
            <button
              type="submit"
              form={formId}
              className={buttonClass('cta')}
              disabled={busy || changed}
            >
              {t('btn.save')}
            </button>
          ) : null}
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form
        id={formId}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-3.5"
        data-kpi-entry={`${contractorId}|${month}`}
      >
        {scale ? (
          <Box>
            {scale.kind === 'scale' ? (
              <StatusScale
                {...scale.props}
                onStep={() => setAskCheck(true)}
                onBack={(to) => setBack({ to, open: true })}
              />
            ) : scale.kind === 'pill' ? (
              <StatusPill {...scale.pill} />
            ) : null}
          </Box>
        ) : null}
        <Note>
          {t('kpi.entry.note')}
          {data.editable ? '' : ` ${t('kpi.entry.readonly')}`}
        </Note>
        {base.items.length === 0 ? (
          <Note icon="gauge">{t('kpi.entry.none')}</Note>
        ) : (
          base.items.map((item) => {
            const col = item.indicator;
            const readOnly = !data.editable || col.archived;
            const d = draft[col.id]!;
            return (
              <Box key={col.id}>
                <div className="flex flex-wrap items-center gap-1.5" data-kpi-item={col.id}>
                  <b>{col.name}</b>
                  {col.description ? (
                    <InfoTip
                      label={t('kpi.desc_label', { name: col.name })}
                      text={col.description}
                    />
                  ) : null}
                  {col.required ? null : <Tag>{t('kpi.optional')}</Tag>}
                  {item.state === 'early' ? (
                    <Tag title={t('kpi.early_title', { from: monthText(item.start) })}>
                      {t('kpi.early_tag', { from: monthText(item.start) })}
                    </Tag>
                  ) : null}
                  {col.archived ? <Tag>{t('kpi.archived_tag')}</Tag> : null}
                  <span className="flex-1" />
                  {item.updatedAt ? (
                    <Hint>
                      {t('kpi.entry.changed', {
                        who: item.updatedBy ?? t('status.system'),
                        at: formatMomentRu(new Date(item.updatedAt)),
                      })}
                    </Hint>
                  ) : null}
                </div>
                <FormGrid className="mt-2">
                  <Field
                    id={`${id}-v-${col.id}`}
                    label={t('kpi.entry.value', { unit: unitText(t, col).toLowerCase() })}
                    error={errors[col.id]}
                  >
                    {(control) => (
                      <input
                        {...control}
                        className={`${inputClass()} tabular-nums`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={t('kpi.entry.empty')}
                        readOnly={readOnly}
                        value={d.value}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDraft((x) => ({ ...x, [col.id]: { ...x[col.id]!, value } }));
                          setErrors((x) => ({ ...x, [col.id]: '' }));
                        }}
                      />
                    )}
                  </Field>
                  <Field id={`${id}-n-${col.id}`} label={t('kpi.entry.comment')}>
                    {(control) => (
                      <input
                        {...control}
                        className={inputClass()}
                        autoComplete="off"
                        maxLength={500}
                        placeholder={t('kpi.entry.comment_hint')}
                        readOnly={readOnly}
                        value={d.note}
                        onChange={(e) => {
                          const note = e.target.value;
                          setDraft((x) => ({ ...x, [col.id]: { ...x[col.id]!, note } }));
                        }}
                      />
                    )}
                  </Field>
                </FormGrid>
                {data.files && item.valueId ? (
                  <div className="mt-2">
                    <RecordFiles source={{ kind: 'indicator_value', id: item.valueId }} />
                  </div>
                ) : data.files && !readOnly ? (
                  <Hint>{t('kpi.entry.files_after_save')}</Hint>
                ) : null}
              </Box>
            );
          })
        )}
        {data.history.length > 0 ? (
          <Box title={t('kpi.entry.history')}>
            <MiniTable
              label={t('kpi.entry.history')}
              empty=""
              columns={[
                { key: 'at', label: t('kpi.col.when') },
                { key: 'ind', label: t('kpi.col.indicator') },
                { key: 'from', label: t('kpi.col.was') },
                { key: 'to', label: t('kpi.col.became') },
                { key: 'who', label: t('kpi.col.who') },
              ]}
              rows={data.history.map((h, n) => {
                const col = names.get(h.indicatorId);
                const text = (v: number | null) =>
                  v === null || !col ? t('kpi.empty') : valueText(col, v);
                return {
                  key: String(n),
                  cells: {
                    at: formatMomentRu(new Date(h.at)),
                    ind: col?.name ?? '',
                    from: <span className="text-faint">{text(h.from)}</span>,
                    to: (
                      <span>
                        {text(h.to)}
                        {h.reason === 'xlsx' ? (
                          <>
                            {' '}
                            <Tag>{t('kpi.from_excel')}</Tag>
                          </>
                        ) : null}
                      </span>
                    ),
                    who: h.actor ?? t('status.system'),
                  },
                };
              })}
            />
          </Box>
        ) : null}
        {statusHistory ? (
          <section className="flex min-w-0 flex-col">
            <h3 className="mt-0 mb-2 text-[13px] font-semibold text-muted">
              {t('status.history')}
            </h3>
            <StatusHistory
              rows={statusHistory.rows}
              totals={statusHistory.totals}
              labels={historyLabels(t)}
            />
          </section>
        ) : null}
      </form>
      <ConfirmDialog
        open={askCheck}
        onClose={() => setAskCheck(false)}
        title={t('kpi.check.title')}
        text={t('kpi.check.text', { name: recordName })}
        ok={t('kpi.check.ok')}
        onConfirm={() => void check()}
      />
      {back && data.status ? (
        <RollbackDialog
          open={back.open}
          onClose={() => setBack({ ...back, open: false })}
          title={rollbackTitle(t, 'indicator', data.status.code, back.to)}
          sub={recordName}
          consequences={t('status.rollback_effect.indicator')}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => void rollback(back.to, reason)}
        />
      ) : null}
    </Modal>
  );
}
