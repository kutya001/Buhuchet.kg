'use client';

import { pluralForm } from '@buhuchet/domain';
import { Box, buttonClass, Icon, Note } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useT } from '../l10n/provider';
import { tabHref } from '../shell/modules';
import { kbStateQuery } from './kb-data';
import { KbBar, KbLadder, KbModules, levelTone } from './kb-parts';
import { useKb } from './kb-provider';

/**
 * «База знаний» → «Мой уровень» (прототип modules/kb.js, renderKB → level): уровень и процент,
 * «Продолжить», сколько шагов до следующего уровня, как считается уровень, прогресс по модулям,
 * прочитанные статьи и лесенка уровней. «Приветствие и обзор модулей» добавит задача 2.33, «Знакомые
 * элементы в показах» — 2.31.
 */
export function KbLevelTab() {
  const t = useT();
  const kb = useKb();
  const query = useQuery(kbStateQuery);
  if (query.isError) return <Note tone="bad">{t('kb.load_error')}</Note>;
  const state = query.data;
  if (!state) return null;
  const p = state.progress;
  const level = p.levels[p.level];
  const nextLevel = p.next === null ? null : p.levels[p.next];
  const next = state.nextStepId
    ? state.lessons.flatMap((l) => l.steps).find((s) => s.id === state.nextStepId)
    : undefined;
  const artsPct = state.articles.total ? (state.articles.read / state.articles.total) * 100 : 0;
  return (
    <div className="flex flex-col gap-3.5">
      <Box>
        <div className="flex flex-wrap items-center gap-3.5">
          <span
            aria-hidden="true"
            className={`inline-grid h-[52px] w-[52px] place-items-center rounded-2xl ${levelTone(p.level).big}`}
          >
            <Icon name="grad" className="h-7 w-7" />
          </span>
          <div className="min-w-[200px] flex-1">
            <div data-kb-level-head="" className="text-[20px] font-bold tracking-[-.01em]">
              {t('kb.level.head', { name: level?.name ?? '', pct: p.pct })}
            </div>
            <div className="text-muted">
              {t('kb.level.of', {
                n: p.level + 1,
                total: p.levels.length,
                done: p.done,
                steps: p.total,
              })}
            </div>
          </div>
          {next ? (
            <button type="button" className={buttonClass('cta')} onClick={() => kb.go(next.id)}>
              <Icon name="play" size="sm" />
              {t('kb.continue')}
            </button>
          ) : null}
        </div>
        <KbBar pct={p.pct} />
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex-1 text-muted">
            {nextLevel
              ? t(`kb.need.${pluralForm(p.need)}`, { n: p.need, name: nextLevel.name })
              : t('kb.need_top')}
          </span>
          {next ? (
            <span className="text-[11.5px] text-faint">
              {t('kb.next_step', { title: `${next.star ? '★ ' : ''}${next.title}` })}
            </span>
          ) : null}
        </div>
        <div className="rounded-lg bg-pane-alt px-3.5 py-2.5 text-[13px] leading-normal">
          <b>{t('kb.rules.title')}</b>
          <ul className="mt-1 mb-0 pl-5 text-muted [&>li]:my-0.5">
            <li>{t('kb.rules.program')}</li>
            <li>{t('kb.rules.marks')}</li>
            <li>{t('kb.rules.once')}</li>
            <li>{t('kb.rules.pct')}</li>
          </ul>
        </div>
      </Box>
      <Box title={t('kb.mods.title')}>
        <KbModules progress={p} />
      </Box>
      <Box title={t('kb.arts.title')}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex-1">
            {t('kb.arts.read')} <b>{t('kb.arts.read_count', state.articles)}</b>
          </span>
          <Link href={tabHref('kb', 'arts')} className={buttonClass('default', 'sm')}>
            <Icon name="book" size="sm" />
            {t('kb.arts.open')}
          </Link>
        </div>
        <KbBar pct={artsPct} />
        <span className="text-[11.5px] leading-[1.4] text-faint">{t('kb.arts.hint')}</span>
      </Box>
      <Box title={t('kb.levels.title')}>
        <KbLadder progress={p} />
      </Box>
    </div>
  );
}
