// Эталон для правил задач: taskActions, taskConfWhy, taskOver и taskConfTxt из прототипа
// (spec/prototype/src/js/modules/tasks.js) на задачах и сотрудниках demoDB.json. Запуск:
// node packages/domain/scripts/oracle-tasks.mjs — пишет packages/domain/src/tasks/__fixtures__/tasks.json
// (скилл prototype-oracle).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const demo = JSON.parse(read('spec/data/demoDB.json'));

// Демо-дата прототипа и второй день — после срока большей части задач.
const DAYS = ['2026-10-18', '2026-11-03'];

const roles = Object.fromEntries(demo.roles.map((r) => [r.id, r]));
const context = vm.createContext({
  DB: demo,
  S: { me: null },
  TODAY: DAYS[0],
});
vm.runInContext(
  `'use strict';
  const TASKS = DB.tasks;
  const REPORTS = [];
  const ORG = DB.organization;
  const EMP = DB.employees;
  const EM = Object.fromEntries(EMP.map((e) => [e.id, e]));
  const ROLES = ${JSON.stringify(roles)};
  const me = () => EM[S.me];
  // Права демо-ролей: у владельца — все.
  const can = (p) => me().role === 'owner' || ROLES[me().role].perms.includes(p);
  const empName = (id) => (EM[id] ? EM[id].short : '—');
  const ym = (d) => d.slice(0, 7);
  ${read('spec/prototype/src/js/modules/tasks.js').replace(/^'use strict';/, '')}
  globalThis.oracle = { taskActions, taskConfWhy, taskOver, taskOpen, taskConfTxt, setToday: (d) => { TODAY = d; } };`,
  context,
);
const { taskActions, taskConfWhy, taskOver, taskOpen, taskConfTxt } = context.oracle;

// Названия статусов прототипа → коды продукта (шкала `task`).
const STATUS = {
  'К выполнению': 'todo',
  'В работе': 'in_progress',
  'На доработке': 'rework',
  'На подтверждении': 'on_confirm',
  Подтверждена: 'confirmed',
  Выполнена: 'done',
  'Не выполнена': 'failed',
  Отменена: 'cancelled',
};
// Пункты меню прототипа → действия продукта («Открыть» экран добавляет сам).
const ACTION = {
  'Взять в работу': 'start',
  Выполнена: 'done',
  'Не выполнена': 'fail',
  Подтвердить: 'confirm',
  'На доработку': 'rework',
  Изменить: 'edit',
  'Отменить задачу': 'cancel',
};

const tasks = demo.tasks.map((t) => ({
  id: t.id,
  status: STATUS[t.status],
  confirm: !!t.confirm,
  executorId: t.exec,
  authorId: t.by,
  dueDate: t.date,
  confirmedBy: t.confBy ?? null,
}));
// Все статусы на каждой задаче: в демо-данных есть не все сочетания статуса, исполнителя и постановщика.
const variants = demo.tasks.flatMap((t) =>
  Object.keys(STATUS).map((status) => ({
    ...t,
    status,
    // Эти статусы бывают только у задачи с подтверждением.
    confirm: ['На подтверждении', 'Подтверждена', 'На доработке'].includes(status) || !!t.confirm,
  })),
);
const actors = demo.employees
  .filter((e) => e.active)
  .map((e) => ({
    employeeId: e.id,
    isOwner: e.role === 'owner',
    canConfirm: e.role === 'owner' || roles[e.role].perms.includes('tasksConfirm'),
  }));

const menus = [];
for (const actor of actors) {
  context.S.me = actor.employeeId;
  for (const t of variants) {
    const items = taskActions(t)
      .filter((x) => !x.sep && x.label !== 'Открыть')
      .map((x) => ({ action: ACTION[x.label], disabled: !!x.disabled, reason: x.reason || null }));
    menus.push({
      actor: actor.employeeId,
      task: t.id,
      status: STATUS[t.status],
      confirm: !!t.confirm,
      items,
      confirmWhy: taskConfWhy(t) || null,
    });
  }
}

const overdue = [];
for (const day of DAYS) {
  context.oracle.setToday(day);
  for (const t of variants) {
    overdue.push({
      today: day,
      task: t.id,
      status: STATUS[t.status],
      open: taskOpen(t),
      overdue: taskOver(t),
    });
  }
}
const marks = variants.map((t) => ({
  task: t.id,
  status: STATUS[t.status],
  confirm: !!t.confirm,
  confirmedBy: t.confBy ?? null,
  text: taskConfTxt(t),
}));

const out = new URL('packages/domain/src/tasks/__fixtures__/tasks.json', root);
mkdirSync(new URL('.', out), { recursive: true });
const filepath = fileURLToPath(out);
const json = JSON.stringify({ actors, tasks, menus, overdue, marks });
writeFileSync(out, await format(json, { ...(await resolveConfig(filepath)), filepath }));
console.log(`tasks.json: ${menus.length} меню, ${overdue.length} сроков, ${marks.length} отметок прототипа`);
