import { z } from 'zod';
import type { Db } from '../client';
import { projectMembers, projects, projectWorks, statusHistory } from '../schema';
import type { DemoIdOf } from './demo';

/*
 * Проекты демо-организации (задача 2.26): `projects` из demoDB.json — контрагент, название, описание,
 * срок, статус, ответственные (первый в списке — как в прототипе), главный, планируемая стоимость и
 * работы. Суммы в прототипе — в сомах, в базе — в тыйынах. Оплаты (`pays`) — вторая часть задачи 2.26;
 * файлы проектов не наполняются: в демо-хранилище их нет (как у разовых услуг). Повторный запуск
 * досоздаёт только недостающее.
 */

const tyiyn = (som: number) => Math.round(som * 100);

/** Момент прототипа «2026-08-14 10:03» — по Бишкеку; без него — 10:00 дня начала проекта. */
const stampOf = (s: string | undefined, date: string) =>
  new Date(s ? `${s.replace(' ', 'T')}:00+06:00` : `${date}T10:00:00+06:00`);

/** Названия статусов прототипа → коды шкалы `project`. */
const STATUS_OF = {
  Планируется: 'planned',
  'В работе': 'in_progress',
  Завершён: 'done',
  Отменён: 'cancelled',
} as const;

const DemoWork = z.object({
  n: z.string(),
  done: z.boolean().default(false),
  exec: z.string(),
  due: z.iso.date().nullable().default(null),
});

const DemoProject = z.object({
  id: z.string(),
  cp: z.number().int(),
  name: z.string(),
  desc: z.string().default(''),
  from: z.iso.date(),
  to: z.iso.date(),
  status: z.enum(Object.keys(STATUS_OF) as [keyof typeof STATUS_OF, ...(keyof typeof STATUS_OF)[]]),
  resps: z.array(z.string()).min(1),
  lead: z.string(),
  plan: z.number().nonnegative().nullable().default(null),
  works: z.array(DemoWork).default([]),
  _cb: z.string().optional(),
  _ca: z.string().optional(),
  _ub: z.string().optional(),
  _ua: z.string().optional(),
});

const DemoProjectsFile = z.object({ projects: z.array(DemoProject.passthrough()).default([]) });

/** Путь статусов демо-проекта: «Планируется» → … → текущий (как `statusHist('proj', …)` прототипа). */
const PATH: Readonly<Record<string, readonly string[]>> = {
  planned: ['planned'],
  in_progress: ['planned', 'in_progress'],
  done: ['planned', 'in_progress', 'done'],
  cancelled: ['planned', 'cancelled'],
};

export async function seedDemoProjects(
  db: Db,
  file: unknown,
  { orgId, demoId, employees }: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<void> {
  const demo = DemoProjectsFile.parse(file);
  if (!demo.projects.length) return;
  const employee = (protoId: string) => {
    if (!employees.includes(protoId)) throw new Error(`demoDB.json: нет сотрудника ${protoId}`);
    return demoId('employee', protoId);
  };
  const user = (protoId: string | undefined) =>
    protoId && employees.includes(protoId) ? demoId('user', protoId) : null;
  const inserted = await db
    .insert(projects)
    .values(
      demo.projects.map((p) => ({
        id: demoId('project', p.id),
        orgId,
        contractorId: demoId('contractor', String(p.cp)),
        name: p.name,
        startsOn: p.from,
        endsOn: p.to,
        description: p.desc,
        plan: p.plan === null ? null : tyiyn(p.plan),
        status: STATUS_OF[p.status],
        leadEmployeeId: employee(p.lead),
        createdBy: user(p._cb),
        updatedBy: user(p._ub ?? p._cb),
        createdAt: stampOf(p._ca, p.from),
        updatedAt: stampOf(p._ua ?? p._ca, p.from),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: projects.id });
  const created = new Set(inserted.map((r) => r.id));
  const fresh = demo.projects.filter((p) => created.has(demoId('project', p.id)));
  if (!fresh.length) return;
  await db.insert(projectMembers).values(
    fresh.flatMap((p) =>
      p.resps.map((e, position) => ({
        orgId,
        projectId: demoId('project', p.id),
        employeeId: employee(e),
        position,
      })),
    ),
  );
  const works = fresh.flatMap((p) =>
    p.works.map((w, position) => ({
      id: demoId('project_work', `${p.id}:${position}`),
      orgId,
      projectId: demoId('project', p.id),
      name: w.n,
      executorEmployeeId: employee(w.exec),
      dueDate: w.due,
      done: w.done,
      position,
      createdBy: user(p._cb),
      updatedBy: user(p._ub ?? p._cb),
      createdAt: stampOf(p._ca, p.from),
      updatedAt: stampOf(p._ua ?? p._ca, p.from),
    })),
  );
  if (works.length) await db.insert(projectWorks).values(works);
  // «История статусов»: создан «Планируется» автором, дальше шаги до текущего — главным ответственным
  // в день начала (переход в работу) и в день окончания (завершение, отмена).
  await db.insert(statusHistory).values(
    fresh.flatMap((p) => {
      const path = PATH[STATUS_OF[p.status]]!;
      return path.map((to, i) => ({
        orgId,
        scale: 'project' as const,
        entityId: demoId('project', p.id),
        fromStatus: i === 0 ? null : path[i - 1]!,
        toStatus: to,
        actorUserId: i === 0 ? user(p._cb) : user(p.lead),
        at:
          i === 0
            ? stampOf(p._ca, p.from)
            : to === 'in_progress'
              ? stampOf(undefined, p.from)
              : stampOf(undefined, p.to),
      }));
    }),
  );
}
