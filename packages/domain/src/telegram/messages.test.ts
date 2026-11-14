import { describe, expect, it } from 'vitest';
import refDB from '../../../../spec/data/refDB.json';
import {
  botTemplate,
  fillTemplate,
  parseStartCommand,
  TELEGRAM_TEMPLATE_DEFAULTS,
  telegramName,
  withOrganization,
} from './messages';

describe('шаблоны сообщений бота', () => {
  it('код восстановления — шаблон справочника tgCode', () => {
    expect(fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS.tgCode, { код: '482913' })).toBe(
      '482913 — код для восстановления пароля. Действует 10 минут.',
    );
  });

  it('«привязан другой Telegram» — вместо совета кнопка «Это не я» под сообщением (прототип v101)', () => {
    expect(
      fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS.tgRelinked, { логин: 'meerim', телеграм: '@new_tg' }),
    ).toBe(
      '⚠️ К учётной записи meerim привязан другой Telegram: @new_tg. Сюда больше не придут напоминания и коды. Если это сделали не вы, нажмите «Это не я».',
    );
  });

  it('тексты по умолчанию у шаблонов из справочника (refDB.json) — те же, что в справочнике', () => {
    const own: Record<string, string> = refDB.messageTemplates;
    for (const [key, text] of Object.entries(TELEGRAM_TEMPLATE_DEFAULTS)) {
      if (Object.hasOwn(own, key)) expect(text, key).toBe(own[key]);
    }
  });

  it('шаблон справочника главнее; без шаблона или без {код} у кодов — текст по умолчанию', () => {
    expect(botTemplate('tgLinked', 'Привязан: {логин}')).toBe('Привязан: {логин}');
    expect(botTemplate('tgLinked', undefined)).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinked);
    expect(botTemplate('tgCode', 'Ваш код: {код}')).toBe('Ваш код: {код}');
    expect(botTemplate('tgCode', 'Код готов')).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgCode);
    expect(botTemplate('tgAdminCode', 'Вход ({логин})')).toBe(
      TELEGRAM_TEMPLATE_DEFAULTS.tgAdminCode,
    );
    expect(botTemplate('tgRelinkCode', 'Привязать {телеграм}?')).toBe(
      TELEGRAM_TEMPLATE_DEFAULTS.tgRelinkCode,
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
