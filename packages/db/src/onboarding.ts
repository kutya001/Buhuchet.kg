import {
  FEATURES,
  onboardingChanges,
  RecordNotFoundError,
  type Feature,
  type OnboardingAnswers,
  type OnboardingChanges,
  type OnboardingState,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './client';
import { updateWithHistory } from './history';
import { getOrgPolicy } from './org';
import { auditLog, orgOnboarding, orgSettings, platformReference, welcomeSeen } from './schema';

/*
 * Первый запуск организации (задача 2.33, docs/decisions.md п. Г-4): приветствие, опросник владельца и
 * отметка «приветствие уже видел». Тексты экранов, вопросы и основной набор — раздел refDB.json
 * `onboarding` в `platform_reference`; описания модулей — `kbUi.mods`. Всё — в `withOrgContext`.
 */

const text = z.string().catch('');
const Feat = z.enum(FEATURES);
const Question = z.object({
  id: z.string().min(1),
  q: text,
  x: text,
  on: z.array(Feat),
  sub: z
    .object({
      id: z.string().min(1),
      q: text,
      x: text,
      on: z.array(Feat).optional(),
      set: z.literal('taskConfirm').optional(),
    })
    .optional(),
});
const Content = z.object({
  s1: z.object({
    t: text,
    lead: text,
    points: z.array(z.object({ i: text, t: text, x: text })).catch([]),
  }),
  s2: z.object({ t: text, lead: text, leadStaff: text }),
  s3: z.object({
    t: text,
    lead: text,
    tAgain: text,
    leadAgain: text,
    planT: text,
    planLead: text,
  }),
  s4: z.object({ t: text, lead: text, leadStaff: text, howT: text, how: text }),
  tax: z.object({ t: text, lead: text }),
  always: z.array(z.string()).catch([]),
  base: z.partialRecord(Feat, z.boolean()).catch({}),
  questions: z.array(Question),
});
export type OnboardingContent = z.infer<typeof Content>;

const Mods = z.object({ mods: z.record(z.string(), z.string()).catch({}) });

/**
 * Тексты приветствия и опросника (`onboarding`) и строка «что делает» у модулей (`kbUi.mods`). Нет
 * раздела или он не читается — null: приветствие не откроется, ошибки нет.
 */
export async function onboardingContent(
  db: Db | Tx,
): Promise<{ content: OnboardingContent; mods: Record<string, string> } | null> {
  const rows = await db
    .select({ key: platformReference.key, payload: platformReference.payload })
    .from(platformReference)
    .where(sql`${platformReference.key} in ('onboarding', 'kbUi')`);
  const payload = new Map(rows.map((r) => [r.key, r.payload]));
  const content = Content.safeParse(payload.get('onboarding'));
  if (!content.success) return null;
  const mods = Mods.safeParse(payload.get('kbUi') ?? {});
  return { content: content.data, mods: mods.success ? mods.data.mods : {} };
}

export interface OnboardingRecord {
  state: OnboardingState;
  answers: OnboardingAnswers;
  doneAt: Date | null;
}

/** Приветствие организации; null — организация создана до приветствия (или чужая). */
export async function getOnboarding(tx: Tx, orgId: string): Promise<OnboardingRecord | null> {
  const [row] = await tx
    .select({
      state: orgOnboarding.state,
      answers: orgOnboarding.answers,
      doneAt: orgOnboarding.doneAt,
    })
    .from(orgOnboarding)
    .where(eq(orgOnboarding.orgId, orgId));
  return row ? { ...row, state: row.state as OnboardingState } : null;
}

/**
 * Пройден ли опросник (подпись «Пройти опросник заново», прототип org.js): у организации с приветствием —
 * по её строке, у созданной раньше — по записи «по опроснику» в истории учётной политики (строки
 * приветствия у неё не появляется).
 */
export async function onboardingQuizDone(
  tx: Tx,
  orgId: string,
  state: OnboardingState | null,
): Promise<boolean> {
  if (state) return state === 'done';
  const [row] = await tx
    .select({ at: auditLog.at })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'org_settings'),
        eq(auditLog.entityId, orgId),
        sql`exists (select 1 from jsonb_array_elements(${auditLog.changes}) as c where c->>'field' = ${ONBOARDING_HISTORY_FIELD})`,
      ),
    )
    .limit(1);
  return !!row;
}

/** Видел ли вошедший приветствие. */
export async function welcomeSeenByMe(tx: Tx): Promise<boolean> {
  const rows = await tx
    .select({ userId: welcomeSeen.userId })
    .from(welcomeSeen)
    .where(sql`${welcomeSeen.userId} = app.current_user_id()`);
  return rows.length > 0;
}

/** Приветствие открылось — больше оно само не откроется (повторно — из «Базы знаний»). */
export async function markWelcomeSeen(tx: Tx): Promise<void> {
  await tx
    .insert(welcomeSeen)
    .values({ userId: sql`app.current_user_id()` })
    .onConflictDoNothing();
}

/**
 * «Позже» (или закрыли приветствие до опросника): опросник больше сам не открывается, действует
 * основной набор; пройти его можно из учётной политики. false — опросник уже пройден или отложен.
 */
export async function postponeOnboarding(tx: Tx, orgId: string): Promise<boolean> {
  const rows = await tx
    .update(orgOnboarding)
    .set({
      state: 'later',
      version: sql`${orgOnboarding.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(sql`${orgOnboarding.orgId} = ${orgId} and ${orgOnboarding.state} = 'new'`)
    .returning({ orgId: orgOnboarding.orgId });
  return rows.length > 0;
}

/**
 * Отметка опросника в истории учётной политики: «по опроснику» при первом запуске (`first`) и
 * «пройден заново» из учётной политики (`again`). Пишется и без других изменений — как запись
 * прототипа «Учётная политика по опроснику: без изменений».
 */
export const ONBOARDING_HISTORY_FIELD = 'quiz';

export interface ApplyOnboardingInput {
  answers: OnboardingAnswers;
  features: Record<Feature, boolean>;
  taskConfirm: boolean;
  /** Версия учётной политики, которую видел пользователь. */
  version: number;
  again: boolean;
}

/**
 * «Применить» опросника (прототип obApply): учётная политика по плану — меняется только то, что
 * отличается; в историю учётной политики — запись «по опроснику» в той же транзакции (ТЗ); данные
 * выключаемых модулей не удаляются. У организации с приветствием опросник отмечается пройденным.
 * Проверку «функция нужна другой» делает вызывающий (`featureChangeProblem`).
 */
export async function applyOnboarding(
  tx: Tx,
  orgId: string,
  input: ApplyOnboardingInput,
): Promise<OnboardingChanges> {
  const current = await getOrgPolicy(tx, orgId);
  if (!current) throw new RecordNotFoundError('org_settings', orgId);
  const changes = onboardingChanges(current, input);
  await updateWithHistory(tx, {
    table: orgSettings,
    entity: 'org_settings',
    key: orgSettings.orgId,
    id: orgId,
    version: input.version,
    patch: {
      features: changes.on.length || changes.off.length ? input.features : undefined,
      taskConfirm: changes.taskConfirm ?? undefined,
    },
    changes: [{ field: ONBOARDING_HISTORY_FIELD, to: input.again ? 'again' : 'first' }],
  });
  await tx
    .update(orgOnboarding)
    .set({
      state: 'done',
      answers: input.answers,
      doneAt: sql`now()`,
      doneBy: sql`app.current_user_id()`,
      version: sql`${orgOnboarding.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(orgOnboarding.orgId, orgId));
  return changes;
}

/** Строка приветствия новой организации (`createOrganization`). */
export async function startOnboarding(tx: Tx, orgId: string): Promise<void> {
  await tx.insert(orgOnboarding).values({ orgId });
}
