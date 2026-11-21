import { DM_MODULES, DM_PARAM_TYPES, PERMISSIONS, type DmParamDef } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { dmTemplateSql, dmTemplates } from '../schema';
import { DM_BUILTIN_SQL } from './datamart-templates';
import type { SeedOptions, SeedReport } from './platform';

/*
 * Готовые шаблоны «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 7; общий план 20.11,
 * этап 1, П11): «приходят с программой, как шаблоны сообщений; администратор может отключить любой и
 * сделать свой копированием». Название, описание, модуль, право, параметры и столбцы — из
 * `refDB.dmTemplates`, запрос — свой (`DM_BUILTIN_SQL`: прототип SQL не выполняет). Шаблон опубликован и
 * доступен всем организациям. `--update` (каждый выпуск) обновляет готовые шаблоны, кроме состояния и
 * доступа: их меняет администратор платформы; шаблон администратора с тем же кодом не трогается.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-26

/** Типы столбцов шаблона (прототип `DM_CT`): `cp` — скрытый столбец «Контрагент» для области «Свои». */
export const DM_COLUMN_TYPES = [
  'text',
  'num',
  'money',
  'date',
  'datetime',
  'month',
  'bool',
  'cp',
] as const;

const Param = z
  .object({
    k: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().min(1).max(100),
    type: z.enum(DM_PARAM_TYPES),
    req: z.boolean(),
    def: z.string().nullable(),
  })
  .strict();

const Column = z
  .object({
    k: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().min(1).max(100),
    type: z.enum(DM_COLUMN_TYPES),
    total: z.boolean(),
  })
  .strict();

/** Шаблон refDB.json; служебные поля прототипа (история, отметки проверки) не переносятся. */
const Template = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  desc: z.string(),
  kind: z.enum(['org', 'adm']),
  mod: z.enum(DM_MODULES).nullable(),
  perm: z.string().nullable(),
  params: z.array(Param),
  cols: z.array(Column).min(1),
  cpCol: z.string().nullable(),
  access: z.literal('all'),
  state: z.literal('Опубликован'),
  src: z.literal('system'),
});

/** Параметр шаблона в базе (`dm_templates.params`). */
export interface DmTemplateParam {
  code: string;
  name: string;
  type: DmParamDef['type'];
  required: boolean;
  default: string | null;
}

/** Столбец шаблона в базе (`dm_templates.columns`); `contractor` — столбец «Контрагент» области «Свои». */
export interface DmTemplateColumn {
  code: string;
  name: string;
  type: (typeof DM_COLUMN_TYPES)[number];
  total: boolean;
  contractor: boolean;
}

/** Параметры шаблона из базы — в вид `dmBind` (`@buhuchet/domain`). */
export const dmParamDefsOf = (params: readonly DmTemplateParam[]): DmParamDef[] =>
  params.map((p) => ({ k: p.code, type: p.type, req: p.required, def: p.default }));

const PERMISSION_CODES = new Set<string>(PERMISSIONS.map(([id]) => id));

/** Строка `dm_templates` и запрос готового шаблона из записи refDB.json. */
export function dmBuiltinRows(section: unknown) {
  const list = z.array(Template).parse(section ?? []);
  const codes = new Set<string>();
  return list.map((t) => {
    if (codes.has(t.code)) throw new Error(`dmTemplates: код «${t.code}» дважды`);
    codes.add(t.code);
    const query = DM_BUILTIN_SQL[t.code];
    if (!query) throw new Error(`dmTemplates: у готового шаблона «${t.code}» нет запроса продукта`);
    if ((t.kind === 'org') !== (t.mod !== null))
      throw new Error(`dmTemplates: «${t.code}» — модуль только у шаблона организаций`);
    if (t.perm !== null && !PERMISSION_CODES.has(t.perm))
      throw new Error(`dmTemplates: у «${t.code}» право «${t.perm}» не из каталога прав`);
    if (t.cpCol !== null && !t.cols.some((c) => c.k === t.cpCol && c.type === 'cp'))
      throw new Error(`dmTemplates: «${t.code}» — столбец «Контрагент» не из списка столбцов`);
    const params: DmTemplateParam[] = t.params.map((p) => ({
      code: p.k,
      name: p.label,
      type: p.type,
      required: p.req,
      default: p.def,
    }));
    const columns: DmTemplateColumn[] = t.cols.map((c) => ({
      code: c.k,
      name: c.label,
      type: c.type,
      total: c.total,
      contractor: c.k === t.cpCol,
    }));
    return {
      template: {
        code: t.code,
        name: t.name,
        description: t.desc,
        audience: t.kind === 'org' ? ('org' as const) : ('admin' as const),
        params,
        columns,
        module: t.mod,
        needPermission: t.perm,
        access: 'all' as const,
        state: 'published' as const,
        builtin: true,
      },
      query,
    };
  });
}

/** Готовые шаблоны и их запросы: недостающие, с `update` — и изменившиеся готовые. */
export async function seedDmTemplates(
  db: Db,
  section: unknown,
  options: SeedOptions,
): Promise<SeedReport> {
  const rows = dmBuiltinRows(section);
  if (!rows.length) return { inserted: 0, updated: 0, unchanged: 0 };
  const t = dmTemplates;
  const before = await db.$count(t, eq(t.builtin, true));
  const insert = db.insert(t).values(rows.map((r) => r.template));
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: t.code,
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            audience: sql`excluded.audience`,
            params: sql`excluded.params`,
            columns: sql`excluded.columns`,
            module: sql`excluded.module`,
            needPermission: sql`excluded.need_permission`,
            updatedAt: sql`now()`,
            version: sql`${t.version} + 1`,
          },
          setWhere: sql`${t.builtin} and (${t.name}, ${t.description}, ${t.audience}, ${t.params}, ${t.columns}, ${t.module}, ${t.needPermission})
            is distinct from (excluded.name, excluded.description, excluded.audience, excluded.params, excluded.columns, excluded.module, excluded.need_permission)`,
        })
        .returning({ id: t.id })
    : await insert.onConflictDoNothing().returning({ id: t.id });
  const inserted = (await db.$count(t, eq(t.builtin, true))) - before;
  const ids = new Map(
    (await db.select({ id: t.id, code: t.code }).from(t).where(eq(t.builtin, true))).map((r) => [
      r.code,
      r.id,
    ]),
  );
  const s = dmTemplateSql;
  const sqlRows = rows.flatMap((r) => {
    const templateId = ids.get(r.template.code);
    return templateId ? [{ templateId, query: r.query }] : [];
  });
  const sqlInsert = db.insert(s).values(sqlRows);
  const queries = options.update
    ? await sqlInsert
        .onConflictDoUpdate({
          target: s.templateId,
          // Прежняя проверка была о прежнем запросе: её итог снимается до следующей проверки.
          set: {
            query: sql`excluded.query`,
            checkedAt: null,
            checkedOrgId: null,
            checkError: null,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${s.query} <> excluded.query`,
        })
        .returning({ id: s.templateId })
    : await sqlInsert.onConflictDoNothing().returning({ id: s.templateId });
  const changed = new Set([...touched.map((r) => r.id), ...queries.map((r) => r.id)]);
  const updated = Math.max(0, changed.size - inserted);
  return { inserted, updated, unchanged: rows.length - inserted - updated };
}
