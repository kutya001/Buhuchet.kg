'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  monthLabelGen,
  monthNameIn,
} from '@buhuchet/domain';
import type { ContractorFees } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Icon,
  MiniTable,
  Note,
  Pill,
  Plate,
  Plates,
  StatusPill,
  Tag,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { statusPillView } from '../status/status-view';
import { TariffDialog } from './fee-dialogs';
import { contractorFeesQuery, useFeesRefresh } from './fees-data';

/*
 * Вкладка «Обслуживание» карточки контрагента (задача 2.21; ТЗ «Контрагенты» → «Плата за
 * обслуживание»; прототип modules/contractor-card.js, `st.tab==='fee'`): плашки «Текущая ставка» и
 * «Долг за обслуживание», кнопки «Новая ставка», «Напомнить в WhatsApp», «Принять оплату за
 * обслуживание», таблицы «Начисления и оплаты», «Оплаты · N» и «Журнал тарифов». Видна при «Плате за
 * обслуживание», с правом «Видеть плату» и у постоянного контрагента; данные и права проверяет сервер.
 */

const Hint = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11.5px] leading-[1.4] text-faint">{children}</span>
);

/** Целые сомы на плашке (прототип `fmtM(…, false)`). */
const whole = (tyiyn: number) => formatSom(Math.round(tyiyn / 100) * 100, 'auto');

/** Плашка «Текущая ставка»: в месяц — «с октября 2026, оплата до 10-го», в год — месяц начисления. */
function tariffSub(t: Translate, f: ContractorFees): string {
  const ct = f.current;
  if (!ct) return '';
  return ct.period === 'Y'
    ? t('fee.plate.tariff_year', { month: monthNameIn(ct.from), day: f.contractor.feeDay })
    : t('fee.plate.tariff_month', { from: monthLabelGen(ct.from), day: f.contractor.feeDay });
}

/**
 * «Начисления и оплаты»: от новых месяцев к старым, только месяцы с начислением (прототип: начисление
 * или `feePaid` месяца, а `feePaid` бывает только у месяца с начислением — распределить оплату можно
 * лишь на недоплату). Оплаты демо-данных за месяцы до первой ставки журнала видны только в «Оплатах».
 */
function MonthsBox({ t, f }: { t: Translate; f: ContractorFees }) {
  const today = bishkekDate(new Date());
  const start = f.contractor.startDate;
  const firstPartial = start.slice(8) !== '01' ? start.slice(0, 7) : null;
  const months = [...f.months].reverse().filter((m) => m.charge > 0);
  return (
    <Box title={t('fee.months.title')}>
      <MiniTable
        label={t('fee.months.title')}
        empty={t('fee.months.empty')}
        columns={[
          { key: 'month', label: t('fee.col.month') },
          { key: 'charge', label: t('fee.col.charged'), numeric: true },
          { key: 'paid', label: t('fee.col.paid'), numeric: true },
          { key: 'status', label: t('fee.col.status') },
        ]}
        rows={months.map((m) => {
          const pill = statusPillView(t, 'payment', m.status);
          return {
            key: m.month,
            cells: {
              month: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {monthLabel(m.month)}
                  {m.month === firstPartial ? (
                    <Tag title={t('fee.months.first_tip')}>
                      {t('fee.months.first', { day: Number(start.slice(8)) })}
                    </Tag>
                  ) : null}
                </span>
              ),
              charge: formatSom(m.charge),
              paid: (
                <span className="inline-flex flex-wrap items-center gap-1.5 md:justify-end">
                  {formatSom(m.got)}
                  {m.fromAdvance ? (
                    <Tag
                      title={t('fee.months.from_advance_tip', {
                        amount: formatSomWithUnit(m.fromAdvance),
                      })}
                    >
                      {t('fee.months.from_advance')}
                    </Tag>
                  ) : null}
                </span>
              ),
              // На телефоне ячейка — столбец во всю ширину: обёртка держит плашку по размеру текста.
              status: (
                <span className="flex">
                  {m.status !== 'paid' && m.due < today ? (
                    <Pill tone="bad" icon="alert">
                      {pill.label}
                    </Pill>
                  ) : (
                    <StatusPill {...pill} />
                  )}
                </span>
              ),
            },
          };
        })}
      />
    </Box>
  );
}

/** «Оплаты · N»: последние 24, «За месяц» — первый закрытый месяц или «аванс». */
function PaymentsBox({ t, f }: { t: Translate; f: ContractorFees }) {
  const title = t('fee.pays.title', { n: f.paymentsTotal });
  return (
    <Box title={title}>
      {f.payments.length ? (
        <>
          <MiniTable
            label={title}
            empty=""
            columns={[
              { key: 'date', label: t('fee.col.date') },
              { key: 'month', label: t('fee.col.for_month') },
              { key: 'by', label: t('fee.col.by') },
              { key: 'amount', label: t('fee.col.amount'), numeric: true },
            ]}
            rows={f.payments.map((p) => ({
              key: p.id,
              cells: {
                date: formatDateRu(p.date),
                month: (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {p.allocation[0] ? monthLabel(p.allocation[0].month) : t('fee.pays.advance')}
                    {p.fromReceipt ? <Tag>{t('fee.pays.from_receipt')}</Tag> : null}
                  </span>
                ),
                by: p.author ?? '—',
                amount: formatSom(p.amount),
              },
            }))}
          />
          {f.paymentsTotal > f.payments.length ? (
            <Hint>{t('fee.pays.more', { n: f.payments.length })}</Hint>
          ) : null}
        </>
      ) : (
        <span className="text-faint">{t('fee.pays.empty')}</span>
      )}
    </Box>
  );
}

/** «Журнал тарифов»: от новых к старым; записи не меняются и не удаляются. */
function TariffsBox({ t, f }: { t: Translate; f: ContractorFees }) {
  return (
    <Box title={t('fee.tariffs.title')}>
      <ul aria-label={t('fee.tariffs.title')} className="m-0 list-none p-0" data-fee-tariffs="">
        {f.tariffs.map((x) => (
          <li
            key={x.id}
            className="grid grid-cols-[92px_minmax(0,1fr)] gap-2.5 border-b border-line py-[7px] text-[13px] last:border-b-0"
          >
            <span className="text-[12px] text-faint">
              {t('fee.tariffs.from', { month: monthLabelGen(x.from) })}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <b className="tabular-nums">{formatSomWithUnit(x.amount)}</b>{' '}
              {t(x.period === 'Y' ? 'fee.tariffs.per_year' : 'fee.tariffs.per_month')}
              <br />
              <span className="text-[12px] text-muted">
                {x.note} · {x.author ?? '—'}, {formatDateRu(x.at)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Hint>{t('fee.tariffs.hint')}</Hint>
    </Box>
  );
}

export function ContractorFeesTab({
  contractorId,
  onAccept,
  onRemind,
}: {
  contractorId: string;
  onAccept: () => void;
  onRemind: () => void;
}) {
  const t = useT();
  const query = useQuery(contractorFeesQuery(contractorId));
  const refresh = useFeesRefresh();
  const [tariff, setTariff] = useState<DialogSlot<null> | null>(null);
  const f = query.data;
  if (query.isError && !f) return <Note tone="bad">{t('cp.card.load_error')}</Note>;
  if (!f) return null;
  const ct = f.current;
  const debtSub = t(f.debt ? 'fee.plate.debt_late' : 'fee.plate.debt_none');
  const iconsOnPhone = f.canAccept || (f.canTariff && f.canRemind);
  const label = iconsOnPhone ? 'max-md:hidden' : undefined;
  return (
    <div data-fee-tab="" className="flex min-w-0 flex-col gap-3.5">
      <Plates static>
        <Plate
          id="tar"
          icon="coins"
          color="blue"
          label={t('fee.plate.tariff')}
          value={ct ? whole(ct.amount) : '—'}
          unit={t(ct?.period === 'Y' ? 'fee.plate.unit_year' : 'fee.plate.unit_month')}
          sub={tariffSub(t, f)}
        />
        <Plate
          id="debt"
          icon="alert"
          color={f.debt ? 'red' : 'green'}
          label={t('fee.plate.debt')}
          value={whole(f.debt)}
          unit={t('fee.plate.unit')}
          sub={
            f.advance
              ? t('fee.plate.with_advance', { text: debtSub, amount: whole(f.advance) })
              : debtSub
          }
        />
      </Plates>
      {/*
        Прототип `.row.acts` (`mActsFit`): на телефоне одна строка; если кнопки с подписями не помещаются
        (есть главная «Принять оплату…» или обе другие), у кнопок кроме главной — только значок.
      */}
      {f.canTariff || f.canRemind || f.canAccept ? (
        <div className="flex flex-wrap items-center justify-end gap-2 max-md:flex-nowrap max-md:[&>button]:min-h-10">
          {f.canTariff ? (
            <button
              type="button"
              data-fee-tariff=""
              className={`${buttonClass('default', 'sm')} ${iconsOnPhone ? 'max-md:px-2.5' : ''}`}
              title={t('fee.btn.tariff')}
              aria-label={t('fee.btn.tariff')}
              onClick={() => setTariff(openSlot(null))}
            >
              <Icon name="plus" size="sm" />
              <span className={label}>{t('fee.btn.tariff')}</span>
            </button>
          ) : null}
          {f.canRemind ? (
            <button
              type="button"
              data-fee-remind=""
              className={`${buttonClass('default', 'sm')} ${iconsOnPhone ? 'max-md:px-2.5' : ''}`}
              title={t('fee.btn.remind')}
              aria-label={t('fee.btn.remind')}
              onClick={onRemind}
            >
              <Icon name="chat" size="sm" />
              <span className={label}>{t('fee.btn.remind')}</span>
            </button>
          ) : null}
          {f.canAccept ? (
            <button
              type="button"
              data-fee-accept=""
              className={buttonClass('cta', 'sm')}
              onClick={onAccept}
            >
              <Icon name="wallet" size="sm" />
              {t('fee.btn.accept')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3.5 max-[900px]:grid-cols-1">
        <MonthsBox t={t} f={f} />
        <PaymentsBox t={t} f={f} />
        <TariffsBox t={t} f={f} />
      </div>
      {tariff ? (
        <TariffDialog
          key={`tariff-${tariff.n}`}
          fees={f}
          open={tariff.open}
          onClose={() => setTariff(closeSlot)}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}
