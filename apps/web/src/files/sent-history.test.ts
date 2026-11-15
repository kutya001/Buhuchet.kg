import { defaultUiTexts } from '@buhuchet/domain';
import type { ShellModule } from '@buhuchet/ui';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { withTabCounts } from '../shell/tab-counts';
import { sentInText, sentLeftText, sentWhoText } from './sent-data';
import { sentHistoryActor, sentHistoryText } from './sent-history';

describe('файлы от контрагентов: тексты истории и сроков (прототип v112 cp-sent.js)', () => {
  const t = makeTranslate(defaultUiTexts());
  const entry = (action: string, changes: { field: string; to: unknown }[], reason = null) => ({
    action,
    actor: null,
    changes,
    reason,
  });

  it('отправка со страницы и из Telegram: один файл, несколько, с комментарием (pubUpDlg)', () => {
    expect(
      sentHistoryText(
        t,
        entry('sent_file_send', [
          { field: 'files', to: ['Выписка.pdf'] },
          { field: 'source', to: 'page' },
        ]),
      ),
    ).toBe('Контрагент отправил со страницы файл: Выписка.pdf');
    expect(
      sentHistoryText(
        t,
        entry('sent_file_send', [
          { field: 'files', to: ['Акт.pdf', 'Счёт.xlsx'] },
          { field: 'source', to: 'page' },
          { field: 'comment', to: 'За октябрь' },
        ]),
      ),
    ).toBe('Контрагент отправил со страницы файлы: Акт.pdf, Счёт.xlsx. Комментарий: За октябрь');
    expect(
      sentHistoryText(
        t,
        entry('sent_file_send', [
          { field: 'files', to: ['Чек.jpg'] },
          { field: 'source', to: 'telegram' },
        ]),
      ),
    ).toBe('Контрагент отправил через Telegram файл: Чек.jpg');
    // Из Telegram — с именем чата; чек — «чек» (прототип v115 pgFileIn).
    expect(
      sentHistoryText(
        t,
        entry('sent_file_send', [
          { field: 'files', to: ['Акт.pdf'] },
          { field: 'source', to: 'telegram' },
          { field: 'sender', to: '@client' },
          { field: 'comment', to: 'Акт сверки' },
        ]),
      ),
    ).toBe('Контрагент отправил через Telegram («@client») файл: Акт.pdf. Комментарий: Акт сверки');
    expect(
      sentHistoryText(
        t,
        entry('sent_file_send', [
          { field: 'files', to: ['Чек.pdf'] },
          { field: 'source', to: 'telegram' },
          { field: 'sender', to: '@client' },
          { field: 'receipt', to: true },
        ]),
      ),
    ).toBe('Контрагент отправил через Telegram («@client») чек: Чек.pdf');
  });

  it('«Принять» (с «сохранён как»), «Отклонить» с причиной, удаление через 30 дней', () => {
    expect(sentHistoryText(t, entry('sent_file_accept', [{ field: 'file', to: 'Акт.pdf' }]))).toBe(
      'Принят файл от контрагента «Акт.pdf»',
    );
    expect(
      sentHistoryText(
        t,
        entry('sent_file_accept', [
          { field: 'file', to: 'Акт.pdf' },
          { field: 'savedAs', to: 'Акт (2).pdf' },
        ]),
      ),
    ).toBe('Принят файл от контрагента «Акт.pdf» (сохранён как «Акт (2).pdf»)');
    expect(
      sentHistoryText(t, {
        ...entry('sent_file_reject', [{ field: 'file', to: 'Акт.pdf' }]),
        reason: 'не тот месяц',
      }),
    ).toBe('Отклонён файл от контрагента «Акт.pdf»: не тот месяц');
    expect(sentHistoryText(t, entry('sent_file_purge', [{ field: 'file', to: 'Акт.pdf' }]))).toBe(
      'Удалён непринятый файл от контрагента «Акт.pdf»: прошло 30 дней после отправки',
    );
  });

  it('кто: отправка без автора — контрагент, удаление — система, решение — сотрудник', () => {
    expect(sentHistoryActor(t, { action: 'sent_file_send', actor: null })).toBe('Контрагент');
    expect(sentHistoryActor(t, { action: 'sent_file_purge', actor: null })).toBe('Система');
    expect(sentHistoryActor(t, { action: 'sent_file_accept', actor: 'Иванова А.' })).toBe(
      'Иванова А.',
    );
  });

  it('сколько осталось до удаления и кто отправил (sntLeftTxt, sntWho)', () => {
    expect(sentLeftText(t, 30)).toBe('Удалится через 30 дней');
    expect(sentLeftText(t, 1)).toBe('Удалится через 1 день');
    expect(sentLeftText(t, 2)).toBe('Удалится через 2 дня');
    expect(sentLeftText(t, 0)).toBe('Удалится сегодня');
    expect(sentLeftText(t, null)).toBe('');
    expect(sentInText(t, 21)).toBe('через 21 день');
    expect(sentInText(t, 0)).toBe('сегодня');
    expect(sentWhoText(t, { source: 'page', senderName: null })).toBe('Контрагент');
    expect(sentWhoText(t, { source: 'telegram', senderName: 'Айбек' })).toBe('Айбек');
    expect(sentWhoText(t, { source: 'telegram', senderName: null })).toBe('Telegram');
  });
});

describe('счётчик новых файлов у «Файлового менеджера» (прототип ui/shell.js, filesTabs)', () => {
  const files = {
    id: 'files',
    tabs: [
      { id: 'all', label: 'Все файлы' },
      { id: 'sent', label: 'Файлы от контрагентов' },
    ],
  } as unknown as ShellModule;

  it('новые — обычный счётчик у вкладки и у модуля; нет новых — без числа', () => {
    const one = withTabCounts(files, { sent: { value: 2, title: 'Новые' } });
    expect(one.count).toEqual({ value: 2, title: 'Новые' });
    expect(one.tabs.find((tab) => tab.id === 'sent')?.count).toEqual({ value: 2, title: 'Новые' });
    expect(withTabCounts(files, {}).count).toBeUndefined();
    expect(withTabCounts(files, { sent: { value: 0 } }).count).toBeUndefined();
  });
});
