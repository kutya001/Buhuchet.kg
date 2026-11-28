import {
  DICT_REQUEST_DICTS,
  REQUEST_DICT_FORMS,
  REQUEST_KINDS,
  UI_TEXTS,
  requestWhereClean,
  type DictRequestDict,
  type RequestDictForm,
  type RequestStatus,
} from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { dictChangeRequests, requestMessages } from '../schema';

/** «2026-10-06 11:05» — момент по Бишкеку, как `_ca` и `_ua` записей прототипа. */
const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Статус запроса в demoDB.json — словами, как в прототипе (до v169 — «Отклонено»). */
const STATUS: Readonly<Record<string, RequestStatus>> = {
  Новый: 'new',
  'В работе': 'in_work',
  Решён: 'solved',
  Добавлено: 'added',
  Отклонено: 'rejected',
  Отклонён: 'rejected',
  Отозван: 'withdrawn',
};

/** Справочник запроса в demoDB.json — названием («Виды отчётов»); код — по словарю интерфейса. */
const DICT_BY_TITLE = new Map<string, DictRequestDict>(
  DICT_REQUEST_DICTS.map((d) => [UI_TEXTS[`dicts.platform.dict.${d}`].ru, d]),
);

const Msg = z
  .object({
    at: Stamp,
    who: z.string(),
    k: z.string(),
    n: z.number().int().min(1),
    text: z.string().default(''),
    from: z.string().optional(),
    to: z.string().optional(),
    why: z.string().default(''),
  })
  .passthrough();

const DemoRequests = z.object({
  dictRequests: z
    .array(
      z
        .object({
          oid: z.string().optional(),
          // До прототипа v169 — `what`, `note`, `answer`; с v169 — вид, тема, форма и переписка.
          kind: z.enum(REQUEST_KINDS).default('dict'),
          what: z.string().optional(),
          topic: z.string().optional(),
          dict: z.string().nullish(),
          fid: z.string().nullish(),
          note: z.string().default(''),
          form: z.record(z.string(), z.unknown()).nullish(),
          where: z.unknown().optional(),
          status: z.string(),
          wait: z.boolean().default(false),
          answer: z.string().default(''),
          msgs: z.array(Msg).default([]),
          readA: z.number().int().min(0).default(0),
          readAdm: z.number().int().min(0).default(0),
          no: z.number().int().optional(),
          _cb: z.string(),
          _ca: Stamp,
          _ua: Stamp,
        })
        .passthrough(),
    )
    .default([]),
});

/** Значения формы — строки, пустые не хранятся (как `requestFormStored`). */
function formOf(form: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form ?? {})) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

const isDictForm = (v: string | null | undefined): v is RequestDictForm =>
  !!v && (REQUEST_DICT_FORMS as readonly string[]).includes(v);

/**
 * Запросы администратору демо-организации (`dictRequests` с `oid: 'o1'` в demoDB.json, прототип
 * v169): все виды и статусы, с перепиской — видны в «Мои запросы» и в Админке → «Запросы». Сообщения
 * администратора — без автора: администратора платформы в наполнении нет; его «Заметки» демо не
 * наполняет по той же причине (у заметки автор обязателен). Номер запроса ставит база по порядку
 * `no` прототипа. Повторный запуск ничего не дублирует — у запроса постоянный id, переписка
 * кладётся только к запросу, добавленному этим запуском.
 */
export async function seedDemoDictRequests(
  db: Db,
  file: unknown,
  orgId: string,
  ids: { request: (key: string) => string; user: (protoId: string) => string | null },
): Promise<void> {
  const list = DemoRequests.parse(file)
    .dictRequests.filter((r) => r.oid === 'o1')
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  for (const r of list) {
    const status = STATUS[r.status];
    const createdBy = ids.user(r._cb);
    const topic = (r.topic ?? r.what ?? '').trim();
    if (!status || !createdBy || !topic) continue;
    const isDict = r.kind === 'dict';
    const dict = isDict && r.dict ? DICT_BY_TITLE.get(r.dict) : undefined;
    if (isDict && !dict) continue;
    const formId = isDict ? (isDictForm(r.fid) ? r.fid : 'other') : null;
    const form = formOf(r.form ?? (r.what ? { name: r.what } : null));
    const msgs = r.msgs.filter((m) => m.k === 'msg' || m.k === 'ask' || m.k === 'st');
    const lastAdmin = [...msgs].reverse().find((m) => m.who === 'admin' && m.k === 'msg');
    const closed = status !== 'new' && status !== 'in_work';
    const lastAt = msgs.length > 0 ? stampOf(msgs[msgs.length - 1]!.at) : stampOf(r._ca);
    const maxN = msgs.reduce((m, x) => Math.max(m, x.n), 0);
    const byAdminDecision = closed && status !== 'withdrawn';
    const inserted = await db
      .insert(dictChangeRequests)
      .values({
        id: ids.request(`${r._ca} ${topic}`),
        orgId,
        kind: r.kind,
        topic,
        formId,
        form,
        whereInfo: requestWhereClean(r.where),
        dict: dict ?? null,
        what: isDict ? topic : null,
        comment: r.note || form.note || '',
        status,
        wait: status === 'in_work' && r.wait,
        readAuthor: Math.min(r.readA, maxN),
        readAdmin: Math.min(r.readAdm, maxN),
        lastAt,
        closedAt: closed ? stampOf(r._ua) : null,
        answer: r.answer || lastAdmin?.text || '',
        createdBy,
        decidedAt: byAdminDecision ? stampOf(r._ua) : null,
        createdAt: stampOf(r._ca),
        updatedAt: stampOf(r._ua),
      })
      .onConflictDoNothing()
      .returning({ id: dictChangeRequests.id });
    const requestId = inserted[0]?.id;
    if (!requestId || msgs.length === 0) continue;
    const rows = msgs.flatMap((m) => {
      const byAdmin = m.who === 'admin';
      const author = byAdmin ? null : ids.user(m.who);
      if (!byAdmin && !author) return [];
      const st = m.k === 'st';
      const from = st ? STATUS[m.from ?? ''] : undefined;
      const to = st ? STATUS[m.to ?? ''] : undefined;
      if (st && (!from || !to)) return [];
      return [
        {
          orgId,
          requestId,
          n: m.n,
          kind: m.k as 'msg' | 'ask' | 'st',
          byAdmin,
          authorUserId: author,
          text: st ? '' : m.text,
          fromStatus: from ?? null,
          toStatus: to ?? null,
          why: st ? m.why : '',
          createdAt: stampOf(m.at),
        },
      ];
    });
    if (rows.length > 0) await db.insert(requestMessages).values(rows).onConflictDoNothing();
  }
}
