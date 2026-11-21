import { randomUUID } from 'node:crypto';
import type { IsoDate } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { orgSubscriptionClosed, orgUsage } from './subscriptions';
import { createTestDatabaseAt, databaseAvailable } from './testing';

/*
 * Организации, работавшие до запуска подписок, не закрыты (доработки 20.11.2026, блок 4, пункт 7; общий
 * план 20.11, этап 2, П2). Рабочая база выпуска — на миграции 0164: пачка выпуска применяет 0165 (запуск
 * тарификации) и 0167 (закрытие доступа и повтор запуска) в один день. Тест повторяет это: база до 0164
 * с организациями «как на стенде» (действующие и архивные контрагенты, файлы, заблокированная
 * организация, демо), затем остальные миграции — и ни одна из них не закрыта.
 */

type Rows<T> = T[];

describe.skipIf(!databaseAvailable())('Запуск подписок на базе до выпуска', () => {
  let db: Awaited<ReturnType<typeof createTestDatabaseAt>>;
  const notices: string[] = [];
  const org = { a: randomUUID(), b: randomUUID(), blocked: randomUUID(), demo: randomUUID() };
  let today = '' as IsoDate;
  let until = '';

  const exec = <T>(q: ReturnType<typeof sql>) =>
    db.admin.db.execute(q) as unknown as Promise<Rows<T>>;

  /** Контрагенты организации в столбцах схемы 0164; `archived` из них — «В архиве». */
  async function contractors(orgId: string, n: number, archived: number, tag: string) {
    for (let i = 0; i < n; i++) {
      await exec(sql`
        insert into contractors (org_id, name, inn, phone, form_code, start_date, service_status)
        values (${orgId}::uuid, ${`ОсОО «${tag} ${i}»`},
          ${`02${tag === 'А' ? '1' : '2'}${String(i).padStart(11, '0')}`},
          '+996505890076', 'ФС-01', '2025-01-01', ${i < archived ? 'archived' : 'active'})`);
    }
  }

  beforeAll(async () => {
    db = await createTestDatabaseAt('0164_file_copies_merge_late_release');
    await exec(sql`
      insert into ownership_forms (code, name, sort_order) values ('ФС-01', 'ОсОО', 1)
      on conflict (code) do nothing`);
    await exec(sql`
      insert into organizations (id, name, slug, inn, status, is_demo) values
        (${org.a}::uuid, 'Фирма А', 'launch-a', '01811201810451', 'active', false),
        (${org.b}::uuid, 'Фирма Б', 'launch-b', '01811201810452', 'active', false),
        (${org.blocked}::uuid, 'Фирма В', 'launch-c', '01811201810453', 'blocked', false),
        (${org.demo}::uuid, 'Демо', 'launch-demo', '01811201810454', 'active', true)`);
    // А — 12 действующих и 3 в архиве (пакет — 20 мест), Б — ни одного (пакет — шаг, 10 мест).
    await contractors(org.a, 15, 3, 'А');
    await contractors(org.demo, 4, 0, 'Д');
    const [user] = await exec<{ id: string }>(sql`
      insert into users (org_id, login, password_hash) values (${org.a}::uuid, 'launch-owner', 'x')
      returning id`);
    const fileId = randomUUID();
    await exec(sql`
      insert into files (id, org_id, source_kind, name, content_type, size_bytes, storage_key, state,
        created_by)
      values (${fileId}::uuid, ${org.a}::uuid, 'manual', 'Договор.pdf', 'application/pdf', 5000,
        ${`org/${org.a}/files/${fileId}`}, 'ready', ${user!.id}::uuid)`);

    await db.migrateRest((line) => notices.push(line));
    const [d] = await exec<{ today: string; until: string }>(sql`
      select ((now() at time zone 'Asia/Bishkek')::date)::text as today,
        ((now() at time zone 'Asia/Bishkek')::date + 30)::text as until`);
    today = d!.today as IsoDate;
    until = d!.until;
  }, 240_000);

  afterAll(async () => {
    await db?.drop();
  });

  const usageOf = (orgId: string) =>
    withOrgContext(db.app.db, { orgId }, (tx) => orgUsage(tx, today));
  const closedOf = (orgId: string) =>
    withOrgContext(db.app.db, { orgId }, (tx) => orgSubscriptionClosed(tx, today));

  it('журнал выпуска: 0165 дал подписку трём организациям (кроме демо), повтор в 0167 — никому', () => {
    expect(notices).toContain('NOTICE: subscriptions_launch (0165): 3');
    expect(notices).toContain('NOTICE: subscriptions_launch: 0');
  });

  it('каждая организация, кроме демо, — «Месяц» бесплатно на 30 дней с пакетом по действующим контрагентам', async () => {
    const subs = await exec<{
      org_id: string;
      plan_id: string;
      seats: number;
      paid_until: string;
      free: boolean;
    }>(sql`
      select org_id, plan_id, seats, paid_until::text, free from org_subscriptions order by seats desc, org_id`);
    expect(subs).toHaveLength(3);
    const of = (id: string) => subs.find((s) => s.org_id === id);
    expect(of(org.a)).toMatchObject({ plan_id: 'm1', seats: 20, paid_until: until, free: true });
    expect(of(org.b)).toMatchObject({ plan_id: 'm1', seats: 10, paid_until: until, free: true });
    expect(of(org.blocked)).toMatchObject({ plan_id: 'm1', seats: 10, paid_until: until });
    expect(of(org.demo)).toBeUndefined();

    // В «Истории оплат» — одна запись без суммы от «Системы».
    const pays = await exec<{
      org_id: string;
      kind: string;
      status: string;
      created_by: string | null;
      paid_until: string;
    }>(sql`
      select org_id, kind, status, created_by, paid_until::text from subscription_payments`);
    expect(pays).toHaveLength(3);
    for (const p of pays) {
      expect(p).toMatchObject({
        kind: 'free',
        status: 'confirmed',
        created_by: null,
        paid_until: until,
      });
    }
  });

  it('доступ не закрыт ни у одной: вход, страница контрагента и бот работают; места и память — в пределе', async () => {
    for (const id of [org.a, org.b, org.blocked, org.demo]) {
      expect(await closedOf(id), id).toBe(false);
    }
    const a = await usageOf(org.a);
    expect(a).toMatchObject({ closed: false, seatsUsed: 12, seatsLimit: 20, bytesUsed: 5000 });
    expect(a!.bytesLimit).toBe((2000 + 200 * 20) * 1_048_576);
    expect(['active', 'expiring']).toContain(a!.status);
    expect(await usageOf(org.demo)).toMatchObject({ demo: true, closed: false, status: 'demo' });
  });
});
