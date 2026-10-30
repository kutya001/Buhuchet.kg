import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { pageHistoryActor, pageHistoryText } from './page-history';

// Записи истории контрагента о его странице — тексты прототипа (modules/cp-page.js, `log('cp', …)`).

const t = makeTranslate(defaultUiTexts());

describe('pageHistoryText', () => {
  it('действия страницы — строками прототипа', () => {
    const text = (action: string) => pageHistoryText(t, { action, changes: [] });
    expect(text('page_on')).toBe('Страница контрагента включена: создан код доступа');
    expect(text('page_off')).toBe('Страница контрагента выключена');
    expect(text('page_code')).toBe('Код доступа страницы контрагента изменён');
    expect(text('page_copy')).toBe('Скопирована ссылка на страницу контрагента');
    expect(text('page_send')).toBe('Ссылка на страницу контрагента с кодом отправлена в WhatsApp');
    expect(text('page_lock')).toBe(
      'Страница контрагента: 5 неверных кодов подряд, ввод закрыт на 15 минут',
    );
    expect(
      pageHistoryText(t, {
        action: 'page_open',
        changes: [{ field: 'device', to: 'Телефон · Safari' }],
      }),
    ).toBe('Страница контрагента открыта: Телефон · Safari');
  });

  it('разделы страницы — по разделу: скрыт или показывается', () => {
    expect(
      pageHistoryText(t, {
        action: 'update',
        changes: [{ field: 'hiddenSections', from: [], to: ['fee'] }],
      }),
    ).toBe('Страница контрагента: раздел «Оплата за обслуживание» скрыт');
    expect(
      pageHistoryText(t, {
        action: 'update',
        changes: [{ field: 'hiddenSections', from: ['fee', 'kpi'], to: ['kpi', 'contacts'] }],
      }),
    ).toBe(
      'Страница контрагента: раздел «Оплата за обслуживание» показывается; Страница контрагента: раздел «Контакты» скрыт',
    );
  });

  it('открытие и перерыв делает контрагент', () => {
    expect(pageHistoryActor(t, null)).toBe('Контрагент');
    expect(pageHistoryActor(t, 'Иванова А.')).toBe('Иванова А.');
  });
});
