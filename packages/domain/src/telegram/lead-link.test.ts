import { describe, expect, it } from 'vitest';
import {
  isLeadTgStart,
  isSetupKeyShape,
  LEAD_TG_START_PREFIX,
  leadTgName,
  leadTgStartToken,
  leadTgUrl,
  setPasswordPath,
} from './lead-link';

// Telegram заявителя и пароль по ссылке (доработки 14.11.2026, блок 1; прототип v113 modules/tg-lead.js).

const key = 'Ab1_-'.repeat(8) + 'xyz'; // 43 знака base64url

describe('ссылка заявителя «/start l_<ключ>»', () => {
  it('ключ из параметра — только 43 знака base64url после «l_»', () => {
    expect(key).toHaveLength(43);
    expect(leadTgStartToken(`l_${key}`)).toBe(key);
    expect(leadTgStartToken(null)).toBeNull();
    expect(leadTgStartToken(key)).toBeNull();
    expect(leadTgStartToken(`cp_${key}`)).toBeNull();
    expect(leadTgStartToken(`l_${key}x`)).toBeNull();
    expect(leadTgStartToken(`l_${key.slice(0, 40)}`)).toBeNull();
    expect(leadTgStartToken(`l_${key.slice(0, 42)}!`)).toBeNull();
  });

  it('испорченная ссылка заявителя (не 43 знака) — тоже заявителю; 43 знака с «l_» — ключ сотрудника', () => {
    expect(isLeadTgStart(`l_${key}`)).toBe(true);
    expect(isLeadTgStart(`l_${key.slice(0, 10)}`)).toBe(true);
    expect(isLeadTgStart(`l_${key}xx`)).toBe(true);
    expect(isLeadTgStart('l_')).toBe(true);
    // Ключ привязки сотрудника — те же 43 знака и может сам начинаться с «l_».
    expect(isLeadTgStart(`l_${key.slice(0, 41)}`)).toBe(false);
    expect(leadTgStartToken(`l_${key.slice(0, 41)}`)).toBeNull();
    expect(isLeadTgStart(key)).toBe(false);
    expect(isLeadTgStart(null)).toBe(false);
  });

  it('ссылка на бота платформы — как в прототипе: t.me/<бот>?start=l_<ключ>', () => {
    expect(LEAD_TG_START_PREFIX).toBe('l_');
    expect(leadTgUrl('buhuchet_bot', key)).toBe(`https://t.me/buhuchet_bot?start=l_${key}`);
    expect(leadTgStartToken(new URL(leadTgUrl('b', key)).searchParams.get('start'))).toBe(key);
  });
});

describe('имя подключившего Telegram для истории заявки', () => {
  it('«@имя», если есть имя пользователя Telegram', () => {
    expect(leadTgName({ username: 'aigul_s', firstName: 'Айгуль' })).toBe('@aigul_s');
  });

  it('иначе имя из профиля одной строкой, без управляющих и невидимых знаков, до 64 знаков', () => {
    expect(leadTgName({ username: null, firstName: '  Айгуль  ' })).toBe('Айгуль');
    expect(leadTgName({ username: null, firstName: 'Ай\nгуль‮' })).toBe('Ай гуль');
    const long = '😀'.repeat(70);
    expect([...leadTgName({ username: null, firstName: long })]).toHaveLength(64);
  });

  it('имени нет — «Telegram»', () => {
    expect(leadTgName({ username: null, firstName: null })).toBe('Telegram');
    expect(leadTgName({ username: null, firstName: ' ​\t ' })).toBe('Telegram');
    expect(leadTgName({ username: '', firstName: '' })).toBe('Telegram');
  });
});

describe('ссылка «Задать пароль»', () => {
  it('ключ — 43 знака base64url; чужое и мусор отсекаются без запроса к базе', () => {
    expect(isSetupKeyShape(key)).toBe(true);
    expect(isSetupKeyShape(key.slice(1))).toBe(false);
    expect(isSetupKeyShape(`${key}a`)).toBe(false);
    expect(isSetupKeyShape(`${key.slice(1)}/`)).toBe(false);
    expect(isSetupKeyShape('not-a-key')).toBe(false);
  });

  it('страница на сайте — /setpass/<ключ> (прототип setPassUrl)', () => {
    expect(setPasswordPath(key)).toBe(`/setpass/${key}`);
  });
});
