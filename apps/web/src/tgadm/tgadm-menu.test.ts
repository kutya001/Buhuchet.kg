import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminTelegramLogRow } from '@buhuchet/shared';
import type { ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { bulkRetryToast, logMenu, retryRefusal } from './tgadm-menu';

// Меню строки журнала Админки → «Телеграм» и уведомление «Повторить ошибки» (прототип
// admin/telegram.js: tgNoRetry, actions, «Повторить ошибки»).

const t = makeTranslate(defaultUiTexts());

const row = (over: Partial<AdminTelegramLogRow> = {}): AdminTelegramLogRow => ({
  id: '00000000-0000-4000-8000-000000000201',
  at: '2026-10-18T03:00:00.000Z',
  sentAt: null,
  recipient: 'Иванова А.',
  orgId: '00000000-0000-4000-8000-000000000001',
  orgName: 'ОсОО «Пример»',
  kind: 'broadcast',
  status: 'error',
  tries: 5,
  error: 'Forbidden: bot was blocked by the user',
  ...over,
});

const item = (r: AdminTelegramLogRow, retry = vi.fn()) =>
  logMenu({ t, retry })(r).find((e): e is ActionItem => 'id' in e && e.id === 'retry')!;

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
      // Ответ на команду бота собран по правам сотрудника на момент запроса (задача Т5).
      ['bot_cmd', 'Ответ на команду бота повторно не отправляется: человек запросит его снова'],
    ] as const) {
      const entry = item(row({ kind }));
      expect(entry.disabled).toBe(true);
      expect(entry.reason).toBe(reason);
    }
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
