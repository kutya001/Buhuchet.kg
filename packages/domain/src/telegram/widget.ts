import { addDays, weekdayMondayFirst, type IsoDate } from '../common/dates';
import { reportWeek } from '../reports/rules';
import { botClip } from './bot-message';
import { botDayMonth } from './staff-bot';

/*
 * Виджет «Мои отчёты на неделю» (поток Т, задача Т9; пакет заказчика 13.11.2026, идея 5; прототип v106
 * modules/tg-widget.js). Виджет — маленький экран в личном чате с ботом (виджеты Telegram, Bot API 10.4):
 * HTML со своим сценарием, отправленный один раз, и данные виджета (`chat_data`, до 1 КБ), которые бот
 * меняет без нового сообщения. Здесь — что попадает в список, данные виджета и сам HTML; отчёты, права и
 * отправку собирает сервер.
 */

/** Отчётов в виджете — не больше (прототип `TG_WG_MAX`); просроченных — не меньше (`TG_WG_OVER`). */
export const BOT_WIDGET_MAX = 12;
export const BOT_WIDGET_OVER_MIN = 4;
/** Пределы Telegram: данные виджета — байт; HTML — байт и байт после сжатия zlib. */
export const BOT_WIDGET_DATA_MAX = 1024;
export const BOT_WIDGET_HTML_MAX = 32768;
export const BOT_WIDGET_HTML_ZIP_MAX = 4096;
/** Запрос виджета к боту — не длиннее (байт). */
export const BOT_WIDGET_QUERY_MAX = 64;
/** Утром бот обновляет виджеты, присланные не раньше стольких дней назад. */
export const BOT_WIDGET_REFRESH_DAYS = 7;
/** Название и отчёт в строке виджета — не длиннее (знаков): данные виджета ограничены 1 КБ. */
const CONTRACTOR_MAX = 24;
const REPORT_MAX = 22;
/** Заголовок, время, «ещё N», пустой день — не длиннее (знаков); подписи вкладок — тоже: шаблоны правятся в
 * Админке, а данные виджета без строк должны поместиться в 1 КБ. */
const TEXT_MAX = 48;
const TAB_MAX = 16;

/** Свой отчёт для виджета: несданный, сотрудник — ответственный. */
export interface WidgetReport {
  id: string;
  contractor: string;
  /** «НДС, окт.». */
  report: string;
  /** Статус словами («К сдаче»). */
  status: string;
  due: IsoDate;
}

export interface WidgetPick {
  /** Отчёты в виджете — по порядку строк. */
  items: WidgetReport[];
  /** Не поместились. */
  more: number;
  /** Сдать на неделе и просрочено — всего, а не только показанные. */
  week: number;
  over: number;
}

/**
 * Что показать (прототип `tgWgSnap`): несданные с прошедшим сроком и со сроком до конца недели (в
 * выходные — следующей). Не помещается всё — сначала отчёты недели, просроченных не меньше
 * `BOT_WIDGET_OVER_MIN` самых давних.
 */
export function widgetPick(reports: readonly WidgetReport[], today: IsoDate): WidgetPick {
  const { to } = reportWeek(today);
  const list = reports
    .filter((r) => r.due <= to)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : 1));
  const over = list.filter((r) => r.due < today);
  const week = list.filter((r) => r.due >= today);
  const nOver = Math.min(over.length, Math.max(BOT_WIDGET_OVER_MIN, BOT_WIDGET_MAX - week.length));
  const items = [...over.slice(0, nOver), ...week.slice(0, BOT_WIDGET_MAX - nOver)];
  return { items, more: list.length - items.length, week: week.length, over: over.length };
}

/** Тексты данных виджета — шаблоны бота и словарь. */
export interface WidgetTexts {
  head: string;
  updated: string;
  over: string;
  none: string;
  more: (n: number) => string;
  weekdayShort: (index: number) => string;
  /** «срок 12.10» — у просроченного вместо статуса. */
  due: (dayMonth: string) => string;
}

/**
 * Данные виджета (`chat_data`): заголовок, время, вкладки [подпись, осталось сдать], строки
 * [вкладка, контрагент, «отчёт · статус», сдан 0/1], «ещё N — на сайте», пустой день. Номер строки — её
 * место в `items`: виджет присылает боту «d:<номер>», а не номер отчёта.
 */
export interface WidgetData {
  h: string;
  u: string;
  t: [string, number][];
  r: [number, string, string, 0 | 1][];
  m: string;
  n: string;
  /** Номер списка: галочка присылает его вместе с номером строки, другой номер — «Кнопка устарела». */
  v: number;
  /** Виджет устарел: показать только этот текст. */
  o?: string;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Данные виджета и номера отчётов его строк; не помещается в 1 КБ — последние строки уходят в «ещё».
 * `version` — номер списка (новый у каждого пересобранного списка того же виджета).
 */
export function widgetData(
  pick: WidgetPick,
  today: IsoDate,
  texts: WidgetTexts,
  version = 1,
): { data: WidgetData; ids: string[] } {
  const { to } = reportWeek(today);
  let rows = pick.items;
  for (;;) {
    const tabs: { key: string; label: string }[] = [];
    if (rows.some((r) => r.due < today)) {
      tabs.push({ key: 'over', label: botClip(texts.over, TAB_MAX) });
    }
    for (let d = today; d <= to; d = addDays(d, 1)) {
      const wd = weekdayMondayFirst(d);
      if (wd < 5 || rows.some((r) => r.due === d)) {
        const label = `${botClip(texts.weekdayShort(wd), TAB_MAX - 6)} ${botDayMonth(d)}`;
        tabs.push({ key: d, label });
      }
    }
    const tabOf = (r: WidgetReport) =>
      tabs.findIndex((t) => t.key === (r.due < today ? 'over' : r.due));
    const more = pick.more + pick.items.length - rows.length;
    const data: WidgetData = {
      h: botClip(texts.head, TEXT_MAX),
      u: botClip(texts.updated, TEXT_MAX),
      t: tabs.map((t, i) => [t.label, rows.filter((r) => tabOf(r) === i).length]),
      r: rows.map((r) => [
        tabOf(r),
        botClip(r.contractor, CONTRACTOR_MAX),
        `${botClip(r.report, REPORT_MAX)} · ${botClip(r.due < today ? texts.due(botDayMonth(r.due)) : r.status, TAB_MAX)}`,
        0,
      ]),
      m: more ? botClip(texts.more(more), TEXT_MAX) : '',
      n: botClip(texts.none, TEXT_MAX),
      v: version,
    };
    if (bytes(JSON.stringify(data)) <= BOT_WIDGET_DATA_MAX || !rows.length) {
      return { data, ids: rows.map((r) => r.id) };
    }
    rows = rows.slice(0, -1);
  }
}

/** Строка `row` отмечена «Сдан»: галочка и на одну меньше на её вкладке. Номер вне списка — без изменений. */
export function widgetMarkDone(data: WidgetData, row: number): WidgetData {
  const r = data.r[row];
  if (!r || r[3] === 1) return data;
  return {
    ...data,
    t: data.t.map(([label, n], i) => [label, i === r[0] ? Math.max(0, n - 1) : n]),
    r: data.r.map((x, i) => (i === row ? [x[0], x[1], x[2], 1] : x)),
  };
}

/** Запрос виджета к боту: «u» — обновить, «d:<номер строки>:<номер списка>» — отметить «Сдан». */
export type WidgetQuery = { kind: 'refresh' } | { kind: 'done'; row: number; version: number };

export function parseWidgetQuery(data: string): WidgetQuery | null {
  if (data === 'u') return { kind: 'refresh' };
  const m = /^d:(\d{1,2}):(\d{1,9})$/.exec(data);
  return m ? { kind: 'done', row: Number(m[1]), version: Number(m[2]) } : null;
}

/** Подписи HTML виджета: они не меняются после отправки (HTML отправленного виджета не правится). */
export interface WidgetLabels {
  refresh: string;
  site: string;
  /** Адрес «Открыть отчёты на сайте»: только https, до 256 знаков; пусто — кнопки нет. */
  siteUrl: string;
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * HTML виджета (прототип `tgcWidget`): вкладки, строки с галочкой, «ещё N», строка итога нажатия, «Обновить»
 * и «Открыть отчёты на сайте». Данные — `TelegramWidget.chatData`, обновляются событием
 * `chatDataChanged`. Галочка и «Обновить» — `TelegramWidget.request`, итог приходит ответом бота.
 * Без внешних файлов, сети и полей ввода — так требует Telegram. Подписи экранируются в JSON.
 */
export function widgetHtml(labels: WidgetLabels): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:13px/1.35 -apple-system,system-ui,sans-serif;color:var(--t,#222)}
#a{padding:8px 10px}
.h{display:flex;gap:8px;align-items:baseline;margin-bottom:6px}.h b{font-size:14px}.h i{margin-left:auto;font-style:normal;font-size:11px;opacity:.6}
.tb{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.tb button{border:1px solid rgba(128,128,128,.35);background:none;color:inherit;border-radius:12px;padding:3px 9px;font:inherit;font-size:12px}
.tb button.on{background:var(--b,#2481cc);border-color:var(--b,#2481cc);color:var(--bt,#fff)}
.r{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid rgba(128,128,128,.2)}
.r:first-child{border-top:0}
.c{flex:none;width:22px;height:22px;border-radius:6px;border:1.5px solid rgba(128,128,128,.6);background:none;color:#fff;font:inherit;padding:0}
.r.d .c{background:#31a24c;border-color:#31a24c}.r.d b{text-decoration:line-through;opacity:.6}
.r span{display:block;font-size:12px;opacity:.7}
.m,.n{margin:6px 0 0;font-size:12px;opacity:.7}
.x{margin:6px 0 0;padding:5px 8px;border-radius:8px;font-size:12px;background:rgba(128,128,128,.12)}
.f{display:flex;gap:4px;margin-top:8px}.f button{flex:1;border:0;border-radius:8px;padding:7px;font:inherit;font-weight:600;background:rgba(128,128,128,.15);color:inherit}
</style></head><body><div id="a"></div><script>
var W=window.TelegramWidget,L=${json(labels)},sel='',note='';
function e(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function data(){try{return JSON.parse(W.chatData||'{}')}catch(x){return{}}}
function theme(){var p=W.themeParams||{},s=document.body.style;if(p.text_color)s.setProperty('--t',p.text_color);if(p.button_color)s.setProperty('--b',p.button_color);if(p.button_text_color)s.setProperty('--bt',p.button_text_color)}
function draw(){var D=data(),h='';theme();
if(D.o){h='<p class="n">'+e(D.o)+'</p>'}else{var T=D.t||[],R=D.r||[],cur=-1;
for(var i=0;i<T.length;i++){if(T[i][0]===sel)cur=i}
if(cur<0){cur=0;var f=0;for(var i2=0;i2<T.length&&!f;i2++){for(var q=0;q<R.length;q++){if(R[q][0]===i2){cur=i2;f=1;break}}}}
h='<div class="h"><b>'+e(D.h||'')+'</b><i>'+e(D.u||'')+'</i></div><div class="tb">';
for(var j=0;j<T.length;j++)h+='<button data-k="t:'+j+'"'+(j===cur?' class="on"':'')+'>'+e(T[j][0])+(T[j][1]?' <b>'+e(T[j][1])+'</b>':'')+'</button>';
h+='</div>';var any=0;
for(var k=0;k<R.length;k++){var r=R[k];if(r[0]!==cur)continue;any=1;
h+='<div class="r'+(r[3]?' d':'')+'"><button class="c" data-k="d:'+k+'"'+(r[3]?' disabled':'')+'>'+(r[3]?'&#10003;':'')+'</button><div><b>'+e(r[1])+'</b><span>'+e(r[2])+'</span></div></div>'}
if(!any)h+='<p class="n">'+e(D.n||'')+'</p>';
if(D.m)h+='<p class="m">'+e(D.m)+'</p>';
if(note)h+='<p class="x">'+e(note)+'</p>';
h+='<div class="f"><button data-k="u">'+e(L.refresh)+'</button>'+(L.siteUrl?'<button data-k="s">'+e(L.site)+'</button>':'')+'</div>'}
document.getElementById('a').innerHTML=h}
function ask(q){var p;try{p=W.request(q)}catch(x){return}if(p&&p.then)p.then(function(v){note=typeof v==='string'?v:'';draw()},function(){})}
document.getElementById('a').addEventListener('click',function(ev){var b=ev.target.closest('[data-k]');if(!b||b.disabled)return;var k=b.getAttribute('data-k');
if(k.charAt(0)==='t'){sel=(data().t||[])[+k.slice(2)]?data().t[+k.slice(2)][0]:'';note='';draw()}else if(k==='u'){note='';ask('u')}else if(k==='s'){W.openLink(L.siteUrl)}else ask(k+':'+(+data().v||0))});
if(W.onEvent){W.onEvent('chatDataChanged',draw);W.onEvent('themeChanged',draw)}
draw();if(W.ready)W.ready();
</script></body></html>`;
}

/** Подпись под виджетом: её показывает старое приложение Telegram вместо виджета. */
export function widgetWeekDates(today: IsoDate): string {
  const { from, to } = reportWeek(today);
  return `${botDayMonth(from)}–${botDayMonth(to)}`;
}
