import { formatSom } from '@buhuchet/domain';
import type { DmAdminTemplateCard, DmTemplateCheckResult } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import type { Translate } from '../l10n/translate';
import {
  tplAfterCheck,
  tplBody,
  tplCheckedQuery,
  tplCheckTable,
  tplCheckText,
  tplDirty,
  tplDraftOf,
  tplErrorField,
  tplFieldProblems,
  tplHint,
  tplHistoryItems,
  tplOffText,
  tplOrgsMissing,
  tplQueryChecked,
  tplSaveWarnText,
} from './tpl-admin-model';

// Админка → «Шаблоны» и окно шаблона (прототип v155 `renderDmTplAdm`, `dmEdit`, `dmStateDlg`).

/** Словарь теста: ключ и подстановки — чтобы видеть, что и с чем выбрано. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}${JSON.stringify(values)}` : key) as unknown as Translate;

const card = (over: Partial<DmAdminTemplateCard> = {}): DmAdminTemplateCard => ({
  id: '00000000-0000-4000-8000-000000000001',
  code: 'reports-due',
  name: 'Отчёты к сдаче',
  description: null,
  audience: 'org',
  module: 'reports',
  needPermission: null,
  access: 'all',
  orgIds: [],
  state: 'published',
  builtin: false,
  locked: true,
  query: 'select 1 as n',
  params: [],
  columns: [{ code: 'n', name: 'N', type: 'num', total: false }],
  version: 3,
  checkedAt: '2026-11-20T10:00:00.000Z',
  checkedOrgName: null,
  checkError: null,
  copiedFromName: null,
  toks: 0,
  tokOrgs: 0,
  orgs: 0,
  canOff: true,
  canOn: false,
  history: [],
  ...over,
});

describe('окно шаблона: что вводится и что уходит (прототип dmEdit)', () => {
  it('новый — «Отчеты для сдачи», «Все организации», запрос и два столбца по контрагентам', () => {
    const d = tplDraftOf(t, null);
    expect(d).toMatchObject({ audience: 'org', module: 'reports', access: 'all', params: [] });
    expect(d.query).toMatch(/^SELECT c\.id AS contractor_id/);
    expect(d.columns.map((c) => [c.code, c.type])).toEqual([
      ['contractor_id', 'cp'],
      ['cp', 'text'],
    ]);
    expect(d.columns[0]!.name).toBe('dm.ed.cp_col');
  });

  it('открытый — поля шаблона; проверенный запрос считается проверенным', () => {
    const c = card({ description: 'Описание', module: null });
    const d = tplDraftOf(t, c);
    expect(d).toMatchObject({
      name: c.name,
      code: c.code,
      description: 'Описание',
      module: 'reports',
    });
    expect(tplCheckedQuery(c)).toBe(c.query);
    expect(tplCheckedQuery(card({ checkedAt: null }))).toBeNull();
    expect(tplCheckedQuery(null)).toBeNull();
    expect(tplQueryChecked(c.query, c.query)).toBe(true);
    expect(tplQueryChecked(c.query, `${c.query} `)).toBe(false);
    expect(tplQueryChecked(null, c.query)).toBe(false);
  });

  it('правка поля — «есть несохранённое», открытие — нет', () => {
    const d = tplDraftOf(t, card());
    expect(tplDirty(d, tplDraftOf(t, card()))).toBe(false);
    expect(tplDirty({ ...d, name: 'Другое' }, d)).toBe(true);
  });

  it('название и код: пусто — «Введите…», код не латиницей — «Только латиница…»', () => {
    const d = tplDraftOf(t, null);
    expect(tplFieldProblems(d)).toEqual({ name: 'dm.ed.name_req', code: 'dm.ed.code_req' });
    expect(tplFieldProblems({ ...d, name: 'А', code: 'Отчёты' })).toEqual({
      code: 'dm.ed.code_bad',
    });
    expect(tplFieldProblems({ ...d, name: 'А', code: 'reports-due-2' })).toEqual({});
  });

  it('«Выбранные организации» без отмеченных — отказ; у шаблона Админки доступ не важен', () => {
    const d = { ...tplDraftOf(t, null), access: 'selected' as const };
    expect(tplOrgsMissing(d)).toBe(true);
    expect(tplOrgsMissing({ ...d, orgIds: ['x'] })).toBe(false);
    expect(tplOrgsMissing({ ...d, audience: 'admin' })).toBe(false);
  });

  it('тело запроса: у шаблона Админки нет модуля, права и доступа; пустое название поля — код', () => {
    const d = {
      ...tplDraftOf(t, null),
      name: ' Шаблон ',
      code: ' x-1 ',
      description: '  ',
      access: 'selected' as const,
      orgIds: ['o1'],
      needPermission: 'fee' as const,
      params: [{ code: 'month', name: ' ', type: 'month' as const, required: true, default: null }],
    };
    expect(tplBody(d, { publish: true, checkOrgId: 'o2' })).toMatchObject({
      name: 'Шаблон',
      code: 'x-1',
      description: null,
      module: 'reports',
      needPermission: 'fee',
      access: 'selected',
      orgIds: ['o1'],
      publish: true,
      checkOrgId: 'o2',
      params: [{ code: 'month', name: 'month' }],
    });
    expect(
      tplBody({ ...d, audience: 'admin' }, { publish: false, checkOrgId: 'o2' }),
    ).toMatchObject({
      module: null,
      needPermission: null,
      access: 'all',
      orgIds: [],
      checkOrgId: null,
    });
    expect(tplBody({ ...d, access: 'all' }, { publish: false, checkOrgId: null }).orgIds).toEqual(
      [],
    );
  });
});

describe('«Проверить» (прототип de-chk, dm-prev)', () => {
  const ok: Extract<DmTemplateCheckResult, { ok: true }> = {
    ok: true,
    orgName: 'Бухгалтер Плюс',
    n: 120,
    more: false,
    ms: 15,
    params: [{ code: 'month', name: 'Месяц', type: 'month', required: true, default: 'month' }],
    columns: [
      { code: 'contractor_id', name: 'Контрагент (для области)', type: 'cp', total: false },
      { code: 'cp', name: 'Контрагент', type: 'text', total: false },
      { code: 'fee', name: 'Сумма', type: 'money', total: true },
      { code: 'paid', name: 'Оплачено', type: 'bool', total: false },
    ],
    rows: [['id-1', 'Альфа', '125050', true]],
  };

  it('прошла — параметры и столбцы из ответа; не прошла — только параметры, если разобрались', () => {
    const d = tplDraftOf(t, null);
    expect(tplAfterCheck(d, ok)).toMatchObject({ params: ok.params, columns: ok.columns });
    const bad: DmTemplateCheckResult = { ok: false, problem: 'sql', message: 'x', params: [] };
    expect(tplAfterCheck(d, bad)).toEqual(d);
    expect(tplAfterCheck(d, { ...bad, params: ok.params }).params).toEqual(ok.params);
  });

  it('строка итога: организация, строк, мс и «ниже первые 100»; у Админки — без организации', () => {
    expect(tplCheckText(t, ok)).toBe(
      `dm.ed.check_ok${JSON.stringify({ org: 'Бухгалтер Плюс', n: '120', ms: 15 })}dm.ed.check_first`,
    );
    expect(tplCheckText(t, { ...ok, orgName: null, n: 1, more: true })).toBe(
      `dm.ed.check_ok_adm${JSON.stringify({ n: '1+', ms: 15 })}`,
    );
  });

  it('таблица: без «Контрагента (для области)», деньги сомами, «Да»', () => {
    const table = tplCheckTable(ok, { yes: 'Да', no: 'Нет' });
    expect(table.columns.map((c) => [c.key, !!c.numeric])).toEqual([
      ['cp', false],
      ['fee', true],
      ['paid', false],
    ]);
    expect(table.rows[0]!.cells).toEqual({ cp: 'Альфа', fee: formatSom(125050), paid: 'Да' });
  });

  it('отказ сервера: запрос и проверка — под «Запросом», код и вид — под своими полями', () => {
    expect(tplErrorField('dm_sql_forbidden')).toBe('query');
    expect(tplErrorField('dm_check_required')).toBe('query');
    expect(tplErrorField('dm_param_missing')).toBe('query');
    expect(tplErrorField('dm_code_taken')).toBe('code');
    expect(tplErrorField('dm_code_locked')).toBe('code');
    expect(tplErrorField('dm_kind_locked')).toBe('audience');
    expect(tplErrorField('dm_module_required')).toBe('module');
    expect(tplErrorField('dm_builtin')).toBeNull();
    expect(tplErrorField('dm_orgs_required')).toBeNull();
  });
});

describe('история, предупреждения и подсказка', () => {
  it('история — не больше 12 строк, сверху новые (как отдал сервер), время по Бишкеку', () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      at: `2026-11-${String(20 - (i % 10)).padStart(2, '0')}T18:30:00.000Z`,
      who: 'Администратор платформы',
      what: `Строка ${i}`,
    }));
    const items = tplHistoryItems(card({ history }));
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({ text: 'Строка 0', who: 'Администратор платформы' });
    // 18:30 UTC — уже 21 ноября по Бишкеку (UTC+6).
    expect(items[0]).toMatchObject({ date: '21.11.2026', time: '00:30' });
  });

  it('«Отключить»: о токенах — только когда они есть; «Сохранить?» — токены и организации', () => {
    expect(tplOffText(t, 0, 0)).toBe('dm.tpl.off.text');
    expect(tplOffText(t, 3, 2)).toBe(
      `dm.tpl.off.text dm.tpl.off.toks${JSON.stringify({
        n: 3,
        orgs: `dm.tpl.in_orgs.few${JSON.stringify({ n: 2 })}`,
      })}`,
    );
    expect(tplSaveWarnText(t, 1, 1)).toBe(
      `dm.ed.warn_text${JSON.stringify({
        toks: `dm.ed.toks.one${JSON.stringify({ n: 1 })}`,
        orgs: `dm.tpl.in_orgs.one${JSON.stringify({ n: 1 })}`,
      })}`,
    );
  });

  it('таблицы базы: у шаблона Админки — ещё таблицы платформы; закрытой sessions нет', () => {
    const org = tplHint('org').map(([n]) => n);
    const adm = tplHint('admin').map(([n]) => n);
    expect(org).toContain('contractors');
    expect(org).not.toContain('organizations');
    expect(adm.slice(0, 2)).toEqual(['organizations', 'platform_leads']);
    expect(adm).not.toContain('sessions');
  });
});
