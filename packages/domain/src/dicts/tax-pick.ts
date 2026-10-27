import type { Translate } from '../l10n/texts';
import type { PickGroup, ReportKind } from '../platform-dicts/catalog';

/*
 * Окно «Выбор налогов» (ТЗ «Моя организация» → «Первый запуск организации», экран 6, и «Справочники» →
 * «Виды отчётов» → «Подключить из каталога»; прототип modules/tax-pick.js): весь каталог видов отчётов
 * группами по режимам, «Для всех», «По основаниям», «По статусам» и «Статистика». Отчёт из нескольких
 * групп показан в каждой, отметка у него общая.
 */

/** Вид отчёта каталога для «Выбора налогов»: режимы — краткими названиями («ОНР»), орган — названием. */
export interface TaxPickType {
  code: string;
  kind: ReportKind;
  pickGroup: PickGroup;
  /** «Применимые режимы» — краткие названия режимов. */
  regimes: readonly string[];
  /** «Основание» — коды оснований. */
  bases: readonly string[];
  /** Орган — название («ГНС», «Нацстатком»). */
  authority: string;
  preselect: boolean;
}

export interface TaxPickCatalog {
  /** Действующие виды отчётов в порядке каталога. */
  types: readonly TaxPickType[];
  /** Действующие основания в порядке справочника. */
  bases: readonly { code: string; name: string }[];
  /** Виды, которые добавляет хотя бы одна льгота или статус. */
  benefitAdds: ReadonlySet<string>;
  /** Полное название режима по краткому («Общий налоговый режим (ОНР)»). */
  regimeFullName: (name: string) => string | undefined;
}

export interface TaxPickSubgroup {
  /** Подзаголовок (название основания); пусто — без подзаголовка. */
  title: string;
  codes: string[];
}

export interface TaxPickGroup {
  /** `reg:<режим>`, `all`, `basis`, `status`, `stat`. */
  id: string;
  title: string;
  /** Одна строка «кому это нужно». */
  who: string;
  subs: TaxPickSubgroup[];
}

/** Режимы-статусы (резиденты ПВТ, ПКИ, СЭЗ) идут в группу «По статусам», а не в режимы. */
const STATUS_REGIMES: ReadonlySet<string> = new Set(['ПВТ', 'ПКИ', 'СЭЗ']);
/** Порядок режимных групп: эти три первыми, остальные — по алфавиту. */
const REGIME_ORDER = ['ОНР', 'Единый налог', 'Патент'];
/** Основание «В списке Нацстаткома» — это группа «Статистика», а не подгруппа оснований. */
const STAT_BASE = 'statSample';
const STAT_AUTHORITY = 'Нацстатком';
/** «Отметить основные»: кроме режимных ОНР и единого налога — ЕНД организаций и ИП и STI-161. */
const MAIN_EXTRA: ReadonlySet<string> = new Set(['endo', 'endi', 'soc']);

const regimeRank = (name: string) => {
  const i = REGIME_ORDER.indexOf(name);
  return i < 0 ? 99 : i;
};

/** Группы «Выбора налогов» (прототип txGroups); пустые группы и подгруппы не показываются. */
export function taxPickGroups(catalog: TaxPickCatalog, t: Translate): TaxPickGroup[] {
  const list = catalog.types.filter((x) => x.pickGroup !== 'disabled');
  const groups: TaxPickGroup[] = [];
  const add = (id: string, title: string, who: string, subs: TaxPickSubgroup[]) => {
    const filled = subs.filter((s) => s.codes.length);
    if (filled.length) groups.push({ id, title, who, subs: filled });
  };
  const codes = (pick: (x: TaxPickType) => boolean) => list.filter(pick).map((x) => x.code);

  const regimes = [
    ...new Set(
      list
        .filter((x) => x.kind === 'regime')
        .flatMap((x) => x.regimes.filter((r) => !STATUS_REGIMES.has(r))),
    ),
  ].sort((a, b) => regimeRank(a) - regimeRank(b) || a.localeCompare(b, 'ru'));
  for (const r of regimes) {
    add(
      `reg:${r}`,
      r === 'ОНР' ? t('dicts.tx.group.onr') : r,
      t('dicts.tx.who.regime', { name: catalog.regimeFullName(r) ?? r }),
      [{ title: '', codes: codes((x) => x.kind === 'regime' && x.regimes.includes(r)) }],
    );
  }
  add('all', t('dicts.tx.group.all'), t('dicts.tx.who.all'), [
    {
      title: '',
      codes: codes(
        (x) =>
          x.kind !== 'regime' &&
          (x.pickGroup === 'all' || x.pickGroup === 'optional') &&
          !x.bases.length,
      ),
    },
  ]);
  add(
    'basis',
    t('dicts.tx.group.basis'),
    t('dicts.tx.who.basis'),
    catalog.bases
      .filter((b) => b.code !== STAT_BASE)
      .map((b) => ({
        title: b.name,
        codes: codes(
          (x) => x.kind !== 'regime' && x.bases.includes(b.code) && x.authority !== STAT_AUTHORITY,
        ),
      })),
  );
  add('status', t('dicts.tx.group.status'), t('dicts.tx.who.status'), [
    {
      title: '',
      codes: codes(
        (x) =>
          x.pickGroup === 'status' ||
          x.regimes.some((r) => STATUS_REGIMES.has(r)) ||
          catalog.benefitAdds.has(x.code),
      ),
    },
  ]);
  add('stat', t('dicts.tx.group.stat'), t('dicts.tx.who.stat'), [
    {
      title: '',
      codes: codes((x) => x.authority === STAT_AUTHORITY || x.bases.includes(STAT_BASE)),
    },
  ]);
  return groups;
}

/**
 * «Отметить основные» (прототип txMain): режимные отчёты ОНР и единого налога без особых оснований,
 * которые отмечаются заранее, ЕНД и STI-161 — самый частый набор бухгалтерской компании.
 */
export function mainTaxPicks(types: readonly TaxPickType[]): string[] {
  return types
    .filter(
      (x) =>
        (x.kind === 'regime' &&
          x.regimes.some((r) => r === 'ОНР' || r === 'Единый налог') &&
          x.preselect &&
          x.pickGroup === 'regime' &&
          !x.bases.length &&
          !x.regimes.includes('Патент')) ||
        MAIN_EXTRA.has(x.code),
    )
    .map((x) => x.code);
}

/** Коды всех видов групп без повторов — «Выбрано N из M» и «Выбрать всю группу». */
export function taxPickGroupCodes(group: TaxPickGroup): string[] {
  return [...new Set(group.subs.flatMap((s) => s.codes))];
}
