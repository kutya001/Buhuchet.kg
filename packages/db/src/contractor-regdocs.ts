import type { RdDicts } from '@buhuchet/domain';
import { asc } from 'drizzle-orm';
import type { Tx } from './client';
import { gkedItems, ownershipForms, taxOffices } from './schema';

/*
 * Создание контрагента «Из свидетельства и выписки» (задача 2.17; прототип core/regdocs.js — rdForm,
 * rdUgns, rdGked): справочники платформы, с которыми сверяются реквизиты документа, — формы
 * собственности, налоговые органы и ГКЭД, все записи с признаком «действует» (отключённое значение
 * разбор не предлагает).
 */
export async function regdocsDicts(tx: Tx): Promise<RdDicts> {
  const [forms, offices, gked] = await Promise.all([
    tx
      .select({
        code: ownershipForms.code,
        name: ownershipForms.name,
        fullName: ownershipForms.fullName,
        shortName: ownershipForms.shortName,
        active: ownershipForms.active,
      })
      .from(ownershipForms)
      .orderBy(asc(ownershipForms.sortOrder)),
    tx
      .select({
        code: taxOffices.code,
        name: taxOffices.name,
        region: taxOffices.region,
        active: taxOffices.active,
      })
      .from(taxOffices)
      .orderBy(asc(taxOffices.sortOrder)),
    tx
      .select({
        code: gkedItems.code,
        name: gkedItems.name,
        level: gkedItems.level,
        parent: gkedItems.parentCode,
        active: gkedItems.active,
      })
      .from(gkedItems)
      .orderBy(asc(gkedItems.sortOrder)),
  ]);
  return { forms, offices, gked };
}
