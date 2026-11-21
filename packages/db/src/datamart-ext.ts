import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import type { DmTemplateColumn, DmTemplateParam } from './datamart-output';

/*
 * Внешний адрес «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 6; блок 8, пункт 6; поток Т,
 * этап 2, П11; миграция 0174, docs/decisions.md п. Т-20). Запрос приходит без входа: найти токен по
 * хешу, счёт неизвестных токенов с адреса, обращения токена, его пределы и запуски платформы — функции
 * SECURITY DEFINER (`app.dm_ext_target`, `app.dm_ext_take`, `app.dm_ext_release`), они зовутся на `db`,
 * вне транзакции модуля: каждая держит блокировку своего субъекта до конца своей транзакции. Состояние токена (`dmTokenFacts`), шаблон и его
 * текст (`dmOutputTemplate`, `dmTemplateQuery`), запуск и строка журнала (`logDmRequest`) — уже в
 * контексте токена (его организация и кто создал).
 */

/** Что знает база о токене из заголовка. */
export type DmExtTarget =
  /** Адрес прислал слишком много неизвестных токенов — ждёт `waitSeconds`. */
  | { outcome: 'ip_wait'; waitSeconds: number }
  /** Такого токена нет (строка счёта адреса уже записана). */
  | { outcome: 'unknown' }
  /** Известный токен обращается слишком часто (и с отказами) — ждёт `waitSeconds`. */
  | { outcome: 'token_wait'; waitSeconds: number }
  | {
      outcome: 'ok';
      tokenId: string;
      /** null — токен Админки. */
      orgId: string | null;
      createdBy: string;
      /** Шаблон токена и его код: другой код в адресе — «Токен не подходит или истёк». */
      templateId: string;
      templateCode: string;
    };

/**
 * Найти токен по хешу SHA-256 (hex); `ip` — SHA-256 адреса с приставкой (`clientIpSubject`). Предел
 * адреса — `badMax` неизвестных токенов за `badWindowSeconds`; известного токена — `tryMax` обращений
 * за `tryWindowSeconds`.
 */
export async function dmExtTarget(
  db: Db,
  q: {
    tokenHash: string;
    ip: string;
    badMax: number;
    badWindowSeconds: number;
    tryMax: number;
    tryWindowSeconds: number;
  },
): Promise<DmExtTarget> {
  const [row] = await db.execute<{
    outcome: string;
    wait_seconds: number | null;
    token_id: string | null;
    org_id: string | null;
    created_by: string | null;
    template_id: string | null;
    template_code: string | null;
  }>(sql`select * from app.dm_ext_target(${q.tokenHash}, ${q.ip}, ${q.badMax}::integer,
    ${q.badWindowSeconds}::integer, ${q.tryMax}::integer, ${q.tryWindowSeconds}::integer)`);
  if (!row || row.outcome === 'unknown') return { outcome: 'unknown' };
  if (row.outcome === 'ip_wait' || row.outcome === 'token_wait') {
    return { outcome: row.outcome, waitSeconds: row.wait_seconds ?? 1 };
  }
  return {
    outcome: 'ok',
    tokenId: row.token_id!,
    orgId: row.org_id,
    createdBy: row.created_by!,
    templateId: row.template_id!,
    templateCode: row.template_code!,
  };
}

/**
 * Пределы токена (блок 6, пункт 4): одновременно один, за минуту и за сутки; запусков по токенам
 * одновременно — `platformRuns` на платформу и `orgRuns` у организации (п. О-62).
 */
export interface DmExtLimits {
  perMinute: number;
  perDay: number;
  leaseSeconds: number;
  orgRuns: number;
  platformRuns: number;
}

/** Занятый запрос: номера строк токена и запуска для `releaseDmExt`. */
export interface DmExtSlot {
  tokenId: string;
  /** null — токен Админки. */
  orgId: string | null;
  ticket: number;
  run: number;
}

export type DmExtTake =
  | { ok: true; slot: DmExtSlot }
  | { ok: false; reason: 'busy' | 'run_busy' | 'limited'; waitSeconds: number };

/** Занять запрос токена; после запроса — `releaseDmExt`, иначе следующий ждёт `leaseSeconds`. */
export async function takeDmExt(
  db: Db,
  token: { tokenId: string; orgId: string | null },
  l: DmExtLimits,
): Promise<DmExtTake> {
  const [row] = await db.execute<{
    outcome: string;
    ticket: number | string | null;
    run_ticket: number | string | null;
    wait_seconds: number | null;
  }>(sql`select * from app.dm_ext_take(${token.tokenId}::uuid, ${token.orgId}::uuid,
    ${l.perMinute}::integer, ${l.perDay}::integer, ${l.leaseSeconds}::integer,
    ${l.orgRuns}::integer, ${l.platformRuns}::integer)`);
  if (row?.outcome === 'ok' && row.ticket !== null && row.run_ticket !== null) {
    return {
      ok: true,
      slot: { ...token, ticket: Number(row.ticket), run: Number(row.run_ticket) },
    };
  }
  const reason = row?.outcome === 'busy' || row?.outcome === 'run_busy' ? row.outcome : 'limited';
  return { ok: false, reason, waitSeconds: Math.max(1, row?.wait_seconds ?? 1) };
}

/** Запрос токена закончился: можно следующий (в счёте за минуту и сутки он остаётся). */
export async function releaseDmExt(db: Db, s: DmExtSlot): Promise<void> {
  await db.execute(sql`select app.dm_ext_release(${s.tokenId}::uuid, ${s.orgId}::uuid,
    ${s.ticket}::bigint, ${s.run}::bigint)`);
}

/** Удалить строки журнала запросов старше `days` дней (задача «Очистка журналов»). */
export async function cleanupDmRequests(db: Db, days: number): Promise<number> {
  const [row] = await db.execute<{ removed: number }>(
    sql`select app.dm_requests_cleanup(${days}::integer) as removed`,
  );
  return row?.removed ?? 0;
}

/** Шаблон токена для «Как подключить» (этап 2, П12): код, параметры и столбцы. */
export interface DmTokenTemplateHow {
  code: string;
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
}

/**
 * Шаблон токена для «Как подключить»: опубликованный или сломанный, видимый в контексте (организации —
 * только «Для организаций» с её доступом, RLS `dm_templates_org_read`; администратору — любой); иначе
 * null. Текста запроса здесь нет.
 */
export async function dmTokenTemplateHow(
  tx: Tx,
  templateId: string,
): Promise<DmTokenTemplateHow | null> {
  const [row] = await tx.execute<{
    code: string;
    params: DmTemplateParam[];
    columns: DmTemplateColumn[];
  }>(sql`
    select code, params, columns from public.dm_templates
    where id = ${templateId}::uuid and state in ('published', 'broken')`);
  return row ? { code: row.code, params: row.params, columns: row.columns } : null;
}
