import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminTelegramLogRow } from '@buhuchet/shared';
import type { ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { bulkRetryToast, logMenu, retryRefusal } from './tgadm-menu';

// Меню строки журнала Админки → «Телеграм» и уведомление «Повторить ошибки» (прототип
// admin/tg-log.js: tgNoRetry, actions, «Повторить ошибки»).

const t = makeTranslate(defaultUiTexts());

const row = (over: Partial<AdminTelegramLogRow> = {}): AdminTelegramLogRow => ({
  id: '00000000-0000-4000-8000-000000000201',
  src: 'outbox',
  dir: 'out',
  at: '2026-10-18T03:00:00.000Z',
  sentAt: null,
  recipient: 'Иванова А.',
  orgId: '00000000-0000-4000-8000-000000000001',
  orgName: 'ОсОО «Пример»',
  chatKind: 'private',
  kind: 'broadcast',
  status: 'error',
  tries: 5,
  error: 'Forbidden: bot was blocked by the user',
  text: 'Плановые работы 15 ноября',
  hide: null,
  ...over,
});

const menu = (r: AdminTelegramLogRow, over: { open?: () => void; chat?: () => void } = {}) =>
  logMenu({ t, open: over.open ?? vi.fn(), chat: over.chat ?? vi.fn(), retry: vi.fn() })(r).filter(
    (e): e is ActionItem => 'id' in e,
  );
const item = (r: AdminTelegramLogRow, retry = vi.fn()) =>
  logMenu({ t, open: vi.fn(), chat: vi.fn(), retry })(r).find(
    (e): e is ActionItem => 'id' in e && e.id === 'retry',
  )!;

describe('Журнал «Телеграм»: «Повторить отправку»', () => {
  it('у «Ошибки» пункт доступен и повторяет строку', () => {
    const retry = vi.fn();
    const r = row();
    const entry = item(r, retry);
    expect(entry.label).toBe('Повторить отправку');
    expect(entry.disabled).toBe(false);
    expect(retryRefusal(t, r)).toBe('');
    entry.run?.();
    expect(retry).toHaveBeenCalledWith(r);
  });

  it('у отправленного и ожидающего — недоступен с причиной «Повтор доступен только для ошибок»', () => {
    for (const status of ['sent', 'pending'] as const) {
      const entry = item(row({ status }));
      expect(entry.disabled).toBe(true);
      expect(entry.reason).toBe('Повтор доступен только для ошибок');
    }
  });

  it('у кода восстановления и кода замены Telegram с «Ошибкой» — недоступен: код повторно не отправляется', () => {
    for (const [kind, reason] of [
      ['code', 'Код восстановления повторно не отправляется: пользователь запросит новый'],
      ['relink_code', 'Код замены Telegram повторно не отправляется: пользователь запросит новый'],
      // Ссылка «Задать пароль» (доработки 14.11.2026, блок 1, пункт 3): новая — из карточки организации.
      [
        'setup_link',
        'Ссылка, чтобы задать пароль, повторно не отправляется: отправьте новую из карточки организации',
      ],
      // Ответ на команду бота собран по правам сотрудника на момент запроса (задача Т5).
      ['bot_cmd', 'Ответ на команду бота повторно не отправляется: человек запросит его снова'],
    ] as const) {
      const entry = item(row({ kind }));
      expect(entry.disabled).toBe(true);
      expect(entry.reason).toBe(reason);
    }
  });
});

describe('Журнал «Телеграм»: меню строки переписки в обе стороны', () => {
  it('пункты — «Открыть сообщение», «Вся переписка», «Повторить отправку»; первые два открывают строку', () => {
    const open = vi.fn();
    const chat = vi.fn();
    const r = row();
    const entries = menu(r, { open, chat });
    expect(entries.map((e) => e.label)).toEqual([
      'Открыть сообщение',
      'Вся переписка',
      'Повторить отправку',
    ]);
    entries[0]!.run?.();
    entries[1]!.run?.();
    expect(open).toHaveBeenCalledWith(r);
    expect(chat).toHaveBeenCalledWith(r);
  });

  it('полученное сообщение не повторяется, даже с «Ошибкой»', () => {
    for (const status of ['done', 'unknown', 'error'] as const) {
      const entry = item(row({ src: 'inbox', dir: 'in', kind: 'in_text', status }));
      expect(entry.disabled).toBe(true);
      expect(entry.reason).toBe('Повторить можно только отправленное сообщение');
    }
  });

  it('сообщение клиенту контрагента с «Ошибкой» отсюда не повторяется, отправленное — «только для ошибок»', () => {
    const failed = item(row({ src: 'client', chatKind: 'client', kind: 'client_pay' }));
    expect(failed.disabled).toBe(true);
    expect(failed.reason).toBe(
      'Сообщение клиенту контрагента отсюда не повторяется: отправьте его заново из карточки контрагента',
    );
    const sent = item(
      row({ src: 'client', chatKind: 'client', kind: 'client_pay', status: 'sent' }),
    );
    expect(sent.reason).toBe('Повтор доступен только для ошибок');
  });
});

describe('Уведомление «Повторить ошибки»', () => {
  it('сколько поставлено в очередь; пропущенные коды — отдельной частью', () => {
    expect(bulkRetryToast(t, { queued: 3, codes: 0 })).toBe('Поставлено в очередь: 3');
    expect(bulkRetryToast(t, { queued: 2, codes: 1 })).toBe(
      'Поставлено в очередь: 2; коды повторно не отправляются (1)',
    );
  });
});
