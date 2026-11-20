import { randomUUID } from 'node:crypto';
import { createFakeTelegram, createMemoryStorage, fixedClock } from '@buhuchet/adapters';
import { schema, subscriptionNoticeSettings, withOrgContext } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  bellText,
  formatSomWithUnit,
  NOTIFY_KINDS,
  subscriptionCalc,
  subscriptionGbText,
  TELEGRAM_TEMPLATE_DEFAULTS,
  UI_TEXTS,
} from '@buhuchet/domain';
import { BellPage } from '@buhuchet/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  storageReconcileJob,
  subsMemoryChecksJob,
  subsRemindersJob,
} from '../../jobs/subscriptions';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { telegramSendJob } from './outbox';
import { notifySubCheckNew, notifySubOwners, subNoticeContext, type SubOwnerNotice } from './subs';

/*
 * Сообщения о подписке, памяти и сверке хранилища (доработки 20.11.2026, блок 4, пункт 3; блок 2,
 * пункт 5; пакет 2, блок 3, пункт 6; блок 6, пункт 3; поток Т, этап 1, П12–П13): задачи по расписанию
 * `subs.reminders`, `subs.memory-checks`, `files.storage-reconcile`, Telegram и колокольчик владельцев,
 * администраторам платформы — чеки на проверке и новые расхождения хранилища.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const {
  bellNotifications,
  files,
  organizations,
  orgMemoryNotices,
  orgSubscriptions,
  storageCheckItems,
  storageCheckRuns,
  subscriptionPayments,
  subscriptionSettings,
  telegramOutbox,
} = schema;

const BASE = 'https://test.buhuchet.kg';
const MB = 1024 * 1024;
// Пятница, 20.11.2026, 09:00 по Бишкеку — час напоминаний организации по умолчанию.
const NOW = '2026-11-20T03:00:00Z';
const slotOn = (day: string, hm = '09:00') => new Date(`${day}T${hm}:00+06:00`);
const tpl = (
  key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS,
  values: Record<string, string | number>,
) =>
  Object.entries(values).reduce<string>(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    TELEGRAM_TEMPLATE_DEFAULTS[key],
  );

describe.skipIf(!databaseAvailable())(
  'Подписки: напоминания, память, чеки и сверка хранилища',
  () => {
    let f: Fixture;
    let deps: ApiDeps;
    let app: ReturnType<typeof createApp>;
    const storage = createMemoryStorage();
    const tg = createFakeTelegram();
    const cookies: Record<string, string> = {};
    let adminId = '';
    let payB = '';

    const person = (login: string) => f.people[login]!;
    const outboxOf = (kind: 'sub' | 'sub_check' | 'storage_check') =>
      f.t.admin.db
        .select()
        .from(telegramOutbox)
        .where(eq(telegramOutbox.kind, kind))
        .orderBy(telegramOutbox.createdAt, telegramOutbox.id);
    const bellOf = (userId: string, event: string) =>
      f.t.admin.db
        .select()
        .from(bellNotifications)
        .where(and(eq(bellNotifications.userId, userId), eq(bellNotifications.event, event)));
    const bellPage = async (login: string) => {
      const res = await apiRequest(app, 'GET', '/api/bell?tab=all', cookies[login]);
      expect(res.status, await res.clone().text()).toBe(200);
      return BellPage.parse(await res.json()).items;
    };
    const addFile = async (orgId: string, sizeBytes: number, createdAt = new Date(NOW)) => {
      const id = randomUUID();
      const storageKey = `org/${orgId}/files/${id}`;
      await f.t.admin.db.insert(files).values({
        id,
        orgId,
        sourceKind: 'manual',
        name: `Файл ${id.slice(0, 4)}.pdf`,
        contentType: 'application/pdf',
        sizeBytes,
        storageKey,
        state: 'ready',
        createdBy: f.a.ownerUserId,
        createdAt,
      });
      return { id, storageKey };
    };
    const dropFiles = (ids: string[]) =>
      f.t.admin.db
        .update(files)
        .set({ state: 'deleted', deletedAt: new Date(NOW), deletedBy: f.a.ownerUserId })
        .where(inArray(files.id, ids));

    beforeAll(async () => {
      f = await createStaffFixture();
      deps = createTestDeps({ db: f.t.app.db, clock: fixedClock(NOW), telegram: tg, storage });
      app = createApp(deps);
      for (const login of ['owner-a', 'chief-a', 'acc-a', 'owner-b', 'platform-admin']) {
        cookies[login] = await signIn(app, login, TEST_PASSWORD);
      }
      await linkTelegram(app, cookies['owner-a']!, 7101, 'owner_a');
      await linkTelegram(app, cookies['chief-a']!, 7102, 'chief_a');
      await linkTelegram(app, cookies['platform-admin']!, 7109, 'platform');
      const [admin] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'platform-admin'));
      adminId = admin!.id;
      // У А — подписка на месяц до 25.11 (за 5 дней — «истекает»); у Б подписки пока нет.
      await f.t.admin.db.insert(orgSubscriptions).values({
        orgId: f.a.orgId,
        planId: 'm1',
        seats: 10,
        paidUntil: '2026-11-25',
      });
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«истекает»: владельцам — Telegram с кнопкой «Подписка» и строка колокольчика, раз в день; без подписки — ничего', async () => {
      const job = subsRemindersJob(BASE);
      // Не час напоминаний организации — никому.
      expect(await job.run(deps, slotOn('2026-11-20', '09:05'))).toBe(0);
      expect(await job.run(deps, slotOn('2026-11-20'))).toBe(1);
      const sent = await outboxOf('sub');
      // Только владельцу: главный бухгалтер с Telegram сообщения о подписке не получает.
      expect(sent.map((r) => r.userId)).toEqual([f.a.ownerUserId]);
      const settings = await subscriptionNoticeSettings(f.t.app.db);
      const renew = subscriptionCalc({
        kind: 'renew',
        prices: settings.prices,
        plan: { id: 'm1', months: 1, discountPct: 0 },
        sub: {
          planId: 'm1',
          seats: 10,
          extraGb: 0,
          paidUntil: '2026-11-25',
          extraDiscountPct: 0,
          firstPaid: false,
        },
        seats: 10,
        extraGb: 0,
        startMode: 'now',
        today: '2026-11-20',
      }).total;
      expect(renew).toBeGreaterThan(0);
      const text = tpl('tgSubSoon', {
        организация: 'Организация А',
        дата: '25.11.2026',
        дней: 5,
        сумма: formatSomWithUnit(renew),
      });
      expect(sent[0]).toMatchObject({
        orgId: f.a.orgId,
        chatId: 7101,
        text,
        dedupeKey: `sub_remind:2026-11-20:${f.a.ownerUserId}`,
      });
      expect(sent[0]!.payload?.buttons).toEqual([
        [{ text: TELEGRAM_TEMPLATE_DEFAULTS.tgBtnOpen, url: `${BASE}/app/org/sub` }],
      ]);
      expect(await bellOf(f.a.ownerUserId, 'sub')).toMatchObject([
        {
          kind: 'other',
          targetKind: 'sub',
          targetId: f.a.orgId,
          text: bellText(text),
          eventKey: 'sub_remind:2026-11-20',
        },
      ]);
      expect(await bellOf(person('chief-a').userId, 'sub')).toEqual([]);
      // Повтор того же запуска ничего не удваивает.
      expect(await job.run(deps, slotOn('2026-11-20'))).toBe(0);
      expect(await outboxOf('sub')).toHaveLength(1);
      // Сообщение уходит с кнопкой «Открыть» — по правилам Bot API (проверка подставного бота).
      await telegramSendJob().run(deps, new Date(NOW));
      expect(tg.sent.at(-1)).toMatchObject({ chatId: 7101, text });

      // Панель: строку видит владелец, главный бухгалтер — нет; открывает «Подписку».
      const owner = await bellPage('owner-a');
      expect(owner.filter((i) => i.event === 'sub')).toMatchObject([
        { kind: 'other', text: bellText(text), open: { kind: 'sub', id: f.a.orgId } },
      ]);
      expect((await bellPage('chief-a')).filter((i) => i.event === 'sub')).toEqual([]);
    });

    it('«просрочена» — каждый день; чек на проверке, демо и «Нет подписки» — без напоминаний', async () => {
      const job = subsRemindersJob(BASE);
      await f.t.admin.db.insert(orgSubscriptions).values({
        orgId: f.b.orgId,
        planId: 'm1',
        seats: 10,
        paidUntil: '2026-11-10',
      });
      // У Б — чек на проверке: напоминаний нет.
      payB = randomUUID();
      await f.t.admin.db.insert(subscriptionPayments).values({
        id: payB,
        orgId: f.b.orgId,
        kind: 'renew',
        planId: 'm1',
        months: 1,
        seats: 10,
        amount: 100_000,
        receiptKey: `org/${f.b.orgId}/subs/${payB}`,
        receiptName: 'Чек.pdf',
        receiptType: 'application/pdf',
        receiptBytes: 1000,
        createdBy: f.b.ownerUserId,
        createdAt: new Date('2026-11-18T05:00:00Z'),
      });
      await storage.put(`org/${f.b.orgId}/subs/${payB}`, new Uint8Array(1000), {
        contentType: 'application/pdf',
      });
      expect(await job.run(deps, slotOn('2026-11-21'))).toBe(1);
      expect((await outboxOf('sub')).map((r) => r.userId)).toEqual([
        f.a.ownerUserId,
        f.a.ownerUserId,
      ]);
      // Демо-организация — без напоминаний, даже со сроком в прошлом.
      await f.t.admin.db
        .update(organizations)
        .set({ isDemo: true })
        .where(eq(organizations.id, f.b.orgId));
      await f.t.admin.db.delete(subscriptionPayments).where(eq(subscriptionPayments.id, payB));
      expect(await job.run(deps, slotOn('2026-11-22'))).toBe(1);
      expect((await outboxOf('sub')).filter((r) => r.userId === f.b.ownerUserId)).toEqual([]);
      await f.t.admin.db
        .update(organizations)
        .set({ isDemo: false })
        .where(eq(organizations.id, f.b.orgId));
      expect(await job.run(deps, slotOn('2026-11-23'))).toBe(2);
      // У владельца Б нет Telegram — только строка колокольчика.
      expect((await outboxOf('sub')).filter((r) => r.userId === f.b.ownerUserId)).toEqual([]);
      const over = await bellOf(f.b.ownerUserId, 'sub');
      expect(over).toHaveLength(1);
      expect(over[0]!.text).toContain(
        '⛔ Подписка «Организация Б» не оплачена: срок закончился 10.11.2026.',
      );
      // У А срок прошёл 25.11 — теперь «просрочена»; без подписки (удалили) — снова тихо.
      await f.t.admin.db.delete(orgSubscriptions).where(eq(orgSubscriptions.orgId, f.b.orgId));
      expect(await job.run(deps, slotOn('2026-11-26'))).toBe(1);
      expect((await outboxOf('sub')).at(-1)).toMatchObject({
        userId: f.a.ownerUserId,
        text: expect.stringContaining('срок закончился 25.11.2026'),
      });
    });

    it('память 80 % и 100 % — владельцам один раз, пока занятое не опустится ниже порога', async () => {
      const job = subsMemoryChecksJob(BASE);
      // Предел А — 1 МБ: включённая память 1 МБ, место пакета — 0.
      await f.t.admin.db.update(subscriptionSettings).set({ baseMb: 1, seatMb: 0 });
      await f.t.admin.db.delete(telegramOutbox).where(eq(telegramOutbox.kind, 'sub'));
      const first = await addFile(f.a.orgId, 900_000);
      expect(await job.run(deps, slotOn('2026-11-20'))).toBe(1);
      let sent = await outboxOf('sub');
      expect(sent).toMatchObject([
        {
          userId: f.a.ownerUserId,
          text: tpl('tgSubMem80', {
            организация: 'Организация А',
            занято: subscriptionGbText(900_000),
            лимит: subscriptionGbText(MB),
          }),
          dedupeKey: `sub_mem:80:2026-11-20:${f.a.ownerUserId}`,
        },
      ]);
      expect(await bellOf(f.a.ownerUserId, 'sub')).toContainEqual(
        expect.objectContaining({ eventKey: 'sub_mem:80:2026-11-20' }),
      );
      // Тот же порог на следующий день — молчим: порог запомнен.
      expect(await job.run(deps, slotOn('2026-11-21'))).toBe(0);
      const second = await addFile(f.a.orgId, 200_000);
      expect(await job.run(deps, slotOn('2026-11-21'))).toBe(1);
      sent = await outboxOf('sub');
      expect(sent.at(-1)!.text).toBe(
        tpl('tgSubMemFull', {
          организация: 'Организация А',
          занято: subscriptionGbText(1_100_000),
          лимит: subscriptionGbText(MB),
        }),
      );
      // Опустилась ниже 80 % — порог сброшен, новый подъём сообщит снова.
      await dropFiles([first.id, second.id]);
      expect(await job.run(deps, slotOn('2026-11-22'))).toBe(0);
      const [level] = await f.t.admin.db
        .select({ level: orgMemoryNotices.level })
        .from(orgMemoryNotices)
        .where(eq(orgMemoryNotices.orgId, f.a.orgId));
      expect(level?.level).toBe(0);
      const third = await addFile(f.a.orgId, 900_000);
      expect(await job.run(deps, slotOn('2026-11-23'))).toBe(1);
      expect((await outboxOf('sub')).at(-1)!.dedupeKey).toBe(
        `sub_mem:80:2026-11-23:${f.a.ownerUserId}`,
      );
      await dropFiles([third.id]);
      // У Б подписки нет — предела нет, сообщений нет.
      expect((await outboxOf('sub')).filter((r) => r.userId === f.b.ownerUserId)).toEqual([]);
    });

    it('чек на проверке: «Новый чек» один раз, со следующего дня — «ждёт проверки дней: N» раз в день', async () => {
      await f.t.admin.db.delete(telegramOutbox).where(eq(telegramOutbox.kind, 'sub_check'));
      payB = randomUUID();
      await f.t.admin.db.insert(subscriptionPayments).values({
        id: payB,
        orgId: f.b.orgId,
        kind: 'renew',
        planId: 'm1',
        months: 1,
        seats: 10,
        amount: 100_000,
        receiptKey: `org/${f.b.orgId}/subs/${payB}`,
        receiptName: 'Чек.pdf',
        receiptType: 'application/pdf',
        receiptBytes: 1000,
        createdBy: f.b.ownerUserId,
        createdAt: new Date('2026-11-18T05:00:00Z'),
      });
      await storage.put(`org/${f.b.orgId}/subs/${payB}`, new Uint8Array(1000), {
        contentType: 'application/pdf',
      });
      // Стык с потоком И: «Отправить на проверку» зовёт это в своей транзакции.
      const nc = await subNoticeContext(deps, BASE);
      const facts = {
        payId: payB,
        orgName: 'Организация Б',
        kind: 'renew' as const,
        amount: 100_000,
      };
      const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
        withOrgContext(f.t.app.db, { orgId: f.b.orgId, userId: f.b.ownerUserId }, fn);
      expect(await inB((tx) => notifySubCheckNew(tx, nc, facts))).toBe(1);
      expect(await inB((tx) => notifySubCheckNew(tx, nc, facts))).toBe(0);
      let sent = await outboxOf('sub_check');
      expect(sent).toMatchObject([
        {
          orgId: null,
          userId: adminId,
          chatId: 7109,
          text: tpl('tgSubCheckNew', {
            организация: 'Организация Б',
            что: UI_TEXTS['telegram.sub.what.renew'].ru,
            сумма: formatSomWithUnit(100_000),
          }),
        },
      ]);

      const job = subsMemoryChecksJob(BASE);
      expect(await job.run(deps, slotOn('2026-11-20'))).toBe(1);
      expect(await job.run(deps, slotOn('2026-11-20'))).toBe(0);
      sent = await outboxOf('sub_check');
      expect(sent.at(-1)).toMatchObject({
        userId: adminId,
        text: tpl('tgSubCheckWait', {
          организация: 'Организация Б',
          сумма: formatSomWithUnit(100_000),
          дней: 2,
        }),
      });
      // Ни владельцам, ни сотрудникам организации такие сообщения не уходят.
      expect(sent.every((r) => r.userId === adminId)).toBe(true);
    });

    it('сверка хранилища: расхождения в базу, новые — администратору один раз; список не прочитался — запуск с ошибкой', async () => {
      await f.t.admin.db.delete(telegramOutbox).where(eq(telegramOutbox.kind, 'storage_check'));
      const day = 86_400_000;
      // Файл в хранилище есть — всё хорошо; файла нет — «Нет в хранилище»; объект без записи — лишний.
      const ok = await addFile(f.a.orgId, 10, new Date(Date.parse(NOW) - 2 * day));
      await storage.put(ok.storageKey, new Uint8Array(10), { contentType: 'application/pdf' });
      const lost = await addFile(f.a.orgId, 10, new Date(Date.parse(NOW) - 2 * day));
      const extraKey = `org/${f.a.orgId}/files/${randomUUID()}`;
      await storage.put(extraKey, new Uint8Array(5), { contentType: 'application/pdf' });
      storage.setModified(extraKey, new Date(Date.parse(NOW) - 3 * day));
      // Вне `org/` (заявки, видео) сверка не смотрит.
      await storage.put(`leads/upload/${randomUUID()}`, new Uint8Array(5), {
        contentType: 'application/pdf',
      });

      const job = storageReconcileJob(BASE);
      const objects = (await storage.list('org/')).items.length;
      expect(await job.run(deps, new Date(NOW))).toBe(objects);
      const items = await f.t.admin.db
        .select({ kind: storageCheckItems.kind, key: storageCheckItems.key })
        .from(storageCheckItems);
      expect(items).toEqual(
        expect.arrayContaining([
          { kind: 'missing', key: lost.storageKey },
          { kind: 'extra', key: extraKey },
        ]),
      );
      expect(items.map((i) => i.key)).not.toContain(ok.storageKey);
      const sent = await outboxOf('storage_check');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ orgId: null, userId: adminId, chatId: 7109 });
      expect(sent[0]!.text).toContain('Сверка хранилища нашла новые расхождения: 2.');
      // Повтор: те же расхождения — не новые, сообщения нет.
      await job.run(deps, new Date(NOW));
      expect(await outboxOf('storage_check')).toHaveLength(1);

      // Хранилище не ответило — запуск записан с ошибкой, задача падает (оповещение о сбое — у раннера).
      const broken = createTestDeps({
        db: f.t.app.db,
        clock: fixedClock(NOW),
        telegram: tg,
        storage: {
          ...storage,
          list: () =>
            Promise.reject(
              Object.assign(new Error('getaddrinfo ENOTFOUND bucket.s3.example'), {
                name: 'NoSuchBucket',
                $metadata: { httpStatusCode: 404 },
              }),
            ),
        },
      });
      await expect(job.run(broken, new Date(NOW))).rejects.toThrow('ENOTFOUND');
      const [last] = await f.t.admin.db
        .select()
        .from(storageCheckRuns)
        .orderBy(desc(storageCheckRuns.id))
        .limit(1);
      // В итог — вид ошибки и код ответа, без текста: в нём бывает адрес хранилища.
      expect(last).toMatchObject({ state: 'failed', error: 'NoSuchBucket 404' });
      expect(await outboxOf('storage_check')).toHaveLength(1);
      await dropFiles([ok.id, lost.id]);
    });

    it('колокольчик Админки: чеки на проверке и сверка — только администратору платформы', async () => {
      const admin = await bellPage('platform-admin');
      expect(admin.filter((i) => i.event === 'sub_check').map((i) => i.text)).toEqual(
        expect.arrayContaining(
          [
            tpl('tgSubCheckNew', {
              организация: 'Организация Б',
              что: UI_TEXTS['telegram.sub.what.renew'].ru,
              сумма: formatSomWithUnit(100_000),
            }),
            tpl('tgSubCheckWait', {
              организация: 'Организация Б',
              сумма: formatSomWithUnit(100_000),
              дней: 2,
            }),
          ].map(bellText),
        ),
      );
      expect(admin.find((i) => i.event === 'sub_check')?.open).toEqual({
        kind: 'sub_check',
        id: f.b.orgId,
      });
      expect(admin.filter((i) => i.event === 'storage_check')).toMatchObject([
        { kind: 'other', open: { kind: 'storage_check', id: expect.any(String) } },
      ]);
      // Повторное чтение строк не удваивает.
      expect((await bellPage('platform-admin')).length).toBe(admin.length);
      for (const login of ['owner-b', 'owner-a', 'acc-a']) {
        const own = await bellPage(login);
        expect(own.filter((i) => i.event === 'sub_check' || i.event === 'storage_check')).toEqual(
          [],
        );
      }
    });

    it('«Оплата подтверждена» и «Чек отклонён» — владельцам Telegram и колокольчик; повтор с тем же ключом ничего не добавляет', async () => {
      const ctx = await subNoticeContext(deps, BASE);
      const send = (notice: SubOwnerNotice, key: string) =>
        withOrgContext(f.t.app.db, { orgId: f.a.orgId, kind: 'job' }, (tx) =>
          notifySubOwners(tx, ctx, f.a.orgId, notice, key),
        );
      const paid = { event: 'paid', org: 'Организация А', paidUntil: '2026-12-25' } as const;
      const rejected = {
        event: 'rejected',
        org: 'Организация А',
        reason: 'Сумма в чеке не совпадает',
      } as const;
      expect(await send(paid, 'sub_paid:t1')).toMatchObject({
        queued: [expect.any(String)],
        added: 1,
      });
      expect(await send(paid, 'sub_paid:t1')).toEqual({ queued: [], added: 0 });
      expect(await send(rejected, 'sub_rejected:t2')).toMatchObject({ added: 1 });
      const paidText = tpl('tgSubPaid', { организация: 'Организация А', дата: '25.12.2026' });
      const rejectedText = tpl('tgSubRejected', {
        организация: 'Организация А',
        причина: 'Сумма в чеке не совпадает',
      });
      const sent = (await outboxOf('sub')).filter((r) => r.dedupeKey?.startsWith('sub_'));
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: f.a.ownerUserId,
            chatId: 7101,
            text: paidText,
            dedupeKey: `sub_paid:t1:${f.a.ownerUserId}`,
          }),
          expect.objectContaining({
            userId: f.a.ownerUserId,
            text: rejectedText,
            dedupeKey: `sub_rejected:t2:${f.a.ownerUserId}`,
          }),
        ]),
      );
      expect(sent.filter((r) => r.dedupeKey?.startsWith('sub_paid:t1'))).toHaveLength(1);
      const bell = await bellOf(f.a.ownerUserId, 'sub');
      expect(bell.filter((b) => b.eventKey === 'sub_paid:t1')).toMatchObject([
        { kind: 'other', targetKind: 'sub', targetId: f.a.orgId, text: bellText(paidText) },
      ]);
      expect(bell.filter((b) => b.eventKey === 'sub_rejected:t2')).toHaveLength(1);
      // Только владельцам: главному бухгалтеру — ничего.
      expect(
        (await bellOf(person('chief-a').userId, 'sub')).filter((b) =>
          b.eventKey?.startsWith('sub_'),
        ),
      ).toEqual([]);

      // Это сообщения о доступе к сайту: переключатели уведомлений профиля и «Напоминания в Telegram»
      // организации их не выключают (как в прототипе).
      const db = f.t.admin.db;
      const [was] = await db
        .select({ features: schema.orgSettings.features })
        .from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      await db
        .insert(schema.telegramNotifySettings)
        .values({
          userId: f.a.ownerUserId,
          orgId: f.a.orgId,
          mode: 'manual',
          off: [...NOTIFY_KINDS],
        })
        .onConflictDoUpdate({
          target: schema.telegramNotifySettings.userId,
          set: { mode: 'manual', off: [...NOTIFY_KINDS] },
        });
      await db
        .update(schema.orgSettings)
        .set({ features: { ...was!.features, telegram: false } })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      try {
        expect(await send(paid, 'sub_paid:t3')).toMatchObject({
          queued: [expect.any(String)],
          added: 1,
        });
        await telegramSendJob().run(deps, new Date(NOW));
        const [t3] = await db
          .select({ status: telegramOutbox.status, chatId: telegramOutbox.chatId })
          .from(telegramOutbox)
          .where(eq(telegramOutbox.dedupeKey, `sub_paid:t3:${f.a.ownerUserId}`));
        expect(t3).toEqual({ status: 'sent', chatId: 7101 });
        expect(tg.sent).toEqual(
          expect.arrayContaining([expect.objectContaining({ chatId: 7101, text: paidText })]),
        );
      } finally {
        await db
          .delete(schema.telegramNotifySettings)
          .where(eq(schema.telegramNotifySettings.userId, f.a.ownerUserId));
        await db
          .update(schema.orgSettings)
          .set({ features: was!.features })
          .where(eq(schema.orgSettings.orgId, f.a.orgId));
      }
    });
  },
);
