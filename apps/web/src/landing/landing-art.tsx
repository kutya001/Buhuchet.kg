import { BRAND_LOGO } from '@buhuchet/ui';
import type { CSSProperties, MouseEvent } from 'react';
import type { Translate } from '../l10n/translate';
import { DrawMask, LogoBody } from '../shell/brand-intro';
import { lemniscate } from './landing-fx';

/*
 * Рисунки лендинга v78 (прототип modules/landing.js: landLogo, landHeroBg, landEmblem,
 * сквозная линия и весы в landDraw, щит «Безопасности»): только SVG, тексты — из словаря.
 */

/** Знак в шапке: спираль дорисовывается при открытии и при наведении (прототип landLogo). */
export function LandLogo() {
  return (
    <svg
      className="logo lp-logo-a"
      viewBox={BRAND_LOGO.viewBox}
      aria-hidden="true"
      focusable="false"
    >
      <LogoBody id="lp-lgm" />
    </svg>
  );
}

/** Фон первого экрана: солнце с лучами справа сверху и большая спираль логотипа (прототип landHeroBg). */
export function HeroBg() {
  return (
    <div className="lp-hero-bg" aria-hidden="true">
      <span className="lp-hb-sun" />
      <svg className="lp-hb-sp" viewBox={BRAND_LOGO.viewBox} focusable="false">
        <DrawMask id="lp-hbm" />
        <path className="lg-sp" mask="url(#lp-hbm)" d={BRAND_LOGO.spiral} />
      </svg>
    </div>
  );
}

/** Сквозная линия Бернулли с солнцем на конце: путь считает landing-fx (`#lp-path`). */
export function ScrollPath() {
  return (
    <svg className="lp-path" id="lp-path" aria-hidden="true" focusable="false">
      <path className="lp-p0" />
      <path className="lp-p1" />
      <g className="lp-knots" />
      <g className="lp-psun">
        <circle className="g" r="15" />
        <path
          className="r"
          d="M0-11V-15M0 11V15M-11 0H-15M11 0H15M-7.8-7.8-10.6-10.6M7.8 7.8 10.6 10.6M-7.8 7.8-10.6 10.6M7.8-7.8 10.6-10.6"
        />
        <circle className="c" r="6" />
      </g>
    </svg>
  );
}

/** Весы-значок в углу: кольцо — сколько прочитано, весы качаются от прокрутки. */
export function BalanceIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="b0" cx="32" cy="32" r="29" />
      <circle className="b1" cx="32" cy="32" r="29" pathLength={1} transform="rotate(-90 32 32)" />
      <path className="bp" d="M32 19V47M25 48H39" />
      <g className="bb">
        <path className="bk" d="M16 22H48" />
        <g className="bl">
          <path d="M16 22L11 33M16 22L21 33" />
          <path className="bw" d="M9.5 33H22.5Q21 38 16 38Q11 38 9.5 33Z" />
        </g>
        <g className="br">
          <path d="M48 22L43 33M48 22L53 33" />
          <path className="bw" d="M41.5 33H54.5Q53 38 48 38Q43 38 41.5 33Z" />
        </g>
      </g>
      <circle className="bc" cx="32" cy="22" r="2.6" />
    </svg>
  );
}

/** Щит с замком «Безопасности и данных». */
export function Shield() {
  return (
    <svg className="lp-shield" viewBox="0 0 120 140" focusable="false">
      <path
        className="sh-b"
        d="M60 8L106 25V64C106 96 87 119 60 131C33 119 14 96 14 64V25Z"
        pathLength={1}
      />
      <path className="sh-k" d="M49 68V58a11 11 0 0 1 22 0v10" />
      <rect className="sh-l" x="42" y="66" width="36" height="28" rx="5" />
      <circle className="sh-h" cx="60" cy="78" r="3.6" />
      <path className="sh-h" d="M58.4 80h3.2l1 7h-5.2Z" />
    </svg>
  );
}

/** Печать после отправки заявки. */
export function Stamp() {
  return (
    <svg className="lp-stamp" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" />
      <circle className="i" cx="32" cy="32" r="23" />
      <path className="k" d="M21 33l7 7 15-16" />
    </svg>
  );
}

/** Символ герба. */
export type EmblemPart = 'sun' | 'scales' | 'curve';

/** Луч солнца герба: i-й из 12, длина l (прототип landEmblem, `r`). */
function ray(i: number, l: number) {
  const a = (i * Math.PI) / 6;
  const x = Math.sin(a);
  const y = -Math.cos(a);
  return `M${(150 + x * 21).toFixed(1)} ${(78 + y * 21).toFixed(1)}L${(150 + x * l).toFixed(1)} ${(78 + y * l).toFixed(1)}`;
}
const RAYS = Array.from({ length: 12 }, (_, i) => ray(i, i % 2 ? 27 : 32)).join('');
const INF = (() => {
  const lem = lemniscate(150, 229, 34);
  return lem.m + lem.d;
})();

function Pan({ x, side, label }: { x: number; side: 'l' | 'r'; label: string }) {
  return (
    <g className={`e-pan e-pan-${side}`}>
      <path className="e-str" d={`M${x} 124L${x - 17} 160M${x} 124L${x + 17} 160`} />
      <ellipse className={`e-coin e-coin-${side}`} cx={x} cy="157" rx="9" ry="3.2" />
      <path
        className="e-bowl"
        d={`M${x - 22} 160H${x + 22}Q${x + 19} 172 ${x} 172Q${x - 19} 172 ${x - 22} 160Z`}
      />
      <text className="e-lab" x={x} y="188">
        {label}
      </text>
    </g>
  );
}

/**
 * Круглый герб: кольцо с девизом (сверху по-французски, снизу по-русски), в поле солнце, весы с чашами
 * «Дебет» и «Кредит», ∞. Нажатие на символ подсвечивает его (`onPick`).
 */
export function Emblem({ t, onPick }: { t: Translate; onPick: (part: EmblemPart) => void }) {
  const click = (e: MouseEvent<SVGSVGElement>) => {
    const part = (e.target as Element).closest<SVGGElement>('.e-part')?.dataset.e;
    if (part === 'sun' || part === 'scales' || part === 'curve') onPick(part);
  };
  return (
    <svg
      className="lp-emb-svg"
      viewBox="0 0 300 300"
      role="img"
      aria-label={t('land.emb.aria')}
      focusable="false"
      onClick={click}
    >
      <defs>
        <radialGradient id="lpe-glow">
          <stop offset="0" className="e-g0" />
          <stop offset="1" className="e-g1" />
        </radialGradient>
        <radialGradient id="lpe-fld" cx="50%" cy="38%" r="62%">
          <stop offset="0" className="e-f0" />
          <stop offset="1" className="e-f1" />
        </radialGradient>
        <path id="lpe-top" d="M25 150A125 125 0 0 1 275 150" />
        <path id="lpe-bot" d="M14 150A136 136 0 0 0 286 150" />
      </defs>
      <circle className="e-rip" cx="150" cy="150" r="146" />
      <g className="e-seal">
        <circle className="e-band" cx="150" cy="150" r="146" />
        <circle className="e-edge" cx="150" cy="150" r="143" pathLength={1} />
        <circle className="e-field" cx="150" cy="150" r="117" fill="url(#lpe-fld)" />
        <circle className="e-dots" cx="150" cy="150" r="111" pathLength={1} />
        <text className="e-ring">
          <textPath href="#lpe-top" startOffset="50%" textAnchor="middle">
            {t('land.emb.motto')}
          </textPath>
        </text>
        <text className="e-ring">
          <textPath href="#lpe-bot" startOffset="50%" textAnchor="middle">
            {t('land.emb.motto.r')}
          </textPath>
        </text>
        <path className="e-star" d="M10 150l4-4 4 4-4 4ZM282 150l4-4 4 4-4 4Z" />
      </g>
      <g className="e-part e-sun" data-e="sun">
        <circle className="e-glow" cx="150" cy="78" r="42" fill="url(#lpe-glow)" />
        <path className="e-rays" d={RAYS} />
        <circle className="e-core" cx="150" cy="78" r="15" />
      </g>
      <g className="e-part e-scales" data-e="scales">
        <path className="e-post" d="M150 118V197" />
        <path className="e-base" d="M129 205H171L163 196H137Z" />
        <g className="e-beam">
          <path className="e-bar" d="M88 124H212" />
          <Pan x={88} side="l" label={t('land.emb.debit')} />
          <Pan x={212} side="r" label={t('land.emb.credit')} />
          <circle className="e-piv" cx="150" cy="124" r="5" />
        </g>
        <circle className="e-top" cx="150" cy="112" r="4" />
      </g>
      <g className="e-part e-curve" data-e="curve">
        <path className="e-inf" d={INF} pathLength={1} />
        <path className="e-comet" d={INF} pathLength={1} />
      </g>
    </svg>
  );
}

/** Задержка появления элемента в блоке (`--d` прототипа). */
export const delay = (d: number) => ({ '--d': d }) as CSSProperties;
