import { PAGE_SECTIONS, type PageSection } from '@buhuchet/domain';
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
  page_send: 'cppage.hist.page_send',
  page_lock: 'cppage.hist.page_lock',
} as const;

const sectionsOf = (value: unknown): PageSection[] =>
  Array.isArray(value) ? PAGE_SECTIONS.filter((s) => value.includes(s)) : [];

/**
 * Что произошло со страницей — строкой, как в истории прототипа (`log('cp', …)`, pubSeen): включена,
 * выключена, код изменён, ссылка скопирована и отправлена, открыта с устройства, ввод закрыт после
 * неверных кодов; скрытые разделы — по разделу: «раздел «Оплата за обслуживание» скрыт». Подключит
 * вкладка «История» карточки контрагента (задача 2.11).
 */
export function pageHistoryText(t: Translate, entry: PageHistoryEntry): string {
  if (entry.action === 'page_open') {
    const device = entry.changes.find((c) => c.field === 'device')?.to;
    return t('cppage.hist.page_open', { device: typeof device === 'string' ? device : '' });
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
export function pageHistoryActor(t: Translate, actor: string | null): string {
  return actor ?? t('cppage.hist.client');
}
