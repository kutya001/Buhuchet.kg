import {
  bishkekDate,
  FEATURES,
  isKbHow,
  KB_KNOWN_LIMIT,
  KB_SHOW_AUTOS,
  kbBusinessAccess,
  kbProgram,
  kbStats,
  type Feature,
  type IsoDate,
  type KbArticleDef,
  type KbCatalog,
  type KbDoneRule,
  type KbFeatureInfo,
  type KbHow,
  type KbLevelDef,
  type KbMark,
  type KbProgramGroup,
  type KbScreenUi,
  type KbStats,
  type ListQuery,
  type ListSort,
} from '@buhuchet/domain';
import { and, asc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { adminOrganizations } from './admin-orgs';
import type { Db, Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { orgMenuSettings } from './org';
import {
  auditLog,
  employees,
  kbArticleReads,
  kbKnown,
  kbLevels,
  kbProgress,
  platformReference,
  roles,
  statusHistory,
  telegramLinks,
} from './schema';
import { roleRightsMap, type EmployeeKbLevels } from './staff';

/*
 * «База знаний» (задача 2.30, docs/decisions.md п. Г-2): содержимое из `platform_reference` (разделы
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

/* ───────────── Показы ───────────── */

const ShowAction = z.union([
  z.string().max(64),
  z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])),
]);
const optActions = z.array(ShowAction).optional().catch(undefined);
const optNullText = z.string().nullable().optional().catch(undefined);
const optFlag = z.boolean().optional().catch(undefined);
const ShowItem = z.object({
  s: optNullText,
  m: optNullText,
  t: optText,
  x: optText,
  in: optText,
  txt: optText,
  up: optText,
  ctx: optText,
  pre: optActions,
  sub: optActions,
  auto: z.enum(KB_SHOW_AUTOS).optional().catch(undefined),
  common: optFlag,
  noBody: optFlag,
});
const Show = z.object({
  id: z.string().regex(CODE),
  step: z.string().regex(CODE),
  scr: optText,
  items: z.array(ShowItem),
  doit: optActions,
  active: optFlag,
});
const dict = z.record(z.string(), z.string()).optional().catch(undefined);
const ShowUi = z.object({
  ui: dict,
  plateMode: dict,
  mods: dict,
  tabs: dict,
  add: dict,
  addItems: dict,
  plates: dict,
  boxes: dict,
  ctabs: dict,
  cards: dict,
  buttons: dict,
  acts: dict,
  forms: dict,
  rows: dict,
  fields: z
    .record(z.string(), z.object({ n: optText, req: flag, x: optText }))
    .optional()
    .catch(undefined),
  els: z
    .array(
      z.object({
        id: z.string(),
        scr: z.string(),
        s: optNullText,
        m: optNullText,
        in: optText,
        txt: optText,
        up: optText,
        t: z.string(),
        x: optText,
        at: optText,
      }),
    )
    .optional()
    .catch(undefined),
});
export type KbShowUi = z.infer<typeof ShowUi>;
export type KbShowRecord = z.infer<typeof Show>;

/**
 * Сценарии «Показать как» (`kbShows`, только активные) и тексты облачков (`kbUi`: служебные тексты,
 * описания модулей, вкладок, кнопок, плашек, полей, элементов экрана) — для показа на экране.
 */
export async function kbShowContent(db: Db | Tx): Promise<{ ui: KbShowUi; shows: KbShowRecord[] }> {
  const p = await payloads(db, ['kbShows', 'kbUi']);
  const ui = ShowUi.safeParse(p.get('kbUi') ?? {});
  return {
    ui: ui.success ? ui.data : {},
    shows: items(Show, p.get('kbShows')).filter((s) => s.active !== false),
  };
}

/* ───────────── Знакомые элементы ───────────── */

/** Свои знакомые элементы показов (RLS: только свои строки). */
export async function kbKnownKeys(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ key: kbKnown.key })
    .from(kbKnown)
    .where(eq(kbKnown.userId, sql`app.current_user_id()`))
    .orderBy(asc(kbKnown.knownAt), asc(kbKnown.key));
  return rows.map((r) => r.key);
}

/**
 * Запомнить свои знакомые элементы (уже знакомые не меняются). Больше `KB_KNOWN_LIMIT` не хранится:
 * сверх предела новые не запоминаются — показ просто покажет их снова. Возвращает, сколько знакомых
 * теперь.
 */
export async function kbAddKnown(tx: Tx, keys: readonly string[]): Promise<number> {
  // Одна вставка пользователя за раз: две параллельные не перешагнут предел.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('kb_known'), hashtext(app.current_user_id()::text))`,
  );
  const count = async () => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(kbKnown)
      .where(eq(kbKnown.userId, sql`app.current_user_id()`));
    return row?.n ?? 0;
  };
  const before = await count();
  const room = KB_KNOWN_LIMIT - before;
  const fresh = [...new Set(keys)].slice(0, Math.max(0, room));
  if (!fresh.length) return before;
  await tx
    .insert(kbKnown)
    .values(fresh.map((key) => ({ userId: sql`app.current_user_id()`, key })))
    .onConflictDoNothing();
  return count();
}

/** «Показывать всё заново»: забыть свои знакомые элементы; возвращает, сколько их было. */
export async function kbResetKnown(tx: Tx): Promise<number> {
  const rows = await tx
    .delete(kbKnown)
    .where(eq(kbKnown.userId, sql`app.current_user_id()`))
    .returning({ key: kbKnown.key });
  return rows.length;
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
 * истории, «Истории статусов» или привязки Telegram. Одним запросом на все шаги.
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
    if (rule.kind === 'status') {
      const changed = and(
        eq(statusHistory.actorUserId, userId),
        eq(statusHistory.scale, rule.scale),
        eq(statusHistory.isRollback, false),
        // Смена системой (приостановка контрагента, выключение подтверждения) — не действие пользователя.
        isNull(statusHistory.cause),
        inArray(statusHistory.fromStatus, [...rule.from]),
        inArray(statusHistory.toStatus, [...rule.to]),
      );
      return sql`(select ${id}::text as step_id, max(${statusHistory.at}) as at from ${statusHistory} where ${changed})`;
    }
    if (rule.kind === 'org_created') {
      // Представление Админки: строки — только администратору платформы.
      const v = adminOrganizations;
      return sql`(select ${id}::text as step_id, max(${v.createdAt}) as at from ${v} where ${v.createdBy} = ${userId})`;
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
export async function kbMarkDone(tx: Tx, stepId: string, how: KbHow): Promise<boolean> {
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

/** Уровень сотрудника для «Уровней сотрудников», столбца «Уровень знаний» и его карточки. */
export interface KbMemberProgress {
  member: KbMember;
  stats: KbStats;
  /** Уровни программы организации (`kbLevels.business`). */
  levels: readonly KbLevelDef[];
  /** Полученные уровни с датами, по возрастанию. */
  reached: KbReachedLevel[];
  /** Когда получен последний уровень; null — уровней ещё нет (не открывал «Базу знаний»). */
  lastAt: Date | null;
}

/**
 * Уровни сотрудников организации из контекста (прототип kbFor): программа каждого — из прав его роли
 * и функций учётной политики, засчитанные шаги — сохранённые отметки (ТЗ «Как считается»: шаг
 * засчитывается тому, кто сам сделал действие; свои прошлые действия засчитываются при входе в
 * программу). Уровень не ниже полученного раньше.
 */
export async function kbTeam(
  tx: Tx,
  orgId: string,
  employeeIds?: readonly string[],
): Promise<KbMemberProgress[]> {
  const members = await kbMembers(tx, employeeIds);
  if (!members.length) return [];
  const catalog = await kbCatalog(tx);
  const { features } = await orgMenuSettings(tx, orgId);
  const rights = await roleRightsMap(
    tx,
    members.map((m) => m.roleId),
  );
  const userIds = members.map((m) => m.userId);
  const marks = await kbMarksOf(tx, userIds);
  const reached = await kbReachedOf(tx, userIds);
  const programs = new Map<string, KbProgramGroup[]>();
  return members.map((member) => {
    let program = programs.get(member.roleId);
    if (!program) {
      const r = rights.get(member.roleId);
      const subject = {
        employeeId: member.employeeId,
        isOwner: r?.isOwner ?? false,
        permissions: new Set(r?.permissions ?? []),
        scopes: r?.scopes ?? {},
      };
      program = kbProgram(catalog, kbBusinessAccess(subject, features));
      programs.set(member.roleId, program);
    }
    const got = reached.get(member.userId) ?? [];
    const max = got.length ? got[got.length - 1]!.level : null;
    return {
      member,
      stats: kbStats(program, marks.get(member.userId) ?? new Map(), catalog.levels.business, max),
      levels: catalog.levels.business,
      reached: got,
      lastAt: got.length ? got[got.length - 1]!.at : null,
    };
  });
}

/** Уровни знаний для столбца «Уровень знаний» списка сотрудников (`listEmployeesPage`). */
export async function kbEmployeeLevels(tx: Tx, orgId: string): Promise<EmployeeKbLevels> {
  const team = await kbTeam(tx, orgId);
  return {
    rows: team.map((p) => ({
      employeeId: p.member.employeeId,
      level: p.stats.level,
      name: p.levels[p.stats.level]?.n ?? '',
      pct: p.stats.pct,
    })),
    of: team[0]?.levels.length ?? 0,
  };
}

/* ───────────── «Уровни сотрудников» ───────────── */

/**
 * Строки списка — посчитанные уровни сотрудников одним параметром запроса (`jsonb_to_recordset`), а
 * поиск, фильтры, сортировка, группировка и выгрузка — общим механизмом списков.
 */
function teamSource(team: readonly KbMemberProgress[], t: ListTexts): SQL {
  const rows = team.map((p, n) => ({
    id: p.member.employeeId,
    n,
    full_name: p.member.fullName,
    role: p.member.roleName,
    active: p.member.active,
    level: p.stats.level,
    level_name: p.levels[p.stats.level]?.n ?? '',
    levels: p.levels.length,
    pct: p.stats.pct,
    done: p.stats.done,
    total: p.stats.total,
    steps: t('kb.team.steps')
      .replace('{done}', String(p.stats.done))
      .replace('{total}', String(p.stats.total)),
    level_at: p.lastAt ? bishkekDate(p.lastAt) : null,
  }));
  return sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(id uuid, n integer, full_name text, role text, active boolean, level integer, level_name text, levels integer, pct integer, done integer, total integer, steps text, level_at date)`;
}

/** Столбец строки из `jsonb_to_recordset`: имена — постоянные, не ввод пользователя. */
const col = (key: string) => sql.raw(`"r"."${key}"`);

/** Столбцы «Уровней сотрудников» (прототип modules/kb.js, вкладка team). */
export const KB_TEAM_COLUMNS: ListColumns = {
  fullName: { type: 'text', label: 'kb.team.col.full_name', value: col('full_name') },
  role: { type: 'enum', label: 'kb.team.col.role', value: col('role') },
  level: {
    type: 'enum',
    label: 'kb.team.col.level',
    value: col('level_name'),
    // По номеру уровня: значение сортировки зависит только от значения столбца, иначе группы и
    // значения фильтра разделились бы по проценту.
    sort: { value: col('level'), text: false },
  },
  pct: { type: 'int', label: 'kb.team.col.pct', value: col('pct') },
  steps: {
    type: 'text',
    label: 'kb.team.col.steps',
    value: col('steps'),
    sort: { value: col('done'), text: false },
  },
  levelAt: { type: 'date', label: 'kb.team.col.level_at', value: col('level_at') },
};

/** По умолчанию — от высшего уровня (прототип `sort:{key:'lvl',dir:-1}`). */
const TEAM_SORT: ListSort = { key: 'level', dir: 'desc' };

const teamFrom =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

export interface KbTeamRow {
  id: string;
  fullName: string;
  role: string;
  active: boolean;
  level: number;
  levelName: string;
  pct: number;
  done: number;
  total: number;
  levelAt: string | null;
}

/** Страница «Уровней сотрудников» организации из контекста. */
export async function listKbTeamPage(tx: Tx, orgId: string, query: ListQuery, t: ListTexts) {
  const source = teamSource(await kbTeam(tx, orgId), t);
  const page = await selectListPage({
    query,
    columns: KB_TEAM_COLUMNS,
    natural: [col('n')],
    defaultSort: TEAM_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({
          id: sql<string>`${col('id')}`,
          fullName: sql<string>`${col('full_name')}`,
          role: sql<string>`${col('role')}`,
          active: sql<boolean>`${col('active')}`,
          level: sql<number>`${col('level')}`,
          levelName: sql<string>`${col('level_name')}`,
          levels: sql<number>`${col('levels')}`,
          pct: sql<number>`${col('pct')}`,
          done: sql<number>`${col('done')}`,
          total: sql<number>`${col('total')}`,
          levelAt: sql<string | null>`to_char(${col('level_at')}, 'YYYY-MM-DD')`,
          ...window,
        })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: teamFrom(tx, source),
  });
  return page;
}

/** Значения столбца «Уровней сотрудников» для фильтра-галочек; `q` — «Найти значение». */
export async function listKbTeamValues(
  tx: Tx,
  orgId: string,
  key: string,
  t: ListTexts,
  q?: string,
) {
  const source = teamSource(await kbTeam(tx, orgId), t);
  return selectListValues({
    columns: KB_TEAM_COLUMNS,
    key,
    scope: undefined,
    from: teamFrom(tx, source),
    q,
  });
}

/** «Уровни сотрудников» для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys`. */
export async function exportKbTeam(
  tx: Tx,
  orgId: string,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  const source = teamSource(await kbTeam(tx, orgId), t);
  return selectListExport({
    query,
    columns: KB_TEAM_COLUMNS,
    keys,
    natural: [col('n')],
    defaultSort: TEAM_SORT,
    scope: undefined,
    from: teamFrom(tx, source),
  });
}
