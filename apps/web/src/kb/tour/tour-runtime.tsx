'use client';

import {
  KB_KNOWN_BATCH,
  kbKnownKey,
  kbScreenShowItems,
  kbShowOf,
  kbSmartList,
  kbStepShowItems,
  type KbShowEntry,
  type KbStepPlace,
} from '@buhuchet/domain';
import type { KbKnownList, KbMarkResult, KbShowContent, KbStep } from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  Modal,
  PHONE_QUERY,
  TourOverlay,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../../dialog-slot';
import { useT } from '../../l10n/provider';
import {
  kbAddKnown,
  KB_KNOWN_KEY,
  kbKnownQuery,
  kbResetKnown,
  kbScreenShown,
  kbShowsQuery,
  kbStepShown,
} from '../kb-data';
import { KB_GO } from '../kb-go';
import { TourDom, tourLocate, topWindow, type TourEnv, type TourPoint } from './tour-dom';

/*
 * «Показать как» и «Обзор экрана» (задача 2.31; ТЗ «База знаний» → «Уроки» → «Показать как»,
 * «Знакомые элементы»; прототип ui/tour.js — tourStep, tourScreen, tourAsk, tourRun, tourGo,
 * tourDoit, tourShow, tourEnd; docs/decisions.md п. Г-5): показ по шагам поверх живого экрана,
 * пропуск знакомых элементов, «Продолжить с N из M», «Сделать сейчас» и засчитывание шага
 * «Посмотреть» показом до конца. Что показывать, решает сценарий (refDB `kbShows`) или вид шага;
 * что подсвечивать — `tour-dom.ts` и `kb-show-targets.ts`.
 */

/** Последние облачки показа: «Готово», «Сделать сейчас», «Понятно, заполню». */
const FINAL = new Set(['done', 'end', 'save', 'doit']);

/** Запуск показа: шаг или обзор экрана. */
interface Run {
  kind: 'step' | 'scr';
  sid: string | null;
  /** Ключ «где остановились» в браузере. */
  key: string;
  scr: string | null;
  items: (c: KbShowContent) => KbShowEntry[];
  /** «Показать всё»: показ целиком, без пропуска знакомых. */
  all: boolean;
  /** Шаг «Посмотреть»: засчитывается показом до конца. */
  learn: boolean;
}

interface Tour {
  run: Run;
  dom: TourDom;
  content: KbShowContent;
  list: TourPoint[];
  i: number;
  skip: { at: number; n: number } | null;
  /** Открыта форма «Сделать сейчас»: она остаётся открытой после показа. */
  form: boolean;
  busy: boolean;
}

interface View {
  preparing: boolean;
  target: HTMLElement | null;
  point: TourPoint | null;
  i: number;
  n: number;
  skip: { at: number; n: number } | null;
  busy: boolean;
}

/** Где остановились: облачко, сколько их было, показ целиком. */
interface Saved {
  i: number;
  n: number;
  all: boolean;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function readSaved(key: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    return v && typeof v.i === 'number' && typeof v.n === 'number'
      ? { i: v.i, n: v.n, all: !!v.all }
      : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, v: Saved | null) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    // Хранилище браузера недоступно: показ просто начнётся сначала.
  }
}

/** Облачко на экране: элемент, «N из M», «Пропущено знакомых». */
function viewOf(tour: Tour): View {
  const p = tour.list[tour.i] ?? null;
  return {
    preparing: false,
    target: p?.loc ? tourLocate(p.loc, window.matchMedia(PHONE_QUERY).matches) : null,
    point: p,
    i: tour.i,
    n: tour.list.length,
    skip: tour.skip,
    busy: tour.busy,
  };
}

/** Что показ берёт у «Базы знаний» и оболочки. */
export interface TourOptions {
  userId: string;
  screen: string | null;
  module: TourEnv['module'];
  tabHrefOf: (module: string, tab?: string) => string | null;
  navigate: (screen: string) => void;
  steps: () => readonly KbStep[];
  /** «Перейти» шага. */
  go: (stepId: string) => void;
  /** Урок шага: полоса внизу (`bar`) после «Сделать сейчас», без неё — на время показа. */
  onLesson: (stepId: string, bar: boolean) => void;
  /** Шаг «Посмотреть» засчитан показом: окно «Шаг выполнен». */
  onStepShown: (result: KbMarkResult, stepId: string) => void;
  /** Обзор экрана засчитал шаги: программа после отметки. */
  onScreenShown: (result: KbMarkResult) => void;
}

export interface TourControls {
  /** «Показать как» шага. */
  show: (stepId: string) => void;
  /** «Показать экран»: `screen` — «модуль.вкладка», без него — открытый экран. */
  showScreen: (screen?: string | null) => void;
  /** «Показывать всё заново». */
  resetKnown: () => void;
}

/** Экран шага: из сценария, из «Перейти», первый экран шага или его модуль (прототип tScrOfStep). */
function stepScreen(step: KbStep, show: { scr?: string | undefined } | null): string | null {
  if (show?.scr) return show.scr;
  const target = KB_GO[step.id];
  if (target?.module) return target.tab ? `${target.module}.${target.tab}` : target.module;
  return step.screens[0] ?? step.module ?? null;
}

/** Место шага без сценария: «+ Добавить» модуля, своё место из «Перейти» или экран целиком. */
function stepPlace(id: string): KbStepPlace {
  const target = KB_GO[id];
  if (!target) return null;
  if (target.open && typeof target.open === 'object') return 'add';
  return target.flash !== 'main' ? 'place' : null;
}

export function useTour(o: TourOptions): { controls: TourControls; overlay: ReactNode } {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });
  const cur = useRef<Tour | null>(null);
  const known = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const [view, setView] = useState<View | null>(null);
  const [ask, setAsk] = useState<DialogSlot<{ run: Run; saved: Saved }> | null>(null);
  const [reset, setReset] = useState<DialogSlot<{ n: number }> | null>(null);

  // Ушли со страницы — показ закончен.
  useEffect(
    () => () => {
      if (cur.current) cur.current.dom.scene.on = false;
    },
    [],
  );

  const flush = useCallback(() => {
    const keys = [...pending.current];
    pending.current.clear();
    for (let k = 0; k < keys.length; k += KB_KNOWN_BATCH) {
      kbAddKnown(keys.slice(k, k + KB_KNOWN_BATCH))
        .then(() => client.invalidateQueries({ queryKey: KB_KNOWN_KEY }))
        .catch(() => {});
    }
  }, [client]);

  /** Экран показа для ключа знакомого элемента. */
  const screenKey = useCallback((tour: Tour) => tour.run.scr ?? opts.current.screen ?? '', []);

  /** Облачко, с которого ушли «Далее» или «Готово», становится знакомым. */
  const know = useCallback(
    (tour: Tour, p: TourPoint | undefined) => {
      const key = p && kbKnownKey(p, screenKey(tour));
      if (!key || known.current.has(key)) return;
      known.current.add(key);
      pending.current.add(key);
      if (pending.current.size >= KB_KNOWN_BATCH) flush();
    },
    [flush, screenKey],
  );

  const paint = useCallback((tour: Tour) => {
    if (cur.current === tour) setView(viewOf(tour));
  }, []);

  const end = useCallback(
    (tour: Tour, full: boolean, quiet = false) => {
      if (cur.current !== tour || !tour.dom.scene.on) return;
      const { run, dom } = tour;
      const p = tour.list[tour.i];
      const done = full && !!p && FINAL.has(p.kind ?? '');
      dom.scene.on = false;
      cur.current = null;
      setView(null);
      // Форма, открытая «Сделать сейчас», остаётся открытой — её заполняют; всё, что открыл сам
      // показ, закрывается.
      void dom.closePopovers().then(() => dom.closeWindows(tour.form ? dom.scene.mbase : 0));
      if (done || full) writeSaved(run.key, null);
      else if (tour.i > 0) writeSaved(run.key, { i: tour.i, n: tour.list.length, all: run.all });
      flush();
      if (done && run.kind === 'step' && run.learn && run.sid) {
        const sid = run.sid;
        kbStepShown(sid)
          .then((r) => opts.current.onStepShown(r, sid))
          .catch(() => {});
      }
      if (done && run.kind === 'scr' && run.scr) {
        kbScreenShown(run.scr)
          .then((r) => opts.current.onScreenShown(r))
          .catch(() => {});
      }
      if (!done && !quiet && run.kind === 'step' && run.learn) {
        toast(t('kb.show.early'), { icon: 'info' });
      }
    },
    [flush, t, toast],
  );

  const show = useCallback(
    async (tour: Tour) => {
      const p = tour.list[tour.i];
      if (!p) return;
      tour.busy = true;
      setView((v) => v && { ...v, busy: true });
      const { dom } = tour;
      if (p.ctx === 'form') {
        dom.scene.ctx = 'form';
        await dom.closePopovers();
      } else {
        await dom.prep(p);
      }
      if (cur.current !== tour) return;
      if (tour.i) writeSaved(tour.run.key, { i: tour.i, n: tour.list.length, all: tour.run.all });
      const el = p.loc ? tourLocate(p.loc, window.matchMedia(PHONE_QUERY).matches) : null;
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await wait(30);
      }
      tour.busy = false;
      paint(tour);
    },
    [paint],
  );

  /** «Сделать сейчас»: открыть форму шага и продолжить показ по её полям (прототип tourDoit). */
  const doit = useCallback(
    async (tour: Tour) => {
      const { run, dom, content } = tour;
      if (!run.sid) return;
      tour.busy = true;
      paint(tour);
      const sh = kbShowOf(content.shows, run.sid);
      await dom.base(sh?.scr ?? run.scr);
      const before = dom.windows();
      const acts = sh?.doit ?? ['stepgo'];
      for (const a of acts) await dom.act(a);
      for (let k = 0; k < 40 && dom.windows() <= before; k++) await wait(60);
      if (cur.current !== tour) return;
      if (dom.windows() > before) {
        dom.scene.mbase = dom.windows();
        tour.form = true;
        opts.current.onLesson(run.sid, true);
        await dom.settle(120);
        const card = topWindow()?.dataset.windowKind === 'card';
        const parts = dom.windowParts({ form: true });
        const fin = parts.find((x) => x.kind === 'save');
        let rest = parts.filter((x) => x.kind !== 'save');
        if (!run.all) {
          const fresh = rest.filter((x) => {
            const key = kbKnownKey(x, screenKey(tour));
            return !key || !known.current.has(key);
          });
          if (fresh.length < rest.length) {
            tour.skip = { at: tour.i + 1, n: rest.length - fresh.length };
            rest = fresh;
          }
        }
        const ui = content.ui.ui ?? {};
        const last: TourPoint = fin ?? {
          t: ui[card ? 'finCardT' : 'finFormT'] ?? '',
          x: ui[card ? 'finCard' : 'finForm'] ?? '',
          kind: 'save',
        };
        // Облачка формы — внутри уже открытого окна, без возврата к экрану.
        const scr = opts.current.screen ?? undefined;
        tour.list.splice(
          tour.i + 1,
          tour.list.length,
          ...[...rest, last].map((x) => ({ ...x, ctx: 'form', pre: [], scr })),
        );
        tour.i++;
        dom.scene.ctx = 'form';
        await show(tour);
        return;
      }
      tour.busy = false;
      end(tour, true, true);
      if (!acts.includes('stepgo')) opts.current.go(run.sid);
    },
    [end, show, paint, screenKey],
  );

  const step = useCallback(
    async (d: 1 | -1) => {
      const tour = cur.current;
      if (!tour || tour.busy) return;
      const p = tour.list[tour.i];
      if (d > 0) know(tour, p);
      if (d > 0 && p?.kind === 'doit') return doit(tour);
      if (d > 0 && p && FINAL.has(p.kind ?? '')) return end(tour, true);
      const j = tour.i + d;
      if (j < 0) return;
      if (j >= tour.list.length) return end(tour, true);
      tour.i = j;
      await show(tour);
    },
    [know, doit, end, show],
  );

  const run = useCallback(
    async (r: Run, from: number) => {
      if (cur.current) cur.current.dom.scene.on = false;
      const content = await client.fetchQuery(kbShowsQuery).catch(() => null);
      const list = await client.fetchQuery({ ...kbKnownQuery, staleTime: 0 }).catch(() => null);
      if (!content) return;
      if (list) known.current = new Set([...list.keys, ...pending.current]);
      const phone = () => window.matchMedia(PHONE_QUERY).matches;
      const env: TourEnv = {
        ui: content.ui,
        t,
        phone,
        screen: () => opts.current.screen,
        module: () => opts.current.module(),
        navigate: (scr) => opts.current.navigate(scr),
        stepGo: (id) => opts.current.go(id),
        goTarget: (id) => {
          const g = KB_GO[id];
          return g ? { sel: g.flash, ...(g.phoneFlash ? { phone: g.phoneFlash } : {}) } : null;
        },
      };
      const dom = new TourDom(env, { sid: r.sid, scr: r.scr });
      const tour: Tour = {
        run: r,
        dom,
        content,
        list: [],
        i: 0,
        skip: null,
        form: false,
        busy: true,
      };
      cur.current = tour;
      setView({ preparing: true, target: null, point: null, i: 0, n: 0, skip: null, busy: true });
      await dom.closePopovers();
      await dom.closeWindows(0);
      // Список мог ещё загружаться: облачки собираются по готовому экрану.
      if (r.scr) await dom.base(r.scr);
      await dom.settle(120);
      const scr = r.scr ?? opts.current.screen;
      tour.list = await dom.expand(r.items(content), scr);
      if (cur.current !== tour || !dom.scene.on) return;
      tour.busy = false;
      if (!tour.list.length) return end(tour, true);
      const ui = content.ui.ui ?? {};
      const smart = kbSmartList(
        tour.list,
        (k) => known.current.has(k),
        scr ?? '',
        { allKnownT: ui.allKnownT ?? '', allKnown: ui.allKnown ?? '' },
        r.all,
      );
      tour.list = smart.list;
      tour.skip = smart.skipped ? { at: 0, n: smart.skipped } : null;
      tour.i = Math.min(Math.max(0, from), tour.list.length - 1);
      await show(tour);
    },
    [client, t, end, show],
  );

  /** Прошлый показ закончили раньше — «Продолжить с N из M» или «Сначала» (прототип tourAsk). */
  const start = useCallback(
    (r: Run) => {
      const saved = readSaved(r.key);
      if (!saved?.i || !saved.n) return void run(r, 0);
      setAsk(openSlot({ run: r, saved }));
    },
    [run],
  );

  const showStep = useCallback(
    (id: string) => {
      const s = opts.current.steps().find((x) => x.id === id);
      if (!s) return;
      opts.current.onLesson(id, false);
      void client
        .fetchQuery(kbShowsQuery)
        .then((content) => {
          const sh = kbShowOf(content.shows, id);
          start({
            kind: 'step',
            sid: id,
            key: `bu.kb.show.${opts.current.userId}.step.${id}`,
            scr: stepScreen(s, sh),
            items: (c) =>
              kbStepShowItems(
                { t: s.title, w: s.why, learn: s.learn, at: s.screens },
                kbShowOf(c.shows, id),
                stepPlace(id),
                c.ui.ui ?? {},
              ),
            all: false,
            learn: s.learn,
          });
        })
        .catch(() => {});
    },
    [client, start],
  );

  const showScreen = useCallback(
    (screen?: string | null) => {
      void (async () => {
        if (screen) {
          const [module, tab] = screen.split('.') as [string, string?];
          if (!opts.current.tabHrefOf(module, tab)) {
            toast(t('kb.show.unavailable'), { icon: 'lock' });
            return;
          }
          opts.current.navigate(screen);
          const at = (s: string | null) =>
            !!s && (s === screen || (!screen.includes('.') && s.split('.')[0] === screen));
          for (let k = 0; k < 60 && !at(opts.current.screen); k++) await wait(50);
          await wait(260);
        }
        const k = opts.current.screen;
        const m = opts.current.module();
        if (!k || !m) return;
        const tabId = k.split('.')[1];
        const tab = tabId ? m.tabs.find((x) => x.id === tabId)?.label : undefined;
        const name = tab ? `${m.title} · ${tab}` : m.title;
        start({
          kind: 'scr',
          sid: null,
          key: `bu.kb.show.${opts.current.userId}.scr.${k}`,
          scr: k,
          items: (c) => kbScreenShowItems(t('kb.show.screen_title', { name }), c.ui.ui ?? {}),
          all: false,
          learn: false,
        });
      })();
    },
    [start, t, toast],
  );

  const resetKnown = useCallback(() => {
    void client
      .fetchQuery(kbKnownQuery)
      .then((v) => setReset(openSlot({ n: v.keys.length })))
      .catch(() => setReset(openSlot({ n: 0 })));
  }, [client]);

  const controls = useMemo(
    () => ({ show: showStep, showScreen, resetKnown }),
    [showStep, showScreen, resetKnown],
  );

  const p = view?.point ?? null;
  const n = view?.n ?? 0;
  const k = view?.i ?? 0;
  const lastOne = k === n - 1;
  const next: { label: string; icon?: IconName } =
    p?.kind === 'doit'
      ? { label: t('kb.show.doit'), icon: 'play' }
      : p?.kind === 'save'
        ? { label: t('kb.show.fill') }
        : p?.kind === 'done' || p?.kind === 'end' || lastOne
          ? { label: t('kb.show.done') }
          : { label: t('kb.show.next') };
  const sk = view?.skip && view.skip.at === k ? view.skip : null;

  const overlay = (
    <>
      <TourOverlay
        open={!!view}
        target={view?.target ?? null}
        step={
          view && !view.preparing
            ? { label: t('kb.show.count', { n: k + 1, of: n }), part: (k + 1) / Math.max(1, n) }
            : null
        }
        title={view?.preparing ? t('kb.show.preparing') : (p?.t ?? '')}
        text={view?.preparing ? t('kb.show.preparing_text') : (p?.x ?? '')}
        skipped={
          sk
            ? {
                text: t('kb.show.skipped', { n: sk.n }),
                showAll: t('kb.show.show_all'),
                solo: n === 1,
              }
            : null
        }
        next={next}
        canBack={k > 0}
        busy={!!view?.busy}
        labels={{
          end: t('kb.show.end'),
          endHint: t('kb.show.end_hint'),
          back: t('kb.show.back'),
          keys: t('kb.show.keys'),
        }}
        onNext={() => void step(1)}
        onBack={() => void step(-1)}
        onEnd={() => {
          const now = cur.current;
          if (now) end(now, false);
          else setView(null);
        }}
        onShowAll={() => {
          const now = cur.current;
          if (!now) return;
          writeSaved(now.run.key, null);
          void run({ ...now.run, all: true }, 0);
        }}
      />
      {ask ? (
        <Modal
          key={`kb-tour-ask-${ask.n}`}
          open={ask.open}
          onClose={() => setAsk(closeSlot)}
          kind="message"
          size="mid"
          title={t('kb.show.resume_title')}
          footer={
            <>
              <button
                type="button"
                className={buttonClass('ghost')}
                onClick={() => {
                  setAsk(closeSlot);
                  writeSaved(ask.data.run.key, null);
                  void run({ ...ask.data.run, all: true }, 0);
                }}
              >
                {t('kb.show.resume_restart')}
              </button>
              <button
                type="button"
                className={buttonClass('cta')}
                onClick={() => {
                  setAsk(closeSlot);
                  const { saved } = ask.data;
                  void run({ ...ask.data.run, all: saved.all }, saved.all ? saved.i : 0);
                }}
              >
                {t('kb.show.resume_go', { i: ask.data.saved.i + 1, n: ask.data.saved.n })}
              </button>
            </>
          }
        >
          <p className="m-0 leading-[1.55] text-muted">
            {t('kb.show.resume_text', { i: ask.data.saved.i + 1, n: ask.data.saved.n })}
          </p>
        </Modal>
      ) : null}
      {reset ? (
        <ConfirmDialog
          key={`kb-known-reset-${reset.n}`}
          open={reset.open}
          onClose={() => setReset(closeSlot)}
          title={t('kb.known.confirm_title')}
          text={
            reset.data.n
              ? t('kb.known.confirm_text_n', { n: reset.data.n })
              : t('kb.known.confirm_text')
          }
          ok={t('kb.known.reset')}
          onConfirm={() => {
            setReset(closeSlot);
            kbResetKnown()
              .then(() => {
                known.current.clear();
                pending.current.clear();
                client.setQueryData<KbKnownList>(KB_KNOWN_KEY, (v) => v && { ...v, keys: [] });
                toast(t('kb.known.done'), { icon: 'grad' });
              })
              .catch(() => {});
          }}
        />
      ) : null}
    </>
  );
  return { controls, overlay };
}
