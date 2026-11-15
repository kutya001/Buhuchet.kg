'use client';

import {
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  pageOpenMonths,
  pagePaidProblems,
  parseSom,
  SENT_FILE_COMMENT_MAX,
  type PageMonthPayStatus,
  type PagePaidProblem,
  type PayClaimPurpose,
  type StatusTone,
} from '@buhuchet/domain';
import {
  PageSentTicket,
  type PageMonthPay,
  type PagePay,
  type PublicPageBody,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  StatusPill,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';
import { PageTip, usePageText } from './page-parts';
import type { PageAddress } from './page-telegram';

/*
 * «Как оплатить», «Я оплатил» и «Перечислить» на странице контрагента (доработки 14.11.2026, блок 6,
 * этап 3, поток К; прототип v116 `pubPay`, `pubPaidDlg`, `pubSendDlg`). Это не онлайн-оплата: клиент
 * переводит деньги в своём банке или кошельке, а бухгалтер подтверждает получение. Запросы «Я оплатил»
 * идут под адресом страницы (`/<организация>/inn/<ИНН>/paid`): только туда браузер отправляет cookie
 * этой ссылки.
 */

type Page = PublicPageBody;

/** Пометка оплаты месяца (прототип `PG_MPAY`): цвет и значок. */
const MPAY_LOOK: Record<PageMonthPayStatus, { tone: StatusTone; icon: IconName }> = {
  paid: { tone: 'green', icon: 'check' },
  wait: { tone: 'blue', icon: 'hourglass' },
  partial: { tone: 'yellow', icon: 'half' },
  unpaid: { tone: 'gray', icon: 'circle' },
};

/** «Оплачено», «Ожидает подтверждения», «Частично», «Не оплачено». */
export function MonthPayPill({ status }: { status: PageMonthPayStatus }) {
  const t = useT();
  // Метка — для проверок: «Не оплачено» есть и у пометки оплаты отчёта внутри месяца.
  return (
    <span data-pub-mpay={status} className="contents">
      <StatusPill {...MPAY_LOOK[status]} label={t(`pub.mpay.${status}`)} size="sm" />
    </span>
  );
}

/** Скопировать в буфер и сказать об этом. */
function useCopy() {
  const toast = useToast();
  // ОТКЛОНЕНИЕ: docs/deviations.md#Е-6
  return async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Буфер обмена недоступен: номер виден крупно, его можно выделить.
      return;
    }
    toast(done, { icon: 'copy' });
  };
}

/**
 * Карточка «Как оплатить» (прототип v116 `pubPay`): «Реквизиты для перевода — организации …» или
 * «— сотрудника …», номер телефона или счёт крупно, кнопка копирования по виду реквизита — как в
 * Telegram («Скопировать номер телефона» или «Скопировать реквизиты для перевода»), банки и кошельки,
 * БИК, получатель, пояснение; `paid` — строка «Я оплатил» с пометкой ждущего сообщения.
 */
export function PayCard({
  k,
  title,
  icon,
  a,
  paid,
}: {
  k: PayClaimPurpose;
  title: string;
  icon: IconName;
  a: PagePay;
  paid?: () => void;
}) {
  const t = useT();
  const tx = usePageText();
  const copy = useCopy();
  const phone = a.kind === 'phone';
  const what = tx(`pay.${k}`);
  const w = a.waiting;
  return (
    <div
      data-pay={k}
      className="flex flex-col gap-2 rounded-xl border border-line bg-pane-alt px-3.5 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon name={icon} className="text-accent" />
        <b>{title}</b>
        <span className="ml-auto text-[11.5px] text-faint">{t(`pub.pay.kind.${a.kind}`)}</span>
      </div>
      <span data-pay-head="" className="-mt-1 text-[11.5px] text-faint">
        {a.head}
      </span>
      {phone ? null : <span className="font-semibold">{a.bank}</span>}
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          data-pay-number=""
          className="font-mono text-[22px] font-bold tracking-[.02em] [overflow-wrap:anywhere] max-md:text-[20px]"
        >
          {a.number}
        </span>
        <button
          type="button"
          data-pay-copy=""
          onClick={() =>
            void copy(a.copy, phone ? t('pub.pay.copied_phone') : t('pub.pay.copied_account'))
          }
          className={buttonClass('default', 'sm')}
        >
          <Icon name="copy" size="sm" />
          {a.copyLabel}
        </button>
      </div>
      {phone ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-[11.5px] text-faint">{t('pub.pay.from')}</span>
          {a.banks.map((b) => (
            <span
              key={b}
              className="rounded-full bg-label-bg px-2 py-px text-[11.5px] font-semibold text-label"
            >
              {b}
            </span>
          ))}
          <PageTip label={t('pub.pay.from')} text={tx('pay.banks')} />
        </div>
      ) : null}
      {a.bik ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-[11.5px] text-faint">{t('pub.pay.bik')}</span>
          <span className="font-mono">{a.bik}</span>
        </div>
      ) : null}
      {a.holder ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-[11.5px] text-faint">{t('pub.pay.holder')}</span>
          <b>{a.holder}</b>
        </div>
      ) : null}
      {what ? <p className="m-0 text-[13px] leading-[1.45] text-muted">{what}</p> : null}
      {paid ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-2">
          {w ? (
            <span data-pay-wait="" className="contents">
              <MonthPayPill status="wait" />
              <span className="text-[11.5px] text-faint">
                {w.amount === null
                  ? t('pub.paid.wait_at', { at: formatMomentRu(new Date(w.at)) })
                  : t('pub.paid.wait_note', {
                      at: formatMomentRu(new Date(w.at)),
                      sum: formatSomWithUnit(w.amount),
                    })}
              </span>
            </span>
          ) : null}
          <span className="grow" />
          <button
            type="button"
            data-pub-paid={k}
            className={buttonClass('cta', 'sm')}
            onClick={paid}
          >
            <Icon name="check" size="sm" />
            {t('pub.paid.btn')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Сумма без разрядов для вставки в банк: «4670,50». */
const plainSum = (tyiyn: number) => formatSom(tyiyn, 'auto').replace(/\s/g, '');

/** Сумма в поле ввода: «4 670,50». */
const fieldSum = (tyiyn: number) => (tyiyn > 0 ? formatSom(tyiyn, 'auto') : '');

/** Месяцы, за которые можно сообщить об оплате, и сумма по умолчанию (прототип `pubPaidDlg`). */
function paidChoices(page: Page) {
  const taxOpen = pageOpenMonths(page.reports?.months ?? []);
  const feeOpen = (page.fee?.months ?? [])
    .filter((m) => m.charge - m.got > 0)
    .map((m) => m.month)
    .sort();
  const fee = page.fee;
  const def = (purpose: PayClaimPurpose, month: string | null) =>
    purpose === 'tax'
      ? month
        ? ((page.reports?.months ?? []).find((m) => m.month === month)?.left ?? 0)
        : 0
      : fee
        ? fee.debt > 0
          ? fee.debt
          : (fee.tariff?.amount ?? 0)
        : 0;
  return { taxOpen, feeOpen, def };
}

interface PaidBody {
  purpose: PayClaimPurpose;
  month: string | null;
  amount: number;
  comment: string;
}

/**
 * «Я оплатил»: начать (ссылка на хранилище для чека) → положить чек → закончить с теми же полями.
 * Любой отказ — ошибкой с кодом словаря.
 */
async function sendPaid(address: PageAddress, body: PaidBody, file: File) {
  const base = `/${address.slug}/inn/${address.inn}/paid`;
  const post = (url: string, data: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  const started = await callApi(() =>
    post(base, { ...body, file: { name: file.name, size: file.size } }),
  );
  if (!started.ok) return started.error;
  const [item] = PageSentTicket.parse(started.data).items;
  if (!item) return { code: 'file_not_uploaded', message: '' };
  try {
    const put = await fetch(item.upload.url, {
      method: item.upload.method,
      headers: item.upload.headers,
      body: file,
    });
    if (!put.ok) return { code: 'file_not_uploaded', message: '' };
  } catch {
    return { code: 'network', message: '' };
  }
  const done = await callApi(() => post(`${base}/complete`, { ...body, id: item.id }));
  return done.ok ? null : done.error;
}

type FieldErrors = Partial<Record<PagePaidProblem['field'], string>>;

/** Поле и код текста из отказа сервера `page_paid_invalid`. */
function serverProblem(e: ApiErrorLike): PagePaidProblem | null {
  if (e.code !== 'page_paid_invalid') return null;
  const d = e.details as { field?: unknown; problem?: unknown } | undefined;
  if (typeof d?.field !== 'string' || typeof d.problem !== 'string') return null;
  return { field: d.field, code: d.problem } as PagePaidProblem;
}

/**
 * Окно «Я оплатил» (прототип `pubPaidDlg`): за какой месяц (налоги — при нескольких месяцах с остатком
 * и без заданного), что оплачено, сумма, чек — фото или PDF, комментарий. Без чека «Отправить»
 * неактивна; проверки — те же, что у сервера (`pagePaidProblems`).
 */
function PaidDialog({
  page,
  address,
  purpose,
  preset,
  open,
  onClose,
  onSent,
}: {
  page: Page;
  address: PageAddress;
  purpose: PayClaimPurpose;
  /** Месяц из «Перечислить»: выбора месяца нет. */
  preset: string | null;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const id = useId();
  const tax = purpose === 'tax';
  const { taxOpen, feeOpen, def } = paidChoices(page);
  const [month, setMonth] = useState<string | null>(
    tax ? (preset ?? taxOpen[0]?.month ?? null) : (feeOpen[0] ?? null),
  );
  const [own, setOwn] = useState(false);
  const [sum, setSum] = useState(() => fieldSum(def(purpose, month)));
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const mb = 20;
  const problemText = (p: PagePaidProblem) => t(`pub.paid.err.${p.code}`, { mb });
  const what = (m: string | null) => {
    const month = m ? monthLabel(m).toLowerCase() : '';
    return t(`pub.paid.what.${purpose}${m ? '_month' : ''}`, { month });
  };
  const choose = tax && preset === null && taxOpen.length > 1;
  const submit = async () => {
    const amount = parseSom(sum) ?? 0;
    const problems = pagePaidProblems({
      amount,
      month,
      months: tax ? taxOpen.map((m) => m.month) : feeOpen,
      file: file ? { name: file.name, size: file.size } : null,
    });
    if (problems.length) {
      const next: FieldErrors = {};
      for (const p of problems) next[p.field] ??= problemText(p);
      return setErrors(next);
    }
    if (!file) return;
    setBusy(true);
    const failed = await sendPaid(address, { purpose, month, amount, comment: note }, file);
    setBusy(false);
    if (!failed) return onSent();
    const p = serverProblem(failed);
    setErrors(p ? { [p.field]: problemText(p) } : { file: errorText(failed) });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pub.paid.title')}
      sub={page.contractor.name}
      kind="form"
      noMax
      dirty={!!file || note !== '' || own}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-pub-paid-ok=""
            className={buttonClass('cta')}
            disabled={!file || busy}
            title={file ? undefined : t('pub.paid.err.file')}
            onClick={() => void submit()}
          >
            <Icon name="send" size="sm" />
            {t('pub.paid.send')}
          </button>
        </>
      }
    >
      <FormGrid>
        {choose ? (
          <Field id={`${id}-m`} label={t('pub.paid.month')} full error={errors.month}>
            {(control) => (
              <select
                {...control}
                data-pub-paid-month=""
                className={inputClass()}
                value={month ?? ''}
                onChange={(e) => {
                  const m = e.target.value;
                  setMonth(m);
                  setErrors({ ...errors, month: undefined });
                  if (!own) setSum(fieldSum(def(purpose, m)));
                }}
              >
                {taxOpen.map((m) => (
                  <option key={m.month} value={m.month}>
                    {t('pub.paid.month_opt', {
                      month: monthLabel(m.month).toLowerCase(),
                      left: formatSomWithUnit(m.left),
                    })}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field
          id={`${id}-what`}
          label={t('pub.paid.what')}
          full
          error={errors.month && !choose ? errors.month : undefined}
        >
          {(control) => (
            <input
              {...control}
              data-pub-paid-what=""
              readOnly
              aria-live="polite"
              className={inputClass()}
              value={what(month)}
            />
          )}
        </Field>
        <Field
          id={`${id}-sum`}
          label={t('pub.paid.sum')}
          required
          full
          hint={t('pub.paid.sum_hint')}
          error={errors.sum}
        >
          {(control) => (
            <input
              {...control}
              data-pub-paid-sum=""
              inputMode="decimal"
              placeholder={t('pub.paid.sum_ph')}
              className={`${inputClass()} tabular-nums`}
              value={sum}
              onChange={(e) => {
                setOwn(true);
                setSum(e.target.value);
                setErrors({ ...errors, sum: undefined });
              }}
            />
          )}
        </Field>
        <Field
          id={`${id}-f`}
          label={t('pub.paid.file')}
          required
          full
          hint={t('pub.paid.file_hint', { mb })}
          error={errors.file}
        >
          {(control) => (
            <input
              {...control}
              type="file"
              data-pub-paid-file=""
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*"
              className={inputClass()}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setErrors({ ...errors, file: undefined });
              }}
            />
          )}
        </Field>
        <Field id={`${id}-note`} label={t('pub.paid.note')} full>
          {(control) => (
            <textarea
              {...control}
              data-pub-paid-note=""
              maxLength={SENT_FILE_COMMENT_MAX}
              placeholder={t('pub.paid.note_ph')}
              className={`${inputClass()} min-h-[58px] resize-y leading-normal`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <div className="col-span-full flex items-start gap-[9px] rounded-lg border border-line bg-pane-alt px-3 py-[9px] text-[12.5px] leading-[1.45] text-muted">
          <Icon name="info" size="sm" className="mt-px flex-none" />
          <span>{t('pub.paid.info')}</span>
        </div>
      </FormGrid>
    </Modal>
  );
}

/**
 * Окно «Перечислить» (прототип `pubSendDlg`): сколько осталось оплатить за месяц (со «Скопировать
 * сумму»), отчёты с остатком и сроком оплаты, карточка «Налоги» из «Как оплатить» и «Я оплатил» —
 * пока бухгалтер принимает файлы со страницы.
 */
function SendDialog({
  page,
  pay,
  open,
  onClose,
  onPaid,
}: {
  page: Page;
  pay: PageMonthPay;
  open: boolean;
  onClose: () => void;
  onPaid: (() => void) | null;
}) {
  const t = useT();
  const copy = useCopy();
  const a = page.pay?.tax;
  const types = new Map((page.reports?.types ?? []).map((x) => [x.code, x]));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pub.send.title', { month: monthLabel(pay.month).toLowerCase() })}
      sub={page.contractor.name}
      size="mid"
      noMax
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('pub.send.close')}
          </button>
          {onPaid ? (
            <button
              type="button"
              data-pub-send-paid=""
              className={buttonClass('cta')}
              onClick={onPaid}
            >
              <Icon name="check" size="sm" />
              {t('pub.paid.btn')}
            </button>
          ) : null}
        </>
      }
    >
      <div data-pub-send-dlg={pay.month} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[11.5px] text-faint">{t('pub.send.left')}</span>
          <b data-pub-send-left="" className="text-[24px] tabular-nums">
            {formatSomWithUnit(pay.left)}
          </b>
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            onClick={() => void copy(plainSum(pay.left), t('pub.send.copied'))}
          >
            <Icon name="copy" size="sm" />
            {t('pub.send.copy')}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {pay.rows.map((r) => {
            const late = r.payDue !== null && r.payDue < page.today;
            return (
              <div
                key={r.id}
                className="flex flex-col gap-0.5 rounded-lg border border-line bg-raised px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
                  <b>{types.get(r.type)?.short ?? r.type}</b>
                  <span className="text-faint">·</span>
                  <span>{r.period}</span>
                  <span className="grow" />
                  <b className="tabular-nums">{formatSomWithUnit(r.left)}</b>
                </div>
                {r.payDue ? (
                  <span
                    className={`text-[12px] ${late ? 'font-semibold text-danger' : 'text-muted'}`}
                  >
                    {t('pub.send.due', { date: formatDateRu(r.payDue) })}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {a ? <PayCard k="tax" title={t('pub.pay.tax')} icon="wallet" a={a} /> : null}
        {onPaid ? <span className="text-[11.5px] text-faint">{t('pub.send.hint')}</span> : null}
      </div>
    </Modal>
  );
}

type SlotData =
  | { kind: 'paid'; purpose: PayClaimPurpose; preset: string | null }
  | { kind: 'send'; month: string };
type Slot = SlotData & { n: number };

/**
 * Окна «Я оплатил» и «Перечислить» страницы: `paid(вид, месяц)` и `send(месяц)` открывают их,
 * `dialogs` — в разметку страницы. После «Я оплатил» — уведомление и данные страницы с сервера заново.
 */
export function usePagePaid(page: Page, address: PageAddress) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [open, setOpen] = useState(false);
  const upload = !!page.sent?.upload;
  const show = (s: SlotData) => {
    setSlot({ ...s, n: (slot?.n ?? 0) + 1 });
    setOpen(true);
  };
  const paid = (purpose: PayClaimPurpose, preset: string | null = null) =>
    show({ kind: 'paid', purpose, preset });
  const send = (month: string) => show({ kind: 'send', month });
  const sendPay =
    slot?.kind === 'send' ? page.reports?.months?.find((m) => m.month === slot.month) : undefined;
  let dialogs: ReactNode = null;
  if (slot?.kind === 'paid') {
    dialogs = (
      <PaidDialog
        key={`pub-paid-${slot.n}`}
        page={page}
        address={address}
        purpose={slot.purpose}
        preset={slot.preset}
        open={open}
        onClose={() => setOpen(false)}
        onSent={() => {
          setOpen(false);
          toast(t('pub.paid.done'), { icon: 'check' });
          // Пометки «Ожидает подтверждения» и «Отправленные вами» — с сервера заново.
          router.refresh();
        }}
      />
    );
  } else if (slot?.kind === 'send' && sendPay) {
    const month = slot.month;
    dialogs = (
      <SendDialog
        key={`pub-send-${slot.n}`}
        page={page}
        pay={sendPay}
        open={open}
        onClose={() => setOpen(false)}
        onPaid={upload ? () => paid('tax', month) : null}
      />
    );
  }
  return { paid: upload ? paid : null, send, dialogs };
}
