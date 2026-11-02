'use client';

import {
  BrandMark,
  buttonClass,
  Icon,
  iconButtonClass,
  linkButtonClass,
  Modal,
  type IconName,
  type PhoneInputCode,
} from '@buhuchet/ui';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { parseMaxPrefs } from '../shell/prefs';
import { UiProviders } from '../shell/ui-providers';
import type { DemoScreens } from './landing-data';
import { LeadForm } from './lead-form';
import { CardScreen, DeskScreen, PhoneScreen } from './mini-screens';
import './landing.css';

/*
 * Лендинг buhuchet.kg для гостей (задача #165; ТЗ «Лендинг — buhuchet.kg для гостей»; прототип
 * modules/landing.js, landDraw и landBind): одна длинная страница из 12 блоков по порядку. Все тексты —
 * словарь, группа «Лендинг» (правятся в «Локализации»); числа полосы цифр и картинки — из справочников и
 * демо-данных на момент сборки. «Посмотреть на демо-организацию» открывает /demo — собранный файл
 * прототипа; «Войти» — страницу входа. Единственный запрос страницы к серверу — отправка заявки.
 */

export interface LandingProps {
  screens: DemoScreens;
  numbers: { reportTypes: number; regimes: number };
  codes: readonly PhoneInputCode[];
  /** Сегодня по Бишкеку (YYYY-MM-DD): просрочка на картинках и год в подвале. */
  today: string;
  /** Тестовый стенд: полоса «Тестовый стенд: данные демонстрационные». */
  stand: boolean;
}

/** Адрес демо-версии (ТЗ «Демо-организация»: buhuchet.kg/demo). */
const DEMO_HREF = '/demo';
const LOGIN_HREF = '/login';

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
const N7 = [1, 2, 3, 4, 5, 6, 7] as const;
const N12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

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

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function LandingPage({ screens, numbers, codes, today, stand }: LandingProps) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const [shot, setShot] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [fab, setFab] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
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

  // На телефоне после первого экрана внизу закреплена «Оставить заявку»; над блоком заявки скрыта.
  useEffect(() => {
    const hero = document.getElementById('lp-hero');
    const lead = document.getElementById('lp-lead');
    if (!hero || !lead || !('IntersectionObserver' in window)) return;
    const seen: Record<string, boolean> = { 'lp-hero': true, 'lp-lead': false };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen[e.target.id] = e.isIntersecting;
        setFab(!seen['lp-hero'] && !seen['lp-lead']);
      },
      { threshold: 0 },
    );
    io.observe(hero);
    io.observe(lead);
    return () => io.disconnect();
  }, []);

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

  return (
    <div className="land" onKeyDown={onKeyDown}>
      {stand ? <div className="lp-test">{t('land.test')}</div> : null}
      {/* 1. Шапка */}
      <header className="lp-head">
        <div className="lp-wrap lp-head-in">
          <button
            type="button"
            className="lp-logo"
            onClick={toTop}
            aria-label={t('land.aria.home')}
          >
            <BrandMark />
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
            <a href={LOGIN_HREF} className={BTN}>
              {t('land.btn.login')}
            </a>
            <button type="button" className={`${CTA} lp-hide-m`} onClick={toLead}>
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
      <main>
        {/* 2. Первый экран */}
        <section className="lp-hero" id="lp-hero">
          <div className="lp-wrap lp-hero-in">
            <div>
              <h1>{t('land.hero.title')}</h1>
              <p className="lp-hero-p">{t('land.hero.sub')}</p>
              <div className="lp-cta-row">
                <button type="button" className={CTA_LG} onClick={toLead}>
                  {t('land.btn.lead')}
                </button>
                <a href={DEMO_HREF} className={BTN_LG}>
                  {t('land.btn.demo')}
                </a>
              </div>
              <button
                type="button"
                className={`${linkButtonClass()} lp-more`}
                onClick={() => go('features')}
              >
                {t('land.btn.more')}
                <Icon name="down" size="sm" />
              </button>
              <p className="lp-note">
                <Icon name="check" size="sm" />
                <span>{t('land.hero.note')}</span>
              </p>
            </div>
            <div className="lp-hero-pic" role="img" aria-label={t('land.aria.hero_pic')}>
              <DeskScreen t={t} d={screens} today={today} hero />
              <PhoneScreen t={t} d={screens} today={today} />
            </div>
          </div>
        </section>
        {/* 3. Полоса цифр */}
        <section className="lp-stats" aria-label={t('land.aria.stats')}>
          <div className="lp-wrap lp-stats-in">
            <div className="lp-stat">
              <b>{numbers.reportTypes}</b>
              <span>{t('land.stats.types')}</span>
            </div>
            <div className="lp-stat">
              <b>{numbers.regimes}</b>
              <span>{t('land.stats.regimes')}</span>
            </div>
            <div className="lp-stat">
              <span className="lp-si">
                <Icon name="calendar" />
              </span>
              <strong>{t('land.stats.cal')}</strong>
              <span>{t('land.stats.cal.sub')}</span>
            </div>
            <div className="lp-stat">
              <span className="lp-si">
                <Icon name="bell" />
              </span>
              <strong>{t('land.stats.remind')}</strong>
            </div>
          </div>
        </section>
        {/* 4. Кому подходит */}
        <section className="lp-sec alt" id="lp-who">
          <div className="lp-wrap">
            <h2>{t('land.who.title')}</h2>
            <div className="lp-grid3">
              {N3.map((n, i) => (
                <LandCard
                  key={n}
                  icon={WHO[i]![0]}
                  tone={WHO[i]![1]}
                  title={t(`land.who.${n}.t` as const)}
                  text={t(`land.who.${n}.d` as const)}
                />
              ))}
            </div>
          </div>
        </section>
        {/* 5. Что меняется */}
        <section className="lp-sec" id="lp-change">
          <div className="lp-wrap">
            <h2>{t('land.change.title')}</h2>
            <div className="lp-chg">
              <div className="lp-chg-h">
                <span>{t('land.change.was')}</span>
                <span>{t('land.change.now')}</span>
              </div>
              {N4.map((n) => (
                <div key={n} className="lp-chg-r">
                  <div className="lp-was">
                    <Icon name="x" size="sm" />
                    <span>
                      <span className="sr-only">{`${t('land.change.was')}: `}</span>
                      {t(`land.change.${n}.a` as const)}
                    </span>
                  </div>
                  <div className="lp-arr" aria-hidden="true">
                    <Icon name="right" />
                  </div>
                  <div className="lp-now">
                    <Icon name="check" size="sm" />
                    <span>
                      <span className="sr-only">{`${t('land.change.now')}: `}</span>
                      {t(`land.change.${n}.b` as const)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        {/* 6. Возможности */}
        <section className="lp-sec alt" id="lp-features">
          <div className="lp-wrap">
            <h2>{t('land.feat.title')}</h2>
            <div className="lp-grid3">
              {N12.map((n, i) => (
                <LandCard
                  key={n}
                  icon={FEATURE_ICONS[i]!}
                  tone={FEATURE_TONES[i]!}
                  title={t(`land.feat.${n}.t` as const)}
                  text={t(`land.feat.${n}.d` as const)}
                />
              ))}
            </div>
          </div>
        </section>
        {/* 7. Как это выглядит */}
        <section className="lp-sec" id="lp-shots">
          <div className="lp-wrap">
            <h2>{t('land.shots.title')}</h2>
            <div className="lp-tabs" role="tablist" aria-label={t('land.shots.title')}>
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
                    className="lp-slide-pic"
                    role="img"
                    aria-label={t(`land.shots.${n}.t` as const)}
                  >
                    {shots[i]}
                  </div>
                  <figcaption>{t(`land.shots.${n}.d` as const)}</figcaption>
                </figure>
              ))}
            </div>
            <div className="lp-shots-cta">
              <a href={DEMO_HREF} className={BTN_LG}>
                <Icon name="eye" size="sm" />
                {t('land.btn.demo')}
              </a>
            </div>
          </div>
        </section>
        {/* 8. Как начать */}
        <section className="lp-sec alt" id="lp-start">
          <div className="lp-wrap">
            <h2>{t('land.start.title')}</h2>
            <ol className="lp-steps">
              {N4.map((n) => (
                <li key={n}>
                  <span className="lp-num" aria-hidden="true">
                    {n}
                  </span>
                  <h3>{t(`land.start.${n}.t` as const)}</h3>
                  <p>{t(`land.start.${n}.d` as const)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        {/* 9. Безопасность и данные */}
        <section className="lp-sec" id="lp-security">
          <div className="lp-wrap">
            <h2>{t('land.sec.title')}</h2>
            <ul className="lp-secl">
              {SECURITY.map(([n, icon]) => (
                <li key={n}>
                  <Icon name={icon} />
                  <span>{t(`land.sec.${n}` as const)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {/* 10. Вопросы */}
        <section className="lp-sec alt" id="lp-faq">
          <div className="lp-wrap">
            <h2>{t('land.faq.title')}</h2>
            <div className="lp-faq">
              {N7.map((n) => (
                <details key={n}>
                  <summary>{t(`land.faq.${n}.q` as const)}</summary>
                  <p>{t(`land.faq.${n}.a` as const)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        {/* 11. Оставить заявку */}
        <section className="lp-sec" id="lp-lead">
          <div className="lp-wrap">
            <h2>{t('land.lead.title')}</h2>
            <p className="lp-sub">{t('land.lead.sub')}</p>
            <div className="lp-lead-in">
              <div>
                {sent ? (
                  <div className="lp-ok" role="status">
                    <Icon name="check" />
                    <span>{t('land.ok', { телефон: sent })}</span>
                  </div>
                ) : (
                  <LeadForm codes={codes} onSent={setSent} onConsent={() => setConsent(true)} />
                )}
              </div>
              {links.length > 0 ? (
                <div className="lp-cont">
                  <h3>{t('land.c.title')}</h3>
                  {contactLinks}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
      {/* 12. Подвал */}
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span>
            <b>{t('land.foot.name')}</b>
            <br />
            {t('land.foot.copy', { год: today.slice(0, 4) })}
          </span>
          {links.length > 0 ? <span className="lp-foot-l">{contactLinks}</span> : null}
          <span className="lp-foot-l">
            <a href={LOGIN_HREF} className={linkButtonClass()}>
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

function LandCard({
  icon,
  tone,
  title,
  text,
}: {
  icon: IconName;
  tone: string;
  title: string;
  text: string;
}) {
  return (
    <div className="lp-card">
      <span className={`lp-ico ${tone}`}>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
