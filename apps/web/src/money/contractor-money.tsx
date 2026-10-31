'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  scopeOf,
} from '@buhuchet/domain';
import type { Contractor, ContractorMoney } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  Icon,
  inputClass,
  KeyValues,
  MiniTable,
  Note,
  Plate,
  Plates,
  Pill,
  useToast,
  type IconName,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useReportActions } from '../reports/report-actions';
import { useShell } from '../shell/context';
import { ReceiptDialog } from './tax-dialogs';
import { contractorMoneyQuery, saveMoneySettings, useMoneyRefresh } from './tax-data';

/*
 * Деньги контрагента (задача 2.19; ТЗ «Контрагенты» → вкладка «Деньги», «Баланс по контрагенту»;
 * прототип modules/contractor-card.js — вкладка `money`, блок «Баланс по контрагенту», строки «Файл при
 * поступлении» и «Деньги на налоги переводит» на «Основном»). Всё — при «Учёте оплаты налогов»; данные и
 * область «Финансовые операции» проверяет сервер. «Списать в бонус», «Вернуть остаток», «Перевод» и окно
 * операции добавят задачи 2.20 и 2.22.
 */

const Hint = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11.5px] leading-[1.4] text-faint">{children}</span>
);

/** Целые сомы на плашке (прототип `fmtM(…, false)`). */
const whole = (tyiyn: number) => formatSom(Math.round(tyiyn / 100) * 100, 'auto');

/**
 * Вкладка «Деньги» видна (прототип openCp `tabs`): «Учёт оплаты налогов», право «Видеть финансовые
 * операции» или «Учёт денег», контрагент в области группы «Финансовые операции».
 */
export function useMoneyTabOn(c: { responsible: { id: string } | null } | null): boolean {
  const { access, editor, employeeId } = useShell();
  if (!c || !access.feature('taxpay')) return false;
  if (!access.can('finView') && !access.can('money')) return false;
  const all = editor ? scopeOf(editor.subject, 'fin') === 'all' : false;
  return all || (!!employeeId && c.responsible?.id === employeeId);
}

/** Сверка (прототип `.verdict`): недостача — красным, достаточно — зелёным, излишек — синим. */
function Verdict({ t, m }: { t: Translate; m: ContractorMoney }) {
  const { state, amount } = m.verdict;
  const look: Record<typeof state, { cls: string; icon: IconName; value: string }> = {
    short: { cls: 'bg-danger-bg text-danger', icon: 'alert', value: formatSom(amount) },
    enough: { cls: 'bg-ok-bg text-ok', icon: 'ok', value: formatSom(0) },
    enough_surplus: { cls: 'bg-ok-bg text-ok', icon: 'ok', value: `+${formatSom(amount)}` },
    surplus: { cls: 'bg-info-bg text-info', icon: 'info', value: `+${formatSom(amount)}` },
  };
  const v = look[state];
  return (
    <div
      data-money-verdict={state}
      className={`flex items-center gap-3 rounded-lg px-3.5 py-3 font-[650] max-md:px-3 max-md:py-2.5 ${v.cls}`}
    >
      <Icon name={v.icon} />
      <span>{t(`money.tab.verdict.${state}`)}</span>
      <span className="ml-auto text-[20px] tabular-nums max-md:text-[17px]">{v.value}</span>
    </div>
  );
}

type PillTone = NonNullable<Parameters<typeof Pill>[0]['tone']>;

/** Вид операции: цвет и знак суммы (прототип OPK, OP_SELF). */
const OP_LOOK: Record<string, { tone: PillTone; sign: '+' | '−' | '' }> = {
  in: { tone: 'ok', sign: '+' },
  pay: { tone: 'info', sign: '−' },
  bonus: { tone: 'violet', sign: '−' },
  refund: { tone: 'caution', sign: '−' },
  back: { tone: 'ok', sign: '+' },
  corr: { tone: 'warn', sign: '' },
  xfer: { tone: 'plain', sign: '' },
};

type Operation = ContractorMoney['operations'][number];

/** «Основание» операции (прототип `note`): «За НДС 09.2026», «Аванс», «Оплата контрагентом напрямую · …». */
export function operationBasis(t: Translate, o: Operation): string {
  const list = o.reports.join(', ');
  if (o.kind === 'in') return list ? t('money.op.basis_in', { list }) : t('money.op.basis_advance');
  if (o.kind === 'pay' && o.self) return t('money.op.basis_self', { report: list });
  return list || '—';
}

function OperationsBox({ t, m }: { t: Translate; m: ContractorMoney }) {
  return (
    <Box title={t('money.tab.ops_title', { n: m.operations.length })}>
      <MiniTable
        label={t('money.tab.ops_title', { n: m.operations.length })}
        empty={t('money.tab.ops_empty')}
        columns={[
          { key: 'date', label: t('money.tab.col_date') },
          { key: 'op', label: t('money.tab.col_op') },
          { key: 'basis', label: t('money.tab.col_basis') },
          { key: 'author', label: t('money.tab.col_author') },
          { key: 'amount', label: t('money.tab.col_amount'), numeric: true },
        ]}
        rows={m.operations.map((o) => {
          const self = o.kind === 'pay' && o.self;
          const look = self ? { tone: 'plain' as const, sign: '' } : OP_LOOK[o.kind]!;
          return {
            key: o.id,
            cells: {
              date: formatDateRu(o.date),
              op: (
                <Pill tone={look.tone} size="sm">
                  {t(self ? 'money.op.self' : `money.op.${o.kind}`)}
                </Pill>
              ),
              basis: <span className="whitespace-normal">{operationBasis(t, o)}</span>,
              author: o.author ?? '—',
              amount: (
                <span className={look.sign === '+' ? 'text-ok' : undefined}>
                  {look.sign}
                  {formatSom(Math.abs(o.amount))}
                </span>
              ),
            },
          };
        })}
      />
    </Box>
  );
}

/**
 * Вкладка «Деньги» (прототип openCp, `st.tab==='money'`): месяц сверки (два прошлых, текущий и
 * следующий), плашки «Нужно оплатить» и «Поступило и не потрачено», итог сверки, отложенное под отчёты с
 * более поздним сроком, «Поступление», «Что нужно оплатить» (строка открывает карточку отчёта) и
 * операции от новых к старым.
 */
export function ContractorMoneyTab({ contractorId }: { contractorId: string }) {
  const t = useT();
  const { access } = useShell();
  const [month, setMonth] = useState<string | null>(null);
  const query = useQuery(contractorMoneyQuery(contractorId, month));
  const reports = useReportActions();
  const refresh = useMoneyRefresh();
  const [receive, setReceive] = useState<DialogSlot<null> | null>(null);
  const m = query.data;
  if (query.isError && !m) return <Note tone="bad">{t('money.tab.load_error')}</Note>;
  if (!m) return null;
  const org = m.contractor.paysTo === 'org';
  const today = bishkekDate(new Date());
  const holder = (m.contractor.holder ?? '').replace(/\.$/, '');
  return (
    <div data-money-tab="" className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">{t('money.tab.period')}</span>
        <select
          className={`${inputClass({ full: false })} min-h-[30px] w-auto cursor-pointer px-2 py-[3px]`}
          aria-label={t('money.tab.period')}
          data-money-month=""
          value={m.month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {m.months.map((x) => (
            <option key={x} value={x}>
              {monthLabel(x as `${number}-${number}`)}
            </option>
          ))}
        </select>
      </div>
      <Plates static>
        <Plate
          id="need"
          icon="file"
          color={m.needSum ? 'yellow' : 'green'}
          label={t('money.tab.need')}
          value={whole(m.needSum)}
          unit={t('report.plate.som')}
          sub={
            m.need.length ? t('money.tab.need_sub', { n: m.need.length }) : t('money.tab.need_none')
          }
        />
        <Plate
          id="have"
          icon="wallet"
          color="blue"
          label={t('money.tab.have')}
          value={whole(m.balance.available)}
          unit={t('report.plate.som')}
          sub={t(org ? 'money.tab.have_org' : 'money.tab.have_emp')}
        />
      </Plates>
      <Verdict t={t} m={m} />
      {m.laterSum ? (
        <Note icon="clock">
          {t('money.tab.later', {
            amount: formatSomWithUnit(m.laterSum),
            list: m.later
              .map((r) =>
                t('money.tab.later_item', { report: r.label, date: formatDateRu(r.payDue) }),
              )
              .join('; '),
          })}
        </Note>
      ) : null}
      {m.canReceive ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            data-money-receive=""
            className={buttonClass('cta', 'sm')}
            onClick={() => setReceive(openSlot(null))}
          >
            <Icon name="plus" size="sm" />
            {t('money.tab.receive')}
          </button>
        </div>
      ) : null}
      <Box title={t('money.tab.need_title', { n: m.need.length })}>
        {m.need.length ? (
          <MiniTable
            label={t('money.tab.need_title', { n: m.need.length })}
            empty=""
            onOpen={(id) => id !== 'total' && reports.openCard({ id })}
            columns={[
              { key: 'report', label: t('money.tab.col_report') },
              { key: 'payDue', label: t('money.tab.col_pay_due') },
              { key: 'left', label: t('money.tab.col_left'), numeric: true },
            ]}
            rows={[
              ...m.need.map((r) => ({
                key: r.reportId,
                cells: {
                  report: r.label,
                  payDue: (
                    <span className={r.payDue < today ? 'font-semibold text-danger' : undefined}>
                      {formatDateRu(r.payDue)}
                    </span>
                  ),
                  left: formatSom(r.amount),
                },
              })),
              {
                key: 'total',
                cells: {
                  report: <b>{t('money.tab.total')}</b>,
                  payDue: '',
                  left: <b>{formatSom(m.needSum)}</b>,
                },
              },
            ]}
          />
        ) : (
          <span className="text-faint">{t('money.tab.need_empty')}</span>
        )}
        <Hint>
          {org ? t('money.tab.hint_org') : t('money.tab.hint_emp', { name: holder || '—' })}
        </Hint>
      </Box>
      <OperationsBox t={t} m={m} />
      {receive ? (
        <ReceiptDialog
          key={`receive-${receive.n}`}
          contractorId={contractorId}
          preset={null}
          canUpload={access.feature('files') && access.can('filesUpload')}
          open={receive.open}
          onClose={() => setReceive(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {reports.dialogs}
    </div>
  );
}

/**
 * «Баланс по контрагенту» на «Основном» (прототип: блок после страницы контрагента): получено, оплачено
 * в бюджет (из них контрагент оплатил сам), списано в бонус, остаток на счёте. Виден с правом «Учёт
 * денег» и только по контрагенту в области «Финансовые операции».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-15 — в прототипе блок виден с правом «Учёт денег» по любому контрагенту.
export function ContractorBalanceBox({ contractorId }: { contractorId: string }) {
  const t = useT();
  const { access } = useShell();
  const on = access.feature('taxpay') && access.can('money');
  const m = useQuery({
    ...contractorMoneyQuery(contractorId, null),
    enabled: on,
    retry: false,
  }).data;
  if (!on || !m) return null;
  const b = m.balance;
  const items: KeyValueItem[] = [
    { id: 'received', label: t('money.cp.received'), value: formatSomWithUnit(b.received) },
    {
      id: 'paid',
      label: t('money.cp.paid'),
      value: (
        <>
          {formatSomWithUnit(b.paid)}
          {b.selfPaid ? (
            <Hint>{t('money.cp.self_paid', { amount: formatSomWithUnit(b.selfPaid) })}</Hint>
          ) : null}
        </>
      ),
    },
    { id: 'bonus', label: t('money.cp.bonus'), value: formatSomWithUnit(b.bonus) },
    {
      id: 'available',
      label: t('money.cp.available'),
      value: <b>{formatSomWithUnit(b.available)}</b>,
    },
  ];
  return (
    <div data-money-balance="">
      <Box title={t('money.cp.balance')}>
        <KeyValues items={items} />
      </Box>
    </div>
  );
}

/**
 * Строки «Файл при поступлении» и «Деньги на налоги переводит» на «Основном» (прототип `#cp-needf`,
 * `#cp-pays`): при «Учёте оплаты налогов»; менять — с правом «Создавать и изменять контрагентов»,
 * у архивного — только смотреть. Сохраняется сразу, с версией записи.
 */
export function useMoneySettingsItems(c: Contractor): KeyValueItem[] {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useMoneyRefresh();
  const { access } = useShell();
  const [busy, setBusy] = useState(false);
  if (!access.feature('taxpay')) return [];
  const edit = access.can('createCp');
  const live = c.serviceStatus !== 'archived';
  const save = async (body: { needReceiptFile?: boolean; paysTo?: 'emp' | 'org' }) => {
    setBusy(true);
    const res = await saveMoneySettings(c.id, { version: c.version, ...body });
    setBusy(false);
    refresh();
    if (!res.ok) return toast(errorText(res.error), { icon: 'alert', bad: true });
    toast(t('money.cp.saved'));
  };
  return [
    {
      id: 'need-file',
      label: t('money.cp.need_file'),
      value: (
        <span data-money-need-file="">
          <CheckRow
            plain
            compact
            checked={c.needReceiptFile}
            disabled={!edit || !live || busy}
            onChange={(on) => void save({ needReceiptFile: on })}
            label={t('money.cp.need_file_on')}
          />
          <Hint>{t('money.cp.need_file_hint')}</Hint>
        </span>
      ),
    },
    {
      id: 'pays-to',
      label: t('money.cp.pays_to'),
      value: edit ? (
        <select
          className={`${inputClass({ full: false })} min-h-[30px] w-auto cursor-pointer px-2 py-[3px]`}
          aria-label={t('money.cp.pays_to')}
          data-money-pays-to=""
          value={c.paysTo}
          disabled={busy}
          onChange={(e) => void save({ paysTo: e.target.value as 'emp' | 'org' })}
        >
          <option value="emp">{t('money.cp.pays_to.emp')}</option>
          <option value="org">{t('money.cp.pays_to.org')}</option>
        </select>
      ) : (
        t(`money.cp.pays_to.${c.paysTo}`)
      ),
    },
  ];
}
