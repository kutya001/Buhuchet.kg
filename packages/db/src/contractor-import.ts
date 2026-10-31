import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Tx } from './client';
import {
  contractors,
  employees,
  gkedItems,
  orgReportTypes,
  ownershipForms,
  reportTypes,
  roles,
  taxOffices,
  taxRegimes,
  users,
} from './schema';
import { phoneCodes } from './staff';

/*
 * Загрузка контрагентов из Excel (задача 2.16; прототип modules/contractor-import.js): справочники и
 * данные организации, по которым проверяются строки вставки и строится шаблон. Всё читается одним
 * разом на всю загрузку: строк до 500, и на каждую строку ходить в базу незачем.
 */

/** Справочники загрузки: только действующие значения (отключённое значение не ставится новой записи). */
export interface ContractorImportData {
  phoneCodes: { code: string; mask: string }[];
  /**
   * Действующие сотрудники по имени; `accountant` — роль из шаблона «Бухгалтер» (пример шаблона берёт
   * первого бухгалтера, прототип impTemplate).
   */
  employees: {
    id: string;
    login: string;
    shortName: string;
    fullName: string;
    accountant: boolean;
  }[];
  /** Виды отчётов, подключённые в организации и не отключённые в каталоге, по порядку каталога. */
  types: { code: string; name: string; shortName: string }[];
  /** `region` — «Город или область»: место деятельности для строк единого налога (прототип enPlace). */
  offices: {
    code: string;
    gnsCode: string | null;
    name: string;
    shortName: string;
    region: string;
  }[];
  regimes: { code: string; name: string }[];
  forms: { code: string; name: string; declarationFor: 'org' | 'ip' }[];
}

export async function contractorImportData(tx: Tx): Promise<ContractorImportData> {
  const [codes, staff, types, offices, regimes, forms] = await Promise.all([
    phoneCodes(tx),
    tx
      .select({
        id: employees.id,
        login: users.login,
        shortName: employees.shortName,
        fullName: employees.fullName,
        accountant: sql<boolean>`coalesce(${roles.templateCode} = 'acc', false)`,
      })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(roles, eq(roles.id, employees.roleId))
      .where(eq(employees.active, true))
      .orderBy(sql`${employees.shortName} collate app.ru_natural`, employees.id),
    tx
      .select({ code: reportTypes.code, name: reportTypes.name, shortName: reportTypes.shortName })
      .from(reportTypes)
      .innerJoin(orgReportTypes, eq(orgReportTypes.reportTypeCode, reportTypes.code))
      .where(
        and(
          eq(orgReportTypes.enabled, true),
          eq(reportTypes.active, true),
          ne(reportTypes.pickGroup, 'disabled'),
        ),
      )
      .orderBy(asc(reportTypes.sortOrder)),
    tx
      .select({
        code: taxOffices.code,
        gnsCode: taxOffices.gnsCode,
        name: taxOffices.name,
        shortName: taxOffices.shortName,
        region: taxOffices.region,
      })
      .from(taxOffices)
      .where(eq(taxOffices.active, true))
      .orderBy(asc(taxOffices.sortOrder)),
    tx
      .select({ code: taxRegimes.code, name: taxRegimes.name })
      .from(taxRegimes)
      .where(eq(taxRegimes.active, true))
      .orderBy(asc(taxRegimes.sortOrder)),
    tx
      .select({
        code: ownershipForms.code,
        name: ownershipForms.name,
        declarationFor: ownershipForms.declarationFor,
      })
      .from(ownershipForms)
      .where(eq(ownershipForms.active, true))
      .orderBy(asc(ownershipForms.sortOrder)),
  ]);
  return { phoneCodes: codes, employees: staff, types, offices, regimes, forms };
}

/** Какие из ИНН уже есть у контрагентов организации, включая архив (уникальный ключ базы). */
export async function takenInns(tx: Tx, inns: readonly string[]): Promise<Set<string>> {
  const list = [...new Set(inns.filter((x) => /^\d{14}$/.test(x)))];
  if (!list.length) return new Set();
  const rows = await tx
    .select({ inn: contractors.inn })
    .from(contractors)
    .where(inArray(contractors.inn, list));
  return new Set(rows.map((r) => r.inn));
}

/** Коды ГКЭД из вставки, которые есть в справочнике: уровень и действует ли. */
export async function gkedLevels(
  tx: Tx,
  codes: readonly string[],
): Promise<Map<string, { level: string; active: boolean }>> {
  const list = [...new Set(codes)];
  if (!list.length) return new Map();
  const rows = await tx
    .select({ code: gkedItems.code, level: gkedItems.level, active: gkedItems.active })
    .from(gkedItems)
    .where(inArray(gkedItems.code, list));
  return new Map(rows.map((r) => [r.code, { level: r.level, active: r.active }]));
}

/**
 * Лист «Коды ГКЭД» шаблона (прототип impTemplate: действующие подклассы с секцией): код, вид
 * деятельности и буква секции — по цепочке родителей.
 */
export async function gkedTemplateRows(
  tx: Tx,
): Promise<{ code: string; name: string; section: string }[]> {
  const rows = await tx
    .select({
      code: gkedItems.code,
      name: gkedItems.name,
      level: gkedItems.level,
      parent: gkedItems.parentCode,
      active: gkedItems.active,
    })
    .from(gkedItems)
    .orderBy(asc(gkedItems.sortOrder), asc(gkedItems.code));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const sectionOf = (code: string): string => {
    let x = byCode.get(code);
    for (let i = 0; x && i < 10; i++) {
      if (x.level === 'section') return x.code;
      x = x.parent ? byCode.get(x.parent) : undefined;
    }
    return '';
  };
  return rows
    .filter((r) => r.level === 'subclass' && r.active)
    .map((r) => ({ code: r.code, name: r.name, section: sectionOf(r.code) }));
}
