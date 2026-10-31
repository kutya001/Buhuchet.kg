import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/regdocs.json';
import {
  rdChars,
  rdDate,
  rdEmpty,
  rdExtract,
  rdFio,
  rdGked,
  rdPhone,
  rdQuotes,
  rdToCp,
  rdUnsupported,
  type RdDicts,
  type RdSource,
} from './regdocs';

// «Из свидетельства и выписки» (задача 2.17; прототип core/regdocs.js). Набор — синтетические
// свидетельство и выписка вымышленной организации и их варианты; ожидаемые итоги посчитаны переносом
// и при сборке набора сверены с прототипом (rdExtract, rdToCp в песочнице) — совпали все случаи.

const dicts = fixture.dicts as RdDicts;
const docs = fixture.docs as Record<string, RdSource>;
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
    expect(rdUnsupported(branch)).toBe(true);
    expect(rdUnsupported(rdExtract(doc('vyp')))).toBe(false);
    expect(rdUnsupported(rdExtract(doc('other')))).toBe(false);
  });

  it('распознанный скан: римский номер раздела, прочитанный как «Ш.», всё равно раздел', () => {
    const clean = rdToCp([rdExtract(doc('vyp'))], dicts);
    const sec = strs(doc('vyp')).find((s) => s.startsWith('III. '))!;
    const ocr = replaced(doc('vyp'), sec, sec.replace('III.', 'Ш.'));
    expect(rdToCp([rdExtract(ocr)], dicts)).toEqual(clean);
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
