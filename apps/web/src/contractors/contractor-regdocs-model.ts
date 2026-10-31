import {
  formatDateRu,
  formatPhone,
  isIsoDate,
  joinPhone,
  splitPhone,
  type PhoneCodeOption,
  type RdAlt,
  type RdKey,
  type RdKind,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import type { RegdocsResult } from '@buhuchet/shared';
import type { ContractorDraft } from './contractor-form-model';

/*
 * Форма «Новый контрагент», заполненная из свидетельства и выписки (Бета; задача 2.17; прототип
 * modules/contractor-regdocs.js — rdPrefill, rdHead, rdMarks, `data-rdalt`): черновик из итога
 * распознавания, сводка над формой, подписи у полей («из выписки», «Заполните вручную», «Документы
 * расходятся») и «взять это». Всё считается от черновика — подписи меняются при вводе.
 */

/** Документ, загруженный в окне «Из свидетельства и выписки»: прикрепится к контрагенту. */
export interface RegdocsUpload {
  id: string;
  name: string;
}

/** Что окно «Из свидетельства и выписки» передаёт форме (прототип addCpDlg, `pre`). */
export interface RegdocsPrefill {
  files: RegdocsUpload[];
  /** Итог распознавания; null — «Заполнить вручную». */
  result: RegdocsResult | null;
  /** Распознанные документы по порядку: вид и дата выдачи («Распознано: …»). */
  docs: { kind: RdKind; issued: string }[];
}

/** Реквизит формы с подписью источника: реквизиты документа, налоговый орган и основной ГКЭД. */
export type RdField = RdKey | 'ugns' | 'gked';

/** Откуда значение поля: документ, оба документа или «Предложено по адресу» (налоговый орган). */
export type RdFieldSrc = RdKind | 'both' | 'addr';

/**
 * Состояние подписей (прототип st.rd): значения из документов, откуда они, расхождения и трогали ли
 * «Дату начала обслуживания». «взять это» меняет значение, источник и порядок расхождения.
 */
export interface RegdocsState {
  v: Partial<Record<RdField, string | number>>;
  src: Partial<Record<RdField, RdFieldSrc>>;
  alt: Partial<Record<RdKey, RdAlt[]>>;
  startSet: boolean;
}

/** Реквизиты с полем в форме (прототип RD_MAP). */
export const RD_FIELDS: readonly RdField[] = [
  'name',
  'inn',
  'phone',
  'head',
  'form',
  'ugns',
  'full',
  'regNo',
  'okpo',
  'addr',
  'email',
  'regDate',
  'reRegDate',
  'founders',
  'foreign',
];

/** Названия реквизитов в сводке (прототип RD_TXT). */
export const RD_FIELD_TEXT: Readonly<Record<RdKey, UiTextKey>> = {
  name: 'cp.rd.f.name',
  full: 'cp.rd.f.full',
  inn: 'cp.rd.f.inn',
  regNo: 'cp.rd.f.reg_no',
  okpo: 'cp.rd.f.okpo',
  form: 'cp.rd.f.form',
  phone: 'cp.rd.f.phone',
  email: 'cp.rd.f.email',
  head: 'cp.rd.f.head',
  regDate: 'cp.rd.f.reg_date',
  reRegDate: 'cp.rd.f.rereg_date',
  founders: 'cp.rd.f.founders',
  foreign: 'cp.rd.f.foreign',
  addr: 'cp.rd.f.addr',
};

const str = (v: string | number | undefined) => (v === undefined ? '' : String(v));
const filled = (v: unknown) => v !== undefined && v !== null && v !== '';

/** Дата документа «15.03.2026»; не дата — как есть. */
export const rdDateText = (s: string) => (isIsoDate(s) ? formatDateRu(s) : s);

/**
 * Черновик из итога (прототип rdPrefill): реквизиты, форма собственности (не найдена — пусто),
 * налоговый орган по адресу, основной и дополнительные ГКЭД, регистрационные данные раскрыты.
 */
export function regdocsDraft(
  base: ContractorDraft,
  res: RegdocsResult,
  codes: readonly PhoneCodeOption[],
): ContractorDraft {
  const v = res.v;
  const phone = splitPhone(v.phone === undefined ? null : String(v.phone), codes);
  return {
    ...base,
    name: str(v.name),
    inn: str(v.inn),
    phone: v.phone === undefined ? base.phone : phone,
    head: str(v.head),
    formCode: str(v.form),
    taxOfficeCode: res.ugns,
    gked: res.gk?.code ? { code: res.gk.code, name: res.gk.name } : null,
    gkedExtra: res.gk?.more ?? [],
    regOpen: true,
    registration: {
      fullName: str(v.full),
      regNo: str(v.regNo),
      okpo: str(v.okpo),
      address: str(v.addr),
      email: str(v.email),
      regDate: str(v.regDate),
      reRegDate: str(v.reRegDate),
      founders: str(v.founders),
      foreign: str(v.foreign),
    },
  };
}

/** Начальные подписи (прототип rdPrefill, `st.rd`). */
export function regdocsState(res: RegdocsResult): RegdocsState {
  const gked = res.gk?.code ?? '';
  return {
    v: { ...res.v, ugns: res.ugns, gked },
    src: {
      ...res.src,
      ...(res.ugns ? { ugns: 'addr' as const } : {}),
      ...(gked && res.gk ? { gked: res.gk.src } : {}),
    },
    alt: res.alt,
    startSet: false,
  };
}

/** Значение поля в черновике — для сравнения со значением документа (прототип rdMarks, `cur`). */
export function draftValue(
  d: ContractorDraft,
  k: RdField,
  codes: readonly PhoneCodeOption[],
): string | number | null {
  const r = d.registration;
  switch (k) {
    case 'name':
      return d.name;
    case 'inn':
      return d.inn;
    case 'phone':
      return joinPhone(d.phone.cc, d.phone.local, codes).phone;
    case 'head':
      return d.head;
    case 'form':
      return d.formCode;
    case 'ugns':
      return d.taxOfficeCode;
    case 'gked':
      return d.gked?.code ?? '';
    case 'founders':
      return r.founders.trim() === '' ? '' : Number(r.founders);
    case 'full':
      return r.fullName;
    case 'addr':
      return r.address;
    default:
      return r[k];
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/** Подпись источника видна, пока значение в поле равно значению из документа (прототип rdMarks). */
export function sourceOf(
  st: RegdocsState,
  d: ContractorDraft,
  k: RdField,
  codes: readonly PhoneCodeOption[],
): RdFieldSrc | null {
  const s = st.src[k];
  return s && filled(st.v[k]) && same(draftValue(d, k, codes), st.v[k]) ? s : null;
}

/** Текст подписи источника. */
export const sourceText = (s: RdFieldSrc): UiTextKey => `cp.rd.src.${s}`;

/** Обязательное поле, которое нужно заполнить вручную (прототип rdMarks, `need`). */
export type RdNeed =
  'name' | 'inn' | 'phone' | 'gked' | 'form' | 'types' | 'resp' | 'fee' | 'start';

/** Что подписать «Заполните вручную» (прототип rdMarks): пустые обязательные и не тронутая дата начала. */
export function needs(
  st: RegdocsState,
  d: ContractorDraft,
  x: { reports: number; fee: boolean },
): RdNeed[] {
  const out: RdNeed[] = [];
  if (!d.name.trim()) out.push('name');
  if (!d.inn.trim()) out.push('inn');
  if (!d.phone.local.replace(/\D/g, '')) out.push('phone');
  if (!d.gked) out.push('gked');
  if (!d.formCode) out.push('form');
  if (d.kind === 'regular' && !x.reports) out.push('types');
  if (!d.responsibleId) out.push('resp');
  if (x.fee && !d.fee.trim()) out.push('fee');
  if (!st.startSet) out.push('start');
  return out;
}

/** Значение расхождения как в прототипе (rdFmt): телефон, дата, «есть / нет», форма — название. */
export function altValueText(
  k: RdKey,
  v: string | number,
  t: Translate,
  x: { codes: readonly PhoneCodeOption[]; formName: (code: string) => string },
): string {
  const s = String(v);
  if (k === 'phone') return formatPhone(s, x.codes);
  if (k === 'regDate' || k === 'reRegDate') return rdDateText(s);
  if (k === 'foreign') return t(s === 'yes' ? 'cp.rd.v.yes' : 'cp.rd.v.no');
  if (k === 'form') return x.formName(s);
  return s;
}

/**
 * «взять это» (прототип `data-rdalt`): выбранное значение встаёт первым, становится значением
 * документа и попадает в поле.
 */
export function takeAlt(
  st: RegdocsState,
  d: ContractorDraft,
  k: RdKey,
  i: number,
  codes: readonly PhoneCodeOption[],
): { st: RegdocsState; d: ContractorDraft } {
  const list = [...(st.alt[k] ?? [])];
  const x = list[i];
  if (!x) return { st, d };
  list.splice(i, 1);
  list.unshift(x);
  const next: RegdocsState = {
    ...st,
    v: { ...st.v, [k]: x.v },
    src: { ...st.src, [k]: x.src },
    alt: { ...st.alt, [k]: list },
  };
  const v = String(x.v);
  const r = d.registration;
  const patch: Partial<ContractorDraft> =
    k === 'name' || k === 'inn' || k === 'head'
      ? { [k]: v }
      : k === 'form'
        ? { formCode: v }
        : k === 'phone'
          ? { phone: splitPhone(v, codes) }
          : {
              registration: {
                ...r,
                [k === 'full' ? 'fullName' : k === 'addr' ? 'address' : k]: v,
              },
            };
  return { st: next, d: { ...d, ...patch } };
}

/** Сводка над формой (прототип rdHead): сколько заполнено, что проверить, чего нет, предупреждения. */
export interface RegdocsSummary {
  filled: number;
  check: number;
  miss: string[];
  warn: string[];
}

export function regdocsSummary(st: RegdocsState, res: RegdocsResult, t: Translate): RegdocsSummary {
  const altKeys = Object.keys(res.alt) as RdKey[];
  const miss = (['name', 'inn', 'phone', 'form'] as const)
    .filter((k) => !filled(st.v[k]))
    .map((k) => t(RD_FIELD_TEXT[k]));
  if (!st.v.gked) miss.push(t('cp.rd.f.gked'));
  return {
    filled: RD_FIELDS.filter((k) => filled(st.v[k])).length + (st.v.gked ? 1 : 0),
    check: altKeys.length + (res.ugns ? 1 : 0) + (res.gk && !res.gk.code ? 1 : 0),
    miss,
    warn: [
      ...altKeys.map((k) =>
        t('cp.rd.warn.alt', { field: t(RD_FIELD_TEXT[k]).toLocaleLowerCase('ru') }),
      ),
      ...(res.phoneBad ? [t('cp.rd.warn.phone', { phone: res.phoneBad })] : []),
    ],
  };
}

/** «Свидетельство от 18.10.2026 и Выписка от 20.10.2026» (прототип rdHead, `docs`). */
export const docsText = (docs: RegdocsPrefill['docs'], t: Translate) =>
  docs
    .map((x) =>
      x.issued
        ? t('cp.rd.state.ok_date', { kind: t(`cp.rd.kind.${x.kind}`), date: rdDateText(x.issued) })
        : t(`cp.rd.kind.${x.kind}`),
    )
    .join(t('cp.rd.sum.and'));
