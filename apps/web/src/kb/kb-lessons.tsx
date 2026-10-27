'use client';

import type { Feature } from '@buhuchet/domain';
import type { KbLesson, KbState, KbStep } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  EmptyState,
  Icon,
  iconButtonClass,
  linkButtonClass,
  Note,
  pillClass,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { kbArticlesQuery, KB_STATE_KEY, kbSkip, kbStateQuery } from './kb-data';
import { flashTarget } from './kb-go';
import { KbBadge, KbBar, levelDate, nextText } from './kb-parts';
import { useKb } from './kb-provider';

/** Свёрнутые уроки — на этом устройстве у каждого пользователя (прототип `ck.closed.<пользователь>`). */
const closedKey = (userId: string | null) => `bu.kb.closed.${userId ?? ''}`;

function readClosed(key: string): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeClosed(key: string, closed: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...closed]));
  } catch {
    // Хранилище браузера недоступно — выбор живёт до ухода со страницы.
  }
}

/**
 * «База знаний» → «Уроки» (прототип modules/kb.js, renderKB → уроки): программа обучения — уровень,
 * «Продолжить», уроки по модулям со шагами: ★ основной, «Посмотреть» или «Сделать», «Новое», статья
 * шага, как и когда засчитан, «Перейти» и «⋯» («Пропустить», «Вернуть»); урок «Пройден» или
 * «Пройден частично»; «Можно включить». «Показать как» и «Показать экран» добавит задача 2.31.
 * С `?step=` (из «Пройти урок») подсвечен этот шаг, иначе — следующий; урок этого шага раскрыт, даже
 * если его свернули раньше. Свёрнутые уроки запоминаются.
 */
export function KbLessonsTab() {
  const t = useT();
  const query = useQuery(kbStateQuery);
  const key = closedKey(useShell().userId);
  const [closed, setClosed] = useState(() => readClosed(key));
  /** Урок шага из адреса свернули или раскрыли сами — дальше он как все. */
  const [focusToggled, setFocusToggled] = useState(false);
  const flashed = useRef(false);
  const state = query.data;
  const nextId = state?.nextStepId ?? null;
  // Шаг из адреса запоминается при открытии, адрес — снова вкладка (Next.js узнаёт о замене сам).
  const asked = useSearchParams().get('step');
  const [focus] = useState(asked);
  useEffect(() => {
    if (asked) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [asked]);
  // Только шаг своей программы: значение из адреса в селектор не попадает как есть.
  const focusId =
    focus && state?.lessons.some((l) => l.steps.some((s) => s.id === focus)) ? focus : null;
  const target = focusId ?? nextId;

  // Шаг — в середину экрана и вспышкой (прототип: при открытии «Уроков» — следующий шаг).
  useEffect(() => {
    if (!target || flashed.current) return;
    return flashTarget(`[data-kb-step="${target}"]`, () => {
      flashed.current = true;
    });
  }, [target]);

  if (query.isError) return <Note tone="bad">{t('kb.load_error')}</Note>;
  if (!state) return null;
  if (!state.lessons.length) {
    return (
      <EmptyState
        icon="list"
        title={t('kb.lessons.empty_title')}
        text={t('kb.lessons.empty_text')}
      />
    );
  }
  const focusLesson = focusToggled
    ? null
    : (state.lessons.find((l) => l.steps.some((s) => s.id === focusId))?.id ?? null);
  const isOpen = (id: string) => id === focusLesson || !closed.has(id);
  const toggle = (id: string) => {
    const next = new Set(closed);
    if (isOpen(id)) next.add(id);
    else next.delete(id);
    if (id === focusLesson) setFocusToggled(true);
    setClosed(next);
    writeClosed(key, next);
  };
  return (
    <div className="flex flex-col gap-3.5">
      <ProgramBox state={state} />
      {state.lessons.map((lesson, i) => (
        <LessonBox
          key={lesson.id}
          n={i + 1}
          lesson={lesson}
          nextId={nextId}
          open={isOpen(lesson.id)}
          onToggle={() => toggle(lesson.id)}
        />
      ))}
      <Offers state={state} />
    </div>
  );
}

function ProgramBox({ state }: { state: KbState }) {
  const t = useT();
  const kb = useKb();
  const p = state.progress;
  const next = state.lessons.flatMap((l) => l.steps).find((s) => s.id === state.nextStepId);
  return (
    <Box
      title={t(state.admin ? 'kb.lessons.title_admin' : 'kb.lessons.title')}
      actions={
        <KbBadge
          level={p.level}
          name={p.levels[p.level]?.name ?? ''}
          pct={p.pct}
          of={p.levels.length}
        />
      }
    >
      <KbBar pct={p.pct} />
      <div className="flex flex-wrap items-center gap-2.5 max-md:[&>button]:flex-[1_1_100%] max-md:[&>button]:justify-center max-md:[&>button]:whitespace-normal">
        <span className="min-w-0 flex-1 text-muted">
          {t('kb.lessons.summary', {
            done: p.done,
            total: p.total,
            next: p.next === null ? t('kb.top_lower') : nextText(t, p),
          })}
        </span>
        {next ? (
          <button type="button" className={buttonClass('cta')} onClick={() => kb.go(next.id)}>
            <Icon name="play" size="sm" />
            {t('kb.continue_to', {
              title: next.title.length > 40 ? `${next.title.slice(0, 38)}…` : next.title,
            })}
          </button>
        ) : null}
      </div>
    </Box>
  );
}

function LessonStatus({ lesson }: { lesson: KbLesson }) {
  const t = useT();
  if (lesson.status === 'done') {
    return (
      <span className={`${pillClass('sm')} bg-ok-bg text-ok`}>
        <Icon name="ok" size="sm" />
        {lesson.doneAt
          ? t('kb.lesson.done_at', { date: levelDate(lesson.doneAt) })
          : t('kb.lesson.done')}
      </span>
    );
  }
  if (lesson.status === 'partial') {
    return (
      <span className={`${pillClass('sm')} bg-warn-bg text-warn-label`}>
        {t('kb.lesson.partial')}
      </span>
    );
  }
  return null;
}

function LessonBox({
  n,
  lesson,
  nextId,
  open,
  onToggle,
}: {
  n: number;
  lesson: KbLesson;
  nextId: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const done = lesson.steps.filter((s) => s.done).length;
  return (
    <section
      data-kb-lesson={lesson.id}
      className="overflow-hidden rounded-xl border border-line bg-raised"
    >
      <div className="flex w-full flex-wrap items-center gap-2.5 py-1 pr-4 text-[14px] hover:bg-row-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-[1_1_220px] cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent py-2 pl-4 text-left text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue"
        >
          <span
            className={`inline-flex transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          >
            <Icon name="right" size="sm" />
          </span>
          <b className="flex-1">
            {n}. {lesson.title}
          </b>
        </button>
        <LessonStatus lesson={lesson} />
        <span
          className={`text-[12.5px] font-semibold ${done === lesson.steps.length ? 'text-ok' : 'text-muted'}`}
        >
          {t('kb.lesson.count', { done, total: lesson.steps.length })}
        </span>
      </div>
      {open ? (
        <div className="flex flex-col border-t border-line">
          {lesson.steps.map((step) => (
            <StepRow key={step.id} step={step} next={step.id === nextId} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** «засчитано действием · 27.10.2026» (прототип ckHowTxt). */
const doneText = (t: Translate, step: KbStep) =>
  step.done
    ? t('kb.step.done', {
        how: `${t(`kb.how.${step.done.how}`)} · ${levelDate(step.done.at)}`,
      })
    : '';

function StepRow({ step, next }: { step: KbStep; next: boolean }) {
  const t = useT();
  const kb = useKb();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const articles = useQuery(kbArticlesQuery).data;
  const read = articles?.find((a) => a.id === step.articleId)?.read ?? false;
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const skip = async (on: boolean) => {
    try {
      client.setQueryData(KB_STATE_KEY, await kbSkip(step.id, on));
    } catch (e) {
      if (e instanceof ApiFailure) toast(errorText(e.error), { bad: true });
    }
  };
  const items: ActionEntry[] = [
    ...(!step.done && !step.skipped
      ? [
          {
            id: 'skip',
            label: t('kb.step.skip'),
            icon: 'ban' as const,
            sub: t('kb.step.skip_sub'),
            run: () => void skip(true),
          },
        ]
      : []),
    ...(step.skipped
      ? [
          {
            id: 'unskip',
            label: t('kb.step.unskip'),
            icon: 'refresh' as const,
            run: () => void skip(false),
          },
        ]
      : []),
    ...(!step.done
      ? [{ id: 'go', label: t('kb.go'), icon: 'right' as const, run: () => kb.go(step.id) }]
      : []),
  ];
  return (
    <div
      data-kb-step={step.id}
      data-kb-state={step.done ? 'done' : step.skipped ? 'skipped' : 'open'}
      className={`flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0 max-md:flex-wrap ${next ? 'bg-sel' : ''} ${step.skipped ? 'opacity-55' : ''}`}
    >
      <span className={`pt-0.5 ${step.done ? 'text-ok' : 'text-faint'}`}>
        <Icon name={step.done ? 'ok' : step.skipped ? 'ban' : 'circle'} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] leading-[1.4]">
          {step.star ? (
            <span className="font-bold text-warn-label" title={t('kb.step.star_title')}>
              {'★ '}
            </span>
          ) : null}
          <span
            title={t(step.learn ? 'kb.step.learn_title' : 'kb.step.do_title')}
            className={`mr-0.5 inline-flex items-center rounded px-1.5 align-[1px] text-[10.5px] leading-[17px] font-[650] tracking-[.03em] whitespace-nowrap ${step.learn ? 'bg-sel text-label' : 'bg-ok-bg text-ok'}`}
          >
            {t(step.learn ? 'kb.step.learn' : 'kb.step.do')}
          </span>
          {step.isNew && !step.done ? (
            <>
              {' '}
              <span className={`${pillClass('sm')} bg-info-bg text-info`}>{t('kb.step.new')}</span>
            </>
          ) : null}{' '}
          <b className={`${step.done ? 'text-muted' : ''} ${step.skipped ? 'line-through' : ''}`}>
            {step.title}
          </b>
        </div>
        <div className="text-[11.5px] leading-[1.4] text-faint">
          {step.why}
          {step.articleId ? (
            <>
              {' · '}
              <button
                type="button"
                className={linkButtonClass()}
                onClick={() => kb.openArticle({ id: step.articleId!, stepId: step.id })}
              >
                {t(read ? 'kb.step.article_read' : 'kb.step.article')}
              </button>
            </>
          ) : null}
          {step.done ? (
            <>
              {' · '}
              <span className="text-ok">{doneText(t, step)}</span>
            </>
          ) : step.skipped ? (
            ` · ${t('kb.step.skipped')}`
          ) : null}
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5 max-md:w-full max-md:pl-7 max-md:[&>button:first-child]:flex-1 max-md:[&>button:first-child]:justify-center">
        {!step.done ? (
          <button type="button" className={buttonClass('cta', 'sm')} onClick={() => kb.go(step.id)}>
            {t('kb.go')}
          </button>
        ) : null}
        <button
          type="button"
          className={iconButtonClass('sm')}
          aria-label={t('kb.step.more')}
          title={t('kb.step.more')}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(e) => setMenu(menu ? null : e.currentTarget)}
        >
          <Icon name="more" size="sm" />
        </button>
      </div>
      {menu ? (
        <ActionMenu
          items={items}
          place={{ anchor: menu }}
          label={t('kb.step.more')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * «Можно включить» (прототип renderKB, `off`): выключенные в учётной политике функции, у которых есть
 * уроки, и польза от них; «Включить» (с правом «Настройки и учётная политика») ведёт к переключателю
 * функции в учётной политике.
 */
function Offers({ state }: { state: KbState }) {
  const t = useT();
  const router = useRouter();
  const { access } = useShell();
  if (!state.offers.length) return null;
  const canOrg = access.can('org');
  return (
    <Box title={t('kb.offers.title')}>
      <span className="-mt-1 text-[11.5px] leading-[1.4] text-faint">
        {t(canOrg ? 'kb.offers.hint_org' : 'kb.offers.hint')}
      </span>
      <div className="flex flex-col">
        {state.offers.map((o) => (
          <div
            key={o.feature}
            className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0"
          >
            <span className="min-w-0 flex-1">
              <b>{t(`org.feature.${o.feature as Feature}`)}</b>
              <div className="text-[11.5px] leading-[1.4] text-faint">{o.benefit}</div>
            </span>
            {canOrg ? (
              <button
                type="button"
                className={buttonClass('default', 'sm')}
                onClick={() => {
                  router.push(tabHref('org', 'policy'));
                  flashTarget(`[data-feat-row="${o.feature}"]`);
                }}
              >
                {t('kb.offers.on')}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Box>
  );
}
