import { describe, expect, it } from 'vitest';
import {
  CP_TG_MAX,
  cpTgActionRefusal,
  cpTgLeaveCommand,
  cpTgName,
  cpTgOrder,
  cpTgStartToken,
} from './telegram';

const TOKEN = 'A'.repeat(43);

describe('Telegram контрагента: ссылка со страницы', () => {
  it('токен берётся только из параметра с приставкой cp_', () => {
    expect(cpTgStartToken(`cp_${TOKEN}`)).toBe(TOKEN);
    expect(cpTgStartToken(TOKEN)).toBeNull();
    expect(cpTgStartToken(null)).toBeNull();
    expect(cpTgStartToken('cp_')).toBeNull();
    expect(cpTgStartToken(`cp_${TOKEN}x`)).toBeNull();
    expect(cpTgStartToken(`cp_${'A'.repeat(42)}!`)).toBeNull();
  });
});

describe('Telegram контрагента: имя в Telegram', () => {
  it('логин с @, иначе имя; пусто — «Telegram»', () => {
    expect(cpTgName({ username: 'nazgul', firstName: 'Назгуль' })).toBe('@nazgul');
    expect(cpTgName({ username: null, firstName: ' Назгуль  Жээнбекова ' })).toBe(
      'Назгуль Жээнбекова',
    );
    expect(cpTgName({})).toBe('Telegram');
    expect(cpTgName({ firstName: '‮\n' })).toBe('Telegram');
  });

  it('имя без логина не начинается с «@» — его не выдать за логин клиента', () => {
    expect(cpTgName({ firstName: '@nazgul' })).toBe('nazgul');
    expect(cpTgName({ username: '', firstName: ' @@ ivanov_director' })).toBe('ivanov_director');
    expect(cpTgName({ firstName: '＠nazgul' })).toBe('nazgul');
    expect(cpTgName({ firstName: '@' })).toBe('Telegram');
    expect(cpTgName({ firstName: 'Назгуль @ дом' })).toBe('Назгуль @ дом');
  });

  it('одной строкой, без управляющих знаков и не длиннее 32 знаков', () => {
    expect(cpTgName({ firstName: 'Бот\nBuhuchet.kg:‮ подтвердите' })).toBe(
      'Бот Buhuchet.kg: подтвердите',
    );
    const long = cpTgName({ firstName: 'я'.repeat(40) });
    expect([...long]).toHaveLength(32);
    expect(long.endsWith('…')).toBe(true);
    // Эмодзи не режется пополам.
    expect([...cpTgName({ firstName: '😀'.repeat(40) })]).toHaveLength(32);
  });
});

describe('Telegram контрагента: решение сотрудника (прототип pgTgWhy)', () => {
  it('подтвердить и отклонить можно только ждущий запрос', () => {
    expect(cpTgActionRefusal('wait', 'approve', 0)).toBeNull();
    expect(cpTgActionRefusal('wait', 'reject', CP_TG_MAX)).toBeNull();
    expect(cpTgActionRefusal('on', 'approve', 1)).toBe('cp_tg_done');
    expect(cpTgActionRefusal('no', 'reject', 0)).toBe('cp_tg_done');
    expect(cpTgActionRefusal('off', 'approve', 0)).toBe('cp_tg_done');
  });

  it('подтвердить нельзя, когда уже подключено 5', () => {
    expect(cpTgActionRefusal('wait', 'approve', CP_TG_MAX - 1)).toBeNull();
    expect(cpTgActionRefusal('wait', 'approve', CP_TG_MAX)).toBe('cp_tg_limit');
  });

  it('отключить можно только подключённый', () => {
    expect(cpTgActionRefusal('on', 'unlink', 5)).toBeNull();
    expect(cpTgActionRefusal('wait', 'unlink', 0)).toBe('cp_tg_not_on');
    expect(cpTgActionRefusal('off', 'unlink', 0)).toBe('cp_tg_not_on');
  });
});

describe('Telegram контрагента: порядок списка (прототип pgTgBox)', () => {
  it('ждущие, подключённые, остальные; внутри — новые сверху', () => {
    const rows = [
      { id: 1, status: 'off' as const, requestedAt: '2026-11-12T10:00:00Z' },
      { id: 2, status: 'on' as const, requestedAt: '2026-11-10T10:00:00Z' },
      { id: 3, status: 'wait' as const, requestedAt: '2026-11-11T10:00:00Z' },
      { id: 4, status: 'on' as const, requestedAt: '2026-11-11T10:00:00Z' },
      { id: 5, status: 'no' as const, requestedAt: '2026-11-13T10:00:00Z' },
      { id: 6, status: 'wait' as const, requestedAt: '2026-11-12T10:00:00Z' },
    ];
    expect(cpTgOrder(rows).map((r) => r.id)).toEqual([6, 3, 4, 2, 5, 1]);
  });
});

describe('Telegram контрагента: команда «Отключить»', () => {
  it('с номером и без, в любом регистре', () => {
    expect(cpTgLeaveCommand('Отключить')).toEqual({ index: null });
    expect(cpTgLeaveCommand('  отключить ')).toEqual({ index: null });
    expect(cpTgLeaveCommand('/отключить 2')).toEqual({ index: 2 });
    expect(cpTgLeaveCommand('ОТКЛЮЧИТЬ 12')).toEqual({ index: 12 });
  });

  it('другое сообщение — не команда', () => {
    expect(cpTgLeaveCommand('Отключить всё')).toBeNull();
    expect(cpTgLeaveCommand('Не отключить')).toBeNull();
    expect(cpTgLeaveCommand('482913')).toBeNull();
  });
});
