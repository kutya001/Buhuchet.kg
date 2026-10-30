import {
  bishkekDate,
  BIZ_SIZES,
  CONTRACTOR_KINDS,
  FIRST_MONTH_MODES,
  gkedSignature,
  parseContract,
  PAYS_TO,
  serviceState,
  TARIFF_PERIODS,
  type HistoryValue,
  type ServicePeriod,
} from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import {
  auditLog,
  contractorBases,
  contractorBenefits,
  contractorGkedExtra,
  contractors,
  contractorServicePeriods,
  contractorTariffs,
  ownershipForms,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from '../schema';
import type { DemoIdOf } from './demo';

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2024-07-16 16:16» — момент по Бишкеку, как `_ca` и `_ua` записей прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Контрагент демо-организации (`contractors` в demoDB.json): поля задачи 2.05. */
const DemoContractor = z.object({
  id: z.number().int(),
  name: z.string(),
  inn: z.string(),
  phone: z.object({ cc: z.string(), digits: z.string() }),
  kind: z.enum(CONTRACTOR_KINDS),
  /** Названия формы, режимов и льгот — как в справочниках платформы. */
  form: z.string(),
  regime: z.string(),
  regime2: z.string().default(''),
  ben: z.array(z.string()).default([]),
  /** Код ГНС («020») или ключ УГНС («ugns-large»). */
  ugns: z.string().default(''),
  gked: z.string().default(''),
  gked2: z.array(z.string()).default([]),
  size: z.enum(BIZ_SIZES).default('small'),
  bases: z.array(z.string()).default([]),
  resp: z.string().nullable(),
  head: z.string().default(''),
  contact: z.string().default(''),
  contract: z.string().default(''),
  note: z.string().default(''),
  start: z.iso.date(),
  first: z.enum(FIRST_MONTH_MODES).default('full'),
  feeDay: z.number().int().default(10),
  paysTo: z.enum(PAYS_TO).default('emp'),
  archived: z.boolean().default(false),
  /** Журнал ставок обслуживания: сумма в сомах, «с месяца» — «2026-01». */
  tariffs: z
    .array(
      z.object({
        amount: z.number().nonnegative(),
        from: z.string().regex(/^\d{4}-\d{2}$/),
        per: z.enum(TARIFF_PERIODS),
        by: z.string(),
        at: z.iso.date(),
        note: z.string().default(''),
      }),
    )
    .default([]),
  /** Периоды обслуживания (задача 2.12): «2026-01» по «2026-09», пусто — обслуживается дальше. */
  periods: z
    .array(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}$/),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .nullable(),
      }),
    )
    .default([]),
  /** Подтверждение права на режим по ГКЭД (прототип gkEnOk). */
  gkOk: z.object({ by: z.string(), at: z.iso.date(), ask: z.string() }).optional(),
  _cb: z.string(),
  _ca: Stamp,
  _ub: z.string(),
  _ua: Stamp,
});

const DemoContractors = z.object({ contractors: z.array(DemoContractor).default([]) });

/**
 * Контрагенты демо-организации (задача 2.05): поля, дополнительные ГКЭД, льготы, основания отчётов,
 * журнал ставок и подтверждение права на режим. Справочные значения demoDB.json названы словами —
 * они переводятся в коды справочников платформы; неизвестное название — ошибка наполнения. Повторный
 * запуск досоздаёт только недостающее. Назначенные отчёты, Соцфонд, приостановки, деньги и файлы
 * добавят свои задачи.
 */
export async function seedDemoContractors(
  db: Db,
  file: unknown,
  ids: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<number> {
  const demo = DemoContractors.parse(file).contractors;
  if (demo.length === 0) return 0;
  const { orgId, demoId } = ids;
  const [forms, regimes, benefits, offices] = await Promise.all([
    db
      .select({
        code: ownershipForms.code,
        name: ownershipForms.name,
        declarationFor: ownershipForms.declarationFor,
      })
      .from(ownershipForms),
    db
      .select({
        code: taxRegimes.code,
        name: taxRegimes.name,
        article: taxRegimes.article,
        gked: taxRegimes.gked,
      })
      .from(taxRegimes),
    db.select({ code: taxBenefits.code, name: taxBenefits.name }).from(taxBenefits),
    db.select({ code: taxOffices.code, gnsCode: taxOffices.gnsCode }).from(taxOffices),
  ]);
  const codeOf = (list: readonly { code: string; name: string }[], what: string, name: string) => {
    const found = list.find((x) => x.name === name);
    if (!found) throw new Error(`demoDB.json: нет значения «${name}» в справочнике «${what}»`);
    return found.code;
  };
  const officeOf = (key: string) => {
    if (!key) return null;
    const found = offices.find((x) => x.code === key || x.gnsCode === key);
    if (!found) throw new Error(`demoDB.json: нет УГНС «${key}»`);
    return found.code;
  };
  const user = (protoId: string) =>
    ids.employees.includes(protoId) ? demoId('user', protoId) : null;
  const employee = (protoId: string | null) =>
    protoId && ids.employees.includes(protoId) ? demoId('employee', protoId) : null;

  // Статус обслуживания — по периодам demoDB.json в идущем месяце (прототип cpStatus); дальше его
  // сверяет задача по расписанию.
  const month = bishkekDate(new Date()).slice(0, 7);
  const rows = demo.map((c) => {
    const formCode = codeOf(forms, 'Формы собственности', c.form);
    const declarationFor = forms.find((f) => f.code === formCode)!.declarationFor;
    const regimeCode = c.regime ? codeOf(regimes, 'Налоговые режимы', c.regime) : null;
    const regime2Code = c.regime2 ? codeOf(regimes, 'Налоговые режимы', c.regime2) : null;
    const benefitCodes = c.ben.map((name) => codeOf(benefits, 'Льготы и статусы', name));
    const gked = c.gked || null;
    const contract = parseContract(c.contract);
    // Подпись подтверждения считается заново по кодам продукта (у прототипа в ней названия).
    const confirmation = c.gkOk && {
      sig: gkedSignature(
        {
          gked,
          gkedExtra: c.gked2,
          form: { code: formCode, declarationFor },
          regimes: [regimeCode, regime2Code].filter((r): r is string => !!r),
          benefits: benefitCodes,
        },
        regimes,
      ),
      employeeId: employee(c.gkOk.by)!,
      at: c.gkOk.at,
      ask: c.gkOk.ask,
    };
    return {
      contractor: {
        id: demoId('contractor', String(c.id)),
        orgId,
        name: c.name,
        inn: c.inn,
        phone: `+${c.phone.digits}`,
        kind: c.kind,
        formCode,
        regimeCode,
        regime2Code,
        gked,
        taxOfficeCode: officeOf(c.ugns),
        bizSize: c.size,
        responsibleEmployeeId: employee(c.resp),
        head: c.head,
        contact: c.contact,
        contractNo: contract.no,
        contractDate: contract.date,
        note: c.note,
        startDate: c.start,
        firstMonthMode: c.first,
        feeDay: c.feeDay,
        paysTo: c.paysTo,
        serviceStatus: serviceState(
          { archived: c.archived, oneOff: c.kind === 'oneoff', periods: c.periods },
          month,
        ),
        gkedConfirmation: confirmation ?? null,
        createdBy: user(c._cb),
        updatedBy: user(c._ub),
        createdAt: stampOf(c._ca),
        updatedAt: stampOf(c._ua),
      },
      c,
      benefitCodes,
    };
  });

  const inserted = await db
    .insert(contractors)
    .values(rows.map((r) => r.contractor))
    .onConflictDoNothing()
    .returning({ id: contractors.id });

  const contractorId = (c: { id: number }) => demoId('contractor', String(c.id));
  const extra = rows.flatMap(({ c }) =>
    c.gked2.map((gked, i) => ({ orgId, contractorId: contractorId(c), gked, sortOrder: i })),
  );
  const benefitRows = rows.flatMap(({ c, benefitCodes }) =>
    benefitCodes.map((benefitCode) => ({
      orgId,
      contractorId: contractorId(c),
      benefitCode,
      validFrom: null,
      validTo: null,
    })),
  );
  const baseRows = rows.flatMap(({ c }) =>
    c.bases.map((baseCode) => ({ orgId, contractorId: contractorId(c), baseCode })),
  );
  const tariffRows = rows.flatMap(({ c }) =>
    c.tariffs.map((t, i) => ({
      id: demoId('tariff', `${c.id}:${i}`),
      orgId,
      contractorId: contractorId(c),
      // Сомы прототипа — в тыйыны.
      amount: Math.round(t.amount * 100),
      period: t.per,
      validFrom: `${t.from}-01`,
      note: t.note,
      createdBy: user(t.by),
      createdAt: new Date(`${t.at}T00:00:00+06:00`),
    })),
  );
  if (extra.length) await db.insert(contractorGkedExtra).values(extra).onConflictDoNothing();
  if (benefitRows.length) {
    await db.insert(contractorBenefits).values(benefitRows).onConflictDoNothing();
  }
  if (baseRows.length) await db.insert(contractorBases).values(baseRows).onConflictDoNothing();
  if (tariffRows.length) {
    await db.insert(contractorTariffs).values(tariffRows).onConflictDoNothing();
  }
  await seedDemoServicePeriods(db, orgId, rows, month);

  // Подтверждение права на режим — в истории контрагента (п. 58: «в истории — кто подтвердил»);
  // пишется вместе с новым контрагентом, поэтому повторный запуск его не задваивает.
  const created = new Set(inserted.map((r) => r.id));
  const confirmations = rows.filter(
    (r) => r.contractor.gkedConfirmation && created.has(r.contractor.id),
  );
  if (confirmations.length) {
    await db.insert(auditLog).values(
      confirmations.map(({ contractor, c }) => ({
        orgId,
        entity: 'contractor',
        entityId: contractor.id,
        action: 'update',
        changes: [
          {
            field: 'gkedConfirmation',
            from: null,
            to: contractor.gkedConfirmation as unknown as HistoryValue,
          },
        ],
        contractorId: contractor.id,
        actorUserId: user(c.gkOk!.by),
        at: new Date(`${c.gkOk!.at}T10:00:00+06:00`),
      })),
    );
  }
  return inserted.length;
}

/**
 * Периоды обслуживания демо-контрагентов (задача 2.12). Новому контрагенту — из demoDB.json; у
 * заведённого раньше (миграция дала ему один период с начала обслуживания) периоды заменяются, только
 * пока их никто не менял: так стенд получает приостановки демо, а правки на стенде не затираются.
 */
async function seedDemoServicePeriods(
  db: Db,
  orgId: string,
  rows: readonly {
    contractor: { id: string; startDate: string; serviceStatus: string };
    c: { kind: string; archived: boolean; periods: ServicePeriod[] };
  }[],
  month: string,
): Promise<void> {
  for (const { contractor, c } of rows) {
    const current = await db
      .select({
        from: contractorServicePeriods.fromMonth,
        to: contractorServicePeriods.toMonth,
      })
      .from(contractorServicePeriods)
      .where(eq(contractorServicePeriods.contractorId, contractor.id));
    const untouched =
      current.length === 0 ||
      (current.length === 1 && current[0]!.from.slice(0, 7) === contractor.startDate.slice(0, 7));
    const same =
      current.length === c.periods.length &&
      c.periods.every(
        (p, i) =>
          current[i]!.from.slice(0, 7) === p.from && (current[i]!.to?.slice(0, 7) ?? null) === p.to,
      );
    if (!untouched || same) continue;
    await db.transaction(async (tx) => {
      await tx
        .delete(contractorServicePeriods)
        .where(eq(contractorServicePeriods.contractorId, contractor.id));
      if (c.periods.length) {
        await tx.insert(contractorServicePeriods).values(
          c.periods.map((p) => ({
            orgId,
            contractorId: contractor.id,
            fromMonth: `${p.from}-01`,
            toMonth: p.to ? `${p.to}-01` : null,
          })),
        );
      }
      await tx
        .update(contractors)
        .set({ serviceStatus: contractor.serviceStatus as 'active' | 'paused' | 'archived' })
        .where(eq(contractors.id, contractor.id));
    });
  }
}
