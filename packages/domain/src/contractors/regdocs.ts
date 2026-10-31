import { importNorm } from './import';

/*
 * Создание контрагента «Из свидетельства и выписки» (Бета; задача 2.17; ТЗ «Контрагенты» → «Создание
 * контрагента из свидетельства и выписки (Бета)»; прототип core/regdocs.js — rdLines, rdLabel, rdKind,
 * rdPairs, rdExtract, rdCpFields, rdToCp, rdGked). Текст документа (текстовый слой PDF или распознанный
 * скан — с положением на странице) получает сервер (переходник `documents` в @buhuchet/adapters), правила
 * разбора — здесь, один в один с прототипом: поля находятся по подписям, номера полей выписки — опора;
 * справочники платформы (формы собственности, налоговые органы, ГКЭД) передаются параметром.
 */

/** Кусок текста на странице: левый нижний угол в пунктах PDF (ось y — вверх), ширина и высота. */
export interface RdItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Документ глазами разбора: страницы с кусками текста и дата создания PDF (ГГГГ-ММ-ДД или пусто). */
export interface RdSource {
  pages: readonly { items: readonly RdItem[] }[];
  created?: string;
}

/** Вид документа: свидетельство (справка) о госрегистрации или выписка из реестра. */
export const RD_KINDS = ['svid', 'vyp'] as const;
export type RdKind = (typeof RD_KINDS)[number];
/** Откуда значение поля: из свидетельства, из выписки или из обоих документов (они совпали). */
export type RdSrc = RdKind | 'both';

/** Сколько страниц документа читается (прототип pdfRead: первые 10). */
export const RD_MAX_PAGES = 10;
/** Меньше стольких знаков на всех страницах — в PDF нет текста (скан или фото; прототип rdRun). */
export const RD_MIN_CHARS = 40;
/** PDF до 10 МБ на файл (ТЗ «Какие документы принимаются»; прототип RD_MAX). */
export const RD_MAX_BYTES = 10 * 1024 * 1024;
/** Документов в одной загрузке: свидетельство и выписка, и по одному лишнему, чтобы их было видно. */
export const RD_MAX_FILES = 4;

interface Segment {
  t: string;
  x: number;
  x2: number;
}

interface Line {
  page: number;
  y: number;
  segs: Segment[];
  text: string;
}

/**
 * Строки и столбцы (прототип rdLines): куски одной высоты (±3 pt) — одна строка; внутри строки разрыв
 * больше 18 pt делит её на части. Порядок кусков в файле не важен.
 */
function rdLines(pages: RdSource['pages']): Line[] {
  const out: Line[] = [];
  pages.forEach((pg, pi) => {
    const it = [...pg.items].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; items: RdItem[] }[] = [];
    it.forEach((i) => {
      const r = rows.find((row) => Math.abs(row.y - i.y) <= 3);
      if (r) r.items.push(i);
      else rows.push({ y: i.y, items: [i] });
    });
    rows
      .sort((a, b) => b.y - a.y)
      .forEach((r) => {
        const s = r.items.sort((a, b) => a.x - b.x);
        const segs: Segment[] = [];
        s.forEach((i) => {
          const l = segs[segs.length - 1];
          if (l && i.x - l.x2 <= 18) {
            l.t += (i.x - l.x2 > 1.5 && !/\s$/.test(l.t) ? ' ' : '') + i.str;
            l.x2 = Math.max(l.x2, i.x + i.w);
          } else segs.push({ t: i.str, x: i.x, x2: i.x + i.w });
        });
        segs.forEach((g) => (g.t = g.t.replace(/\s+/g, ' ').trim()));
        const kept = segs.filter((g) => g.t);
        out.push({
          page: pi,
          y: r.y,
          segs: kept,
          text: segs
            .map((g) => g.t)
            .join(' ')
            .trim(),
        });
      });
  });
  return out.filter((l) => l.text);
}

/** Подпись для сравнения (прототип rdNorm): строчными, «ё» как «е», без номера пункта и двоеточия. */
const rdNorm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^\s*\d{1,3}\s*[.)]\s*/, '')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Что за поле у подписи (прототип RD_LABELS). */
type LabelKey =
  | 'regOrgan'
  | 'shortKg'
  | 'shortRu'
  | 'nameKg'
  | 'nameRu'
  | 'form'
  | 'foreign'
  | 'regNo'
  | 'okpo'
  | 'inn'
  | 'address'
  | 'region'
  | 'district'
  | 'city'
  | 'micro'
  | 'street'
  | 'house'
  | 'flat'
  | 'phone'
  | 'fax'
  | 'email'
  | 'regKind'
  | 'status'
  | 'orderDate'
  | 'firstReg'
  | 'reReg'
  | 'stop'
  | 'ownership'
  | 'actMain'
  | 'actMore'
  | 'gked'
  | 'foundersAll'
  | 'foundersPhys'
  | 'foundersJur'
  | 'founder'
  | 'head'
  | 'fio'
  | 'benef';

/**
 * Подписи полей (прототип RD_LABELS). Порядок важен: срабатывает первое совпадение. Третье поле —
 * подпись на государственном языке: значение берётся, только если русского нет. «\w» в подписях
 * означает любую букву — регулярки пересобираются с флагом u (прототип rdU).
 */
const RD_LABELS_SRC: readonly (readonly [LabelKey, RegExp, 1?])[] = [
  ['regOrgan', /регистрирующ\w* орган|орган регистрации/],
  ['regOrgan', /каттоочу орган/, 1],
  ['shortKg', /сокращ\w* (фирменн\w* )?наименован\w*.*государствен/],
  ['shortKg', /кыскартылган.*мамлекеттик/, 1],
  ['shortRu', /сокращ\w* (фирменн\w* )?наименован\w*.*официальн/],
  ['shortRu', /кыскартылган.*расмий/, 1],
  ['shortRu', /^сокращенное (фирменное )?наименование$/],
  ['nameKg', /наименован\w*.*государствен/],
  ['nameKg', /мамлекеттик тилде толук|толук аталышы.*мамлекеттик/, 1],
  ['nameRu', /наименован\w*.*официальн/],
  ['nameRu', /расмий тилде толук|толук аталышы.*расмий/, 1],
  ['nameRu', /^(полное )?(фирменное )?наименование( юридического лица)?$/],
  ['form', /организационно.?правов/],
  ['form', /уюштуруу.?укуктук/, 1],
  ['foreign', /иностранн\w* участ/],
  ['regNo', /регистрационн\w* номер|^рег\.? ?номер|^номер регистрац/],
  ['regNo', /каттоо номери/, 1],
  ['okpo', /окпо/],
  ['okpo', /иужк/, 1],
  ['inn', /^инн$|идентификационн\w* налогов\w* номер|^инн /],
  ['inn', /^исн$/, 1],
  ['address', /юридическ\w* адрес|^адрес( \(место нахождения\))?$|место нахождения/],
  ['address', /юридикалык дарег/, 1],
  ['region', /^област|город республиканского значения/],
  ['district', /^район|город областного значения/],
  ['city', /город\/село|^населенн\w* пункт|^город$/],
  ['micro', /микрорайон|жилмассив/],
  ['street', /^улица/],
  ['house', /№ дома|^дом$|номер дома/],
  ['flat', /квартир|офис/],
  ['phone', /телефон/],
  ['fax', /факс/],
  ['email', /e-?mail|электронн\w* (адрес|почт)/],
  ['regKind', /государственн\w* регистрация или перерегистрация/],
  ['status', /текущ\w* статус|^статус/],
  ['status', /учурдагы статус/, 1],
  ['orderDate', /дата приказа/],
  ['firstReg', /дата первичн\w* (гос\w* )?регистрац|дата (гос\w* )?регистрации$/],
  ['firstReg', /алгачкы катталган/, 1],
  ['reReg', /дата перерегистрац/],
  ['reReg', /кайра катталган/, 1],
  ['stop', /прекращени\w* деятельност|ликвидац/],
  ['stop', /токтотулган/, 1],
  ['ownership', /форма собственност/],
  ['actMain', /основн\w* вид\w* деятельност/],
  ['actMore', /дополнительн\w* вид\w* деятельност|иные виды деятельност|прочие виды деятельност/],
  ['gked', /код\w*.*(экономическ\w* деятельност|гкэд|окэд)|^гкэд|^код вида деятельност/],
  [
    'foundersAll',
    /общее количество учредител|количество учредителей\/участников|^количество учредителей( \(участников\))?$/,
  ],
  ['foundersAll', /уюштуруучулардын.*саны/, 1],
  ['foundersPhys', /учредител\w*.*физическ/],
  ['foundersJur', /учредител\w*.*юридическ/],
  [
    'founder',
    /^учредител\w*( \(участник\w*\))?( ф\.?\s?и\.?\s?о\.?| \(?фио\)?)?$|^учредители \(участники\)$/,
  ],
  [
    'head',
    /^руководител|^директор|^первый руководител|ф\.?\s?и\.?\s?о\.?.*руководител|руководител\w* \(ф\.?\s?и\.?\s?о/,
  ],
  ['head', /башкаруучу|жетекчи/, 1],
  ['fio', /^фамилия,? имя,? отчество|^ф\.?\s?и\.?\s?о\.?$/],
  ['benef', /бенефициар/],
];

const rdU = (re: RegExp) => new RegExp(re.source.replace(/\\w/g, '[\\p{L}\\d_]'), 'u');
const RD_LABELS = RD_LABELS_SRC.map(([k, re, kg]) => [k, rdU(re), !!kg] as const);

function rdLabel(s: string): { k: LabelKey; kg: boolean } | null {
  const n = rdNorm(s);
  if (!n || n.length > 120) return null;
  for (const [k, re, kg] of RD_LABELS) if (re.test(n)) return { k, kg };
  return null;
}

/** Пусто в документе: «---», «== не заполнено ==», «нет данных», «не указано» (прототип rdEmpty). */
export const rdEmpty = (v: string | null | undefined): boolean =>
  !v ||
  /^[-–—=\s.]*$/.test(v) ||
  /^=*\s*не заполнен\p{L}*\s*=*$/iu.test(v.trim()) ||
  /^нет данных$/i.test(v.trim()) ||
  /^не указан\p{L}*$/iu.test(v.trim());

/** Вид документа по словам в тексте (прототип rdKind). */
function rdKind(lines: readonly Line[]): RdKind | '' {
  const all = lines.map((l) => l.text.toLowerCase().replace(/ё/g, 'е')).join('\n');
  let sv = 0;
  let vy = 0;
  if (/справка\s*\(свидетельство\)|свидетельств\w* о государственн\w* (пере)?регистрац/.test(all))
    sv += 3;
  if (/маалымкат|күбөлүк/.test(all)) sv += 2;
  if (/справка из единого государственного реестра/.test(all)) sv += 2;
  if (/выписк\w* из (единого )?государственн\w* реестр|^выписка/m.test(all)) vy += 3;
  if (/сведения о наименовании|сведения о регистрационном номере|сведения об адресе/.test(all))
    vy += 2;
  if (/код экономической деятельности|сведения об учредителях/.test(all)) vy += 1;
  const num = lines.filter((l) => /^\d{1,2}\.\s+\S/.test(l.text)).length;
  if (num >= 6) vy += 2;
  const col = lines.filter((l) => /:\s*$/.test(l.segs[0]!.t) && l.segs.length === 1).length;
  if (col >= 6) sv += 1;
  return vy > sv ? 'vyp' : sv > 0 ? 'svid' : vy > 0 ? 'vyp' : '';
}

/** Конец значения: ссылка, колонтитул выписки, номер страницы (прототип RD_STOP). */
const RD_STOP =
  /https?:\/\/|^справка из единого|^выписка из единого|^юридикалык жактардын|^\d{1,3}\/\d{1,3}$|^страница \d/i;

interface Pair {
  l: string;
  v: string;
  sec: string;
}

/**
 * Заголовок раздела выписки: «IV. Сведения об адресе…». Распознанный скан путает римские цифры («ТМ.»,
 * «Ш.»), поэтому разделом считается и строка «… Сведения …» с коротким номером любыми знаками.
 */
const isSec = (t: string) =>
  /^[IVXLC]{1,5}\.\s+\S/.test(t) || /^раздел \d/i.test(t) || /^\S{1,5}\.\s+Сведени/i.test(t);

/**
 * Пары «подпись — значение» (прототип rdPairs). Два вида раскладки, оба разбираются по положению текста:
 * свидетельство — подпись с двоеточием отдельной строкой, значение — следующей строкой (строками) до
 * следующей подписи; выписка — таблица: подпись в левом столбце, значение в правом, переносы склеиваются.
 */
function rdPairs(lines: readonly Line[], kind: RdKind | ''): Pair[] {
  const pairs: (Pair & { page?: number })[] = [];
  let sec = '';
  // правый столбец: левая граница частей значения у пронумерованных строк (самая частая)
  const xs = lines
    .filter(
      (l) =>
        l.segs.length > 1 &&
        (/^\d{1,3}\s*[.)]/.test(l.segs[0]!.t) || rdLabel(l.segs[0]!.t)) &&
        !/:\s*$/.test(l.segs[0]!.t),
    )
    .map((l) => Math.round(l.segs[l.segs.length - 1]!.x / 10) * 10);
  const counts = new Map<number, number>();
  xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  // как Object.entries прототипа: ключи-числа по возрастанию, при равном счёте — меньший
  const top = [...counts.entries()].sort((a, b) => a[0] - b[0]).sort((a, b) => b[1] - a[1])[0];
  const valX = top ? top[0] - 8 : null;
  if (valX !== null && xs.length >= 4 && kind !== 'svid') {
    let cur: (Pair & { page?: number }) | null = null;
    lines.forEach((l) => {
      const t = l.text;
      if (isSec(t)) {
        sec = t;
        cur = null;
        return;
      }
      if (RD_STOP.test(t) || /^\d\d\.\d\d\.\d{4}\s+\d\d:\d\d/.test(t)) {
        cur = null;
        return;
      }
      const left = l.segs
        .filter((g) => g.x < valX)
        .map((g) => g.t)
        .join(' ');
      const right = l.segs
        .filter((g) => g.x >= valX)
        .map((g) => g.t)
        .join(' ');
      const numbered = /^\d{1,3}\s*[.)]/.test(left);
      if (numbered || (left && right && (!cur || cur.v || rdLabel(left)))) {
        cur = { l: left, v: right, sec };
        pairs.push(cur);
        return;
      }
      if (!cur) return;
      const c: Pair = cur;
      if (left) c.l += ' ' + left;
      if (right) c.v += (c.v ? ' ' : '') + right;
    });
  }
  if (kind !== 'vyp' || !pairs.length) {
    let cur: (Pair & { page?: number }) | null = null;
    lines.forEach((l) => {
      const t = l.text;
      if (RD_STOP.test(t)) {
        cur = null;
        return;
      }
      const m = /^([^:]{2,120}):\s*(.*)$/.exec(t);
      const lb = m && rdLabel(m[1]!);
      if ((m && (lb || !m[2]) && !/^\d/.test(m[1]!.trim())) || (lb && m)) {
        cur = { l: m[1]!, v: m[2] || '', sec: '', page: l.page };
        pairs.push(cur);
        return;
      }
      const c = cur as (Pair & { page?: number }) | null;
      if (c && c.page === l.page && c.v.split('\n').length < 4) c.v += (c.v ? ' ' : '') + t;
    });
  }
  return pairs.map((p) => ({ l: p.l.trim(), v: p.v.trim(), sec: p.sec }));
}

/** «18.10.2026» → «2026-10-18» (прототип rdDate). */
export const rdDate = (s: string | null | undefined): string => {
  const m = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : '';
};

/** «ОМУРАЛИЕВ АЙБЕК» → «Омуралиев Айбек» (прототип rdFio). */
export const rdFio = (s: string): string =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[A-Za-zА-Яа-яЁёӨөҮүҢң]+/g, (w) =>
      w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w,
    );

/** Прямые кавычки — в «ёлочки» (прототип rdQuotes). */
export const rdQuotes = (s: string): string =>
  String(s || '')
    .replace(/"([^"]+)"/g, '«$1»')
    .replace(/[“”„]([^“”„]+)[“”„]/g, '«$1»')
    .replace(/\s+/g, ' ')
    .trim();

/** Значение поля документа: текст и признак «подпись на государственном языке» или «найдено поиском». */
interface Field {
  v: string;
  kg: boolean;
  guess?: boolean;
}

/** Разобранный документ (прототип rdExtract): вид, поля по подписям, дополнительные ГКЭД, дата выдачи. */
export interface RdDoc {
  kind: RdKind | '';
  f: Partial<Record<LabelKey | 'benefCount' | 'benefName', Field>>;
  more: string[];
  issued: string;
  text: string;
}

/**
 * Поля одного документа (прототип rdExtract). ФИО учредителей и бенефициаров не собираются: в карточку
 * они не переносятся (ТЗ — персональные данные).
 */
export function rdExtract(file: RdSource): RdDoc {
  const lines = rdLines(file.pages);
  const kind = rdKind(lines);
  const pairs = rdPairs(lines, kind);
  const all = lines.map((l) => l.text).join('\n');
  const f: RdDoc['f'] = {};
  const put = (k: keyof RdDoc['f'], v: string, kg: boolean) => {
    if (rdEmpty(v)) return;
    const had = f[k];
    if (had && !(had.kg && !kg)) return;
    f[k] = { v: v.trim(), kg };
  };
  const more: string[] = [];
  pairs.forEach((p) => {
    const lb = rdLabel(p.l);
    if (!lb) return;
    let k: keyof RdDoc['f'] | '' = lb.k;
    if (k === 'fio')
      k = /руковод/i.test(p.sec)
        ? 'head'
        : /учредител/i.test(p.sec)
          ? 'founder'
          : /бенефициар/i.test(p.sec)
            ? 'benefName'
            : '';
    if (k === 'benef' && /^всего/i.test(rdNorm(p.l))) k = 'benefCount';
    if (/бенефициар/i.test(p.sec) && /^всего/.test(rdNorm(p.l))) k = 'benefCount';
    if (!k || k === 'founder' || k === 'benefName') return;
    if (k === 'actMore') {
      if (!rdEmpty(p.v)) more.push(p.v);
      return;
    }
    if (k === 'gked') {
      (p.v.match(/\b\d{2}\.\d{1,2}(\.\d{1,2})?\b/g) ?? []).forEach((c, i) =>
        i || f.gked ? more.push(c) : put('gked', c, lb.kg),
      );
      return;
    }
    put(k, p.v, lb.kg);
  });
  // Запасной поиск по всему тексту — если подпись поля изменилась
  const fb = (k: keyof RdDoc['f'], re: RegExp, g = 0) => {
    if (f[k]) return;
    const m = re.exec(all);
    if (m) f[k] = { v: m[g]!.trim(), kg: false, guess: true };
  };
  fb('inn', /(?:ИНН|ИСН)[^0-9\n]{0,20}\n?\s*([0-2]\d{13})\b/, 1);
  fb('inn', /\b([0-2]\d{13})\b/, 1);
  fb('okpo', /(?:ОКПО|ИУЖК)[^0-9\n]{0,30}\n?\s*(\d{8})\b/, 1);
  fb('regNo', /(?<![\d-])(\d{2,7}-\d{3,5}-[А-ЯЁA-Z]{2,6})(?![\p{L}\d])/u, 1);
  fb('email', /\b([\w.+-]+@[\w-]+(\.[\w-]+)+)\b/, 1);
  fb('phone', /(\+?996[\s-]?\(?\d{3}\)?[\s-]?\d{2,3}[\s-]?\d{2,3}[\s-]?\d{2,3})/, 1);
  if (!f.gked && kind === 'vyp') fb('gked', /\b(\d{2}\.\d{2}\.\d)\b/, 1);
  if (!f.nameRu) {
    const m =
      /((?:Общество с ограниченной|Общество с дополнительной|Открытое акционерное|Закрытое акционерное|Акционерное)[^\n"«]*["«][^"»\n]+["»])/.exec(
        all,
      );
    if (m) f.nameRu = { v: m[1]!, kg: false, guess: true };
  }
  if (!f.head) {
    const m =
      /(?:Руководитель|Директор)[:\s]*\n?\s*([А-ЯЁӨҮҢ][А-ЯЁӨҮҢа-яёөүң-]+\s+[А-ЯЁӨҮҢ][А-ЯЁӨҮҢа-яёөүң-]+(?:\s+[А-ЯЁӨҮҢ][А-ЯЁӨҮҢа-яёөүң-]+)?)/.exec(
        all,
      );
    if (m) f.head = { v: m[1]!, kg: false, guess: true };
  }
  // Дата выдачи: выписка — дата и время в колонтитуле; свидетельство — дата рядом со ссылкой на реестр;
  // иначе дата создания PDF
  const stamp = /(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}(:\d{2})?/.exec(all);
  const link = lines.find((l) => /https?:\/\//.test(l.text) && /\d{2}\.\d{2}\.\d{4}/.test(l.text));
  const given = /(?:дата выдачи|выдан\w*|берилген күнү)[:\s]*(\d{2}\.\d{2}\.\d{4})/i.exec(all);
  let issued = rdDate(
    given ? given[1] : link ? /\d{2}\.\d{2}\.\d{4}/.exec(link.text)![0] : stamp ? stamp[1] : '',
  );
  if (!issued && file.created && /^\d{4}-\d{2}-\d{2}$/.test(file.created)) issued = file.created;
  return { kind, f, more: [...new Set(more)], issued, text: all };
}

/** Форма собственности из справочника платформы (только действующие предлагаются документом). */
export interface RdForm {
  code: string;
  name: string;
  fullName: string;
  shortName: string;
  active: boolean;
}

/** Налоговый орган (УГНС): название и «Город или область». */
export interface RdOffice {
  code: string;
  name: string;
  region: string;
  active: boolean;
}

/** Код ГКЭД справочника для подбора по документу. */
export interface RdGkedItem {
  code: string;
  name: string;
  level: string;
  parent: string | null;
  active: boolean;
}

/** Справочники платформы для разбора. */
export interface RdDicts {
  forms: readonly RdForm[];
  offices: readonly RdOffice[];
  gked: readonly RdGkedItem[];
}

const norm = importNorm;
/** Сравнение значений двух документов (прототип rdCmp): без регистра, пробелов, кавычек и знаков. */
const rdCmp = (x: unknown) =>
  String(x ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s"«»'.,()-]/g, '');

/** Форма собственности по организационно-правовой форме или по началу наименования (прототип rdForm). */
function rdForm(t: string, forms: readonly RdForm[]): string {
  const n = norm(t || '');
  if (!n) return '';
  const it = forms.filter((x) => x.active);
  const byFull = it
    .filter((x) => x.fullName && n.startsWith(norm(x.fullName)))
    .sort((a, b) => b.fullName.length - a.fullName.length)[0];
  if (byFull) return byFull.code;
  const sh = /^([а-яёa-z()]{2,8})\s*[«"]/.exec(n);
  const byShort = sh && it.find((x) => norm(x.shortName || x.name) === sh[1]);
  return byShort ? byShort.code : '';
}

const rdFormShort = (code: string, forms: readonly RdForm[]) => {
  const x = forms.find((y) => y.code === code);
  return x ? x.shortName || x.name : '';
};

/** Название для списка: краткое наименование, иначе «ОсОО «Имя»» из полного (прототип rdName). */
function rdName(f: RdDoc['f'], forms: readonly RdForm[]): string {
  if (f.shortRu) return rdQuotes(f.shortRu.v);
  if (!f.nameRu) return '';
  const full = rdQuotes(f.nameRu.v);
  const m = /«(.+)»\s*$/.exec(full);
  const fs = rdFormShort(rdForm(full, forms), forms);
  return m && fs ? `${fs} «${m[1]}»` : full;
}

/** Юридический адрес: из полей выписки в одну строку, иначе строка свидетельства (прототип rdAddr). */
function rdAddr(f: RdDoc['f']): string {
  if (f.region || f.street || f.house) {
    const ps: string[] = [];
    const add = (v: Field | undefined, pre = '') => {
      if (!v || rdEmpty(v.v)) return;
      const t = v.v.trim();
      if (ps.some((p) => rdCmp(p).endsWith(rdCmp(t)))) return;
      ps.push(/^\d/.test(t) && pre ? pre + t : t);
    };
    add(f.region);
    add(f.district);
    add(f.city);
    add(f.micro);
    add(f.street);
    add(f.house, 'д. ');
    add(f.flat, 'кв. ');
    return ps.join(', ');
  }
  return f.address ? f.address.v.trim() : '';
}

/** Телефон → «+996XXXXXXXXX»; неполный номер — пусто (прототип rdPhone). */
export function rdPhone(v: string): string {
  const d = String(v || '').replace(/\D/g, '');
  if (/^996\d{9}$/.test(d)) return `+${d}`;
  if (/^0?[2-9]\d{8}$/.test(d)) return `+996${d.slice(-9)}`;
  return '';
}

/** УГНС по району или городу адреса (прототип rdUgns). */
function rdUgns(f: RdDoc['f'], addr: string, offices: readonly RdOffice[]): string {
  const t = [f.district?.v, f.city?.v, f.region?.v, addr].filter(Boolean).join(' ');
  const rm = /([А-ЯЁ][а-яё-]+)(ский|ской|ский)\s+район/.exec(t);
  const city = /(?:г\.\s*|город\s+)([А-ЯЁ][а-яё-]+)/.exec(t)?.[1] ?? '';
  const it = offices.filter((x) => x.active);
  let u: RdOffice | null | undefined = null;
  if (rm) {
    const stem = norm(rm[1]! + rm[2]!).slice(0, -3);
    u =
      it.find(
        (x) =>
          norm(x.name).includes(stem) &&
          (!city || norm(x.name + ' ' + (x.region || '')).includes(norm(city).slice(0, 5))),
      ) ?? it.find((x) => norm(x.name).includes(stem));
  }
  if (!u && city)
    u =
      it.find(
        (x) =>
          norm(x.name).includes('г. ' + norm(city)) ||
          norm(x.name).includes(norm(city).slice(0, -1) + 'у'),
      ) ?? null;
  return u ? u.code : '';
}

/** Основной ГКЭД по документу (прототип rdGked). */
export interface RdGkedPick {
  /** Подкласс, который подставляется сам; пусто — не найден. */
  code: string;
  /** Класс или группа с несколькими подклассами — выбор среди них. */
  choose: string[];
  /** Кода нет — до 5 похожих подклассов по словам названия. */
  like: string[];
  /** Код и текст вида деятельности из документа — для сверки. */
  raw: string;
  text: string;
}

const W = /[^а-яёa-z0-9]+/;

/**
 * ГКЭД: подкласс — сразу; класс или группа — единственный подкласс или выбор; нет кода — до 5 похожих
 * по словам названия, ничего не подставляется само (прототип rdGked). Выключенный в справочнике код
 * не подставляется: контрагенту выбирается только действующий подкласс.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#А-10 — прототип подставляет и выключенный подкласс.
export function rdGked(code: string, text: string, gked: readonly RdGkedItem[]): RdGkedPick {
  const r: RdGkedPick = { code: '', choose: [], like: [], raw: code || '', text: text || '' };
  const map = new Map(gked.map((x) => [x.code, x]));
  const subs = gked.filter((y) => y.level === 'subclass' && y.active);
  if (code) {
    const c = code.trim();
    const x = map.get(c) ?? map.get(c.replace(/\.0$/, '')) ?? map.get(c + '.0');
    if (x && x.level === 'subclass' && x.active) {
      r.code = x.code;
      return r;
    }
    if (x && x.level !== 'subclass') {
      const up = (s: string) => {
        const out: string[] = [];
        let y = map.get(s);
        for (let n = 0; y?.parent && n < 8; n++) {
          y = map.get(y.parent);
          if (y) out.push(y.code);
        }
        return out;
      };
      const under = subs.filter(
        (y) => y.code === x.code || y.code.startsWith(x.code + '.') || up(y.code).includes(x.code),
      );
      if (under.length === 1) r.code = under[0]!.code;
      else r.choose = under.map((y) => y.code);
      return r;
    }
  }
  if (text) {
    const ws = [
      ...new Set(
        norm(text)
          .split(W)
          .filter((w) => w.length > 3)
          .map((w) => w.slice(0, Math.max(4, w.length - 2))),
      ),
    ];
    const need = Math.max(1, Math.ceil(ws.length / 3));
    r.like = subs
      .map((y) => {
        const nw = norm(y.name)
          .split(W)
          .filter((w) => w.length > 3);
        const n = ws.filter((w) => nw.some((x) => x.startsWith(w))).length;
        return { c: y.code, n, s: n - 0.1 * Math.max(0, nw.length - n) };
      })
      .filter((y) => y.n >= need)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((y) => y.c);
  }
  return r;
}

/** Реквизиты контрагента, которые переносятся из документов (прототип RD_KEYS). */
export const RD_KEYS = [
  'name',
  'full',
  'inn',
  'regNo',
  'okpo',
  'form',
  'addr',
  'phone',
  'email',
  'head',
  'regDate',
  'reRegDate',
  'founders',
  'foreign',
] as const;
export type RdKey = (typeof RD_KEYS)[number];

/**
 * Значения реквизитов: строки; телефон — «+996…», форма — код формы собственности, учредители —
 * число, иностранное участие — «yes» / «no».
 */
export type RdValues = Partial<Record<RdKey, string | number>>;

/** Поля одного документа в терминах контрагента (прототип rdCpFields). */
interface CpFields extends RdValues {
  phoneRaw?: string;
  gk?: { codes: string[]; text: string };
  ugns: string;
  stopped: boolean;
  status: string;
  ip: boolean;
  branch: boolean;
}

function rdCpFields(d: RdDoc, dicts: RdDicts): CpFields {
  const f = d.f;
  const o: Partial<CpFields> = {};
  const set = (k: RdKey | 'phoneRaw', v: string) => {
    if (v !== '' && v != null && !rdEmpty(v)) (o as Record<string, unknown>)[k] = v;
  };
  set('name', rdName(f, dicts.forms));
  set('full', f.nameRu ? rdQuotes(f.nameRu.v) : '');
  set('inn', f.inn ? f.inn.v.replace(/\D/g, '') : '');
  set('regNo', f.regNo ? f.regNo.v.replace(/\s+/g, '') : '');
  set('okpo', f.okpo ? f.okpo.v.replace(/\D/g, '') : '');
  set(
    'form',
    rdForm(f.form ? f.form.v : '', dicts.forms) ||
      rdForm(f.nameRu ? rdQuotes(f.nameRu.v) : '', dicts.forms) ||
      rdForm(f.shortRu ? rdQuotes(f.shortRu.v) : '', dicts.forms),
  );
  set('addr', rdAddr(f));
  if (f.phone) set('phoneRaw', f.phone.v);
  if (f.phone && rdPhone(f.phone.v)) o.phone = rdPhone(f.phone.v);
  set('email', f.email ? f.email.v.toLowerCase() : '');
  set('head', f.head ? rdFio(f.head.v) : '');
  set('regDate', rdDate(f.firstReg?.v));
  const re =
    rdDate(f.reReg?.v) ||
    (f.regKind && /перерегистр/i.test(f.regKind.v) ? rdDate(f.orderDate?.v) : '');
  set('reRegDate', re);
  if (f.foundersAll && /\d/.test(f.foundersAll.v)) {
    const n = parseInt(f.foundersAll.v, 10);
    if (Number.isFinite(n)) o.founders = n;
  }
  if (f.foreign) {
    const v = f.foreign.v.trim();
    if (/^(да|есть|имеется)/i.test(v)) o.foreign = 'yes';
    else if (/^(нет|отсутств)/i.test(v)) o.foreign = 'no';
  }
  const codes = [f.gked?.v, ...d.more.filter((x) => /^\d{2}\.\d/.test(x))].filter(
    (x): x is string => !!x,
  );
  if (codes.length || f.actMain) o.gk = { codes, text: f.actMain ? f.actMain.v : '' };
  const st = f.status?.v ?? '';
  return {
    ...o,
    ugns: rdUgns(f, typeof o.addr === 'string' ? o.addr : '', dicts.offices),
    stopped: !!(f.stop && rdDate(f.stop.v)) || /прекращ|ликвид|исключ/i.test(st),
    status: st,
    ip: /индивидуальн\S* предпринимател/i.test(d.text || '') && !f.nameRu,
    branch: /^(филиал|представительств)/i.test(f.nameRu ? f.nameRu.v.trim() : ''),
  };
}

/** Документ, который вошёл в итог: вид и дата выдачи. */
export interface RdDocInfo {
  kind: RdKind;
  issued: string;
}

/** Два значения поля, когда документы расходятся: первое — из более позднего документа (в форме). */
export interface RdAlt {
  v: string | number;
  src: RdKind;
  date: string;
}

/** Итог по документам (прототип rdToCp). */
export interface RdResult {
  v: RdValues;
  src: Partial<Record<RdKey, RdSrc>>;
  alt: Partial<Record<RdKey, RdAlt[]>>;
  gk: (RdGkedPick & { src: RdKind; more: string[] }) | null;
  /** Налоговый орган, предложенный по адресу (код); пусто — не найден. */
  ugns: string;
  /** Юрлицо прекращено (ликвидировано) по данным документа. */
  stopped: boolean;
  status: string;
  /** Телефон в документе неполный — как он записан. */
  phoneBad: string;
}

/**
 * Ошибка итога: ни один документ не распознан; документ ИП или филиала; документы разных организаций
 * (ИНН не совпадает).
 */
export type RdError = 'none' | 'ip' | 'diff';

/**
 * Реквизиты контрагента из одного или двух документов (прототип rdToCp). Расхождение: верх берёт
 * документ с более поздней датой выдачи, второе значение показывается с датой.
 */
export function rdToCp(
  docs: readonly RdDoc[],
  dicts: RdDicts,
): { err: RdError } | { err: null; res: RdResult } {
  const ok = docs.filter((d): d is RdDoc & { kind: RdKind } => !!d.kind);
  if (!ok.length) return { err: 'none' };
  const F = ok.map((d) => ({ d, o: rdCpFields(d, dicts) }));
  if (F.some((x) => x.o.ip || x.o.branch)) return { err: 'ip' };
  const inns = [...new Set(F.map((x) => x.o.inn).filter(Boolean))];
  if (inns.length > 1) return { err: 'diff' };
  const ord = [...F].sort(
    (a, b) => (b.d.issued || '').localeCompare(a.d.issued || '') || (a.d.kind === 'vyp' ? -1 : 1),
  );
  const res: RdResult = {
    v: {},
    src: {},
    alt: {},
    gk: null,
    ugns: '',
    stopped: false,
    status: '',
    phoneBad: '',
  };
  RD_KEYS.forEach((k) => {
    const has = ord.filter((x) => x.o[k] != null && x.o[k] !== '');
    if (!has.length) return;
    // адрес: из выписки (по частям), свидетельство — если выписки нет
    let top = has[0]!;
    if (k === 'addr') top = has.find((x) => x.d.kind === 'vyp') ?? top;
    const tv = top.o[k]!;
    res.v[k] = tv;
    const same = has.filter((x) => rdCmp(JSON.stringify(x.o[k])) === rdCmp(JSON.stringify(tv)));
    res.src[k] = same.length > 1 ? 'both' : top.d.kind;
    const other =
      k === 'addr'
        ? null
        : has.find((x) => rdCmp(JSON.stringify(x.o[k])) !== rdCmp(JSON.stringify(tv)));
    if (other)
      res.alt[k] = [
        { v: tv, src: top.d.kind, date: top.d.issued },
        { v: other.o[k]!, src: other.d.kind, date: other.d.issued },
      ];
  });
  if (!res.v.phone) res.phoneBad = ord.find((x) => x.o.phoneRaw)?.o.phoneRaw ?? '';
  const g = ord.find((x) => x.o.gk && x.o.gk.codes.length) ?? ord.find((x) => x.o.gk);
  if (g?.o.gk) {
    const codes = g.o.gk.codes;
    const main = rdGked(codes[0] ?? '', g.o.gk.text, dicts.gked);
    res.gk = {
      ...main,
      src: g.d.kind,
      more: codes
        .slice(1)
        .map((c) => rdGked(c, '', dicts.gked).code)
        .filter((c) => c && c !== main.code),
    };
  }
  res.ugns = ord.find((x) => x.o.ugns)?.o.ugns ?? '';
  res.stopped = F.some((x) => x.o.stopped);
  res.status = F.find((x) => x.o.status)?.o.status ?? '';
  return { err: null, res };
}

/** Сколько знаков текста на страницах: меньше `RD_MIN_CHARS` — в PDF нет текста (прототип rdRun). */
export const rdChars = (file: RdSource): number =>
  file.pages.reduce((a, p) => a + p.items.reduce((b, i) => b + i.str.trim().length, 0), 0);

/** Документ ИП или филиала: в первой версии не поддерживается (прототип rdRun, rdCpFields). */
export function rdUnsupported(d: RdDoc): boolean {
  if (!d.kind) return false;
  const f = d.f;
  return (
    (/индивидуальн\S* предпринимател/i.test(d.text || '') && !f.nameRu) ||
    /^(филиал|представительств)/i.test(f.nameRu ? f.nameRu.v.trim() : '')
  );
}
