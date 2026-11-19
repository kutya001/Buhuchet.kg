'use client';

import {
  cpAnswerLines,
  cpFaqActHint,
  cpFaqActOn,
  cpFaqList,
  CP_FAQ_GO,
  cpGlossSorted,
  cpHelpCap,
  cpLegendRows,
  cpTourSteps,
  whatsAppLink,
  type CpFaq,
  type CpFaqAct,
  type CpHelpView,
  type CpTourStep,
  type PayClaimPurpose,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import {
  buttonClass,
  Icon,
  iconButtonClass,
  Modal,
  PHONE_QUERY,
  StatusPill,
  TourOverlay,
  useMediaQuery,
  type IconName,
} from '@buhuchet/ui';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useT } from '../l10n/provider';
import { statusName } from '../status/status-view';
import { usePageForgot } from './page-forgot';
import { GlossPop, usePageGlossary } from './page-gloss';
import { usePageHelpTexts, usePageHint } from './page-help-context';
import {
  legendLook,
  tourScrollTop,
  tourTargetSelector,
  tourUnfolds,
  welcomeCookie,
  welcomeSeen,
} from './page-help-model';
import type { PageAddress } from './page-telegram';

/*
 * Подсказки и обучение на открытой странице контрагента (доработки 15.11.2026 и 17.11.2026 «простыми
 * словами»; прототип v135 modules/cp-help.js, css/cp-help.css): клиенты — не бухгалтеры, поэтому
 * приглашение одной строкой после первого верного кода, обзор страницы по живому экрану, «?» и панель
 * «Помощь» с частыми вопросами и «Словарик» — термины с пунктиром и объяснением по нажатию. Обзор и
 * панель ничего не меняют в данных — обзор пишет только строку в историю контрагента.
 */

/** Что страница даёт «Помощи»: перейти в раздел и окна действий (нет действия — null). */
export interface PageHelpActions {
  go: (sec: string) => void;
  paid: ((purpose: PayClaimPurpose, pick: boolean) => void) | null;
  up: (() => void) | null;
  tg: (() => void) | null;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Значок кнопки ответа (прототип `cphHelp`: `right`, `check`, `upload`, `tg`, `send`). */
const ACT_ICON: Partial<Record<CpFaqAct, IconName>> = {
  paid: 'check',
  up: 'upload',
  tg: 'tg',
  code: 'send',
};

/** Метки «Что значат цвета у отчётов?»: в облачке «Отчёты» — только метки, в «Помощи» — с объяснением. */
function Legend({ answer, short }: { answer: string; short: boolean }) {
  const t = useT();
  const names = {
    status: (code: string) => statusName(t, 'report', code),
    ahead: [t('pub.rep.next')],
    late: [t('cph.legend.late'), t('cph.legend.late_n')],
  };
  // В облачке обзора — три главные метки: «Сдан», «В работе», «Просрочен» (прототип v135).
  const main = [names.status('submitted'), names.status('in_progress'), t('cph.legend.late')];
  const rows = cpLegendRows(answer);
  const pill = (label: string) => (
    <StatusPill label={label} size="sm" {...legendLook(label, names)} />
  );
  if (short) {
    return (
      <div data-pub-legend="" className="-mt-0.5 mb-1.5 flex flex-wrap gap-1.5">
        {rows
          .filter((r) => main.includes(r.label))
          .map((r) => (
            <span key={r.label}>{pill(r.label)}</span>
          ))}
      </div>
    );
  }
  return (
    <ul data-pub-legend="" className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="flex items-start gap-2">
          {r.label ? <span className="flex-none">{pill(r.label)}</span> : null}
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Вопрос «Помощи» — раскрывается по нажатию (прототип `.pgh-q`). */
function Question({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div data-pub-faq={id} className="overflow-hidden rounded-xl border border-line bg-raised">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3.5 py-[11px] text-left font-[inherit] font-semibold text-inherit hover:bg-row-hover"
      >
        <span className="flex-1">{title}</span>
        <Icon
          name="down"
          size="sm"
          className={`flex-none text-faint transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 text-[14px] leading-[1.55] max-md:text-[16px]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Панель «Помощь» (прототип `cphHelp`): на ПК справа во всю высоту, на телефоне на весь экран. «Показать,
 * как пользоваться страницей», частые вопросы о том, что видно на странице (кнопка ответа или «Спросите
 * вашего бухгалтера»), «Не нашли ответ?» с телефоном и «Словарик».
 */
function HelpPanel({
  page,
  address,
  view,
  actions,
  open,
  onClose,
  onTour,
}: {
  page: PublicPageBody;
  address: PageAddress;
  view: CpHelpView;
  actions: PageHelpActions;
  open: boolean;
  onClose: () => void;
  onTour: () => void;
}) {
  const t = useT();
  const hint = usePageHint();
  const help = usePageHelpTexts();
  const forgot = usePageForgot(address.slug, address.inn);
  // Раскрытые вопросы остаются раскрытыми до перезагрузки страницы (прототип `PUB.hq`).
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const qs = cpFaqList(help, view);
  const gloss = cpGlossSorted(help.gloss);
  // Телефон — только тот, что страница уже показывает: бухгалтера, иначе организации.
  // ОТКЛОНЕНИЕ: docs/deviations.md#К-16
  const acc = page.accountant;
  const phone = acc?.phone ?? page.org.phone;
  const who = acc?.phone ? acc.name : page.org.name;
  const toggle = (id: string) =>
    setShown((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const later = (run: () => void) => {
    onClose();
    setTimeout(run, 60);
  };
  const act = (a: CpFaqAct) => {
    if (a in CP_FAQ_GO) return later(() => actions.go(CP_FAQ_GO[a as keyof typeof CP_FAQ_GO]));
    if (a === 'goReports') return later(() => actions.go('reports'));
    if (a === 'paid' && actions.paid) {
      // Есть оба счёта — сверху выбор «Налоги» или «Услуги бухгалтера» (пункт 3.4).
      const paid = actions.paid;
      const pick = view.payTax && view.payFee;
      return later(() => paid(view.payTax ? 'tax' : 'fee', pick));
    }
    if (a === 'up' && actions.up) return later(actions.up);
    if (a === 'tg' && actions.tg) {
      // Вкладка бота открывается тем же нажатием — иначе браузер телефона её не пустит.
      actions.tg();
      onClose();
      return;
    }
    // «Прислать код в Telegram»: ответ — строкой под кнопкой, панель остаётся открытой.
    if (a === 'code') void forgot.ask();
  };
  const answer = (q: CpFaq) => {
    const lines = cpAnswerLines(q.a);
    const body =
      q.act === 'colors' ? (
        <Legend answer={q.a} short={false} />
      ) : lines.length > 1 ? (
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-[22px]">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      ) : lines.length ? (
        <p className="m-0">{lines[0]}</p>
      ) : null;
    const a = q.act;
    const button =
      !a || a === 'colors' ? null : cpFaqActOn(a, view) ? (
        <button
          type="button"
          data-pub-faq-act={a}
          disabled={a === 'code' && forgot.busy}
          className={`${buttonClass('cta', 'sm')} max-md:min-h-11`}
          onClick={() => act(a)}
        >
          <Icon name={ACT_ICON[a] ?? 'right'} size="sm" />
          {hint(cpFaqActHint(a))}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 font-semibold text-muted">
          <Icon name="user" size="sm" />
          {hint('askAcc', t('cph.help.ask_acc'))}
        </span>
      );
    return (
      <>
        {body}
        {button ? <div className="flex flex-wrap gap-2">{button}</div> : null}
        {a === 'code' && forgot.answer ? (
          <span
            role="status"
            data-pub-faq-code={forgot.answer.ok ? 'sent' : ''}
            className={`text-[12.5px] leading-[1.4] ${forgot.answer.ok ? 'text-ok' : 'text-faint'}`}
          >
            {forgot.answer.text}
          </span>
        ) : null}
      </>
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hint('helpTitle', t('cph.help'))}
      size="side"
      noMax
      touch
    >
      <div data-pub-help-panel="" className="flex flex-col gap-3.5">
        <div
          data-pub-help-ask=""
          className="flex flex-col gap-1.5 rounded-xl bg-pane-alt px-3.5 py-3"
        >
          <b>{hint('notFound', t('cph.help.not_found'))}</b>
          {phone ? (
            <>
              <span className="text-[12.5px] text-muted">
                {who} · <span className="font-mono">{phone.text}</span>
              </span>
              <div className="flex flex-wrap gap-2">
                <a
                  className={`${buttonClass('default', 'sm')} max-md:min-h-11`}
                  href={`tel:+${phone.digits}`}
                >
                  <Icon name="phone" size="sm" />
                  {t('cph.help.call')}
                </a>
                <a
                  className={`${buttonClass('default', 'sm')} max-md:min-h-11`}
                  href={whatsAppLink(phone.digits, '')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="chat" size="sm" />
                  {t('cph.help.whatsapp')}
                </a>
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          data-pub-help-tour=""
          className={`${buttonClass('default')} self-start max-md:min-h-11 max-md:self-stretch max-md:justify-center`}
          onClick={onTour}
        >
          <Icon name="play" size="sm" />
          {hint('helpTour', t('cph.help.tour'))}
        </button>
        {qs.length ? (
          <>
            <h3 className="m-0 mt-1 -mb-1 text-[14px]">{hint('faqHead', t('cph.help.faq'))}</h3>
            <div className="flex flex-col gap-2">
              {qs.map((q) => (
                <Question
                  key={q.id}
                  id={q.id}
                  title={q.q}
                  open={shown.has(q.id)}
                  onToggle={() => toggle(q.id)}
                >
                  {answer(q)}
                </Question>
              ))}
            </div>
          </>
        ) : null}
        {gloss.length ? (
          <Question
            id="__gloss"
            title={hint('glossHead', t('cph.help.gloss'))}
            open={shown.has('__gloss')}
            onToggle={() => toggle('__gloss')}
          >
            <dl data-pub-help-gloss="" className="m-0 flex flex-col gap-2.5">
              {gloss.map((g) => (
                <div key={g.w}>
                  <dt className="font-[650]">{cpHelpCap(g.w)}</dt>
                  <dd className="m-0 mt-0.5 text-muted">{g.x}</dd>
                </div>
              ))}
            </dl>
          </Question>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Приглашение (прототип v135 `cphWelcomeBar`): одна строка и две кнопки полосой внизу экрана — страница
 * видна сразу. Показывается, пока клиент не нажал одну из кнопок; «Показать» запускает обзор.
 */
function WelcomeBar({ onSkip, onGo }: { onSkip: () => void; onGo: () => void }) {
  const t = useT();
  const w = usePageHelpTexts().welcome;
  return (
    <div
      role="region"
      aria-label={t('cph.welcome.label')}
      data-pub-welcome=""
      className="fixed bottom-4 left-1/2 z-[46] flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 animate-fade items-center gap-3 rounded-2xl border border-line bg-raised px-3.5 py-3 shadow-pop motion-reduce:animate-none max-md:bottom-[calc(66px+env(safe-area-inset-bottom,0px))] max-md:flex-wrap"
    >
      <span className="flex-1 text-[14px] leading-[1.45] max-md:flex-[1_1_100%] max-md:text-[15px]">
        {w.lead || t('cph.welcome.lead')}
      </span>
      <div className="flex flex-none gap-2 max-md:flex-1">
        <button
          type="button"
          data-pub-welcome-skip=""
          className={`${buttonClass('ghost')} max-md:min-h-11 max-md:flex-1 max-md:justify-center`}
          onClick={onSkip}
        >
          {w.skip || t('cph.welcome.skip')}
        </button>
        <button
          type="button"
          data-pub-welcome-go=""
          className={`${buttonClass('default')} max-md:min-h-11 max-md:flex-1 max-md:justify-center`}
          onClick={onGo}
        >
          <Icon name="play" size="sm" />
          {w.go || t('cph.welcome.go')}
        </button>
      </div>
    </div>
  );
}

interface TourState {
  list: CpTourStep[];
  i: number;
}

/**
 * Обзор страницы по живому экрану (прототип `cphTour`): тот же вид, что «Показать как» у сотрудников,
 * но свой порядок — облачка справочника для того, что видно на странице. На телефоне свёрнутый раздел
 * на своём шаге раскрывается, после обзора всё сворачивается как было и прокрутка возвращается на место.
 * Конец — строка в истории контрагента: «посмотрел обзор» или «закрыл на шаге N из M».
 */
function usePageTour({
  address,
  view,
  unfolded,
  setUnfolded,
  helpButton,
}: {
  address: PageAddress;
  view: CpHelpView;
  unfolded: ReadonlySet<string>;
  setUnfolded: (s: ReadonlySet<string>) => void;
  helpButton: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const help = usePageHelpTexts();
  const phone = useMediaQuery(PHONE_QUERY);
  const [tour, setTour] = useState<TourState | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef<{ unfolded: ReadonlySet<string>; y: number } | null>(null);

  /** Облачко `i`: на телефоне свёрнутый раздел этого шага раскрывается. */
  const moveTo = (list: CpTourStep[], i: number) => {
    const sec = list[i]?.sec;
    if (!sec) return;
    setBusy(true);
    if (phone && tourUnfolds(sec)) setUnfolded(new Set([...unfolded, sec]));
    setTour({ list, i });
  };

  const start = () => {
    if (tour) return;
    const list = cpTourSteps(help, view);
    if (!list.length) return;
    saved.current = { unfolded, y: window.scrollY };
    setTarget(null);
    moveTo(list, 0);
  };

  const step = tour ? tour.list[tour.i] : undefined;
  useEffect(() => {
    if (!step) return;
    let frame = requestAnimationFrame(() => {
      // Раскрытый раздел уже нарисован: место элемента — после отрисовки.
      frame = requestAnimationFrame(() => {
        const sel = tourTargetSelector(step.sec, phone);
        const el = sel
          ? ([...document.querySelectorAll<HTMLElement>(sel)].find(
              (n) => n.getClientRects().length > 0,
            ) ?? null)
          : null;
        setTarget(el);
        const behavior = reducedMotion() ? 'auto' : 'smooth';
        if (el) {
          const r = el.getBoundingClientRect();
          window.scrollTo({
            top: tourScrollTop(r, window.scrollY, window.innerHeight, phone),
            behavior,
          });
        } else if (saved.current) {
          window.scrollTo({ top: saved.current.y, behavior });
        }
      });
    });
    const timer = setTimeout(() => setBusy(false), reducedMotion() ? 0 : 320);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // Только смена облачка: вид страницы читается на этот момент.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const end = (full: boolean) => {
    if (!tour) return;
    const n = tour.list.length;
    const k = tour.i;
    setTour(null);
    setTarget(null);
    const back = saved.current;
    saved.current = null;
    if (back) {
      setUnfolded(back.unfolded);
      requestAnimationFrame(() => window.scrollTo({ top: back.y, behavior: 'auto' }));
    }
    // Строка в историю контрагента: только числа (сервер сверяет их с облачками справочника).
    void fetch(`/${address.slug}/inn/${address.inn}/tour`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full, step: full ? n : k + 1, of: n }),
    }).catch(() => undefined);
    helpButton.current?.focus({ preventScroll: true });
  };

  const overlay =
    tour && step ? (
      <TourOverlay
        open
        target={target}
        step={{
          label: t('cph.tour.of', { n: tour.i + 1, m: tour.list.length }),
          part: (tour.i + 1) / tour.list.length,
        }}
        title={step.t}
        text={step.x}
        extra={
          step.sec === 'reports'
            ? (() => {
                const q = help.faq.find((x) => x.act === 'colors' && x.on);
                return q ? <Legend answer={q.a} short /> : null;
              })()
            : null
        }
        endLink={tour.i < tour.list.length - 1}
        page
        next={{ label: t(tour.i === tour.list.length - 1 ? 'cph.tour.done' : 'cph.tour.next') }}
        canBack={tour.i > 0}
        busy={busy}
        labels={{
          end: t('cph.tour.end'),
          endAria: t('cph.tour.end_aria'),
          endHint: t('cph.tour.end_hint'),
          back: t('cph.tour.back'),
          keys: t('cph.tour.keys'),
        }}
        onNext={() => (tour.i + 1 >= tour.list.length ? end(true) : moveTo(tour.list, tour.i + 1))}
        onBack={() => (tour.i > 0 ? moveTo(tour.list, tour.i - 1) : undefined)}
        onEnd={() => end(false)}
        onShowAll={() => undefined}
      />
    ) : null;
  return { start, on: !!tour, overlay };
}

/**
 * Подсказки открытой страницы (прототип v135): «?» в шапке (круглой кнопки поверх страницы больше нет —
 * она закрывала суммы у правого края; на телефоне «Помощь» — в нижнем меню), приглашение полосой внизу,
 * панель «Помощь», обзор и «Словарик».
 */
export function usePageHelp({
  page,
  address,
  view,
  actions,
  unfolded,
  setUnfolded,
  root,
}: {
  page: PublicPageBody;
  address: PageAddress;
  view: CpHelpView;
  actions: PageHelpActions;
  unfolded: ReadonlySet<string>;
  setUnfolded: (s: ReadonlySet<string>) => void;
  /** Разметка страницы: в ней «Словарик» подчёркивает слова. */
  root: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const hint = usePageHint();
  const help = usePageHelpTexts();
  const button = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<{ n: number; open: boolean }>({ n: 0, open: false });
  const [welcome, setWelcome] = useState(false);
  const [pop, setPop] = useState<{ i: number; anchor: HTMLElement } | null>(null);
  const tour = usePageTour({ address, view, unfolded, setUnfolded, helpButton: button });

  usePageGlossary(root, help.gloss, (i, anchor) => {
    setPop((p) => (p?.anchor === anchor ? null : { i, anchor }));
  });

  // Приглашение — пока в этом браузере для этой страницы не нажали «Показать» или «Не сейчас».
  useEffect(() => {
    if (welcomeSeen(document.cookie)) return;
    // Полоса появляется после первой отрисовки: страница видна сразу, полоса въезжает снизу.
    const timer = setTimeout(() => setWelcome(true), 150);
    return () => clearTimeout(timer);
  }, []);
  const welcomeDone = () => {
    document.cookie = welcomeCookie(address, window.location.protocol === 'https:');
    setWelcome(false);
  };

  const openPanel = () => {
    if (tour.on) return;
    setPop(null);
    setPanel((p) => ({ n: p.n + 1, open: true }));
  };
  const label = hint('helpBtn', t('cph.help'));
  const headButton = (
    <button
      ref={button}
      type="button"
      data-pub-help=""
      aria-label={label}
      title={label}
      onClick={openPanel}
      className={`${iconButtonClass()} text-accent max-md:h-11 max-md:w-11`}
    >
      <Icon name="help" />
    </button>
  );
  const word = pop ? help.gloss[pop.i] : undefined;
  const layer = (
    <>
      {panel.n ? (
        <HelpPanel
          key={`pub-help-${panel.n}`}
          page={page}
          address={address}
          view={view}
          actions={actions}
          open={panel.open}
          onClose={() => setPanel((p) => ({ ...p, open: false }))}
          onTour={() => {
            setPanel((p) => ({ ...p, open: false }));
            setTimeout(tour.start, 60);
          }}
        />
      ) : null}
      {welcome && !tour.on ? (
        <WelcomeBar
          onSkip={welcomeDone}
          onGo={() => {
            welcomeDone();
            setTimeout(tour.start, 60);
          }}
        />
      ) : null}
      {tour.overlay}
      {pop && word ? (
        <GlossPop word={word} anchor={pop.anchor} onClose={() => setPop(null)} />
      ) : null}
    </>
  );
  return { button: headButton, open: openPanel, layer };
}
