import {
  addMonths,
  bishkekDate,
  isSessionEndReason,
  OPEN_REPORT_STATUSES,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
  SESSION_MAX_HOURS,
  type SessionEndReason,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { alias, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { adminGetUser, type AdminUserRecord } from './admin-users';
import { writeHistory } from './history';
import { kbArticles, kbReadArticles, kbTeam, type KbMemberProgress } from './kb';
import { ownVideoViews, videoRecords, videoViewBody } from './kb-video';
import { writePlatformHistory } from './platform-history';
import { getRole } from './roles';
import {
  auditLog,
  contractors,
  employees,
  indicators,
  indicatorValues,
  platformAuditLog,
  reports,
  reportTypes,
  roles,
  tasks,
  taxRegimes,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import { endUserSessions } from './staff';

// Карточка пользователя в Админке (ТЗ «Админка» → «Карточка пользователя», решение заказчика
// 09.11.2026; прототип admin/admin-cards.js, accCard). Только чтение, кроме «Завершить все сеансы».

/** Сколько строк отдаёт каждый список карточки; число записей при этом — настоящее. */
export const ADMIN_CARD_ROWS = 200;

/**
 * Журнал сеансов для Админки (миграция 0112): представление отдаёт строки, только если в контексте —
 * незаблокированный администратор платформы. Токена сеанса в нём нет.
 */
export const adminSessions = pgSchema('app')
  .view('admin_sessions', {
    id: uuid('id').notNull(),
    userId: uuid('user_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    device: text('device'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
  })
  .existing();

export interface AdminSessionRecord {
  id: string;
  startedAt: Date;
  /** Открыт — последнее обращение; закрыт — когда закрыт. */
  lastAt: Date;
  /** Только у открытого сеанса. */
  till: Date | null;
  device: string | null;
  open: boolean;
  /** Чем закрыт; у открытого — null. */
  endReason: SessionEndReason | null;
}

/**
 * Сеансы пользователя: сверху новые. Сеанс открыт, пока не закрыт и не истёк; срок — не дальше
 * `SESSION_MAX_HOURS` с входа (как у проверки сеанса). Истёкший, но ещё не удалённый — «Истёк срок».
 */
export async function adminUserSessions(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<{ rows: AdminSessionRecord[]; total: number; open: number }> {
  const s = adminSessions;
  const all = await tx
    .select()
    .from(s)
    .where(eq(s.userId, userId))
    .orderBy(desc(s.startedAt), desc(s.id));
  const rows = all.map((r): AdminSessionRecord => {
    const hardEnd = new Date(r.startedAt.getTime() + SESSION_MAX_HOURS * 3_600_000);
    const till = r.expiresAt < hardEnd ? r.expiresAt : hardEnd;
    const open = r.endedAt === null && till > now;
    const reason: SessionEndReason =
      r.endedAt === null ? 'expired' : isSessionEndReason(r.endReason) ? r.endReason : 'closed';
    return {
      id: r.id,
      startedAt: r.startedAt,
      lastAt: open ? r.lastSeenAt : (r.endedAt ?? till),
      till: open ? till : null,
      device: r.device,
      open,
      endReason: open ? null : reason,
    };
  });
  return {
    rows: rows.slice(0, ADMIN_CARD_ROWS),
    total: rows.length,
    open: rows.filter((r) => r.open).length,
  };
}

/** Список карточки: настоящее число записей и первые `ADMIN_CARD_ROWS` строк. */
export interface CardList<Row> {
  count: number;
  rows: Row[];
}

function cardList<Row>(rows: readonly Row[]): CardList<Row> {
  return { count: rows.length, rows: rows.slice(0, ADMIN_CARD_ROWS) };
}

export interface AdminCardContractor {
  id: string;
  name: string;
  inn: string | null;
  regime: string | null;
  serviceStatus: string;
}

export interface AdminCardReport {
  id: string;
  contractor: string;
  type: string;
  /** Вид периода и его начало: подпись периода собирает экран. */
  period: string;
  periodStart: string;
  dueDate: string;
  status: string;
}

export interface AdminCardTask {
  id: string;
  title: string;
  contractor: string | null;
  dueDate: string | null;
  status: string;
}

export interface AdminCardKpiValue {
  id: string;
  contractor: string;
  indicator: string;
  value: number | null;
  at: Date;
}

export interface AdminUserCardRecord {
  user: AdminUserRecord;
  /** Нет — учётная запись администратора платформы. */
  employee: {
    id: string;
    shortName: string;
    phone: string | null;
    isOwner: boolean;
    mustChangePassword: boolean;
    loginFailures: number;
    loginLocked: boolean;
    createdAt: Date;
    role: { name: string; permissions: PermissionId[]; scopes: Record<ScopeGroupId, Scope> } | null;
    telegram: { username: string | null; firstName: string | null; linkedAt: Date } | null;
  } | null;
  work: {
    contractors: CardList<AdminCardContractor>;
    due: CardList<AdminCardReport>;
    inWork: CardList<AdminCardReport>;
    overdue: CardList<AdminCardReport>;
    done: CardList<AdminCardReport>;
    tasks: CardList<AdminCardTask>;
    kpi: CardList<AdminCardKpiValue>;
    /** Месяц показателей — прошлый (прототип acWorkData: `pm`). */
    kpiMonth: string;
  } | null;
  kb: {
    /** Прогресс программы обучения — как в блоке «Уровень знаний» карточки сотрудника. */
    progress: KbMemberProgress | null;
    articles: CardList<{ id: string; title: string; section: string; readAt: Date }>;
    videos: CardList<{
      id: string;
      title: string;
      secs: number;
      pct: number;
      lastAt: Date | null;
      status: string;
    }>;
  } | null;
  telegram: CardList<{
    id: string;
    at: Date;
    kind: string;
    status: string;
    error: string | null;
  }> | null;
  history: {
    id: string;
    at: Date;
    actor: string | null;
    /** Автор — администратор платформы (в организации у него нет сотрудника). */
    actorAdmin: boolean;
    entity: string;
    action: string;
    fields: string[];
    reason: string | null;
  }[];
}

const actor = alias(employees, 'actor');
const actorUser = alias(users, 'actor_user');

function historyRow(r: {
  id: number;
  at: Date;
  actorName: string | null;
  actorAdmin: boolean | null;
  entity: string;
  action: string;
  changes: readonly { field: string }[];
  reason: string | null;
}): AdminUserCardRecord['history'][number] {
  return {
    id: `${r.entity}-${r.id}`,
    at: r.at,
    actor: r.actorName,
    actorAdmin: r.actorAdmin === true,
    entity: r.entity,
    action: r.action,
    fields: r.changes.map((c) => c.field),
    reason: r.reason,
  };
}

/** Записи платформы об учётной записи: открытия карточки администратора платформы. */
async function platformHistory(tx: Tx, userId: string): Promise<AdminUserCardRecord['history']> {
  const rows = await tx
    .select({
      id: platformAuditLog.id,
      at: platformAuditLog.at,
      actorName: sql<string | null>`${actorUser.login}::text`,
      actorAdmin: sql<boolean>`true`,
      entity: platformAuditLog.entity,
      action: platformAuditLog.action,
      changes: platformAuditLog.changes,
      reason: platformAuditLog.reason,
    })
    .from(platformAuditLog)
    .leftJoin(actorUser, eq(actorUser.id, platformAuditLog.actorUserId))
    .where(and(eq(platformAuditLog.entity, 'user'), eq(platformAuditLog.entityId, userId)))
    .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
    .limit(ADMIN_CARD_ROWS);
  return rows.map(historyRow);
}

/**
 * Карточка администратора платформы — в его контексте (`withUserContext`): «Основное» из списка
 * учётных записей и история платформы. null — не администратор платформы или нет такого.
 */
export async function adminAccountCard(
  tx: Tx,
  userId: string,
): Promise<AdminUserCardRecord | null> {
  const user = await adminGetUser(tx, userId);
  if (!user?.isPlatformAdmin) return null;
  return {
    user,
    employee: null,
    work: null,
    kb: null,
    telegram: null,
    history: await platformHistory(tx, userId),
  };
}

const reportRow = {
  id: reports.id,
  contractor: contractors.name,
  type: sql<string>`coalesce(${reportTypes.shortName}, ${reportTypes.name}, ${reports.reportTypeCode})`,
  period: reports.period,
  periodStart: reports.periodStart,
  dueDate: reports.dueDate,
  status: reports.status,
};

/**
 * Карточка сотрудника организации — в контексте его организации от имени администратора платформы
 * (`withOrgContext`): всё, что показывают вкладки, одним ответом. null — нет такого сотрудника.
 */
export async function adminEmployeeCard(
  tx: Tx,
  db: Db,
  input: { userId: string; orgId: string; now: Date },
): Promise<AdminUserCardRecord | null> {
  const user = await adminGetUser(tx, input.userId);
  if (!user || user.isPlatformAdmin) return null;
  const [e] = await tx
    .select({
      id: employees.id,
      shortName: employees.shortName,
      phone: employees.phone,
      roleId: employees.roleId,
      isOwner: roles.isOwner,
      createdAt: employees.createdAt,
      mustChangePassword: users.mustChangePassword,
      loginFailures: users.loginFailures,
      loginLockedAt: users.loginLockedAt,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(eq(employees.userId, input.userId));
  if (!e) return null;

  const today = bishkekDate(input.now);
  const month = today.slice(0, 7);
  const kpiMonth = addMonths(month, -1);
  const mine = and(eq(reports.responsibleEmployeeId, e.id), eq(reports.superseded, false));
  const reportsOf = (where: ReturnType<typeof and>) =>
    tx
      .select(reportRow)
      .from(reports)
      .innerJoin(contractors, eq(contractors.id, reports.contractorId))
      .leftJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
      .where(and(mine, where))
      .orderBy(asc(reports.dueDate), asc(reports.id));

  const role = await getRole(tx, e.roleId);
  const [tg] = await tx
    .select({
      username: telegramLinks.username,
      firstName: telegramLinks.firstName,
      linkedAt: telegramLinks.linkedAt,
    })
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, input.userId));
  const cps = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      inn: contractors.inn,
      regime: taxRegimes.name,
      serviceStatus: contractors.serviceStatus,
    })
    .from(contractors)
    .leftJoin(taxRegimes, eq(taxRegimes.code, contractors.regimeCode))
    .where(
      and(eq(contractors.responsibleEmployeeId, e.id), ne(contractors.serviceStatus, 'archived')),
    )
    .orderBy(asc(contractors.name), asc(contractors.id));
  const due = await reportsOf(eq(reports.status, 'todo'));
  const inWork = await reportsOf(eq(reports.status, 'in_progress'));
  // Просрочена сдача — как в списке отчётов (report-list.ts, overdueOf): несданный отчёт со сдачей,
  // срок прошёл, контрагент не приостановлен.
  const overdue = await reportsOf(
    and(
      inArray(reports.status, [...OPEN_REPORT_STATUSES]),
      lt(reports.dueDate, today),
      ne(reports.act, 'pay'),
      ne(contractors.serviceStatus, 'paused'),
    ),
  );
  const done = await reportsOf(
    and(
      eq(reports.status, 'submitted'),
      sql`to_char(${reports.submittedOn}, 'YYYY-MM') = ${month}`,
    ),
  );
  const openTasks = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      contractor: contractors.name,
      dueDate: tasks.dueDate,
      status: tasks.status,
    })
    .from(tasks)
    .leftJoin(contractors, eq(contractors.id, tasks.contractorId))
    .where(
      and(
        eq(tasks.executorEmployeeId, e.id),
        inArray(tasks.status, ['todo', 'in_progress', 'rework']),
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.id));
  const kpi = await tx
    .select({
      id: indicatorValues.id,
      contractor: contractors.name,
      indicator: indicators.name,
      value: indicatorValues.value,
      at: indicatorValues.updatedAt,
    })
    .from(indicatorValues)
    .innerJoin(contractors, eq(contractors.id, indicatorValues.contractorId))
    .innerJoin(indicators, eq(indicators.id, indicatorValues.indicatorId))
    .where(
      and(
        eq(indicatorValues.month, kpiMonth),
        or(
          eq(indicatorValues.updatedBy, input.userId),
          eq(indicatorValues.createdBy, input.userId),
        ),
      ),
    )
    .orderBy(asc(contractors.name), asc(indicators.name), asc(indicatorValues.id));

  const [progress] = await kbTeam(tx, input.orgId, [e.id]);
  const read = await kbReadArticles(tx, input.userId);
  const articles = (await kbArticles(db))
    .flatMap((a) => {
      const readAt = read.get(a.id);
      return readAt ? [{ id: a.id, title: a.t, section: a.sec, readAt }] : [];
    })
    .sort((a, b) => b.readAt.getTime() - a.readAt.getTime());
  const views = await ownVideoViews(tx, input.userId);
  const videos = (await videoRecords(tx, { withDeleted: true }))
    .flatMap((v) => {
      const view = views.get(v.id);
      if (!view) return [];
      const body = videoViewBody(view, v.duration);
      return [
        {
          id: v.id,
          title: v.title,
          secs: Math.round(body.secs),
          pct: body.pct,
          lastAt: view.lastAt ?? view.doneAt,
          status: body.status,
        },
      ];
    })
    .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));

  const outbox = await tx
    .select({
      id: telegramOutbox.id,
      at: sql<Date>`coalesce(${telegramOutbox.sentAt}, ${telegramOutbox.createdAt})`.mapWith(
        telegramOutbox.createdAt,
      ),
      kind: telegramOutbox.kind,
      status: telegramOutbox.status,
      error: telegramOutbox.lastError,
    })
    .from(telegramOutbox)
    .where(eq(telegramOutbox.userId, input.userId))
    .orderBy(desc(telegramOutbox.createdAt), desc(telegramOutbox.id))
    .limit(ADMIN_CARD_ROWS);
  const [{ n: outboxCount } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(telegramOutbox)
    .where(eq(telegramOutbox.userId, input.userId));

  const history = await tx
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actorName: actor.shortName,
      // Автор без сотрудника в организации — администратор платформы (его учётную запись в
      // контексте организации не видно).
      actorAdmin: sql<boolean>`${auditLog.actorUserId} is not null and ${actor.id} is null`,
      entity: auditLog.entity,
      action: auditLog.action,
      changes: auditLog.changes,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.userId, auditLog.actorUserId))
    .where(
      or(
        and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, input.userId)),
        and(eq(auditLog.entity, 'employee'), eq(auditLog.entityId, e.id)),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(ADMIN_CARD_ROWS);

  return {
    user,
    employee: {
      id: e.id,
      shortName: e.shortName,
      phone: e.phone,
      isOwner: e.isOwner,
      mustChangePassword: e.mustChangePassword,
      loginFailures: e.loginFailures,
      loginLocked: e.loginLockedAt !== null,
      createdAt: e.createdAt,
      role: role ? { name: role.name, permissions: role.permissions, scopes: role.scopes } : null,
      telegram: tg ?? null,
    },
    work: {
      contractors: cardList(cps),
      due: cardList(due),
      inWork: cardList(inWork),
      overdue: cardList(overdue),
      done: cardList(done),
      tasks: cardList(openTasks),
      kpi: cardList(kpi),
      kpiMonth,
    },
    kb: {
      progress: progress ?? null,
      articles: cardList(articles),
      videos: cardList(videos),
    },
    telegram: { count: outboxCount, rows: outbox.map((o) => ({ ...o, id: String(o.id) })) },
    history: history.map(historyRow),
  };
}

/**
 * «Завершить все сеансы» (прототип accCard, `#ac-end`): пользователь выходит на всех устройствах,
 * запись — в историю учётной записи в той же транзакции (`withOrgContext` его организации от имени
 * администратора платформы). Возвращает, сколько сеансов ещё действовало.
 */
export async function adminEndUserSessions(tx: Tx, userId: string): Promise<number> {
  const ended = await endUserSessions(tx, userId, 'admin');
  await writeHistory(tx, {
    entity: 'user',
    entityId: userId,
    action: 'sessions_end',
    reason: `Завершены все сеансы администратором платформы: ${ended}`,
  });
  return ended;
}

/** Сколько минут повторное чтение уже открытой карточки не считается новым открытием. */
export const CARD_REFRESH_MINUTES = 30;

/**
 * Открытие карточки пользователя организации — в историю его учётной записи. `refresh` — карточка
 * уже открыта и перечитывается (после действия, при возврате на вкладку браузера): новой записи нет,
 * только если этот же администратор открывал её не раньше `CARD_REFRESH_MINUTES` минут назад — без
 * записи об открытии карточку не прочитать.
 */
export async function logUserCardView(tx: Tx, userId: string, refresh = false): Promise<void> {
  if (refresh) {
    const [seen] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'user'),
          eq(auditLog.entityId, userId),
          eq(auditLog.action, 'card_view'),
          sql`${auditLog.actorUserId} = app.current_user_id()`,
          sql`${auditLog.at} > now() - make_interval(mins => ${CARD_REFRESH_MINUTES})`,
        ),
      )
      .limit(1);
    if (seen) return;
  }
  await writeHistory(tx, {
    entity: 'user',
    entityId: userId,
    action: 'card_view',
    reason: 'Открыта карточка пользователя',
  });
}

/** Открытие карточки администратора платформы — в историю платформы (`refresh` — как выше). */
export async function logAdminCardView(tx: Tx, userId: string, refresh = false): Promise<void> {
  if (refresh) {
    const [seen] = await tx
      .select({ id: platformAuditLog.id })
      .from(platformAuditLog)
      .where(
        and(
          eq(platformAuditLog.entity, 'user'),
          eq(platformAuditLog.entityId, userId),
          eq(platformAuditLog.action, 'card_view'),
          sql`${platformAuditLog.actorUserId} = app.current_user_id()`,
          sql`${platformAuditLog.at} > now() - make_interval(mins => ${CARD_REFRESH_MINUTES})`,
        ),
      )
      .limit(1);
    if (seen) return;
  }
  await writePlatformHistory(tx, {
    entity: 'user',
    entityId: userId,
    action: 'card_view',
    reason: 'Открыта карточка пользователя',
  });
}
