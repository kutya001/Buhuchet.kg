// Эталон для правил формы роли: roleLock из прототипа (spec/prototype/src/js/core/org.js) на ролях и
// сотрудниках demoDB.json. Запуск: node packages/domain/scripts/oracle-roles.mjs — пишет
// packages/domain/src/roles/__fixtures__/role-locks.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const demo = JSON.parse(read('spec/data/demoDB.json'));
const ref = JSON.parse(read('spec/data/refDB.json'));

// Из org.js — только каталог прав и roleLock: остальной файл тянет данные всего прототипа.
const wanted =
  /^(const PERM_REF|const PERMS=|const PERM_GROUPS|const PERM_VIEW|const SCOPE_GROUPS|const permGroup|permsBuild\(\);|function permsBuild|const OWNER_ONLY|function roleLock)/;
const source = read('spec/prototype/src/js/core/org.js')
  .split('\n')
  .filter((line) => wanted.test(line))
  .join('\n');

const context = vm.createContext({ DB: { ref, roles: demo.roles }, S: { me: null } });
vm.runInContext(
  `'use strict';
  const ROLES = DB.roles;
  const EM = ${JSON.stringify(Object.fromEntries(demo.employees.map((e) => [e.id, e])))};
  const me = () => EM[S.me];
  const myRole = () => ROLES.find((r) => r.id === me().role);
  ${source}
  globalThis.oracle = { roleLock, PERMS };`,
  context,
);
const { roleLock, PERMS } = context.oracle;

// Редакторы: владелец и по одному сотруднику каждой другой роли.
const editors = [];
for (const role of demo.roles) {
  const employee = demo.employees.find((e) => e.role === role.id);
  if (employee)
    editors.push({ employee: employee.id, roleId: role.id, isOwner: role.id === 'owner' });
}
const roles = Object.fromEntries(
  demo.roles.map((r) => [r.id, { isOwner: !!r.locked, permissions: r.perms }]),
);
const cases = [];
for (const editor of editors) {
  context.S.me = editor.employee;
  for (const role of demo.roles) {
    for (const [selected, set] of [
      ['role', new Set(role.perms)],
      ['empty', new Set()],
    ]) {
      for (const [permission] of PERMS) {
        cases.push([
          editor.employee,
          role.id,
          permission,
          selected,
          roleLock(role, permission, set),
        ]);
      }
    }
  }
}
const out = new URL('packages/domain/src/roles/__fixtures__/role-locks.json', root);
// В том виде, что ждёт `pnpm format:check`.
const filepath = fileURLToPath(out);
const json = JSON.stringify({ editors, roles, cases });
writeFileSync(out, await format(json, { ...(await resolveConfig(filepath)), filepath }));
console.log(`role-locks.json: ${cases.length} ответов прототипа`);
