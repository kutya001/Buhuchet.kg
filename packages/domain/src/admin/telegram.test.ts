import { describe, expect, it } from 'vitest';
import { WEBHOOK_ERROR_FRESH_MS, webhookState } from './telegram';

const URL = 'https://test.buhuchet.kg/api/telegram/webhook';
const NOW = new Date('2026-11-01T04:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('состояние вебхука бота платформы (прототип TG_WH, задача 2.41)', () => {
  it('работает: наш адрес, ошибок нет или последняя — давно', () => {
    const ok = { ok: true, problem: null, lastError: null, actualUrl: null };
    expect(webhookState({ url: URL, lastErrorAt: null, lastError: null }, URL, NOW)).toEqual(ok);
    expect(
      webhookState(
        { url: URL, lastErrorAt: ago(WEBHOOK_ERROR_FRESH_MS + 1000), lastError: '502 Bad Gateway' },
        URL,
        NOW,
      ),
    ).toEqual(ok);
  });

  it('ошибка: свежая ошибка доставки — с текстом Telegram', () => {
    expect(
      webhookState(
        {
          url: URL,
          lastErrorAt: ago(5 * 60_000),
          lastError: 'Wrong response from the webhook: 502 Bad Gateway',
        },
        URL,
        NOW,
      ),
    ).toEqual({
      ok: false,
      problem: 'delivery',
      lastError: 'Wrong response from the webhook: 502 Bad Gateway',
      actualUrl: null,
    });
  });

  it('ошибка: бот не подключён, Telegram не ответил, вебхук не поставлен или на другом адресе', () => {
    expect(webhookState(null, URL, NOW).problem).toBe('no_bot');
    expect(webhookState('unreachable', URL, NOW).problem).toBe('unreachable');
    expect(webhookState({ url: '', lastErrorAt: null, lastError: null }, URL, NOW).problem).toBe(
      'not_set',
    );
    expect(
      webhookState(
        { url: 'https://buhuchet.kg/api/telegram/webhook', lastErrorAt: null, lastError: null },
        URL,
        NOW,
      ),
    ).toEqual({
      ok: false,
      problem: 'other_url',
      lastError: null,
      actualUrl: 'https://buhuchet.kg/api/telegram/webhook',
    });
  });
});
