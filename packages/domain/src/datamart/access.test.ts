import { describe, expect, it } from 'vitest';
import type { AccessSubject } from '../roles/access';
import type { PermissionId, Scope, ScopeGroupId } from '../roles/permissions';
import {
  dmHasContractorColumn,
  dmTemplateSeen,
  dmTemplateTokenable,
  type DmTemplateSight,
} from './access';

// Видимость шаблона «Витрины данных» сотруднику — прототип v155 `dmSee` (блок 2, пункт 6).

const subject = (
  permissions: PermissionId[],
  scopes: Partial<Record<ScopeGroupId, Scope>> = {},
  isOwner = false,
): AccessSubject => ({ employeeId: 'e1', isOwner, permissions: new Set(permissions), scopes });

const tpl = (over: Partial<DmTemplateSight> = {}): DmTemplateSight => ({
  audience: 'org',
  state: 'published',
  module: 'reports',
  needPermission: null,
  columns: [{ code: 'cp', name: 'Контрагент', type: 'cp' }],
  ...over,
});

const ALL_ON = { finops: true, projects: true, indicators: true, fee: true };

describe('dmTemplateSeen', () => {
  it('нужен просмотр модуля шаблона; шаблон Админки, черновик и выключенный — никому', () => {
    const acc = subject(['repView', 'dmView']);
    expect(dmTemplateSeen(tpl(), acc, ALL_ON)).toBe(true);
    expect(dmTemplateSeen(tpl(), subject(['dmView']), ALL_ON)).toBe(false);
    const owner = subject([], {}, true);
    for (const t of [
      tpl({ audience: 'admin', module: null }),
      tpl({ state: 'draft' }),
      tpl({ state: 'off' }),
    ]) {
      expect(dmTemplateSeen(t, owner, ALL_ON)).toBe(false);
    }
    // «Сломан» виден — с пометкой (прототип: не черновик и не отключён).
    expect(dmTemplateSeen(tpl({ state: 'broken' }), acc, ALL_ON)).toBe(true);
  });

  it('функция модуля выключена — шаблона нет даже у владельца; «плата» — ещё и с функцией', () => {
    const owner = subject([], {}, true);
    expect(dmTemplateSeen(tpl({ module: 'fin' }), owner, {})).toBe(false);
    expect(dmTemplateSeen(tpl({ module: 'fin' }), owner, { finops: true })).toBe(true);
    const fee = tpl({ module: 'cps', needPermission: 'fee' });
    expect(dmTemplateSeen(fee, owner, {})).toBe(false);
    expect(dmTemplateSeen(fee, owner, { fee: true })).toBe(true);
    expect(dmTemplateSeen(fee, subject(['cpView']), { fee: true })).toBe(false);
    expect(dmTemplateSeen(fee, subject(['cpView', 'fee']), { fee: true })).toBe(true);
    // Неизвестное право шаблона открывает его только владельцу.
    const odd = tpl({ needPermission: 'nothing' });
    expect(dmTemplateSeen(odd, subject(['repView']), ALL_ON)).toBe(false);
    expect(dmTemplateSeen(odd, owner, ALL_ON)).toBe(true);
  });

  it('без столбца «Контрагент» у модуля с областью — только «Все контрагенты» или владелец', () => {
    const totals = tpl({ columns: [{ code: 'n', name: 'Сдано', type: 'num' }] });
    expect(dmTemplateSeen(totals, subject(['repView']), ALL_ON)).toBe(false);
    expect(dmTemplateSeen(totals, subject(['repView'], { reports: 'all' }), ALL_ON)).toBe(true);
    expect(dmTemplateSeen(totals, subject(['repView', 'viewAll']), ALL_ON)).toBe(true);
    expect(dmTemplateSeen(totals, subject([], {}, true), ALL_ON)).toBe(true);
    // Модуль без области («Сотрудники») — области не нужно.
    const staff = tpl({ module: 'staff', columns: [] });
    expect(dmTemplateSeen(staff, subject(['staffView']), ALL_ON)).toBe(true);
  });

  it('столбец «Контрагент» — вид cp или отметка contractor', () => {
    expect(dmHasContractorColumn([{ type: 'cp' }])).toBe(true);
    expect(dmHasContractorColumn([{ type: 'text', contractor: true }])).toBe(true);
    expect(dmHasContractorColumn([{ type: 'text' }])).toBe(false);
    expect(dmHasContractorColumn('нет')).toBe(false);
  });
});

// Токен отдаёт строки всей организации — выпуск строже прототипа `dmNewDlg` (docs/deviations.md п. Т-26).
describe('dmTemplateTokenable', () => {
  it('шаблон со столбцом «Контрагент» у модуля с областью — только «Все контрагенты» или владелец', () => {
    const byCp = tpl();
    expect(dmTemplateSeen(byCp, subject(['repView']), ALL_ON)).toBe(true);
    expect(dmTemplateTokenable(byCp, subject(['repView']), ALL_ON)).toBe(false);
    expect(dmTemplateTokenable(byCp, subject(['repView'], { reports: 'all' }), ALL_ON)).toBe(true);
    expect(dmTemplateTokenable(byCp, subject(['repView', 'viewAll']), ALL_ON)).toBe(true);
    expect(dmTemplateTokenable(byCp, subject([], {}, true), ALL_ON)).toBe(true);
    // Область другой группы не помогает.
    expect(dmTemplateTokenable(byCp, subject(['repView'], { cps: 'all' }), ALL_ON)).toBe(false);
  });

  it('модуль без области и невидимый шаблон', () => {
    const staff = tpl({ module: 'staff', columns: [] });
    expect(dmTemplateTokenable(staff, subject(['staffView']), ALL_ON)).toBe(true);
    // «Сотрудники» со столбцом «Контрагент» (готовый «Задачи»): «Вывод» отбирает «Свои» по группе
    // «Контрагенты» (`dmOwnScope`, этап 2, П4) — токен только при «Все» там.
    const tasks = tpl({ module: 'staff', columns: [{ code: 'contractor_id', type: 'cp' }] });
    expect(dmTemplateSeen(tasks, subject(['staffView']), ALL_ON)).toBe(true);
    expect(dmTemplateTokenable(tasks, subject(['staffView']), ALL_ON)).toBe(false);
    expect(dmTemplateTokenable(tasks, subject(['staffView'], { cps: 'all' }), ALL_ON)).toBe(true);
    expect(dmTemplateTokenable(tasks, subject([], {}, true), ALL_ON)).toBe(true);
    expect(dmTemplateTokenable(tpl(), subject(['dmView']), ALL_ON)).toBe(false);
    expect(dmTemplateTokenable(tpl({ state: 'off' }), subject([], {}, true), ALL_ON)).toBe(false);
  });
});
