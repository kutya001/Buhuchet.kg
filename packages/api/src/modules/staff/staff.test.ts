import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { TEMP_PASSWORD_PATTERN } from '@buhuchet/domain';
import {
  ApiError,
  CreatedEmployee,
  Employee,
  EmployeeList,
  MeResponse,
  TemporaryPasswordResponse,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  cookieOf,
  createStaffFixture,
  signIn,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';

const { auditLog, sessions } = schema;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

async function errorCode(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.code;
}

describe.skipIf(!databaseAvailable())('Сотрудники: API', () => {
  let f: Fixture;
  let owner: string;
  let hr: string;
  let chief: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookie?: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);

  const loginAs = (login: string, password = TEST_PASSWORD) =>
    f.app.request('/api/auth/login', {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });

  async function card(cookie: string, id: string): Promise<Employee> {
    const res = await call('GET', `/api/staff/${id}`, cookie);
    expect(res.status).toBe(200);
    return Employee.parse(await res.json());
  }

  /** Новый сотрудник организации А с ролью «Бухгалтер» от имени владельца. */
  async function hire(login: string, extra: Record<string, unknown> = {}) {
    const res = await call('POST', '/api/staff', owner, {
      fullName: `Тестов ${login}`,
      login,
      roleId: f.templateRole(f.a, 'acc'),
      ...extra,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return CreatedEmployee.parse(await res.json());
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    chief = await signIn(f.app, 'chief-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  describe('список и карточка', () => {
    it('владелец видит сотрудников своей организации, и только их', async () => {
      const res = await call('GET', '/api/staff', owner);
      expect(res.status).toBe(200);
      const { items } = EmployeeList.parse(await res.json());
      const logins = items.map((e) => e.login);
      expect(logins).toEqual(
        expect.arrayContaining(['owner-a', 'chief-a', 'acc-a', 'hr-a', 'senior-a']),
      );
      expect(logins).not.toContain('acc-b');
      expect(logins).not.toContain('owner-b');
      const ownerRow = items.find((e) => e.login === 'owner-a')!;
      expect(ownerRow).toMatchObject({
        fullName: 'Владелец owner-a',
        role: { name: 'Владелец организации', isOwner: true },
        active: true,
        telegram: null,
        // Организацию создал администратор платформы (createOrganization без автора — система).
        audit: { createdBy: null },
      });
      expect(ownerRow.lastLoginAt).not.toBeNull();
      // Хеш пароля не уходит никуда.
      expect(JSON.stringify(items)).not.toMatch(/argon2|passwordHash/);
    });

    it('«Просматривать сотрудников» достаточно для списка и карточки; без него — 403', async () => {
      expect((await call('GET', '/api/staff', chief)).status).toBe(200);
      const acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      expect((await call('GET', '/api/staff', acc)).status).toBe(403);
      expect((await call('GET', `/api/staff/${f.people['chief-a']!.employeeId}`, acc)).status).toBe(
        403,
      );
      expect((await call('GET', '/api/staff')).status).toBe(401);
      const admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
      expect((await call('GET', '/api/staff', admin)).status).toBe(403);
      // Значения для фильтра и их поиск — по тому же праву.
      const values = '/api/staff/values?col=role&q=%D0%B1%D1%83%D1%85';
      expect((await call('GET', values, chief)).status).toBe(200);
      expect((await call('GET', values, acc)).status).toBe(403);
      expect((await call('GET', values)).status).toBe(401);
    });

    it('кого смотрящий может вести (сменить роль, сбросить пароль, заблокировать) — признак manageable', async () => {
      const manageable = async (cookie: string) => {
        const res = await call('GET', '/api/staff?size=all', cookie);
        expect(res.status).toBe(200);
        const { items } = EmployeeList.parse(await res.json());
        return Object.fromEntries(items.map((e) => [e.login, e.manageable]));
      };
      // Владелец — всех, кроме себя.
      expect(await manageable(owner)).toMatchObject({
        'owner-a': false,
        'chief-a': true,
        'acc-a': true,
        'hr-a': true,
        'senior-a': true,
      });
      // Не владелец — не владельца, не себя, не с правами «выдаёт только владелец», не шире себя.
      expect(await manageable(hr)).toMatchObject({
        'owner-a': false,
        'chief-a': false,
        'acc-a': true,
        'hr-a': false,
        'senior-a': false,
      });
      // Без права «Сотрудники и роли» — никого.
      expect(Object.values(await manageable(chief)).every((v) => v === false)).toBe(true);
      expect(await card(hr, f.people['acc-a']!.employeeId)).toMatchObject({ manageable: true });
      expect(await card(hr, f.people['chief-a']!.employeeId)).toMatchObject({ manageable: false });
    });

    it('карточка: своя организация — 200; чужая — 404; не номер — 400', async () => {
      const e = await card(chief, f.people['hr-a']!.employeeId);
      expect(e).toMatchObject({ login: 'hr-a', role: { name: 'Кадры', isOwner: false } });
      expect((await call('GET', `/api/staff/${f.people['acc-b']!.employeeId}`, owner)).status).toBe(
        404,
      );
      expect((await call('GET', '/api/staff/nope', owner)).status).toBe(400);
    });
  });

  describe('новый сотрудник', () => {
    it('владелец создаёт сотрудника: временный пароль, при входе — сменить; история с автором', async () => {
      const created = await hire('new-a', { phone: '+996555100200' });
      expect(created.temporaryPassword).toMatch(TEMP_PASSWORD_PATTERN);
      expect(created.employee).toMatchObject({
        fullName: 'Тестов new-a',
        shortName: 'new-a Т.',
        login: 'new-a',
        phone: '+996555100200',
        role: { name: 'Бухгалтер' },
        active: true,
        lastLoginAt: null,
        audit: { createdBy: 'owner-a В.', updatedBy: 'owner-a В.' },
        version: 1,
      });

      const login = await loginAs('new-a', created.temporaryPassword);
      expect(login.status).toBe(200);
      const me = MeResponse.parse(await login.json());
      expect(me.user.mustChangePassword).toBe(true);
      const cookie = cookieOf(login);
      const blocked = await call('GET', '/api/staff', cookie);
      expect(blocked.status).toBe(403);
      expect(await errorCode(blocked)).toBe('password_change_required');
      const changed = await call('POST', '/api/auth/password', cookie, {
        currentPassword: created.temporaryPassword,
        newPassword: 'Свой-пароль-123',
      });
      expect(changed.status).toBe(200);
      expect((await loginAs('new-a', 'Свой-пароль-123')).status).toBe(200);

      const history = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'employee'), eq(auditLog.entityId, created.employee.id)));
      expect(history[0]).toMatchObject({
        action: 'create',
        actorUserId: f.a.ownerUserId,
        orgId: f.a.orgId,
        changes: expect.arrayContaining([{ field: 'roleName', to: 'Бухгалтер' }]),
      });
      const all = await f.t.admin.db.select().from(auditLog);
      expect(JSON.stringify(all)).not.toContain(created.temporaryPassword);
    });

    it('временный пароль, заданный владельцем, — не короче 8 символов', async () => {
      const created = await hire('own-pass-a', { temporaryPassword: 'Временный-1' });
      expect(created.temporaryPassword).toBe('Временный-1');
      expect((await loginAs('own-pass-a', 'Временный-1')).status).toBe(200);
      const short = await call('POST', '/api/staff', owner, {
        fullName: 'Тестов Короткий',
        login: 'short-a',
        temporaryPassword: 'Bh-1234',
        roleId: f.templateRole(f.a, 'acc'),
      });
      expect(short.status).toBe(400);
      expect(await errorCode(short)).toBe('validation_failed');
    });

    it('логин уникален на всей платформе, без учёта регистра', async () => {
      const res = await call('POST', '/api/staff', owner, {
        fullName: 'Тестов Двойник',
        login: 'ACC-B',
        roleId: f.templateRole(f.a, 'acc'),
      });
      expect(res.status).toBe(400);
      expect(ApiError.parse(await res.json()).error).toEqual({
        code: 'login_taken',
        message: 'Такой логин уже занят на платформе',
      });
    });

    it('неверные ФИО, логин, телефон и роль — 400 с причиной', async () => {
      const base = { fullName: 'Тестов Тест', login: 'bad-a', roleId: f.templateRole(f.a, 'acc') };
      const cases: [Record<string, unknown>, string][] = [
        [{ fullName: 'Тестов' }, 'invalid_full_name'],
        [{ login: 'Не логин' }, 'invalid_login'],
        [{ login: 'ab' }, 'invalid_login'],
        [{ phone: '+99655510020' }, 'invalid_phone'],
        [{ phone: '+1555100200' }, 'invalid_phone'],
        [{ roleId: f.templateRole(f.b, 'acc') }, 'role_not_found'],
        [{ roleId: 'nope' }, 'validation_failed'],
      ];
      for (const [patch, code] of cases) {
        const res = await call('POST', '/api/staff', owner, { ...base, ...patch });
        expect({ patch, status: res.status, code: await errorCode(res) }).toEqual({
          patch,
          status: 400,
          code,
        });
      }
    });

    it('роль владельца не назначается; роль с правами «выдаёт владелец» назначает только владелец', async () => {
      const ownerRole = f.a.roles.find((r) => r.isOwner)!.id;
      const asOwner = await call('POST', '/api/staff', owner, {
        fullName: 'Тестов Второй',
        login: 'second-owner-a',
        roleId: ownerRole,
      });
      expect(asOwner.status).toBe(403);
      expect(await errorCode(asOwner)).toBe('owner_role');

      const hrRole = await call('POST', '/api/staff', hr, {
        fullName: 'Тестов Кадровик',
        login: 'hr2-a',
        roleId: f.roleIds.hr,
      });
      expect(hrRole.status).toBe(403);
      expect(await errorCode(hrRole)).toBe('owner_granted');

      // «Главный бухгалтер» шире «Кадров»: его временный пароль дал бы кадровику чужие права.
      const wider = await call('POST', '/api/staff', hr, {
        fullName: 'Тестов Главбух',
        login: 'chief2-a',
        roleId: f.templateRole(f.a, 'chief'),
      });
      expect(wider.status).toBe(403);
      expect(ApiError.parse(await wider.json()).error).toEqual({
        code: 'beyond_own',
        message: 'Роль с правами шире ваших назначает и снимает владелец',
      });

      const ok = await call('POST', '/api/staff', hr, {
        fullName: 'Тестов Бухгалтер',
        login: 'hired-by-hr-a',
        roleId: f.templateRole(f.a, 'acc'),
      });
      expect(ok.status).toBe(201);
      expect(CreatedEmployee.parse(await ok.json()).employee.audit.createdBy).toBe('hr-a');

      // Без права «Сотрудники и роли» — 403 до всех проверок.
      const noRight = await call('POST', '/api/staff', chief, {
        fullName: 'Тестов Тест',
        login: 'by-chief-a',
        roleId: f.templateRole(f.a, 'acc'),
      });
      expect(noRight.status).toBe(403);
      expect(await errorCode(noRight)).toBe('forbidden');
    });
  });

  describe('правка и смена роли', () => {
    it('владелец меняет роль: история «Бухгалтер → Главный бухгалтер», права действуют сразу', async () => {
      const { employee } = await hire('promote-a');
      const res = await call('PATCH', `/api/staff/${employee.id}`, owner, {
        version: employee.version,
        roleId: f.templateRole(f.a, 'chief'),
        fullName: 'Повышенов  Тест ',
      });
      expect(res.status).toBe(200);
      const updated = Employee.parse(await res.json());
      expect(updated).toMatchObject({
        fullName: 'Повышенов Тест',
        shortName: 'Тест П.',
        role: { name: 'Главный бухгалтер' },
        version: employee.version + 1,
        audit: { updatedBy: 'owner-a В.' },
      });
      const [entry] = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity, 'employee'),
            eq(auditLog.entityId, employee.id),
            eq(auditLog.action, 'update'),
          ),
        );
      expect(entry!.changes).toEqual(
        expect.arrayContaining([
          { field: 'roleName', from: 'Бухгалтер', to: 'Главный бухгалтер' },
          { field: 'fullName', from: 'Тестов promote-a', to: 'Повышенов Тест' },
        ]),
      );

      // Устаревшая версия — 409, чужая правка не затирается.
      const stale = await call('PATCH', `/api/staff/${employee.id}`, owner, {
        version: employee.version,
        phone: '+996700330440',
      });
      expect(stale.status).toBe(409);
      expect(await errorCode(stale)).toBe('record_changed');
      expect((await card(owner, employee.id)).phone).toBeNull();
    });

    it('правка без изменений версию не меняет', async () => {
      const e = await card(owner, f.people['acc-a']!.employeeId);
      const res = await call('PATCH', `/api/staff/${e.id}`, owner, {
        version: e.version,
        fullName: e.fullName,
        phone: null,
        roleId: e.role.id,
      });
      expect(res.status).toBe(200);
      expect(Employee.parse(await res.json()).version).toBe(e.version);
    });

    it('не владелец: свою роль и роли с правами «выдаёт владелец» не меняет, владельца не правит', async () => {
      const self = await card(owner, f.people['hr-a']!.employeeId);
      const own = await call('PATCH', `/api/staff/${self.id}`, hr, {
        version: self.version,
        roleId: f.templateRole(f.a, 'chief'),
      });
      expect(own.status).toBe(403);
      expect(await errorCode(own)).toBe('own_role');

      const senior = await card(owner, f.people['senior-a']!.employeeId);
      const demote = await call('PATCH', `/api/staff/${senior.id}`, hr, {
        version: senior.version,
        roleId: f.templateRole(f.a, 'acc'),
      });
      expect(demote.status).toBe(403);
      expect(await errorCode(demote)).toBe('owner_granted');

      const acc = await card(owner, f.people['acc-a']!.employeeId);
      const grant = await call('PATCH', `/api/staff/${acc.id}`, hr, {
        version: acc.version,
        roleId: f.roleIds.hr,
      });
      expect(grant.status).toBe(403);
      expect(await errorCode(grant)).toBe('owner_granted');

      // Роль шире своей не назначает и не снимает.
      const promote = await call('PATCH', `/api/staff/${acc.id}`, hr, {
        version: acc.version,
        roleId: f.templateRole(f.a, 'chief'),
      });
      expect(promote.status).toBe(403);
      expect(await errorCode(promote)).toBe('beyond_own');
      const chiefCard = await card(owner, f.people['chief-a']!.employeeId);
      const demoteChief = await call('PATCH', `/api/staff/${chiefCard.id}`, hr, {
        version: chiefCard.version,
        roleId: f.templateRole(f.a, 'acc'),
      });
      expect(demoteChief.status).toBe(403);
      expect(await errorCode(demoteChief)).toBe('beyond_own');

      const ownerCard = await card(owner, f.a.ownerEmployeeId);
      const ownerEdit = await call('PATCH', `/api/staff/${ownerCard.id}`, hr, {
        version: ownerCard.version,
        fullName: 'Другой Владелец',
      });
      expect(ownerEdit.status).toBe(403);
      expect(await errorCode(ownerEdit)).toBe('owner_employee');

      // ФИО и телефон себе и обычному сотруднику — можно.
      const phone = await call('PATCH', `/api/staff/${self.id}`, hr, {
        version: self.version,
        phone: '+77011234567',
      });
      expect(phone.status).toBe(200);
    });

    it('роль владельца не меняется; свои ФИО владелец правит', async () => {
      const me = await card(owner, f.a.ownerEmployeeId);
      const role = await call('PATCH', `/api/staff/${me.id}`, owner, {
        version: me.version,
        roleId: f.templateRole(f.a, 'chief'),
      });
      expect(role.status).toBe(403);
      expect(await errorCode(role)).toBe('owner_employee');
      const name = await call('PATCH', `/api/staff/${me.id}`, owner, {
        version: me.version,
        fullName: 'Владелец Новый',
      });
      expect(name.status).toBe(200);
      expect(Employee.parse(await name.json()).shortName).toBe('Новый В.');
    });

    it('чужая организация: правка и блокировка — 404', async () => {
      const id = f.people['acc-b']!.employeeId;
      expect(
        (await call('PATCH', `/api/staff/${id}`, owner, { version: 1, phone: null })).status,
      ).toBe(404);
      expect((await call('POST', `/api/staff/${id}/block`, owner, { version: 1 })).status).toBe(
        404,
      );
      expect((await loginAs('acc-b')).status).toBe(200);
    });
  });

  describe('блокировка', () => {
    it('заблокированный не входит, его сеансы закрыты; после разблокировки входит', async () => {
      const { employee, temporaryPassword } = await hire('block-me-a', {
        temporaryPassword: 'Пароль-блок-1',
      });
      expect(temporaryPassword).toBe('Пароль-блок-1');
      const session = cookieOf(await loginAs('block-me-a', 'Пароль-блок-1'));

      const res = await call('POST', `/api/staff/${employee.id}/block`, owner, {
        version: employee.version,
      });
      expect(res.status).toBe(200);
      const blocked = Employee.parse(await res.json());
      expect(blocked).toMatchObject({ active: false, version: employee.version + 1 });
      const left = await f.t.admin.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, (await userOf(employee.id))!));
      expect(left).toHaveLength(0);
      expect((await call('GET', '/api/auth/me', session)).status).toBe(401);
      const denied = await loginAs('block-me-a', 'Пароль-блок-1');
      expect(denied.status).toBe(403);
      expect(await errorCode(denied)).toBe('employee_blocked');

      const unblock = await call('POST', `/api/staff/${employee.id}/unblock`, owner, {
        version: blocked.version,
      });
      expect(unblock.status).toBe(200);
      expect(Employee.parse(await unblock.json()).active).toBe(true);
      expect((await loginAs('block-me-a', 'Пароль-блок-1')).status).toBe(200);

      const history = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'employee'), eq(auditLog.entityId, employee.id)));
      expect(history.map((h) => h.changes)).toEqual(
        expect.arrayContaining([
          [{ field: 'active', from: true, to: false }],
          [{ field: 'active', from: false, to: true }],
        ]),
      );
    });

    async function userOf(employeeId: string) {
      const [row] = await f.t.admin.db
        .select({ userId: schema.employees.userId })
        .from(schema.employees)
        .where(eq(schema.employees.id, employeeId));
      return row?.userId;
    }

    it('себя и владельца не блокируют; устаревшая версия — 409', async () => {
      const self = await card(owner, f.people['hr-a']!.employeeId);
      const selfBlock = await call('POST', `/api/staff/${self.id}/block`, hr, {
        version: self.version,
      });
      expect(selfBlock.status).toBe(403);
      expect(await errorCode(selfBlock)).toBe('own_account');

      const ownerCard = await card(owner, f.a.ownerEmployeeId);
      const ownerBlock = await call('POST', `/api/staff/${ownerCard.id}/block`, hr, {
        version: ownerCard.version,
      });
      expect(ownerBlock.status).toBe(403);
      expect(await errorCode(ownerBlock)).toBe('owner_employee');

      // У senior-a «Откат статусов» — его блокирует и разблокирует только владелец.
      const senior = await card(owner, f.people['senior-a']!.employeeId);
      for (const action of ['block', 'unblock']) {
        const res = await call('POST', `/api/staff/${senior.id}/${action}`, hr, {
          version: senior.version,
        });
        expect(res.status).toBe(403);
        expect(ApiError.parse(await res.json()).error).toEqual({
          code: 'owner_granted',
          message:
            'Сотрудника с правами, которые выдаёт только владелец, блокирует и разблокирует владелец',
          details: { variant: 'block' },
        });
      }
      expect((await card(owner, senior.id)).active).toBe(true);

      // «Главный бухгалтер» шире «Кадров» — его тоже блокирует только владелец.
      const chiefCard = await card(owner, f.people['chief-a']!.employeeId);
      const chiefBlock = await call('POST', `/api/staff/${chiefCard.id}/block`, hr, {
        version: chiefCard.version,
      });
      expect(chiefBlock.status).toBe(403);
      expect(ApiError.parse(await chiefBlock.json()).error).toEqual({
        code: 'beyond_own',
        message: 'Сотрудника с правами шире ваших блокирует и разблокирует владелец',
        details: { variant: 'block' },
      });

      const acc = await card(owner, f.people['acc-a']!.employeeId);
      const stale = await call('POST', `/api/staff/${acc.id}/block`, owner, {
        version: acc.version + 5,
      });
      expect(stale.status).toBe(409);
      expect((await card(owner, acc.id)).active).toBe(true);
      expect(
        (await call('POST', `/api/staff/${acc.id}/block`, chief, { version: acc.version })).status,
      ).toBe(403);
    });
  });

  describe('сброс пароля', () => {
    it('пароль сотрудника с правами «выдаёт владелец» сбрасывает только владелец', async () => {
      const senior = f.people['senior-a']!.employeeId;
      const byHr = await call('POST', `/api/staff/${senior}/password-reset`, hr, {});
      expect(byHr.status).toBe(403);
      expect(await errorCode(byHr)).toBe('owner_granted');
      expect((await loginAs('senior-a')).status).toBe(200);

      const { employee } = await hire('reset-by-hr-a');
      const ok = await call('POST', `/api/staff/${employee.id}/password-reset`, hr, {});
      expect(ok.status).toBe(200);
      expect(TemporaryPasswordResponse.parse(await ok.json()).temporaryPassword).toMatch(
        TEMP_PASSWORD_PATTERN,
      );

      const bySenior = await call('POST', `/api/staff/${senior}/password-reset`, owner, {});
      expect(bySenior.status).toBe(200);
    });

    it('пароль сотрудника с правами шире своих не владелец не сбрасывает', async () => {
      const chiefId = f.people['chief-a']!.employeeId;
      const byHr = await call('POST', `/api/staff/${chiefId}/password-reset`, hr, {});
      expect(byHr.status).toBe(403);
      expect(ApiError.parse(await byHr.json()).error).toEqual({
        code: 'beyond_own',
        message: 'Пароль сотрудника с правами шире ваших сбрасывает владелец',
        details: { variant: 'reset_password' },
      });
      expect((await loginAs('chief-a')).status).toBe(200);
      const missing = await call(
        'POST',
        '/api/staff/00000000-0000-4000-8000-000000000000/password-reset',
        owner,
        {},
      );
      expect(missing.status).toBe(404);
    });
  });
});
