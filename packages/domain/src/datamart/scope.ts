/**
 * Область «Свои контрагенты» в «Выводе» «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 2,
 * пункт 6; блок 8, пункт 1; общий план 20.11, этап 2, П4) — прототип v155 `modules/vitrina.js`
 * `dmRun`: сотруднику с областью «Свои» в группе прав модуля шаблона остаются только строки, у которых в
 * столбце «Контрагент» — его контрагент (ответственный — он сам). Шаблон без столбца «Контрагент» такому
 * сотруднику не виден вовсе (`dmTemplateSeen`).
 */
import { scopeOf, type AccessSubject } from '../roles/access';
import { SCOPE_GROUPS, type ScopeGroupId } from '../roles/permissions';
import type { DmModule } from './access';

/**
 * Код столбца «Контрагент» (прототип `cpCol`): первый столбец с отметкой `contractor` или вида `cp`
 * (`dm_templates.columns`: `{ code, name, type, total, contractor }`); нет такого — null. Это имя
 * столбца результата запроса, обычно `contractor_id`.
 */
export function dmContractorColumn(columns: unknown): string | null {
  if (!Array.isArray(columns)) return null;
  for (const c of columns) {
    if (typeof c !== 'object' || c === null) continue;
    const col = c as { code?: unknown; type?: unknown; contractor?: unknown };
    if (
      (col.contractor === true || col.type === 'cp') &&
      typeof col.code === 'string' &&
      col.code
    ) {
      return col.code;
    }
  }
  return null;
}

const isScopeGroup = (m: string): m is ScopeGroupId =>
  (SCOPE_GROUPS as readonly string[]).includes(m);

/**
 * Готовые шаблоны, в строках которых — данные ещё одного модуля с областью: отбор «Свои» нужен и тогда,
 * когда «Свои» — в его группе прав. «Выручка по контрагентам» (модуль «Контрагенты») показывает транши
 * проектов: как «Аналитика» на «Главной» (п. Г-12), транши — только проектов, которые сотрудник видит
 * в «Проектах контрагентов»; строки остаются только его контрагентов — их проекты он видит все
 * (прототип `revenueData` считает проекты всех контрагентов области «Контрагенты»). «Проекты и разовые
 * услуги» (модуль «Проекты») показывает разовые услуги, а их продукт показывает по области «Финансовых
 * операций» (`serviceReadScope`): при «Свои» там — тоже только свои контрагенты.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-28
export const DM_ALSO_SCOPED: Readonly<Record<string, readonly ScopeGroupId[]>> = {
  revenue: ['projects'],
  'projects-services': ['fin'],
};

/**
 * Нужен ли отбор «Свои» (прототип: не администратор, шаблон «Для организаций» с модулем с областью и
 * область группы — не «Все»). Владельцу и праву «Видеть всех контрагентов» — нет (`scopeOf`).
 *
 * Строже прототипа (ТЗ «Витрина данных», блок 8, пункт 8: сотрудник со «Свои» не видит строк чужих
 * контрагентов ни в одном готовом шаблоне): у модуля без области («Сотрудники») шаблон со столбцом
 * «Контрагент» отбирается по области группы «Контрагенты» — строки только контрагентов, за которых
 * сотрудник отвечает. Шаблон модуля без области и без такого столбца такому сотруднику не виден
 * (`dmTemplateSeen`), готовый «Задачи» — ещё и только с «Видеть задачи всех» (п. К-27). `code` — код
 * шаблона: у готовых из `DM_ALSO_SCOPED` — ещё и область второго модуля (п. К-28).
 */
export function dmOwnScope(
  module: DmModule | null,
  subject: AccessSubject,
  columns: unknown,
  code?: string,
): boolean {
  if (!module) return false;
  if (isScopeGroup(module)) {
    if (scopeOf(subject, module) === 'own') return true;
    // ОТКЛОНЕНИЕ: docs/deviations.md#К-28 — в строках есть данные ещё одного модуля с областью.
    const also = code ? (DM_ALSO_SCOPED[code] ?? []) : [];
    return dmContractorColumn(columns) !== null && also.some((g) => scopeOf(subject, g) === 'own');
  }
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-95 — модуль без области со столбцом «Контрагент» — по «Контрагентам».
  return dmContractorColumn(columns) !== null && scopeOf(subject, 'cps') === 'own';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Запрос шаблона с отбором «Свои»: результат шаблона — подзапрос, остаются строки, у которых значение
 * столбца «Контрагент» (текстом: столбец может быть и `uuid`, и текстом) — из списка контрагентов
 * сотрудника. Номера контрагентов — из базы и проверены как UUID, поэтому вписываются в текст сами:
 * параметров у шаблона и так до 20 (предел исполнителя `dm.run_org`), а `$21` база не примет. Пустой
 * список — ни одной строки. Нет такого столбца в результате — ошибка запроса базы (шаблон сломан).
 */
export function dmScopeQuery(
  text: string,
  column: string,
  contractorIds: readonly string[],
): string {
  const ids = contractorIds.map((id) => {
    if (!UUID.test(id)) throw new RangeError('dm: номер контрагента — не UUID');
    return id.toLowerCase();
  });
  const col = `"${column.replace(/"/g, '""')}"`;
  return `SELECT * FROM (\n${text}\n) dm_s WHERE (dm_s.${col})::text = ANY ('{${ids.join(',')}}'::text[])`;
}
