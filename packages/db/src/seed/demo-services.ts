import { z } from 'zod';
import type { Db } from '../client';
import { oneOffServicePayments, oneOffServices } from '../schema';
import type { DemoIdOf } from './demo';

/*
 * Разовые услуги демо-организации (задача 2.22): `services` из demoDB.json — контрагент, название,
 * описание, дата, стоимость, исполнитель и оплаты. Суммы в прототипе — в сомах, в базе — в тыйынах.
 * Файлы услуг не наполняются: в демо-хранилище их нет (как у оплат за обслуживание). Повторный запуск
 * досоздаёт только недостающие услуги и оплаты.
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
  _cb: z.string().optional(),
  _ca: z.string().optional(),
  _ub: z.string().optional(),
  _ua: z.string().optional(),
});

const DemoServicesFile = z.object({ services: z.array(DemoService).default([]) });

export async function seedDemoServices(
  db: Db,
  file: unknown,
  { orgId, demoId, employees }: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<void> {
  const demo = DemoServicesFile.parse(file);
  if (!demo.services.length) return;
  const user = (protoId: string | undefined) =>
    protoId && employees.includes(protoId) ? demoId('user', protoId) : null;
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
}
