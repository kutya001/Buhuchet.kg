import {
  DICT_REQUEST_DICTS,
  UI_TEXTS,
  type DictRequestDict,
  type DictRequestStatus,
} from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { dictChangeRequests } from '../schema';

/** «2026-10-06 11:05» — момент по Бишкеку, как `_ca` и `_ua` записей прототипа. */
const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/**
 * Статус запроса в demoDB.json — словами, как в прототипе. С прототипа v169 — «Отклонён»; статусы
 * «В работе», «Решён», «Отозван» и виды кроме «Добавить в справочник» база примет с миграции этапа 0
 * пакета 28.11.2026 — до неё такие запросы демо не наполняет (docs/deviations.md п. О-107).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-107
const STATUS: Readonly<Record<string, DictRequestStatus>> = {
  Новый: 'new',
  Добавлено: 'added',
  Отклонено: 'rejected',
  Отклонён: 'rejected',
};

/** Справочник запроса в demoDB.json — названием («Виды отчётов»); код — по словарю интерфейса. */
const DICT_BY_TITLE = new Map<string, DictRequestDict>(
  DICT_REQUEST_DICTS.map((d) => [UI_TEXTS[`dicts.platform.dict.${d}`].ru, d]),
);

const DemoRequests = z.object({
  dictRequests: z
    .array(
      z.object({
        oid: z.string().optional(),
        // До прототипа v169 — `what`, `note`, `answer`; с v169 — вид, тема, форма и переписка.
        kind: z.string().default('dict'),
        what: z.string().optional(),
        topic: z.string().optional(),
        dict: z.string().nullish(),
        note: z.string().default(''),
        form: z.object({ note: z.string().optional() }).passthrough().nullish(),
        status: z.string(),
        answer: z.string().default(''),
        msgs: z
          .array(
            z.object({ who: z.string(), k: z.string(), text: z.string().optional() }).passthrough(),
          )
          .default([]),
        _cb: z.string(),
        _ca: Stamp,
        _ua: Stamp,
      }),
    )
    .default([]),
});

/**
 * Запросы «Попросить добавить» демо-организации (`dictRequests` с `oid: 'o1'` в demoDB.json, прототип
 * v59): видны в «Мои запросы» и в Админке → «Запросы». Ответ администратора — с моментом ответа, без
 * автора: администратора платформы в наполнении нет. Повторный запуск ничего не дублирует — у запроса
 * постоянный id.
 */
export async function seedDemoDictRequests(
  db: Db,
  file: unknown,
  orgId: string,
  ids: { request: (key: string) => string; user: (protoId: string) => string | null },
): Promise<void> {
  const rows = DemoRequests.parse(file)
    .dictRequests.filter((r) => r.oid === 'o1' && r.kind === 'dict')
    .flatMap((r) => {
      const dict = r.dict ? DICT_BY_TITLE.get(r.dict) : undefined;
      const status = STATUS[r.status];
      const createdBy = ids.user(r._cb);
      const what = r.topic ?? r.what;
      if (!dict || !status || !createdBy || !what) return [];
      const answer = r.answer || r.msgs.find((m) => m.who === 'admin' && m.k === 'msg')?.text || '';
      const decided = status !== 'new';
      return [
        {
          id: ids.request(`${r._ca} ${what}`),
          orgId,
          dict,
          what,
          comment: r.note || r.form?.note || '',
          status,
          answer,
          createdBy,
          decidedAt: decided ? stampOf(r._ua) : null,
          createdAt: stampOf(r._ca),
          updatedAt: stampOf(r._ua),
        },
      ];
    });
  if (rows.length > 0) await db.insert(dictChangeRequests).values(rows).onConflictDoNothing();
}
