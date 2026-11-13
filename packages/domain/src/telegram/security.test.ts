import { describe, expect, it } from 'vitest';
import { botMessageProblem, botPressData, findBotButton, parseBotPress } from './bot-message';
import {
  NOT_ME_ACTION,
  NOT_ME_HOURS,
  notMeArg,
  notMeLate,
  parseNotMeArg,
  SECURITY_NOTICE_DEFS,
  SECURITY_NOTICES,
  securityBotMessage,
} from './security';

const SENT = new Date('2026-11-14T03:15:27.900Z');

describe('«Это не я» под сообщениями о безопасности', () => {
  it('запись кнопки: вид сообщения и момент отправки в секундах — читается обратно', () => {
    for (const notice of SECURITY_NOTICES) {
      const arg = notMeArg(notice, SENT);
      expect(arg).toBe(`${notice}.1794626127`);
      expect(parseNotMeArg(arg)).toEqual({ notice, sentAt: new Date('2026-11-14T03:15:27.000Z') });
    }
  });

  it('чужая или испорченная запись кнопки — не наша', () => {
    for (const arg of [
      null,
      '',
      'pass',
      'pass.',
      'pass.x',
      'other.1794626127',
      'pass.1.2',
      '.17',
    ]) {
      expect(parseNotMeArg(arg), String(arg)).toBeNull();
    }
  });

  it(`кнопка действует ${NOT_ME_HOURS} часа: ровно в срок — ещё да, секундой позже — нет`, () => {
    const sentAt = new Date('2026-11-14T03:15:27.000Z');
    expect(notMeLate(sentAt, new Date('2026-11-14T03:15:28.000Z'))).toBe(false);
    expect(notMeLate(sentAt, new Date('2026-11-15T03:15:27.000Z'))).toBe(false);
    expect(notMeLate(sentAt, new Date('2026-11-15T03:15:28.000Z'))).toBe(true);
  });

  it('сообщение: текст и одна кнопка; данные нажатия помещаются в предел Telegram', () => {
    const m = securityBotMessage('🔑 Пароль изменён', 'pass', SENT, 'Это не я');
    expect(botMessageProblem(m)).toBeNull();
    expect(m).toEqual({
      text: '🔑 Пароль изменён',
      buttons: [[{ text: 'Это не я', action: NOT_ME_ACTION, arg: 'pass.1794626127' }]],
    });
    const data = botPressData(NOT_ME_ACTION, 'unlink.999999999999');
    expect(parseBotPress(data)).toEqual({ action: NOT_ME_ACTION, arg: 'unlink.999999999999' });
    expect(findBotButton(m, NOT_ME_ACTION, 'pass.1794626127')).toBeTruthy();
    // Другой момент отправки в данных нажатия — такой кнопки в сообщении нет.
    expect(findBotButton(m, NOT_ME_ACTION, 'pass.1894626127')).toBeFalsy();
  });

  it('у каждого вида сообщения — свой шаблон и вид строки журнала', () => {
    expect(SECURITY_NOTICE_DEFS.pass).toMatchObject({
      template: 'tgPassChanged',
      kind: 'pass_changed',
    });
    expect(SECURITY_NOTICE_DEFS.relink).toMatchObject({ template: 'tgRelinked', kind: 'relinked' });
    expect(SECURITY_NOTICE_DEFS.unlink).toMatchObject({ template: 'tgUnlinked', kind: 'unlinked' });
  });
});
