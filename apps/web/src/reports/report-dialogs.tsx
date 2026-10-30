'use client';

import { addDays, bishkekDate, formatDateRu } from '@buhuchet/domain';
import {
  isRecordChanged,
  REPORT_NOTE_MAX,
  ReportCard,
  ManualReportSaved,
  ReportSaved,
  type DueChangeReason,
  type ManualReportOptions,
  type ReportRow,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

/** Нижняя строка окна: «Отмена» и кнопка действия. */
function Footer({
  t,
  onClose,
  label,
  busy,
  onOk,
}: {
  t: Translate;
  onClose: () => void;
  label: string;
  busy: boolean;
  onOk: () => void;
}) {
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        data-report-ok=""
        className={buttonClass('cta')}
        disabled={busy}
        onClick={onOk}
      >
        {label}
      </button>
    </>
  );
}

function Select({
  control,
  value,
  options,
  onChange,
}: {
  control: object;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      {...control}
      className={`${inputClass()} cursor-pointer`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * «Изменить срок сдачи» (ТЗ «Изменить срок»; прототип modules/contractors.js, `dueEditDlg`): новый
 * срок (под полем — нынешний и по закону), причина из справочника платформы «Причины изменения срока
 * отчёта», комментарий. Тот же срок — окно просто закрывается. Запись изменил другой — предупреждение и
 * «Перечитать».
 */
export function DueChangeDialog({
  report: initial,
  reasons,
  open,
  onClose,
  onDone,
}: {
  report: ReportRow;
  reasons: readonly DueChangeReason[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [report, setReport] = useState(initial);
  const [due, setDue] = useState(initial.dueDate);
  const [reason, setReason] = useState(reasons[0]?.code ?? '');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{ due?: string; reasonCode?: string }>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);

  const reload = async () => {
    setReloading(true);
    const res = await callApi(() => api.api.reports[':id'].$get({ param: { id: report.id } }));
    setReloading(false);
    const fresh = res.ok ? ReportCard.safeParse(res.data) : null;
    if (!fresh?.success) return void toast(t('err.unknown'), { bad: true });
    setReport(fresh.data);
    setDue(fresh.data.dueDate);
    setChanged(false);
  };

  const save = async () => {
    if (!due) return setErrors({ due: t('report.due.required') });
    if (due === report.dueDate) return onClose();
    setBusy(true);
    const res = await callApi(() =>
      api.api.reports[':id'].due.$post({
        param: { id: report.id },
        json: { due, reasonCode: reason, comment, version: report.version },
      }),
    );
    setBusy(false);
    if (res.ok && ReportSaved.safeParse(res.data).success) {
      onDone();
      onClose();
      return void toast(t('report.due.done'), { icon: 'calendar' });
    }
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return setChanged(true);
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'due' || field === 'reasonCode') return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const now =
    report.dueBase !== report.dueDate
      ? t('report.due.now_law', {
          date: formatDateRu(report.dueDate),
          law: formatDateRu(report.dueBase),
        })
      : t('report.due.now', { date: formatDateRu(report.dueDate) });

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={due !== report.dueDate || comment !== '' || reason !== (reasons[0]?.code ?? '')}
      title={t('report.due.title')}
      sub={`${report.contractor.name} · ${report.type.shortName} ${report.periodLabel}`}
      footer={<Footer t={t} onClose={onClose} label={t('btn.save')} busy={busy} onOk={save} />}
    >
      <div className="flex flex-col gap-3.5">
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={() => void reload()}
            reloading={reloading}
          />
        ) : null}
        <FormGrid>
          <Field
            id={`${id}-due`}
            label={t('report.due.new')}
            required
            hint={now}
            error={errors.due}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                className={inputClass()}
                value={due}
                onChange={(e) => {
                  setDue(e.target.value);
                  setErrors((x) => ({ ...x, due: undefined }));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-reason`}
            label={t('report.due.reason')}
            required
            hint={t('report.due.reason_hint')}
            error={errors.reasonCode}
          >
            {(control) => (
              <Select
                control={control}
                value={reason}
                options={reasons.map((r) => ({ value: r.code, label: r.name }))}
                onChange={setReason}
              />
            )}
          </Field>
          <Field id={`${id}-comment`} label={t('report.due.comment')} full>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                maxLength={REPORT_NOTE_MAX}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

type ManualType = ManualReportOptions['types'][number];

/** Месяц `YYYY-MM` для поля «Месяц периода» — прошлый месяц от сегодня (прототип adhocDlg). */
function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Поля окна «Разовый отчёт» с ошибками сервера. */
type ManualField = 'contractorId' | 'reportTypeCode' | 'month' | 'eventDate' | 'due';

/**
 * «+ Добавить» → «Разовый отчёт» (ТЗ: пропущенный период или отчёт по запросу органа; прототип
 * modules/report-card.js, `adhocDlg`): контрагент, вид из подключённых и действующих (НДС по
 * умолчанию), месяц периода и срок сдачи, у разового вида — дата события, срок от неё по правилу вида
 * (его считает сервер, пока срок не трогали руками), причина из справочника («Другое» по умолчанию).
 * Такой отчёт уже есть — ошибка под месяцем или датой события.
 */
export function ManualReportDialog({
  options,
  reasons,
  open,
  onClose,
  onDone,
}: {
  options: ManualReportOptions;
  reasons: readonly DueChangeReason[];
  open: boolean;
  onClose: () => void;
  /** Отчёт создан: номер — открыть его карточку (прототип: `openReport(r)`). */
  onDone: (id: string | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const today = bishkekDate(new Date());
  const firstType =
    options.types.find((x) => x.code === 'nds')?.code ?? options.types[0]?.code ?? '';
  const otherReason =
    reasons.find((r) => r.name === t('report.manual.reason_default'))?.code ??
    reasons[0]?.code ??
    '';
  const [initial] = useState(() => ({
    cp: options.contractors[0]?.id ?? '',
    typeCode: firstType,
    month: previousMonth(today),
    event: today,
    due: addDays(today, 7),
    reason: otherReason,
  }));
  const [cp, setCp] = useState(initial.cp);
  const [typeCode, setTypeCode] = useState(initial.typeCode);
  const [month, setMonth] = useState(initial.month);
  const [event, setEvent] = useState(initial.event);
  const [due, setDue] = useState(initial.due);
  const [dueTouched, setDueTouched] = useState(false);
  const [reason, setReason] = useState(initial.reason);
  // Срок после переноса с нерабочего дня — для вида и даты, по которым посчитан (прототип `offTxt`).
  const [shift, setShift] = useState<{ key: string; date: string } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ManualField, string>>>({});
  const [busy, setBusy] = useState(false);
  const type: ManualType | undefined = options.types.find((x) => x.code === typeCode);
  const oneOff = !!type?.oneOff;

  /** Срок разового вида от даты события — с сервера, пока срок не меняли руками (прототип evDue). */
  const computeDue = async (code: string, date: string, contractorId: string) => {
    if (!contractorId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const res = await callApi(() =>
      api.api.reports['manual-due'].$get({
        query: { contractorId, reportTypeCode: code, eventDate: date },
      }),
    );
    const next = res.ok ? (res.data as { due?: string | null }).due : null;
    if (next) setDue(next);
  };

  // «21.11.2026 — нерабочий день: срок будет 23.11.2026» под сроком: перенос — по календарю сервера.
  const dueKey = `${typeCode}|${due}`;
  const shifted = shift?.key === dueKey && shift.date !== due ? shift.date : null;
  useEffect(() => {
    if (!typeCode || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return;
    let live = true;
    void callApi(() =>
      api.api.reports['due-shift'].$get({ query: { reportTypeCode: typeCode, date: due } }),
    ).then((res) => {
      const date = res.ok ? (res.data as { date?: string }).date : undefined;
      if (live && date) setShift({ key: `${typeCode}|${due}`, date });
    });
    return () => {
      live = false;
    };
  }, [typeCode, due]);

  const clear = (...fields: ManualField[]) =>
    setErrors((x) => ({ ...x, ...Object.fromEntries(fields.map((f) => [f, undefined])) }));

  const pickType = (code: string) => {
    setTypeCode(code);
    setDueTouched(false);
    clear('reportTypeCode', 'month', 'eventDate');
    if (options.types.find((x) => x.code === code)?.oneOff) void computeDue(code, event, cp);
  };

  const save = async () => {
    const next: Partial<Record<ManualField, string>> = {};
    if (!cp) next.contractorId = t('report.manual.no_cp');
    if (!type) next.reportTypeCode = t('report.manual.no_type');
    if (oneOff && !/^\d{4}-\d{2}-\d{2}$/.test(event))
      next.eventDate = t('report.manual.event_required');
    if (!oneOff && !/^\d{4}-\d{2}$/.test(month)) next.month = t('report.manual.month_required');
    if (!due) next.due = t('report.manual.due_required');
    setErrors(next);
    if (Object.keys(next).length || !type) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.reports.$post({
        json: {
          contractorId: cp,
          reportTypeCode: type.code,
          month: oneOff ? null : `${month}-01`,
          eventDate: oneOff ? event : null,
          due,
          reasonCode: reason,
        },
      }),
    );
    setBusy(false);
    if (res.ok) {
      const saved = ManualReportSaved.safeParse(res.data);
      onDone(saved.success ? saved.data.id : null);
      onClose();
      // Перенос — по сроку сохранённого отчёта: подсказка могла не успеть прийти.
      const moved = saved.success && saved.data.dueDate !== due ? saved.data.dueDate : null;
      return void toast(
        moved
          ? t('report.manual.done_shift', {
              date: formatDateRu(due),
              shifted: formatDateRu(moved),
            })
          : t('report.manual.done'),
        { icon: 'file' },
      );
    }
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (
      field === 'contractorId' ||
      field === 'reportTypeCode' ||
      field === 'month' ||
      field === 'eventDate' ||
      field === 'due'
    ) {
      return setErrors({ [field]: message });
    }
    toast(message, { bad: true });
  };

  const field = (
    key: ManualField | 'reason',
    label: string,
    input: (control: object) => ReactNode,
    extra: { required?: boolean; hint?: string; full?: boolean } = {},
  ) => (
    <Field
      id={`${id}-${key}`}
      label={label}
      required={extra.required}
      hint={extra.hint}
      full={extra.full}
      error={key === 'reason' ? undefined : errors[key]}
    >
      {input}
    </Field>
  );

  // Любое изменённое поле — вопрос «Закрыть без сохранения?» (прототип ui/popups.js).
  const dirty =
    cp !== initial.cp ||
    typeCode !== initial.typeCode ||
    month !== initial.month ||
    event !== initial.event ||
    due !== initial.due ||
    reason !== initial.reason;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={dirty}
      title={t('report.manual.title')}
      sub={
        oneOff && type
          ? t('report.manual.sub_one_off', { type: type.shortName })
          : t('report.manual.sub')
      }
      footer={
        <Footer t={t} onClose={onClose} label={t('report.manual.ok')} busy={busy} onOk={save} />
      }
    >
      <FormGrid>
        {field(
          'contractorId',
          t('report.manual.cp'),
          (control) => (
            <Select
              control={control}
              value={cp}
              options={options.contractors.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => {
                setCp(v);
                clear('contractorId');
                if (oneOff && !dueTouched) void computeDue(typeCode, event, v);
              }}
            />
          ),
          { required: true, full: true },
        )}
        {field(
          'reportTypeCode',
          t('report.manual.type'),
          (control) => (
            <Select
              control={control}
              value={typeCode}
              options={options.types.map((x) => ({
                value: x.code,
                label: x.oneOff ? t('report.manual.type_one_off', { name: x.name }) : x.name,
              }))}
              onChange={pickType}
            />
          ),
          { required: true, full: true },
        )}
        {oneOff && type
          ? field(
              'eventDate',
              type.eventLabel || t('report.event.default'),
              (control) => (
                <input
                  {...control}
                  type="date"
                  className={inputClass()}
                  value={event}
                  onChange={(e) => {
                    setEvent(e.target.value);
                    clear('eventDate');
                    if (!dueTouched) void computeDue(typeCode, e.target.value, cp);
                  }}
                />
              ),
              { required: true, hint: t('report.manual.event_hint', { rule: type.dueText }) },
            )
          : field(
              'month',
              t('report.manual.month'),
              (control) => (
                <input
                  {...control}
                  type="month"
                  className={inputClass()}
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    clear('month');
                  }}
                />
              ),
              { required: true, hint: t('report.manual.month_hint') },
            )}
        {field(
          'due',
          t(oneOff && type?.act === 'pay' ? 'report.manual.pay_due' : 'report.manual.due'),
          (control) => (
            <input
              {...control}
              type="date"
              className={inputClass()}
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setDueTouched(true);
                clear('due');
              }}
            />
          ),
          {
            required: true,
            hint: oneOff
              ? `${t('report.manual.due_hint')} ${t('report.manual.due_shift_hint')}`
              : t('report.manual.due_shift_hint'),
          },
        )}
        {shifted ? (
          <div data-due-shift="" className="col-span-full text-[11.5px] leading-[1.4] text-caution">
            {t('report.manual.off_day', {
              date: formatDateRu(due),
              shifted: formatDateRu(shifted),
            })}
          </div>
        ) : null}
        {field(
          'reason',
          t('report.manual.reason'),
          (control) => (
            <Select
              control={control}
              value={reason}
              options={reasons.map((r) => ({ value: r.code, label: r.name }))}
              onChange={setReason}
            />
          ),
          { full: true },
        )}
      </FormGrid>
    </Modal>
  );
}
