import { describe, expect, it } from 'vitest';
import { redactBotToken } from './outbox';

describe('Очередь Telegram: токен бота не попадает в журнал', () => {
  it('адрес запроса с токеном в тексте ошибки скрывается', () => {
    expect(
      redactBotToken(
        'request to https://api.telegram.org/bot123456:AAH-abc_DEF/sendMessage failed',
      ),
    ).toBe('request to https://api.telegram.org/bot<скрыт>/sendMessage failed');
    expect(redactBotToken('http://tg.local/bott/sendMessage: ECONNRESET')).toBe(
      'http://tg.local/bot<скрыт>/sendMessage: ECONNRESET',
    );
  });

  it('обычный текст ошибки остаётся как есть', () => {
    expect(redactBotToken('fetch failed')).toBe('fetch failed');
    expect(redactBotToken('403: Forbidden: bot was blocked by the user')).toBe(
      '403: Forbidden: bot was blocked by the user',
    );
  });
});
