import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import type { DmTemplateColumn, DmTemplateParam } from './datamart-output';

/*
 * Внешний адрес «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 6; блок 8, пункт 6; поток Т,
 * этап 2, П11; миграция 0172, docs/decisions.md п. Т-20). Запрос приходит без входа: найти токен по
 * хешу, счёт неизвестных токенов с адреса и пределы токена — функции SECURITY DEFINER
 * (`app.dm_ext_target`, `app.dm_ext_take`), они зовутся на `db`, вне транзакции модуля: каждая держит
 * блокировку своего субъекта до конца своей транзакции. Состояние токена (`dmTokenFacts`), шаблон и его
 * текст (`dmOutputTemplate`, `dmTemplateQuery`), запуск и строка журнала (`logDmRequest`) — уже в
 * контексте токена (его организация и кто создал).
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
      /** Шаблон токена и его код: другой код в адресе — «Токен не подходит или истёк». */
      templateId: string;
      templateCode: string;
    };

/**
 * Найти токен по хешу SHA-256 (hex); `ip` — SHA-256 адреса с приставкой (`clientIpSubject`). Предел
 * адреса — `badMax` неизвестных токенов за `badWindowSeconds`.
 */
export async function dmExtTarget(
  db: Db,
  q: { tokenHash: string; ip: string; badMax: number; badWindowSeconds: number },
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
    ${q.badWindowSeconds}::integer)`);
  if (!row || row.outcome === 'unknown') return { outcome: 'unknown' };
  if (row.outcome === 'ip_wait') return { outcome: 'ip_wait', waitSeconds: row.wait_seconds ?? 1 };
  return {
    outcome: 'ok',
    tokenId: row.token_id!,
    orgId: row.org_id,
    createdBy: row.created_by!,
    templateId: row.template_id!,
    templateCode: row.template_code!,
  };
}

/** Пределы токена (блок 6, пункт 4): одновременно один, за минуту и за сутки. */
export interface DmExtLimits {
  perMinute: number;
  perDay: number;
  leaseSeconds: number;
}

export type DmExtTake =
  { ok: true; ticket: number } | { ok: false; reason: 'busy' | 'limited'; waitSeconds: number };

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
