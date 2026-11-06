import { describe, expect, it } from 'vitest';
import { FILE_SOURCE_KINDS } from '../files/files';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import {
  PAGE_FILE_LINK_SECONDS,
  pageFileApplies,
  pageFileCategories,
  pageFileCategory,
  pageFileRel,
} from './files';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

describe('раздел «Файлы» страницы контрагента (прототип v74 pubFiles)', () => {
  it('категория по источнику; задачи, списания и показатели на страницу не попадают', () => {
    expect(pageFileCategory('report')).toBe('rep');
    expect(pageFileCategory('contractor')).toBe('doc');
    expect(pageFileCategory('manual')).toBe('doc');
    expect(pageFileCategory('tax_payment')).toBe('pay');
    expect(pageFileCategory('receipt')).toBe('in');
    expect(pageFileCategory('one_off_service')).toBe('prj');
    expect(pageFileCategory('one_off_service_payment')).toBe('prj');
    expect(pageFileCategory('project')).toBe('prj');
    expect(pageFileCategory('project_payment')).toBe('prj');
    expect(pageFileCategory('fee_payment')).toBe('fee');
    expect(pageFileCategory('task')).toBeNull();
    expect(pageFileCategory('money_operation')).toBeNull();
    expect(pageFileCategory('indicator_value')).toBeNull();
    expect(pageFileCategory('constructor')).toBeNull();
    // У каждого вида источника решено, попадает ли он на страницу.
    for (const k of FILE_SOURCE_KINDS) expect(pageFileCategory(k)).not.toBeUndefined();
  });

  it('«Скрыть со страницы» — только у файла контрагента не задачи (прототип pgFileOk)', () => {
    expect(pageFileApplies({ sourceKind: 'report', contractorId: 'c1' })).toBe(true);
    expect(pageFileApplies({ sourceKind: 'manual', contractorId: null })).toBe(false);
    expect(pageFileApplies({ sourceKind: 'task', contractorId: 'c1' })).toBe(false);
  });

  it('категории следуют разделам страницы; «Документы компании» — всегда', () => {
    expect(pageFileCategories(['files'], { projects: false, fee: false })).toEqual(['doc']);
    expect(
      pageFileCategories(['reports', 'files', 'money'], { projects: true, fee: true }),
    ).toEqual(['rep', 'doc', 'pay', 'in', 'prj', 'fee']);
    expect(pageFileCategories(['reports', 'files'], { projects: false, fee: true })).toEqual([
      'rep',
      'doc',
      'fee',
    ]);
  });

  it('ссылка на файл раздела — 5 минут (ТЗ)', () => {
    expect(PAGE_FILE_LINK_SECONDS).toBe(300);
  });

  it('к чему относится — как в прототипе', () => {
    const report = { type: 'НДС', period: 'M' as const, start: '2026-09-01', event: null };
    expect(pageFileRel({ kind: 'report', ...report }, t)).toBe('НДС · 09.2026');
    expect(pageFileRel({ kind: 'regdocs' }, t)).toBe('Из свидетельства и выписки');
    expect(pageFileRel({ kind: 'manual', note: ' Договор ' }, t)).toBe('Договор');
    expect(pageFileRel({ kind: 'manual', note: null }, t)).toBe('');
    expect(
      pageFileRel({ kind: 'tax_payment', report, amount: 300_000, date: '2026-10-20' }, t),
    ).toBe('НДС · 09.2026, оплата 3 000 сом от 20.10.2026');
    expect(
      pageFileRel({ kind: 'tax_payment', report: null, amount: 300_000, date: '2026-10-20' }, t),
    ).toBe('оплата 3 000 сом от 20.10.2026');
    expect(pageFileRel({ kind: 'receipt', amount: 1_500_000, date: '2026-10-12' }, t)).toBe(
      'Поступление 15 000 сом от 12.10.2026',
    );
    expect(pageFileRel({ kind: 'service', name: 'Регистрация' }, t)).toBe('Услуга «Регистрация»');
    expect(pageFileRel({ kind: 'project', name: 'Регистрация филиала' }, t)).toBe(
      'Проект «Регистрация филиала»',
    );
    expect(pageFileRel({ kind: 'fee_payment', amount: 500_000, date: '2026-10-05' }, t)).toBe(
      'Оплата 5 000 сом от 05.10.2026',
    );
  });
});
