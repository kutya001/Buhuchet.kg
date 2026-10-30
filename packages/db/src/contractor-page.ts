import {
  PAGE_CODE_TRIES,
  PAGE_IP_LOCK_MINUTES,
  PAGE_IP_MAX_FAILURES,
  PAGE_IP_WINDOW_MINUTES,
  PAGE_LOCK_MINUTES,
  PAGE_MAX_GRANTS,
  PAGE_OPEN_REPEAT_MINUTES,
  PAGE_REMEMBER_DAYS,
  type HistoryAction,
  type HistoryChange,
  type PageSection,
} from '@buhuchet/domain';
import { and, desc, eq, gt, gte, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import { featureSet } from './org';
import {
  auditLog,
  contractorPages,
  contractors,
  orgSettings,
  organizations,
  taxRegimes,
} from './schema';

/*
 * Страница контрагента по ссылке (задача 2.42, docs/decisions.md п. Е-1): блок «Страница контрагента»
 * карточки — в контексте организации (RLS), страница без входа — только функциями базы
 * app.contractor_page_* (миграция guards): они находят страницу по адресу организации и ИНН, сверяют
 * код и ведут счёт неверных кодов. Код из базы на страницу без входа не попадает никогда.
 */

/** Страница контрагента в карточке. */
export interface ContractorPageRecord {
  contractorId: string;
  enabled: boolean;
  code: string;
  hiddenSections: PageSection[];
  /** Ввод кода по ссылке закрыт до этого момента после неверных кодов подряд. */
  lockedUntil: Date | null;
  version: number;
  /** Последнее открытие контрагентом и с какого устройства (из истории). */
  lastOpenAt: Date | null;
  lastDevice: string | null;
}

const asDate = (value: Date | string | null | undefined): Date | null =>
  value == null ? null : new Date(value);

/**
 * Что нужно блоку о своей организации: адрес страницы организации, разделы страниц из учётной
 * политики и функции (раздел с функцией виден только при включённой функции).
 */
export async function contractorPageOrg(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({
      slug: organizations.slug,
      pageSections: orgSettings.pageSections,
      features: orgSettings.features,
    })
    .from(organizations)
    .innerJoin(orgSettings, eq(orgSettings.orgId, organizations.id))
    .where(eq(organizations.id, orgId));
  if (!row) return null;
  return {
    slug: row.slug,
    pageSections: row.pageSections as PageSection[],
    features: featureSet(row.features),
  };
}

const pageHistoryOf = (contractorId: string, action: HistoryAction) =>
  and(
    eq(auditLog.contractorId, contractorId),
    eq(auditLog.entity, 'contractor_page'),
    eq(auditLog.action, action),
  );

const deviceOf = (changes: readonly HistoryChange[] | undefined): string | null => {
  const device = changes?.find((c) => c.field === 'device')?.to;
  return typeof device === 'string' ? device : null;
};

/** Страница контрагента или null, если её ни разу не включали. */
export async function getContractorPage(
  tx: Tx,
  contractorId: string,
): Promise<ContractorPageRecord | null> {
  const [row] = await tx
    .select({
      contractorId: contractorPages.contractorId,
      enabled: contractorPages.enabled,
      code: contractorPages.code,
      hiddenSections: contractorPages.hiddenSections,
      lockedUntil: contractorPages.lockedUntil,
      version: contractorPages.version,
    })
    .from(contractorPages)
    .where(eq(contractorPages.contractorId, contractorId));
  if (!row) return null;
  // «Последнее открытие» — после последнего «Включить»: прежние открытия были по старому коду
  // (прототип pgEnable: `last: null`).
  const [open] = await tx
    .select({ at: auditLog.at, changes: auditLog.changes })
    .from(auditLog)
    .where(
      and(
        pageHistoryOf(contractorId, 'page_open'),
        gte(
          auditLog.at,
          sql`coalesce((select max(a.at) from audit_log a where a.contractor_id = ${contractorId} and a.entity = 'contractor_page' and a.action = 'page_on'), '-infinity'::timestamptz)`,
        ),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  const device = deviceOf(open?.changes);
  return {
    ...row,
    hiddenSections: row.hiddenSections as PageSection[],
    lastOpenAt: open?.at ?? null,
    lastDevice: device,
  };
}

/** Запись истории страницы — в истории контрагента. */
export async function writeContractorPageHistory(
  tx: Tx,
  contractorId: string,
  action: Extract<HistoryAction, `page_${string}`>,
  options: { changes?: HistoryChange[]; reason?: string | null } = {},
): Promise<void> {
  await writeHistory(tx, {
    entity: 'contractor_page',
    entityId: contractorId,
    action,
    contractorId,
    changes: options.changes,
    reason: options.reason,
  });
}

/**
 * Открытие страницы контрагентом — в историю контрагента с устройством (ТЗ «каждое открытие страницы
 * (дата, время, устройство) пишутся в историю контрагента»). Повтор с того же устройства в течение
 * минуты (обновил страницу) — то же открытие: так браузер с кодом не заваливает историю записями.
 */
export async function writeContractorPageOpen(
  tx: Tx,
  contractorId: string,
  device: string,
): Promise<void> {
  const [last] = await tx
    .select({ changes: auditLog.changes })
    .from(auditLog)
    .where(
      and(
        pageHistoryOf(contractorId, 'page_open'),
        gt(auditLog.at, sql`now() - make_interval(mins => ${PAGE_OPEN_REPEAT_MINUTES})`),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  if (last && deviceOf(last.changes) === device) return;
  await writeContractorPageHistory(tx, contractorId, 'page_open', {
    changes: [{ field: 'device', to: device }],
  });
}

/** Новый код и сброс счёта неверных кодов: при повторном включении и «Сменить код». */
const freshCode = (code: string) => ({
  code,
  codeVersion: sql`${contractorPages.codeVersion} + 1`,
  failures: 0,
  lockedUntil: null,
  version: sql`${contractorPages.version} + 1`,
  updatedBy: sql`app.current_user_id()`,
  updatedAt: sql`now()`,
});

/**
 * «Включить» (прототип pgEnable): страница с новым кодом; выключенная раньше включается снова с новым
 * номером кода, разделы, скрытые у контрагента, остаются. Уже включённая — `already`, ничего не
 * меняется. Контрагента и право проверяет вызывающий.
 */
export async function enableContractorPage(
  tx: Tx,
  contractorId: string,
  code: string,
): Promise<'enabled' | 'already'> {
  const [existing] = await tx
    .select({ enabled: contractorPages.enabled })
    .from(contractorPages)
    .where(eq(contractorPages.contractorId, contractorId))
    .for('update');
  if (existing?.enabled) return 'already';
  if (existing) {
    await tx
      .update(contractorPages)
      .set({ ...freshCode(code), enabled: true })
      .where(eq(contractorPages.contractorId, contractorId));
  } else {
    await tx.insert(contractorPages).values({
      contractorId,
      orgId: sql`app.current_org_id()`,
      code,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    });
  }
  await writeContractorPageHistory(tx, contractorId, 'page_on');
  return 'enabled';
}

/**
 * «Включить страницу» у выбранных контрагентов (ТЗ «Массово: выбрать контрагентов в списке…»): у
 * каждого свой код; вне области сотрудника, в архиве и уже включённые пропускаются. Строки — одним
 * запросом и в одном порядке, чтобы одновременные включения не вставали друг другу поперёк.
 */
export async function enableContractorPages(
  tx: Tx,
  ids: readonly string[],
  scope: SQL | undefined,
  newCode: () => string,
): Promise<number> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return 0;
  const live = await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(and(inArray(contractors.id, wanted), ne(contractors.serviceStatus, 'archived'), scope))
    .orderBy(contractors.id);
  if (live.length === 0) return 0;
  const liveIds = live.map((r) => r.id);
  const existing = await tx
    .select({ id: contractorPages.contractorId, enabled: contractorPages.enabled })
    .from(contractorPages)
    .where(inArray(contractorPages.contractorId, liveIds))
    .orderBy(contractorPages.contractorId)
    .for('update');
  const known = new Map(existing.map((r) => [r.id, r.enabled]));
  const fresh = liveIds.filter((id) => !known.has(id));
  const again = existing.filter((r) => !r.enabled).map((r) => r.id);
  if (fresh.length) {
    await tx.insert(contractorPages).values(
      fresh.map((contractorId) => ({
        contractorId,
        orgId: sql`app.current_org_id()`,
        code: newCode(),
        createdBy: sql`app.current_user_id()`,
        updatedBy: sql`app.current_user_id()`,
      })),
    );
  }
  for (const contractorId of again) {
    await tx
      .update(contractorPages)
      .set({ ...freshCode(newCode()), enabled: true })
      .where(eq(contractorPages.contractorId, contractorId));
  }
  const done = [...fresh, ...again];
  await writeHistory(
    tx,
    ...done.map((contractorId) => ({
      entity: 'contractor_page' as const,
      entityId: contractorId,
      action: 'page_on' as const,
      contractorId,
    })),
  );
  return done.length;
}

/**
 * «Выключить» (прототип pgOff): ссылка перестаёт открываться. Причина — например, «контрагент в
 * архиве» (задача 2.12 выключает страницу при отправке в архив). Выключенная — false.
 */
export async function disableContractorPage(
  tx: Tx,
  contractorId: string,
  reason: string | null = null,
): Promise<boolean> {
  const done = await tx
    .update(contractorPages)
    .set({
      enabled: false,
      version: sql`${contractorPages.version} + 1`,
      updatedBy: sql`app.current_user_id()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(contractorPages.contractorId, contractorId), eq(contractorPages.enabled, true)))
    .returning({ id: contractorPages.contractorId });
  if (!done.length) return false;
  await writeContractorPageHistory(tx, contractorId, 'page_off', { reason });
  return true;
}

/**
 * «Сменить код» (прототип pgCodeDlg): старый код перестаёт действовать сразу, в том числе в браузерах,
 * где он запомнен (номер кода +1). Сам код в историю не пишется. Выключенная страница — false.
 */
export async function changeContractorPageCode(
  tx: Tx,
  contractorId: string,
  code: string,
): Promise<boolean> {
  const done = await tx
    .update(contractorPages)
    .set(freshCode(code))
    .where(and(eq(contractorPages.contractorId, contractorId), eq(contractorPages.enabled, true)))
    .returning({ id: contractorPages.contractorId });
  if (!done.length) return false;
  await writeContractorPageHistory(tx, contractorId, 'page_code');
  return true;
}

/** Разделы, скрытые у контрагента (прототип pgMount, `data-pg-sec`): с версией, «было → стало». */
export async function setContractorPageHidden(
  tx: Tx,
  contractorId: string,
  hidden: readonly PageSection[],
  version: number,
): Promise<void> {
  await updateWithHistory(tx, {
    table: contractorPages,
    entity: 'contractor_page',
    key: contractorPages.contractorId,
    id: contractorId,
    version,
    patch: { hiddenSections: [...hidden] },
    contractorId,
  });
}

/** Что показать на странице без входа (`app.contractor_page_state`). */
export type ContractorPageState =
  | { state: 'unavailable' }
  | { state: 'code' }
  | { state: 'locked'; lockedUntil: Date }
  | { state: 'open'; orgId: string; contractorId: string };

/**
 * Страница по ссылке: недоступна, ввод кода, ввод закрыт или открыта (браузер с запомненным кодом —
 * `tokenHash` из cookie страницы). Вызывается без контекста организации.
 */
export async function contractorPageState(
  db: Db,
  slug: string,
  inn: string,
  tokenHash: string | null,
): Promise<ContractorPageState> {
  const [row] = await db.execute<{
    state: string;
    org_id: string | null;
    contractor_id: string | null;
    locked_until: Date | string | null;
  }>(sql`select * from app.contractor_page_state(${slug}, ${inn}, ${tokenHash})`);
  if (row?.state === 'open' && row.org_id && row.contractor_id) {
    return { state: 'open', orgId: row.org_id, contractorId: row.contractor_id };
  }
  if (row?.state === 'locked' && row.locked_until) {
    return { state: 'locked', lockedUntil: new Date(row.locked_until) };
  }
  return row?.state === 'code' ? { state: 'code' } : { state: 'unavailable' };
}

/** Итог ввода кода на странице без входа (`app.contractor_page_try_code`). */
export type ContractorPageTry =
  | { outcome: 'unavailable' }
  | { outcome: 'ok' }
  | { outcome: 'wrong'; triesLeft: number }
  | { outcome: 'locked'; lockedUntil: Date }
  | { outcome: 'ip_locked'; lockedUntil: Date };

/**
 * Проверить код страницы: пределы — 5 неверных подряд по ссылке (15 минут; запись в истории
 * контрагента — в той же транзакции) и 3 неверных за час с адреса (час); `triesLeft` — меньший из
 * двух остатков, по ссылке и по адресу (docs/deviations.md п. О-1); верный код запоминает браузер
 * на 30 дней (`tokenHash` — хеш токена новой cookie). Адрес приходит хешем (`ipHash`).
 * Вызывается без контекста организации.
 */
export async function tryContractorPageCode(
  db: Db,
  input: { slug: string; inn: string; code: string; ipHash: string; tokenHash: string },
): Promise<ContractorPageTry> {
  const [row] = await db.execute<{
    outcome: string;
    tries_left: number | null;
    locked_until: Date | string | null;
  }>(
    sql`select * from app.contractor_page_try_code(${input.slug}, ${input.inn}, ${input.code}, ${input.ipHash}, ${input.tokenHash}, ${PAGE_CODE_TRIES}, ${PAGE_LOCK_MINUTES}, ${PAGE_IP_MAX_FAILURES}, ${PAGE_IP_WINDOW_MINUTES}, ${PAGE_IP_LOCK_MINUTES}, ${PAGE_REMEMBER_DAYS}, ${PAGE_MAX_GRANTS})`,
  );
  const until = asDate(row?.locked_until);
  switch (row?.outcome) {
    case 'ok':
      return { outcome: 'ok' };
    case 'wrong':
      return { outcome: 'wrong', triesLeft: row.tries_left ?? 0 };
    case 'locked':
      return { outcome: 'locked', lockedUntil: until! };
    case 'ip_locked':
      return { outcome: 'ip_locked', lockedUntil: until! };
    default:
      return { outcome: 'unavailable' };
  }
}

/** Удалить запомненные браузеры с истёкшим сроком или старым кодом (задача по расписанию). */
export async function cleanupContractorPageGrants(db: Db): Promise<number> {
  const [row] = await db.execute<{ removed: number }>(
    sql`select app.contractor_page_grants_cleanup() as removed`,
  );
  return row?.removed ?? 0;
}

/**
 * Шапка открытой страницы (ТЗ «Шапка: название и ИНН контрагента, режим налогообложения, логотип и
 * название нашей организации»); остальное содержимое страницы — задача 2.43. Только в контексте
 * организации страницы.
 */
export async function contractorPageHeader(tx: Tx, contractorId: string) {
  const [row] = await tx
    .select({
      name: contractors.name,
      inn: contractors.inn,
      regime: taxRegimes.fullName,
      orgName: organizations.name,
      orgLogoKey: organizations.logoKey,
    })
    .from(contractors)
    .innerJoin(organizations, eq(organizations.id, contractors.orgId))
    .leftJoin(taxRegimes, eq(taxRegimes.code, contractors.regimeCode))
    .where(eq(contractors.id, contractorId));
  return row ?? null;
}
