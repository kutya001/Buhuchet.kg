import { describe, expect, it } from 'vitest';
import {
  PAGE_TIPS,
  pageFeePaidTill,
  pageKpiMonths,
  pageKpiYears,
  pageLateYear,
  pageMonthGroups,
  pageNav,
  pageOpenMonth,
  pagePeriodicity,
  pageReportCounts,
  pageReportMark,
  pageReportStatus,
  pageReportYears,
  pageReportsByDue,
  pageSpark,
  pageStateTone,
  pageTaxTotals,
  pageTiles,
  pageTipTexts,
  pageTypeNote,
  pageTypeTiles,
  pageVerdictAmount,
  pageYearReports,
  type PageReportFacts,
} from './view';

const TODAY = '2026-10-20';
const rep = (
  id: string,
  type: string,
  due: string,
  status: PageReportFacts['status'] = 'todo',
): PageReportFacts => ({ id, type, due, status });

describe('отметка отчёта на странице (прототип fk)', () => {
  it('сдан — «Сдано», срок прошёл — «Просрочено», иначе — «Впереди»', () => {
    expect(pageReportMark({ status: 'submitted', due: '2026-01-01' }, TODAY)).toBe('sub');
    expect(pageReportMark({ status: 'todo', due: '2026-10-19' }, TODAY)).toBe('late');
    expect(pageReportMark({ status: 'needs_fix', due: '2026-10-19' }, TODAY)).toBe('late');
    expect(pageReportMark({ status: 'in_progress', due: TODAY }, TODAY)).toBe('next');
  });

  it('«Требует исправления» показывается как «В работе» (прототип pubSt)', () => {
    expect(pageReportStatus('needs_fix')).toBe('in_progress');
    expect(pageReportStatus('todo')).toBe('todo');
    expect(pageReportStatus('submitted')).toBe('submitted');
  });

  it('по сроку, при равном сроке — в порядке списка', () => {
    const list = [
      rep('a', 'X', '2026-03-25'),
      rep('b', 'Y', '2026-01-20'),
      rep('c', 'Z', '2026-03-25'),
    ];
    expect(pageReportsByDue(list).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('«Отчёты»: год, плашки, плитки по видам', () => {
  // Пункт приёмки 68: 24 отчёта, 18 сданы.
  const types = ['EN', 'SF', 'NDS', 'PN'];
  const p68: PageReportFacts[] = [];
  for (let m = 1; m <= 12; m++) {
    const due = `2026-${String(m).padStart(2, '0')}-20`;
    p68.push(rep(`en${m}`, 'EN', due, m <= 9 ? 'submitted' : 'todo'));
    p68.push(rep(`sf${m}`, 'SF', due, m <= 9 ? 'submitted' : 'todo'));
  }

  it('годы срока сдачи: текущий и годы отчётов, сначала поздние', () => {
    expect(
      pageReportYears([rep('a', 'EN', '2025-02-20'), rep('b', 'EN', '2027-01-20')], TODAY),
    ).toEqual(['2027', '2026', '2025']);
    expect(pageReportYears([], TODAY)).toEqual(['2026']);
  });

  it('«сдано 18 из 24»: плашки считаются по отчётам года', () => {
    const yr = pageYearReports([...p68, rep('old', 'EN', '2025-12-20')], '2026');
    expect(yr).toHaveLength(24);
    expect(pageReportCounts(yr, TODAY)).toEqual({ sub: 18, next: 6, late: 0 });
    // 20.10 прошло: октябрьские не сданы — просрочены.
    expect(pageReportCounts(yr, '2026-10-21')).toEqual({ sub: 18, next: 4, late: 2 });
  });

  it('плитка на вид: «сдано N из M», просрочено, следующий срок', () => {
    const tiles = pageTypeTiles(p68, p68, types, TODAY);
    expect(tiles.map((t) => [t.type, t.submitted, t.total, t.late, t.next])).toEqual([
      ['EN', 9, 12, 0, '2026-10-20'],
      ['SF', 9, 12, 0, '2026-10-20'],
    ]);
    expect(tiles[0]!.reports).toHaveLength(12);
  });

  it('порядок плиток: с просрочкой, затем со сроком в 30 дней, затем по каталогу', () => {
    const yr = [
      rep('pn', 'PN', '2026-12-20'),
      rep('nds', 'NDS', '2026-11-15'),
      rep('sf', 'SF', '2026-10-10'),
      rep('en', 'EN', '2026-12-25'),
    ];
    expect(pageTypeTiles(yr, yr, types, TODAY).map((t) => t.type)).toEqual([
      'SF',
      'NDS',
      'EN',
      'PN',
    ]);
  });

  it('плашка-фильтр сужает периоды, а «сдано N из M» — по всем отчётам вида', () => {
    const yr = [
      rep('a', 'EN', '2026-01-20', 'submitted'),
      rep('b', 'EN', '2026-02-20'),
      rep('c', 'SF', '2026-11-20'),
    ];
    const late = yr.filter((r) => pageReportMark(r, TODAY) === 'late');
    const tiles = pageTypeTiles(yr, late, types, TODAY);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ type: 'EN', submitted: 1, total: 2, late: 1, next: null });
    expect(tiles[0]!.reports.map((r) => r.id)).toEqual(['b']);
  });

  it('вид не из каталога — после видов каталога', () => {
    const yr = [rep('x', 'ZZ', '2026-12-20'), rep('y', 'PN', '2026-12-20')];
    expect(pageTypeTiles(yr, yr, types, TODAY).map((t) => t.type)).toEqual(['PN', 'ZZ']);
  });

  it('«По срокам»: группы месяцев, раскрыт текущий или ближайший, иначе последний', () => {
    const groups = pageMonthGroups(
      [
        rep('a', 'EN', '2026-09-20'),
        rep('b', 'SF', '2026-11-20'),
        rep('c', 'EN', '2026-09-25', 'submitted'),
      ],
      TODAY,
    );
    expect(groups.map((g) => [g.month, g.reports.length, g.late])).toEqual([
      ['2026-09', 2, 1],
      ['2026-11', 1, 0],
    ]);
    expect(pageOpenMonth(['2026-09', '2026-11'], TODAY)).toBe('2026-11');
    expect(pageOpenMonth(['2026-09', '2026-10'], TODAY)).toBe('2026-10');
    expect(pageOpenMonth(['2026-01', '2026-02'], TODAY)).toBe('2026-02');
    expect(pageOpenMonth([], TODAY)).toBeNull();
  });

  it('«просрочено N» в строке состояния открывает год последнего просроченного', () => {
    expect(
      pageLateYear(
        [rep('a', 'EN', '2025-05-20'), rep('b', 'EN', '2026-02-20'), rep('c', 'EN', '2026-12-20')],
        TODAY,
      ),
    ).toBe('2026');
    expect(pageLateYear([rep('a', 'EN', '2026-12-20')], TODAY)).toBeNull();
  });

  it('периодичность и пояснение вида (прототип pubPer, pubNote)', () => {
    expect(pagePeriodicity({ period: 'Q', oneOff: false })).toBe('Q');
    expect(pagePeriodicity({ period: 'M', oneOff: true })).toBe('oneoff');
    expect(pageTypeNote({ clientNote: ' Сдаём до 20-го ', description: 'Длинное.' })).toBe(
      'Сдаём до 20-го',
    );
    expect(
      pageTypeNote({ clientNote: '', description: 'Единый налог. Сдаётся до 20 числа.' }),
    ).toBe('Единый налог.');
    expect(pageTypeNote({ clientNote: '', description: 'Без точки' })).toBe('Без точки');
    expect(pageTypeNote({ clientNote: '', description: '' })).toBe('');
  });
});

describe('строка состояния и «Главное»', () => {
  it('п. 74: долг без просрочек — жёлтая, с просроченным отчётом — красная', () => {
    expect(pageStateTone({ late: 0, short: 0, feeDebt: 0 })).toBe('ok');
    expect(pageStateTone({ late: 0, short: 0, feeDebt: 500_000 })).toBe('warn');
    expect(pageStateTone({ late: 0, short: 100, feeDebt: 0 })).toBe('warn');
    expect(pageStateTone({ late: 1, short: 0, feeDebt: 500_000 })).toBe('bad');
  });

  it('«Оплачено по <месяц>» — до первого неоплаченного начисления (прототип pubFeeTill)', () => {
    expect(
      pageFeePaidTill([
        { month: '2026-07', charge: 500_000, got: 500_000 },
        { month: '2026-08', charge: 0, got: 0 },
        { month: '2026-09', charge: 500_000, got: 500_000 },
        { month: '2026-10', charge: 500_000, got: 100 },
        { month: '2026-11', charge: 500_000, got: 500_000 },
      ]),
    ).toBe('2026-09');
    expect(pageFeePaidTill([{ month: '2026-10', charge: 500_000, got: 0 }])).toBeNull();
    expect(pageFeePaidTill([])).toBeNull();
  });

  it('плитки: «Налоги» во всю ширину, нечётная последняя — тоже', () => {
    expect(pageTiles({ reports: true, taxes: true, fee: true })).toEqual([
      { key: 'reports', wide: false },
      { key: 'next', wide: false },
      { key: 'taxes', wide: true },
      { key: 'fee', wide: true },
    ]);
    expect(pageTiles({ reports: true, taxes: false, fee: false })).toEqual([
      { key: 'reports', wide: false },
      { key: 'next', wide: false },
    ]);
    expect(pageTiles({ reports: false, taxes: true, fee: false })).toEqual([
      { key: 'taxes', wide: true },
    ]);
    expect(pageTiles({ reports: false, taxes: false, fee: true })).toEqual([
      { key: 'fee', wide: true },
    ]);
    expect(pageTiles({ reports: false, taxes: false, fee: false })).toEqual([]);
  });

  it('«Налоги {год}»: только отчёты года с суммой больше 0', () => {
    const r = (due: string, sum: number | null, got = 0, paid = 0, hasSum = true) => ({
      due,
      hasSum,
      sum,
      got,
      paid,
    });
    expect(
      pageTaxTotals(
        [
          r('2026-01-20', 100_000, 100_000, 100_000),
          r('2026-02-20', 50_000, 20_000, 0),
          r('2026-03-20', 0),
          r('2026-04-20', null),
          r('2026-05-20', 70_000, 0, 0, false),
          r('2025-12-20', 90_000, 90_000, 90_000),
        ],
        '2026',
      ),
    ).toEqual({ due: 150_000, got: 120_000, paid: 100_000, count: 2 });
  });

  it('сумма итога сверки: «Достаточно» — 0', () => {
    expect(pageVerdictAmount({ state: 'short', amount: 500 })).toBe(500);
    expect(pageVerdictAmount({ state: 'enough' })).toBe(0);
    expect(pageVerdictAmount({ state: 'surplus', amount: 7 })).toBe(7);
  });
});

describe('«Показатели» и панель разделов', () => {
  it('месяцы года — по текущий; прошлый год — все 12, будущий — ни одного', () => {
    expect(pageKpiMonths('2026', TODAY)).toHaveLength(10);
    expect(pageKpiMonths('2026', TODAY).at(-1)).toBe('2026-10');
    expect(pageKpiMonths('2025', TODAY)).toHaveLength(12);
    expect(pageKpiMonths('2027', TODAY)).toEqual([]);
    expect(pageKpiYears(['2024-05', '2026-01', '2024-06'], TODAY)).toEqual(['2026', '2024']);
  });

  it('мини-график: будущие — пусто, без значения — чёрточка, последний — акцентом (прототип pubSpark)', () => {
    const bars = pageSpark([10, null, 20, 5, undefined]);
    expect(bars[4]).toBeNull();
    expect(bars[0]).toEqual({ x: 1, h: 14, kind: 'value' });
    expect(bars[1]).toEqual({ x: 9, h: 1.5, kind: 'empty' });
    expect(bars[2]).toEqual({ x: 17, h: 28, kind: 'value' });
    expect(bars[3]).toEqual({ x: 25, h: 7, kind: 'current' });
    // Все нули — столбики у основания.
    expect(pageSpark([0, 0]).map((b) => b?.h)).toEqual([1.5, 1.5]);
    // Отрицательные — по модулю.
    expect(pageSpark([-20, 10]).map((b) => b?.h)).toEqual([28, 14]);
  });

  it('панель — показанные разделы по порядку, если их больше одного', () => {
    expect(pageNav(new Set(['contacts', 'main', 'reports']))).toEqual([
      'main',
      'reports',
      'contacts',
    ]);
    expect(pageNav(new Set(['main']))).toEqual([]);
  });
});

describe('пояснения страницы из «Текстов элементов экрана»', () => {
  it('переводятся по группе и подписи прототипа, пустые — не передаются', () => {
    expect(
      pageTipTexts({
        secs: { Главное: 'Самое важное', Контакты: '  ' },
        report: { Просрочено: 'Срок прошёл' },
        other: { x: 'y' },
      }),
    ).toEqual({ 'secs.main': 'Самое важное', 'report.late': 'Срок прошёл' });
  });

  it('у каждого обозначения — своя пара «группа, подпись»', () => {
    const pairs = Object.values(PAGE_TIPS).map(([g, l]) => `${g}|${l}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
