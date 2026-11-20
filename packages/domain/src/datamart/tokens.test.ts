import { describe, expect, it } from 'vitest';
import { DM_TOKEN_PREFIX_RE } from './datamart';
import {
  DM_TOKEN_RE,
  dmTokenExpiresAt,
  dmTokenFromBytes,
  dmTokenGraceUntil,
  dmTokenIssueRefusal,
  dmTokenLive,
  dmTokenNameProblem,
  dmTokenPrefix,
  dmTokenState,
  dmTokenTermOf,
  type DmTokenFacts,
} from './tokens';

const bytes = (fill: (i: number) => number) => Uint8Array.from({ length: 32 }, (_, i) => fill(i));

describe('dmTokenFromBytes — bk_ и 32 байта по основанию 62', () => {
  it('43 знака [A-Za-z0-9], нули и максимум — тоже 43 знака', () => {
    for (const b of [bytes(() => 0), bytes(() => 255), bytes((i) => (i * 37 + 11) % 256)]) {
      const t = dmTokenFromBytes(b);
      expect(t).toMatch(DM_TOKEN_RE);
      expect(t).toHaveLength(46);
    }
    expect(dmTokenFromBytes(bytes(() => 0))).toBe(`bk_${'A'.repeat(43)}`);
  });

  it('разные байты — разные токены; одни и те же — один токен', () => {
    const a = dmTokenFromBytes(bytes((i) => i));
    expect(dmTokenFromBytes(bytes((i) => i))).toBe(a);
    expect(dmTokenFromBytes(bytes((i) => (i === 31 ? 32 : i)))).not.toBe(a);
  });

  it('меньше 32 байт — ошибка', () => {
    expect(() => dmTokenFromBytes(new Uint8Array(16))).toThrow();
  });

  it('начало для списка подходит под проверку таблицы', () => {
    const t = dmTokenFromBytes(bytes((i) => i * 7));
    expect(dmTokenPrefix(t)).toBe(t.slice(0, 9));
    expect(dmTokenPrefix(t)).toMatch(new RegExp(DM_TOKEN_PREFIX_RE));
  });
});

describe('сроки токена', () => {
  const now = new Date('2026-11-20T10:00:00Z');

  it('сейчас + срок; больше 180 и не целое — ошибка', () => {
    expect(dmTokenExpiresAt(now, 30).toISOString()).toBe('2026-12-20T10:00:00.000Z');
    expect(() => dmTokenExpiresAt(now, 181)).toThrow();
    expect(() => dmTokenExpiresAt(now, 0)).toThrow();
    expect(() => dmTokenExpiresAt(now, 1.5)).toThrow();
  });

  it('срок прежнего — в сутках; перевыпущенный — ещё 24 часа, но не дольше срока', () => {
    expect(dmTokenTermOf(now, dmTokenExpiresAt(now, 90))).toBe(90);
    expect(dmTokenGraceUntil(now, new Date('2026-12-01T00:00:00Z')).toISOString()).toBe(
      '2026-11-21T10:00:00.000Z',
    );
    expect(dmTokenGraceUntil(now, new Date('2026-11-20T12:00:00Z')).toISOString()).toBe(
      '2026-11-20T12:00:00.000Z',
    );
  });
});

describe('dmTokenState — как dmTokSt прототипа', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const f: DmTokenFacts = {
    expiresAt: new Date('2026-12-20T10:00:00Z'),
    revokedAt: null,
    graceUntil: null,
    admin: false,
    templateState: 'published',
    templateAccess: true,
    orgBlocked: false,
    subClosed: false,
    extApi: true,
  };

  it('действует, отозван, истёк', () => {
    expect(dmTokenState(f, now)).toEqual({ state: 'active', stop: null });
    expect(dmTokenState({ ...f, revokedAt: now }, now).state).toBe('revoked');
    expect(dmTokenState({ ...f, expiresAt: now }, now).state).toBe('expired');
    expect(dmTokenState({ ...f, graceUntil: new Date('2026-11-20T09:59:00Z') }, now).state).toBe(
      'expired',
    );
    expect(dmTokenState({ ...f, graceUntil: new Date('2026-11-21T10:00:00Z') }, now).state).toBe(
      'active',
    );
  });

  it('остановлен — по порядку причин прототипа', () => {
    const stop = (x: Partial<DmTokenFacts>) => dmTokenState({ ...f, ...x }, now).stop;
    expect(stop({ templateState: 'off', subClosed: true })).toBe('tpl_off');
    expect(stop({ templateState: 'draft' })).toBe('tpl_off');
    expect(stop({ templateState: 'broken', extApi: false })).toBe('tpl_broken');
    expect(stop({ templateAccess: false, orgBlocked: true })).toBe('no_access');
    expect(stop({ orgBlocked: true, subClosed: true })).toBe('org_blocked');
    expect(stop({ subClosed: true, extApi: false })).toBe('sub_closed');
    expect(stop({ extApi: false })).toBe('api_off');
  });

  it('у токена Админки причин организации нет', () => {
    const adm = { ...f, admin: true, extApi: false, subClosed: true, templateAccess: false };
    expect(dmTokenState(adm, now)).toEqual({ state: 'active', stop: null });
    expect(dmTokenState({ ...adm, templateState: 'broken' }, now).stop).toBe('tpl_broken');
  });

  it('отозвать и перевыпустить можно действующий и остановленный', () => {
    expect(dmTokenLive('active')).toBe(true);
    expect(dmTokenLive('stopped')).toBe(true);
    expect(dmTokenLive('expired')).toBe(false);
    expect(dmTokenLive('revoked')).toBe(false);
  });
});

describe('выпуск: отказы и название', () => {
  const ok = {
    admin: false,
    demo: false,
    canTokens: true,
    extApi: true,
    subClosed: false,
    liveCount: 0,
  };

  it('по порядку прототипа dmNewDlg', () => {
    expect(dmTokenIssueRefusal(ok)).toBeNull();
    expect(dmTokenIssueRefusal({ ...ok, demo: true, canTokens: false })).toBe('dm_token_demo');
    expect(dmTokenIssueRefusal({ ...ok, canTokens: false, extApi: false })).toBe(
      'dm_token_no_right',
    );
    expect(dmTokenIssueRefusal({ ...ok, extApi: false, subClosed: true })).toBe('dm_token_api_off');
    expect(dmTokenIssueRefusal({ ...ok, subClosed: true, liveCount: 20 })).toBe(
      'dm_token_sub_closed',
    );
    expect(dmTokenIssueRefusal({ ...ok, liveCount: 19 })).toBeNull();
    expect(dmTokenIssueRefusal({ ...ok, liveCount: 20 })).toBe('dm_token_limit');
  });

  it('у Админки — только предел', () => {
    const adm = { ...ok, admin: true, demo: true, canTokens: false, extApi: false };
    expect(dmTokenIssueRefusal(adm)).toBeNull();
    expect(dmTokenIssueRefusal({ ...adm, liveCount: 20 })).toBe('dm_token_limit');
  });

  it('название: пустое, длинное, уже действует', () => {
    expect(dmTokenNameProblem('  ', [])).toBe('dm_token_name_required');
    expect(dmTokenNameProblem('x'.repeat(101), [])).toBe('dm_token_name_long');
    expect(dmTokenNameProblem('Power BI', ['Power BI'])).toBe('dm_token_name_taken');
    expect(dmTokenNameProblem(' Power BI ', ['Excel'])).toBeNull();
  });
});
