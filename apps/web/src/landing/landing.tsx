'use client';

import { videoTime } from '@buhuchet/domain';
import type { LandingVideo } from '@buhuchet/shared';
import {
  buttonClass,
  Icon,
  iconButtonClass,
  linkButtonClass,
  Modal,
  type IconName,
  type PhoneInputCode,
} from '@buhuchet/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { VideoCover } from '../kb/video/video-parts';
import { useGuestVideo } from '../kb/video/video-window';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { setTheme } from '../shell/browser';
import { parseMaxPrefs } from '../shell/prefs';
import { BrandIntro, skipNextIntro, usePageLoad } from '../shell/brand-intro';
import { UiProviders } from '../shell/ui-providers';
import {
  BalanceIcon,
  delay,
  Emblem,
  HeroBg,
  LandLogo,
  ScrollPath,
  Shield,
  Stamp,
  type EmblemPart,
} from './landing-art';
import type { DemoScreens } from './landing-data';
import { reducedMotion, startLandingFx, type LandingFx } from './landing-fx';
import { LeadForm } from './lead-form';
import { CardScreen, DeskScreen, PhoneScreen } from './mini-screens';
import './landing.css';

/*
 * Лендинг buhuchet.kg для гостей (задача #165; ТЗ «Лендинг — buhuchet.kg для гостей»; прототип v78
 * modules/landing.js, landDraw, landBind, landFx): минималистичная длинная страница — заставка
 * с логотипом при каждом открытии (`BrandIntro`), первый экран, полоса цифр и 9 блоков, у каждого своя анимация с
 * отсылками к гербу бухгалтеров и «Подробнее». Все тексты — словарь, группа «Лендинг» (правятся в
 * «Локализации»); числа полосы цифр и картинки — из справочников и демо-данных на момент сборки.
 * «Посмотреть на демо-организацию» открывает /demo — собранный файл прототипа; «Войти» — страницу входа.
 * Блок «Видео о Buhuchet.kg» и ссылка «Смотреть видео» в первом экране — видео с отметкой «На лендинге»
 * (прототип v79 `vidLand`); блока нет, пока таких видео нет. Запросы страницы к серверу — отправка
 * заявки и запуск видео; обложки — свои, без внешних адресов.
 */

export interface LandingProps {
  screens: DemoScreens;
  numbers: { reportTypes: number; regimes: number };
  codes: readonly PhoneInputCode[];
  /** Видео лендинга по порядку («На лендинге», порядок на лендинге). */
  videos: readonly LandingVideo[];
  /** Сегодня по Бишкеку (YYYY-MM-DD): просрочка на картинках и год в подвале. */
  today: string;
  /** Тестовый стенд: полоса «Тестовый стенд: данные демонстрационные». */
  stand: boolean;
}

/** Адрес демо-версии (ТЗ «Демо-организация»: buhuchet.kg/demo). */
const DEMO_HREF = '/demo';
/** «Войти» открывает страницу входа без заставки (прототип landLogin — сразу экран входа, `skipNextIntro`). */
const LOGIN_HREF = '/login';

/**
 * Строка в начале страницы — до первой отрисовки: без «уменьшить движение» блоки ждут своей анимации
 * (класс `lp-anim`).
 */
const BOOT = `(function(){var l=document.currentScript&&document.currentScript.parentNode;if(l&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&'IntersectionObserver' in window)l.classList.add('lp-anim')})()`;

/**
 * Кнопка темы в шапке (прототип v72, landThemeToggle): пока тему не выбрали, лендинг светлый (класс
 * bu-light-default, packages/ui/src/theme.css), поэтому без выбора следующая — тёмная. Выбор
 * запоминается так же, как кнопкой темы в программе, и действует после входа.
 */
function toggleLandingTheme() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

const CTA = buttonClass('cta');
const BTN = buttonClass();
const CTA_LG = `${CTA} lp-lg`;
const BTN_LG = `${BTN} lp-lg`;

const NAV = [
  ['features', 'land.nav.features'],
  ['start', 'land.nav.start'],
  ['security', 'land.nav.security'],
  ['faq', 'land.nav.faq'],
] as const;

const N3 = [1, 2, 3] as const;
const N4 = [1, 2, 3, 4] as const;
const N12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Символы герба: значок и цвет строки списка (прототип `EI`). */
const EMBLEM: readonly (readonly [EmblemPart, string, IconName, 1 | 2 | 3])[] = [
  ['sun', 's', 'sun', 1],
  ['scales', 'w', 'scale', 2],
  ['curve', 'c', 'infinity', 3],
];
/** Значки и цвета карточек (прототип: `who` — building/user/chart, `FI`/`FC` — «Возможности»). */
const WHO: readonly [IconName, string][] = [
  ['building', ''],
  ['user', 'g'],
  ['chart', 'p'],
];
const FEATURE_ICONS: readonly IconName[] = [
  'repeat',
  'calendar',
  'tag',
  'tg',
  'task',
  'coins',
  'wallet',
  'link',
  'gauge',
  'folder',
  'shield',
  'grad',
];
const FEATURE_TONES = ['', 'g', 'p', '', 'y', 'g', 'p', '', 'y', 'g', 'p', ''];
/** Пункты «Безопасность и данные» (прототип v70: без «Серверы в Европе…»). */
const SECURITY: readonly (readonly [1 | 2 | 3 | 4 | 5, IconName])[] = [
  [1, 'shield'],
  [2, 'key'],
  [3, 'users'],
  [4, 'history'],
  [5, 'archive'],
];

/** Блоки с «Подробнее». */
type BlockId =
  'emb' | 'who' | 'change' | 'features' | 'shots' | 'video' | 'start' | 'security' | 'faq' | 'lead';

/** Контакты из словаря; пустой контакт на странице не показывается (ТЗ «Тексты и контакты»). */
function contacts(t: Translate): { href: string; icon: IconName; text: string; external?: true }[] {
  const phone = t('land.c.phone').trim();
  const tg = t('land.c.tg').trim();
  const email = t('land.c.email').trim();
  return [
    ...(phone
      ? [{ href: `tel:${phone.replace(/[^\d+]/g, '')}`, icon: 'phone' as const, text: phone }]
      : []),
    ...(tg
      ? [
          {
            href: `https://t.me/${encodeURIComponent(tg.replace(/^@/, ''))}`,
            icon: 'tg' as const,
            text: tg,
            external: true as const,
          },
        ]
      : []),
    ...(email ? [{ href: `mailto:${email}`, icon: 'mail' as const, text: email }] : []),
  ];
}

export function Landing(props: LandingProps) {
  return (
    <UiProviders initialMax={parseMaxPrefs(undefined)}>
      <LandingPage {...props} />
    </UiProviders>
  );
}

/** Скрытые подробности блока: раскрывает «Подробнее» (прототип `dd` — блок, `ds` — строка). */
function Details({ children }: { children: ReactNode }) {
  return (
    <div className="lp-d">
      <div>{children}</div>
    </div>
  );
}
function DetailsLine({ children }: { children: ReactNode }) {
  return (
    <span className="lp-d">
      <span>{children}</span>
    </span>
  );
}

function LandingPage({ screens, numbers, codes, videos, today, stand }: LandingProps) {
  const t = useT();
  const guest = useGuestVideo(videos);
  const lead = videos[0];
  /**
   * Блоки страницы чередуют фон (прототип `landAlt`): блок «Видео» после «Как это выглядит» сдвигает
   * чередование следующих.
   */
  const alt = (on: boolean) => ((lead ? !on : on) ? ' alt' : '');
  const [menu, setMenu] = useState(false);
  const [shot, setShot] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [fab, setFab] = useState(false);
  const [bal, setBal] = useState(false);
  const [more, setMore] = useState<Partial<Record<BlockId, boolean>>>({});
  const [hl, setHl] = useState<EmblemPart | ''>('');
  const [tiles, setTiles] = useState<ReadonlySet<number>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  // Строка BOOT — в разметке с сервера, при загрузке страницы.
  const boot = usePageLoad();
  const fx = useRef<LandingFx | null>(null);
  const burger = useRef<HTMLButtonElement>(null);
  const logo = useRef<HTMLButtonElement>(null);
  const track = useRef<HTMLDivElement>(null);

  /** Плавно к блоку; `focus` — курсор в первое поле формы заявки. */
  const go = useCallback((id: string, focus = false) => {
    setMenu(false);
    const target = document.getElementById(`lp-${id}`);
    if (!target) return;
    const instant = reducedMotion();
    target.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
    if (focus) {
      window.setTimeout(
        () => document.getElementById('lf-name')?.focus({ preventScroll: true }),
        instant ? 0 : 450,
      );
    }
  }, []);
  const toLead = useCallback(() => go('lead', !sent), [go, sent]);

  // /#lead (так «Оставить заявку» из демо-версии открывает лендинг) — сразу к форме заявки.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash !== '#lead') return;
      window.history.replaceState(window.history.state, '', window.location.pathname);
      window.setTimeout(toLead, 60);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [toLead]);

  // После первого экрана: в углу весы-значок, на телефоне внизу «Оставить заявку» (над блоком заявки её нет).
  useEffect(() => {
    const hero = document.getElementById('lp-hero');
    const lead = document.getElementById('lp-lead');
    if (!hero || !lead || !('IntersectionObserver' in window)) return;
    const seen: Record<string, boolean> = { 'lp-hero': true, 'lp-lead': false };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen[e.target.id] = e.isIntersecting;
        setFab(!seen['lp-hero'] && !seen['lp-lead']);
        setBal(!seen['lp-hero']);
      },
      { threshold: 0 },
    );
    io.observe(hero);
    io.observe(lead);
    return () => io.disconnect();
  }, []);

  /*
   * Анимации лендинга. Блоки появляются, когда заставка с логотипом (общая, `BrandIntro`) улетит в шапку,
   * без заставки — сразу.
   */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const effects = startLandingFx(el, true);
    fx.current = effects;
    el.classList.add('lp-js');
    return () => {
      effects.stop();
      fx.current = null;
    };
  }, []);
  const revealBlocks = useCallback(() => fx.current?.reveal(), []);

  const toggleMore = (id: BlockId) => setMore((m) => ({ ...m, [id]: !m[id] }));
  /** Символ герба: нажатие на строку списка — подсветить или снять, на рисунок — подсветить; весы взвешивают. */
  const pick = (part: EmblemPart, fromEmblem = false) => {
    const next = hl === part && !fromEmblem ? '' : part;
    setHl(next);
    if (next === 'scales') fx.current?.weigh();
  };
  const toggleTile = (i: number) =>
    setTiles((s) => {
      const next = new Set(s);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  /** «Что меняется»: карточка переворачивается между «Было» и «Стало». */
  const flip = (e: MouseEvent<HTMLButtonElement>) => e.currentTarget.classList.toggle('now');

  const pickShot = (i: number) => {
    setShot(i);
    const el = track.current;
    if (el)
      el.scrollTo({ left: i * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  // Свайп по снимкам на телефоне: вкладка над снимками следует за прокруткой.
  const onTrackScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== shot) setShot(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && menu) {
      setMenu(false);
      burger.current?.focus();
    }
  };

  const toTop = () => {
    setMenu(false);
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  /**
   * Весы «Наверх» прячутся, когда виден первый экран: фокус заранее переходит на логотип в шапке — иначе Chrome
   * останавливает плавную прокрутку на полпути, как только скрывается кнопка в фокусе.
   */
  const balToTop = () => {
    logo.current?.focus({ preventScroll: true });
    toTop();
  };

  /** Кнопка «Подробнее» / «Свернуть» блока; `label` — своя подпись закрытой кнопки. */
  const moreButton = (id: BlockId, label?: string) => (
    <div className="lp-more-row">
      <button
        type="button"
        className="lp-more"
        aria-expanded={!!more[id]}
        onClick={() => toggleMore(id)}
      >
        <span>{more[id] ? t('land.less') : (label ?? t('land.more'))}</span>
        <Icon name="down" size="sm" />
      </button>
    </div>
  );
  /** Блок страницы: заголовок, подзаголовок и содержимое; `data-open` — раскрыты подробности. */
  const block = (
    id: BlockId,
    className: string,
    title: string,
    body: ReactNode,
    sub?: string,
    extra?: { 'data-hl'?: string },
  ) => (
    <section
      className={`lp-sec lp-b ${className}`}
      id={`lp-${id}`}
      data-open={more[id] ? '' : undefined}
      {...extra}
    >
      <div className="lp-wrap">
        <h2 className="rv">{title}</h2>
        {sub ? <p className="lp-sub rv">{sub}</p> : null}
        {body}
      </div>
    </section>
  );

  const navButtons = NAV.map(([id, key]) => (
    <button key={id} type="button" onClick={() => go(id)}>
      {t(key)}
    </button>
  ));
  const links = contacts(t);
  const contactLinks = links.map((c) => (
    <a
      key={c.icon}
      href={c.href}
      {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <Icon name={c.icon} />
      <span>{c.text}</span>
    </a>
  ));
  const shots = [
    <DeskScreen key="desk" t={t} d={screens} today={today} />,
    <CardScreen key="card" t={t} d={screens} />,
    <PhoneScreen key="phone" t={t} d={screens} today={today} />,
  ];
  const faqItem = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7) => (
    <details key={n} className="rv" style={delay((n - 1) % 3)}>
      <summary>{t(`land.faq.${n}.q` as const)}</summary>
      <p>{t(`land.faq.${n}.a` as const)}</p>
    </details>
  );

  return (
    <div
      ref={root}
      className="land bu-light-default"
      onKeyDown={onKeyDown}
      suppressHydrationWarning
    >
      {boot ? <script dangerouslySetInnerHTML={{ __html: BOOT }} /> : null}
      <BrandIntro onReveal={revealBlocks} />
      {guest.overlay}
      {stand ? <div className="lp-test">{t('land.test')}</div> : null}
      {/* Шапка */}
      <header className="lp-head">
        <div className="lp-wrap lp-head-in">
          <button
            ref={logo}
            type="button"
            className="lp-logo"
            onClick={toTop}
            aria-label={t('land.aria.home')}
          >
            <LandLogo />
            <span>
              <span className="lp-bn">Buhuchet.kg</span>
              <span className="lp-bs">{t('land.brand.sub')}</span>
            </span>
          </button>
          <nav className="lp-nav" aria-label={t('land.aria.nav')}>
            {navButtons}
          </nav>
          <div className="lp-head-r">
            <a href={DEMO_HREF} className={`${linkButtonClass()} lp-demo-l lp-hide-m`}>
              {t('land.nav.demo')}
            </a>
            <button
              type="button"
              className={`${iconButtonClass()} lp-theme`}
              aria-label={t('land.btn.theme')}
              title={t('land.btn.theme')}
              onClick={toggleLandingTheme}
            >
              <span className="bu-light-only inline-grid">
                <Icon name="moon" />
              </span>
              <span className="bu-dark-only">
                <Icon name="sun" />
              </span>
            </button>
            <a href={LOGIN_HREF} className={`${BTN} lp-hb`} onClick={skipNextIntro}>
              {t('land.btn.login')}
            </a>
            <button type="button" className={`${CTA} lp-hb lp-hide-m`} onClick={toLead}>
              {t('land.btn.lead')}
            </button>
            <button
              ref={burger}
              type="button"
              className={`${iconButtonClass()} lp-burger`}
              aria-expanded={menu}
              aria-controls="lp-menu"
              aria-label={t('land.btn.menu')}
              onClick={() => setMenu((m) => !m)}
            >
              <Icon name={menu ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
        <div className="lp-menu" id="lp-menu" hidden={!menu}>
          <nav aria-label={t('land.aria.nav')}>{navButtons}</nav>
          <button type="button" className={`${CTA} lp-wide`} onClick={toLead}>
            {t('land.btn.lead')}
          </button>
          <a href={DEMO_HREF} className={`${BTN} lp-wide`}>
            {t('land.btn.demo')}
          </a>
        </div>
      </header>
      {/* Линия Бернулли через всю страницу: рисуется по прокрутке, на конце — солнце */}
      <ScrollPath />
      <main>
        {/* Первый экран: заголовок, одна строка, две кнопки, картинка; внизу «Листайте вниз» */}
        <section className="lp-hero lp-live" id="lp-hero">
          <HeroBg />
          <div className="lp-wrap lp-hero-in">
            <div className="lp-hero-tx">
              <h1 className="rv">{t('land.hero.title')}</h1>
              <p className="lp-hero-p rv" style={delay(1)}>
                {t('land.hero.lead')}
              </p>
              <div className="lp-cta-row rv" style={delay(2)}>
                <button type="button" className={CTA_LG} onClick={toLead}>
                  {t('land.btn.lead')}
                </button>
                <a href={DEMO_HREF} className={BTN_LG}>
                  {t('land.btn.demo')}
                </a>
              </div>
              {lead ? (
                <button
                  type="button"
                  className="lp-vlink rv"
                  style={delay(3)}
                  data-lp-vid={lead.id}
                  onClick={() => guest.open(lead.id)}
                >
                  <span className="lp-vlink-i">
                    <Icon name="pl" size="sm" />
                  </span>
                  <span>
                    {t('land.video.watch')} · {videoTime(lead.duration)}
                  </span>
                </button>
              ) : null}
            </div>
            <div className="lp-hero-pic" role="img" aria-label={t('land.aria.hero_pic')}>
              <DeskScreen t={t} d={screens} today={today} hero />
              <PhoneScreen t={t} d={screens} today={today} />
            </div>
          </div>
          <button type="button" className="lp-scroll" onClick={() => go('emb')}>
            <i aria-hidden="true" />
            <span>{t('land.scroll')}</span>
          </button>
        </section>
        {/* Полоса цифр: числа досчитываются от нуля */}
        <section className="lp-stats" aria-label={t('land.aria.stats')}>
          <div className="lp-wrap lp-stats-in">
            <div className="lp-stat rv">
              <b data-lp-count={numbers.reportTypes}>{numbers.reportTypes}</b>
              <span>{t('land.stats.types')}</span>
            </div>
            <div className="lp-stat rv" style={delay(1)}>
              <b data-lp-count={numbers.regimes}>{numbers.regimes}</b>
              <span>{t('land.stats.regimes')}</span>
            </div>
            <div className="lp-stat rv" style={delay(2)}>
              <span className="lp-si">
                <Icon name="calendar" />
              </span>
              <strong>{t('land.stats.cal')}</strong>
            </div>
            <div className="lp-stat rv" style={delay(3)}>
              <span className="lp-si">
                <Icon name="bell" />
              </span>
              <strong>{t('land.stats.remind')}</strong>
            </div>
          </div>
        </section>
        {/* 1. Герб — печать «штампуется», символы оживают; нажатие на символ — что он значит в программе */}
        {block(
          'emb',
          'lp-emb lp-live',
          t('land.emb.title'),
          <div className="lp-emb-in">
            <div className="lp-emb-fig">
              <Emblem t={t} onPick={(part) => pick(part, true)} />
            </div>
            <div className="lp-emb-r">
              <ul className="lp-emb-l">
                {EMBLEM.map(([part, tone, icon, n], i) => (
                  <li key={part} className="rv" style={delay(i)}>
                    <button type="button" aria-pressed={hl === part} onClick={() => pick(part)}>
                      <span className={`lp-emb-ic ${tone}`}>
                        <Icon name={icon} />
                      </span>
                      <span className="lp-emb-tx">
                        <b>{t(`land.emb.${n}.t` as const)}</b>
                        <DetailsLine>{t(`land.emb.${n}.d` as const)}</DetailsLine>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Details>
                <p className="lp-motto">
                  <span className="lp-motto-f">{t('land.emb.motto')}</span>
                  <span>{t('land.emb.motto.ru')}</span>
                </p>
              </Details>
              {moreButton('emb')}
            </div>
          </div>,
          t('land.emb.sub'),
          { 'data-hl': hl || undefined },
        )}
        {/* 2. Кому подходит — карточки поворачиваются к посетителю */}
        {block(
          'who',
          'lp-who alt',
          t('land.who.title'),
          <>
            <div className="lp-grid3">
              {N3.map((n, i) => (
                <div key={n} className="lp-card rv" style={delay(i)}>
                  <span className={`lp-ico ${WHO[i]![1]}`}>
                    <Icon name={WHO[i]![0]} />
                  </span>
                  <h3>{t(`land.who.${n}.t` as const)}</h3>
                  <Details>
                    <p>{t(`land.who.${n}.d` as const)}</p>
                  </Details>
                </div>
              ))}
            </div>
            {moreButton('who')}
          </>,
        )}
        {/* 3. Что меняется — карточка «Было» переворачивается в «Стало»; «Подробнее» — обе стороны рядом */}
        {block(
          'change',
          'lp-chg-s',
          t('land.change.title'),
          <>
            <div className="lp-flips">
              {N4.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="lp-fc rv"
                  style={delay(n - 1)}
                  onClick={flip}
                >
                  <span className="lp-fc-in">
                    <span className="lp-fc-f lp-fw">
                      <small>
                        <Icon name="x" size="sm" />
                        {t('land.change.was')}
                      </small>
                      <span className="lp-x">{t(`land.change.${n}.a` as const)}</span>
                    </span>
                    <span className="lp-fc-f lp-fn">
                      <small>
                        <Icon name="check" size="sm" />
                        {t('land.change.now')}
                      </small>
                      <span>{t(`land.change.${n}.b` as const)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="lp-hint rv">{t('land.change.tap')}</p>
            {moreButton('change')}
          </>,
        )}
        {/* 4. Возможности — мозаика плиток волной; плитка раскрывается нажатием */}
        {block(
          'features',
          'lp-feat alt',
          t('land.feat.title'),
          <>
            <div className="lp-tiles">
              {N12.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  className="lp-tile rv"
                  style={delay((i % 4) + Math.floor(i / 4))}
                  aria-expanded={tiles.has(i)}
                  onClick={() => toggleTile(i)}
                >
                  <span className={`lp-ico ${FEATURE_TONES[i]!}`}>
                    <Icon name={FEATURE_ICONS[i]!} />
                  </span>
                  <b>{t(`land.feat.${n}.t` as const)}</b>
                  <DetailsLine>{t(`land.feat.${n}.d` as const)}</DetailsLine>
                </button>
              ))}
            </div>
            {moreButton('features')}
          </>,
        )}
        {/* 5. Как это выглядит — экран выпрямляется, как крышка ноутбука, пока блок въезжает */}
        {block(
          'shots',
          'lp-shots',
          t('land.shots.title'),
          <>
            <div className="lp-tabs rv" role="tablist" aria-label={t('land.shots.title')}>
              {N3.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  id={`lp-st-${i}`}
                  aria-controls={`lp-sl-${i}`}
                  aria-selected={shot === i}
                  onClick={() => pickShot(i)}
                >
                  {t(`land.shots.${n}.t` as const)}
                </button>
              ))}
            </div>
            <div className="lp-tilt">
              <div className="lp-track" ref={track} onScroll={onTrackScroll}>
                {N3.map((n, i) => (
                  <figure
                    key={n}
                    className="lp-slide"
                    id={`lp-sl-${i}`}
                    role="tabpanel"
                    aria-labelledby={`lp-st-${i}`}
                  >
                    <div
                      className="lp-shot"
                      role="img"
                      aria-label={t(`land.shots.${n}.t` as const)}
                    >
                      {shots[i]}
                    </div>
                    <figcaption className="lp-d">
                      <span>{t(`land.shots.${n}.d` as const)}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
            <div className="lp-shots-cta">
              <a href={DEMO_HREF} className={BTN_LG}>
                <Icon name="eye" size="sm" />
                {t('land.btn.demo')}
              </a>
            </div>
            {moreButton('shots')}
          </>,
        )}
        {/* Видео о Buhuchet.kg — большая обложка первого видео, остальные справа въезжают по одному */}
        {lead
          ? block(
              'video',
              'lp-vids alt',
              t('land.video.title'),
              <>
                <div className={`lp-vgrid${videos.length > 1 ? '' : ' one'}`}>
                  <div className="lp-vmain rv">
                    <button
                      type="button"
                      className="lp-vbig"
                      data-lp-vid={lead.id}
                      aria-label={`${lead.title} · ${videoTime(lead.duration)}`}
                      onClick={() => guest.open(lead.id)}
                    >
                      <VideoCover video={lead} land className="lp-vcv" />
                    </button>
                    <div className="lp-vtx">
                      {lead.cover ? <b>{lead.title}</b> : null}
                      <span className="lp-vdur">
                        <Icon name="clock" size="sm" />
                        {videoTime(lead.duration)}
                      </span>
                      {lead.description ? (
                        <Details>
                          <p>{lead.description}</p>
                        </Details>
                      ) : null}
                    </div>
                  </div>
                  {videos.length > 1 ? (
                    <div className="lp-vlist">
                      {videos.slice(1).map((v, i) => (
                        <button
                          key={v.id}
                          type="button"
                          className="lp-vc rv"
                          style={delay(i + 1)}
                          data-lp-vid={v.id}
                          onClick={() => guest.open(v.id)}
                        >
                          <VideoCover video={v} land size="sm" showDuration={false} />
                          <span className="lp-vct">
                            <b>{v.title}</b>
                            <span className="lp-vdur">
                              <Icon name="clock" size="sm" />
                              {videoTime(v.duration)}
                            </span>
                            {v.description ? <DetailsLine>{v.description}</DetailsLine> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {videos.some((v) => v.description) ? moreButton('video') : null}
              </>,
            )
          : null}
        {/* 6. Как начать — линия шагов заполняется по прокрутке, номера загораются */}
        {block(
          'start',
          `lp-start${alt(true)}`,
          t('land.start.title'),
          <>
            <div className="lp-steps-w">
              <span className="lp-sline" aria-hidden="true">
                <i />
              </span>
              <ol className="lp-steps">
                {N4.map((n) => (
                  <li key={n} className="rv" style={delay(n - 1)}>
                    <span className="lp-num" aria-hidden="true">
                      {n}
                    </span>
                    <h3>{t(`land.start.${n}.t` as const)}</h3>
                    <Details>
                      <p>{t(`land.start.${n}.d` as const)}</p>
                    </Details>
                  </li>
                ))}
              </ol>
            </div>
            {moreButton('start')}
          </>,
        )}
        {/* 7. Безопасность — щит рисуется, замок защёлкивается, значки выходят на орбиту */}
        {block(
          'security',
          `lp-secu${alt(false)}`,
          t('land.sec.title'),
          <div className="lp-secu-in">
            <div className="lp-orbit rv" aria-hidden="true">
              <Shield />
              <span className="lp-orb-r">
                {SECURITY.map(([n, icon], i) => (
                  <span
                    key={n}
                    className="lp-orb"
                    style={{ '--a': `${i * 72 - 90}deg`, '--d': i } as CSSProperties}
                  >
                    <i>
                      <Icon name={icon} />
                    </i>
                  </span>
                ))}
              </span>
            </div>
            <div className="lp-secu-r">
              <p className="lp-secu-s rv">{t('land.sec.short')}</p>
              <Details>
                <ul className="lp-secl">
                  {SECURITY.map(([n, icon]) => (
                    <li key={n}>
                      <Icon name={icon} />
                      <span>{t(`land.sec.${n}` as const)}</span>
                    </li>
                  ))}
                </ul>
              </Details>
              {moreButton('security')}
            </div>
          </div>,
        )}
        {/* 8. Вопросы — выезжают попеременно слева и справа; видны первые три, «Подробнее» — остальные */}
        {block(
          'faq',
          `lp-faqs${alt(true)}`,
          t('land.faq.title'),
          <>
            <div className="lp-faq">{([1, 2, 3] as const).map(faqItem)}</div>
            <Details>
              <div className="lp-faq lp-faq2">{([4, 5, 6, 7] as const).map(faqItem)}</div>
            </Details>
            {moreButton('faq')}
          </>,
        )}
        {/* 9. Оставить заявку — форма раскладывается, поля встают по одному; после отправки — печать */}
        {block(
          'lead',
          `lp-leads${alt(false)}`,
          t('land.lead.title'),
          <div className="lp-lead-in">
            <div className="lp-fold rv">
              {sent ? (
                <div className="lp-ok" role="status">
                  <Stamp />
                  <span>{t('land.ok', { телефон: sent })}</span>
                </div>
              ) : (
                <LeadForm codes={codes} onSent={setSent} onConsent={() => setConsent(true)} />
              )}
            </div>
            {links.length > 0 ? (
              <div className="lp-cont rv" style={delay(2)}>
                {moreButton('lead', t('land.c.title'))}
                <Details>{contactLinks}</Details>
              </div>
            ) : null}
          </div>,
          t('land.lead.sub'),
        )}
      </main>
      {/* Подвал */}
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span>
            <b>{t('land.foot.name')}</b>
            <br />
            {t('land.foot.copy', { год: today.slice(0, 4) })}
          </span>
          {links.length > 0 ? <span className="lp-foot-l">{contactLinks}</span> : null}
          <span className="lp-foot-l">
            <a href={LOGIN_HREF} className={linkButtonClass()} onClick={skipNextIntro}>
              {t('land.btn.login')}
            </a>
            <button type="button" className={linkButtonClass()} onClick={() => setConsent(true)}>
              {t('land.consent.title')}
            </button>
          </span>
        </div>
      </footer>
      <div className="lp-fab" hidden={!fab}>
        <button type="button" className={CTA} onClick={toLead}>
          {t('land.btn.lead')}
        </button>
      </div>
      {/* Весы в углу: качаются от прокрутки, кольцо — сколько прочитано; нажатие — наверх */}
      <button
        type="button"
        className="lp-bal"
        hidden={!bal}
        aria-label={t('land.top')}
        title={t('land.top')}
        onClick={balToTop}
      >
        <BalanceIcon />
      </button>
      <Modal
        open={consent}
        onClose={() => setConsent(false)}
        kind="message"
        title={t('land.consent.title')}
        footer={
          <button type="button" className={CTA} onClick={() => setConsent(false)}>
            {t('land.consent.ok')}
          </button>
        }
      >
        <p className="m-0 leading-[1.55]">{t('land.consent.text')}</p>
      </Modal>
    </div>
  );
}
