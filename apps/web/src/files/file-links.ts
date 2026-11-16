import {
  formatDateRu,
  formatSomWithUnit,
  periodLabel,
  pluralForm,
  type MoneyOpKind,
} from '@buhuchet/domain';
import type { FileLinkInfo } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';

/**
 * Подписи записей, к которым файл контрагента прикреплён ссылкой (доработки 16.11.2026, блок 2;
 * прототип v124 modules/files.js `fLinkRecs`): `nm` — «Перейти к источнику: …» и «Удалить отовсюду?»,
 * `gen` — «также у …», `src` — «Источник» Файлового менеджера.
 */
export type FileLinkForm = 'nm' | 'gen' | 'src';

const dateOf = (link: FileLinkInfo) => (link.date ? formatDateRu(link.date) : '');
const amountOf = (link: FileLinkInfo) => formatSomWithUnit(link.amount ?? 0);

/**
 * Отчёт коротко: «НДС · 10.2026» у ссылки на отчёт, «НДС 10.2026» у оплаты налога (прототип v124
 * `fLinkRecs`: `${T[r.t].short} · ${r.plabel}` и `Оплата ${T[r.t].short} ${r.plabel}`).
 */
function reportOf(t: Translate, link: FileLinkInfo, pay = false): string {
  if (!link.report) return '';
  const { short, period, start, event } = link.report;
  return t(pay ? 'files.link.report_pay' : 'files.link.report', {
    short,
    period: periodLabel({ period, start, event }, t),
  });
}

/** Подпись записи по словарю. */
export function fileLinkText(t: Translate, link: FileLinkInfo, form: FileLinkForm): string {
  const date = dateOf(link);
  const amount = amountOf(link);
  const name = link.name ?? '';
  switch (link.kind) {
    case 'receipt':
      return t(`files.link.${form}.receipt`, { date, amount });
    case 'tax_payment':
      if (form === 'src')
        return link.report
          ? t('files.link.src.tax_payment', { report: reportOf(t, link, true), amount, date })
          : t('files.link.src.tax_payment_plain', { date, amount });
      return t(`files.link.${form}.tax_payment`, { date });
    case 'money_operation': {
      const op = link.op ? t(`money.op.${link.op as MoneyOpKind}`) : '';
      return t(`files.link.${form}.money_operation`, { op, date, amount });
    }
    case 'fee_payment':
      return t(`files.link.${form}.fee_payment`, { date, amount });
    case 'report':
      return t(`files.link.${form}.report`, { report: reportOf(t, link) });
    case 'one_off_service':
      return t(`files.link.${form}.one_off_service`, { name });
    case 'one_off_service_payment':
      return t(`files.link.${form}.one_off_service_payment`, { name, date, amount });
    case 'project':
      return t(`files.link.${form}.project`, { name });
    case 'project_payment':
      return t(`files.link.${form}.project_payment`, { name, date, amount });
    default:
      return '';
  }
}

/** «Источник» файла с ссылками (прототип `o.src=[o.base,...links.src].join(' · ')`). */
export function fileSourceWithLinks(
  t: Translate,
  base: string,
  links: readonly FileLinkInfo[],
): string {
  return [base, ...links.map((l) => fileLinkText(t, l, 'src'))].filter(Boolean).join(' · ');
}

/** «также у поступления от 10.11.2026, отчёта НДС · 10.2026» (прототип `o.also`); ссылок нет — null. */
export function fileAlsoText(t: Translate, links: readonly FileLinkInfo[]): string | null {
  if (!links.length) return null;
  return t('files.pick.also', { list: links.map((l) => fileLinkText(t, l, 'gen')).join(', ') });
}

/**
 * Список «Файл прикреплён ещё к: …» окна «Удалить отовсюду?» (прототип `fDelDlg`): видимые записи с
 * маленькой буквы и «ещё N записей, которых вам не видно».
 */
export function fileDeleteLinksList(
  t: Translate,
  links: readonly FileLinkInfo[],
  hidden: number,
): string {
  const seen = links.map((l) => {
    const nm = fileLinkText(t, l, 'nm');
    return nm.charAt(0).toLowerCase() + nm.slice(1);
  });
  if (hidden) seen.push(t(`files.delete.hidden.${pluralForm(hidden)}`, { n: hidden }));
  return seen.join('; ');
}
