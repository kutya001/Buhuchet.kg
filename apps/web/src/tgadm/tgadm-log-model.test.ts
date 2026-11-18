import { defaultUiTexts, JOURNAL_STATUSES } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  chatChoice,
  errorOf,
  journalExtra,
  kindText,
  plateChoice,
  rowText,
  savedSettings,
  shownSettings,
  STATUS_PILL,
} from './tgadm-log-model';
import { periodFor } from './tgadm-log-store';

// Журнал переписки бота Админки → «Телеграм» (решение заказчика 17.11.2026; прототип v132
// admin/tg-log.js: плашки, «Вся переписка», столбец «Текст», статусы).

const t = makeTranslate(defaultUiTexts());

describe('Журнал «Телеграм»: строка', () => {
  it('тип сообщения: отправка, сообщение клиенту и полученное — каждый со своей подписью', () => {
    expect(kindText(t, 'reminders')).toBe('Напоминания за день');
    expect(kindText(t, 'client_pay')).toBe('«К оплате» клиенту');
    expect(kindText(t, 'in_press')).toBe('Нажатие кнопки');
  });

  it('у кода и одноразовой ссылки текста нет — только «Текст скрыт»', () => {
    expect(rowText(t, { hide: 'code', text: null })).toBe('Текст скрыт: в сообщении код');
    expect(rowText(t, { hide: 'link', text: null })).toBe('Текст скрыт: одноразовая ссылка');
    // Даже если текст пришёл — скрытое сообщение его не показывает.
    expect(rowText(t, { hide: 'code', text: '123456' })).toBe('Текст скрыт: в сообщении код');
    expect(rowText(t, { hide: null, text: 'Отчёт сдан' })).toBe('Отчёт сдан');
    expect(rowText(t, { hide: null, text: null })).toBe('');
  });

  it('ошибка: код итога — словами, ответ Telegram — как есть', () => {
    expect(errorOf(t, { error: null })).toBe('');
    expect(errorOf(t, { error: 'recipient_unlinked' })).toContain('отвязал');
    expect(errorOf(t, { error: 'Forbidden: bot was blocked' })).toBe('Forbidden: bot was blocked');
  });

  it('у каждого статуса есть цвет; «Не распознано» — жёлтым с вопросом, «Получено» — без значка', () => {
    for (const status of JOURNAL_STATUSES) expect(STATUS_PILL[status].tone).toBeTruthy();
    expect(STATUS_PILL.unknown).toEqual({ tone: 'warn', icon: 'help' });
    expect(STATUS_PILL.done).toEqual({ tone: 'ok', icon: 'check' });
    expect(STATUS_PILL.new.icon).toBeUndefined();
  });
});

describe('Журнал «Телеграм»: плашки и «Вся переписка»', () => {
  it('«В очереди» и «Ошибки отправки» — отправленные с этим статусом за 90 дней', () => {
    expect(plateChoice('q')).toEqual({
      view: { dir: 'out', per: 90, chat: null },
      filters: { st: { type: 'enum', vals: ['pending'] } },
    });
    expect(plateChoice('e')).toEqual({
      view: { dir: 'out', per: 90, chat: null },
      filters: { st: { type: 'enum', vals: ['error'] } },
    });
  });

  it('«Отправлено сегодня» и «Получено сегодня» — направление и «Сегодня» без фильтров', () => {
    expect(plateChoice('s')).toEqual({ view: { dir: 'out', per: 1, chat: null }, filters: {} });
    expect(plateChoice('r')).toEqual({ view: { dir: 'in', per: 1, chat: null }, filters: {} });
  });

  it('«Вся переписка» — чат строки, все направления, весь срок хранения', () => {
    const view = chatChoice('00000000-0000-4000-8000-000000000201');
    expect(view).toEqual({ dir: 'all', per: 90, chat: '00000000-0000-4000-8000-000000000201' });
    expect(journalExtra(view)).toEqual({
      days: '90',
      chat: '00000000-0000-4000-8000-000000000201',
    });
  });

  it('параметры запроса: «Все» направления не передаются, чат — только в «Всей переписке»', () => {
    expect(journalExtra({ dir: 'all', per: 7, chat: null })).toEqual({ days: '7' });
    expect(journalExtra({ dir: 'in', per: 30, chat: null })).toEqual({ days: '30', dir: 'in' });
  });

  it('переписка идёт от старых к новым, сохранённый порядок журнала не меняется', () => {
    const saved = { sort: { key: 'st', dir: 'desc' as const }, density: 'compact' as const };
    expect(shownSettings(saved, false)).toBe(saved);
    const shown = shownSettings(saved, true);
    expect(shown.sort).toEqual({ key: 'at', dir: 'asc' });
    // В переписке сменили плотность: порядок переписки в сохранённый вид не попадает.
    expect(savedSettings({ ...shown, density: 'normal' }, saved, true)).toEqual({
      sort: { key: 'st', dir: 'desc' },
      density: 'normal',
    });
    // У вида без своего порядка — так и остаётся без него.
    expect(savedSettings(shownSettings({}, true), {}, true)).toEqual({});
    // Человек сам выбрал другой порядок — он сохраняется.
    const picked = { ...shown, sort: { key: 'to', dir: 'asc' as const } };
    expect(savedSettings(picked, saved, true)).toEqual(picked);
    expect(savedSettings(picked, saved, false)).toBe(picked);
  });
});

describe('Журнал «Телеграм»: сообщение из окна «Запуск»', () => {
  const now = new Date('2026-11-18T05:00:00Z'); // 18.11 11:00 по Бишкеку

  it('сообщение в выбранном периоде — период остаётся', () => {
    expect(periodFor('2026-11-18T03:00:00Z', 1, now)).toBe(1);
    expect(periodFor('2026-11-12T03:00:00Z', 7, now)).toBe(7);
  });

  it('сообщение старше периода — весь срок хранения; граница — по дням Бишкека', () => {
    // 17.11 23:30 UTC — уже 18.11 по Бишкеку: это «сегодня».
    expect(periodFor('2026-11-17T23:30:00Z', 1, now)).toBe(1);
    expect(periodFor('2026-11-17T17:00:00Z', 1, now)).toBe(90);
    expect(periodFor('2026-11-11T03:00:00Z', 7, now)).toBe(90);
  });
});
