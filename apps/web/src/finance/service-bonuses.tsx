'use client';

import { formatDateRu, formatSom, formatSomWithUnit, parseSom } from '@buhuchet/domain';
import type { ServiceCard } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  KeyValues,
  Note,
} from '@buhuchet/ui';
import { useId, useRef } from 'react';
import type { Translate } from '../l10n/translate';
import { serviceBonusList } from './finance-history';

/*
 * «Бонусы сотрудникам» разовой услуги (прототип v84 и v87, modules/services.js — `serviceDlg`: строки
 * «сотрудник — сумма» и «Добавить бонус»; `serviceCard`: блок «Бонусы сотрудникам · сумма»). Бонус
 * начисляется, когда услуга оплачена полностью; правила строк — `serviceBonusProblem` домена, сервер
 * проверяет их ещё раз.
 */

type CardBonuses = NonNullable<ServiceCard['bonuses']>;

/** Строка блока в окне услуги: сумма — как введена. */
export interface BonusDraftRow {
  key: number;
  employeeId: string;
  amount: string;
}

/** Строки окна из бонусов услуги. */
export const bonusDraftOf = (bonuses: ServiceCard['bonuses']): BonusDraftRow[] =>
  (bonuses?.lines ?? []).map((b, key) => ({
    key,
    employeeId: b.employeeId,
    amount: formatSom(b.amount, 'auto'),
  }));

/** Заполненные строки для проверки и запроса (прототип: пустая строка не считается). */
export const bonusLinesOf = (rows: readonly BonusDraftRow[]) =>
  rows
    .filter((b) => b.employeeId || b.amount.trim())
    .map((b) => ({ employeeId: b.employeeId || null, amount: parseSom(b.amount) }));

/** Блок окна услуги — с правом «Списывать остаток в бонус». */
export function ServiceBonusRows({
  t,
  rows,
  employees,
  performer,
  error,
  onChange,
}: {
  t: Translate;
  rows: readonly BonusDraftRow[];
  /** Действующие сотрудники и те, кто уже в бонусах услуги. */
  employees: readonly { id: string; name: string }[];
  /** «Исполнитель» окна: его подставляет первая строка. */
  performer: string;
  error?: string;
  onChange: (rows: BonusDraftRow[]) => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const set = (key: number, patch: Partial<BonusDraftRow>) =>
    onChange(rows.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const add = () => {
    const key = rows.reduce((max, b) => Math.max(max, b.key), -1) + 1;
    onChange([...rows, { key, employeeId: rows.length ? '' : performer, amount: '' }]);
    // Прототип: курсор — в сумму новой строки.
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLInputElement>(`[data-svc-bonus-amount="${key}"]`)?.focus(),
    );
  };
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={error ? `${id}-err` : `${id}-hint`}
      data-svc-bonuses=""
      className="col-span-full flex min-w-0 flex-col gap-[5px]"
    >
      <span id={`${id}-label`} className="text-[12px] font-semibold tracking-[.01em] text-muted">
        {t('fin.svc.bonus.label')}
      </span>
      {rows.length ? (
        <div ref={list} className="flex flex-col gap-1.5">
          {rows.map((b) => (
            <div
              key={b.key}
              data-svc-bonus-row=""
              className="grid grid-cols-[minmax(0,1fr)_150px_30px] items-center gap-2 max-md:grid-cols-[minmax(0,1fr)_110px_30px]"
            >
              <select
                aria-label={t('fin.svc.bonus.emp')}
                aria-invalid={error ? true : undefined}
                data-svc-bonus-emp=""
                className={`${inputClass()} cursor-pointer`}
                value={b.employeeId}
                onChange={(e) => set(b.key, { employeeId: e.target.value })}
              >
                <option value="">{t('fin.svc.bonus.emp_pick')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                aria-label={t('fin.svc.bonus.amount')}
                aria-invalid={error ? true : undefined}
                placeholder={t('fin.svc.bonus.amount_ph')}
                data-svc-bonus-amount={b.key}
                className={`${inputClass()} tabular-nums`}
                value={b.amount}
                onChange={(e) => set(b.key, { amount: e.target.value })}
              />
              <button
                type="button"
                title={t('fin.svc.bonus.remove')}
                aria-label={t('fin.svc.bonus.remove_aria')}
                data-svc-bonus-remove=""
                className={iconButtonClass('sm')}
                onClick={() => onChange(rows.filter((x) => x.key !== b.key))}
              >
                <Icon name="x" size="sm" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        data-svc-bonus-add=""
        className={`${buttonClass('default', 'sm')} self-start`}
        onClick={add}
      >
        <Icon name="plus" size="sm" />
        {t('fin.svc.bonus.add')}
      </button>
      <div id={`${id}-hint`}>
        <Hint>{t('fin.svc.bonus.hint')}</Hint>
      </div>
      {error ? (
        <div
          id={`${id}-err`}
          role="alert"
          data-svc-bonus-error=""
          className="flex items-start gap-[5px] text-[12px] text-danger"
        >
          <Icon name="alert" size="sm" className="mt-px" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Окно «Изменить» без права на бонусы: какие бонусы у услуги и кто их меняет. */
export function ServiceBonusNote({ t, bonuses }: { t: Translate; bonuses: CardBonuses }) {
  return (
    <div className="col-span-full" data-svc-bonus-note="">
      <Note icon="gift">
        {t('fin.svc.bonus.note', {
          list: serviceBonusList(
            t,
            bonuses.lines.map((b) => ({ name: b.short, amount: b.amount })),
          ),
        })}
      </Note>
    </div>
  );
}

/** Блок карточки услуги: строки, сумма и что с начислением. */
export function ServiceBonusBox({
  t,
  bonuses,
  deleted,
  paid,
  amount,
}: {
  t: Translate;
  bonuses: CardBonuses;
  deleted: boolean;
  paid: number;
  amount: number;
}) {
  return (
    <Box title={t('fin.svc.bonus.box', { amount: formatSomWithUnit(bonuses.total) })}>
      <div data-svc-bonus-box="" className="flex flex-col gap-2">
        <KeyValues
          items={bonuses.lines.map((b) => ({
            id: b.employeeId,
            label: b.name,
            value: <span className="tabular-nums">{formatSomWithUnit(b.amount)}</span>,
          }))}
        />
        <Hint>
          {deleted
            ? t('fin.svc.bonus.deleted')
            : bonuses.on
              ? t('fin.svc.bonus.on', { date: formatDateRu(bonuses.on) })
              : t('fin.svc.bonus.wait', {
                  paid: formatSomWithUnit(paid),
                  amount: formatSomWithUnit(amount),
                })}
        </Hint>
      </div>
    </Box>
  );
}
