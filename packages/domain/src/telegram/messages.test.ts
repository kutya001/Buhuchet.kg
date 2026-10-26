import { describe, expect, it } from 'vitest';
import {
  fillTemplate,
  parseStartCommand,
  TELEGRAM_TEMPLATE_DEFAULTS,
  telegramName,
  withOrganization,
} from './messages';

describe('шаблоны сообщений бота', () => {
  it('код восстановления — шаблон справочника tgCode', () => {
    expect(fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS.tgCode, { код: '482913' })).toBe(
      'Код для восстановления пароля: 482913. Действует 10 минут.',
    );
  });

  it('неизвестная подстановка остаётся как есть, лишние значения не мешают', () => {
    expect(fillTemplate('{логин}: {код} {нет}', { логин: 'meerim', код: 1, лишнее: 'x' })).toBe(
      'meerim: 1 {нет}',
    );
    expect(fillTemplate('{constructor}', {})).toBe('{constructor}');
  });

  it('организация указывается, только если Telegram привязан к нескольким логинам', () => {
    expect(withOrganization('Код', 'ОсОО «Бухгалтер Плюс»', true)).toBe(
      'ОсОО «Бухгалтер Плюс»\nКод',
    );
    expect(withOrganization('Код', 'ОсОО «Бухгалтер Плюс»', false)).toBe('Код');
    expect(withOrganization('Код', null, true)).toBe('Код');
  });

  it('имя Telegram: @имя или имя в Telegram', () => {
    expect(telegramName({ username: 'meerim_k', firstName: 'Мээрим' })).toBe('@meerim_k');
    expect(telegramName({ username: null, firstName: ' Мээрим ' })).toBe('Мээрим');
    expect(telegramName({ username: null, firstName: null })).toBe('Telegram');
  });
});

describe('команда /start', () => {
  it('ссылка t.me/бот?start=токен приходит как «/start токен»', () => {
    expect(parseStartCommand('/start abc_DEF-123')).toEqual({ token: 'abc_DEF-123' });
    expect(parseStartCommand('/start@buhuchet_bot abc')).toEqual({ token: 'abc' });
  });

  it('/start без токена и другие сообщения', () => {
    expect(parseStartCommand('/start')).toEqual({ token: null });
    expect(parseStartCommand('  /start  ')).toEqual({ token: null });
    expect(parseStartCommand('привет')).toBeNull();
    expect(parseStartCommand('/start a b')).toBeNull();
    expect(parseStartCommand('/starter')).toBeNull();
  });
});
