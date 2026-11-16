/**
 * Числа и даты листа Excel «как в файле» (доработки 16.11.2026, блок 5, пункт 2): формат ячейки
 * из файла (встроенный номер или свой код) применяется к значению, разделители — как в русском Excel:
 * тысячи — неразрывный пробел, дробная часть — запятая.
 */
import { clipCellText, SHEET_MAX_CELL_CHARS } from './sheet';

const NBSP = '\u00a0';

/** Встроенные форматы Excel (номера 0–49), даты — как их показывает русский Excel. */
export const BUILTIN_NUMFMT: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'dd.mm.yyyy',
  15: 'dd.mmm.yy',
  16: 'dd.mmm',
  17: 'mmm.yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'dd.mm.yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
};

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

type Tok = { k: 'lit'; v: string } | { k: 'code'; v: string };

/** Разбивает код формата на секции по `;` вне кавычек и скобок. */
function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  let br = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '\\' && !q) {
      cur += ch + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"') q = !q;
    else if (!q && ch === '[') br = true;
    else if (!q && ch === ']') br = false;
    if (ch === ';' && !q && !br) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface Section {
  toks: Tok[];
  cond: { op: string; v: number } | null;
  /** Секция без кода (пустая) — значение не показывается. */
  empty: boolean;
}

function parseSection(src: string): Section {
  const toks: Tok[] = [];
  let cond: Section['cond'] = null;
  const lit = (v: string) => {
    const last = toks[toks.length - 1];
    if (last && last.k === 'lit') last.v += v;
    else toks.push({ k: 'lit', v });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"') {
      const e = src.indexOf('"', i + 1);
      lit(src.slice(i + 1, e < 0 ? src.length : e));
      i = e < 0 ? src.length : e;
    } else if (ch === '\\') {
      lit(src[i + 1] ?? '');
      i++;
    } else if (ch === '_') {
      lit(' ');
      i++;
    } else if (ch === '*') {
      i++;
    } else if (ch === '[') {
      const e = src.indexOf(']', i);
      const inner = src.slice(i + 1, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e;
      const m = /^(<=|>=|<>|<|>|=)(-?[\d.]+)$/.exec(inner);
      if (m) cond = { op: m[1]!, v: Number(m[2]) };
      else if (/^\$/.test(inner)) {
        // [$сом-419] — символ валюты и язык: показываем символ.
        const sym = inner.slice(1).split('-')[0] ?? '';
        if (sym) lit(sym);
      } else if (/^(h+|m+|s+)$/i.test(inner))
        toks.push({ k: 'code', v: `[${inner.toLowerCase()}]` });
      // Цвет ([Red]) и прочее — не показываем.
    } else toks.push({ k: 'code', v: ch });
  }
  const empty = toks.length === 0;
  return { toks, cond, empty };
}

const codeText = (s: Section) =>
  s.toks
    .filter((t) => t.k === 'code')
    .map((t) => t.v)
    .join('');

function sectionIsDate(s: Section): boolean {
  const c = codeText(s).toLowerCase();
  if (c.includes('general')) return false;
  return /[ymdhs]/.test(c);
}

/** Код формата — дата или время? */
export function isDateFormat(code: string): boolean {
  return sectionIsDate(parseSection(splitSections(code)[0] ?? ''));
}

function testCond(c: NonNullable<Section['cond']>, v: number): boolean {
  switch (c.op) {
    case '<':
      return v < c.v;
    case '<=':
      return v <= c.v;
    case '>':
      return v > c.v;
    case '>=':
      return v >= c.v;
    case '=':
      return v === c.v;
    default:
      return v !== c.v;
  }
}

/** Число в «Общем» формате: до 10 значащих цифр, запятая, большие и малые — с порядком. */
export function formatGeneral(v: number): string {
  if (!Number.isFinite(v)) return '#ЧИСЛО!';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e11 || a < 1e-9) {
    const [m, e] = v.toExponential(5).split('e');
    const mant = String(Number(m)).replace('.', ',');
    const exp = Number(e);
    return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return String(Number(v.toPrecision(10))).replace('.', ',');
}

function groupDigits(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Число по секции без даты: 0 # ? , . % E. */
function formatNumberSection(v: number, s: Section): string {
  const toks = s.toks;
  const code = codeText(s);
  if (/general/i.test(code)) {
    const g = formatGeneral(v);
    return toks.map((t) => (t.k === 'lit' ? t.v : '')).join('') + g;
  }
  // Где начинается и кончается числовая часть (первый и последний заполнитель).
  const isPh = (c: string) => c === '0' || c === '#' || c === '?';
  let first = -1;
  let last = -1;
  toks.forEach((t, i) => {
    if (t.k === 'code' && (isPh(t.v) || t.v === '.')) {
      if (first < 0) first = i;
      last = i;
    }
  });
  let percent = 0;
  for (const t of toks) if (t.k === 'code' && t.v === '%') percent++;
  let x = v * 100 ** percent;
  if (first < 0) {
    // Формат без цифр («"нет"»): только надписи.
    return toks.map((t) => (t.k === 'lit' ? t.v : t.v === '%' ? '%' : '')).join('');
  }
  // Научный формат.
  const eIdx = toks.findIndex(
    (t, i) => i > first && t.k === 'code' && (t.v === 'E' || t.v === 'e'),
  );
  const numToks = toks.slice(first, eIdx > 0 ? eIdx : last + 1).filter((t) => t.k === 'code');
  const pat = numToks.map((t) => t.v).join('');
  // Запятые сразу после последнего заполнителя — деление на 1000.
  let tail = last + 1;
  while (tail < toks.length && toks[tail]!.k === 'code' && toks[tail]!.v === ',') {
    x /= 1000;
    tail++;
  }
  const dot = pat.indexOf('.');
  const intPat = dot < 0 ? pat : pat.slice(0, dot);
  const decPat = dot < 0 ? '' : pat.slice(dot + 1).replace(/[^0#?]/g, '');
  const grouping = /[0#?],[0#?]/.test(intPat);
  const minInt = (intPat.match(/0/g) ?? []).length;
  const decMax = decPat.length;
  const decMin = (decPat.match(/0/g) ?? []).length;
  let body: string;
  if (eIdx > 0) {
    const expTok = toks
      .slice(eIdx + 1, last + 1)
      .filter((t) => t.k === 'code')
      .map((t) => t.v)
      .join('');
    const sign = expTok[0] === '+';
    const expDigits = (expTok.match(/0/g) ?? []).length || 1;
    const a = Math.abs(x);
    let exp = a === 0 ? 0 : Math.floor(Math.log10(a));
    const intDigits = Math.max(1, intPat.replace(/[^0#?]/g, '').length);
    if (intDigits > 1) exp = Math.floor(exp / intDigits) * intDigits;
    let mant = a / 10 ** exp;
    if (Number(mant.toFixed(decMax)) >= 10 ** (intDigits === 1 ? 1 : intDigits)) {
      exp += intDigits;
      mant = a / 10 ** exp;
    }
    let ms = mant.toFixed(decMax);
    if (decMax > decMin)
      ms = ms.replace(new RegExp(`0{1,${decMax - decMin}}$`), '').replace(/\.$/, '');
    body = `${ms.replace('.', ',')}E${exp < 0 ? '-' : sign ? '+' : ''}${String(Math.abs(exp)).padStart(expDigits, '0')}`;
  } else {
    const a = Math.abs(x);
    let fixed = a.toFixed(decMax);
    let [ip, dp = ''] = fixed.split('.');
    if (decMax > decMin) dp = dp.replace(new RegExp(`0{1,${decMax - decMin}}$`), '');
    if (ip === '0' && minInt === 0) ip = '';
    ip = ip!.padStart(minInt, '0');
    if (grouping) ip = groupDigits(ip);
    fixed =
      dp || (decMax > 0 && decMin > 0)
        ? `${ip},${dp}`
        : dot >= 0 && decMax === 0 && pat.endsWith('.')
          ? `${ip},`
          : ip;
    body = fixed || '0';
  }
  const pre = toks
    .slice(0, first)
    .map((t) =>
      t.k === 'lit'
        ? t.v
        : t.v === '%'
          ? '%'
          : t.v === '-' || t.v === '(' || t.v === ')' || t.v === ' ' || t.v === '+'
            ? t.v
            : '',
    )
    .join('');
  const post = toks
    .slice(tail)
    .map((t) => (t.k === 'lit' ? t.v : t.v === '%' ? '%' : /[-()+\s/:]/.test(t.v) ? t.v : ''))
    .join('');
  return pre + body + post;
}

interface DateParts {
  y: number;
  mo: number;
  d: number;
  wd: number;
  h: number;
  mi: number;
  s: number;
  frac: number;
  serial: number;
}

/** Дата из серийного номера Excel (система 1900 с ложным 29.02.1900 или 1904). */
export function excelDateParts(serial: number, date1904 = false): DateParts | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return null;
  let days = Math.floor(serial);
  // Время — с точностью до миллисекунды, как хранит Excel.
  const ms = Math.round((serial - days) * 86_400_000);
  let secs = Math.floor(ms / 1000);
  const frac = (ms % 1000) / 1000;
  if (secs >= 86400) {
    secs -= 86400;
    days++;
  }
  let y: number, mo: number, d: number, wd: number;
  if (!date1904 && days === 60) {
    y = 1900;
    mo = 2;
    d = 29;
    wd = 3;
  } else {
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const dd = date1904 ? days : days < 60 ? days + 1 : days;
    const dt = new Date(base + dd * 86400000);
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
    wd = dt.getUTCDay();
  }
  return {
    y,
    mo,
    d,
    wd,
    h: Math.floor(secs / 3600),
    mi: Math.floor((secs % 3600) / 60),
    s: secs % 60,
    frac,
    serial,
  };
}

function formatDateSection(v: number, s: Section, date1904: boolean): string {
  const p = excelDateParts(v, date1904);
  if (!p) return '#####';
  // Склеиваем коды в лексемы: yyyy, mm, dd, hh, ss, am/pm, [h], .0
  const lex: Tok[] = [];
  const toks = s.toks;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k === 'lit' || t.v.startsWith('[')) {
      lex.push(t);
      continue;
    }
    const c = t.v.toLowerCase();
    if ('ymdhs'.includes(c)) {
      let run = c;
      while (
        i + 1 < toks.length &&
        toks[i + 1]!.k === 'code' &&
        toks[i + 1]!.v.toLowerCase() === c
      ) {
        run += c;
        i++;
      }
      lex.push({ k: 'code', v: run });
    } else if (c === 'a') {
      const rest = toks
        .slice(i, i + 5)
        .map((x) => x.v)
        .join('')
        .toLowerCase();
      if (rest.startsWith('am/pm')) {
        lex.push({ k: 'code', v: 'am/pm' });
        i += 4;
      } else if (rest.startsWith('a/p')) {
        lex.push({ k: 'code', v: 'a/p' });
        i += 2;
      } else lex.push({ k: 'lit', v: t.v });
    } else if (c === '.' && toks[i + 1]?.v === '0') {
      let run = '.';
      while (toks[i + 1]?.k === 'code' && toks[i + 1]!.v === '0') {
        run += '0';
        i++;
      }
      lex.push({ k: 'code', v: run });
    } else lex.push({ k: 'lit', v: t.v === ',' ? ',' : t.v });
  }
  const ampm = lex.some((t) => t.k === 'code' && (t.v === 'am/pm' || t.v === 'a/p'));
  const two = (n: number) => String(n).padStart(2, '0');
  const codeIdx = lex.map((t, i) => (t.k === 'code' ? i : -1)).filter((i) => i >= 0);
  const prevCode = (i: number) => {
    const k = codeIdx.indexOf(i);
    return k > 0 ? lex[codeIdx[k - 1]!]!.v : '';
  };
  const nextCode = (i: number) => {
    const k = codeIdx.indexOf(i);
    return k >= 0 && k + 1 < codeIdx.length ? lex[codeIdx[k + 1]!]!.v : '';
  };
  const totalSecs = Math.round(v * 86400);
  let out = '';
  lex.forEach((t, i) => {
    if (t.k === 'lit') {
      out += t.v;
      return;
    }
    const c = t.v;
    if (c.startsWith('[')) {
      const u = c[1];
      const n =
        u === 'h'
          ? Math.floor(totalSecs / 3600)
          : u === 'm'
            ? Math.floor(totalSecs / 60)
            : totalSecs;
      out += String(n).padStart(c.length - 2, '0');
      return;
    }
    if (c[0] === 'y') out += c.length <= 2 ? two(p.y % 100) : String(p.y);
    else if (c[0] === 'd')
      out +=
        c.length === 1
          ? String(p.d)
          : c.length === 2
            ? two(p.d)
            : c.length === 3
              ? DAYS_SHORT[p.wd]
              : DAYS[p.wd];
    else if (c[0] === 'm') {
      const minute =
        c.length <= 2 &&
        (/^h/.test(prevCode(i)) || /^\[h/.test(prevCode(i)) || /^s/.test(nextCode(i)));
      if (minute) out += c.length === 1 ? String(p.mi) : two(p.mi);
      else if (c.length === 1) out += String(p.mo);
      else if (c.length === 2) out += two(p.mo);
      else if (c.length === 3) out += MONTHS_SHORT[p.mo - 1];
      else if (c.length === 5) out += MONTHS[p.mo - 1]!.charAt(0);
      else out += MONTHS[p.mo - 1];
    } else if (c[0] === 'h') {
      const h = ampm ? p.h % 12 || 12 : p.h;
      out += c.length === 1 ? String(h) : two(h);
    } else if (c[0] === 's') out += c.length === 1 ? String(p.s) : two(p.s);
    else if (c === 'am/pm') out += p.h < 12 ? 'AM' : 'PM';
    else if (c === 'a/p') out += p.h < 12 ? 'A' : 'P';
    else if (c[0] === '.') out += ',' + p.frac.toFixed(c.length - 1).slice(2);
  });
  return out;
}

/** Значение-число ячейки по коду формата. */
export function formatCellNumber(v: number, code: string, date1904 = false): string {
  if (!code || /^general$/i.test(code)) return formatGeneral(v);
  const sections = splitSections(code).map(parseSection);
  let s = sections[0]!;
  let abs = false;
  const conds = sections.some((x) => x.cond);
  if (conds) {
    const hit = sections.slice(0, 2).find((x) => x.cond && testCond(x.cond, v));
    if (hit) s = hit;
    else s = sections.find((x, i) => i > 0 && !x.cond) ?? sections[sections.length - 1]!;
    // Раздел с условием «меньше» показывает число без своего минуса (как раздел отрицательных).
    abs = v < 0 && !!s.cond && (s.cond.op === '<' || s.cond.op === '<=');
  } else if (v < 0 && sections.length >= 2) {
    s = sections[1]!;
    abs = true;
  } else if (v === 0 && sections.length >= 3) s = sections[2]!;
  if (s.empty) return '';
  if (sectionIsDate(s)) return formatDateSection(v, s, date1904);
  // Текстовый формат «@» у числа и дроби «# ?/?» — число как в «Общем».
  const sc = codeText(s);
  if ((!/[0#?]/.test(sc) && sc.includes('@')) || /[0#?]\s*\/\s*[0-9#?]/.test(sc))
    return formatGeneral(v);
  const val = abs ? Math.abs(v) : v;
  const out = formatNumberSection(Math.abs(val), s);
  return clipCellText(val < 0 && !abs ? `-${out}` : out);
}

/** Строка ячейки по секции текста (`@`) формата, если она есть. */
export function formatCellText(text: string, code: string): string {
  if (!code || !code.includes('@')) return clipCellText(text);
  const sections = splitSections(code);
  const sec = sections.length >= 4 ? sections[3]! : sections.find((x) => x.includes('@'));
  if (!sec) return clipCellText(text);
  // Каждый «@» подставляет текст ещё раз: строка собирается только до предела ячейки.
  let out = '';
  for (const t of parseSection(sec).toks) {
    const piece = t.k === 'lit' ? t.v : t.v === '@' ? text : '';
    if (out.length + piece.length >= SHEET_MAX_CELL_CHARS)
      return out + piece.slice(0, SHEET_MAX_CELL_CHARS - out.length);
    out += piece;
  }
  return out;
}
