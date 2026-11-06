import { formatDateRu, type IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';
import type { FileSourceKind } from '../files/files';
import type { Translate } from '../l10n/texts';
import type { PageSection } from '../org/policy';
import type { ReportPeriod } from '../platform-dicts/catalog';
import { periodLabel } from '../reports/periods';

/*
 * Раздел «Файлы» страницы контрагента (решение заказчика 06.11.2026, прототип v74 modules/cp-page.js —
 * `PG_FCAT`, `pubFiles`; modules/files.js — `pgFileOk`; ТЗ «Страница контрагента по ссылке» → «Файлы»):
 * файлы этого контрагента, которые хранятся у нас, по категориям. Файлы задач, скрытые со страницы и
 * файлы удалённых или отменённых записей сервер на страницу не передаёт никогда.
 */

/** Категории — плашки-фильтры раздела по порядку (прототип PG_FCAT). */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-7 — «Прочие» в продукте не отделены от «Документов компании».
export const PAGE_FILE_CATEGORIES = ['rep', 'doc', 'pay', 'in', 'prj', 'fee'] as const;
export type PageFileCategory = (typeof PAGE_FILE_CATEGORIES)[number];

/**
 * Категория файла по источнику; null — файл на страницу не попадает: задачи (ТЗ «файлы задач не
 * показываются никогда»), списания, возвраты и переводы и значения показателей (их нет и в прототипе).
 * Загруженный вручную к контрагенту — «Документы компании»: в продукте так же кладёт файлы «Прикрепить»
 * вкладки «Файлы» карточки (прототип `c.files`).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-7
const CATEGORY_OF: Readonly<Record<FileSourceKind, PageFileCategory | null>> = {
  manual: 'doc',
  contractor: 'doc',
  report: 'rep',
  receipt: 'in',
  tax_payment: 'pay',
  fee_payment: 'fee',
  money_operation: null,
  one_off_service: 'prj',
  one_off_service_payment: 'prj',
  project: 'prj',
  project_payment: 'prj',
  task: null,
  indicator_value: null,
};

export function pageFileCategory(kind: string): PageFileCategory | null {
  return Object.hasOwn(CATEGORY_OF, kind) ? CATEGORY_OF[kind as FileSourceKind] : null;
}

/**
 * Может ли файл быть на странице контрагента (прототип `pgFileOk`): файл контрагента, не задачи.
 * Только у таких файлов есть «Скрыть со страницы контрагента» и столбец «На странице контрагента».
 */
export function pageFileApplies(file: {
  sourceKind: string;
  contractorId: string | null;
}): boolean {
  return file.contractorId !== null && pageFileCategory(file.sourceKind) !== null;
}

/**
 * Категории, которые показывает страница (прототип `pubFiles`; ТЗ «Категории следуют разделам
 * страницы»): «Отчёты» — при показанном разделе «Отчёты», «Оплаты налогов» и «Ваши переводы» — при
 * показанных «Деньгах на налоги», «Проекты и услуги» — при включённых «Проектах контрагентов»,
 * «Оплата за обслуживание» — при показанной «Оплате за обслуживание»; «Документы компании» — всегда.
 */
export function pageFileCategories(
  sections: readonly PageSection[],
  o: { projects: boolean; fee: boolean },
): PageFileCategory[] {
  const on: Record<PageFileCategory, boolean> = {
    rep: sections.includes('reports'),
    doc: true,
    pay: sections.includes('money'),
    in: sections.includes('money'),
    prj: o.projects,
    fee: o.fee,
  };
  return PAGE_FILE_CATEGORIES.filter((c) => on[c]);
}

/** Ссылка на файл раздела «Файлы» живёт 5 минут (ТЗ «ссылка на файл временная (действует 5 минут)»). */
export const PAGE_FILE_LINK_SECONDS = 5 * 60;

/** К чему относится файл: что нужно для подписи «НДС · 09.2026», «Проект «…»» и т. п. */
export type PageFileSource =
  | { kind: 'report'; type: string; period: ReportPeriod; start: IsoDate; event: IsoDate | null }
  | { kind: 'regdocs' }
  | { kind: 'manual'; note: string | null }
  | {
      kind: 'tax_payment';
      report: { type: string; period: ReportPeriod; start: IsoDate; event: IsoDate | null } | null;
      amount: Tyiyn;
      date: IsoDate;
    }
  | { kind: 'receipt'; amount: Tyiyn; date: IsoDate }
  | { kind: 'service'; name: string }
  | { kind: 'project'; name: string }
  | { kind: 'fee_payment'; amount: Tyiyn; date: IsoDate };

/**
 * Подпись «к чему относится» (прототип `pubFiles`): «НДС · 09.2026», «Из свидетельства и выписки»,
 * «НДС · 09.2026, оплата 3 000 сом от 20.10.2026», «Поступление 15 000 сом от 12.10.2026»,
 * «Услуга «…»», «Проект «…»», «Оплата 5 000 сом от 05.10.2026»; у загруженного вручную — его описание.
 */
export function pageFileRel(src: PageFileSource, t: Translate): string {
  const report = (r: {
    type: string;
    period: ReportPeriod;
    start: IsoDate;
    event: IsoDate | null;
  }) => `${r.type} · ${periodLabel({ period: r.period, start: r.start, event: r.event }, t)}`;
  switch (src.kind) {
    case 'report':
      return report(src);
    case 'regdocs':
      return t('files.src.regdocs');
    case 'manual':
      return src.note?.trim() ?? '';
    case 'tax_payment': {
      const pay = t('pub.files.rel.tax_payment', {
        amount: formatSomWithUnit(src.amount),
        date: formatDateRu(src.date),
      });
      return src.report ? `${report(src.report)}, ${pay}` : pay;
    }
    case 'receipt':
      return t('pub.files.rel.receipt', {
        amount: formatSomWithUnit(src.amount),
        date: formatDateRu(src.date),
      });
    case 'service':
      return t('pub.files.rel.service', { name: src.name });
    case 'project':
      return t('pub.files.rel.project', { name: src.name });
    case 'fee_payment':
      return t('pub.files.rel.fee_payment', {
        amount: formatSomWithUnit(src.amount),
        date: formatDateRu(src.date),
      });
  }
}
