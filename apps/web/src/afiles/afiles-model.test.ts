import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  ageText,
  backText,
  barHeight,
  categoryRows,
  filesCountText,
  gbText,
  mbText,
  memoryBar,
  monthBars,
  oneDecimal,
  orgFilesFilter,
  pctClass,
  STORE_PRESETS,
  storePlateColors,
  viewerIdOf,
} from './afiles-model';

// Админка → «Файлы» и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2, блоки 3–5;
// прототип v154 admin/admin-files.js: afN1, afGb, afMemBar, renderAFStore, afBackDlg, renderAFCheck).

const t = makeTranslate(defaultUiTexts());
const NB = ' ';
const MB = 1048576;

describe('«Файлы» Админки: числа', () => {
  it('один знак без лишнего нуля, разряды неразрывным пробелом (прототип afN1)', () => {
    expect(oneDecimal(9.44)).toBe('9,4');
    expect(oneDecimal(9.96)).toBe('10');
    expect(oneDecimal(9)).toBe('9');
    expect(oneDecimal(1234.5)).toBe(`1${NB}234,5`);
    expect(oneDecimal(0)).toBe('0');
  });

  it('ГБ — по 1 000 МБ, как в ценах подписки; МБ — с одним знаком', () => {
    expect(gbText(t, 14_000 * MB)).toBe('14 ГБ');
    expect(gbText(t, 9_400 * MB)).toBe('9,4 ГБ');
    expect(mbText(12.5 * MB)).toBe('12,5');
    expect(filesCountText(t, 1)).toBe('1 файл');
    expect(filesCountText(t, 3)).toBe('3 файла');
    expect(filesCountText(t, 1000)).toBe(`1${NB}000 файлов`);
  });

  it('«Возраст» лишнего файла: до суток — часы, дальше — дни', () => {
    expect(ageText(t, 5)).toBe('5 ч');
    expect(ageText(t, 24)).toBe('1 день');
    expect(ageText(t, 72)).toBe('3 дня');
    expect(ageText(t, 24 * 5 + 3)).toBe('5 дней');
  });
});

describe('«Хранилище»: плашки и столбики', () => {
  const summary = (sent: number, trash: number, diff: number) =>
    ({
      sent: { n: sent, bytes: 0 },
      trash: { n: trash, bytes: 0 },
      diff,
    }) as Parameters<typeof storePlateColors>[0];

  it('есть что разобрать — плашка не зелёная (прототип renderAFStore)', () => {
    expect(storePlateColors(summary(0, 0, 0))).toEqual({
      sent: 'green',
      trash: 'green',
      diff: 'green',
    });
    expect(storePlateColors(summary(2, 1, 3))).toEqual({
      sent: 'blue',
      trash: 'yellow',
      diff: 'red',
    });
  });

  it('плашки открывают «Все файлы» с фильтром по коду, строка организации — по её номеру', () => {
    expect(STORE_PRESETS.sent).toEqual({ st: { type: 'enum', vals: ['new', 'rejected'] } });
    expect(STORE_PRESETS.lead).toEqual({ src: { type: 'enum', vals: ['lead'] } });
    expect(STORE_PRESETS.rcpt).toEqual({ src: { type: 'enum', vals: ['subscription'] } });
    expect(STORE_PRESETS.tot).toEqual({});
    expect(orgFilesFilter('o1')).toEqual({ org: { type: 'enum', vals: ['o1'] } });
  });

  it('столбики по месяцам: три буквы месяца, подсказка с годом и МБ, ненулевой — виден', () => {
    const bars = monthBars(t, [
      { month: '2026-01', bytes: 0 },
      { month: '2026-11', bytes: 5.5 * MB },
    ]);
    expect(bars).toEqual([
      { key: '2026-01', label: 'янв', title: 'Январь 2026: 0 МБ', value: 0 },
      { key: '2026-11', label: 'ноя', title: 'Ноябрь 2026: 5,5 МБ', value: 6 },
    ]);
    expect(barHeight(0, 100)).toBe(0);
    expect(barHeight(1, 1000)).toBe(2);
    expect(barHeight(50, 100)).toBe(50);
  });

  it('номер файла окна — вид и номер строки (у каждого вида свои номера)', () => {
    expect(viewerIdOf({ kind: 'trash', id: 'a' })).toBe('trash:a');
    expect(viewerIdOf({ kind: 'file', id: 'a' })).toBe('file:a');
  });
});

describe('Память организации и «Вернуть»', () => {
  it('без подписки — только объём и что лимит появится (прототип afMemBar)', () => {
    expect(
      memoryBar(t, {
        usedBytes: 1500 * MB,
        limitBytes: null,
        pct: null,
        includedBytes: null,
        extraGb: null,
      }),
    ).toEqual({
      used: 'Занято 1,5 ГБ',
      pct: null,
      width: null,
      hint: 'Лимит появится, когда у организации будет подписка',
    });
  });

  it('с подпиской — «из», процент, полоса не шире 100 % и что входит в цену', () => {
    const bar = memoryBar(t, {
      usedBytes: 15_000 * MB,
      limitBytes: 14_000 * MB,
      pct: 107.1,
      includedBytes: 12_000 * MB,
      extraGb: 2,
    });
    expect(bar.used).toBe('Занято 15 ГБ из 14 ГБ');
    expect(bar.pct).toBe('107,1 %');
    expect(bar.width).toBe(100);
    expect(bar.hint).toBe(
      'В цену входит 12 ГБ · куплено сверх 2 ГБ. Считается всё, что загрузила организация; удалённые файлы, чеки подписок и документы заявки не считаются',
    );
    expect(pctClass(107.1)).toContain('text-danger-label');
    expect(pctClass(85)).toContain('text-warn-label');
    expect(pctClass(10)).toBe('');
    expect(pctClass(null)).toBe('');
  });

  it('текст «Вернуть»: лишний файл — в список расхождений; файл — туда, где был, и в память организации', () => {
    expect(backText(t, { why: 'extra', srcText: null, orgName: null })).toBe(
      'Файл снова появится в списке «лишних» на вкладке «Проверка хранилища» и стираться не будет.',
    );
    expect(backText(t, { why: 'del', srcText: 'Отчёт', orgName: 'ОсОО «Альфа»' })).toBe(
      'Файл снова появится там, где был (Отчёт), и снова будет считаться в память организации «ОсОО «Альфа»». Возврат запишется в историю файла.',
    );
    expect(backText(t, { why: 'del', srcText: null, orgName: 'Бета' })).toBe(
      'Файл снова появится там, где был, и снова будет считаться в память организации «Бета». Возврат запишется в историю файла.',
    );
  });

  it('«Объём по категориям»: больше места — выше', () => {
    expect(
      categoryRows([
        { src: 'manual', n: 3, bytes: 10 },
        { src: 'report', n: 1, bytes: 50 },
        { src: 'card', n: 2, bytes: 10 },
      ]).map((r) => r.src),
    ).toEqual(['report', 'manual', 'card']);
  });
});
