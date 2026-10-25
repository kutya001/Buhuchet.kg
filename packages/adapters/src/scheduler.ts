import { timingSafeEqual } from 'node:crypto';
import { BISHKEK_UTC_OFFSET_MINUTES } from '@buhuchet/domain';

/**
 * Расписание. Кто будит — зависит от площадки: на Vercel — Vercel Cron раз в минуту вызывает
 * `/api/cron/tick`, на VPS — apps/worker или системный cron вызывает то же самое.
 * Какие задачи пора выполнить, решает наш код: расписания задач — в формате cron по времени Бишкека,
 * а пропущенный запуск (площадка не разбудила вовремя) догоняется в пределах `lookbackMinutes`.
 */

/** Что прописать площадке: один маршрут раз в минуту. Сверяется с apps/web/vercel.json тестом. */
export const PLATFORM_CRON_ENTRIES = [{ path: '/api/cron/tick', schedule: '* * * * *' }] as const;

interface CronField {
  values: Set<number>;
  any: boolean;
}

export interface CronSchedule {
  readonly expression: string;
  matches(instant: Date): boolean;
}

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(text: string, [min, max]: readonly [number, number]): CronField {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new SyntaxError(`Неверная часть расписания: «${part}»`);
    const [, star, from, to, stepText] = m;
    const step = stepText ? Number(stepText) : 1;
    const lo = star === '*' ? min : Number(from);
    const hi = star === '*' ? max : to !== undefined ? Number(to) : stepText ? max : lo;
    if (step < 1 || lo < min || hi > max || lo > hi) {
      throw new SyntaxError(`Часть расписания вне диапазона ${min}–${max}: «${part}»`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, any: text === '*' };
}

/** Разбор выражения cron из пяти полей: минута, час, день месяца, месяц, день недели (0 и 7 — воскресенье). */
export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new SyntaxError(`Расписание должно иметь 5 полей: «${expression}»`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELD_RANGES[i]!)) as [
    CronField,
    CronField,
    CronField,
    CronField,
    CronField,
  ];
  if (dow.values.has(7)) dow.values.add(0);

  return {
    expression,
    matches(instant) {
      const local = new Date(instant.getTime() + BISHKEK_UTC_OFFSET_MINUTES * 60_000);
      if (!minute.values.has(local.getUTCMinutes())) return false;
      if (!hour.values.has(local.getUTCHours())) return false;
      if (!month.values.has(local.getUTCMonth() + 1)) return false;
      const domOk = dom.values.has(local.getUTCDate());
      const dowOk = dow.values.has(local.getUTCDay());
      // Как в классическом cron: если ограничены оба поля дня, достаточно совпасть одному.
      if (!dom.any && !dow.any) return domOk || dowOk;
      return domOk && dowOk;
    },
  };
}

/** Последний момент по расписанию не позже `now` в пределах `lookbackMinutes`; иначе null. */
export function latestDueSlot(
  schedule: CronSchedule,
  now: Date,
  lookbackMinutes: number,
): Date | null {
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let i = 0; i <= lookbackMinutes; i++) {
    const slot = new Date(start - i * 60_000);
    if (schedule.matches(slot)) return slot;
  }
  return null;
}

export interface JobDefinition<Ctx> {
  /** Уникальное имя: `<модуль>.<действие>`, например `reports.generate`. */
  name: string;
  /** Расписание cron по времени Бишкека. */
  cron: string;
  /** Насколько поздно ещё можно догнать пропущенный запуск. По умолчанию 60 минут. */
  lookbackMinutes?: number;
  /** Задача обязана быть безопасной при повторе: досоздаёт только недостающее. */
  run(ctx: Ctx, slot: Date): Promise<void>;
}

export interface DueJob<Ctx> {
  job: JobDefinition<Ctx>;
  slot: Date;
}

/** Какие задачи пора выполнить в момент `now` (вместе со слотом, по которому выполнять). */
export function dueJobs<Ctx>(jobs: ReadonlyArray<JobDefinition<Ctx>>, now: Date): DueJob<Ctx>[] {
  const seen = new Set<string>();
  const out: DueJob<Ctx>[] = [];
  for (const job of jobs) {
    if (seen.has(job.name)) throw new Error(`Задача «${job.name}» объявлена дважды`);
    seen.add(job.name);
    const slot = latestDueSlot(parseCron(job.cron), now, job.lookbackMinutes ?? 60);
    if (slot) out.push({ job, slot });
  }
  return out;
}

/** Проверка заголовка `Authorization: Bearer <CRON_SECRET>` без утечки по времени сравнения. */
export function isAuthorizedCronCall(
  authorization: string | null | undefined,
  secret: string,
): boolean {
  if (!authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface IntervalRunner {
  stop(): Promise<void>;
}

/**
 * Цикл фонового исполнителя (VPS): вызывает `tick` в начале каждой минуты (+`offsetMs`),
 * не запускает новый вызов, пока не закончился предыдущий.
 */
export function startMinuteRunner(options: {
  tick: () => Promise<void>;
  onError: (error: unknown) => void;
  offsetMs?: number;
  now?: () => number;
}): IntervalRunner {
  const now = options.now ?? Date.now;
  const offset = options.offsetMs ?? 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const t = now();
    const next = Math.floor(t / 60_000) * 60_000 + 60_000 + offset;
    timer = setTimeout(fire, next - t);
  };
  const fire = () => {
    running = options
      .tick()
      .catch(options.onError)
      .finally(() => {
        running = undefined;
        schedule();
      });
  };

  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
