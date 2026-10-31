'use client';

import {
  gkedRuleToVerify,
  pluralForm,
  splitGkedCodes,
  type GkedRule,
  type GkedRuleList,
  type UiTextKey,
} from '@buhuchet/domain';
import type { GkedRuleLists } from '@buhuchet/shared';
import { Field, inputClass, Note } from '@buhuchet/ui';
import { useState } from 'react';
import { useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';

/*
 * «Виды деятельности (ГКЭД)» в окнах справочников (задача 2.38; прототип modules/gked-ui.js
 * gkRuleFields, gkRuleRead): перечень и «Кроме»; у статуса — «Предупреждать при ГКЭД»; у режима —
 * перечни для ИП и ИТД, если они у режима есть. Коды — через запятую; есть ли они в справочнике,
 * проверяет сервер. Служебные признаки правила (примечание, «Сверить», «только основной») окно не
 * правит — сервер их сохраняет.
 */

/** Перечни по форме собственности: правятся в окне режима, у остальных — справочно. */
const OWNER_LISTS = ['ip', 'ipEx', 'itd'] as const satisfies readonly GkedRuleList[];

type Draft = Record<GkedRuleList, string>;

const draftOf = (r: GkedRule | null | undefined): Draft => ({
  in: (r?.in ?? []).join(', '),
  ex: (r?.ex ?? []).join(', '),
  warn: (r?.warn ?? []).join(', '),
  ip: (r?.ip ?? []).join(', '),
  ipEx: (r?.ipEx ?? []).join(', '),
  itd: (r?.itd ?? []).join(', '),
});

/**
 * Где «Предупреждать при ГКЭД»: у статуса — всегда (подсказка статуса), у остальных — если перечень уже
 * есть (подсказка режима), как `warnOn||(r.warn||[]).length` прототипа.
 */
export type GkedWarnField = 'status' | 'regime' | false;

/** Отказ сервера `gked_unknown`: текст и коды, которых нет в справочнике. */
export interface GkedFieldError {
  text: string;
  codes: readonly string[];
}

export const gkedFieldError = (error: ApiErrorLike, text: string): GkedFieldError => {
  const codes = (error.details as { codes?: unknown } | undefined)?.codes;
  return { text, codes: typeof codes === 'string' ? splitGkedCodes(codes) : [] };
};

export interface GkedRuleDraft {
  rule: GkedRule | null;
  draft: Draft;
  set: (k: GkedRuleList, v: string) => void;
  dirty: boolean;
  /** Поле «Предупреждать при ГКЭД» показано. */
  warn: GkedWarnField;
  /** Перечни для ИП и ИТД правятся (окно режима). */
  lists: boolean;
  /** Перечни для сервера: показанные поля; скрытых нет — они прежние. */
  value: () => GkedRuleLists;
  reset: (r: GkedRule | null | undefined) => void;
}

/**
 * Состояние полей окна: `warn: 'status'` — окно статуса («Предупреждать при ГКЭД» видно всегда; у
 * остальных — если перечень есть), `lists` — окно режима (перечни ИП и ИТД — если они есть или перечень
 * только для организаций).
 */
export function useGkedRuleDraft(
  rule: GkedRule | null | undefined,
  { warn = false, lists = false }: { warn?: 'status' | false; lists?: boolean } = {},
): GkedRuleDraft {
  const [base, setBase] = useState<GkedRule | null>(rule ?? null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [dirty, setDirty] = useState(false);
  const showWarn: GkedWarnField =
    warn === 'status' ? 'status' : (base?.warn ?? []).length ? 'regime' : false;
  const showLists =
    lists && (OWNER_LISTS.some((k) => (base?.[k] ?? []).length) || base?.who === 'org');
  return {
    rule: base,
    draft,
    set: (k, v) => {
      setDraft((d) => ({ ...d, [k]: v }));
      setDirty(true);
    },
    dirty,
    warn: showWarn,
    lists: showLists,
    value: () => ({
      in: splitGkedCodes(draft.in),
      ex: splitGkedCodes(draft.ex),
      ...(showWarn ? { warn: splitGkedCodes(draft.warn) } : {}),
      ...(showLists
        ? Object.fromEntries(OWNER_LISTS.map((k) => [k, splitGkedCodes(draft[k])]))
        : {}),
    }),
    reset: (r) => {
      setBase(r ?? null);
      setDraft(draftOf(r));
      setDirty(false);
    },
  };
}

const LABEL: Readonly<Record<GkedRuleList, UiTextKey>> = {
  in: 'pdicts.gkr.in',
  ex: 'pdicts.gkr.ex',
  warn: 'pdicts.gkr.warn',
  ip: 'pdicts.gkr.ip',
  ipEx: 'pdicts.gkr.ip_ex',
  itd: 'pdicts.gkr.itd',
};
const HINT: Partial<Record<GkedRuleList, UiTextKey>> = {
  in: 'pdicts.gkr.in_hint',
  ex: 'pdicts.gkr.ex_hint',
  ip: 'pdicts.gkr.ip_hint',
  ipEx: 'pdicts.gkr.ip_ex_hint',
  itd: 'pdicts.gkr.itd_hint',
};
const PLACEHOLDER: Partial<Record<GkedRuleList, UiTextKey>> = {
  in: 'pdicts.gkr.in_ph',
  ex: 'pdicts.gkr.ex_ph',
  warn: 'pdicts.gkr.warn_ph',
};

/**
 * Поля перечня в сетке окна (`FormGrid`): примечание и «Сверить» перечня, справочные перечни ИП и ИТД
 * (не в окне режима), «Виды деятельности (ГКЭД)», «Кроме», перечни ИП и ИТД (окно режима),
 * «Предупреждать при ГКЭД». `error` — отказ сервера (кода нет в справочнике) под тем перечнем, где
 * код (прототип gkRuleRead); не нашёлся — под «Виды деятельности (ГКЭД)».
 */
export function GkedRuleFields({
  id,
  state,
  error,
}: {
  id: string;
  state: GkedRuleDraft;
  error?: GkedFieldError | undefined;
}) {
  const t = useT();
  const r = state.rule;
  const verify = gkedRuleToVerify(r);
  const shown: GkedRuleList[] = [
    'in',
    'ex',
    ...(state.lists ? OWNER_LISTS : []),
    ...(state.warn ? (['warn'] as const) : []),
  ];
  const errorAt = new Set(
    shown.filter((k) => splitGkedCodes(state.draft[k]).some((c) => error?.codes.includes(c))),
  );
  if (error && !errorAt.size) errorAt.add('in');
  const input = (k: GkedRuleList, hint?: string) => (
    <Field
      key={k}
      id={`${id}-gked-${k}`}
      label={t(LABEL[k])}
      hint={hint ?? (HINT[k] ? t(HINT[k]) : undefined)}
      error={errorAt.has(k) ? error?.text : undefined}
      full
    >
      {(c) => (
        <input
          {...c}
          value={state.draft[k]}
          onChange={(e) => state.set(k, e.target.value)}
          placeholder={PLACEHOLDER[k] ? t(PLACEHOLDER[k]) : undefined}
          className={inputClass({ mono: true })}
        />
      )}
    </Field>
  );
  return (
    <>
      {r?.note ? (
        <div className="col-span-full">
          <Note
            icon={verify && !r.verify ? 'alert' : 'info'}
            tone={verify && !r.verify ? 'warn' : 'info'}
          >
            {t('pdicts.gkr.note', { text: r.note })}
          </Note>
        </div>
      ) : null}
      {r?.verify ? (
        <div className="col-span-full">
          <Note icon="alert" tone="warn">
            {t('pdicts.gkr.verify', { text: r.verify })}
          </Note>
        </div>
      ) : null}
      {state.lists
        ? null
        : OWNER_LISTS.filter((k) => (r?.[k] ?? []).length).map((k) => {
            const n = r![k]!.length;
            return (
              <div key={k} data-field="" className="col-span-full flex min-w-0 flex-col gap-[5px]">
                <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
                  {t(LABEL[k])}
                </span>
                <div className="font-mono text-[12.5px]">{r![k]!.join(', ')}</div>
                <div className="text-[11.5px] leading-[1.4] text-faint">
                  {t(`pdicts.gkr.info_hint.${pluralForm(n)}`, { n })}
                </div>
              </div>
            );
          })}
      {input('in')}
      {input('ex')}
      {state.lists ? OWNER_LISTS.map((k) => input(k)) : null}
      {state.warn
        ? input(
            'warn',
            t(
              state.warn === 'status'
                ? 'pdicts.gkr.warn_hint_status'
                : 'pdicts.gkr.warn_hint_regime',
            ),
          )
        : null}
    </>
  );
}
