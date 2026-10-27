import { auditActorName, type DictRequestDict, type DictRequestStatus } from '@buhuchet/domain';
import { desc, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { writeHistory } from './history';
import { dictChangeRequests, employees } from './schema';

/*
 * «Попросить добавить» (задача 2.03; ТЗ «Если нужного значения нет, кнопка «Попросить добавить»
 * отправляет запрос администратору платформы»; прототип modules/dicts.js `requestDlg`): организация
 * отправляет запрос и видит свои запросы («Мои запросы», docs/deviations.md п. 46). Всё — в
 * `withOrgContext`: RLS отдаёт только запросы своей организации; менять и удалять их приложению нечем
 * (миграция 0032), ответ ставит администратор платформы (Админка, задача 2.36).
 */

/** Запрос организации: в какой справочник, что добавить, статус и ответ администратора. */
export interface DictRequestRecord {
  id: string;
  dict: DictRequestDict;
  what: string;
  comment: string;
  status: DictRequestStatus;
  answer: string;
  createdAt: Date;
  /** Краткое ФИО сотрудника, который отправил запрос. */
  createdBy: string | null;
  decidedAt: Date | null;
}

const fields = {
  id: dictChangeRequests.id,
  dict: sql<DictRequestDict>`${dictChangeRequests.dict}`,
  what: dictChangeRequests.what,
  comment: dictChangeRequests.comment,
  status: sql<DictRequestStatus>`${dictChangeRequests.status}`,
  answer: dictChangeRequests.answer,
  createdAt: dictChangeRequests.createdAt,
  createdById: dictChangeRequests.createdBy,
  createdByName: employees.shortName,
  decidedAt: dictChangeRequests.decidedAt,
};

type RequestRow = { createdById: string; createdByName: string | null } & Omit<
  DictRequestRecord,
  'createdBy'
>;

const toRecord = ({ createdById, createdByName, ...r }: RequestRow): DictRequestRecord => ({
  ...r,
  createdBy: auditActorName(createdById, createdByName),
});

/** Сколько запросов показывает «Мои запросы» — последние. */
export const DICT_REQUESTS_SHOWN = 200;

/**
 * Отправить запрос: организация и автор — из контекста, статус «Новый»; создание — в историю записи
 * в той же транзакции.
 */
export async function createDictRequest(
  tx: Tx,
  input: { dict: DictRequestDict; what: string; comment: string },
): Promise<DictRequestRecord> {
  const values = { dict: input.dict, what: input.what.trim(), comment: input.comment.trim() };
  const [created] = await tx
    .insert(dictChangeRequests)
    .values({
      orgId: sql`app.current_org_id()`,
      ...values,
      createdBy: sql`app.current_user_id()`,
    })
    .returning({ id: dictChangeRequests.id });
  await writeHistory(tx, {
    entity: 'dict_request',
    entityId: created!.id,
    action: 'create',
    changes: Object.entries(values)
      .filter(([, to]) => to !== '')
      .map(([field, to]) => ({ field, to })),
  });
  const [row] = await tx
    .select(fields)
    .from(dictChangeRequests)
    .leftJoin(employees, eq(employees.userId, dictChangeRequests.createdBy))
    .where(eq(dictChangeRequests.id, created!.id));
  return toRecord(row!);
}

/** «Мои запросы»: запросы организации, сначала новые (последние `DICT_REQUESTS_SHOWN`). */
export async function listDictRequests(tx: Tx): Promise<DictRequestRecord[]> {
  const rows = await tx
    .select(fields)
    .from(dictChangeRequests)
    .leftJoin(employees, eq(employees.userId, dictChangeRequests.createdBy))
    .where(eq(dictChangeRequests.orgId, sql`app.current_org_id()`))
    .orderBy(desc(dictChangeRequests.createdAt), desc(dictChangeRequests.id))
    .limit(DICT_REQUESTS_SHOWN);
  return rows.map(toRecord);
}
