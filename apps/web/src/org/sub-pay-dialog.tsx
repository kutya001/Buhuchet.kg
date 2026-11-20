'use client';

import {
  formatCount,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  SUBSCRIPTION_RECEIPT_MAX_BYTES,
  type SubscriptionCalcLine,
} from '@buhuchet/domain';
import {
  Box,
  buttonClass,
  Field,
  FormGrid,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  Modal,
  Note,
  Segments,
  useToast,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState, type DragEvent } from 'react';
import { useCopy } from '../contractor-page/page-pay';
import { fileSizeText } from '../files/files-data';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { receiptFileProblem, sendSubPay, SUB_QUERY_KEY } from './sub-data';
import {
  bytesMb,
  calcHint,
  gbText,
  kindLabel,
  lineText,
  payCalc,
  payChoice,
  payDefaults,
  payPlans,
  payProblem,
  planPrice,
  requisites,
  requisitesText,
  type PayMode,
  type PayState,
  type SubPay,
  type SubView,
} from './sub-model';

/*
 * Окно оплаты подписки (доработки 20.11.2026, блок 5, пункты 3–5; блок 3, пункт 3; прототип v154
 * `subPayDlg`, `subDropHtml`, `subDropBind`; этап 1, П7, поток И): всё в одном окне сверху вниз — вид
 * подписки, пакет и память, расчёт, реквизиты, чек. Чек проверяется по содержимому до загрузки, сервер
 * проверяет его снова и сам считает сумму.
 */

const RECEIPT_ACCEPT = 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png';
const RECEIPT_MB = SUBSCRIPTION_RECEIPT_MAX_BYTES / 1024 / 1024;

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
};

/**
 * Выбор чека (прототип `subDropHtml`, `subDropBind`): перетаскивание или выбор, один файл, проверка
 * имени, размера и типа по первым байтам; выбранный — строкой с «Убрать».
 */
export function ReceiptDrop({
  id,
  file,
  error,
  onPick,
}: {
  id: string;
  file: File | null;
  error: string | null;
  onPick: (file: File | null, error: string | null) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = async (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    const code = await receiptFileProblem(f);
    onPick(code ? null : f, code ? t(`err.${code}`) : null);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...(e.dataTransfer.files ?? [])];
    if (files.length !== 1) return onPick(null, t('sub.drop.one'));
    void take(files[0]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {file ? (
        <div
          data-sub-file=""
          className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2"
        >
          <Icon name="file" className="flex-none text-muted" />
          <div className="min-w-0 grow">
            <div className="truncate font-semibold text-ink">{file.name}</div>
            <div className="text-[12px] text-muted">
              {[extOf(file.name), fileSizeText(t, file.size)].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => onPick(null, null)}
          >
            <Icon name="x" size="sm" />
            {t('sub.drop.remove')}
          </button>
        </div>
      ) : (
        <label
          id={id}
          tabIndex={0}
          data-sub-drop=""
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-[1.5px] border-dashed px-4 py-[22px] text-center outline-none hover:border-accent hover:text-ink focus-visible:border-accent focus-visible:text-ink ${over ? 'border-accent bg-pane-alt text-ink' : `${error ? 'border-danger' : 'border-line'} bg-pane-alt text-muted`}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <Icon name="upload" size="lg" />
          <span>
            <b className="text-ink">{t('sub.drop.title')}</b> {t('sub.drop.text')}
          </span>
          <span className="text-[12px] text-muted">{t('sub.drop.hint', { mb: RECEIPT_MB })}</span>
          <input
            ref={input}
            type="file"
            accept={RECEIPT_ACCEPT}
            hidden
            onChange={(e) => {
              const list = e.target.files;
              if (list && list.length > 1) return onPick(null, t('sub.drop.one'));
              void take(list?.[0]);
            }}
          />
        </label>
      )}
      {error ? (
        <div
          id={`${id}-err`}
          role="alert"
          className="flex items-start gap-[5px] text-[12px] text-danger"
        >
          <Icon name="alert" size="sm" className="mt-px" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Строки расчёта и «Итого к оплате» (прототип `.sub-calc`). */
export function CalcTable({
  lines,
  total,
}: {
  lines: readonly SubscriptionCalcLine[];
  total: number;
}) {
  const t = useT();
  const rows = [
    ...lines.map((l, i) => ({ key: `${l.k}-${i}`, label: lineText(t, l), sum: l.sum, tot: false })),
    { key: 'total', label: t('sub.line.total'), sum: total, tot: true },
  ];
  return (
    <div
      data-sub-calc=""
      className="flex flex-col overflow-hidden rounded-lg border border-line [&>div+div]:border-t [&>div+div]:border-line"
    >
      {rows.map((r) => (
        <div
          key={r.key}
          data-sub-calc-total={r.tot ? '' : undefined}
          className={`flex justify-between gap-3 px-3 py-2 ${r.tot ? 'bg-pane-alt text-[14px] font-bold' : 'text-[13px]'}`}
        >
          <span>{r.label}</span>
          <span className="tabular-nums">{formatSomWithUnit(r.sum)}</span>
        </div>
      ))}
    </div>
  );
}

const payTitle = (t: Translate, view: SubView, mode: PayMode) =>
  mode === 'renew'
    ? t(view.sub ? 'sub.pay.title.renew' : 'sub.pay.title.first')
    : t(mode === 'grow' ? 'sub.pay.title.grow' : 'sub.pay.title.mem');

/** Число поля: пустое — 0, как у прототипа (`+value`). */
const num = (raw: string) => (raw.trim() === '' ? 0 : Number(raw));

type Errors = Partial<Record<'plan' | 'seats' | 'extraGb' | 'file' | 'form', string>>;

/** Куда поставить отказ сервера: под поле или над окном. */
function serverField(code: string): keyof Errors {
  if (code.startsWith('sub_receipt') || code === 'file_not_uploaded') return 'file';
  if (code.startsWith('sub_seats')) return 'seats';
  if (code.startsWith('sub_gb')) return 'extraGb';
  if (code === 'sub_plan_required') return 'plan';
  return 'form';
}

/**
 * Окно оплаты (прототип `subPayDlg`): `renew` — «Продлить» или «Оплатить подписку», `grow` —
 * «Расширить пакет», `mem` — «Купить память»; `pre` — отклонённая оплата («Прикрепить другой чек» с
 * теми же значениями, сумма посчитана заново).
 */
export function SubPayDialog({
  view,
  mode,
  pre,
  open,
  onClose,
}: {
  view: SubView;
  mode: PayMode;
  pre: SubPay | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const toast = useToast();
  const copy = useCopy();
  const client = useQueryClient();
  const router = useRouter();
  const [init] = useState(() => payDefaults(view, mode, pre));
  const [planId, setPlanId] = useState(init.planId);
  const [seatsRaw, setSeatsRaw] = useState(String(init.seats));
  const [gbRaw, setGbRaw] = useState(String(init.extraGb));
  const [startMode, setStartMode] = useState<PayState['startMode']>(init.startMode);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const st: PayState = { planId, seats: num(seatsRaw), extraGb: num(gbRaw), startMode };
  const problem = payProblem(t, view, mode, st);
  const calc = problem ? null : payCalc(view, mode, st);
  const p = view.prices;
  const u = view.usage;
  const sub = view.sub;
  const step = p.seatStep;
  const minPack = Math.max(step, Math.ceil(u.seatsUsed / step) * step);
  const change = (patch: Errors) => {
    setDirty(true);
    setErrors((e) => ({ ...e, ...patch, form: undefined }));
  };

  const submit = async () => {
    const next: Errors = {};
    if (problem) next[problem.field === 'plan' ? 'plan' : problem.field] = problem.text;
    if (!file) next.file = t('sub.drop.need');
    setErrors(next);
    if (problem || !file) return;
    if (!calc || calc.total <= 0) {
      toast(t('err.sub_nothing_to_pay'), { icon: 'alert', bad: true });
      return;
    }
    setBusy(true);
    const res = await sendSubPay(payChoice(view, mode, st), file);
    setBusy(false);
    if (!res.ok) {
      const error: ApiErrorLike = res.error;
      setErrors({ [serverField(error.code)]: errorText(error) });
      return;
    }
    void client.invalidateQueries({ queryKey: SUB_QUERY_KEY });
    // Статус подписки в «кто я»: полоса «Продлите», закрытый доступ и меню.
    router.refresh();
    onClose();
    toast(t(res.data.opensAccess || !view.closed ? 'sub.pay.sent_open' : 'sub.pay.sent_after'), {
      icon: 'send',
    });
  };

  const sizeFields = (() => {
    const pack = (label: 'sub.f.pack' | 'sub.f.new_pack', hint: string) => (
      <Field id="sp-pack" label={t(label)} hint={hint} error={errors.seats}>
        <input
          id="sp-pack"
          className={`${inputClass()} tabular-nums`}
          type="number"
          inputMode="numeric"
          min={label === 'sub.f.pack' ? minPack : u.seats + step}
          step={step}
          value={seatsRaw}
          aria-invalid={!!errors.seats}
          onChange={(e) => {
            setSeatsRaw(e.target.value);
            change({ seats: undefined });
          }}
        />
      </Field>
    );
    const gb = (hint: string) => (
      <Field id="sp-gb" label={t('sub.f.gb')} hint={hint} error={errors.extraGb}>
        <input
          id="sp-gb"
          className={`${inputClass()} tabular-nums`}
          type="number"
          inputMode="numeric"
          min={mode === 'mem' ? u.extraGb + 1 : 0}
          step={1}
          value={gbRaw}
          aria-invalid={!!errors.extraGb}
          onChange={(e) => {
            setGbRaw(e.target.value);
            change({ extraGb: undefined });
          }}
        />
      </Field>
    );
    const nextOff = view.monthsLeft <= 1;
    const when = (
      <Field id="sp-when" label={t('sub.f.when')}>
        <Segments
          label={t('sub.f.when')}
          value={startMode}
          onChange={(v) => {
            setStartMode(v);
            change({});
          }}
          options={[
            { value: 'now', label: t('sub.when.now') },
            {
              value: 'next',
              label: t('sub.when.next'),
              disabled: nextOff,
              title: nextOff ? t('err.sub_next_unavailable') : undefined,
            },
          ]}
        />
      </Field>
    );
    const used = gbText(bytesMb(u.bytesUsed));
    if (mode === 'renew') {
      return (
        <FormGrid>
          {pack('sub.f.pack', t('sub.f.pack_hint', { act: u.seatsUsed, min: minPack }))}
          {gb(
            t('sub.f.gb_hint', {
              base: gbText(p.baseMb),
              seat: formatCount(p.seatMb),
              used,
              price: formatSom(p.gbPrice),
            }),
          )}
        </FormGrid>
      );
    }
    if (mode === 'grow') {
      return (
        <FormGrid>
          {pack(
            'sub.f.new_pack',
            t('sub.f.new_pack_hint', {
              pack: u.seats,
              used: u.seatsUsed,
              step,
              gb: gbText(p.seatMb * step),
            }),
          )}
          {when}
        </FormGrid>
      );
    }
    return (
      <FormGrid>
        {gb(
          t('sub.f.mem_hint', {
            gb: u.extraGb,
            limit: gbText(bytesMb(u.bytesLimit ?? 0)),
            used,
          }),
        )}
        {when}
      </FormGrid>
    );
  })();

  const total = calc ? calc.total : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      dirty={dirty}
      title={payTitle(t, view, mode)}
      sub={
        sub
          ? t('sub.pay.sub_paid', { org: view.org.name, date: formatDateRu(sub.paidUntil) })
          : view.org.name
      }
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-sub-pay-send=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void submit()}
          >
            <Icon name="send" size="sm" />
            {busy ? t('sub.pay.sending') : t('sub.pay.send')}
          </button>
        </>
      }
    >
      <div data-sub-pay={mode} className="flex flex-col gap-3">
        {errors.form ? (
          <Note tone="bad" alert>
            {errors.form}
          </Note>
        ) : null}
        {pre ? (
          <Note tone="bad" icon="ban">
            <b>{t('sub.pay.pre')}</b> {t('sub.pay.pre_text', { reason: pre.reason ?? '—' })}
          </Note>
        ) : null}
        {mode === 'renew' && view.closed ? (
          <Note
            tone={view.lastRejected ? 'warn' : 'info'}
            icon={view.lastRejected ? 'alert' : 'info'}
          >
            {t(view.lastRejected ? 'sub.pay.closed_rej' : 'sub.pay.closed_open')}
          </Note>
        ) : null}
        {mode !== 'renew' ? <Note>{t('sub.pay.extra_note')}</Note> : null}

        <Box title={t(mode === 'renew' ? 'sub.pay.s1.renew' : 'sub.pay.s1.other')}>
          {mode === 'renew' ? (
            <>
              <div
                role="radiogroup"
                aria-label={t('sub.pay.kinds')}
                className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5"
              >
                {payPlans(view).map((k) => {
                  const on = k.id === planId;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-sub-kind={k.id}
                      onClick={() => {
                        setPlanId(k.id);
                        change({ plan: undefined });
                      }}
                      className={`flex cursor-pointer flex-col items-start gap-1 rounded-lg border bg-pane p-3 text-left text-ink transition-[border-color,box-shadow] duration-100 ${on ? 'border-accent bg-sel shadow-[inset_0_0_0_1px_var(--bu-accent)]' : 'border-line hover:border-line-strong'}`}
                    >
                      <span className="text-[14px] font-bold">
                        {k.name}
                        {sub?.planId === k.id ? (
                          <span className="ml-1.5 rounded-full bg-label-bg px-1.5 text-[11px] font-semibold text-label">
                            {t('sub.pay.kind_now')}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[12.5px]">
                        <b className="text-[15px] tabular-nums">
                          {formatSom(planPrice(view, k.discountPct))}
                        </b>{' '}
                        {t('sub.pay.per_seat')}
                      </span>
                      <span className="text-[12px] text-muted">
                        {k.discountPct
                          ? t('sub.pay.kind_disc', { pct: k.discountPct, months: k.months })
                          : t('sub.pay.kind_nodisc', { months: k.months })}
                      </span>
                      {k.perks.length ? (
                        <ul className="m-0 mt-1 pl-4 text-[12px] leading-[1.4] text-muted">
                          {k.perks.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {errors.plan ? (
                <div role="alert" className="flex items-start gap-[5px] text-[12px] text-danger">
                  <Icon name="alert" size="sm" className="mt-px" />
                  <span>{errors.plan}</span>
                </div>
              ) : null}
            </>
          ) : sub ? (
            <Hint>
              {t('sub.pay.sub_line', {
                kind: kindLabel(t, sub),
                date: formatDateRu(sub.paidUntil),
                left: view.monthsLeft,
              })}
            </Hint>
          ) : null}
        </Box>

        <Box
          title={t(
            mode === 'renew'
              ? 'sub.pay.s2.renew'
              : mode === 'grow'
                ? 'sub.pay.s2.grow'
                : 'sub.pay.s2.mem',
          )}
        >
          {sizeFields}
        </Box>

        <Box title={t('sub.pay.s3')}>
          {problem ? (
            <Hint>{problem.text}</Hint>
          ) : calc ? (
            <>
              <CalcTable lines={calc.lines} total={calc.total} />
              <Hint>{calcHint(t, view, mode, st, calc)}</Hint>
            </>
          ) : (
            <Hint>{t('sub.err.kind')}</Hint>
          )}
        </Box>

        <Box title={t('sub.pay.s4')}>
          <div
            data-sub-reqs=""
            className="flex flex-col [&>div+div]:border-t [&>div+div]:border-line"
          >
            {requisites(view).map((r) => {
              const label = t(`sub.req.${r.key}`);
              return (
                <div
                  key={r.key}
                  className="grid grid-cols-[170px_1fr_auto] items-center gap-2.5 py-1.5 text-[13px] max-md:grid-cols-[1fr_auto]"
                >
                  <span className="text-muted max-md:col-span-full max-md:-mb-1.5">{label}</span>
                  <span
                    className={`[overflow-wrap:anywhere] ${r.mono ? 'font-mono tabular-nums' : ''}`}
                  >
                    {r.value || '—'}
                  </span>
                  {r.value ? (
                    <button
                      type="button"
                      className={iconButtonClass('sm')}
                      aria-label={t('sub.req.copy', { k: label })}
                      title={t('sub.req.copy', { k: label })}
                      onClick={() => void copy(r.value!, t('sub.req.copied'))}
                    >
                      <Icon name="copy" size="sm" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 grow">
              <Hint>{t('sub.req.hint')}</Hint>
            </span>
            <button
              type="button"
              data-sub-copy-all=""
              className={buttonClass('default', 'sm')}
              onClick={() => void copy(requisitesText(t, view, total), t('sub.req.all_done'))}
            >
              <Icon name="copy" size="sm" />
              {t('sub.req.all')}
            </button>
          </div>
        </Box>

        <Box title={t('sub.pay.s5')}>
          <ReceiptDrop
            id="sp-f"
            file={file}
            error={errors.file ?? null}
            onPick={(f, error) => {
              setFile(f);
              change({ file: error ?? undefined });
            }}
          />
          <Hint>{t('sub.pay.file_hint')}</Hint>
        </Box>
      </div>
    </Modal>
  );
}
