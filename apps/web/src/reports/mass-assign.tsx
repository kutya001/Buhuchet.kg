'use client';

import { pluralForm } from '@buhuchet/domain';
import { AssignmentBulkResult, type AssignmentMassOptions } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  inputClass,
  linkButtonClass,
  Modal,
  Note,
  Pill,
  useToast,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { massAssignQuery, useReportsRefresh } from './reports-data';

const ROW =
  'flex cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px] hover:bg-row-hover';
const BOX = 'm-0 h-4 w-4 flex-none cursor-pointer accent-accent';

/**
 * «+ Добавить» → «Назначить отчёты массово» (ТЗ «Назначение отчётов контрагентам» → «Массово: «НДС
 * сдают вот эти компании»»; прототип modules/contractors.js, `massAssignDlg`): данные окна — до
 * открытия, поля сразу на месте.
 */
export function useMassAssign(): { open: () => void; dialog: ReactNode } {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const [slot, setSlot] = useState<DialogSlot<AssignmentMassOptions> | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    if (loading) return;
    setLoading(true);
    const data = await client
      .fetchQuery({ ...massAssignQuery(null), staleTime: 0 })
      .catch(() => null);
    setLoading(false);
    if (!data) return void toast(t('err.unknown'), { bad: true });
    setSlot(openSlot(data));
  };

  const dialog = slot ? (
    <MassAssignDialog
      key={`mass-${slot.n}`}
      initial={slot.data}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
    />
  ) : null;
  return { open: () => void open(), dialog };
}

/**
 * Окно «Назначить отчёт нескольким контрагентам»: вид (по умолчанию НДС), «Ставка для отмеченных» у
 * вида с несколькими ставками, у единого налога — пояснение о ставке по ГКЭД; срок вида, «Отметить все
 * подходящие» и контрагенты в области: уже сдающие и неподходящие не отмечаются, подходящие по ГКЭД —
 * с меткой. «Назначить» — одним сохранением; с какого периода — первый, за который сегодня должен быть
 * отчёт.
 */
function MassAssignDialog({
  initial,
  open,
  onClose,
}: {
  initial: AssignmentMassOptions;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useReportsRefresh();
  const id = useId();
  const [code, setCode] = useState<string | null>(initial.type?.code ?? null);
  const [sel, setSel] = useState<ReadonlySet<string>>(() => new Set());
  const [rate, setRate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    ...massAssignQuery(code),
    ...(code === (initial.type?.code ?? null) ? { initialData: initial } : {}),
    placeholderData: keepPreviousData,
  });
  const data = query.data ?? initial;
  const type = data.type;
  // Пока список нового вида не пришёл, прежний виден, но отмечать в нём нельзя.
  const stale = query.isPlaceholderData || (type?.code ?? null) !== code;

  if (!type) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        title={t('report.mass.title')}
        footer={
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('default')} onClick={onClose}>
              {t('report.mass.close')}
            </button>
          </>
        }
      >
        <Note>{t('report.mass.no_types')}</Note>
      </Modal>
    );
  }

  const fits = data.contractors.filter((c) => !c.assigned && !c.why);
  const chosenRate = type.rates.length > 1 ? (rate ?? type.defaultRate) : null;
  const toggle = (cpId: string, on: boolean) =>
    setSel((s) => {
      const next = new Set(s);
      if (on) next.add(cpId);
      else next.delete(cpId);
      return next;
    });

  const save = async () => {
    if (!sel.size || busy) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.assignments.bulk.$post({
        json: {
          reportTypeCode: type.code,
          contractorIds: [...sel],
          rate: type.singleTax ? null : (chosenRate ?? type.defaultRate),
        },
      }),
    );
    setBusy(false);
    refresh();
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    const result = AssignmentBulkResult.parse(res.data);
    onClose();
    const text = t(`report.mass.done.${pluralForm(result.done)}`, {
      type: type.shortName,
      n: result.done,
    });
    toast(result.skipped ? t('report.mass.skipped', { text, n: result.skipped }) : text, {
      icon: 'matrix',
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      dirty={sel.size > 0}
      title={t('report.mass.title')}
      sub={t('report.mass.sub')}
      footer={
        <>
          <span className="text-muted" data-mass-selected="">
            {t('report.mass.selected', { n: sel.size })}
          </span>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-mass-ok=""
            className={buttonClass('cta')}
            disabled={!sel.size || busy || stale}
            onClick={() => void save()}
          >
            {t('report.mass.ok')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id={`${id}-type`} label={t('report.mass.type')}>
          {(control) => (
            <select
              {...control}
              data-mass-type=""
              className={`${inputClass()} cursor-pointer`}
              value={code ?? ''}
              onChange={(e) => {
                setCode(e.target.value);
                setSel(new Set());
                setRate(null);
              }}
            >
              {data.types.map((x) => (
                <option key={x.code} value={x.code}>
                  {t('report.mass.type_option', { name: x.name, organ: x.organ })}
                </option>
              ))}
            </select>
          )}
        </Field>
        {type.singleTax ? (
          <Note>{t('report.mass.single_tax')}</Note>
        ) : type.rates.length > 1 ? (
          <Field id={`${id}-rate`} label={t('report.mass.rate')} hint={t('report.mass.rate_hint')}>
            {(control) => (
              <select
                {...control}
                data-mass-rate=""
                className={`${inputClass()} cursor-pointer`}
                value={chosenRate ?? ''}
                onChange={(e) => setRate(e.target.value)}
              >
                {type.rates.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">
            {type.rates.length === 1
              ? t('report.mass.due_rate', { rule: type.dueText, rate: type.rates[0]! })
              : t('report.mass.due', { rule: type.dueText })}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            data-mass-all=""
            className={linkButtonClass()}
            disabled={stale}
            onClick={() => setSel(new Set(fits.map((c) => c.id)))}
          >
            {t('report.mass.all')}
          </button>
        </div>
        <div
          data-mass-list=""
          aria-busy={stale}
          className={`flex max-h-[340px] flex-col overflow-auto rounded-lg border border-line p-1 ${stale ? 'opacity-60' : ''}`}
        >
          {data.contractors.map((c) => {
            const off = c.assigned || !!c.why;
            return (
              <label
                key={c.id}
                data-mass-cp={c.id}
                title={c.why ?? undefined}
                className={`${ROW} ${c.why ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  className={BOX}
                  checked={c.assigned || sel.has(c.id)}
                  disabled={off || stale}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
                <span className="min-w-0">{c.name}</span>
                <span className="ml-auto text-[11px] text-faint tabular-nums">
                  {c.assigned
                    ? t('report.mass.has')
                    : (c.why ??
                      [c.regime, type.singleTax ? c.singleTaxRate : null]
                        .filter(Boolean)
                        .join(' · '))}
                </span>
                {!off && c.gkedFit ? (
                  <Pill tone="ok" size="sm">
                    {t('report.mass.gked_fit')}
                  </Pill>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
