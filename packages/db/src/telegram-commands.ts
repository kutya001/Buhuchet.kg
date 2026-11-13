import {
  OPEN_REPORT_STATUSES,
  type IsoDate,
  type ReportAct,
  type ReportPeriod,
  type ReportStatus,
} from '@buhuchet/domain';
import { and, asc, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { contractors, employees, reports, reportTypes } from './schema';

/*
 * Меню команд бота (поток Т, задача Т5; миграции 0128–0129, прототип v102 modules/tg-menu.js): «Сегодня»,
 * «Неделя», «Просрочено», «Найти контрагента». Команда приходит сообщением в чат — вебхук работает без
 * входа: учётные записи чата находит `botChatUsers` (функция SECURITY DEFINER), а данные читаются уже
 * от имени сотрудника в его организации (RLS) и в его области «Свои / Все контрагенты» — условие
 * области всегда передаётся явно (`undefined` — вся организация).
 */

const OPEN = sql.raw(`(${[...OPEN_REPORT_STATUSES].map((s) => `'${s}'`).join(', ')})`);
const NATURAL = sql.raw('app.ru_natural');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Учётная запись, к которой привязан чат, и её состояние — для отказов бота. */
export interface BotChatUser {
  userId: string;
  orgId: string | null;
  employeeId: string | null;
  login: string;
  orgName: string | null;
  /** Пароль сброшен (временный): на сайте доступна только смена пароля, бот не отвечает. */
  mustChangePassword: boolean;
  /** После сброса пароля разрешено привязать другой Telegram без кода — бот не отвечает. */
  relinkFree: boolean;
  isPlatformAdmin: boolean;
  userBlocked: boolean;
  employeeActive: boolean | null;
  orgStatus: 'active' | 'blocked' | null;
}

/**
 * Учётные записи, к которым привязан чат (один Telegram может быть привязан к нескольким), по порядку
 * привязки. Пусто — чат не привязан.
 */
export async function botChatUsers(db: Db | Tx, chatId: number): Promise<BotChatUser[]> {
  const rows = await db.execute<{
    user_id: string;
    org_id: string | null;
    employee_id: string | null;
    login: string;
    org_name: string | null;
    must_change_password: boolean;
    relink_free: boolean;
    is_platform_admin: boolean;
    user_blocked: boolean;
    employee_active: boolean | null;
    org_status: 'active' | 'blocked' | null;
  }>(sql`select * from app.telegram_chat_users(${chatId}::bigint)`);
  return [...rows].map((r) => ({
    userId: r.user_id,
    orgId: r.org_id,
    employeeId: r.employee_id,
    login: r.login,
    orgName: r.org_name,
    mustChangePassword: r.must_change_password,
    relinkFree: r.relink_free,
    isPlatformAdmin: r.is_platform_admin,
    userBlocked: r.user_blocked,
    employeeActive: r.employee_active,
    orgStatus: r.org_status,
  }));
}

/** Отчёт для ответа на команду. */
export interface CommandReportRow {
  id: string;
  contractorId: string;
  contractorName: string;
  typeShort: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate: IsoDate | null;
  eventLabel: string;
  act: ReportAct;
  status: ReportStatus;
  dueDate: IsoDate;
  payDue: IsoDate | null;
  amount: number | null;
  paid: number;
}

const REPORT_COLUMNS = {
  id: reports.id,
  contractorId: reports.contractorId,
  contractorName: contractors.name,
  typeShort: reportTypes.shortName,
  period: reports.period,
  periodStart: reports.periodStart,
  eventDate: reports.eventDate,
  eventLabel: reportTypes.eventLabel,
  act: reports.act,
  status: reports.status,
  dueDate: reports.dueDate,
  payDue: reports.payDue,
  amount: reports.amount,
  paid: reports.paid,
};

/**
 * Несданные отчёты и неоплаченные налоги со сроком не позже `horizon` (и просроченные) в области
 * `scope` (`reportScope`): действующие версии, без «Не требуется», контрагенты не в архиве. Что из этого
 * «к сдаче», а что «к оплате», решает вызывающий — тем же правилом, что напоминания.
 */
export function commandReports(
  tx: Tx,
  o: { scope: SQL | undefined; horizon: IsoDate },
): Promise<CommandReportRow[]> {
  return tx
    .select(REPORT_COLUMNS)
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(
      and(
        eq(reports.superseded, false),
        ne(reports.status, 'not_required'),
        ne(contractors.serviceStatus, 'archived'),
        or(
          sql`(${reports.status} in ${OPEN} and ${reports.act} <> 'pay' and ${reports.dueDate} <= ${o.horizon}::date)`,
          sql`(${reports.act} <> 'sub' and ${reports.payDue} <= ${o.horizon}::date and ${reports.amount} > ${reports.paid})`,
        ),
        o.scope,
      ),
    );
}

/**
 * Отчёты контрагента для его карточки в чате (прототип `tgCpMsg`): действующие версии, кроме «Уплаты», —
 * просроченные несданные и все со сроком сдачи в месяце дня `today`; в области `scope` (`reportScope`).
 */
export function commandCardReports(
  tx: Tx,
  o: { contractorId: string; scope: SQL | undefined; today: IsoDate },
): Promise<CommandReportRow[]> {
  return tx
    .select(REPORT_COLUMNS)
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(
      and(
        eq(reports.contractorId, o.contractorId),
        eq(reports.superseded, false),
        ne(reports.act, 'pay'),
        ne(contractors.serviceStatus, 'archived'),
        or(
          sql`(${reports.status} in ${OPEN} and ${reports.dueDate} < ${o.today}::date)`,
          sql`date_trunc('month', ${reports.dueDate}) = date_trunc('month', ${o.today}::date)`,
        ),
        o.scope,
      ),
    );
}

/** Название контрагента для поиска: без регистра, «ё» как «е», пробелы подряд — один (`botFindQuery`). */
const FIND_NAME = sql`btrim(regexp_replace(replace(lower(${contractors.name} collate ${NATURAL}), 'ё', 'е'), '\\s+', ' ', 'g'))`;

/**
 * Поиск контрагента по части названия или (запрос из цифр) по началу ИНН — в области `scope`
 * (`contractorScope`), без архивных. Запрос уже приведён правилом `botFindQuery`. Отдаёт первые `limit`
 * по названию и сколько найдено всего.
 */
export async function findCommandContractors(
  tx: Tx,
  o: { scope: SQL | undefined; query: string; byInn: boolean; limit: number },
): Promise<{ total: number; rows: { id: string; name: string }[] }> {
  const rows = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      total: sql<number>`(count(*) over ())::int`,
    })
    .from(contractors)
    .where(
      and(
        ne(contractors.serviceStatus, 'archived'),
        or(
          sql`position(${o.query} in ${FIND_NAME}) > 0`,
          o.byInn ? sql`starts_with(${contractors.inn}, ${o.query})` : undefined,
        ),
        o.scope,
      ),
    )
    .orderBy(sql`${contractors.name} collate ${NATURAL}`, asc(contractors.id))
    .limit(o.limit);
  return { total: rows[0]?.total ?? 0, rows: rows.map(({ id, name }) => ({ id, name })) };
}

/** Контрагент для карточки в чате. */
export interface CommandContractor {
  id: string;
  name: string;
  oneOff: boolean;
  startDate: IsoDate;
  paused: boolean;
  /** Краткое имя ответственного; null — не назначен. */
  responsibleName: string | null;
}

/** Контрагент по id в области `scope` (`contractorScope`), не в архиве; null — нет такого или не виден. */
export async function commandContractor(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<CommandContractor | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      kind: contractors.kind,
      startDate: contractors.startDate,
      serviceStatus: contractors.serviceStatus,
      responsibleName: employees.shortName,
    })
    .from(contractors)
    .leftJoin(employees, eq(employees.id, contractors.responsibleEmployeeId))
    .where(and(eq(contractors.id, id), ne(contractors.serviceStatus, 'archived'), scope));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    oneOff: row.kind === 'oneoff',
    startDate: row.startDate,
    paused: row.serviceStatus === 'paused',
    responsibleName: row.responsibleName,
  };
}
