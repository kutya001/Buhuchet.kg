import { describe, expect, it } from 'vitest';
import type { AccessSubject } from '../roles/access';
import type { PermissionId, Scope, ScopeGroupId } from '../roles/permissions';
import { dmContractorColumn, dmOwnScope, dmScopeQuery } from './scope';

// Область «Свои контрагенты» в «Выводе» — прототип v155 `dmRun` (блок 2, пункт 6; этап 2, П4).

const subject = (
  permissions: PermissionId[],
  scopes: Partial<Record<ScopeGroupId, Scope>> = {},
  isOwner = false,
): AccessSubject => ({ employeeId: 'e1', isOwner, permissions: new Set(permissions), scopes });

const A = '0b4a3c52-8d0e-4c2f-9a51-1f2e3d4c5b6a';
const B = 'F1E2D3C4-B5A6-4978-8695-A4B3C2D1E0F9';

describe('dmContractorColumn', () => {
  it('первый столбец с отметкой «Контрагент» или вида cp; иначе null', () => {
    expect(
      dmContractorColumn([
        { code: 'name', type: 'text', contractor: false },
        { code: 'contractor_id', type: 'cp', contractor: true },
      ]),
    ).toBe('contractor_id');
    expect(dmContractorColumn([{ code: 'cp', type: 'cp' }])).toBe('cp');
    expect(dmContractorColumn([{ code: 'who', type: 'text', contractor: true }])).toBe('who');
    expect(dmContractorColumn([{ code: 'n', type: 'num', contractor: false }])).toBeNull();
    expect(dmContractorColumn([{ type: 'cp' }, null, 'x'])).toBeNull();
    expect(dmContractorColumn(null)).toBeNull();
  });
});

describe('dmOwnScope', () => {
  it('нужен отбор, только когда в группе прав модуля шаблона — «Свои»', () => {
    const own = subject(['cpView', 'repView'], { cps: 'own', reports: 'all' });
    const cp = [{ code: 'contractor_id', type: 'cp' }];
    expect(dmOwnScope('cps', own, cp)).toBe(true);
    expect(dmOwnScope('reports', own, cp)).toBe(false);
    // Без области в роли — «Свои» (как у списков).
    expect(dmOwnScope('fin', own, cp)).toBe(true);
    // Шаблон Админки — без отбора.
    expect(dmOwnScope(null, own, cp)).toBe(false);
    // Владелец и «Видеть всех контрагентов» — без отбора.
    expect(dmOwnScope('cps', subject([], {}, true), cp)).toBe(false);
    expect(dmOwnScope('cps', subject(['cpView', 'viewAll'], { cps: 'own' }), cp)).toBe(false);
  });

  it('модуль без области («Сотрудники»): со столбцом «Контрагент» — по области «Контрагентов», без него — без отбора', () => {
    const cp = [{ code: 'contractor_id', type: 'cp' }];
    const own = subject(['cpView', 'staffView'], { cps: 'own' });
    expect(dmOwnScope('staff', own, cp)).toBe(true);
    expect(dmOwnScope('staff', own, [{ code: 'emp', type: 'text' }])).toBe(false);
    expect(dmOwnScope('staff', subject(['cpView', 'staffView'], { cps: 'all' }), cp)).toBe(false);
    expect(dmOwnScope('staff', subject(['staffView', 'viewAll'], { cps: 'own' }), cp)).toBe(false);
    expect(dmOwnScope('staff', subject([], {}, true), cp)).toBe(false);
  });
});

describe('dmScopeQuery', () => {
  it('результат шаблона — подзапрос, остаются строки своих контрагентов (сравнение текстом)', () => {
    expect(dmScopeQuery('select 1 as contractor_id', 'contractor_id', [A, B])).toBe(
      `SELECT * FROM (\nselect 1 as contractor_id\n) dm_s WHERE (dm_s."contractor_id")::text = ANY ('{${A},${B.toLowerCase()}}'::text[])`,
    );
  });

  it('пустой список — ни одной строки; кавычки в имени столбца удваиваются', () => {
    expect(dmScopeQuery('q', 'a"b', [])).toBe(
      `SELECT * FROM (\nq\n) dm_s WHERE (dm_s."a""b")::text = ANY ('{}'::text[])`,
    );
  });

  it('номер контрагента — только UUID: иначе ошибка, в текст ничего не попадает', () => {
    expect(() => dmScopeQuery('q', 'c', ["x'}'::text[]) or true --"])).toThrow(RangeError);
  });
});
