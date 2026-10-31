'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  parseSom,
  pluralForm,
  reportHasAmount,
} from '@buhuchet/domain';
import {
  isRecordChanged,
  REPORT_NOTE_MAX,
  ReportBatchResult,
  ReportBatchSubmitResult,
  ReportSaved,
  ReportSubmitted,
  type ReportCard,
  type ReportRow,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  Icon,
  inputClass,
  KeyValues,
  MiniTable,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { filesQuery, pickedFilesProblem, uploadFile } from '../files/files-data';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { payFirstWhy } from '../money/report-money';
import { amountFormOf, readAmount, withRevenue, withTax, type AmountForm } from './report-amount';
import { reportSub } from './report-menu';
import { reportQuery } from './reports-data';

/*
 * Окна сдачи и подтверждения отчёта (ТЗ «Отчеты для сдачи» → «Сдача отчёта», «Подтверждение сдачи»,
 * «Сумма к уплате»; прототип ui/status-scale.js: submitDlg, repConfDlg, repFixDlg, sumDlg, fileDlg).
 * Одно окно открывается по свежей карточке с сервера; запись изменил другой — предупреждение и
 * «Перечитать». Файлы, выбранные в окне, загружаются в блок «Файлы» отчёта до отметки.
 */

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

const todayBishkek = () => bishkekDate(new Date());

function Footer({
  t,
  onClose,
  label,
  icon,
  tone = 'cta',
  busy,
  onOk,
}: {
  t: Translate;
  onClose: () => void;
  label: string;
  icon: IconName;
  tone?: 'cta' | 'ok' | 'danger';
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
        className={buttonClass(tone)}
        disabled={busy}
        onClick={onOk}
      >
        <Icon name={icon} size="sm" />
        {label}
      </button>
    </>
  );
}

/** Карточка в окне: свежая с сервера по «Перечитать», если запись изменил другой пользователь. */
function useFreshCard(initial: ReportCard, onFresh: (card: ReportCard) => void) {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const [card, setCard] = useState(initial);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setReloading(true);
    try {
      const fresh = await client.fetchQuery({ ...reportQuery(initial.id), staleTime: 0 });
      setCard(fresh);
      setChanged(false);
      onFresh(fresh);
    } catch {
      toast(t('err.unknown'), { bad: true });
    } finally {
      setReloading(false);
    }
  };
  const notice = changed ? (
    <RecordChangedNotice
      message={t('err.record_changed')}
      reloadLabel={t('form.reload')}
      onReload={() => void reload()}
      reloading={reloading}
    />
  ) : null;
  return { card, setChanged, notice };
}

/** Загрузить выбранные файлы в блок «Файлы» отчёта: номера загруженных или текст ошибки. */
async function uploadPicked(
  t: Translate,
  errorText: (e: ApiErrorLike) => string,
  reportId: string,
  picked: readonly File[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const problem = pickedFilesProblem(picked);
  if (problem) {
    return {
      ok: false,
      error:
        'names' in problem
          ? t('files.too_large', { names: problem.names })
          : t('files.upload_failed', {
              name: problem.name,
              error: errorText({ code: problem.code, message: '' }),
            }),
    };
  }
  const ids: string[] = [];
  for (const file of picked) {
    const res = await uploadFile({ kind: 'report', id: reportId }, file);
    if (!res.ok)
      return {
        ok: false,
        error: t('files.upload_failed', { name: file.name, error: errorText(res.error) }),
      };
    ids.push(res.item.id);
  }
  return { ok: true, ids };
}

/** Можно ли загружать файлы в отчёт (право «Загружать файлы», контрагент не в архиве). */
function useCanUpload(card: ReportCard) {
  const files = useQuery({
    ...filesQuery({ kind: 'report', id: card.id }),
    enabled: card.filesOn,
  });
  return card.filesOn && (files.data?.canUpload ?? false);
}

function FilesInput({ control, onPick }: { control: object; onPick: (files: File[]) => void }) {
  return (
    <input
      {...control}
      type="file"
      multiple
      data-report-files=""
      className={inputClass({ file: true })}
      onChange={(e) => onPick([...(e.target.files ?? [])])}
    />
  );
}

/* ───────────── Сумма: строки по ставкам, по платежам, итог, «Повторять» ───────────── */

interface AmountErrors {
  lines?: string;
  amount?: string;
}

/**
 * Поля суммы (прототип linesFld, partsFld, поле итога, repeatBox): таблица «Выручка и налог по
 * ставкам», поле на каждый платёж «Что уплачивается», итог (при строках — только для чтения) и
 * «Повторять эту сумму в следующих отчётах», если у отчёта есть действующее назначение.
 */
function AmountFields({
  t,
  id,
  card,
  form,
  onForm,
  repeat,
  onRepeat,
  errors,
  mode,
}: {
  t: Translate;
  id: string;
  card: ReportCard;
  form: AmountForm;
  onForm: (form: AmountForm) => void;
  repeat: boolean;
  onRepeat: (on: boolean) => void;
  errors: AmountErrors;
  mode: 'submit' | 'amount';
}) {
  const defs = card.lineDefs;
  const rate = defs.flatMap((d, k) => (d.kind === 'rate' ? [{ d, k }] : []));
  const parts = defs.flatMap((d, k) => (d.kind === 'payment' ? [{ d, k }] : []));
  const total = defs.length > 0;
  const cashHint = rate.some(({ d }) => d.cash !== null);
  const label = total
    ? t('report.amount.field_total')
    : t(mode === 'submit' ? 'report.amount.field_due' : 'report.amount.field');
  const fixed = card.repeat?.fixedAmount ?? null;
  return (
    <>
      {rate.length > 0 ? (
        <div
          data-field=""
          data-report-lines=""
          className="col-span-full flex min-w-0 flex-col gap-[5px]"
        >
          <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
            {t('report.lines.title')}
          </span>
          <MiniTable
            label={t('report.lines.title')}
            empty=""
            columns={[
              { key: 'rate', label: t('report.lines.rate') },
              { key: 'revenue', label: t('report.lines.revenue'), numeric: true, width: 180 },
              { key: 'tax', label: t('report.lines.tax'), numeric: true, width: 150 },
            ]}
            rows={rate.map(({ d, k }) => ({
              key: d.key,
              cells: {
                rate: (
                  <span>
                    {d.label}
                    {d.cash !== null ? (
                      <span className="block text-[11.5px] text-faint">
                        {t(d.cash ? 'report.lines.cash' : 'report.lines.cashless')}
                      </span>
                    ) : null}
                  </span>
                ),
                revenue: (
                  <input
                    type="text"
                    inputMode="decimal"
                    data-line-revenue={d.key}
                    aria-label={t('report.lines.revenue_of', { label: d.label })}
                    placeholder={t('report.lines.optional')}
                    className={`${inputClass()} text-right tabular-nums`}
                    value={form.lines[k]!.revenue}
                    onChange={(e) => onForm(withRevenue(defs, form, k, e.target.value))}
                  />
                ),
                tax: (
                  <input
                    type="text"
                    inputMode="decimal"
                    data-line-tax={d.key}
                    aria-label={t('report.lines.tax_of', { label: d.label })}
                    placeholder="0"
                    className={`${inputClass()} text-right tabular-nums`}
                    value={form.lines[k]!.tax}
                    onChange={(e) => onForm(withTax(defs, form, k, e.target.value))}
                  />
                ),
              },
            }))}
          />
          <div className="text-[11.5px] leading-[1.4] text-faint">
            {t('report.lines.hint')}
            {cashHint ? ` ${t('report.lines.hint_cash')}` : ''}
          </div>
          {errors.lines ? (
            <div role="alert" className="text-[11.5px] text-danger">
              {errors.lines}
            </div>
          ) : null}
        </div>
      ) : null}
      {parts.map(({ d, k }) => {
        const authority = card.payments[Number(d.key.slice('pay:'.length))]?.authority;
        return (
          <Field
            key={d.key}
            id={`${id}-part-${k}`}
            label={t('report.part.label', {
              name: authority ? `${d.label} · ${authority}` : d.label,
            })}
            hint={d.kbk ? t('report.part.kbk', { kbk: d.kbk }) : undefined}
            error={rate.length === 0 && k === parts[0]?.k ? errors.lines : undefined}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-line-tax={d.key}
                className={`${inputClass()} tabular-nums`}
                value={form.lines[k]!.tax}
                onChange={(e) => onForm(withTax(defs, form, k, e.target.value))}
              />
            )}
          </Field>
        );
      })}
      <Field
        id={`${id}-amount`}
        label={label}
        full
        hint={t(mode === 'submit' ? 'report.amount.hint_zero' : 'report.amount.hint')}
        error={errors.amount}
      >
        {(control) => (
          <input
            {...control}
            type="text"
            inputMode="decimal"
            data-report-amount=""
            readOnly={total}
            placeholder={
              mode === 'submit' ? t('report.amount.placeholder_zero') : formatSom(125050, 'auto')
            }
            className={`${inputClass()} tabular-nums`}
            value={form.amount}
            onChange={(e) => onForm({ ...form, amount: e.target.value })}
          />
        )}
      </Field>
      {card.repeat ? (
        <div className="col-span-full">
          <CheckRow
            kind="check"
            plain
            checked={repeat}
            onChange={onRepeat}
            data-report-repeat=""
            label={
              <span className="inline-flex items-center gap-2">
                <Icon name="repeat" size="sm" />
                {t('report.repeat.label')}
              </span>
            }
          >
            {t('report.repeat.hint', { type: card.type.shortName })}
            {fixed !== null ? ` ${t('report.repeat.now', { sum: formatSomWithUnit(fixed) })}` : ''}
          </CheckRow>
        </div>
      ) : null}
    </>
  );
}

/** Ошибка суммы для полей окна; null — сумма в порядке. */
function amountErrors(t: Translate, read: ReturnType<typeof readAmount>): AmountErrors | null {
  if (read.ok) return null;
  return read.field === 'lines'
    ? { lines: t('report.lines.invalid', { label: read.label }) }
    : { amount: t('report.amount.invalid') };
}

interface CardDialogProps {
  card: ReportCard;
  open: boolean;
  onClose: () => void;
  /** После действия: перечитать карточку и списки. */
  onDone: () => void;
}

/* ───────────── «Отметить сданным» ───────────── */

/**
 * «Отметить отчёт сданным» (прототип submitDlg, один отчёт): дата сдачи не позже сегодняшней; у вида с
 * уплатой — сумма (строки, платежи, итог) и «Повторять эту сумму»; с «Файлами в карточках» — файлы
 * (отчёт, квитанция): у вида с обязательным файлом без файла «Сдан» не ставится. Поле суммы у вида
 * «Сдача» (статистика) не показывается.
 */
export function ReportSubmitDialog({
  card: initial,
  confirmOn,
  open,
  onClose,
  onDone,
}: CardDialogProps & { confirmOn: boolean }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [date, setDate] = useState(todayBishkek);
  const [form, setForm] = useState(() => amountFormOf(initial));
  const [repeat, setRepeat] = useState(initial.repeat?.fixedAmount != null);
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<AmountErrors & { date?: string; files?: string }>({});
  const [busy, setBusy] = useState(false);
  const fresh = useFreshCard(initial, (c) => setForm(amountFormOf(c)));
  const { card } = fresh;
  const canUpload = useCanUpload(card);
  const withAmount = reportHasAmount(card.act);

  const submit = async () => {
    if (!date || date > todayBishkek()) return setErrors({ date: t('err.submit_date_invalid') });
    const read = withAmount ? readAmount(card.lineDefs, form, false) : null;
    const bad = read && amountErrors(t, read);
    if (bad) return setErrors(bad);
    // `hasFiles`, а не список: без права «Просматривать файлы» имён файлов в карточке нет.
    if (card.fileRequired && !card.hasFiles && picked.length === 0)
      return setErrors({ files: t('err.report_file_required') });
    setBusy(true);
    const files = await uploadPicked(t, errorText, card.id, picked);
    if (!files.ok) {
      setBusy(false);
      return setErrors({ files: files.error });
    }
    const res = await callApi(() =>
      api.api.reports[':id'].submit.$post({
        param: { id: card.id },
        json: {
          version: card.version,
          date,
          amount: read?.ok ? read.amount : null,
          lines: read?.ok ? read.lines : null,
          repeat,
          fileIds: files.ids,
        },
      }),
    );
    setBusy(false);
    // Загруженные файлы уже в отчёте — карточку перечитать при любом исходе.
    if (files.ids.length) onDone();
    const saved = res.ok ? ReportSubmitted.safeParse(res.data) : null;
    if (res.ok && saved?.success) {
      onDone();
      onClose();
      // «Сдача только после оплаты»: сумма и файлы сохранены, «Сдан» — после оплаты (прототип submitDlg).
      const wait = saved.data.waitsPayment;
      if (wait) {
        const why = t('report.pay_first.why', {
          amount: formatSomWithUnit(wait.amount),
          paid: formatSomWithUnit(wait.paid),
        });
        return void toast(t('report.pay_first.saved', { why }), { bad: true, icon: 'lock' });
      }
      return void toast(t(confirmOn ? 'report.submit.done_confirm' : 'report.submit.done'), {
        icon: 'send',
      });
    }
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return fresh.setChanged(true);
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'date') return setErrors({ date: message });
    if (field === 'fileIds') return setErrors({ files: message });
    if (field === 'lines' || field === 'amount') return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const filesHint = card.fileRequired
    ? card.files.length
      ? t('report.submit.files_have', { n: card.files.length })
      : t('report.submit.files_need')
    : t('report.submit.optional');

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size={card.lineDefs.length ? 'mid' : undefined}
      dirty={picked.length > 0 || form.amount !== form.initial}
      title={t('report.submit.title')}
      sub={reportSub(card, 'full')}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.submit.ok')}
          icon="send"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-report-submit={card.id}>
        {fresh.notice}
        <FormGrid>
          <Field id={`${id}-date`} label={t('report.submit.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-report-date=""
                max={todayBishkek()}
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
              />
            )}
          </Field>
          {withAmount ? (
            <AmountFields
              t={t}
              id={id}
              card={card}
              form={form}
              onForm={(f) => {
                setForm(f);
                setErrors((x) => ({ ...x, lines: undefined, amount: undefined }));
              }}
              repeat={repeat}
              onRepeat={setRepeat}
              errors={errors}
              mode="submit"
            />
          ) : null}
          {card.filesOn && canUpload ? (
            <Field
              id={`${id}-files`}
              label={t('report.submit.files')}
              full
              hint={filesHint}
              error={errors.files}
            >
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(f) => {
                    setPicked(f);
                    setErrors((x) => ({ ...x, files: undefined }));
                  }}
                />
              )}
            </Field>
          ) : card.fileRequired && !card.hasFiles ? (
            <div className="col-span-full">
              <Note tone="warn" icon="clip">
                {errors.files ?? t('report.submit.files_need')}
              </Note>
            </div>
          ) : null}
        </FormGrid>
        {card.taxpay &&
        card.payFirst &&
        card.act === 'both' &&
        card.amount === null &&
        !(card.paid > 0) ? (
          <Note icon="lock">{t('report.pay_first.submit_note')}</Note>
        ) : null}
      </div>
    </Modal>
  );
}

/* ───────────── Массово «Отметить сданными» ───────────── */

/** Файл обязателен, а файлов нет: в массовом окне строка помечена и не отмечается (прототип needF). */
export const rowNeedsFile = (r: ReportRow, o: { confirmOn: boolean; filesOn: boolean }) =>
  o.filesOn && (r.needFile || (!o.confirmOn && r.needReceipt)) && !r.hasFiles;

/** Квитанция обязательна, а файлов нет: массово не подтверждается (прототип needRcpt). */
export const rowNeedsReceipt = (r: ReportRow, o: { filesOn: boolean }) =>
  o.filesOn && r.needReceipt && !r.hasFiles;

interface BatchProps {
  rows: readonly ReportRow[];
  confirmOn: boolean;
  filesOn: boolean;
  open: boolean;
  onClose: () => void;
  /** После действия: снять галочки, перечитать списки. */
  onDone: () => void;
}

/**
 * «Отметить сданными: N» (прототип submitDlg, несколько отчётов): одна дата сдачи; сумма к уплате —
 * в строке каждого отчёта с уплатой; отчёты, где файл при сдаче обязателен, а файлов нет, помечены
 * «нужен файл» и не отмечаются — их сдают из карточки.
 */
export function ReportBatchSubmitDialog({
  rows,
  confirmOn,
  filesOn,
  payFirst,
  open,
  onClose,
  onDone,
}: BatchProps & { payFirst: boolean }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [date, setDate] = useState(todayBishkek);
  const [dateError, setDateError] = useState<string | undefined>();
  const [sums, setSums] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.id, r.amount === null ? '' : formatSom(r.amount, 'auto')]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const needFile = (r: ReportRow) => rowNeedsFile(r, { confirmOn, filesOn });
  const skip = rows.filter(needFile).length;
  // «Нет оплаты»: при «Сдаче только после оплаты» такие не отмечаются (прототип subNeedPay).
  const needPay = (r: ReportRow) => !needFile(r) && !!payFirstWhy(t, r, payFirst);
  const unpaid = rows.filter(needPay).length;

  const submit = async () => {
    if (!date || date > todayBishkek()) return setDateError(t('err.submit_date_invalid'));
    const go = rows.filter((r) => !needFile(r));
    if (!go.length)
      return void toast(t('report.submit.all_need_file'), { bad: true, icon: 'alert' });
    const items = go.map((r) => {
      const n = reportHasAmount(r.act) ? parseSom(sums[r.id] ?? '') : null;
      return {
        id: r.id,
        version: r.version,
        amount: n !== null && n >= 0 && n !== r.amount ? n : null,
      };
    });
    setBusy(true);
    const res = await callApi(() => api.api.reports.submit.$post({ json: { date, items } }));
    setBusy(false);
    const out = res.ok ? ReportBatchSubmitResult.safeParse(res.data) : null;
    if (!res.ok) {
      if (fieldOf(res.error.details) === 'date') return setDateError(errorText(res.error));
      onDone();
      return void toast(errorText(res.error), { bad: true });
    }
    if (!out?.success) return void toast(t('err.unknown'), { bad: true });
    onDone();
    onClose();
    const { done, skippedFile, skippedPay } = out.data;
    const missed = skippedFile + skip;
    if (!done)
      return void toast(
        t(
          skippedPay
            ? 'report.pay_first.all_unpaid'
            : missed
              ? 'report.submit.all_need_file'
              : 'report.submit.none',
        ),
        { bad: true, icon: 'alert' },
      );
    toast(
      missed && skippedPay
        ? t('report.submit.done_many_skip_both', { n: done, m: missed, k: skippedPay })
        : skippedPay
          ? t('report.submit.done_many_skip_pay', { n: done, m: skippedPay })
          : missed
            ? t('report.submit.done_many_skip', { n: done, m: missed })
            : t('report.submit.done_many', { n: done }),
      { icon: 'send' },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('report.submit.title_many', { n: rows.length })}
      sub={t('report.submit.sub_many')}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.submit.ok')}
          icon="send"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-report-batch-submit="">
        <FormGrid>
          <Field id={`${id}-date`} label={t('report.submit.date')} required error={dateError}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-report-date=""
                max={todayBishkek()}
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setDateError(undefined);
                }}
              />
            )}
          </Field>
        </FormGrid>
        {unpaid ? (
          <Note tone="warn" icon="lock">
            {t('report.pay_first.batch_note', {
              n: t(`report.count.${pluralForm(unpaid)}`, { n: unpaid }),
            })}
          </Note>
        ) : null}
        {skip ? <Note tone="warn">{t('report.submit.need_file_note', { n: skip })}</Note> : null}
        <MiniTable
          label={t('report.submit.title_many', { n: rows.length })}
          empty=""
          columns={[
            { key: 'cp', label: t('report.submit.col_cp') },
            { key: 'report', label: t('report.submit.col_report') },
            { key: 'period', label: t('report.submit.col_period') },
            { key: 'amount', label: t('report.submit.col_amount'), numeric: true, width: 150 },
          ]}
          rows={rows.map((r) => ({
            key: r.id,
            cells: {
              cp: r.contractor.name,
              report: (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {r.type.shortName}
                  {needPay(r) ? (
                    <Pill tone="warn" size="sm" icon="lock">
                      {t('report.pay_first.pill')}
                    </Pill>
                  ) : null}
                  {needFile(r) ? (
                    <Pill tone="warn" size="sm" icon="clip">
                      {t('report.submit.need_file_pill')}
                    </Pill>
                  ) : null}
                </span>
              ),
              period: r.periodLabel,
              amount: needFile(r) ? (
                <span className="text-faint">{t('report.submit.from_card')}</span>
              ) : reportHasAmount(r.act) ? (
                <input
                  type="text"
                  inputMode="decimal"
                  data-batch-amount={r.id}
                  aria-label={t('report.submit.col_amount')}
                  className={`${inputClass()} max-w-[130px] text-right tabular-nums md:ml-auto`}
                  value={sums[r.id] ?? ''}
                  onChange={(e) => setSums((s) => ({ ...s, [r.id]: e.target.value }))}
                />
              ) : (
                <span className="text-faint">{t('report.submit.no_amount')}</span>
              ),
            },
          }))}
        />
      </div>
    </Modal>
  );
}

/* ───────────── «Подтвердить» ───────────── */

/**
 * «Подтвердить сдачу отчёта» (прототип repConfDlg, один отчёт): кто и когда сдал, сумма, файлы, сколько
 * ждёт; комментарий (необязательно); с «Файлами в карточках» — квитанция о приёме: у вида с
 * обязательной квитанцией без неё сдачу не подтвердить, если квитанции нет среди файлов отчёта.
 */
export function ReportConfirmDialog({ card: initial, open, onClose, onDone }: CardDialogProps) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fresh = useFreshCard(initial, () => {});
  const { card } = fresh;
  const canUpload = useCanUpload(card);

  const submit = async () => {
    if (card.receiptRequired && !card.hasFiles && picked.length === 0)
      return setError(t('err.report_receipt_required'));
    setBusy(true);
    const files = await uploadPicked(t, errorText, card.id, picked);
    if (!files.ok) {
      setBusy(false);
      return setError(files.error);
    }
    const res = await callApi(() =>
      api.api.reports[':id'].confirm.$post({
        param: { id: card.id },
        json: { version: card.version, note: cleanNote(note), fileIds: files.ids },
      }),
    );
    setBusy(false);
    if (files.ids.length) onDone();
    if (res.ok && ReportSaved.safeParse(res.data).success) {
      onDone();
      onClose();
      return void toast(t('report.confirm.done'), { icon: 'check' });
    }
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return fresh.setChanged(true);
    if (fieldOf(res.error.details) === 'fileIds') return setError(errorText(res.error));
    toast(errorText(res.error), { bad: true });
  };

  const by = card.submittedBy?.shortName ?? card.responsible?.shortName ?? '—';
  const items = [
    {
      id: 'by',
      label: t('report.confirm.by'),
      value: `${by} · ${card.submittedOn ? formatDateRu(card.submittedOn) : '—'}`,
    },
    ...(reportHasAmount(card.act)
      ? [
          {
            id: 'amount',
            label: t('report.card.amount'),
            value: card.amount === null ? t('report.amount.none') : formatSomWithUnit(card.amount),
          },
        ]
      : []),
    // Файлы есть, а имён нет (нет права «Просматривать файлы») — строки нет, а не «нет файлов».
    ...(card.files.length || !card.hasFiles
      ? [
          {
            id: 'files',
            label: t('report.confirm.files'),
            value: card.files.length ? (
              card.files.map((f) => f.name).join(', ')
            ) : (
              <span className="text-faint">{t('report.confirm.no_files')}</span>
            ),
          },
        ]
      : []),
    {
      id: 'wait',
      label: t('report.confirm.wait'),
      value: t('report.confirm.wait_days', { n: card.waitDays ?? 0 }),
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={note !== '' || picked.length > 0}
      title={t('report.confirm.title')}
      sub={reportSub(card, 'full')}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.confirm.ok')}
          icon="check"
          tone="ok"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-report-confirm={card.id}>
        {fresh.notice}
        <KeyValues items={items} />
        <FormGrid>
          <Field id={`${id}-note`} label={t('report.confirm.comment')} full>
            {(control) => (
              <textarea
                {...control}
                data-report-note=""
                maxLength={REPORT_NOTE_MAX}
                placeholder={t('report.submit.optional')}
                className={`${inputClass({ multiline: true })} min-h-[56px]`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {card.filesOn && canUpload ? (
            <Field
              id={`${id}-files`}
              label={t('report.confirm.receipt')}
              full
              hint={
                card.receiptRequired
                  ? t(
                      card.files.length
                        ? 'report.confirm.receipt_have'
                        : 'report.confirm.receipt_need',
                    )
                  : t('report.submit.optional')
              }
              error={error}
            >
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(f) => {
                    setPicked(f);
                    setError(undefined);
                  }}
                />
              )}
            </Field>
          ) : error ? (
            <div className="col-span-full">
              <Note tone="bad">{error}</Note>
            </div>
          ) : null}
        </FormGrid>
      </div>
    </Modal>
  );
}

/** Скобки из комментария убираются, как в прототипе: комментарий пишется в историю в скобках. */
const cleanNote = (s: string) => s.trim().replace(/[()]/g, '');

/**
 * «Подтвердить сдачу: N» во вкладке «Ожидают подтверждения» (прототип repConfDlg, несколько отчётов):
 * свои сданные и не ждущие подтверждения не подтверждаются (сколько — подсказкой); отчётам, которым
 * нужна квитанция, а файлов нет, — пометка «нужна квитанция», они подтверждаются из карточки.
 */
export function ReportBatchConfirmDialog({
  rows,
  skipped,
  filesOn,
  total,
  open,
  onClose,
  onDone,
}: Omit<BatchProps, 'confirmOn'> & { skipped: number; total: number }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const needReceipt = (r: ReportRow) => rowNeedsReceipt(r, { filesOn });
  const noReceipt = rows.filter(needReceipt).length;

  const submit = async () => {
    const go = rows.filter((r) => !needReceipt(r));
    if (!go.length)
      return void toast(t('report.confirm.all_need_receipt'), { bad: true, icon: 'alert' });
    setBusy(true);
    const res = await callApi(() =>
      api.api.reports.confirm.$post({
        json: { note: cleanNote(note), items: go.map((r) => ({ id: r.id, version: r.version })) },
      }),
    );
    setBusy(false);
    const out = res.ok ? ReportBatchResult.safeParse(res.data) : null;
    onDone();
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    if (!out?.success) return void toast(t('err.unknown'), { bad: true });
    onClose();
    const { done, skippedFile } = out.data;
    const missed = skippedFile + noReceipt;
    if (!done)
      return void toast(t(missed ? 'report.confirm.all_need_receipt' : 'report.confirm.none'), {
        bad: true,
        icon: 'alert',
      });
    toast(
      missed
        ? t('report.confirm.done_many_skip', { n: done, m: missed })
        : t('report.confirm.done_many', { n: done }),
      { icon: 'check' },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      dirty={note !== ''}
      title={t('report.confirm.title_many', { n: rows.length })}
      sub={t('report.confirm.sub_many')}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.confirm.ok')}
          icon="check"
          tone="ok"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-report-batch-confirm="">
        <MiniTable
          label={t('report.confirm.title_many', { n: rows.length })}
          empty=""
          columns={[
            { key: 'cp', label: t('report.submit.col_cp') },
            { key: 'report', label: t('report.submit.col_report') },
            { key: 'period', label: t('report.submit.col_period') },
            { key: 'by', label: t('report.submit.col_by') },
            { key: 'wait', label: t('report.submit.col_wait'), numeric: true },
          ]}
          rows={rows.map((r) => ({
            key: r.id,
            cells: {
              cp: r.contractor.name,
              report: (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {r.type.shortName}
                  {needReceipt(r) ? (
                    <Pill tone="warn" size="sm" icon="clip">
                      {t('report.confirm.receipt_pill')}
                    </Pill>
                  ) : null}
                </span>
              ),
              period: r.periodLabel,
              by: r.submittedBy?.shortName ?? r.responsible?.shortName ?? '—',
              wait: String(r.waitDays ?? 0),
            },
          }))}
        />
        {skipped ? <Note>{t('report.confirm.skip', { n: skipped, m: total })}</Note> : null}
        <FormGrid>
          <Field id={`${id}-note`} label={t('report.confirm.comment')} full>
            {(control) => (
              <textarea
                {...control}
                data-report-note=""
                maxLength={REPORT_NOTE_MAX}
                placeholder={t('report.submit.optional')}
                className={`${inputClass({ multiline: true })} min-h-[56px]`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        {noReceipt ? (
          <Note tone="warn">{t('report.confirm.receipt_note', { n: noReceipt })}</Note>
        ) : null}
      </div>
    </Modal>
  );
}

/* ───────────── «На исправление» ───────────── */

/**
 * «Вернуть на исправление» (прототип repFixDlg): причина обязательна; отчёт получает «Требует
 * исправления» и снова несданный, ответственный видит причину в карточке. Сообщение в Telegram
 * добавит задача 2.25.
 */
export function ReportFixDialog({ card: initial, open, onClose, onDone }: CardDialogProps) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fresh = useFreshCard(initial, () => {});
  const { card } = fresh;

  const submit = async () => {
    const why = cleanNote(reason);
    if (!why) return setError(t('err.report_fix_reason'));
    setBusy(true);
    const res = await callApi(() =>
      api.api.reports[':id'].fix.$post({
        param: { id: card.id },
        json: { version: card.version, reason: why },
      }),
    );
    setBusy(false);
    if (res.ok && ReportSaved.safeParse(res.data).success) {
      onDone();
      onClose();
      return void toast(t('report.fix.done'), { icon: 'refresh' });
    }
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return fresh.setChanged(true);
    if (fieldOf(res.error.details) === 'reason') return setError(errorText(res.error));
    toast(errorText(res.error), { bad: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={reason !== ''}
      title={t('report.fix.title')}
      sub={reportSub(card)}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.fix.ok')}
          icon="refresh"
          tone="danger"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-report-fix={card.id}>
        {fresh.notice}
        <Note>
          {t('report.fix.note', {
            name: card.responsible?.shortName ?? t('report.fix.responsible'),
          })}
        </Note>
        <Field id={`${id}-why`} label={t('report.fix.why')} required error={error}>
          {(control) => (
            <textarea
              {...control}
              data-report-fix-why=""
              maxLength={REPORT_NOTE_MAX}
              placeholder={t('report.fix.placeholder')}
              className={`${inputClass({ multiline: true })} min-h-[72px]`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────── «Указать сумму» ───────────── */

/**
 * «Сумма к уплате» (прототип sumDlg; ТЗ «Сумма к уплате»: вводится вручную, 0 — нулевой отчёт,
 * «Повторять эту сумму»): строки по ставкам и платежам, итог, галочка повторяющейся суммы.
 */
export function ReportAmountDialog({ card: initial, open, onClose, onDone }: CardDialogProps) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [form, setForm] = useState(() => amountFormOf(initial));
  const [repeat, setRepeat] = useState(initial.repeat?.fixedAmount != null);
  const [errors, setErrors] = useState<AmountErrors>({});
  const [busy, setBusy] = useState(false);
  const fresh = useFreshCard(initial, (c) => setForm(amountFormOf(c)));
  const { card } = fresh;

  const submit = async () => {
    const read = readAmount(card.lineDefs, form, true);
    const bad = amountErrors(t, read);
    if (bad || !read.ok) return setErrors(bad ?? {});
    setBusy(true);
    const res = await callApi(() =>
      api.api.reports[':id'].amount.$post({
        param: { id: card.id },
        json: { version: card.version, amount: read.amount, lines: read.lines, repeat },
      }),
    );
    setBusy(false);
    if (res.ok && ReportSaved.safeParse(res.data).success) {
      onDone();
      onClose();
      return void toast(t('report.amount.done'), { icon: 'coins' });
    }
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return fresh.setChanged(true);
    const field = fieldOf(res.error.details);
    if (field === 'lines' || field === 'amount')
      return setErrors({ [field]: errorText(res.error) });
    toast(errorText(res.error), { bad: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size={card.lineDefs.length ? 'mid' : undefined}
      dirty={form.amount !== form.initial}
      title={t('report.amount.title')}
      sub={reportSub(card)}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.amount.ok')}
          icon="check"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <div
        className="flex flex-col gap-3.5"
        data-report-amount-dialog={card.id}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).dataset.reportAmount !== undefined) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        {fresh.notice}
        <FormGrid>
          <AmountFields
            t={t}
            id={id}
            card={card}
            form={form}
            onForm={(f) => {
              setForm(f);
              setErrors({});
            }}
            repeat={repeat}
            onRepeat={setRepeat}
            errors={errors}
            mode="amount"
          />
        </FormGrid>
      </div>
    </Modal>
  );
}

/* ───────────── «Прикрепить файл» ───────────── */

/** «Прикрепить файлы» (прототип fileDlg): отчёт, квитанция, скриншот из кабинета — в блок «Файлы». */
export function ReportFileDialog({
  report,
  open,
  onClose,
  onDone,
}: {
  report: ReportRow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [picked, setPicked] = useState<File[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!picked.length) return setError(t('report.file.required'));
    setBusy(true);
    const res = await uploadPicked(t, errorText, report.id, picked);
    setBusy(false);
    onDone();
    if (!res.ok) return setError(res.error);
    onClose();
    toast(t('report.file.done'), { icon: 'clip' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={picked.length > 0}
      title={t('report.file.title')}
      sub={reportSub(report)}
      footer={
        <Footer
          t={t}
          onClose={onClose}
          label={t('report.file.ok')}
          icon="clip"
          busy={busy}
          onOk={() => void submit()}
        />
      }
    >
      <Field
        id={`${id}-files`}
        label={t('report.file.field')}
        hint={t('report.file.hint')}
        error={error}
      >
        {(control) => (
          <FilesInput
            control={control}
            onPick={(f) => {
              setPicked(f);
              setError(undefined);
            }}
          />
        )}
      </Field>
    </Modal>
  );
}
