import { TASK_TERMS, type TaskStatus } from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { statusHistory, taskCategories, taskComments, tasks } from '../schema';
import type { DemoIdOf } from './demo';

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2026-10-15 16:06» — момент по Бишкеку, как `_ca` и `_ua` записей прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Названия статусов прототипа → коды шкалы `task`. */
const STATUS_OF: Readonly<Record<string, TaskStatus>> = {
  'К выполнению': 'todo',
  'В работе': 'in_progress',
  'На доработке': 'rework',
  'На подтверждении': 'on_confirm',
  Подтверждена: 'confirmed',
  Выполнена: 'done',
  'Не выполнена': 'failed',
  Отменена: 'cancelled',
};
const Status = z.enum(Object.keys(STATUS_OF) as [string, ...string[]]);

/** Ручная задача демо-организации (`tasks` в demoDB.json). Проект (`proj`) добавит задача 2.26. */
const DemoTask = z.object({
  id: z.string(),
  title: z.string(),
  desc: z.string().default(''),
  /** Категория — названием, как в справочнике «Категории задач». */
  cat: z.string(),
  cp: z.number().int().nullable(),
  exec: z.string(),
  by: z.string(),
  kind: z.enum(TASK_TERMS),
  date: z.iso.date(),
  needFile: z.boolean(),
  confirm: z.boolean().default(false),
  status: Status,
  /** Статус, с которым задача «пришла» в демо-данные до записей истории (прототип `_st0`). */
  _st0: Status.optional(),
  reason: z.string().default(''),
  rework: z.string().optional(),
  reworkBy: z.string().optional(),
  doneAt: z.iso.date().nullable().default(null),
  confBy: z.string().optional(),
  confAt: Stamp.optional(),
  confNote: z.string().optional(),
  comments: z.array(z.object({ who: z.string(), at: Stamp, text: z.string() })).default([]),
  _cb: z.string(),
  _ca: Stamp,
  _ub: z.string(),
  _ua: Stamp,
});

const DemoHistory = z.object({
  at: Stamp,
  who: z.string(),
  ent: z.string(),
  id: z.union([z.string(), z.number()]),
  what: z.string(),
});

const DemoTasks = z.object({
  tasks: z.array(DemoTask.passthrough()).default([]),
  history: z.array(DemoHistory.passthrough()).default([]),
});

/** «Статус: В работе → На подтверждении (заметка), продолжение, файл: имя» — запись истории прототипа. */
const STATUS_LINE = /^Статус: (.+?) → ([^,(]+?)\s*(?:\((.*?)\))?(?:,\s*(.*))?$/;

interface StatusRow {
  at: Date;
  from: TaskStatus | null;
  to: TaskStatus;
  who: string;
  reason: string | null;
}

/**
 * «История статусов» демо-задачи — как `statusHist('task', …)` прототипа: поставлена постановщиком,
 * статус до истории (`_st0`), записи «Статус: … → …» и, если последний статус не совпал, переход к нему.
 * Файл к смене статуса не переносится: демо-файлов ещё нет (задача 2.29).
 */
function statusRows(t: z.infer<typeof DemoTask>, history: z.infer<typeof DemoHistory>[]) {
  const out: StatusRow[] = [];
  let cur: TaskStatus = 'todo';
  const add = (at: Date, to: TaskStatus, who: string, reason: string | null) => {
    if (to === cur && out.length > 0) return;
    out.push({ at, from: out.length ? cur : null, to, who, reason: reason || null });
    cur = to;
  };
  add(stampOf(t._ca), 'todo', t.by, null);
  if (t._st0) {
    const st0 = STATUS_OF[t._st0]!;
    const at = t.doneAt ? stampOf(`${t.doneAt} 17:30`) : stampOf(t._ca);
    add(at, st0, t.exec, st0 === 'failed' ? t.reason : null);
  }
  for (const h of history) {
    const m = STATUS_LINE.exec(h.what);
    if (!m) continue;
    const to = STATUS_OF[m[2]!.trim()];
    if (!to) continue;
    const note = [m[3], m[4]]
      .filter(Boolean)
      .join(', ')
      .replace(/,?\s*файл:\s*.+$/, '');
    add(stampOf(h.at), to, h.who, note);
  }
  const final = STATUS_OF[t.status]!;
  if (final !== cur) add(stampOf(t._ua), final, t._ub, final === 'failed' ? t.reason : null);
  return out;
}

/**
 * Ручные задачи демо-организации (задача 2.23): поля, комментарии и «История статусов» по записям
 * прототипа. Повторный запуск досоздаёт только недостающее: история статусов пишется вместе с новой
 * задачей. Файлы задач (результат, акт сверки) добавит задача 2.29 «Файловый менеджер» — с источником
 * `task` они сразу видны в задаче.
 */
export async function seedDemoTasks(
  db: Db,
  file: unknown,
  ids: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<number> {
  const { tasks: demo, history } = DemoTasks.parse(file);
  if (demo.length === 0) return 0;
  const { orgId, demoId } = ids;
  const categories = await db
    .select({ code: taskCategories.code, name: taskCategories.name })
    .from(taskCategories);
  const categoryOf = (name: string) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`demoDB.json: нет категории задачи «${name}»`);
    return found.code;
  };
  const employee = (protoId: string) => {
    if (!ids.employees.includes(protoId)) throw new Error(`demoDB.json: нет сотрудника ${protoId}`);
    return demoId('employee', protoId);
  };
  const user = (protoId: string) =>
    ids.employees.includes(protoId) ? demoId('user', protoId) : null;

  const rows = demo.map((t) => {
    const status = STATUS_OF[t.status]!;
    return {
      id: demoId('task', t.id),
      orgId,
      title: t.title,
      description: t.desc,
      categoryCode: categoryOf(t.cat),
      contractorId: t.cp === null ? null : demoId('contractor', String(t.cp)),
      executorEmployeeId: employee(t.exec),
      authorEmployeeId: employee(t.by),
      term: t.kind,
      dueDate: t.date,
      needFile: t.needFile,
      confirm: t.confirm,
      status,
      doneAt: t.doneAt ? stampOf(`${t.doneAt} 17:30`) : null,
      failReason: t.reason,
      reworkReason: t.rework ?? '',
      reworkByEmployeeId: t.reworkBy ? employee(t.reworkBy) : null,
      confirmedByEmployeeId: status === 'confirmed' && t.confBy ? employee(t.confBy) : null,
      confirmedAt: status === 'confirmed' && t.confAt ? stampOf(t.confAt) : null,
      confirmNote: t.confNote ?? '',
      createdBy: user(t._cb),
      updatedBy: user(t._ub),
      createdAt: stampOf(t._ca),
      updatedAt: stampOf(t._ua),
    };
  });
  const inserted = await db
    .insert(tasks)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: tasks.id });
  const created = new Set(inserted.map((r) => r.id));

  const comments = demo.flatMap((t) =>
    t.comments.map((c, i) => ({
      id: demoId('task_comment', `${t.id}:${i}`),
      orgId,
      taskId: demoId('task', t.id),
      authorUserId: user(c.who)!,
      text: c.text,
      createdAt: stampOf(c.at),
    })),
  );
  if (comments.length) await db.insert(taskComments).values(comments).onConflictDoNothing();

  const statuses = demo
    .filter((t) => created.has(demoId('task', t.id)))
    .flatMap((t) =>
      statusRows(
        t,
        history.filter((h) => h.ent === 't' && String(h.id) === t.id),
      ).map((s) => ({
        orgId,
        scale: 'task' as const,
        entityId: demoId('task', t.id),
        fromStatus: s.from,
        toStatus: s.to,
        reason: s.reason,
        actorUserId: user(s.who),
        at: s.at,
      })),
    );
  if (statuses.length) await db.insert(statusHistory).values(statuses);
  return inserted.length;
}
