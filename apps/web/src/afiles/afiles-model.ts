import {
  formatCount,
  memoryGb,
  memoryLevel,
  memoryMb,
  pluralForm,
  type ListFilterValue,
} from '@buhuchet/domain';
import type { AdminOrgFiles, AdminStorageFile, AdminStorageSummary } from '@buhuchet/shared';
import type { PlateColor } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/*
 * Админка → «Файлы» и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2, блоки 3–5;
 * прототип v154 admin/admin-files.js; этап 1, П4–П5, поток И): чистые правила экрана — числа с одним
 * знаком, цвета плашек, фильтры плашек, тексты окон.
 */

type Filters = Readonly<Record<string, ListFilterValue>>;
type MonthNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Число с одним знаком без лишнего нуля: «9,4», «1 234,5», «9» (прототип `afN1`). */
export function oneDecimal(v: number): string {
  const r = Math.round(v * 10) / 10;
  const whole = Math.trunc(Math.abs(r));
  const part = Math.round((Math.abs(r) - whole) * 10);
  const sign = r < 0 ? '-' : '';
  return `${sign}${formatCount(whole)}${part ? `,${part}` : ''}`;
}

/** «9,4 ГБ» (1 ГБ = 1 000 МБ, как в ценах подписки; прототип `afGb`). */
export function gbText(t: Translate, bytes: number): string {
  return t('afiles.gb', { n: oneDecimal(memoryGb(bytes)) });
}

/** «12,5» — МБ с одним знаком (столбцы «Объём, МБ»). */
export const mbText = (bytes: number): string => oneDecimal(memoryMb(bytes));

/** «3 файла». */
export function filesCountText(t: Translate, n: number): string {
  return t(`afiles.count.${pluralForm(n)}`, { n: formatCount(n) });
}

/** Цвета плашек «Хранилища» (прототип `renderAFStore`): есть что разобрать — не зелёная. */
export function storePlateColors(s: AdminStorageSummary | undefined): {
  sent: PlateColor;
  trash: PlateColor;
  diff: PlateColor;
} {
  return {
    sent: s?.sent.n ? 'blue' : 'green',
    trash: s?.trash.n ? 'yellow' : 'green',
    diff: s?.diff ? 'red' : 'green',
  };
}

/**
 * Плашка «Хранилища» → «Все файлы» с фильтром (прототип `pre`): от контрагентов — «Новый» и
 * «Отклонён», заявки и чеки подписок — по «Источнику», «Занято всего» и «Файлы организаций» — без.
 */
export const STORE_PRESETS = {
  tot: {},
  org: {},
  sent: { st: { type: 'enum', vals: ['new', 'rejected'] } },
  lead: { src: { type: 'enum', vals: ['lead'] } },
  rcpt: { src: { type: 'enum', vals: ['subscription'] } },
} as const satisfies Record<string, Filters>;

/** «Все файлы» одной организации — строка «По организациям» (прототип `go('afiles','all',{org})`). */
export const orgFilesFilter = (orgId: string): Filters => ({
  org: { type: 'enum', vals: [orgId] },
});

/** Номер файла в окне просмотра: у каждого вида строк свои номера. */
export const viewerIdOf = (r: Pick<AdminStorageFile, 'kind' | 'id'>): string => `${r.kind}:${r.id}`;

/** Цвет «Занято, %» и полосы памяти (прототип: от 100 % — красный, от 80 % — жёлтый). */
export function pctClass(pct: number | null): string {
  const level = memoryLevel(pct);
  if (level === 'red') return 'font-semibold text-danger-label';
  if (level === 'yellow') return 'font-semibold text-warn-label';
  return '';
}

/** Полоса памяти организации (прототип `afMemBar`): подпись, процент, пояснение. */
export function memoryBar(
  t: Translate,
  m: Pick<AdminOrgFiles, 'usedBytes' | 'limitBytes' | 'pct' | 'includedBytes' | 'extraGb'>,
): { used: string; pct: string | null; width: number | null; hint: string } {
  const used =
    m.limitBytes === null
      ? t('afiles.mem.used', { used: gbText(t, m.usedBytes) })
      : t('afiles.mem.used_of', {
          used: gbText(t, m.usedBytes),
          limit: gbText(t, m.limitBytes),
        });
  if (m.limitBytes === null || m.pct === null)
    return { used, pct: null, width: null, hint: t('afiles.mem.no_limit') };
  const parts = [
    ...(m.includedBytes !== null
      ? [t('afiles.mem.included', { gb: gbText(t, m.includedBytes) })]
      : []),
    ...(m.extraGb
      ? [t('afiles.mem.extra', { gb: t('afiles.gb', { n: formatCount(m.extraGb) }) })]
      : []),
  ];
  return {
    used,
    pct: t('afiles.mem.pct', { pct: oneDecimal(m.pct) }),
    width: Math.max(0, Math.min(100, m.pct)),
    hint: `${parts.join(' · ')}${parts.length ? '. ' : ''}${t('afiles.mem.counts')}`,
  };
}

/** «Возраст» лишнего файла (прототип: до суток — «N ч», дальше — «N дней»). */
export function ageText(t: Translate, hours: number): string {
  if (hours < 24) return t('afiles.check.age.hours', { n: hours });
  const days = Math.floor(hours / 24);
  return t(`afiles.check.age.${pluralForm(days)}`, { n: days });
}

/** Столбики «Загружено по месяцам · МБ» (прототип `bars`): подпись — три буквы месяца. */
export function monthBars(
  t: Translate,
  months: AdminStorageSummary['months'],
): { key: string; label: string; title: string; value: number }[] {
  return months.map((m) => {
    const name = t(`report.month.${Number(m.month.slice(5, 7)) as MonthNo}`);
    const mb = memoryMb(m.bytes);
    return {
      key: m.month,
      label: name.slice(0, 3).toLowerCase(),
      title: `${name} ${m.month.slice(0, 4)}: ${t('files.size.mb', { n: oneDecimal(mb) })}`,
      value: Math.round(mb),
    };
  });
}

/** Высота столбика, %: ненулевой — не ниже 2 %, чтобы его было видно. */
export function barHeight(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/** Текст окна «Вернуть …?» (прототип `afBackDlg`): куда вернётся файл и чью память займёт. */
export function backText(
  t: Translate,
  x: { why: string | null; srcText: string | null; orgName: string | null },
): string {
  if (x.why === 'extra') return t('afiles.back.text_extra');
  const org = x.orgName ?? '';
  return x.srcText
    ? t('afiles.back.text', { src: x.srcText, org })
    : t('afiles.back.text_nosrc', { org });
}

/** «Объём по категориям»: больше места — выше (прототип `sort: {key: 'mb', dir: -1}`). */
export function categoryRows(categories: AdminOrgFiles['categories']): AdminOrgFiles['categories'] {
  return [...categories].sort((a, b) => b.bytes - a.bytes || b.n - a.n);
}
