import { z } from 'zod';
import type { Db } from '../client';
import {
  bonusWriteoffs,
  oneOffServiceBonuses,
  oneOffServicePayments,
  oneOffServices,
} from '../schema';
import type { DemoIdOf } from './demo';

/*
 * Разовые услуги демо-организации (задача 2.22): `services` из demoDB.json — контрагент, название,
 * описание, дата, стоимость, исполнитель и оплаты. Суммы в прототипе — в сомах, в базе — в тыйынах.
 * Файлы услуг не наполняются: в демо-хранилище их нет (как у оплат за обслуживание). Повторный запуск
 * досоздаёт только недостающие услуги и оплаты. Бонусы сотрудников (прототип v84): строки `bonus` услуг и
 * списания накопленных бонусов `bonusOps`.
 */

const tyiyn = (som: number) => Math.round(som * 100);

/** Момент прототипа «2026-09-08 18:13» — по Бишкеку; без него — 10:00 дня записи (прототип finRows). */
const stampOf = (s: string | undefined, date: string) =>
  new Date(s ? `${s.replace(' ', 'T')}:00+06:00` : `${date}T10:00:00+06:00`);

const DemoServicePayment = z.object({
  id: z.string(),
  date: z.iso.date(),
  amount: z.number().positive(),
  by: z.string(),
});

const DemoService = z.object({
  id: z.string(),
  cp: z.number().int(),
  name: z.string(),
  desc: z.string().default(''),
  date: z.iso.date(),
  amount: z.number().positive(),
  resp: z.string().nullable().default(null),
  pays: z.array(DemoServicePayment).default([]),
  bonus: z.array(z.object({ emp: z.string(), amount: z.number().positive() })).default([]),
  _cb: z.string().optional(),
  _ca: z.string().optional(),
  _ub: z.string().optional(),
  _ua: z.string().optional(),
});

const DemoBonusOp = z.object({
  id: z.string(),
  emp: z.string(),
  amount: z.number().positive(),
  date: z.iso.date(),
  by: z.string().optional(),
  note: z.string().min(1),
  _ca: z.string().optional(),
});

const DemoServicesFile = z.object({
  services: z.array(DemoService).default([]),
  bonusOps: z.array(DemoBonusOp).default([]),
});

export async function seedDemoServices(
  db: Db,
  file: unknown,
  { orgId, demoId, employees }: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<void> {
  const demo = DemoServicesFile.parse(file);
  const user = (protoId: string | undefined) =>
    protoId && employees.includes(protoId) ? demoId('user', protoId) : null;
  if (demo.services.length)
    await db
      .insert(oneOffServices)
      .values(
        demo.services.map((s) => ({
          id: demoId('one_off_service', s.id),
          orgId,
          contractorId: demoId('contractor', String(s.cp)),
          name: s.name,
          serviceDate: s.date,
          amount: tyiyn(s.amount),
          performerEmployeeId:
            s.resp && employees.includes(s.resp) ? demoId('employee', s.resp) : null,
          description: s.desc,
          createdBy: user(s._cb ?? s.resp ?? undefined),
          updatedBy: user(s._ub ?? s._cb ?? s.resp ?? undefined),
          createdAt: stampOf(s._ca, s.date),
          updatedAt: stampOf(s._ua ?? s._ca, s.date),
        })),
      )
      .onConflictDoNothing();
  const payments = demo.services.flatMap((s) =>
    s.pays.map((p) => ({
      id: demoId('one_off_service_payment', p.id),
      orgId,
      serviceId: demoId('one_off_service', s.id),
      amount: tyiyn(p.amount),
      paidOn: p.date,
      createdBy: user(p.by),
      updatedBy: user(p.by),
      createdAt: stampOf(undefined, p.date),
      updatedAt: stampOf(undefined, p.date),
    })),
  );
  if (payments.length)
    await db.insert(oneOffServicePayments).values(payments).onConflictDoNothing();
  // Бонусы сотрудникам за услугу: строки по порядку прототипа; сотрудник — из демо-организации.
  const bonuses = demo.services.flatMap((s) =>
    s.bonus
      .filter((b) => employees.includes(b.emp))
      .map((b, position) => ({
        id: demoId('service_bonus', `${s.id}-b${position}`),
        orgId,
        serviceId: demoId('one_off_service', s.id),
        employeeId: demoId('employee', b.emp),
        amount: tyiyn(b.amount),
        position,
        createdBy: user(s._cb ?? s.resp ?? undefined),
        createdAt: stampOf(s._ca, s.date),
        updatedAt: stampOf(s._ca, s.date),
      })),
  );
  if (bonuses.length) await db.insert(oneOffServiceBonuses).values(bonuses).onConflictDoNothing();
  // Списания накопленных бонусов.
  const writeoffs = demo.bonusOps
    .filter((x) => employees.includes(x.emp))
    .map((x) => ({
      id: demoId('bonus_writeoff', x.id),
      orgId,
      employeeId: demoId('employee', x.emp),
      amount: tyiyn(x.amount),
      paidOn: x.date,
      note: x.note,
      createdBy: user(x.by),
      updatedBy: user(x.by),
      createdAt: stampOf(x._ca, x.date),
      updatedAt: stampOf(x._ca, x.date),
    }));
  if (writeoffs.length) await db.insert(bonusWriteoffs).values(writeoffs).onConflictDoNothing();
}
