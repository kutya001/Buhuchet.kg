'use client';

import { ASSIGNMENT_DUE_DAYS, pluralForm } from '@buhuchet/domain';
import { AssignmentPreview, REPORT_NOTE_MAX, type Assignment } from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  inputClass,
  Modal,
  Note,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { formOptionsQuery, useContractorsRefresh } from './contractor-data';

/** «2026-09-01» → «2026-09» (поле месяца) и обратно. */
const monthInput = (d: string | null) => (d ? d.slice(0, 7) : '');
const monthDate = (m: string) => (m ? `${m}-01` : null);

/**
 * «Изменить назначение» в блоке «Сдаёт отчёты» карточки (прототип modules/contractors.js, asgDlg): «С
 * какого периода», «До какого периода» (пусто — бессрочно), ответственный за этот вид (пусто —
 * ответственный контрагента), «Вариант срока» (у вида с месячной или квартальной сдачей) и примечание.
 * Начало в прошлом — предупреждение, за какие прошлые периоды создадутся отчёты (считает сервер), и
 * «Сразу отметить прошлые периоды сданными». Ставки и повторяющуюся сумму меняет окно «Ставки».
 */
export function AssignmentDialog({
  assignment: a,
  contractor,
  open,
  onClose,
}: {
  assignment: Assignment;
  contractor: { id: string; responsible: string | null };
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const { access } = useShell();
  const id = useId();
  const options = useQuery(formOptionsQuery);
  const [from, setFrom] = useState(monthInput(a.fromMonth));
  const [until, setUntil] = useState(monthInput(a.untilMonth));
  const [resp, setResp] = useState(a.responsibleEmployeeId ?? '');
  const [due, setDue] = useState(a.dueDay === null ? '' : String(a.dueDay));
  const [note, setNote] = useState(a.note);
  const [mark, setMark] = useState(true);
  const [error, setError] = useState<{ field: 'from' | 'until' | 'form'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const periodic = !a.oneOff && a.typeActive;
  const dueShown = periodic && a.period !== 'Y';
  const preview = useQuery({
    queryKey: ['assignments', 'preview', a.contractorId, a.reportTypeCode, from, a.dueDay],
    enabled: periodic && /^\d{4}-\d{2}$/.test(from) && access.can('assign'),
    queryFn: async () => {
      const res = await api.api.assignments.preview.$post({
        json: {
          contractorId: a.contractorId,
          reportTypeCode: a.reportTypeCode,
          fromMonth: monthDate(from),
          untilMonth: a.untilMonth,
          dueDay: a.dueDay,
          ownPeriod: a.ownPeriod,
          ownDay: a.ownDay,
          ownMonth: a.ownMonth,
        },
      });
      if (!res.ok) throw await apiFailure(res);
      return AssignmentPreview.parse(await res.json());
    },
  });
  const missing = preview.data?.missing ?? [];
  const patch = {
    ...(monthDate(from) !== a.fromMonth && from ? { fromMonth: monthDate(from)! } : {}),
    ...(monthDate(until) !== a.untilMonth ? { untilMonth: monthDate(until) } : {}),
    ...((resp || null) !== a.responsibleEmployeeId ? { responsibleEmployeeId: resp || null } : {}),
    ...((due ? Number(due) : null) !== a.dueDay ? { dueDay: due ? Number(due) : null } : {}),
    ...(note !== a.note ? { note } : {}),
  };
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    if (!from) return setError({ field: 'from', text: t('svc.month_required') });
    if (until && until < from) return setError({ field: 'until', text: t('cp.asg.until_before') });
    if (!dirty) {
      onClose();
      return toast(t('cp.asg.unchanged'), { icon: 'info' });
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api.assignments[':id'].$patch({
        param: { id: a.id },
        json: { ...patch, markPast: mark, version: a.version },
      }),
    );
    setBusy(false);
    if (!res.ok) return setError({ field: 'form', text: errorText(res.error) });
    refresh();
    onClose();
    toast(t('cp.asg.saved'), { icon: 'check' });
  };

  const employees = options.data?.employees ?? [];
  const respName = employees.find((e) => e.id === contractor.responsible)?.shortName ?? '—';
  const dueDefault = a.dueStatus
    ? t('cp.asg.due_status', { name: a.dueStatus.name })
    : t('cp.asg.due_catalog');

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('cp.asg.title', { name: a.reportTypeShort })}
      sub={a.reportTypeName}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-asg-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-asg-dialog={a.reportTypeCode}>
        <FormGrid>
          <Field
            id={`${id}-from`}
            label={t('cp.asg.from')}
            required
            error={error?.field === 'from' ? error.text : undefined}
          >
            {(control) => (
              <input
                {...control}
                type="month"
                className={inputClass()}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setError(null);
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-until`}
            label={t('cp.asg.until')}
            hint={t('cp.asg.until_hint')}
            error={error?.field === 'until' ? error.text : undefined}
          >
            {(control) => (
              <input
                {...control}
                type="month"
                className={inputClass()}
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  setError(null);
                }}
              />
            )}
          </Field>
          <Field id={`${id}-resp`} label={t('cp.asg.resp')} hint={t('cp.asg.resp_hint')}>
            {(control) => (
              <select
                {...control}
                className={`${inputClass()} cursor-pointer`}
                value={resp}
                onChange={(e) => setResp(e.target.value)}
              >
                <option value="">{t('cp.asg.resp_default', { name: respName })}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.shortName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {dueShown ? (
            <Field id={`${id}-due`} label={t('cp.asg.due')} hint={t('cp.asg.due_hint')} full>
              {(control) => (
                <select
                  {...control}
                  className={`${inputClass()} cursor-pointer`}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                >
                  <option value="">{dueDefault}</option>
                  {ASSIGNMENT_DUE_DAYS.map((d) => (
                    <option key={d} value={String(d)}>
                      {d >= 31 ? t('cp.asg.due_last') : t('cp.asg.due_day', { n: d })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          <Field id={`${id}-note`} label={t('cp.asg.note')} full>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                value={note}
                maxLength={REPORT_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        {missing.length ? (
          <>
            <Note tone="warn" icon="history">
              {t(`cp.asg.missing.${pluralForm(missing.length)}`, {
                n: missing.length,
                list: missing.map((m) => m.label).join(', '),
              })}
            </Note>
            <CheckRow
              checked={mark}
              onChange={setMark}
              data-asg-mark=""
              plain
              label={t(access.reportConfirm ? 'cp.asg.mark_confirm' : 'cp.asg.mark')}
            />
          </>
        ) : null}
        {error?.field === 'form' ? <Note tone="bad">{error.text}</Note> : null}
      </div>
    </Modal>
  );
}
