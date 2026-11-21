import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

/*
 * Внешний адрес «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 6; блок 8, пункт 6; поток Т,
 * этап 2, П11; миграция 0171, docs/decisions.md п. Т-20). Запрос приходит без входа: найти токен по
 * хешу, счёт неизвестных токенов с адреса и пределы токена — функции SECURITY DEFINER
 * (`app.dm_ext_target`, `app.dm_ext_take`), они зовутся на `db`, вне транзакции модуля: каждая держит
 * блокировку своего субъекта до конца своей транзакции. Состояние токена (`dmTokenFacts`), запуск
 * шаблона и строка журнала — уже в контексте токена (его организация и кто создал).
 */

/** Что знает база о токене из заголовка. */
export type DmExtTarget =
  /** Адрес прислал слишком много неизвестных токенов — ждёт `waitSeconds`. */
  | { outcome: 'ip_wait'; waitSeconds: number }
  /** Такого токена нет (строка счёта адреса уже записана). */
  | { outcome: 'unknown' }
  | {
      outcome: 'ok';
      tokenId: string;
      /** null — токен Админки. */
      orgId: string | null;
      createdBy: string;
      templateId: string;
      templateCode: string;
      /** Модуль шаблона и его дополнительное право (`dmTemplateSeen`: функции организации). */
      module: string | null;
      needPermission: string | null;
      /**
       * Запрос, параметры и столбцы шаблона — только если код в адресе совпал с шаблоном токена
       * (иначе null: «Токен не подходит или истёк»).
       */
      template: { query: string | null; params: unknown; columns: unknown } | null;
    };

/**
 * Найти токен по хешу SHA-256 (hex) для шаблона `code`; `ip` — SHA-256 адреса с приставкой
 * (`clientIpSubject`). Предел адреса — `badMax` неизвестных токенов за `badWindowSeconds`.
 */
export async function dmExtTarget(
  db: Db,
  q: { tokenHash: string; code: string; ip: string; badMax: number; badWindowSeconds: number },
): Promise<DmExtTarget> {
  const [row] = await db.execute<{
    outcome: string;
    wait_seconds: number | null;
    token_id: string | null;
    org_id: string | null;
    created_by: string | null;
    template_id: string | null;
    template_code: string | null;
    module: string | null;
    need_permission: string | null;
    query: string | null;
    params: unknown;
    columns: unknown;
  }>(sql`select * from app.dm_ext_target(${q.tokenHash}, ${q.code}, ${q.ip},
    ${q.badMax}::integer, ${q.badWindowSeconds}::integer)`);
  if (!row || row.outcome === 'unknown') return { outcome: 'unknown' };
  if (row.outcome === 'ip_wait') return { outcome: 'ip_wait', waitSeconds: row.wait_seconds ?? 1 };
  const same = row.template_code === q.code;
  return {
    outcome: 'ok',
    tokenId: row.token_id!,
    orgId: row.org_id,
    createdBy: row.created_by!,
    templateId: row.template_id!,
    templateCode: row.template_code!,
    module: row.module,
    needPermission: row.need_permission,
    template: same ? { query: row.query, params: row.params, columns: row.columns } : null,
  };
}

/** Пределы токена (блок 6, пункт 4): одновременно один, за минуту и за сутки. */
export interface DmExtLimits {
  perMinute: number;
  perDay: number;
  leaseSeconds: number;
}

export type DmExtTake =
  | { ok: true; ticket: number }
  | { ok: false; reason: 'busy' | 'limited'; waitSeconds: number };

/** Занять запрос токена; после запроса — `releaseDmExt`, иначе следующий ждёт `leaseSeconds`. */
export async function takeDmExt(db: Db, tokenId: string, l: DmExtLimits): Promise<DmExtTake> {
  const [row] = await db.execute<{
    outcome: string;
    ticket: number | string | null;
    wait_seconds: number | null;
  }>(sql`select * from app.dm_ext_take(${tokenId}::uuid, ${l.perMinute}::integer,
    ${l.perDay}::integer, ${l.leaseSeconds}::integer)`);
  if (row?.outcome === 'ok' && row.ticket !== null) return { ok: true, ticket: Number(row.ticket) };
  return {
    ok: false,
    reason: row?.outcome === 'busy' ? 'busy' : 'limited',
    waitSeconds: Math.max(1, row?.wait_seconds ?? 1),
  };
}

/** Запрос токена закончился: можно следующий (в счёте за минуту и сутки он остаётся). */
export async function releaseDmExt(db: Db, tokenId: string, ticket: number): Promise<void> {
  await db.execute(sql`select app.rate_limit_release(${ticket}, 'dm_ext', ${tokenId})`);
}

/** Строка журнала запросов (`dm_requests`) — общая функция «Вывода» и внешнего адреса. */
export interface DmRequestLogEntry {
  via: 'screen' | 'api';
  templateId: string | null;
  tokenId: string | null;
  /** Значения параметров запроса по кодам (`{ month: '2026-11' }`). */
  params: Record<string, string | null>;
  rows: number | null;
  ms: number | null;
  outcome: string;
  error: string | null;
  /** Адрес программы (первый X-Forwarded-For), до 64 знаков. */
  ip: string | null;
}

/**
 * Записать запрос в журнал в контексте токена (организация и кто создал) или сотрудника: функция
 * `app.dm_request_log` ставит и «Последний запрос» токена. Номер строки журнала.
 */
export async function dmRequestLog(tx: Tx, e: DmRequestLogEntry): Promise<number> {
  const [row] = await tx.execute<{ id: number | string }>(sql`
    select app.dm_request_log(${e.via}, ${e.templateId}::uuid, ${e.tokenId}::uuid,
      ${JSON.stringify(e.params)}::jsonb, ${e.rows}::integer, ${e.ms}::integer, ${e.outcome},
      ${e.error}, ${e.ip}) as id`);
  return Number(row!.id);
}

/** Удалить строки журнала запросов старше `days` дней (задача «Очистка журналов»). */
export async function cleanupDmRequests(db: Db, days: number): Promise<number> {
  const [row] = await db.execute<{ removed: number }>(
    sql`select app.dm_requests_cleanup(${days}::integer) as removed`,
  );
  return row?.removed ?? 0;
}
