'use client';

import { CP_PAY_DAYS, CP_TG_TIME } from '@buhuchet/domain';
import { NoticeRow } from '../telegram/notice-row';
import { useT } from '../l10n/provider';

/** Переключатели строк контрагентов — поля учётной политики. */
export type ContractorNoticeField = 'cpTgPay' | 'cpTgDebt';

/**
 * Строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления» (пакет 14.11.2026, блок 3;
 * прототип v111 `pgTgNoticeRows` в modules/cp-telegram.js; до этого — блок «Telegram контрагентов», задачи
 * К4 и К5). Переключатели — «Отправлять «К оплате» контрагентам» и «Напоминать контрагентам о долге»
 * учётной политики, работают как раньше: «К оплате» — за `CP_PAY_DAYS` дней до ближайшего срока оплаты,
 * о долге — по понедельникам, оба в 10:00. Дни и время строк настраиваются в этапе 2 (поток К).
 * Ставятся, только когда включены «Напоминания в Telegram» и «Страница контрагента».
 */
export function ContractorNoticeRows({
  pay,
  debt,
  own,
  busy,
  onToggle,
}: {
  pay: boolean;
  debt: boolean;
  /** Меняет только владелец организации. */
  own: boolean;
  busy: boolean;
  onToggle: (field: ContractorNoticeField, on: boolean) => void;
}) {
  const t = useT();
  const why = own ? undefined : t('tgn.owner_only');
  const only = t('tgn.cp.only');
  return (
    <>
      <NoticeRow
        id="cpPay"
        title={t('tgn.cp_pay.title')}
        to="cp"
        on={pay}
        disabled={!own || busy}
        why={why}
        onToggle={(on) => onToggle('cpTgPay', on)}
        hint={`${t('tgn.cp_pay.hint')} ${only}`}
        days={t('tgn.cp_pay.days', { n: CP_PAY_DAYS })}
        at={CP_TG_TIME}
        often={t('tgn.cp_pay.often')}
      />
      <NoticeRow
        id="cpFee"
        title={t('tgn.cp_fee.title')}
        to="cp"
        on={debt}
        disabled={!own || busy}
        why={why}
        onToggle={(on) => onToggle('cpTgDebt', on)}
        hint={`${t('tgn.cp_fee.hint')} ${only}`}
        days={t('tgn.cp_fee.days')}
        at={CP_TG_TIME}
        often={t('tgn.cp_fee.often')}
      />
    </>
  );
}
