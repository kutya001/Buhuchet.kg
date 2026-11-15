import {
  pageVisibleSections,
  type HistoryChange,
  type PageCodeVia,
  type PageSection,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { writeContractorPageHistory } from './contractor-page';
import { featureSet } from './org';
import {
  contractorPages,
  contractorTelegramLinks,
  contractors,
  orgSettings,
  organizations,
} from './schema';

/*
 * Код страницы контрагента в Telegram (доработки 14.11.2026, блок 6, этап 3, поток К; прототип v116
 * modules/cp-paid.js `pubForgot`, `pgCodeCmd`, `pgCodeSend`): «Забыли код? Прислать в Telegram» на
 * странице и команда бота «Код от страницы». Код уходит только в Telegram, подключённый к этому
 * контрагенту, пока раздел «Telegram» страницы действует; сам код читает транзакция организации, в
 * ответ странице и в журнал отправок он не попадает.
 */

/**
 * Чья страница по ссылке, пока код не введён (`app.contractor_page_target`, миграция 0154): организация,
 * контрагент и закрыта ли страница после неверных кодов. Выключенная, неизвестная, архивная, у
 * заблокированной организации или без функции «Страница контрагента» — null. Без контекста организации.
 */
export async function contractorPageTarget(
  db: Db,
  slug: string,
  inn: string,
): Promise<{ orgId: string; contractorId: string; closed: boolean } | null> {
  const [row] = await db.execute<{ org_id: string; contractor_id: string; closed: boolean }>(
    sql`select * from app.contractor_page_target(${slug}, ${inn})`,
  );
  return row ? { orgId: row.org_id, contractorId: row.contractor_id, closed: row.closed } : null;
}

/** Что нужно, чтобы прислать код: страница, её адрес и подключённые Telegram. */
export interface PageCodeTarget {
  contractor: string;
  slug: string;
  inn: string;
  code: string;
  /** Закрыта после 5 неверных кодов за сутки: код не присылается (прототип `pgCodeSend`: 'closed'). */
  closed: boolean;
  /** Раздел «Telegram» страницы показан: функция, раздел организации включён и не скрыт у контрагента. */
  tgShown: boolean;
  /** Подключённые Telegram (подключение подтверждено), по порядку запросов. */
  chats: { linkId: string; chatId: number; name: string }[];
}

/**
 * Страница контрагента для кода в Telegram — в контексте его организации (RLS): включена, контрагент
 * не в архиве, организация не заблокирована и функция «Страница контрагента» включена; иначе null
 * (прототип `pgOn`). Закрытая страница приходит с `closed`: ответ — «страница закрыта».
 */
export async function pageCodeTarget(tx: Tx, contractorId: string): Promise<PageCodeTarget | null> {
  const [row] = await tx
    .select({
      contractor: contractors.name,
      inn: contractors.inn,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      slug: organizations.slug,
      orgActive: sql<boolean>`${organizations.status} = 'active'`,
      features: orgSettings.features,
      orgSections: orgSettings.pageSections,
      enabled: contractorPages.enabled,
      code: contractorPages.code,
      closedAt: contractorPages.closedAt,
      hidden: contractorPages.hiddenSections,
    })
    .from(contractorPages)
    .innerJoin(contractors, eq(contractors.id, contractorPages.contractorId))
    .innerJoin(organizations, eq(organizations.id, contractorPages.orgId))
    .innerJoin(orgSettings, eq(orgSettings.orgId, contractorPages.orgId))
    .where(eq(contractorPages.contractorId, contractorId));
  if (!row || !row.enabled || row.archived || !row.orgActive || !row.code) return null;
  const features = featureSet(row.features);
  if (!features.cppage) return null;
  const tgShown = pageVisibleSections(
    row.orgSections as PageSection[],
    features,
    row.hidden as PageSection[],
  ).includes('tg');
  const chats = await tx
    .select({
      linkId: contractorTelegramLinks.id,
      chatId: contractorTelegramLinks.chatId,
      name: contractorTelegramLinks.name,
    })
    .from(contractorTelegramLinks)
    .where(
      and(
        eq(contractorTelegramLinks.contractorId, contractorId),
        eq(contractorTelegramLinks.status, 'on'),
      ),
    )
    .orderBy(contractorTelegramLinks.requestedAt, contractorTelegramLinks.id);
  return {
    contractor: row.contractor,
    slug: row.slug,
    inn: row.inn,
    code: row.code,
    closed: row.closedAt !== null,
    tgShown,
    chats,
  };
}

/**
 * Код отправлен (прототип `pgCodeSend`): запись в историю контрагента от имени контрагента — в какие
 * Telegram и как (ссылкой «Забыли код?» или командой «Код от страницы»). Самого кода в записи нет.
 */
export async function logPageCodeSent(
  tx: Tx,
  contractorId: string,
  o: { chats: readonly string[]; via: PageCodeVia },
): Promise<void> {
  const changes: HistoryChange[] = [{ field: 'tgCode', to: { chats: [...o.chats], via: o.via } }];
  await writeContractorPageHistory(tx, contractorId, 'page_code_tg', { changes });
}
