import { describe, expect, it } from 'vitest';
import {
  BOT_WIDGET_DATA_MAX,
  BOT_WIDGET_HTML_MAX,
  BOT_WIDGET_MAX,
  parseWidgetQuery,
  widgetData,
  widgetHtml,
  widgetMarkDone,
  widgetPick,
  widgetWeekDates,
  type WidgetReport,
  type WidgetTexts,
} from './widget';

// Виджет «Мои отчёты на неделю» (поток Т, задача Т9; прототип v106 modules/tg-widget.js — `tgWgSnap`,
// `tgWgTabs`, `tgcWidget`).
const MON = '2026-11-16';
const rep = (id: string, due: string, patch: Partial<WidgetReport> = {}): WidgetReport => ({
  id,
  contractor: 'ОсОО «Ромашка»',
  report: 'НДС, окт.',
  status: 'К сдаче',
  due,
  ...patch,
});
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const TEXTS: WidgetTexts = {
  head: 'Мои отчёты · 16.11–22.11',
  updated: 'обновлено в 09:00',
  over: 'Просрочено',
  none: 'В этот день сдавать нечего.',
  more: (n) => `ещё ${n} — на сайте`,
  weekdayShort: (i) => DAYS[i]!,
  due: (d) => `срок ${d}`,
};

describe('что попадает в виджет', () => {
  it('просроченные и до конца недели; после недели — нет; давние первыми', () => {
    const pick = widgetPick(
      [rep('w', '2026-11-20'), rep('x', '2026-11-25'), rep('o', '2026-10-20'), rep('t', MON)],
      MON,
    );
    expect(pick.items.map((r) => r.id)).toEqual(['o', 't', 'w']);
    expect(pick).toMatchObject({ more: 0, week: 2, over: 1 });
  });

  it('в выходные — следующая неделя; отчёт со сроком в субботу виден', () => {
    const sat = '2026-11-14';
    const pick = widgetPick([rep('s', sat), rep('n', '2026-11-20'), rep('z', '2026-11-23')], sat);
    expect(pick.items.map((r) => r.id)).toEqual(['s', 'n']);
    const { data } = widgetData(pick, sat, TEXTS);
    expect(data.t.map((t) => t[0])).toEqual([
      'Сб 14.11',
      'Пн 16.11',
      'Вт 17.11',
      'Ср 18.11',
      'Чт 19.11',
      'Пт 20.11',
    ]);
  });

  it('не больше 12: сначала неделя, просроченных не меньше 4 самых давних', () => {
    const over = Array.from({ length: 10 }, (_, i) => rep(`o${i}`, `2026-10-${10 + i}`));
    const week = Array.from({ length: 10 }, (_, i) => rep(`w${i}`, '2026-11-18'));
    const pick = widgetPick([...week, ...over], MON);
    expect(pick.items).toHaveLength(BOT_WIDGET_MAX);
    expect(pick.items.filter((r) => r.due < MON).map((r) => r.id)).toEqual([
      'o0',
      'o1',
      'o2',
      'o3',
    ]);
    expect(pick).toMatchObject({ more: 8, week: 10, over: 10 });
    // Недели мало — место отдаётся просроченным.
    expect(widgetPick([...over, week[0]!], MON).items).toHaveLength(11);
  });
});

describe('данные виджета', () => {
  it('вкладки «Просрочено» и дни с числом; строки по вкладкам; у просроченного — срок', () => {
    const pick = widgetPick([rep('o', '2026-10-20'), rep('a', MON), rep('b', '2026-11-18')], MON);
    const { data, ids } = widgetData(pick, MON, TEXTS);
    expect(ids).toEqual(['o', 'a', 'b']);
    expect(data.t).toEqual([
      ['Просрочено', 1],
      ['Пн 16.11', 1],
      ['Вт 17.11', 0],
      ['Ср 18.11', 1],
      ['Чт 19.11', 0],
      ['Пт 20.11', 0],
    ]);
    expect(data.r).toEqual([
      [0, 'ОсОО «Ромашка»', 'НДС, окт. · срок 20.10', 0],
      [1, 'ОсОО «Ромашка»', 'НДС, окт. · К сдаче', 0],
      [3, 'ОсОО «Ромашка»', 'НДС, окт. · К сдаче', 0],
    ]);
    expect(data.m).toBe('');
  });

  it('не больше 1 КБ: длинные названия укорачиваются, лишние строки уходят в «ещё N»', () => {
    const long = 'Общество с ограниченной ответственностью «Очень длинное название фирмы»';
    const list = Array.from({ length: 12 }, (_, i) =>
      rep(`r${i}`, '2026-11-18', {
        contractor: long,
        report: 'Единая налоговая декларация, III кв.',
      }),
    );
    const { data, ids } = widgetData(widgetPick(list, MON), MON, TEXTS);
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(
      BOT_WIDGET_DATA_MAX,
    );
    expect(ids.length).toBeLessThan(12);
    expect(data.m).toBe(`ещё ${12 - ids.length} — на сайте`);
    expect(data.r[0]![1].length).toBeLessThanOrEqual(24);
  });

  it('галочка: строка «сдан», на её вкладке на один меньше; повтор и чужой номер — без изменений', () => {
    const { data } = widgetData(widgetPick([rep('a', MON), rep('b', MON)], MON), MON, TEXTS);
    const done = widgetMarkDone(data, 1);
    expect(done.r[1]![3]).toBe(1);
    expect(done.t[0]).toEqual(['Пн 16.11', 1]);
    expect(widgetMarkDone(done, 1)).toBe(done);
    expect(widgetMarkDone(done, 7)).toBe(done);
  });

  it('запрос виджета: «u» и «d:<номер>», остальное не принимается', () => {
    expect(parseWidgetQuery('u')).toEqual({ kind: 'refresh' });
    expect(parseWidgetQuery('d:3:7')).toEqual({ kind: 'done', row: 3, version: 7 });
    expect(parseWidgetQuery('d:3')).toBeNull();
    expect(parseWidgetQuery('d:abc:1')).toBeNull();
    expect(parseWidgetQuery('d:123:1')).toBeNull();
    expect(parseWidgetQuery('repDone:1')).toBeNull();
  });

  it('неделя для подписи', () => {
    expect(widgetWeekDates(MON)).toBe('16.11–22.11');
  });
});

describe('HTML виджета', () => {
  // Предел 4 КБ после сжатия zlib проверяет тест API (`packages/api/src/modules/telegram/widget.test.ts`):
  // домену Node API недоступен.
  it('в пределах Telegram: 32 КБ; без сети и полей ввода; подписи экранированы', () => {
    const html = widgetHtml({
      refresh: 'Обновить</script><script>alert(1)</script>',
      site: 'Открыть отчёты на сайте',
      siteUrl: 'https://buhuchet.kg/app/reports/week',
    });
    expect(new TextEncoder().encode(html).length).toBeLessThanOrEqual(BOT_WIDGET_HTML_MAX);
    expect(html).not.toMatch(/<input|<form|<iframe|fetch\(|XMLHttpRequest|src=/);
    expect(html).not.toContain('</script><script>alert');
    expect(html).toContain('TelegramWidget');
  });
});
