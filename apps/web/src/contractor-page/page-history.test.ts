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
    expect(text('page_code_copy')).toBe('Скопирован код доступа страницы контрагента');
    expect(text('page_send')).toBe('Ссылка на страницу контрагента с кодом отправлена в WhatsApp');
    expect(text('page_lock')).toBe(
      'Страница контрагента: 5 неверных кодов подряд, ввод закрыт на 15 минут',
    );
    expect(text('page_close')).toBe(
      'Страница контрагента: 5 неверных кодов за сутки, страница закрыта до смены кода',
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

  it('Telegram контрагента — строками прототипа v92 с именем в Telegram', () => {
    const text = (action: string, from: string | null, to: string | null) =>
      pageHistoryText(t, { action, changes: [{ field: 'telegram', from, to }] });
    expect(text('page_tg_request', null, '@aibek')).toBe(
      'Telegram контрагента: запрос на подключение от «@aibek»',
    );
    expect(text('page_tg_on', null, '@aibek')).toBe('Telegram контрагента «@aibek»: подключён');
    expect(text('page_tg_no', null, '@aibek')).toBe(
      'Telegram контрагента «@aibek»: запрос отклонён',
    );
    expect(text('page_tg_off', '@aibek', null)).toBe('Telegram контрагента «@aibek»: отключён');
    expect(text('page_tg_leave', '@aibek', null)).toBe(
      'Telegram контрагента «@aibek»: отключён контрагентом',
    );
  });

  it('напоминание о долге в Telegram: переключатель в карточке и выбор клиента (К5)', () => {
    const toggled = (from: boolean, to: boolean) =>
      pageHistoryText(t, { action: 'update', changes: [{ field: 'tgDebtOff', from, to }] });
    expect(toggled(false, true)).toBe('Напоминание о долге в Telegram: выключено');
    expect(toggled(true, false)).toBe('Напоминание о долге в Telegram: включено');
    const client = (action: string) =>
      pageHistoryText(t, { action, changes: [{ field: 'telegram', to: '@aibek' }] });
    expect(client('page_tg_nodebt')).toBe(
      'Напоминания о долге в Telegram выключены контрагентом («@aibek»)',
    );
    expect(client('page_tg_debt_on')).toBe(
      'Напоминания о долге в Telegram включены контрагентом («@aibek»)',
    );
  });

  it('вопрос клиента и ответ сотрудника в Telegram — строками прототипа v94 (pgTgAsk, pgTgAnswer)', () => {
    const entry = (action: string, field: string) =>
      pageHistoryText(t, {
        action,
        changes: [{ field, to: { name: '@aibek', text: 'Можно оплатить частями?' } }],
      });
    expect(entry('page_tg_question', 'tgQuestion')).toBe(
      'Вопрос бухгалтеру из Telegram («@aibek»): Можно оплатить частями?',
    );
    expect(entry('page_tg_answer', 'tgAnswer')).toBe(
      'Ответ контрагенту в Telegram («@aibek»): Можно оплатить частями?',
    );
    // Ответ пишет сотрудник — автор записи он, а не контрагент.
    expect(pageHistoryActor(t, 'Иванова А.', 'page_tg_answer')).toBe('Иванова А.');
  });

  it('открытие и перерыв делает контрагент', () => {
    expect(pageHistoryActor(t, null)).toBe('Контрагент');
    expect(pageHistoryActor(t, 'Иванова А.')).toBe('Иванова А.');
  });
});
