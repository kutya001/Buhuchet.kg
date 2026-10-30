import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import { productionCalendar } from '../platform-dicts/calendar';
import type {
  BizSize,
  GkedRule,
  PayerKind,
  PickGroup,
  ReportKind,
} from '../platform-dicts/catalog';
import { effectiveRule, type ReportTypeRule } from '../reports/due';
import { periodFull } from '../reports/periods';
import fixture from './__fixtures__/report-pick.json';
import {
  baseToggle,
  benefitFits,
  benefitWarnings,
  nearestDueText,
  reportPick,
  reportPickAllWhy,
  reportPickAuto,
  reportPickBaseDiff,
  reportPickChanges,
  reportsNotNeeded,
  statBaseAuto,
  statusDueText,
  type PickDict,
  type PickSubject,
} from './report-pick';

// Эталон — прототип (scripts/oracle-report-pick.mjs): все демо-контрагенты с видами демо-организации и
// придуманные контрагенты на пункты приёмки 28, 51, 53–55 со всеми подключёнными видами.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

const rule = (r: unknown) => (r as GkedRule | null) ?? null;
const dict: PickDict = {
  types: fixture.dict.types.map((x) => ({
    ...x,
    kind: x.kind as ReportKind,
    payer: x.payer as PayerKind,
    pickGroup: x.pickGroup as PickGroup,
    bizSizes: x.bizSizes as BizSize[],
    gked: rule(x.gked),
  })),
  benefits: fixture.dict.benefits.map((x) => ({
    ...x,
    payer: x.payer as PayerKind,
    gked: rule(x.gked),
  })),
  bases: fixture.dict.bases,
  rates: fixture.dict.rates,
  index: new Map(fixture.dict.index.map((x) => [x.code, x])),
};

type Case = (typeof fixture.cases)[number];
const subjectOf = (s: Case['subject']): PickSubject => ({
  ...s,
  form: s.form && { code: s.form.code, declarationFor: s.form.declarationFor as 'org' | 'ip' },
  bizSize: s.bizSize as BizSize,
});
const named = (name: string) => fixture.cases.find((c) => c.name === name)!;

describe('Подбор отчётов — как в прототипе', () => {
  it.each(fixture.cases)('$name', ({ subject, expected }) => {
    const r = reportPick(subjectOf(subject), dict, fixture.date, t);
    expect(
      [...r.rec].map(([code, x]) => ({
        code,
        grp: x.section,
        pre: x.pre,
        why: x.why,
        must: x.must,
      })),
    ).toEqual(expected.rec);
    expect(Object.fromEntries(r.no)).toEqual(expected.no);
    expect(Object.fromEntries(r.off)).toEqual(expected.off);
    expect(r.hidden).toEqual(expected.hidden);
    expect([...r.stat]).toEqual(expected.stat);
  });
});

describe('Окно «Льготы и особые статусы» — как в прототипе', () => {
  it.each(fixture.cases)('$name', ({ subject, expected }) => {
    const s = subjectOf(subject);
    expect(dict.benefits.filter((b) => benefitFits(b, s, dict.index)).map((b) => b.code)).toEqual(
      expected.fits,
    );
    const warns = Object.fromEntries(
      dict.benefits
        .map((b) => ({
          code: b.code,
          warns: benefitWarnings(b, s, [...new Set([...s.benefits, b.code])], dict, t),
        }))
        .filter((x) => x.warns.length)
        .map((x) => [x.code, x.warns]),
    );
    expect(warns).toEqual(expected.warns);
  });
});

describe('Пункты приёмки', () => {
  const pick = (name: string) => {
    const s = subjectOf(named(name).subject);
    return { s, r: reportPick(s, dict, fixture.date, t) };
  };

  it('п. 28: единый налог, резидент ПКИ, наёмные сотрудники — отмечены заранее ЕН, отчисления ПКИ и STI-161; ЕНД не нужен по статусу; НДС не подходит к режиму', () => {
    const { r } = pick('придуманный 1');
    expect(r.rec.get('enq')).toMatchObject({ section: 'regime', pre: true });
    expect(r.rec.get('pkid')).toMatchObject({
      section: 'status',
      pre: true,
      why: 'По статусу «Резидент ПКИ»',
    });
    expect(r.rec.get('soc')).toMatchObject({ section: 'basis', pre: true });
    expect(reportPickAuto(r)).toEqual(expect.arrayContaining(['enq', 'pkid', 'soc']));
    expect(r.rec.has('endo')).toBe(false);
    const nds = dict.types.find((x) => x.code === 'nds')!;
    const endo = dict.types.find((x) => x.code === 'endo')!;
    expect(reportPickAllWhy(endo, r, t)).toEqual({
      why: 'Не нужен по статусу «Резидент ПКИ»',
      disabled: false,
    });
    expect(reportPickAllWhy(nds, r, t)).toEqual({
      why: 'Не подходит к режиму «Единый налог»',
      disabled: true,
    });
  });

  it('п. 51: годовая финансовая отчётность — «Для всех» у среднего бизнеса, у малого — только со статусом «Субъект публичного интереса»', () => {
    expect(pick('придуманный 2').r.rec.get('fin')).toMatchObject({ section: 'all', pre: true });
    expect(pick('придуманный 3').r.rec.has('fin')).toBe(false);
    expect(pick('придуманный 4').r.rec.get('fin')).toMatchObject({ section: 'status', pre: true });
  });

  it('п. 53 и 54: ГКЭД 94.99 — 4-фин в «Подходит по ГКЭД 94»; форма Нацстаткома включает основание и отмечает 1-Т', () => {
    const { s, r } = pick('придуманный 5');
    expect(r.rec.get('fin4y')).toMatchObject({
      section: 'gked',
      pre: false,
      why: 'Подходит по ГКЭД 94',
    });
    expect([...r.rec.values()].some((x) => x.section === 'stat')).toBe(false);
    expect(r.stat.has('t1m')).toBe(true);
    const auto = statBaseAuto('fin4y', s, dict, fixture.date, t)!;
    expect(auto.bases).toContain('statSample');
    expect(auto.select.sort()).toEqual(['t1m', 't1y']);
    expect(statBaseAuto('fin4y', { ...s, bases: auto.bases }, dict, fixture.date, t)).toBeNull();
    expect(statBaseAuto('nds', s, dict, fixture.date, t)).toBeNull();
  });

  it('п. 55: утилизационный сбор производителей отмечен заранее, при импорте — «По желанию», разовый', () => {
    const { r } = pick('придуманный 8');
    expect(r.rec.get('utlq')).toMatchObject({ section: 'basis', pre: true });
    expect(r.rec.get('utli')).toMatchObject({ section: 'choice', pre: false });
  });
});

describe('Основания в шапке подбора', () => {
  const s = subjectOf(named('придуманный 3').subject);

  it('включённое основание отмечает свои отмечаемые заранее виды, выключенное — снимает их', () => {
    const on = baseToggle('employees', true, ['nds'], s, dict, fixture.date, t);
    expect(on.bases).toContain('employees');
    expect(on.selected).toEqual(expect.arrayContaining(['nds', 'soc']));
    const off = baseToggle(
      'employees',
      false,
      on.selected,
      { ...s, bases: on.bases },
      dict,
      fixture.date,
      t,
    );
    expect(off.bases).not.toContain('employees');
    expect(off.selected).not.toContain('soc');
    expect(off.selected).toContain('nds');
  });

  it('выключенное «В списке Нацстаткома» снимает формы, у которых нет другого основания', () => {
    const withStat = { ...s, bases: ['statSample'] };
    const off = baseToggle('statSample', false, ['t1m', 'nds'], withStat, dict, fixture.date, t);
    expect(off.selected).toEqual(['nds']);
  });
});

describe('«Основания изменились» после «Изменить» (docs/deviations.md п. А-7)', () => {
  const s = subjectOf(named('придуманный 3').subject);

  it('включённое основание предлагает добавить его отмечаемые сами отчёты, которых нет', () => {
    const after = { ...s, bases: [...s.bases, 'employees'] };
    const d = reportPickBaseDiff(s.bases, after, ['nds'], dict, fixture.date, t);
    expect(d.on).toEqual(['employees']);
    expect(d.off).toEqual([]);
    expect(d.add).toContain('soc');
    expect(d.add).not.toContain('nds');
    expect(d.remove).toEqual([]);
  });

  it('выключенное основание предлагает снять назначенные виды без другого включённого основания', () => {
    const before = [...s.bases, 'employees', 'property', 'land'];
    const after = { ...s, bases: [...s.bases, 'land'] };
    const d = reportPickBaseDiff(before, after, ['nds', 'soc', 'imn'], dict, fixture.date, t);
    expect(d.off).toEqual(['employees', 'property']);
    // «Налог на имущество» держится и на «Есть земля» — не снимается.
    expect(d.remove).toEqual(['soc']);
    expect(d.add).toEqual([]);
  });

  it('основания не менялись — предлагать нечего', () => {
    expect(reportPickBaseDiff(s.bases, s, ['nds'], dict, fixture.date, t)).toEqual({
      on: [],
      off: [],
      add: [],
      remove: [],
    });
  });
});

describe('Изменение отчётов контрагента', () => {
  it('добавятся новые отмеченные, снимутся снятые назначенные', () => {
    expect(reportPickChanges(['nds', 'npa'], ['nds', 'soc'])).toEqual({
      add: ['soc'],
      remove: ['npa'],
    });
  });

  it('«По статусу «…» не нужны»: назначенные виды, которые статус делает ненужными', () => {
    expect(reportsNotNeeded(['ЛЬГ-03', 'ЛЬГ-29'], ['nds', 'npa', 'soc'], dict)).toEqual([
      { benefit: 'ЛЬГ-03', name: 'Сельскохозяйственный производитель', types: ['nds', 'npa'] },
    ]);
  });
});

describe('Описание вида для контрагента', () => {
  // НДС: ежемесячно, до 20-го числа месяца после отчётного; срок с выходного переносится.
  const nds: ReportTypeRule = {
    code: 'nds',
    kind: 'cross',
    period: 'M',
    dueDay: 20,
    dueAfter: 1,
    dueMonth: null,
    dueFrom: 'end',
    oneOff: false,
    act: 'both',
    payDay: null,
    payAfter: null,
    payMonth: null,
    paySchedule: null,
    shiftToWorkday: true,
    skipQuarters: [],
    periodPerAssignment: false,
  };
  const quarter: ReportTypeRule = { ...nds, code: 'q', period: 'Q', dueDay: 25, act: 'sub' };
  const calendar = productionCalendar([]);
  const big = {
    benefitCode: 'ЛЬГ-30',
    dueDay: 31,
    dueAfter: 1,
    dueMonth: null,
    payDay: null,
    payAfter: null,
  };

  it('«Ближайший срок» — первый период, срок которого не прошёл (прототип pkNear)', () => {
    const rule = (x: ReportTypeRule, s: typeof big | null = null) => effectiveRule(x, null, s);
    expect(nearestDueText(rule(nds), '2026-10-27', calendar, t)).toBe(
      '20.11.2026 — за Октябрь 2026',
    );
    expect(nearestDueText(rule(nds), '2026-10-20', calendar, t)).toBe(
      '20.10.2026 — за Сентябрь 2026',
    );
    // 25.01.2027 — понедельник; III квартал (срок 25.10) уже прошёл.
    expect(nearestDueText(rule(quarter), '2026-10-27', calendar, t)).toBe(
      '25.01.2027 — за IV квартал 2026',
    );
    // Срок по статусу: до последнего дня месяца после отчётного — сентябрь ещё впереди; 31.10 — суббота.
    expect(nearestDueText(rule(nds, big), '2026-10-27', calendar, t)).toBe(
      '02.11.2026 — за Сентябрь 2026',
    );
    expect(nearestDueText(rule({ ...nds, oneOff: true }), '2026-10-27', calendar, t)).toBe('');
  });

  it('«Срок по статусу» — срок статуса словами с названием статуса (прототип ovText)', () => {
    expect(statusDueText(nds, null, 'Крупный налогоплательщик', t)).toBe('');
    expect(statusDueText(nds, big, 'Крупный налогоплательщик', t)).toBe(
      'Сдача — до последнего дня месяца после отчётного (статус «Крупный налогоплательщик»)',
    );
    const pay = { ...big, dueDay: null, dueAfter: null, payDay: 25, payAfter: 1 };
    expect(statusDueText(nds, pay, 'Крупный налогоплательщик', t)).toBe(
      'Сдача — до 20-го числа месяца после отчётного; уплата — до 25-го числа месяца после отчётного (статус «Крупный налогоплательщик»)',
    );
    expect(statusDueText({ ...nds, act: 'pay' }, pay, 'Крупный налогоплательщик', t)).toBe(
      'Уплата — до 25-го числа месяца после отчётного (статус «Крупный налогоплательщик»)',
    );
  });

  it('период полностью (прототип phuman)', () => {
    expect(periodFull({ period: 'M', start: '2026-10-01' }, t)).toBe('Октябрь 2026');
    expect(periodFull({ period: 'Q', start: '2026-07-01' }, t)).toBe('III квартал 2026');
    expect(periodFull({ period: 'H', start: '2026-07-01' }, t)).toBe('II полугодие 2026');
    expect(periodFull({ period: 'Y', start: '2026-01-01' }, t)).toBe('2026 год');
  });
});
