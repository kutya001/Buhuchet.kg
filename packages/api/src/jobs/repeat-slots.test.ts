import { createHash, randomUUID } from 'node:crypto';
import { createFakeTelegram, createMemoryStorage, fixedClock, parseCron } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ContractorPage, ContractorTelegram, PublicPageTelegramLink } from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_WEBHOOK_SECRET,
} from '../testing';
import { jobsFor } from './registry';

/*
 * «Расписание не отправляет дважды» (доработки 20.11.2026, пакет 2, «Порядок работ» → «Этап 2 — общая
 * проверка», Т; поток Т, этап 2, П10). Каждая задача расписания (`jobsFor` с ботом и вебхуком) на
 * одной организации, где есть что отправить, запускается дважды на тот же запуск — так бывает, когда
 * исполнитель повторяет упавший или зависший слот, а первая попытка успела часть работы. Второй запуск
 * не добавляет ни сообщений Telegram (сразу и через очередь), ни строк колокольчика, ни сообщений
 * клиентам, ни отчётов, ни записей истории. Задачи, которым в этом наборе есть что отправить, первый
 * запуск отправляет — проверка не пустая. Потом следующий запуск того же дня (у задач «каждые 5 минут»
 * — через 5 минут) на тех же данных тоже ничего не добавляет. Новая задача расписания попадает в один из списков ниже,
 * иначе тест красный: так её повтор тоже проверяется.
 */

/** Задачи, которые в наборе данных теста что-то отправляют или создают с первого запуска. */
const SENDING = [
  'telegram.reminders',
  'telegram.bell-day',
  'telegram.send',
  'contractor-page.telegram-pay',
  'contractor-page.telegram-debt',
  'subs.reminders',
  'subs.memory-checks',
  'files.storage-reconcile',
  'dm.token-expiry',
] as const;

/** Задачи, которым здесь нечего отправлять (уборка, пересчёт, вебхук): повтор проверяется так же. */
const QUIET = [
  'system.cleanup-scheduler-runs',
  'auth.cleanup-login-attempts',
  'auth.watch-login-locks',
  'system.cleanup-rate-limits',
  'contractors.sync-service-status',
  'contractor-page.cleanup-grants',
  'telegram.bell-cleanup',
  'reports.create-due',
  // Серий повтора в наборе нет: ни задач, ни сообщений.
  'tasks.series',
  'tasks.series-notify',
  'files.cleanup-pending',
  'files.sent-purge',
  'files.storage-retry',
  'files.erase-deleted',
  'platform-dicts.dues-recalc',
  'kb.cleanup-video-uploads',
  'leads.docs-purge',
  'telegram.register-webhook',
  // Помечает сломанные шаблоны «Витрины данных»; администраторам — строка колокольчика при чтении.
  'dm.check-templates',
] as const;

const BASE = 'https://test.buhuchet.kg';
/** Понедельник, 19.10.2026 по Бишкеку: «День сводки» и день напоминаний о долге по умолчанию. */
const DAY = '2026-10-19';
const at = (hm: string) => new Date(`${DAY}T${hm}:00+06:00`);
const INN = '03744097401851';
const CHAT = { owner: 7101, acc: 7102, admin: 7109, client: 9001 } as const;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Effects = Record<string, number>;

describe.skipIf(!databaseAvailable())(
  'Этап 2, П10: задача расписания, запущенная дважды на тот же запуск, второй раз ничего не отправляет',
  () => {
    let f: Fixture;
    const tg = createFakeTelegram();
    const storage = createMemoryStorage();
    // Воскресенье 18.10.2026, 09:00 — подготовка данных; запуски задач — в понедельник.
    const clock = fixedClock('2026-10-18T03:00:00Z');
    // Ссылки «Открыть» в сообщениях — на сайт по https, как на стенде.
    const config = { ...createTestDeps().config, APP_BASE_URL: BASE };
    const deps = () => createTestDeps({ db: f.t.app.db, telegram: tg, storage, clock, config });
    let app: ReturnType<typeof createApp>;

    /** Всё, что задача может отправить или создать: второй запуск не должен менять ни одного числа. */
    const effects = async (): Promise<Effects> => {
      const [row] = await f.t.admin.db.execute<Effects>(sql`
        select
          (select count(*) from public.telegram_outbox)::integer as outbox,
          (select count(*) from public.telegram_outbox where status = 'sent')::integer as outbox_sent,
          (select count(*) from public.bell_notifications)::integer as bell,
          (select count(*) from public.contractor_telegram_messages)::integer as client_messages,
          (select count(*) from public.contractor_telegram_messages where message_id is not null)::integer
            as client_sent,
          (select count(*) from public.reports)::integer as reports,
          (select count(*) from public.audit_log)::integer as history,
          (select count(*) from public.org_memory_notices)::integer as memory_levels`);
      return { ...row, telegram: tg.sent.length, widgets: tg.widgets.length };
    };

    /** Включить страницу, ввести код, открыть ссылку на бота и подтвердить запрос (как в pay.test.ts). */
    async function linkClient(cookie: string, cp: string) {
      const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
        apiRequest(app, method, path, cookie, body);
      const on = await call('POST', `/api/contractors/${cp}/page/enable`);
      expect(on.status, await on.clone().text()).toBe(200);
      const { code } = ContractorPage.parse(await on.json());
      const grant = await app.request(`/api/page/org-a/${INN}/code`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(grant.status, await grant.clone().text()).toBe(200);
      const link = await app.request(`/api/page/org-a/${INN}/telegram`, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          cookie: (grant.headers.get('set-cookie') ?? '').split(';')[0]!,
        },
      });
      expect(link.status, await link.clone().text()).toBe(200);
      const token = new URL(PublicPageTelegramLink.parse(await link.json()).url).searchParams.get(
        'start',
      )!;
      const start = await sendToBot(
        app,
        telegramUpdate(`/start ${token}`, CHAT.client, { username: 'client' }),
      );
      expect(start.status).toBe(200);
      const list = ContractorTelegram.parse(
        await (await call('GET', `/api/contractors/${cp}/page/telegram`)).json(),
      );
      const row = list.items.find((x) => x.status === 'wait')!;
      const ok = await call('POST', `/api/contractors/${cp}/page/telegram/${row.id}`, {
        action: 'approve',
        version: row.version,
      });
      expect(ok.status, await ok.clone().text()).toBe(200);
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      app = createApp(deps());
      const a = f.a.orgId;
      // Всё, что шлёт бот: напоминания о сроках за 3 дня, «К оплате» клиенту, долг за обслуживание.
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({
          features: { telegram: true, tasks: true, cppage: true, taxpay: true, fee: true },
          remindDays: [3],
          cpTgPay: true,
          cpTgDebt: true,
        })
        .where(eq(schema.orgSettings.orgId, a));
      await f.t.admin.db
        .insert(schema.orgTelegramNotices)
        .values({ orgId: a, code: 'cp_pay', days: [5, 4, 3, 2, 1], atTime: '09:00' });
      const [owner, acc, admin] = await Promise.all([
        signIn(app, 'owner-a', TEST_PASSWORD),
        signIn(app, 'acc-a', TEST_PASSWORD),
        signIn(app, 'platform-admin', TEST_PASSWORD),
      ]);
      await linkTelegram(app, owner, CHAT.owner, 'owner_a');
      await linkTelegram(app, acc, CHAT.acc, 'acc_a');
      await linkTelegram(app, admin, CHAT.admin, 'platform');

      const types = await apiRequest(app, 'POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 'pat'],
        disconnect: [],
      });
      expect(types.status, await types.clone().text()).toBe(200);
      // Реквизит бухгалтера — без него «К оплате» клиенту не уходит; счёт организации — для долга.
      const wallet = await apiRequest(app, 'POST', '/api/profile/wallets', acc, {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        phone: '+996555123456',
        phoneBanks: ['БНК-13'],
        holderName: 'Бухгалтер А.',
        isMain: true,
      });
      expect(wallet.status, await wallet.clone().text()).toBeLessThan(300);
      const account = await apiRequest(app, 'POST', '/api/org/accounts', owner, {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        bik: null,
        phone: '+996555987654',
        phoneBanks: ['БНК-13'],
        holderName: 'Организация А',
        purpose: 'fee',
        mainTax: false,
        mainFee: true,
      });
      expect(account.status, await account.clone().text()).toBe(200);

      const accEmployee = f.people['acc-a']!.employeeId;
      // Контрагент «создан» в июне: с июля начисляется плата за обслуживание — к понедельнику долг.
      const [cp] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: a,
          name: 'ОсОО «Ала-Тоо Трейд»',
          inn: INN,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: accEmployee,
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
        })
        .returning({ id: schema.contractors.id });
      const cpId = cp!.id;
      await f.t.admin.db.insert(schema.contractorTariffs).values({
        orgId: a,
        contractorId: cpId,
        amount: 300_000,
        period: 'M',
        validFrom: '2026-07-01',
      });
      const sep = {
        orgId: a,
        contractorId: cpId,
        responsibleEmployeeId: accEmployee,
        period: 'M' as const,
        periodStart: '2026-09-01',
      };
      await f.t.admin.db.insert(schema.reports).values([
        // Уплата до 20.10 — «К оплате» клиенту «за 1 день» в понедельник.
        {
          ...sep,
          reportTypeCode: 'pat',
          act: 'pay',
          dueBase: '2026-10-20',
          dueDate: '2026-10-20',
          payDue: '2026-10-20',
          amount: 87_050,
        },
        // Сдача 22.10 — напоминание сотруднику «за 3 дня» и строка колокольчика.
        {
          ...sep,
          reportTypeCode: 'nds',
          act: 'both',
          dueBase: '2026-10-22',
          dueDate: '2026-10-22',
          payDue: '2026-10-25',
          amount: 500_000,
        },
      ]);
      await linkClient(owner, cpId);

      // Подписка А истекает через 5 дней; предел памяти 1 МБ, занято 0,9 МБ — «80 %».
      await f.t.admin.db
        .update(schema.orgSubscriptions)
        .set({ planId: 'm1', seats: 10, paidUntil: '2026-10-24', free: false })
        .where(eq(schema.orgSubscriptions.orgId, a));
      await f.t.admin.db.update(schema.subscriptionSettings).set({ baseMb: 1, seatMb: 0 });
      const fileId = randomUUID();
      await f.t.admin.db.insert(schema.files).values({
        id: fileId,
        orgId: a,
        sourceKind: 'manual',
        name: 'Выписка.pdf',
        contentType: 'application/pdf',
        sizeBytes: 900_000,
        storageKey: `org/${a}/files/${fileId}`,
        state: 'ready',
        createdBy: f.a.ownerUserId,
        createdAt: new Date('2026-10-10T05:00:00Z'),
      });
      // Чек Б ждёт проверки с 16.10 — администратору «ждёт проверки дней: N».
      const payB = randomUUID();
      await f.t.admin.db.insert(schema.subscriptionPayments).values({
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
        createdAt: new Date('2026-10-16T05:00:00Z'),
      });
      await storage.put(`org/${f.b.orgId}/subs/${payB}`, new Uint8Array(1000), {
        contentType: 'application/pdf',
      });
      // В хранилище — объект без записи (старше суток): у сверки есть новое расхождение.
      const extra = `org/${a}/files/${randomUUID()}`;
      await storage.put(extra, new Uint8Array(5), { contentType: 'application/pdf' });
      storage.setModified(extra, new Date('2026-10-15T05:00:00Z'));
      // API-токен «Витрины данных» на 30 дней, до конца срока 5 дней — владельцам «осталось дней: 5».
      const [dmTpl] = await f.t.admin.db
        .insert(schema.dmTemplates)
        .values({
          code: 'repeat-cps',
          name: 'Контрагенты',
          module: 'cps',
          state: 'published',
          columns: [{ k: 'n', type: 'int' }],
        })
        .returning({ id: schema.dmTemplates.id });
      const dmToken = `bk_${'R'.repeat(43)}`;
      await f.t.admin.db.insert(schema.dmTokens).values({
        orgId: a,
        templateId: dmTpl!.id,
        name: 'Power BI',
        tokenHash: createHash('sha256').update(dmToken).digest('hex'),
        prefix: dmToken.slice(0, 9),
        createdAt: new Date('2026-09-24T09:00:00+06:00'),
        expiresAt: new Date('2026-10-24T09:00:00+06:00'),
        createdBy: f.a.ownerUserId,
      });
      // Строки колокольчика подготовки (привязка клиента) записаны по постоянным часам теста, а
      // `app.bell_cleanup` убирает строки старше 90 дней по часам базы: без этого через 90 дней после
      // 18.10.2026 уборка удалила бы их и попала в «отправляет» (docs/typical-mistakes.md № 52, 57).
      await f.t.admin.db.update(schema.bellNotifications).set({ createdAt: sql`now()` });
      tg.sent.length = 0;
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('каждая задача — дважды на свой запуск: второй ничего не добавляет; кому есть что отправить — отправили', async () => {
      const all = jobsFor({
        APP_BASE_URL: BASE,
        TELEGRAM_BOT_TOKEN: 'test-bot-token',
        TELEGRAM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      });
      // Каждая задача расписания — в одном из списков.
      expect(all.map((j) => j.name).sort()).toEqual([...SENDING, ...QUIET].sort());

      // Первый запуск каждой задачи за день и часы напоминаний (09:00) и долга (10:00) по Бишкеку.
      const minutes = Array.from(
        { length: 24 * 60 },
        (_, i) => new Date(at('00:00').getTime() + i * 60_000),
      );
      const slots = new Map<number, Date>();
      for (const slot of [at('09:00'), at('10:00')]) slots.set(slot.getTime(), slot);
      for (const job of all) {
        const cron = parseCron(job.cron);
        const first = minutes.find((m) => cron.matches(m));
        expect(first, job.name).toBeDefined();
        slots.set(first!.getTime(), first!);
      }

      const sent = new Set<string>();
      const run = deps();
      for (const slot of [...slots.values()].sort((x, y) => x.getTime() - y.getTime())) {
        clock.set(slot.toISOString());
        // Отправка очереди — последней в запуске: ей достаются сообщения, поставленные в этот же запуск.
        const due = all
          .filter((j) => parseCron(j.cron).matches(slot))
          .sort((x, y) => Number(x.name === 'telegram.send') - Number(y.name === 'telegram.send'));
        for (const job of due) {
          const before = await effects();
          await job.run(run, slot);
          const once = await effects();
          await job.run(run, slot);
          expect(await effects(), `${job.name}, ${slot.toISOString()}`).toEqual(once);
          if (JSON.stringify(before) !== JSON.stringify(once)) sent.add(job.name);
        }
      }
      expect([...sent].sort()).toEqual([...SENDING].sort());
      // И сообщения действительно дошли: сотрудникам, клиенту и администратору платформы.
      const chats = new Set(tg.sent.map((m) => m.chatId));
      for (const chat of Object.values(CHAT)) expect(chats.has(chat), `чат ${chat}`).toBe(true);

      // Соседний запуск того же дня (у задач «каждые 5 минут» — 09:05 после 09:00): данные те же —
      // ничего нового. Первые запуски уже прошли, поэтому берётся следующая минута после самого
      // позднего из них.
      const last = Math.max(...slots.keys());
      const again = new Set<string>();
      for (const job of all) {
        const cron = parseCron(job.cron);
        const next = minutes.find((m) => m.getTime() > last && cron.matches(m));
        if (!next) continue;
        clock.set(next.toISOString());
        const before = await effects();
        await job.run(run, next);
        expect(await effects(), `${job.name}, соседний запуск ${next.toISOString()}`).toEqual(
          before,
        );
        again.add(job.name);
      }
      for (const name of [
        'telegram.reminders',
        'contractor-page.telegram-pay',
        'contractor-page.telegram-debt',
        'subs.reminders',
      ]) {
        expect(again.has(name), name).toBe(true);
      }
    });
  },
);
