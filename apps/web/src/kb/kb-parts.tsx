'use client';

import { bishkekDate, formatDateRu, pluralForm } from '@buhuchet/domain';
import type { KbProgress } from '@buhuchet/shared';
import { Box, Icon, linkButtonClass, pillClass } from '@buhuchet/ui';
import type { ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

/**
 * Части экранов «Базы знаний» (прототип modules/kb.js: kbBadge, kbBar, kbModsHtml, kbLevelsHtml,
 * kbBox, kbNextTxt): уровень меткой, полоса прогресса, прогресс по модулям, лесенка уровней и блок
 * «Уровень знаний» для «Мой профиль» и карточки сотрудника.
 */

/** Цвет уровня по номеру (прототип `KB_CL`: серый, синий, зелёный, фиолетовый, жёлтый). */
const LEVEL_TONES = [
  { pill: 'bg-label-bg text-label', big: 'bg-sel text-muted' },
  { pill: 'bg-info-bg text-info', big: 'bg-info-bg text-info' },
  { pill: 'bg-ok-bg text-ok', big: 'bg-ok-bg text-ok' },
  { pill: 'bg-violet-bg text-violet', big: 'bg-violet-bg text-violet' },
  { pill: 'bg-warn-bg text-warn-label', big: 'bg-warn-bg text-warn-label' },
] as const;

export const levelTone = (level: number) => LEVEL_TONES[level] ?? LEVEL_TONES[1];

/** Дата получения уровня по Бишкеку («27.10.2026»). */
export const levelDate = (iso: string) => formatDateRu(bishkekDate(new Date(iso)));

/** Уровень меткой: «Ученик · 35 %» (`pct: false` — без процента; `big` — крупная). */
export function KbBadge({
  level,
  name,
  pct,
  of,
  big = false,
}: {
  level: number;
  name: string;
  pct: number | false;
  of: number;
  big?: boolean;
}) {
  const t = useT();
  return (
    <span
      data-kb-level={level}
      title={t('kb.badge.title', { n: level + 1, total: of })}
      className={`${pillClass(big ? 'md' : 'sm')} ${levelTone(level).pill} ${big ? 'py-[3px] pr-3 pl-[9px] text-[13px]' : ''}`}
    >
      <Icon name="grad" size="sm" />
      {pct === false ? name : `${name} · ${pct} %`}
    </span>
  );
}

/** Полоса прогресса (`.bar.chk-bar`). */
export function KbBar({ pct, thin = false }: { pct: number; thin?: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)] ${thin ? 'h-[5px]' : 'h-1.5'}`}
    >
      <i className="block h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** «ещё 2 шага до «Уверенный пользователь»» или «это высший уровень» (прототип kbNextTxt). */
export function nextText(t: Translate, p: KbProgress): string {
  const next = p.next === null ? null : p.levels[p.next];
  if (!next) return t('kb.next_top');
  return t(`kb.next.${pluralForm(p.need)}`, { n: p.need, name: next.name });
}

/** Прогресс по модулям: «Моя организация 2 из 4» с полосой. */
export function KbModules({ progress }: { progress: KbProgress }) {
  const t = useT();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-[18px] gap-y-2">
      {progress.groups.map((g) => (
        <div
          key={g.id}
          data-kb-group={g.id}
          className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 text-[13px]"
        >
          <span className="min-w-0">{g.title}</span>
          <span
            className={`text-[12.5px] font-semibold ${g.done === g.total ? 'text-ok' : 'text-muted'}`}
          >
            {t('kb.mods.count', { done: g.done, total: g.total })}
          </span>
          <div className="col-span-full">
            <KbBar pct={g.total ? Math.round((g.done / g.total) * 100) : 0} thin />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Лесенка уровней: номер, название, порог и когда получен (прототип kbLevelsHtml). */
export function KbLadder({ progress }: { progress: KbProgress }) {
  const t = useT();
  const last = progress.levels.length - 1;
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {progress.levels.map((l, i) => {
        const on = i <= progress.level;
        const cur = i === progress.level;
        return (
          <li
            key={l.name}
            data-kb-ladder={on ? 'on' : 'off'}
            aria-current={cur ? 'step' : undefined}
            className={`flex flex-wrap items-center gap-2.5 rounded-lg border px-2.5 py-[7px] text-[13px] ${cur ? 'border-line-strong bg-sel' : 'border-line'}`}
          >
            <span
              className={`${pillClass('sm')} ${on ? levelTone(i).pill : 'bg-faint-pill-bg text-label'}`}
            >
              <Icon name={on ? 'ok' : 'grad'} size="sm" />
              {i + 1}
            </span>
            <b>{l.name}</b>
            <span className="text-muted">
              {i === last && l.percent >= 100
                ? t('kb.levels.full')
                : t('kb.levels.from', { p: l.percent })}
            </span>
            <span className="flex-1" />
            <span className={on ? 'text-ok' : 'text-faint'}>
              {on && l.reachedAt
                ? t('kb.levels.got_at', { date: levelDate(l.reachedAt) })
                : on
                  ? t('kb.levels.got')
                  : t('kb.levels.not_yet')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Блок «Уровень знаний» (прототип kbBox): уровень крупной меткой, «N из M шагов», полоса, сколько до
 * следующего уровня и когда получен текущий; `modules` — с прогрессом по модулям (карточка сотрудника),
 * `action` — справа в заголовке («Открыть Базу знаний» в «Мой профиль»).
 */
export function KbBox({
  progress,
  modules = false,
  action,
}: {
  progress: KbProgress;
  modules?: boolean;
  action?: ReactNode;
}) {
  const t = useT();
  const p = progress;
  const level = p.levels[p.level];
  const got = level?.reachedAt;
  return (
    <div data-kb-box="">
      <Box title={t('kb.box.title')} actions={action}>
        <div className="flex flex-wrap items-center gap-2.5">
          <KbBadge level={p.level} name={level?.name ?? ''} pct={p.pct} of={p.levels.length} big />
          <span className="flex-1" />
          <span className="text-muted">
            {t('kb.member.steps', { done: p.done, total: p.total })}
          </span>
        </div>
        <KbBar pct={p.pct} />
        <span className="text-[11.5px] leading-[1.4] text-faint">
          {p.next === null ? t('kb.top') : nextText(t, p)}
          {got ? ` · ${t('kb.box.got', { name: level.name, date: levelDate(got) })}` : ''}
        </span>
        {modules ? <KbModules progress={p} /> : null}
      </Box>
    </div>
  );
}

/** Ссылка-кнопка в заголовке блока: обычными буквами, а не прописными заголовка. */
export const BOX_LINK_CLASS = `${linkButtonClass()} text-[12.5px] tracking-normal normal-case`;
