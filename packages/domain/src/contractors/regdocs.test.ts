import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/regdocs.json';
import ipFixture from './__fixtures__/regdocs-ipsv.json';
import {
  rdChars,
  rdDate,
  rdEmpty,
  rdExtract,
  rdFio,
  rdGked,
  rdPhone,
  rdProblem,
  rdQuotes,
  rdToCp,
  type RdDicts,
  type RdSource,
} from './regdocs';

// «Из свидетельства и выписки» (задача 2.17; прототип core/regdocs.js). Набор — синтетические
// свидетельство и выписка вымышленной организации и их варианты; ожидаемые итоги посчитаны переносом
// и при сборке набора сверены с прототипом (rdExtract, rdToCp в песочнице) — совпали все случаи.

const dicts = fixture.dicts as RdDicts;
const docs = { ...fixture.docs, ...ipFixture.docs } as Record<string, RdSource>;
const doc = (name: string) => docs[name]!;
const strs = (d: RdSource) => d.pages.flatMap((p) => p.items.map((i) => i.str));
const replaced = (d: RdSource, from: string, to: string): RdSource => ({
  ...d,
  pages: d.pages.map((p) => ({
    items: p.items.map((i) => (i.str === from ? { ...i, str: to } : i)),
  })),
});

describe('Разбор документов как в прототипе', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = c.files.map((f) => rdExtract(doc(f)));
    expect(parsed.map((d) => d.kind)).toEqual(c.kinds);
    expect(parsed.map((d) => d.issued)).toEqual(c.issued);
    expect(rdToCp(parsed, dicts)).toEqual(c.result);
  });

  it('свидетельство и выписка — одна организация: реквизиты из обоих, подпись «из выписки и свидетельства»', () => {
    const out = rdToCp([rdExtract(doc('svid')), rdExtract(doc('vyp'))], dicts);
    expect(out.err).toBeNull();
    if (out.err) return;
    expect(out.res.v).toMatchObject({
      name: 'ОсОО «Тестовая бухгалтерия»',
      inn: '02503202010045',
      okpo: '31415926',
      regNo: '214365-3301-ООО',
      form: 'ФС-01',
      phone: '+996555010203',
      head: 'Тестова Айгуль Тестовна',
      regDate: '2020-03-15',
      founders: 1,
    });
    expect(out.res.src.inn).toBe('both');
    expect(out.res.src.phone).toBe('vyp');
    expect(out.res.gk?.code).toBe('69.20.0');
    expect(out.res.ugns).toBe('ugns-bishkek-okt');
  });

  it('расхождение: в форме — значение более позднего документа, второе — с датой', () => {
    const c = fixture.cases.find((x) => x.name === 'alt')!;
    const out = rdToCp(
      c.files.map((f) => rdExtract(doc(f))),
      dicts,
    );
    if (out.err) throw new Error(out.err);
    expect(out.res.alt.head).toEqual([
      { v: 'Примеров Бакыт Примерович', src: 'svid', date: '2026-10-20' },
      { v: 'Тестова Айгуль Тестовна', src: 'vyp', date: '2026-10-18' },
    ]);
  });

  it('ошибки итога: ни один не распознан, разные организации, филиал', () => {
    expect(rdToCp([rdExtract(doc('other'))], dicts)).toEqual({ err: 'none' });
    expect(rdToCp([], dicts)).toEqual({ err: 'none' });
    expect(rdToCp([rdExtract(doc('vyp')), rdExtract(doc('vypOther'))], dicts)).toEqual({
      err: 'diff',
    });
    const branch = rdExtract(doc('vypBranch'));
    expect(rdProblem(branch)).toBe('branch');
    expect(rdProblem(rdExtract(doc('vyp')))).toBeNull();
    expect(rdProblem(rdExtract(doc('other')))).toBeNull();
  });

  it('распознанный скан: римский номер раздела, прочитанный как «Ш.», всё равно раздел', () => {
    const clean = rdToCp([rdExtract(doc('vyp'))], dicts);
    const sec = strs(doc('vyp')).find((s) => s.startsWith('III. '))!;
    const ocr = replaced(doc('vyp'), sec, sec.replace('III.', 'Ш.'));
    expect(rdToCp([rdExtract(ocr)], dicts)).toEqual(clean);
  });
});

// Свидетельство о регистрации ИП из ГНС (прототип v82, решение заказчика 09.11.2026). Набор —
// синтетическое свидетельство вымышленного предпринимателя: раскладка (положение текста на листе) —
// как у настоящего свидетельства ГНС, все значения заменены; ожидаемое посчитано прототипом
// (rdExtract, rdToCp в песочнице на справочниках набора), форма «ИП» — кодом формы с этим названием.
describe('Свидетельство ИП как в прототипе', () => {
  it.each(ipFixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = c.files.map((f) => rdExtract(doc(f)));
    expect(parsed.map((d) => d.kind)).toEqual(c.kinds);
    expect(parsed.map((d) => d.issued)).toEqual(c.issued);
    if ('f' in c) expect(parsed.map((d) => d.f)).toEqual(c.f);
    expect(rdToCp(parsed, dicts)).toEqual(c.result);
  });

  it('свидетельство ИП: реквизиты, форма ИП, УГНС из шапки — не «по адресу»', () => {
    const out = rdToCp([rdExtract(doc('ipsv'))], dicts);
    if (out.err) throw new Error(out.err);
    expect(out.res.v).toMatchObject({
      name: 'ИП Токтогулов А. Б.',
      full: 'Индивидуальный предприниматель Токтогулов Азамат Бакытович',
      head: 'Токтогулов Азамат Бакытович',
      inn: '21503199000123',
      regNo: '123-4567-890-1234',
      okpo: '31415926',
      form: 'ФС-02',
      addr: 'Бишкек г., Первомайский р-н, улица Киевская, дом 15',
      regDate: '2021-03-15',
    });
    expect(out.res.src.inn).toBe('ipsv');
    expect(out.res.ugns).toBe('ugns-bishkek-perv');
    expect(out.res.ugnsSrc).toBe('ipsv');
    expect(out.res.gk?.code).toBe('62.01.0');
  });

  it('без названия в свойствах PDF — по шапке ГНС; кыргызский лист — если русского нет', () => {
    const noTitle = rdExtract({ ...doc('ipsv'), title: '' });
    expect(noTitle.kind).toBe('ipsv');
    const kgOnly = rdExtract({ ...doc('ipsv'), pages: doc('ipsv').pages.slice(1) });
    expect(kgOnly.kind).toBe('ipsv');
    expect(kgOnly.f.inn).toEqual({ v: '21503199000123', kg: true });
    // ни названия, ни шапки — не свидетельство ИП
    const bare = rdExtract({
      pages: [{ items: [{ str: 'ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ', x: 10, y: 10, w: 100, h: 10 }] }],
    });
    expect(bare.kind).not.toBe('ipsv');
  });

  it('не прочитано (нет ИНН или ФИО) — «read»; ИП в формате юрлица — «ip»; вместе с юрлицом — «mix»', () => {
    expect(rdProblem(rdExtract(doc('ipsvNoInn')))).toBe('read');
    expect(rdProblem(rdExtract(doc('ipsv')))).toBeNull();
    const noHead = rdExtract(replaced(doc('ipsv'), 'Токтогулов Азамат Бакытович', '12345'));
    expect(noHead.f.head).toBeUndefined();
    expect(rdProblem(noHead)).toBe('read');
    // справка Минюста о предпринимателе: без наименования юрлица — нужно свидетельство ИП из ГНС
    const line = (str: string, y: number) => ({ str, x: 40, y, w: 300, h: 10 });
    const ipLike = rdExtract({
      pages: [
        {
          items: [
            line('Справка (свидетельство) о государственной регистрации', 700),
            line('Индивидуальный предприниматель:', 680),
            line('Тестов Тест Тестович', 665),
            line('ИНН:', 650),
            line('21503199000123', 635),
          ],
        },
      ],
    });
    expect(ipLike.kind).toBe('svid');
    expect(rdProblem(ipLike)).toBe('ip');
    expect(rdToCp([ipLike], dicts)).toEqual({ err: 'ip' });
    expect(rdToCp([rdExtract(doc('svid')), rdExtract(doc('ipsv'))], dicts)).toEqual({
      err: 'mix',
    });
  });
});

describe('ГКЭД по документу', () => {
  it('выключенный в справочнике подкласс не подставляется сам', () => {
    const off = dicts.gked.map((g) => (g.code === '69.20.0' ? { ...g, active: false } : g));
    expect(rdGked('69.20.0', '', dicts.gked).code).toBe('69.20.0');
    const r = rdGked('69.20.0', '', off);
    expect(r.code).toBe('');
    expect(r.raw).toBe('69.20.0');
  });

  it('класс с одним подклассом — подкласс; группа с несколькими — выбор; без кода — похожие по словам', () => {
    expect(rdGked('69.20', '', dicts.gked).code).toBe('69.20.0');
    expect(rdGked('69.20.0', '', dicts.gked).code).toBe('69.20.0');
    expect(rdGked('62.0', '', dicts.gked).choose).toEqual([
      '62.01.0',
      '62.02.0',
      '62.03.0',
      '62.09.0',
    ]);
    const like = rdGked('', 'Деятельность в области бухгалтерского учета и аудита', dicts.gked);
    expect(like.code).toBe('');
    expect(like.like[0]).toBe('69.20.0');
    expect(like.like.length).toBeLessThanOrEqual(5);
    expect(rdGked('', '', dicts.gked)).toEqual({
      code: '',
      choose: [],
      like: [],
      raw: '',
      text: '',
    });
  });
});

describe('Значения полей', () => {
  it('пустое значение документа', () => {
    for (const v of [
      '',
      '---',
      '== не заполнено ==',
      'нет данных',
      'Не указано',
      null,
      undefined,
    ]) {
      expect(rdEmpty(v)).toBe(true);
    }
    expect(rdEmpty('Октябрьский район')).toBe(false);
  });

  it('даты, ФИО, кавычки, телефон', () => {
    expect(rdDate('15.03.2020 год')).toBe('2020-03-15');
    expect(rdDate('5/3/2020')).toBe('2020-03-05');
    expect(rdDate('---')).toBe('');
    expect(rdFio('ТЕСТОВА  АЙГУЛЬ ТЕСТОВНА')).toBe('Тестова Айгуль Тестовна');
    expect(rdQuotes('ОсОО "Альфа"')).toBe('ОсОО «Альфа»');
    expect(rdQuotes('ОсОО “Бета”')).toBe('ОсОО «Бета»');
    expect(rdPhone('+996 555 01-02-03')).toBe('+996555010203');
    expect(rdPhone('0555010203')).toBe('+996555010203');
    expect(rdPhone('555010203')).toBe('+996555010203');
    expect(rdPhone('55501')).toBe('');
  });

  it('знаков текста: меньше 40 — в PDF нет текста', () => {
    expect(rdChars(doc('vyp'))).toBeGreaterThan(40);
    expect(rdChars({ pages: [{ items: [{ str: '  ', x: 0, y: 0, w: 1, h: 1 }] }] })).toBe(0);
  });
});
