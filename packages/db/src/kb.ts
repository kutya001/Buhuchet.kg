import {
  bishkekDate,
  FEATURES,
  isKbHow,
  type Feature,
  type IsoDate,
  type KbArticleDef,
  type KbCatalog,
  type KbDoneRule,
  type KbFeatureInfo,
  type KbMark,
  type KbScreenUi,
} from '@buhuchet/domain';
import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './client';
import {
  auditLog,
  employees,
  kbArticleReads,
  kbLevels,
  kbProgress,
  platformReference,
  roles,
  telegramLinks,
} from './schema';

/*
 * «База знаний» (задача 2.30, docs/decisions.md п. 44): содержимое из `platform_reference` (разделы
 * refDB.json `kbSteps`, `kbGroups`, `kbLevels`, `kbArticles`, `kbUi`) и прогресс пользователей —
 * отметки шагов, прочитанные статьи, полученные уровни. Всё — в `withOrgContext`: читается прогресс
 * своей организации, пишется только свой (RLS).
 */

const CODE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const text = z.string().catch('');
const optText = z.string().optional().catch(undefined);
const flag = z.union([z.boolean(), z.number()]).optional().catch(undefined);

const Step = z.object({
  id: z.string().regex(CODE),
  t: z.string().min(1),
  w: optText,
  star: flag,
  learn: flag,
  perm: optText,
  featk: optText,
  g: z.string(),
  ord: z.number().catch(0),
  active: z.boolean().optional().catch(undefined),
  evk: optText,
  at: z.array(z.string()).optional().catch(undefined),
  hit: optText,
  art: optText,
  isNew: z.boolean().optional().catch(undefined),
});
const Group = z.object({ id: z.string(), t: z.string(), scr: optText, adm: flag });
const Level = z.object({ n: z.string(), p: z.number() });
const Levels = z.object({ business: z.array(Level).min(1), admin: z.array(Level).min(1) });
const Article = z.object({
  id: z.string().regex(CODE),
  sec: text,
  t: z.string().min(1),
  mod: z.string().nullable().optional().catch(null),
  aud: optText,
  perm: z.string().nullable().optional().catch(null),
  feat: z.string().nullable().optional().catch(null),
  active: z.boolean().optional().catch(undefined),
  html: text,
});

/** Записи раздела по одной: неверная запись пропускается, а не ломает весь раздел. */
function items<T>(schema: z.ZodType<T>, payload: unknown): T[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((x) => {
    const r = schema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

async function payloads(db: Db | Tx, keys: readonly string[]): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: platformReference.key, payload: platformReference.payload })
    .from(platformReference)
    .where(inArray(platformReference.key, [...keys]));
  return new Map(rows.map((r) => [r.key, r.payload]));
}

const NO_LEVELS = { business: [{ n: '', p: 0 }], admin: [{ n: '', p: 0 }] };

/** Шаги, группы и уровни (без раздела — пусто: программа без шагов). */
export async function kbCatalog(db: Db | Tx): Promise<KbCatalog> {
  const p = await payloads(db, ['kbSteps', 'kbGroups', 'kbLevels']);
  const levels = Levels.safeParse(p.get('kbLevels'));
  return {
    steps: items(Step, p.get('kbSteps')),
    groups: items(Group, p.get('kbGroups')),
    levels: levels.success ? levels.data : NO_LEVELS,
  };
}

/** Статьи (`kbArticles`). */
export async function kbArticles(db: Db | Tx): Promise<KbArticleDef[]> {
  const p = await payloads(db, ['kbArticles']);
  return items(Article, p.get('kbArticles'));
}

const Ui = z.object({
  tabs: z.record(z.string(), z.string()).optional().catch(undefined),
  screens: z.record(z.string(), z.array(z.string())).optional().catch(undefined),
  els: z
    .array(z.object({ id: z.string(), t: z.string(), x: optText }))
    .optional()
    .catch(undefined),
  plates: z.record(z.string(), z.string()).optional().catch(undefined),
  buttons: z.record(z.string(), z.string()).optional().catch(undefined),
  addItems: z.record(z.string(), z.string()).optional().catch(undefined),
  artForms: z
    .array(z.object({ mod: z.string(), t: z.string(), x: optText, fields: z.array(z.string()) }))
    .optional()
    .catch(undefined),
  fields: z
    .record(z.string(), z.object({ n: optText, req: flag, x: optText }))
    .optional()
    .catch(undefined),
  features: z
    .record(z.string(), z.object({ benefit: optText, art: optText, g: optText }))
    .optional()
    .catch(undefined),
});

/** Описание экранов для статей и польза функций (`kbUi`). */
export async function kbScreenUi(db: Db | Tx): Promise<KbScreenUi> {
  const p = await payloads(db, ['kbUi']);
  const ui = Ui.safeParse(p.get('kbUi') ?? {});
  return ui.success ? (ui.data as KbScreenUi) : {};
}

/** Польза функций учётной политики (`kbUi.features`). */
export async function kbFeatureInfo(db: Db | Tx): Promise<Partial<Record<Feature, KbFeatureInfo>>> {
  const ui = await kbScreenUi(db);
  const info = ui.features ?? {};
  return Object.fromEntries(FEATURES.filter((f) => info[f]).map((f) => [f, info[f]!]));
}

/* ───────────── Прогресс ───────────── */

/** Отметки шагов пользователей организации. */
export async function kbMarksOf(
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, Map<string, KbMark>>> {
  const result = new Map<string, Map<string, KbMark>>(userIds.map((u) => [u, new Map()]));
  if (!userIds.length) return result;
  const rows = await tx
    .select({
      userId: kbProgress.userId,
      stepId: kbProgress.stepId,
      doneHow: kbProgress.doneHow,
      doneAt: kbProgress.doneAt,
      skippedAt: kbProgress.skippedAt,
    })
    .from(kbProgress)
    .where(inArray(kbProgress.userId, [...userIds]));
  for (const r of rows) {
    result.get(r.userId)?.set(r.stepId, {
      done:
        r.doneHow && r.doneAt && isKbHow(r.doneHow)
          ? { how: r.doneHow, at: r.doneAt.toISOString() }
          : null,
      skipped: r.skippedAt !== null,
    });
  }
  return result;
}

export interface KbReachedLevel {
  level: number;
  at: Date;
}

/** Полученные уровни пользователей, по возрастанию. */
export async function kbReachedOf(
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, KbReachedLevel[]>> {
  const result = new Map<string, KbReachedLevel[]>(userIds.map((u) => [u, []]));
  if (!userIds.length) return result;
  const rows = await tx
    .select({ userId: kbLevels.userId, level: kbLevels.level, at: kbLevels.reachedAt })
    .from(kbLevels)
    .where(inArray(kbLevels.userId, [...userIds]))
    .orderBy(asc(kbLevels.level));
  for (const r of rows) result.get(r.userId)?.push({ level: r.level, at: r.at });
  return result;
}

/** Прочитанные пользователем статьи: код → когда. */
export async function kbReadArticles(tx: Tx, userId: string): Promise<Map<string, Date>> {
  const rows = await tx
    .select({ id: kbArticleReads.articleId, at: kbArticleReads.readAt })
    .from(kbArticleReads)
    .where(eq(kbArticleReads.userId, userId));
  return new Map(rows.map((r) => [r.id, r.at]));
}

/** Условие истории: изменено хотя бы одно поле или поле получило значение. */
function changesCondition(rule: Extract<KbDoneRule, { kind: 'history' }>): SQL | undefined {
  const parts: SQL[] = [];
  for (const field of rule.anyField ?? []) {
    parts.push(sql`${auditLog.changes} @> ${JSON.stringify([{ field }])}::jsonb`);
  }
  if (rule.change) {
    parts.push(sql`${auditLog.changes} @> ${JSON.stringify([rule.change])}::jsonb`);
  }
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : undefined;
}

/**
 * Когда пользователь сам выполнил условие шагов «Сделать» (ТЗ «если он уже делал это раньше (есть в
 * истории изменений под его именем), шаг отмечается сразу»): шаг → момент последней подходящей записи
 * истории или привязки Telegram. Одним запросом на все шаги.
 */
export async function kbDoneFacts(
  tx: Tx,
  userId: string,
  steps: readonly { id: string; rule: KbDoneRule }[],
): Promise<Map<string, Date>> {
  const parts = steps.map(({ id, rule }) => {
    if (rule.kind === 'telegram') {
      return sql`(select ${id}::text as step_id, max(${telegramLinks.linkedAt}) as at from ${telegramLinks} where ${telegramLinks.userId} = ${userId})`;
    }
    const where = and(
      eq(auditLog.actorUserId, userId),
      eq(auditLog.entity, rule.entity),
      inArray(auditLog.action, [...rule.actions]),
      changesCondition(rule),
    );
    return sql`(select ${id}::text as step_id, max(${auditLog.at}) as at from ${auditLog} where ${where})`;
  });
  if (!parts.length) return new Map();
  const rows = await tx.execute<{ step_id: string; at: Date | string | null }>(
    sql.join(parts, sql` union all `),
  );
  const result = new Map<string, Date>();
  for (const r of rows) if (r.at) result.set(r.step_id, new Date(r.at));
  return result;
}

/**
 * Засчитать свой шаг: один раз и навсегда, со способом и моментом; пропуск при этом снимается (ТЗ
 * «Пропущенный шаг засчитывается сам, если пользователь потом выполнил его условие»). true — шаг
 * засчитан сейчас, false — был засчитан раньше.
 */
export async function kbMarkDone(tx: Tx, stepId: string, how: KbMark['done'] extends infer D ? (D extends { how: infer H } ? H : never) : never): Promise<boolean> {
  const rows = await tx
    .insert(kbProgress)
    .values({
      userId: sql`app.current_user_id()`,
      stepId,
      doneHow: how,
      doneAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [kbProgress.userId, kbProgress.stepId],
      set: { doneHow: how, doneAt: sql`now()`, skippedAt: null },
      setWhere: sql`${kbProgress.doneAt} is null`,
    })
    .returning({ stepId: kbProgress.stepId });
  return rows.length > 0;
}

/** «Пропустить» (только не выполненный) и «Вернуть» свой шаг. true — отметка изменилась. */
export async function kbSetSkipped(tx: Tx, stepId: string, skipped: boolean): Promise<boolean> {
  if (!skipped) {
    const rows = await tx
      .update(kbProgress)
      .set({ skippedAt: null })
      .where(
        and(
          eq(kbProgress.userId, sql`app.current_user_id()`),
          eq(kbProgress.stepId, stepId),
          sql`${kbProgress.skippedAt} is not null`,
        ),
      )
      .returning({ stepId: kbProgress.stepId });
    return rows.length > 0;
  }
  const rows = await tx
    .insert(kbProgress)
    .values({ userId: sql`app.current_user_id()`, stepId, skippedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [kbProgress.userId, kbProgress.stepId],
      set: { skippedAt: sql`now()` },
      setWhere: sql`${kbProgress.doneAt} is null and ${kbProgress.skippedAt} is null`,
    })
    .returning({ stepId: kbProgress.stepId });
  return rows.length > 0;
}

/** Своя статья прочитана; true — впервые. */
export async function kbMarkArticleRead(tx: Tx, articleId: string): Promise<boolean> {
  const rows = await tx
    .insert(kbArticleReads)
    .values({ userId: sql`app.current_user_id()`, articleId })
    .onConflictDoNothing()
    .returning({ id: kbArticleReads.articleId });
  return rows.length > 0;
}

/** Записать свои полученные уровни (уже записанные не меняются). */
export async function kbRecordLevels(tx: Tx, levels: readonly number[]): Promise<void> {
  if (!levels.length) return;
  await tx
    .insert(kbLevels)
    .values(levels.map((level) => ({ userId: sql`app.current_user_id()`, level })))
    .onConflictDoNothing();
}

const FeatureChange = z.object({
  field: z.literal('features'),
  from: z.record(z.string(), z.unknown()).nullable().optional().catch(null),
  to: z.record(z.string(), z.unknown()).nullable().optional().catch(null),
});

/**
 * Когда функции учётной политики включались после `since` — для «Новое» у их шагов (прототип
 * `ORG.featOn`): функция → дата последнего включения по Бишкеку, из истории учётной политики.
 */
export async function kbFeatureOnDates(
  tx: Tx,
  since: Date,
): Promise<Partial<Record<Feature, IsoDate>>> {
  const rows = await tx
    .select({ changes: auditLog.changes, at: auditLog.at })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'org_settings'),
        gte(auditLog.at, since),
        sql`${auditLog.changes} @> '[{"field":"features"}]'::jsonb`,
      ),
    )
    .orderBy(asc(auditLog.at));
  const on: Partial<Record<Feature, IsoDate>> = {};
  for (const row of rows) {
    for (const change of row.changes) {
      const c = FeatureChange.safeParse(change);
      if (!c.success) continue;
      for (const f of FEATURES) {
        if (c.data.to?.[f] === true && c.data.from?.[f] !== true) on[f] = bishkekDate(row.at);
      }
    }
  }
  return on;
}

/** Сотрудник для уровней: учётная запись, роль, активен ли. */
export interface KbMember {
  employeeId: string;
  userId: string;
  fullName: string;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  active: boolean;
}

/** Сотрудники организации из контекста (RLS) — для «Уровней сотрудников» и столбца «Уровень знаний». */
export async function kbMembers(tx: Tx, employeeIds?: readonly string[]): Promise<KbMember[]> {
  return tx
    .select({
      employeeId: employees.id,
      userId: employees.userId,
      fullName: employees.fullName,
      roleId: roles.id,
      roleName: roles.name,
      isOwner: roles.isOwner,
      active: employees.active,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(employeeIds ? inArray(employees.id, [...employeeIds]) : undefined)
    .orderBy(asc(employees.fullName));
}
