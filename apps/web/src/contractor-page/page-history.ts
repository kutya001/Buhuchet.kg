import {
  formatSomWithUnit,
  isYearMonth,
  monthLabel,
  PAGE_SECTIONS,
  type PageSection,
} from '@buhuchet/domain';
import type { Translate } from '../l10n/translate';

/** Запись истории контрагента о его странице (сущность `contractor_page`). */
export interface PageHistoryEntry {
  action: string;
  changes: readonly { field: string; from?: unknown; to?: unknown }[];
}

const ACTION_TEXT = {
  page_on: 'cppage.hist.page_on',
  page_off: 'cppage.hist.page_off',
  page_code: 'cppage.hist.page_code',
  page_copy: 'cppage.hist.page_copy',
  page_code_copy: 'cppage.hist.page_code_copy',
  page_send: 'cppage.hist.page_send',
  page_lock: 'cppage.hist.page_lock',
  page_close: 'cppage.hist.page_close',
} as const;

/** Telegram контрагента (прототип v92 cp-telegram.js): запрос, решение сотрудника, отключение клиентом. */
const TELEGRAM_TEXT = {
  page_tg_request: 'cppage.hist.page_tg_request',
  page_tg_on: 'cppage.hist.page_tg_on',
  page_tg_no: 'cppage.hist.page_tg_no',
  page_tg_off: 'cppage.hist.page_tg_off',
  page_tg_leave: 'cppage.hist.page_tg_leave',
} as const;

const sectionsOf = (value: unknown): PageSection[] =>
  Array.isArray(value) ? PAGE_SECTIONS.filter((s) => value.includes(s)) : [];

/**
 * Что произошло со страницей — строкой, как в истории прототипа (`log('cp', …)`, pubSeen): включена,
 * выключена, код изменён, ссылка скопирована и отправлена, открыта с устройства, ввод закрыт после
 * неверных кодов, закрыта после 5 неверных кодов за сутки; Telegram контрагента — запрос, решение и
 * отключение с именем в Telegram; скрытые разделы — по разделу: «раздел «Оплата за обслуживание» скрыт». Подключит
 * вкладка «История» карточки контрагента (задача 2.11).
 */
export function pageHistoryText(t: Translate, entry: PageHistoryEntry): string {
  if (entry.action === 'page_open') {
    const device = entry.changes.find((c) => c.field === 'device')?.to;
    return t('cppage.hist.page_open', { device: typeof device === 'string' ? device : '' });
  }
  if (entry.action in TELEGRAM_TEXT) {
    const change = entry.changes.find((c) => c.field === 'telegram');
    const name = change?.to ?? change?.from;
    return t(TELEGRAM_TEXT[entry.action as keyof typeof TELEGRAM_TEXT], {
      name: typeof name === 'string' ? name : '',
    });
  }
  // «К оплате» клиенту в Telegram (задача К4; прототип v94 pgPaySend, tgAct('cp-paid'), pgTgAsk).
  if (entry.action === 'page_tg_pay' || entry.action === 'page_tg_paid') {
    const field = entry.action === 'page_tg_pay' ? 'tgPay' : 'tgPaid';
    const p = (entry.changes.find((c) => c.field === field)?.to ?? {}) as Record<string, unknown>;
    const values = {
      month: isYearMonth(String(p.month)) ? monthLabel(String(p.month)) : '',
      total: typeof p.total === 'number' ? formatSomWithUnit(p.total) : '',
    };
    return entry.action === 'page_tg_pay'
      ? t('cppage.hist.page_tg_pay', {
          ...values,
          n: typeof p.recipients === 'number' ? p.recipients : 0,
        })
      : t('cppage.hist.page_tg_paid', {
          ...values,
          name: typeof p.name === 'string' ? p.name : '',
        });
  }
  if (entry.action === 'page_tg_question') {
    const p = (entry.changes.find((c) => c.field === 'tgQuestion')?.to ?? {}) as Record<
      string,
      unknown
    >;
    return t('cppage.hist.page_tg_question', {
      name: typeof p.name === 'string' ? p.name : '',
      text: typeof p.text === 'string' ? p.text : '',
    });
  }
  if (entry.action in ACTION_TEXT) {
    return t(ACTION_TEXT[entry.action as keyof typeof ACTION_TEXT]);
  }
  const change = entry.changes.find((c) => c.field === 'hiddenSections');
  if (!change) return '';
  const before = sectionsOf(change.from);
  const after = sectionsOf(change.to);
  return PAGE_SECTIONS.flatMap((s) => {
    const name = t(`org.page.section.${s}`);
    if (after.includes(s) && !before.includes(s))
      return [t('cppage.hist.hidden', { section: name })];
    if (before.includes(s) && !after.includes(s))
      return [t('cppage.hist.shown', { section: name })];
    return [];
  }).join('; ');
}

/** Кто сделал: открытие страницы и перерыв после неверных кодов — «Контрагент», без сотрудника. */
export function pageHistoryActor(t: Translate, actor: string | null, action?: string): string {
  // «К оплате» без автора отправила задача по расписанию (за 5 дней до срока), а не контрагент.
  if (!actor && action === 'page_tg_pay') return t('status.system');
  return actor ?? t('cppage.hist.client');
}
