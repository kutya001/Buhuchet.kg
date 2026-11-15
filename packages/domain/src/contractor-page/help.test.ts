import { describe, expect, it } from 'vitest';
import refDB from '../../../../spec/data/refDB.json';
import {
  CP_FAQ_ACTS,
  CP_FAQ_SECS,
  CP_HELP_HINT_KEYS,
  CP_HELP_WELCOME_KEYS,
  CP_TOUR_SECS,
  cpAlsoClean,
  cpAnswerClean,
  cpFaqActHint,
  cpFaqActOn,
  cpFaqList,
  cpFaqMove,
  cpFaqNewId,
  cpFaqNextOrd,
  cpGlossIndex,
  cpGlossKey,
  cpGlossSorted,
  cpGlossSplit,
  cpHelpCap,
  cpHelpFill,
  cpHelpLong,
  cpLegendRows,
  cpPaidSteps,
  cpTourMove,
  cpTourSteps,
  type CpGlossPart,
  type CpHelp,
  type CpHelpView,
} from './help';

/* Эталон — прототип v120 modules/cp-help.js и refDB.json `kbUi.cpHelp`. */
const help = (refDB as unknown as { kbUi: { cpHelp: CpHelp } }).kbUi.cpHelp;

const view = (over: Partial<CpHelpView> & { secs?: string[] } = {}): CpHelpView => ({
  sections: new Set(over.secs ?? ['main', 'pay', 'acc', 'reports', 'files', 'money', 'tg']),
  payTax: true,
  payFee: true,
  paid: true,
  up: true,
  tgFull: false,
  code: true,
  ...over,
});

const words = (parts: CpGlossPart[]) =>
  parts.filter((p): p is { i: number; text: string } => typeof p !== 'string').map((p) => p.text);

describe('тексты справочника — те, что знает продукт', () => {
  it('ключи «Добро пожаловать» и подсказок refDB — ровно ключи домена', () => {
    expect(Object.keys(help.welcome).sort()).toEqual([...CP_HELP_WELCOME_KEYS].sort());
    expect(Object.keys(help.hints).sort()).toEqual([...CP_HELP_HINT_KEYS].sort());
  });

  it('облачка, разделы вопросов и кнопки ответов refDB — из списков домена', () => {
    for (const s of help.tour) expect(CP_TOUR_SECS, s.id).toContain(s.sec);
    for (const q of help.faq) {
      expect(CP_FAQ_SECS, q.id).toContain(q.sec);
      expect(CP_FAQ_ACTS, q.id).toContain(q.act);
    }
    // Подписи кнопок ответов — подсказки act<Действие>.
    for (const a of CP_FAQ_ACTS) {
      if (a === '' || a === 'colors') continue;
      expect(help.hints[cpFaqActHint(a)], a).toBeTruthy();
    }
    expect(help.tour.at(-1)?.sec).toBe('end');
  });
});

describe('обзор страницы (cphTourList)', () => {
  it('все разделы видны — все 9 облачков, у «Как оплатить» и «Файлов» основной текст', () => {
    const s = cpTourSteps(help, view({ secs: ['main', 'pay', 'acc', 'reports', 'files', 'tg'] }));
    expect(s.map((x) => x.sec)).toEqual([
      'state',
      'main',
      'pay',
      'acc',
      'reports',
      'files',
      'tg',
      'help',
      'end',
    ]);
    expect(s.find((x) => x.sec === 'pay')?.x).toContain('«Я оплатил»');
  });

  it('скрытый раздел и выключенное облачко пропускаются; «Готово!» — всегда', () => {
    const off: CpHelp = {
      ...help,
      tour: help.tour.map((x) => (x.sec === 'acc' || x.sec === 'end' ? { ...x, on: false } : x)),
    };
    const s = cpTourSteps(off, view({ secs: ['main', 'reports'] }));
    expect(s.map((x) => x.sec)).toEqual(['state', 'main', 'reports', 'help', 'end']);
  });

  it('без «Я оплатил» и «Отправить файл» — «Текст, если действие недоступно»', () => {
    const s = cpTourSteps(help, view({ paid: false, up: false, secs: ['pay', 'files'] }));
    expect(s.find((x) => x.sec === 'pay')?.x).toBe(help.tour.find((x) => x.sec === 'pay')?.x2);
    expect(s.find((x) => x.sec === 'files')?.x).toBe(help.tour.find((x) => x.sec === 'files')?.x2);
  });

  it('«выше» и «ниже»: «Готово!» остаётся последним, край — null', () => {
    const t = help.tour;
    expect(cpTourMove(t, 'state', -1)).toBeNull();
    expect(cpTourMove(t, 'help', 1)).toBeNull();
    expect(cpTourMove(t, 'end', -1)).toBeNull();
    expect(cpTourMove(t, 'main', -1)?.map((x) => x.id).slice(0, 2)).toEqual(['main', 'state']);
  });
});

describe('«Помощь»: вопросы и кнопки (cphQVis, cphActOn)', () => {
  it('вопросы по «Порядку»; скрытые разделы и выключенные — без вопросов', () => {
    expect(cpFaqList(help, view()).map((q) => q.id)).toEqual([
      'pay-tax',
      'pay-fee',
      'paid',
      'wait',
      'up',
      'rej',
      'colors',
      'money',
      'tg',
      'code',
      'again',
      'safe',
    ]);
    const only = cpFaqList(
      { ...help, faq: help.faq.map((q) => (q.id === 'safe' ? { ...q, on: false } : q)) },
      view({ payFee: false, secs: ['reports'] }),
    ).map((q) => q.id);
    expect(only).toEqual(['pay-tax', 'paid', 'wait', 'colors', 'code', 'again']);
    // «Как оплатить: любая карточка» — нет ни одной карточки.
    expect(cpFaqList(help, view({ payTax: false, payFee: false })).map((q) => q.id)).not.toContain(
      'paid',
    );
  });

  it('кнопка ответа — только когда действие доступно, иначе «Спросите вашего бухгалтера»', () => {
    const v = view();
    expect(['goPay', 'paid', 'up', 'goFiles', 'goMoney', 'tg', 'code'].map((a) => cpFaqActOn(a as never, v))).toEqual(
      [true, true, true, true, true, true, true],
    );
    expect(cpFaqActOn('goFee', v)).toBe(false);
    expect(cpFaqActOn('goReports', v)).toBe(true);
    expect(cpFaqActOn('tg', view({ tgFull: true }))).toBe(false);
    expect(cpFaqActOn('code', view({ code: false }))).toBe(false);
    expect(cpFaqActOn('paid', view({ paid: false }))).toBe(false);
    expect(cpFaqActOn('up', view({ up: false }))).toBe(false);
    expect(cpFaqActOn('', v)).toBe(false);
    expect(cpFaqActOn('colors', v)).toBe(false);
    expect(cpFaqActHint('goPay')).toBe('actGoPay');
  });

  it('метки отчётов — строки «Метка» — объяснение', () => {
    const rows = cpLegendRows(help.faq.find((q) => q.act === 'colors')!.a);
    expect(rows.map((r) => r.label)).toEqual(['Сдан', 'В работе', 'К сдаче', 'Впереди', 'Просрочен']);
    expect(rows[0]?.text).toBe('бухгалтер отправил отчёт в орган, делать ничего не нужно.');
    expect(cpLegendRows('просто текст\n\n «А» - б ')).toEqual([
      { label: '', text: 'просто текст' },
      { label: 'А', text: 'б' },
    ]);
  });

  it('шаги «Я оплатил», подстановки, заглавная буква', () => {
    expect(cpPaidSteps(help.hints.paidSteps!)).toEqual([
      'Переведите деньги в своём банке',
      'Приложите чек',
      'Нажмите «Отправить»',
    ]);
    expect(cpPaidSteps(' | ')).toEqual([]);
    expect(cpHelpFill(help.hints.sendSum!, { месяц: 'август 2026' })).toBe(
      'Это налоги за август 2026, которые ещё нужно перевести',
    );
    expect(cpHelpFill('{мб} и {нет}', { мб: 20 })).toBe('20 и {нет}');
    expect(cpHelpCap('реквизиты')).toBe('Реквизиты');
    expect(cpHelpCap('')).toBe('');
  });
});

describe('«Словарик» (cphGlossRx, cphGloss)', () => {
  const ix = cpGlossIndex(help.gloss);
  const split = (t: string, used = new Set<number>()) => cpGlossSplit(t, ix, used);

  it('формы одного слова — по основе; сочетания — как написано; ё и е одинаково', () => {
    expect(words(split('Отчёты, которые мы сдаём'))).toEqual(['Отчёты']);
    expect(words(split('Нет отчетов'))).toEqual(['отчетов']);
    expect(words(split('Реквизиты для перевода'))).toEqual(['Реквизиты']);
    expect(words(split('Платёж единого налога'))).toEqual(['единого налога']);
    expect(words(split('Суммы к уплате'))).toEqual(['к уплате']);
    // «получатель» — основа «получател»: «Получателю» тоже.
    expect(words(split('Получателю'))).toEqual(['Получателю']);
  });

  it('каждое слово — один раз за раздел (used), не внутри слова', () => {
    const used = new Set<number>();
    expect(words(split('Отчёт и ещё отчёт', used))).toEqual(['Отчёт']);
    expect(words(split('Снова отчёты', used))).toEqual([]);
    expect(words(split('подотчётный'))).toEqual([]);
  });

  it('сокращения — только заглавными', () => {
    expect(words(split('Платёж НДС в ГНС'))).toEqual(['НДС', 'ГНС']);
    expect(words(split('ндс и гнс'))).toEqual([]);
  });

  it('куски: текст между словами сохраняется целиком', () => {
    const parts = split('Нажмите «Я оплатил» и приложите чек.');
    expect(parts.map((p) => (typeof p === 'string' ? p : `[${p.text}]`)).join('')).toBe(
      'Нажмите «Я оплатил» и приложите [чек].',
    );
    expect(split('')).toEqual([]);
    expect(cpGlossSplit('отчёт', cpGlossIndex([]), new Set())).toEqual(['отчёт']);
  });

  it('по алфавиту, без пустых слов', () => {
    const s = cpGlossSorted([...help.gloss, { w: '', x: 'x' }]);
    expect(s).toHaveLength(help.gloss.length);
    expect(s[0]?.w).toBe('аванс');
  });
});

describe('Админка: окна правки', () => {
  it('предложение длиннее 15 слов — подсказка', () => {
    expect(cpHelpLong('Короткое. И ещё одно.')).toBe(false);
    expect(cpHelpLong(Array.from({ length: 16 }, (_, i) => `слово${i}`).join(' '))).toBe(true);
    expect(cpHelpLong(`${'а '.repeat(10)}.\n${'б '.repeat(10)}`)).toBe(false);
  });

  it('ответ, «Другие формы», слово для сравнения', () => {
    expect(cpAnswerClean(' шаг 1 \n\n шаг 2')).toBe('шаг 1\nшаг 2');
    expect(cpAlsoClean(' к уплате,, уплаты ')).toBe('к уплате, уплаты');
    expect(cpGlossKey(' Отчёт ')).toBe('отчет');
  });

  it('новый вопрос: свободный код и «Порядок» после наибольшего', () => {
    expect(cpFaqNewId(35, new Set())).toBe('qz');
    expect(cpFaqNewId(35, new Set(['qz']))).toBe('q10');
    expect(cpFaqNextOrd(help.faq)).toBe(13);
    expect(cpFaqNextOrd([])).toBe(1);
  });

  it('вопрос «выше» и «ниже» — обмен «Порядком»; одинаковый «Порядок» расходится', () => {
    const f = cpFaqMove(help.faq, 'pay-fee', -1)!;
    expect(f.find((q) => q.id === 'pay-fee')?.ord).toBe(1);
    expect(f.find((q) => q.id === 'pay-tax')?.ord).toBe(2);
    expect(cpFaqMove(help.faq, 'pay-tax', -1)).toBeNull();
    expect(cpFaqMove(help.faq, 'nope', 1)).toBeNull();
    const same = [
      { ...help.faq[0]!, id: 'a', ord: 5 },
      { ...help.faq[1]!, id: 'b', ord: 5 },
    ];
    const m = cpFaqMove(same, 'b', -1)!;
    expect(m.find((q) => q.id === 'b')!.ord).toBeLessThan(m.find((q) => q.id === 'a')!.ord);
  });
});
