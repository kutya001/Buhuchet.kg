'use client';

import { CP_NOTICE_DAYS, weekDayOf } from '@buhuchet/domain';
import type { OrgPolicy } from '@buhuchet/shared';
import { Field, inputClass } from '@buhuchet/ui';
import { useId, useState } from 'react';
import { NoticeRow } from '../telegram/notice-row';
import type { NoticeSave } from '../telegram/notices';
import { useT } from '../l10n/provider';
import { cpDaysText } from './notice-days';

/** Переключатели строк контрагентов — поля учётной политики. */
export type ContractorNoticeField = 'cpTgPay' | 'cpTgDebt';

type CpPolicy = Pick<
  OrgPolicy,
  'cpTgPay' | 'cpTgDebt' | 'cpPayDays' | 'cpPayAt' | 'cpFeeDays' | 'cpFeeAt' | 'cpDebtWeekDay'
> & { features: Pick<OrgPolicy['features'], 'fee'> };

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const HM = /^\d\d:\d\d$/;

/** Галочки «за 5» … «за 1 день» (прототип `pgDaysSet`): хотя бы одна остаётся отмеченной. */
function DaysField({
  id,
  code,
  days,
  disabled,
  onSave,
}: {
  id: string;
  code: 'p' | 'f';
  days: readonly number[];
  disabled: boolean;
  onSave: (days: number[]) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | undefined>();
  return (
    <div className="flex-[1_1_100%]" data-tgn-days={code}>
      <Field id={id} label={t('tgn.cp.days_label')} error={error}>
        <div
          id={id}
          role="group"
          aria-label={t('tgn.cp.days_label')}
          className="flex flex-wrap gap-x-4 gap-y-1.5 py-1"
        >
          {CP_NOTICE_DAYS.map((d) => (
            <label
              key={d}
              className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]"
            >
              <input
                type="checkbox"
                data-tgn-day={`${code}:${d}`}
                className="m-0"
                checked={days.includes(d)}
                disabled={disabled}
                onChange={(e) => {
                  const next = CP_NOTICE_DAYS.filter((x) =>
                    x === d ? e.target.checked : days.includes(x),
                  );
                  if (!next.length) {
                    setError(t('tgn.cp.days_required'));
                    return;
                  }
                  setError(undefined);
                  onSave(next);
                }}
              />
              <span>{d === 1 ? t('tgn.cp.day_1') : t('tgn.cp.day', { n: d })}</span>
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

/**
 * «Время отправки» (прототип `pgAtSet`): сохраняется, когда поле оставили (или Enter), как «Час
 * напоминаний» того же блока; пустое время не сохраняется молча — «Укажите время», прежнее остаётся.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-11
function AtField({
  id,
  code,
  value,
  disabled,
  onSave,
}: {
  id: string;
  code: 'p' | 'f';
  value: string;
  disabled: boolean;
  onSave: (at: string) => void;
}) {
  const t = useT();
  const [at, setAt] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const [seen, setSeen] = useState(value);
  // Сохранили в другой вкладке или откатили — поле показывает значение с сервера.
  if (seen !== value) {
    setSeen(value);
    setAt(value);
  }
  const commit = () => {
    if (disabled) return;
    if (!HM.test(at)) {
      setError(t('tgn.cp.at_required'));
      setAt(value);
      return;
    }
    if (at !== value) onSave(at);
  };
  return (
    <div className="w-[220px] max-w-full">
      <Field id={id} label={t('tgn.cp.at_label')} error={error}>
        {(c) => (
          <input
            {...c}
            type="time"
            data-tgn-at={code}
            value={at}
            disabled={disabled}
            onChange={(e) => {
              setAt(e.target.value);
              setError(undefined);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={inputClass()}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * Строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления» (пакет 14.11.2026, блок 3,
 * этап 2; прототип v115 `pgTgNoticeRows`, `pgTgNoticeMount` в modules/cp-telegram.js). Переключатели —
 * «Отправлять «К оплате» контрагентам» и «Напоминать контрагентам о долге» учётной политики. «К оплате»
 * уходит в отмеченные дни до ближайшего срока оплаты месяца в своё время; «Оплата за обслуживание» —
 * в отмеченные дни до дня оплаты обслуживания (при функции «Плата за обслуживание»), после срока —
 * напоминание о долге раз в неделю в выбранный день; время одно на оба. Всё сохраняется сразу; меняет
 * только владелец. Ставятся, только когда включены «Напоминания в Telegram» и «Страница контрагента».
 */
export function ContractorNoticeRows({
  policy,
  own,
  busy,
  save,
}: {
  policy: CpPolicy;
  /** Меняет только владелец организации. */
  own: boolean;
  busy: boolean;
  save: NoticeSave;
}) {
  const t = useT();
  const id = useId();
  const why = own ? undefined : t('tgn.owner_only');
  const only = t('tgn.cp.only');
  const off = !own || busy;
  const fee = policy.features.fee;
  const wd = weekDayOf(policy.cpDebtWeekDay);
  const payName = t('tgn.cp_pay.title');
  const feeName = t('tgn.cp_fee.title');
  const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const toggle = (field: ContractorNoticeField, on: boolean) =>
    void save(
      { [field]: on },
      t('cppage.org.toggled', {
        name: t(field === 'cpTgPay' ? 'cppage.org.pay' : 'cppage.org.debt'),
        state: t(on ? 'org.history.on' : 'org.history.off'),
      }),
    );
  return (
    <>
      <NoticeRow
        id="cpPay"
        title={payName}
        to="cp"
        on={policy.cpTgPay}
        disabled={off}
        why={why}
        onToggle={(on) => toggle('cpTgPay', on)}
        hint={`${t('tgn.cp_pay.hint')} ${only}`}
        days={t('tgn.cp_pay.days', { days: cpDaysText(t, policy.cpPayDays) })}
        at={policy.cpPayAt}
        often={t('tgn.cp_pay.often')}
      >
        <DaysField
          id={`${id}-pd`}
          code="p"
          days={policy.cpPayDays}
          disabled={off}
          onSave={(days) =>
            void save(
              { cpPayDays: days },
              t('tgn.cp.days_saved', { name: payName, days: cpDaysText(t, days) }),
            )
          }
        />
        <AtField
          id={`${id}-pt`}
          code="p"
          value={policy.cpPayAt}
          disabled={off}
          onSave={(at) =>
            void save({ cpPayAt: at }, t('tgn.cp.at_saved', { name: payName, time: at }))
          }
        />
      </NoticeRow>
      <NoticeRow
        id="cpFee"
        title={feeName}
        to="cp"
        on={policy.cpTgDebt}
        disabled={off}
        why={why}
        onToggle={(on) => toggle('cpTgDebt', on)}
        hint={`${t(fee ? 'tgn.cp_fee.hint_soon' : 'tgn.cp_fee.hint')} ${only}`}
        days={
          fee
            ? t('tgn.cp_fee.days_soon', {
                days: cpDaysText(t, policy.cpFeeDays),
                wd: t(`tgn.wdpl.${wd}`),
              })
            : t(`tgn.wdpl.${wd}`)
        }
        at={policy.cpFeeAt}
        often={t(fee ? 'tgn.cp_fee.often_soon' : 'tgn.cp_fee.often')}
      >
        {fee ? (
          <DaysField
            id={`${id}-fd`}
            code="f"
            days={policy.cpFeeDays}
            disabled={off}
            onSave={(days) =>
              void save(
                { cpFeeDays: days },
                t('tgn.cp.days_saved', { name: feeName, days: cpDaysText(t, days) }),
              )
            }
          />
        ) : null}
        <AtField
          id={`${id}-ft`}
          code="f"
          value={policy.cpFeeAt}
          disabled={off}
          onSave={(at) =>
            void save({ cpFeeAt: at }, t('tgn.cp.at_saved', { name: feeName, time: at }))
          }
        />
        <div className="w-[220px] max-w-full">
          <Field id={`${id}-fwd`} label={t('tgn.cp.debt_wd')}>
            {(c) => (
              <select
                {...c}
                data-tgn-fwd=""
                value={wd}
                disabled={off}
                onChange={(e) => {
                  const next = weekDayOf(Number(e.target.value));
                  if (next !== wd) {
                    void save(
                      { cpDebtWeekDay: next },
                      t('tgn.cp.debt_wd_saved', { days: t(`tgn.wdpl.${next}`) }),
                    );
                  }
                }}
                className={`${inputClass()} cursor-pointer`}
              >
                {WEEK_DAYS.map((n) => (
                  <option key={n} value={n}>
                    {upper(t(`tgn.wd.${n}`))}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </NoticeRow>
    </>
  );
}
