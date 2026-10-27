'use client';

import { pluralForm, type Feature, type MenuModuleId } from '@buhuchet/domain';
import type { KbMarkResult, KbState, KbStep } from '@buhuchet/shared';
import { buttonClass, Icon, iconButtonClass, Modal, useToast, useWindow } from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SAVED_EVENT } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import { KbArticleDialog, type ArticleScreenInfo, type ArticleView } from './kb-article';
import {
  kbArticleQuery,
  kbArticlesQuery,
  kbHit,
  kbLook,
  kbRead,
  KB_STATE_KEY,
  kbStateQuery,
  kbSync,
} from './kb-data';
import { flashTarget, KB_GO } from './kb-go';

/*
 * Обучение по ходу работы (задача 2.30, ТЗ «База знаний» и «Обучение и подсказки», прототип
 * modules/kb-lessons.js — ckGo, ckLook, ckEval, ckDoneDlg, ckBar, kbCongrats): «Перейти» у шага,
 * полоса урока внизу экрана, таймер 3 секунды у «Посмотреть», окно «Шаг выполнен», уведомления о
 * засчитанных шагах и «Новый уровень». Засчитывает шаги сервер; здесь — только отклик.
 */

/** Сколько смотреть экран шага «Посмотреть» после «Перейти» (решение заказчика 25.10.2026). */
const LOOK_MS = 3000;
/** Таймер стартует, когда экран после перехода встал на место. */
const LOOK_START_MS = 450;
/** «Перейти» без прихода на экран шага за это время — таймер не начнётся. */
const LOOK_ARM_MS = 3000;
/** Сверка шагов после сохранения — через столько после последнего сохранения. */
const SYNC_DELAY_MS = 250;
/** Сколько видно «Новый уровень». */
const CONGRATS_MS = 4200;

export interface KbControls {
  /** «Перейти» у шага; `replace` — из открытого окна (его запись истории заменяется). */
  go: (stepId: string, options?: { replace?: boolean }) => void;
  /** Первое использование функции (поиск, столбцы, группировка, «В Excel», свайп). */
  hit: (name: string) => void;
  /** Открыть статью; `stepId` — из строки шага, `help` — из «?». */
  openArticle: (view: ArticleView) => void;
  /** «?» в шапке: статья о модуле; false — статьи нет (окно с описанием модуля). */
  help: (module: MenuModuleId) => Promise<boolean>;
  /** Открыть урок в «Уроках»: подсвечен его первый невыполненный шаг. */
  openLesson: (lessonId: string) => void;
}

export const KbContext = createContext<KbControls>({
  go: () => {},
  hit: () => {},
  openArticle: () => {},
  help: async () => false,
  openLesson: () => {},
});

export function useKb(): KbControls {
  return useContext(KbContext);
}

/**
 * «Пройти урок» в окне «Функция … включена» (прототип onboard.js, featOnDlg и featLesson): урок
 * функции есть в программе пользователя — открыть его; null — у функции нет урока или его шаги ещё
 * скрыты (модуль не сделан). «Показать как» первого шага добавит задача 2.31.
 */
export function useFeatureLesson(feature: Feature | null): (() => void) | null {
  const kb = useKb();
  const state = useQuery(kbStateQuery).data;
  const lesson = feature ? state?.featureLessons[feature] : undefined;
  return lesson ? () => kb.openLesson(lesson) : null;
}

/** Адрес «Уроков» с шагом, который нужно подсветить (`?step=`). */
export const lessonStepHref = (lessonsHref: string, stepId: string) =>
  `${lessonsHref}?step=${encodeURIComponent(stepId)}`;

/** Что «База знаний» берёт у оболочки. */
export interface KbShellInfo extends ArticleScreenInfo {
  /** Текущий экран «модуль.вкладка» (у модуля без вкладок — «модуль»). */
  screen: string | null;
  /** Адрес вкладки модуля; null — модуля нет в меню. */
  tabHrefOf: (module: MenuModuleId, tab?: string) => string | null;
  /** Выбрать способ «+ Добавить» модуля. */
  onAdd: (module: MenuModuleId, actionId: string) => void;
  /** Открыть «Мой профиль». */
  onProfile: () => void;
  lessonsHref: string;
}

/** Урок, начатый «Перейти»: полоса внизу (`bar`), закрыта крестиком (`off`). */
interface Lesson {
  id: string;
  bar: boolean;
  off: boolean;
}

/** Таймер «Смотрите экран…»: `end` null — «Перейти» нажат, экран шага ещё не открылся. */
interface Look {
  id: string;
  armedAt: number;
  end: number | null;
}

interface DoneDialog {
  id: string;
  title: string;
  look: boolean;
}

const stepsOf = (state: KbState | undefined): KbStep[] =>
  state ? state.lessons.flatMap((l) => l.steps) : [];

/** Следующий шаг после этого: не выполненный и не пропущенный, по кругу (прототип ckNext). */
export function nextStepAfter(state: KbState | undefined, id: string): KbStep | null {
  const all = stepsOf(state);
  const k = all.findIndex((s) => s.id === id);
  return [...all.slice(k + 1), ...all.slice(0, k + 1)].find((s) => !s.done && !s.skipped) ?? null;
}

/** Открыт ли экран шага «Посмотреть» (прототип ckOnScr). */
export const onStepScreen = (step: KbStep, screen: string | null): boolean =>
  !!screen && step.screens.some((a) => a === screen || a === screen.split('.')[0]);

/**
 * «База знаний» на рабочей странице: управление (`controls` — оболочка кладёт его в `KbContext` и сама
 * зовёт `hit` и `help`) и то, что рисуется поверх экрана (`overlays`: полоса урока, окна, «Новый
 * уровень»).
 */
export function useKbRuntime(shell: KbShellInfo): { controls: KbControls; overlays: ReactNode } {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const state = useQuery(kbStateQuery).data;
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const [done, setDone] = useState<DialogSlot<DoneDialog> | null>(null);
  const [article, setArticle] = useState<DialogSlot<ArticleView> | null>(null);
  const [congrats, setCongrats] = useState<{ name: string; n: number } | null>(null);
  /** «Перейти» к шагу, который открывает «+ Добавить»: способ выбирается, когда модуль открыт. */
  const [pendingAdd, setPendingAdd] = useState<{ module: MenuModuleId; add: string } | null>(null);
  const shown = useRef(new Set<string>());
  const hits = useRef(new Set<string>());
  // Отклик на ответ и «Перейти» читают урок и программу на момент события.
  const lessonRef = useRef(lesson);
  const stateRef = useRef(state);
  useEffect(() => {
    lessonRef.current = lesson;
    stateRef.current = state;
  }, [lesson, state]);

  /**
   * Ответ отметки: программа после неё — в кэш; «Сделать», засчитанный у шага урока (или первый из
   * засчитанных, если урок начат), — окно «Готово: шаг выполнен», остальные — уведомлением (прототип
   * ckEval). Сверка при входе — без отклика.
   */
  const apply = useCallback(
    (result: KbMarkResult, source: 'open' | 'saved' | 'hit' | 'look') => {
      client.setQueryData(KB_STATE_KEY, result.state);
      if (result.fresh.length) void client.invalidateQueries({ queryKey: ['kb', 'member'] });
      if (source === 'open') return;
      if (result.congrats) setCongrats((c) => ({ name: result.congrats!, n: (c?.n ?? 0) + 1 }));
      if (source === 'look') {
        const step = result.fresh[0];
        if (step && !shown.current.has(step.id)) {
          shown.current.add(step.id);
          setDone(openSlot<DoneDialog>({ id: step.id, title: step.title, look: true }));
        }
        return;
      }
      const active = lessonRef.current;
      const pick = active
        ? (result.fresh.find((f) => f.id === active.id && !f.learn) ??
          result.fresh.find((f) => !f.learn))
        : undefined;
      if (pick && !shown.current.has(pick.id)) {
        shown.current.add(pick.id);
        setLesson({ id: pick.id, bar: true, off: false });
        setDone(openSlot<DoneDialog>({ id: pick.id, title: pick.title, look: false }));
      }
      const rest = result.fresh.filter((f) => f !== pick);
      if (rest.length === 1) {
        toast(t('kb.toast.step', { title: rest[0]!.title }), { icon: 'grad' });
      } else if (rest.length > 1) {
        toast(
          t(`kb.toast.steps.${pluralForm(rest.length)}`, {
            n: rest.length,
            titles: rest.map((f) => `«${f.title}»`).join(', '),
          }),
          { icon: 'grad' },
        );
      }
    },
    [client, t, toast],
  );

  // При входе — тихая сверка: что пользователь уже делал раньше, засчитывается без окон.
  useEffect(() => {
    let alive = true;
    kbSync('open')
      .then((r) => alive && apply(r, 'open'))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [apply]);

  // После сохранения — сверка с историей: шаг «Сделать» засчитывается сразу с откликом.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saved = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        kbSync('saved')
          .then((r) => apply(r, 'saved'))
          .catch(() => {});
      }, SYNC_DELAY_MS);
    };
    window.addEventListener(SAVED_EVENT, saved);
    return () => {
      window.removeEventListener(SAVED_EVENT, saved);
      clearTimeout(timer);
    };
  }, [apply]);

  const hit = useCallback(
    (name: string) => {
      // Первое использование отмечает шаг «Работы со списками» с тем же кодом: уже засчитанный или
      // шаг не своей программы — запрос не нужен; за открытие страницы — один раз.
      const current = stateRef.current;
      const step = stepsOf(current).find((s) => s.id === name);
      if (hits.current.has(name) || (current && (!step || step.done))) return;
      hits.current.add(name);
      kbHit(name)
        .then((r) => apply(r, 'hit'))
        .catch(() => hits.current.delete(name));
    },
    [apply],
  );

  // «Столбцы», «Группировка» и «В Excel» любого списка — первое использование.
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[data-grid-columns-button]')) hit('cols');
      else if (el?.closest('[data-grid-group-button]')) hit('grp');
      else if (el?.closest('[data-grid-export]')) hit('xls');
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, [hit]);

  const { tabHrefOf, onAdd, onProfile } = shell;
  const go = useCallback(
    (id: string, options?: { replace?: boolean }) => {
      const step = stepsOf(stateRef.current).find((s) => s.id === id);
      if (!step) return;
      setLesson({ id, bar: true, off: false });
      setDone(closeSlot);
      setArticle(closeSlot);
      if (step.learn && step.screens.length && !step.done) {
        setLook({ id, armedAt: Date.now(), end: null });
      } else {
        setLook(null);
      }
      const target = KB_GO[id];
      const module = target ? target.module : (step.module as MenuModuleId | null);
      if (module) {
        const href = tabHrefOf(module, target?.tab);
        if (href && options?.replace) router.replace(href);
        else if (href) router.push(href);
      }
      const open = target?.open;
      if (open === 'profile') onProfile();
      else if (open && module) setPendingAdd({ module, add: open.add });
      if (!open || open === 'profile') {
        const phone = window.matchMedia('(max-width: 767px)').matches;
        flashTarget(phone && target?.phoneFlash ? target.phoneFlash : (target?.flash ?? 'main'));
      }
    },
    [router, tabHrefOf, onProfile],
  );

  const shownModule = shell.screen?.split('.')[0] ?? null;
  useEffect(() => {
    if (!pendingAdd || shownModule !== pendingAdd.module) return;
    const timer = setTimeout(() => {
      setPendingAdd(null);
      onAdd(pendingAdd.module, pendingAdd.add);
    }, 220);
    return () => clearTimeout(timer);
  }, [pendingAdd, shownModule, onAdd]);

  // «Смотрите экран… 3»: после «Перейти» на экране шага — 3 секунды, ушёл раньше — не засчитан.
  const lookStep = look ? stepsOf(state).find((s) => s.id === look.id) : undefined;
  const onScreen = !!lookStep && onStepScreen(lookStep, shell.screen);
  useEffect(() => {
    if (!look) return;
    if (look.end === null) {
      if (!onScreen) {
        const left = LOOK_ARM_MS - (Date.now() - look.armedAt);
        const timer = setTimeout(() => setLook(null), Math.max(0, left));
        return () => clearTimeout(timer);
      }
      const timer = setTimeout(() => {
        setLook({ ...look, end: Date.now() + LOOK_MS });
        setLesson((l) => (l && l.id === look.id ? { ...l, bar: true, off: false } : l));
      }, LOOK_START_MS);
      return () => clearTimeout(timer);
    }
    if (!onScreen) {
      // Ушёл с экрана шага раньше 3 секунд — таймер сброшен, шаг не засчитан.
      const timer = setTimeout(() => setLook(null));
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(
      () => {
        setLook(null);
        kbLook(look.id)
          .then((r) => apply(r, 'look'))
          .catch(() => {});
      },
      Math.max(0, look.end - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [look, onScreen, apply]);

  const openArticle = useCallback(
    (view: ArticleView) => {
      void client
        .fetchQuery(kbArticleQuery(view.id))
        .then(() => setArticle(openSlot(view)))
        .catch(() => {});
    },
    [client],
  );

  const help = useCallback(
    async (module: MenuModuleId) => {
      const list = await client.fetchQuery(kbArticlesQuery).catch(() => []);
      const found = list.find((a) => a.module === module);
      if (!found) return false;
      openArticle({ id: found.id, help: true });
      return true;
    },
    [client, openArticle],
  );

  /** Статья дочитана: засчитать её шаг «Посмотреть» (прототип kbArtRead). */
  const onRead = useCallback(
    (view: ArticleView) => {
      kbRead(view.id, view.stepId)
        .then((r) => {
          client.setQueryData(KB_STATE_KEY, r.state);
          void client.invalidateQueries({ queryKey: ['kb', 'articles'] });
          void client.invalidateQueries({ queryKey: ['kb', 'article', view.id] });
          if (r.congrats) setCongrats((c) => ({ name: r.congrats!, n: (c?.n ?? 0) + 1 }));
          if (r.fresh.length === 1) {
            toast(t('kb.toast.viewed', { title: r.fresh[0]!.title }), { icon: 'grad' });
          } else if (r.fresh.length > 1) {
            toast(t('kb.toast.viewed_n', { n: r.fresh.length }), { icon: 'grad' });
          } else if (r.first) {
            toast(t('kb.toast.read'), { icon: 'book' });
          }
        })
        .catch(() => {});
    },
    [client, t, toast],
  );

  const lessonsHref = shell.lessonsHref;
  const openLesson = useCallback(
    (lessonId: string) => {
      const steps = stateRef.current?.lessons.find((l) => l.id === lessonId)?.steps ?? [];
      const step = steps.find((s) => !s.done && !s.skipped) ?? steps[0];
      router.push(step ? lessonStepHref(lessonsHref, step.id) : lessonsHref);
    },
    [router, lessonsHref],
  );

  const controls = useMemo(
    () => ({ go, hit, openArticle, help, openLesson }),
    [go, hit, openArticle, help, openLesson],
  );

  const barStep = lesson ? stepsOf(state).find((s) => s.id === lesson.id) : undefined;
  const showBar = !!lesson && !!barStep && lesson.bar && !lesson.off && shownModule !== 'kb';

  const overlays = (
    <>
      {showBar ? (
        <LessonBar
          step={barStep}
          look={look?.end && onScreen && look.id === barStep.id ? look.end : null}
          onBack={() => {
            setLesson((l) => l && { ...l, bar: false });
            router.push(shell.lessonsHref);
          }}
          onClose={() => setLesson((l) => l && { ...l, off: true })}
        />
      ) : null}
      {done ? (
        <StepDoneDialog
          key={`kb-done-${done.n}`}
          dialog={done.data}
          open={done.open}
          state={state}
          onStay={() => {
            setDone(closeSlot);
            setLesson((l) => l && { ...l, bar: true, off: false });
          }}
          onNext={(id) => go(id, { replace: true })}
          onBack={() => {
            setDone(closeSlot);
            setLesson(null);
            router.replace(shell.lessonsHref);
          }}
        />
      ) : null}
      {article ? (
        <KbArticleDialog
          key={`kb-art-${article.n}`}
          view={article.data}
          open={article.open}
          onClose={() => setArticle(closeSlot)}
          onRead={onRead}
          info={shell}
        />
      ) : null}
      {congrats ? <Congrats key={congrats.n} name={congrats.name} /> : null}
    </>
  );
  return { controls, overlays };
}

/**
 * Полоса урока внизу экрана (прототип ckBar): «Урок: …», «выполнено», «К Базе знаний» и крестик; пока
 * идёт таймер шага «Посмотреть» — «Смотрите экран… 3» с полосой-таймером.
 */
function LessonBar({
  step,
  look,
  onBack,
  onClose,
}: {
  step: KbStep;
  look: number | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!look) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [look]);
  const left = look ? Math.max(0, look - now) : 0;
  return (
    <div
      role="status"
      data-kb-bar={look ? 'look' : 'lesson'}
      className={`fixed right-[22px] bottom-[calc(18px+env(safe-area-inset-bottom,0px))] z-[45] flex max-w-[min(680px,calc(100vw-24px))] animate-slide-up items-center gap-2.5 border border-line-strong bg-raised py-1.5 pr-1.5 pl-3.5 text-[13px] shadow-pop max-md:right-3 max-md:bottom-[calc(84px+env(safe-area-inset-bottom,0px))] max-md:left-3 max-md:max-w-none ${look ? 'flex-wrap gap-y-1.5 rounded-2xl' : 'rounded-full max-md:rounded-2xl'}`}
    >
      <Icon name={look ? 'eye' : step.done ? 'ok' : 'grad'} size="sm" />
      <span className="min-w-0 flex-1 truncate">
        {look ? (
          <>
            {t('kb.bar.look')} <b data-kb-countdown="">{Math.max(1, Math.ceil(left / 1000))}</b>{' '}
            <span className="text-faint">· {step.title}</span>
          </>
        ) : (
          <>
            {t('kb.bar.lesson')} <b>{step.title}</b>
            {step.done ? (
              <>
                {' '}
                <span className="font-semibold text-ok">{t('kb.bar.done')}</span>
              </>
            ) : null}
          </>
        )}
      </span>
      {look ? null : (
        <button type="button" className={buttonClass('cta', 'sm')} onClick={onBack}>
          {t('kb.bar.back')}
        </button>
      )}
      <button
        type="button"
        className={iconButtonClass('sm')}
        aria-label={t('kb.bar.close')}
        title={t('kb.bar.close')}
        onClick={onClose}
      >
        <Icon name="x" size="sm" />
      </button>
      {look ? (
        <span
          aria-hidden="true"
          className="order-9 mr-1.5 mb-0.5 h-1 flex-[1_0_100%] overflow-hidden rounded-sm bg-btn"
        >
          <i
            data-ck-timer=""
            className="block h-full origin-left bg-accent"
            style={{ animation: `bu-ck-timer ${left}ms linear forwards` }}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * «Готово: шаг выполнен» (прототип ckDoneDlg): уровень и процент, следующий шаг; «Остаться здесь»,
 * «Следующий шаг: …» и «Вернуться к Базе знаний».
 */
function StepDoneDialog({
  dialog,
  open,
  state,
  onStay,
  onNext,
  onBack,
}: {
  dialog: DoneDialog;
  open: boolean;
  state: KbState | undefined;
  onStay: () => void;
  onNext: (id: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const next = nextStepAfter(state, dialog.id);
  const p = state?.progress;
  return (
    <Modal
      open={open}
      onClose={onStay}
      kind="message"
      size="mid"
      title={t(dialog.look ? 'kb.done.look_title' : 'kb.done.title', { title: dialog.title })}
      sub={p ? t('kb.done.sub', { name: p.levels[p.level]?.name ?? '', pct: p.pct }) : undefined}
      footer={<DoneFooter next={next} stay={!dialog.look} onNext={onNext} onBack={onBack} />}
    >
      <p data-kb-done={dialog.id} className="m-0 leading-[1.55] text-muted">
        {next ? t('kb.done.next', { title: next.title }) : t('kb.done.all')}{' '}
        {t(dialog.look ? 'kb.done.look_text' : 'kb.done.text')}
      </p>
    </Modal>
  );
}

const short = (s: string) => (s.length > 34 ? `${s.slice(0, 32)}…` : s);

function DoneFooter({
  next,
  stay,
  onNext,
  onBack,
}: {
  next: KbStep | null;
  /** «Остаться здесь»; у «Посмотреть» по ТЗ только «Следующий шаг» и «Вернуться к Базе знаний». */
  stay: boolean;
  onNext: (id: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const { close, leave } = useWindow();
  // ОТКЛОНЕНИЕ: docs/deviations.md#Г-2 — у «Посмотреть» нет «Остаться здесь» (как в ТЗ).
  return (
    <>
      {stay ? (
        <button type="button" className={buttonClass('ghost')} onClick={close}>
          {t('kb.done.stay')}
        </button>
      ) : null}
      {next ? (
        <button
          type="button"
          className={buttonClass()}
          title={next.title}
          onClick={() => {
            leave();
            onNext(next.id);
          }}
        >
          {t('kb.done.next_btn', { title: short(next.title) })}
        </button>
      ) : null}
      <button
        type="button"
        className={buttonClass('cta')}
        onClick={() => {
          leave();
          onBack();
        }}
      >
        {t('kb.done.back')}
      </button>
    </>
  );
}

/** «Новый уровень: …» справа внизу, на телефоне — сверху (прототип kbCongrats). */
function Congrats({ name }: { name: string }) {
  const t = useT();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const show = requestAnimationFrame(() => setOn(true));
    const hide = setTimeout(() => setOn(false), CONGRATS_MS);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
    };
  }, []);
  return (
    <div
      role="status"
      data-kb-congrats=""
      className={`pointer-events-none fixed right-[22px] bottom-[calc(22px+env(safe-area-inset-bottom,0px))] z-[95] flex items-center gap-3 rounded-2xl border border-line bg-raised px-4 py-3 text-[13.5px] shadow-pop transition-[opacity,transform] duration-250 max-md:top-[calc(12px+env(safe-area-inset-top,0px))] max-md:right-3 max-md:bottom-auto max-md:left-3 ${on ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0 max-md:-translate-y-3'}`}
    >
      <Icon name="grad" className="h-[26px] w-[26px] text-violet" />
      <span>
        <b>{t('kb.congrats', { name })}</b>
        <br />
        <span className="text-muted">{t('kb.title')}</span>
      </span>
    </div>
  );
}
