import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import {
  AdminOrganization,
  DmTokenCard,
  DmTokenIssued,
  SubscriptionPayDone,
  SubscriptionUploadTicket,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  signIn,
  TEST_PASSWORD,
  TEST_SUBSCRIPTION,
} from '../../testing';

/*
 * Этап 3, П4 общего плана 20.11 (задача-проверка потока К): API-токены «Витрины данных» при закрытом и
 * снова открытом доступе организации — доработки 20.11.2026: Витрина данных, блок 5, пункт 8 («доступ
 * закрыт по подписке — токены организации не отвечают… после оплаты работают снова без
 * перевыпуска»); блок 8, пункт 1; доработки 20.11.2026, блок 4, пункт 4. Закрывают и открывают доступ
 * настоящие методы: «Изменить подписку» и «Заблокировать» / «Разблокировать» Админки, чек владельца на
 * экране «Подписка», «Подтвердить» / «Отклонить» чека. На каждом шаге — тот же токен: не отвечает
 * («Доступ остановлен», 403), в окне токена — «Остановлен» с причиной, но не «Отозван», и после
 * открытия работает без перевыпуска; в журнале запросов — итог «Доступ закрыт».
 * Сегодня в тестах — 18.10.2026.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { dmRequests, dmTemplates, dmTemplateSql, dmTokens, organizations, orgSettings } = schema;
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.7\nчек');

describe.skipIf(!databaseAvailable())(
  'Этап 3, П4: токены «Витрины данных» при закрытом и снова открытом доступе (Витрина данных, блок 5, пункт 8)',
  () => {
    let f: Fixture;
    let storage: MemoryStorage;
    let owner = '';
    let admin = '';
    let token = '';
    let tokenId = '';
    let ipN = 0;

    const call = (cookie: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    /** Свой адрес у каждого запроса: предел неверных токенов по адресу здесь ни при чём. */
    const ext = () =>
      f.app.request('/api/ext/v1/k-closed', {
        headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `198.51.100.${++ipN}` },
      });
    const card = async (cookie: string, base: '/api/dm' | '/api/admin/dm') => {
      const res = await call(cookie, 'GET', `${base}/tokens/${tokenId}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return DmTokenCard.parse(await res.json());
    };
    /** Строка токена в базе: не отозван и не перевыпущен — тот же хеш и срок. */
    const tokenRow = async () =>
      (
        await f.t.admin.db
          .select({
            hash: dmTokens.tokenHash,
            revokedAt: dmTokens.revokedAt,
            graceUntil: dmTokens.graceUntil,
            expiresAt: dmTokens.expiresAt,
          })
          .from(dmTokens)
          .where(eq(dmTokens.id, tokenId))
      )[0]!;
    let issued: Awaited<ReturnType<typeof tokenRow>>;
    let closedCalls = 0;

    /** Токен не отвечает, в окне (у Админки — владелец закрытой организации окна не открывает) — «Остановлен». */
    const stopped = async (stop: 'sub_closed' | 'org_blocked') => {
      const res = await ext();
      expect(res.status, await res.clone().text()).toBe(403);
      const { error } = (await res.json()) as { error: { code: string; message: string } };
      expect(error).toMatchObject({ code: 'dm_ext_stopped', message: 'Доступ остановлен' });
      closedCalls += 1;
      expect(await card(admin, '/api/admin/dm')).toMatchObject({
        state: 'stopped',
        stop,
        note: UI_TEXTS[`dm.tok.stop.${stop}`].ru,
      });
      expect(await tokenRow()).toEqual(issued);
    };
    /** Тот же токен снова отвечает строками; в окне владельца — «Действует». */
    const works = async () => {
      const res = await ext();
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await card(owner, '/api/dm')).toMatchObject({ state: 'active', stop: null });
      expect(await tokenRow()).toEqual(issued);
    };

    const subscription = async () =>
      (
        await f.t.admin.db
          .select()
          .from(schema.orgSubscriptions)
          .where(eq(schema.orgSubscriptions.orgId, f.a.orgId))
      )[0];
    /** Админка → «Изменить подписку»: «Оплачено до» с причиной. */
    const adminPaidUntil = async (paidUntil: string) => {
      const sub = (await subscription())!;
      const res = await call(admin, 'PUT', `/api/admin/subscriptions/${f.a.orgId}`, {
        planId: sub.planId,
        seats: sub.seats,
        extraGb: sub.extraGb,
        paidUntil,
        extraDiscountPct: sub.extraDiscountPct,
        reason: 'Проверка токенов при закрытом доступе',
        version: sub.version,
      });
      expect(res.status, await res.clone().text()).toBe(200);
    };
    /** Владелец прикрепляет чек на экране «Подписка» (продление на месяц). */
    const ownerReceipt = async () => {
      const pay = { kind: 'renew', planId: 'm1', seats: 10, extraGb: 0, startMode: 'now' };
      const file = { name: 'Чек подписки.pdf', size: PDF.length };
      let res = await call(owner, 'POST', '/api/org/subscription/payments/start', { pay, file });
      expect(res.status, await res.clone().text()).toBe(201);
      const ticket = SubscriptionUploadTicket.parse(await res.json());
      const url = new URL(ticket.upload.url);
      await storage.put(`${url.host}${url.pathname}`, PDF, {
        contentType: ticket.upload.headers['content-type']!,
      });
      res = await call(owner, 'POST', '/api/org/subscription/payments/complete', {
        id: ticket.id,
        pay,
        file,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      return SubscriptionPayDone.parse(await res.json());
    };
    const adminDecide = async (id: string, decision: 'confirm' | 'reject') => {
      const [row] = await f.t.admin.db
        .select({ version: schema.subscriptionPayments.version })
        .from(schema.subscriptionPayments)
        .where(eq(schema.subscriptionPayments.id, id));
      const body =
        decision === 'confirm'
          ? { months: 1, paidUntil: '2026-11-17', version: row!.version }
          : { reason: 'Сумма в чеке не совпадает', version: row!.version };
      const res = await call(
        admin,
        'POST',
        `/api/admin/subscriptions/payments/${id}/${decision}`,
        body,
      );
      expect(res.status, await res.clone().text()).toBe(200);
    };
    const orgStatus = async (action: 'block' | 'unblock') => {
      const [org] = await f.t.admin.db
        .select({ version: organizations.version })
        .from(organizations)
        .where(eq(organizations.id, f.a.orgId));
      const res = await call(admin, 'POST', `/api/admin/organizations/${f.a.orgId}/${action}`, {
        version: org!.version,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminOrganization.parse(await res.json());
    };
    /** «Оплачено до» тестовой организации как было: без чеков. */
    const restoreSubscription = async () => {
      await f.t.admin.db
        .delete(schema.subscriptionPayments)
        .where(eq(schema.subscriptionPayments.orgId, f.a.orgId));
      await f.t.admin.db
        .insert(schema.orgSubscriptions)
        .values({
          orgId: f.a.orgId,
          planId: 'm1',
          seats: TEST_SUBSCRIPTION.seats,
          paidUntil: TEST_SUBSCRIPTION.paidUntil,
        })
        .onConflictDoUpdate({
          target: schema.orgSubscriptions.orgId,
          set: { paidUntil: TEST_SUBSCRIPTION.paidUntil, seats: TEST_SUBSCRIPTION.seats },
        });
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      storage = f.deps.storage as MemoryStorage;
      await seedAllPlatformDictionaries(f.t.admin.db);
      const db = f.t.admin.db;
      await db.update(orgSettings).set({ extApi: true });
      const [tpl] = await db
        .insert(dmTemplates)
        .values({
          code: 'k-closed',
          name: 'Сотрудники (проверка закрытого доступа)',
          module: 'staff',
          state: 'published',
          columns: [
            { code: 'name', name: 'Сотрудник', type: 'text', total: false, contractor: false },
          ],
        })
        .returning({ id: dmTemplates.id });
      await db.insert(dmTemplateSql).values({
        templateId: tpl!.id,
        query: 'SELECT e.short_name AS name FROM employees e ORDER BY e.short_name',
      });
      [owner, admin] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'platform-admin', TEST_PASSWORD),
      ]);
      const res = await call(owner, 'POST', '/api/dm/tokens', {
        templateId: tpl!.id,
        name: 'Закрытый доступ',
        term: 30,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const out = DmTokenIssued.parse(await res.json());
      token = out.token;
      tokenId = out.item.id;
      issued = await tokenRow();
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('срок прошёл → чек владельца → отклонён → новый чек → подтверждён; «Нет подписки» → первый чек; блокировка → разблокировка: тот же токен без перевыпуска', async () => {
      try {
        await works();

        // Администратор ставит «Оплачено до» — вчера: доступ закрыт со следующего дня после срока.
        await adminPaidUntil('2026-10-17');
        await stopped('sub_closed');

        // Владелец закрытой организации прикрепляет чек: доступ открыт сразу, до проверки.
        const first = await ownerReceipt();
        expect(first.opensAccess).toBe(true);
        await works();

        // Чек отклонён: «Оплачено до» прошло — снова закрыто.
        await adminDecide(first.id, 'reject');
        await stopped('sub_closed');

        // Новый чек после отклонения доступ до подтверждения не открывает.
        const second = await ownerReceipt();
        expect(second.opensAccess).toBe(false);
        await stopped('sub_closed');

        // Чек подтверждён: «Оплачено до» — 17.11, токен работает без перевыпуска.
        await adminDecide(second.id, 'confirm');
        await works();

        // «Нет подписки» — как прошедший срок; первый чек организации открывает доступ сразу.
        await f.t.admin.db
          .delete(schema.subscriptionPayments)
          .where(eq(schema.subscriptionPayments.orgId, f.a.orgId));
        await f.t.admin.db
          .delete(schema.orgSubscriptions)
          .where(eq(schema.orgSubscriptions.orgId, f.a.orgId));
        await stopped('sub_closed');
        expect((await ownerReceipt()).opensAccess).toBe(true);
        await works();

        // Администратор блокирует организацию — токен остановлен; разблокирует — работает снова.
        expect((await orgStatus('block')).active).toBe(false);
        await stopped('org_blocked');
        expect((await orgStatus('unblock')).active).toBe(true);
        await works();

        // Журнал запросов токена: каждый отказ — «Доступ закрыт», остальные — «Успешно»; токен у
        // организации один — его не перевыпускали.
        const log = await f.t.admin.db
          .select({ outcome: dmRequests.outcome })
          .from(dmRequests)
          .where(eq(dmRequests.tokenId, tokenId))
          .orderBy(dmRequests.id);
        expect(log.filter((r) => r.outcome === 'closed')).toHaveLength(closedCalls);
        expect(log.filter((r) => r.outcome !== 'closed').map((r) => r.outcome)).toEqual(
          Array.from({ length: log.length - closedCalls }, () => 'ok'),
        );
        expect(closedCalls).toBe(5);
        const tokens = await f.t.admin.db
          .select({ id: dmTokens.id })
          .from(dmTokens)
          .where(eq(dmTokens.orgId, f.a.orgId));
        expect(tokens.map((t) => t.id)).toEqual([tokenId]);
      } finally {
        await restoreSubscription();
      }
    });
  },
);
