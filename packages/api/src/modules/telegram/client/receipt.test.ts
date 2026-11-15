import type { FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  BOT_ASK_CANCEL,
  botPressData,
  CP_TG_FILE_TO_ACTION,
  CP_TG_PAID_ACTION,
  CP_TG_RECEIPT_ACTION,
  fillTemplate,
  TELEGRAM_TEMPLATE_DEFAULTS,
} from '@buhuchet/domain';
import {
  ContractorPage,
  ContractorTelegram,
  PublicPageTelegramLink,
  SentFileAccepted,
} from '@buhuchet/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../../testing';
import { addSentFiles } from '../../files/sent-add';

/*
 * Чек к оплате и файлы клиента через бота (доработки 14.11.2026, блок 2, пункт 1 и блок 4, пункт 4,
 * этап 2; прототип v115 modules/cp-telegram.js: pgFileIn, pgFileFromTg, tgAct('cp-file-to'),
 * pgRcptBtn, tgAct('cp-receipt'), tgAct('askCancel')). Сегодня в тестах — 18.10.2026.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const MBANK = 'БНК-13';
const CP_A = 'ОсОО «Ала-Тоо Трейд»';
const CP_A2 = 'ОсОО «Ош Строй»';
const CP_B = 'ОсОО «Бишкек»';
const MONTHLY = 300_000;
const DEBT = 3 * MONTHLY;
const STAFF_TEXT = 'Долг за обслуживание. Пожалуйста, оплатите до 20.10.2026.';

const CHAT_ACC = 7201;
/** Подключён к «Ала-Тоо Трейд», «Ош Строй» (организация А) и «Бишкек» (организация Б). */
const CLIENT_1 = 9201;
/** Подключён только к «Ала-Тоо Трейд». */
const CLIENT_2 = 9202;
const CLIENT_B = 9203;
const STRANGER = 9299;

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.7\nчек');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);

describe.skipIf(!databaseAvailable())(
  'Чек и файлы клиента через бота (доработки 14.11.2026, блок 2, п. 1 и блок 4, п. 4; прототип v115)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let owner: string;
    let ownerB: string;
    let hr: string;
    let cpA = '';
    let cpA2 = '';
    let cpB = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      cookie: string | undefined,
      method: 'GET' | 'POST' | 'DELETE',
      path: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
    const text = (
      key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS,
      values: Record<string, string | number> = {},
    ) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], values);

    const features = (orgId: string, value: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: value })
        .where(eq(schema.orgSettings.orgId, orgId));
    const FILES_ON = { cppage: true, telegram: true, taxpay: true, fee: true, files: true };
    const filesUpload = (cp: string, on: boolean) =>
      f.t.admin.db
        .update(schema.contractorPages)
        .set({ filesUpload: on })
        .where(eq(schema.contractorPages.contractorId, cp));

    async function contractor(orgId: string, name: string, inn: string, responsible: string) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          feeDay: 20,
          responsibleEmployeeId: responsible,
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
        })
        .returning({ id: schema.contractors.id });
      await f.t.admin.db.insert(schema.contractorTariffs).values({
        orgId,
        contractorId: row!.id,
        amount: MONTHLY,
        period: 'M',
        validFrom: '2026-07-01',
      });
      return row!.id;
    }

    /** Включить страницу, ввести код в «браузере», открыть ссылку на бота и подтвердить запрос. */
    async function linkClient(
      cookie: string,
      cp: string,
      inn: string,
      slug: string,
      chatId: number,
      name: string,
    ) {
      const page = await call(cookie, 'GET', `/api/contractors/${cp}/page`);
      let code = ContractorPage.parse(await page.json()).code;
      if (!code) {
        const on = await call(cookie, 'POST', `/api/contractors/${cp}/page/enable`);
        expect(on.status, await on.clone().text()).toBe(200);
        code = ContractorPage.parse(await on.json()).code;
      }
      const grant = await f.app.request(`/api/page/${slug}/${inn}/code`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(grant.status, await grant.clone().text()).toBe(200);
      const link = await f.app.request(`/api/page/${slug}/${inn}/telegram`, {
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
      const started = await sendToBot(
        f.app,
        telegramUpdate(`/start ${token}`, chatId, { username: name }),
      );
      expect(started.status).toBe(200);
      const list = await call(cookie, 'GET', `/api/contractors/${cp}/page/telegram`);
      const row = ContractorTelegram.parse(await list.json()).items.find(
        (x) => x.status === 'wait',
      )!;
      const ok = await call(cookie, 'POST', `/api/contractors/${cp}/page/telegram/${row.id}`, {
        action: 'approve',
        version: row.version,
      });
      expect(ok.status, await ok.clone().text()).toBe(200);
    }

    const press = async (data: string, chatId: number, messageId: number) => {
      const before = tg.answers.length;
      const res = await sendToBot(f.app, telegramPress(data, chatId, messageId));
      expect(res.status).toBe(200);
      return tg.answers.length > before ? tg.answers.at(-1) : undefined;
    };
    /** Клиент присылает боту файл: документ (по умолчанию) или фото, ответом на сообщение или без. */
    const sendFile = async (
      chatId: number,
      o: {
        name?: string;
        body?: Uint8Array;
        photo?: boolean;
        replyTo?: number;
        caption?: string;
      } = {},
    ) => {
      const fileId = `tg-file-${tg.files.size + 1}`;
      const body = o.body ?? PDF;
      tg.files.set(fileId, body);
      const res = await sendToBot(
        f.app,
        telegramUpdate(null, chatId, {
          ...(o.replyTo === undefined ? {} : { replyTo: o.replyTo }),
          ...(o.caption ? { caption: o.caption } : {}),
          ...(o.photo
            ? { photo: [{ fileId, size: body.byteLength }] }
            : { document: { fileId, name: o.name ?? 'Чек.pdf', size: body.byteLength } }),
        }),
      );
      expect(res.status).toBe(200);
    };
    const sendText = async (chatId: number, body: string, replyTo?: number) => {
      const res = await sendToBot(
        f.app,
        telegramUpdate(body, chatId, replyTo === undefined ? {} : { replyTo }),
      );
      expect(res.status).toBe(200);
    };
    const sentTo = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
    const lastText = (chatId: number) => sentTo(chatId).at(-1)?.text;
    const lastMessageId = (chatId: number) => {
      const i = tg.sent.map((m) => m.chatId).lastIndexOf(chatId);
      return tg.messageIds[i]!;
    };
    const paidData = botPressData(CP_TG_PAID_ACTION, 'fee');
    const receiptData = botPressData(CP_TG_RECEIPT_ACTION, 'fee');

    /** «Напомнить в Telegram» владельцем: сообщение «Оплата за обслуживание» обоим клиентам «Ала-Тоо». */
    const feeMessage = async () => {
      const res = await call(owner, 'POST', `/api/contractors/${cpA}/fee-telegram`, {
        text: STAFF_TEXT,
      });
      expect(res.status, await res.clone().text()).toBe(200);
    };
    const sentFiles = (cp: string) =>
      f.t.admin.db
        .select()
        .from(schema.contractorSentFiles)
        .where(eq(schema.contractorSentFiles.contractorId, cp))
        .orderBy(asc(schema.contractorSentFiles.createdAt), asc(schema.contractorSentFiles.name));
    const claims = (cp: string) =>
      f.t.admin.db
        .select({
          purpose: schema.contractorPayClaims.purpose,
          amount: schema.contractorPayClaims.amount,
          sentFileId: schema.contractorPayClaims.sentFileId,
          tgMessageId: schema.contractorPayClaims.tgMessageId,
          status: schema.contractorPayClaims.status,
        })
        .from(schema.contractorPayClaims)
        .where(eq(schema.contractorPayClaims.contractorId, cp))
        .orderBy(asc(schema.contractorPayClaims.createdAt));
    const feeRowOf = async (chatId: number) =>
      (
        await f.t.admin.db
          .select({ id: schema.contractorTelegramMessages.id })
          .from(schema.contractorTelegramMessages)
          .where(
            sql`${schema.contractorTelegramMessages.chatId} = ${chatId} and ${schema.contractorTelegramMessages.kind} = 'fee'`,
          )
      )[0]!.id;
    const wipe = async () => {
      await f.t.admin.db.delete(schema.contractorPayClaims);
      await f.t.admin.db.delete(schema.contractorSentFiles);
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await f.t.admin.db.execute(
        sql`delete from rate_limits where kind like 'cp_tg_file%' or kind = 'cp_tg_receipt'`,
      );
      await f.t.admin.db.delete(schema.telegramOutbox);
      tg.sent.length = 0;
      tg.messageIds.length = 0;
      tg.answers.length = 0;
      tg.edits.length = 0;
      tg.files.clear();
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      tg = f.deps.telegram as FakeTelegram;
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features(f.a.orgId, FILES_ON);
      await features(f.b.orgId, FILES_ON);
      [owner, ownerB, hr] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
        signIn(f.app, 'hr-a', TEST_PASSWORD),
      ]);
      cpA = await contractor(f.a.orgId, CP_A, '03744097401851', employee('acc-a'));
      cpA2 = await contractor(f.a.orgId, CP_A2, '03744097401853', employee('acc-a'));
      cpB = await contractor(f.b.orgId, CP_B, '03744097401852', employee('acc-b'));
      const account = await call(owner, 'POST', '/api/org/accounts', {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        bik: null,
        phone: '+996555987654',
        phoneBanks: [MBANK],
        holderName: 'Организация А',
        purpose: 'fee',
        mainTax: false,
        mainFee: true,
      });
      expect(account.status, await account.clone().text()).toBe(200);
      const acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      await linkTelegram(f.app, acc, CHAT_ACC, 'acc_a');
      await linkClient(owner, cpA, '03744097401851', 'org-a', CLIENT_1, 'client_one');
      await linkClient(owner, cpA, '03744097401851', 'org-a', CLIENT_2, 'client_two');
      await linkClient(owner, cpA2, '03744097401853', 'org-a', CLIENT_1, 'client_one');
      await linkClient(ownerB, cpB, '03744097401852', 'org-b', CLIENT_1, 'client_one');
      await linkClient(ownerB, cpB, '03744097401852', 'org-b', CLIENT_B, 'client_b');
    });

    beforeEach(async () => {
      await wipe();
      await f.t.admin.db
        .update(schema.contractorPages)
        .set({ filesUpload: true, hiddenSections: [] });
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«Прислать чек» под «Оплата за обслуживание»: просьба с «Отменой», повтор — «бот ждёт»; не файл и не фото или PDF — бот ждёт дальше', async () => {
      await feeMessage();
      const feeId = lastMessageId(CLIENT_2);
      // Клиент может отправлять файлы — рядом с «Оплатил» кнопка «Прислать чек» (прототип pgFeeBtns).
      expect(sentTo(CLIENT_2).at(-1)!.options.keyboard!.at(-1)).toEqual([
        { text: text('tgBtnCpPaid'), data: paidData },
        { text: text('tgBtnCpReceipt'), data: receiptData },
      ]);
      expect(await press(receiptData, CLIENT_2, feeId)).toMatchObject({ text: undefined });
      expect(sentTo(CLIENT_2).at(-1)).toMatchObject({
        text: text('tgCpReceiptAsk'),
        options: { keyboard: [[{ text: text('tgBtnCancel'), data: BOT_ASK_CANCEL }]] },
      });
      const askId = lastMessageId(CLIENT_2);
      const count = tg.sent.length;
      // Та же просьба уже открыта — бот напоминает, новой не присылает (прототип tgActAskWait).
      expect(await press(receiptData, CLIENT_2, feeId)).toMatchObject({
        text: text('tgActAskWait'),
      });
      expect(tg.sent).toHaveLength(count);

      await sendText(CLIENT_2, 'чек потом', askId);
      expect(lastText(CLIENT_2)).toBe(text('tgAskNeedFile'));
      await sendFile(CLIENT_2, { name: 'Выписка.xlsx', body: enc('PK\x03\x04'), replyTo: askId });
      expect(lastText(CLIENT_2)).toBe(text('tgCpReceiptType'));
      await sendFile(CLIENT_2, { name: 'setup.exe', body: EXE, replyTo: askId });
      expect(lastText(CLIENT_2)).toBe(text('tgFileType'));
      expect(await sentFiles(cpA)).toEqual([]);

      // Фото без ответа на просьбу — к последней открытой просьбе за сегодня.
      await sendFile(CLIENT_2, { photo: true, body: JPEG, caption: 'Перевёл с карты' });
      expect(lastText(CLIENT_2)).toBe(text('tgCpReceiptOk'));
      const [file] = await sentFiles(cpA);
      expect(file).toMatchObject({
        source: 'telegram',
        senderName: '@client_two',
        tgChatId: CLIENT_2,
        comment: 'Чек к «Оплата за обслуживание» за сентябрь 2026. Перевёл с карты',
        status: 'new',
      });
      expect(file!.name).toMatch(/^Фото из Telegram .+\.jpg$/);
      // «Оплатил» не нажимали: чек — тоже сообщение клиента об оплате (docs/deviations.md п. К-11).
      expect(await claims(cpA)).toEqual([
        {
          purpose: 'fee',
          amount: DEBT,
          sentFileId: file!.id,
          tgMessageId: await feeRowOf(CLIENT_2),
          status: 'wait',
        },
      ]);
      // «Отмена» под просьбой погасла; «Прислать чек» — «✓ Чек отправлен», «Оплатил» работает.
      expect(tg.edits.slice(-2)).toEqual([
        {
          chatId: CLIENT_2,
          messageId: askId,
          keyboard: [[{ text: text('tgBtnCancel'), data: 'off', disabled: true }]],
        },
        {
          chatId: CLIENT_2,
          messageId: feeId,
          keyboard: expect.arrayContaining([
            [
              { text: text('tgBtnCpPaid'), data: paidData },
              { text: '✓ Чек отправлен', data: 'off', disabled: true },
            ],
          ]),
        },
      ]);
      // Второй чек на ту же просьбу — уже не чек: файл без просьбы.
      await sendFile(CLIENT_2, { name: 'Чек 2.pdf', replyTo: askId });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileOk'));
      expect(await claims(cpA)).toHaveLength(1);
      expect((await sentFiles(cpA)).map((x) => x.comment)).toEqual([
        'Чек к «Оплата за обслуживание» за сентябрь 2026. Перевёл с карты',
        null,
      ]);
    });

    it('«Оплатил», потом чек — чек того же сообщения об оплате, второго не появляется', async () => {
      await feeMessage();
      const feeId = lastMessageId(CLIENT_1);
      expect(await press(paidData, CLIENT_1, feeId)).toMatchObject({ text: text('tgCpPaidOk') });
      expect(await press(receiptData, CLIENT_1, feeId)).toMatchObject({ text: undefined });
      await sendFile(CLIENT_1, { name: 'чек.PDF', replyTo: lastMessageId(CLIENT_1) });
      expect(lastText(CLIENT_1)).toBe(text('tgCpReceiptOk'));
      const [file] = await sentFiles(cpA);
      expect(await claims(cpA)).toEqual([
        {
          purpose: 'fee',
          amount: DEBT,
          sentFileId: file!.id,
          tgMessageId: await feeRowOf(CLIENT_1),
          status: 'wait',
        },
      ]);
      // Чек — тому контрагенту, к которому сообщение: без вопроса «От какой компании?».
      expect(await sentFiles(cpA2)).toEqual([]);
      expect(await sentFiles(cpB)).toEqual([]);
    });

    it('«Принять» у чека: что оплачено — только тому, кто может сразу принять эти деньги', async () => {
      await feeMessage();
      for (const chat of [CLIENT_1, CLIENT_2]) {
        await press(receiptData, chat, lastMessageId(chat));
        await sendFile(chat, { name: `Чек ${chat}.pdf`, replyTo: lastMessageId(chat) });
        expect(lastText(chat)).toBe(text('tgCpReceiptOk'));
      }
      const [first, second] = await sentFiles(cpA);
      const accept = (cookie: string, file: { id: string; version: number }) =>
        call(cookie, 'POST', `/api/files/sent/${file.id}/accept`, { version: file.version });
      // Бухгалтер принимает файлы, но платы за обслуживание не видит — файл просто принят.
      const acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      const byAcc = await accept(acc, first!);
      expect(byAcc.status, await byAcc.clone().text()).toBe(200);
      expect(SentFileAccepted.parse(await byAcc.json())).toMatchObject({
        status: 'accepted',
        pay: null,
      });
      // Владелец — сразу «Принять оплату за обслуживание» с суммой из сообщения.
      const byOwner = await accept(owner, second!);
      expect(byOwner.status, await byOwner.clone().text()).toBe(200);
      // Месяц — последний месяц долга (прототип v115 `pgFeeMsg`).
      expect(SentFileAccepted.parse(await byOwner.json()).pay).toEqual({
        purpose: 'fee',
        month: '2026-09',
        amount: DEBT,
      });
      // Контрагент в архиве — без денег. Напоминание — раз в сутки: прежнее — будто вчерашнее.
      await f.t.admin.db
        .update(schema.contractorTelegramMessages)
        .set({ day: '2026-10-17' })
        .where(eq(schema.contractorTelegramMessages.kind, 'fee'));
      await feeMessage();
      await press(receiptData, CLIENT_2, lastMessageId(CLIENT_2));
      await sendFile(CLIENT_2, { name: 'Чек 3.pdf', replyTo: lastMessageId(CLIENT_2) });
      const third = (await sentFiles(cpA)).find((x) => x.name === 'Чек 3.pdf')!;
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'archived' })
        .where(eq(schema.contractors.id, cpA));
      try {
        const archived = await accept(owner, third);
        expect(archived.status, await archived.clone().text()).toBe(200);
        expect(SentFileAccepted.parse(await archived.json()).pay).toBeNull();
      } finally {
        await f.t.admin.db
          .update(schema.contractors)
          .set({ serviceStatus: 'active' })
          .where(eq(schema.contractors.id, cpA));
      }
    });

    it('«Отмена»: бот больше не ждёт чек, файл после неё — обычный файл; повторная «Отмена» — «устарела»', async () => {
      await feeMessage();
      await press(receiptData, CLIENT_2, lastMessageId(CLIENT_2));
      const askId = lastMessageId(CLIENT_2);
      expect(await press(botPressData(BOT_ASK_CANCEL), CLIENT_2, askId)).toMatchObject({
        text: text('tgActCancelled'),
      });
      expect(tg.edits.at(-1)).toEqual({
        chatId: CLIENT_2,
        messageId: askId,
        keyboard: [[{ text: 'Отменено', data: 'off', disabled: true }]],
      });
      expect(await press(botPressData(BOT_ASK_CANCEL), CLIENT_2, askId)).toMatchObject({
        text: text('tgActStale'),
        alert: true,
      });
      await sendFile(CLIENT_2, { name: 'Акт.pdf', caption: 'Акт сверки' });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileOk'));
      expect((await sentFiles(cpA)).map((x) => [x.name, x.comment])).toEqual([
        ['Акт.pdf', 'Акт сверки'],
      ]);
      expect(await claims(cpA)).toEqual([]);
    });

    it('файлы через бота выключены: кнопки «Прислать чек» нет, нажатие старой — отказ, файл — «не принимает»', async () => {
      await feeMessage();
      const feeId = lastMessageId(CLIENT_2);
      await filesUpload(cpA, false);
      expect(await press(receiptData, CLIENT_2, feeId)).toMatchObject({
        text: text('tgCpFileOff'),
        alert: true,
      });
      await sendFile(CLIENT_2);
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileOff'));
      expect(await sentFiles(cpA)).toEqual([]);
      // Новое «Оплата за обслуживание» — без «Прислать чек».
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await feeMessage();
      expect(sentTo(CLIENT_2).at(-1)!.options.keyboard!.at(-1)).toEqual([
        { text: text('tgBtnCpPaid'), data: paidData },
      ]);
      // Просьба открыта, а файлы выключили: чек не принят, просьба закрыта.
      await filesUpload(cpA, true);
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await feeMessage();
      await press(receiptData, CLIENT_2, lastMessageId(CLIENT_2));
      const askId = lastMessageId(CLIENT_2);
      await filesUpload(cpA, false);
      await sendFile(CLIENT_2, { replyTo: askId });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileOff'));
      expect(tg.edits.at(-1)).toMatchObject({ chatId: CLIENT_2, messageId: askId });
      expect(await sentFiles(cpA)).toEqual([]);
    });

    it('файл без просьбы от клиента одного контрагента: в «Отправленные файлы» с подписью; тип, размер и 20 в сутки вместе со страницей', async () => {
      await sendFile(CLIENT_2, { name: 'setup.exe', body: EXE });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileNo', { мб: 20 }));
      tg.files.set('big', PDF);
      await sendToBot(
        f.app,
        telegramUpdate(null, CLIENT_2, {
          document: { fileId: 'big', name: 'Большой.pdf', size: 21 * 1048576 },
        }),
      );
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileNo', { мб: 20 }));
      // Содержимое не по имени: программа под видом PDF не принимается.
      await sendFile(CLIENT_2, { name: 'Выписка.pdf', body: EXE });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileNo', { мб: 20 }));
      expect(await sentFiles(cpA)).toEqual([]);

      await sendFile(CLIENT_2, {
        name: 'Выписка за октябрь.pdf',
        caption: '  Выписка   за октябрь ',
      });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileOk'));
      expect((await sentFiles(cpA)).map((x) => [x.name, x.comment, x.source])).toEqual([
        ['Выписка за октябрь.pdf', 'Выписка за октябрь', 'telegram'],
      ]);
      // Ответственному — «Новый файл от контрагента».
      expect(sentTo(CHAT_ACC).length).toBeGreaterThan(0);

      // Повтор доставки того же сообщения от Telegram второго файла не добавляет.
      const update = telegramUpdate(null, CLIENT_2, {
        document: { fileId: 'once', name: 'Раз.pdf', size: PDF.byteLength },
      });
      tg.files.set('once', PDF);
      await sendToBot(f.app, update);
      await sendToBot(f.app, update);
      expect((await sentFiles(cpA)).filter((x) => x.name === 'Раз.pdf')).toHaveLength(1);

      // Сутки: со страницы и из Telegram вместе — не больше 20.
      for (let i = 0; i < 2; i += 1) {
        await addSentFiles(f.deps, {
          orgId: f.a.orgId,
          contractorId: cpA,
          source: 'page',
          files: Array.from({ length: 9 }, (_, n) => ({ name: `p${i}-${n}.pdf`, bytes: PDF })),
        });
      }
      expect(await sentFiles(cpA)).toHaveLength(20);
      await sendFile(CLIENT_2, { name: 'Лишний.pdf' });
      expect(lastText(CLIENT_2)).toBe(text('tgCpFileLimit', { лимит: 20 }));
      expect(await sentFiles(cpA)).toHaveLength(20);
    });

    it('«От какой компании?»: файл из чата нескольких контрагентов — кнопки с названиями; выбор — файл ему; второе нажатие — «устарела»', async () => {
      await sendFile(CLIENT_1, { name: 'Договор.pdf', caption: 'Подписанный договор' });
      const askId = lastMessageId(CLIENT_1);
      const rows = await f.t.admin.db
        .select({
          id: schema.contractorTelegramMessages.id,
          orgId: schema.contractorTelegramMessages.orgId,
          contractorId: schema.contractorTelegramMessages.contractorId,
          kind: schema.contractorTelegramMessages.kind,
          messageId: schema.contractorTelegramMessages.messageId,
          payload: schema.contractorTelegramMessages.payload,
        })
        .from(schema.contractorTelegramMessages)
        .where(eq(schema.contractorTelegramMessages.chatId, CLIENT_1));
      // У каждого подключения — своя строка в своей организации; в ней нет чужих названий.
      expect(rows.map((r) => [r.contractorId, r.kind, r.messageId]).sort()).toEqual(
        [
          [cpA, 'file', null],
          [cpA2, 'file', null],
          [cpB, 'file', null],
        ].sort(),
      );
      for (const r of rows) {
        expect(JSON.stringify(r.payload)).not.toMatch(/Ала-Тоо|Ош Строй|Бишкек/);
        expect(r.orgId).toBe(r.contractorId === cpB ? f.b.orgId : f.a.orgId);
      }
      const rowOf = (cp: string) => rows.find((r) => r.contractorId === cp)!.id;
      const choose = (cp: string) => botPressData(CP_TG_FILE_TO_ACTION, rowOf(cp));
      expect(sentTo(CLIENT_1).at(-1)).toMatchObject({
        text: text('tgCpFileWhich'),
        options: {
          keyboard: [
            [{ text: CP_A, data: choose(cpA) }],
            [{ text: CP_B, data: choose(cpB) }],
            [{ text: CP_A2, data: choose(cpA2) }],
          ],
        },
      });
      expect(await sentFiles(cpA)).toEqual([]);

      // Чужой чат строку не найдёт.
      expect(await press(choose(cpA), CLIENT_B, askId)).toMatchObject({
        text: text('tgActStale'),
        alert: true,
      });
      expect(await press(choose(cpB), CLIENT_1, askId)).toMatchObject({ text: undefined });
      expect(tg.edits.at(-1)).toEqual({
        chatId: CLIENT_1,
        messageId: askId,
        // Все кнопки гаснут и остаются видны (прототип: `off:['cp-file-to']`).
        keyboard: [
          [{ text: CP_A, data: 'off', disabled: true }],
          [{ text: `✓ ${CP_B}`, data: 'off', disabled: true }],
          [{ text: CP_A2, data: 'off', disabled: true }],
        ],
      });
      expect(lastText(CLIENT_1)).toBe(text('tgCpFileOk'));
      // Строки вопроса во всех организациях отвечены, файла у Telegram, имени и подписи в них нет.
      const left = await f.t.admin.db
        .select({
          payload: schema.contractorTelegramMessages.payload,
          answeredAt: schema.contractorTelegramMessages.answeredAt,
        })
        .from(schema.contractorTelegramMessages)
        .where(eq(schema.contractorTelegramMessages.chatId, CLIENT_1));
      expect(left).toHaveLength(3);
      for (const row of left) {
        expect(row.answeredAt).not.toBeNull();
        expect(row.payload).not.toHaveProperty('fileTo');
      }
      expect((await sentFiles(cpB)).map((x) => [x.name, x.comment, x.senderName])).toEqual([
        ['Договор.pdf', 'Подписанный договор', '@client_one'],
      ]);
      // Вторая кнопка того же вопроса файл второму контрагенту не отправит.
      expect(await press(choose(cpA), CLIENT_1, askId)).toMatchObject({
        text: text('tgActStale'),
        alert: true,
      });
      expect(await sentFiles(cpA)).toEqual([]);
      expect(await sentFiles(cpA2)).toEqual([]);
    });

    it('«От какой компании?»: у выбранного контрагента файлы выключены — отказ, можно выбрать другого', async () => {
      await sendFile(CLIENT_1, { name: 'Справка.pdf' });
      const askId = lastMessageId(CLIENT_1);
      const rows = await f.t.admin.db
        .select({
          id: schema.contractorTelegramMessages.id,
          contractorId: schema.contractorTelegramMessages.contractorId,
        })
        .from(schema.contractorTelegramMessages)
        .where(eq(schema.contractorTelegramMessages.chatId, CLIENT_1));
      const choose = (cp: string) =>
        botPressData(CP_TG_FILE_TO_ACTION, rows.find((r) => r.contractorId === cp)!.id);
      await filesUpload(cpA2, false);
      expect(await press(choose(cpA2), CLIENT_1, askId)).toMatchObject({
        text: text('tgCpFileOff'),
        alert: true,
      });
      expect(await press(choose(cpA), CLIENT_1, askId)).toMatchObject({ text: undefined });
      expect((await sentFiles(cpA)).map((x) => x.name)).toEqual(['Справка.pdf']);
      expect(await sentFiles(cpA2)).toEqual([]);
    });

    it('чат не подключён к контрагенту — файл без ответа, как раньше; подделанные данные кнопки — «устарела»', async () => {
      await sendFile(STRANGER);
      expect(sentTo(STRANGER)).toEqual([]);
      expect(
        await press(botPressData(CP_TG_FILE_TO_ACTION, 'not-a-row'), CLIENT_1, 1),
      ).toMatchObject({ text: text('tgActStale'), alert: true });
      expect(
        await press(
          botPressData(CP_TG_FILE_TO_ACTION, '00000000-0000-4000-8000-000000000000'),
          CLIENT_1,
          1,
        ),
      ).toMatchObject({ text: text('tgActStale'), alert: true });
    });

    it('чат, привязанный и к сотруднику: файл без ответа на «Пришлите чек» — для бота сотрудника; чек ответом — принимается (п. О-79)', async () => {
      await linkTelegram(f.app, hr, CLIENT_2, 'client_two');
      try {
        tg.sent.length = 0;
        tg.messageIds.length = 0;
        await sendFile(CLIENT_2, { name: 'Табель.pdf' });
        expect(await sentFiles(cpA)).toEqual([]);
        expect(sentTo(CLIENT_2)).toEqual([]);
        await feeMessage();
        await press(receiptData, CLIENT_2, lastMessageId(CLIENT_2));
        await sendFile(CLIENT_2, { name: 'Чек.pdf', replyTo: lastMessageId(CLIENT_2) });
        expect(lastText(CLIENT_2)).toBe(text('tgCpReceiptOk'));
        expect((await sentFiles(cpA)).map((x) => x.name)).toEqual(['Чек.pdf']);
      } finally {
        const unlink = await call(hr, 'DELETE', '/api/telegram/link');
        expect(unlink.status, await unlink.clone().text()).toBeLessThan(300);
      }
    });

    it('чат нескольких фирм: файл без ответа на «Пришлите чек» — не чек, а «От какой компании?»; ответом — чек', async () => {
      await feeMessage();
      await press(receiptData, CLIENT_1, lastMessageId(CLIENT_1));
      const askId = lastMessageId(CLIENT_1);
      // Клиент мог отправить файл другой фирме: без ответа на просьбу он её чеком не становится.
      await sendFile(CLIENT_1, { name: 'Акт.pdf' });
      expect(lastText(CLIENT_1)).toBe(text('tgCpFileWhich'));
      expect(await sentFiles(cpA)).toEqual([]);
      expect(await claims(cpA)).toEqual([]);
      await sendFile(CLIENT_1, { name: 'Чек.pdf', replyTo: askId });
      expect(lastText(CLIENT_1)).toBe(text('tgCpReceiptOk'));
      expect((await sentFiles(cpA)).map((x) => x.name)).toEqual(['Чек.pdf']);
      expect(await claims(cpA)).toHaveLength(1);
      expect(await sentFiles(cpB)).toEqual([]);
    });

    it('«Прислать чек»: подделанные данные кнопки и чужой чат — «устарела»; не чаще 10 раз в час с подключения', async () => {
      await feeMessage();
      const feeId = lastMessageId(CLIENT_2);
      // Номер чужого сообщения в данных кнопки и «к налогам» под «Оплата за обслуживание» — кнопки такой нет.
      const forged = botPressData(CP_TG_RECEIPT_ACTION, 'tax.00000000-0000-4000-8000-000000000000');
      expect(await press(forged, CLIENT_2, feeId)).toMatchObject({
        text: text('tgActStale'),
        alert: true,
      });
      expect(await press(receiptData, CLIENT_B, feeId)).toMatchObject({
        text: text('tgActStale'),
        alert: true,
      });
      expect(await claims(cpA)).toEqual([]);
      // Просьба и «Отмена» по кругу чат не заваливают.
      for (let i = 0; i < 5; i += 1) {
        expect(await press(receiptData, CLIENT_2, feeId)).toMatchObject({ text: undefined });
        expect(
          await press(botPressData(BOT_ASK_CANCEL), CLIENT_2, lastMessageId(CLIENT_2)),
        ).toMatchObject({ text: text('tgActCancelled') });
      }
      // Считаются нажатия «Прислать чек» с подключения, и подделанное тоже: 1 + 5 + 3 + 1 = 10, одиннадцатое
      // — отказ без нового сообщения.
      for (let i = 0; i < 3; i += 1) await press(receiptData, CLIENT_2, feeId);
      const count = tg.sent.length;
      expect(await press(receiptData, CLIENT_2, feeId)).toMatchObject({
        text: text('tgActAskWait'),
      });
      const limited = await press(receiptData, CLIENT_2, feeId);
      expect(limited).toMatchObject({ alert: true });
      expect(limited!.text).toContain('несколько раз за час');
      expect(tg.sent.length).toBe(count);
    });

    it('файлов из одного чата — не больше 30 в час; после 20 за сутки — «лимит», после 30 — «слишком много»', async () => {
      for (let i = 1; i <= 20; i += 1) {
        await sendFile(CLIENT_2, { name: `Скан ${i}.pdf` });
        expect(lastText(CLIENT_2)).toBe(text('tgCpFileOk'));
      }
      for (let i = 21; i <= 30; i += 1) {
        await sendFile(CLIENT_2, { name: `Скан ${i}.pdf` });
        expect(lastText(CLIENT_2)).toBe(text('tgCpFileLimit', { лимит: 20 }));
      }
      await sendFile(CLIENT_2, { name: 'Скан 31.pdf' });
      expect(lastText(CLIENT_2)).toBe(
        'Файлов из этого чата слишком много за час. Попробуйте позже.',
      );
      expect(await sentFiles(cpA)).toHaveLength(20);
    });
  },
);
