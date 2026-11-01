import { formatDateRu, formatSom, type UiTextKey } from '@buhuchet/domain';
import { BrandMark, StatusPill } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import type { DemoReport, DemoScreens } from './landing-data';

/*
 * Уменьшенные экраны программы для лендинга (прототип modules/landing.js: lshDesk, lshPhone, lshCard;
 * css/landing.css `.lsh*`): нарисованы из демо-данных в цветах темы, поэтому совпадают с программой и в
 * тёмной теме. Это картинки: без фокуса и нажатий (`pointer-events: none`), смысл — в подписи блока.
 */

/** Модули левой панели картинки — как в программе (`nav.*` словаря). */
const SIDE: readonly [string, UiTextKey][] = [
  ['home', 'nav.home'],
  ['cps', 'nav.counterparties'],
  ['reports', 'nav.reports'],
  ['fin', 'nav.finance'],
  ['tasks', 'nav.tasks'],
  ['staff', 'nav.staff'],
];

/** К уплате без копеек, как `fmtM(sum, false)` прототипа. */
const sum = (value: number | null) =>
  value == null ? '—' : formatSom(Math.round(value) * 100, 'auto');

function Top({ url }: { url: string }) {
  return (
    <div className="lsh-top">
      <i />
      <i />
      <i />
      <span>{url}</span>
    </div>
  );
}

function Side({ t, on }: { t: Translate; on: string }) {
  return (
    <div className="lsh-side">
      <div className="lsh-logo">
        <BrandMark />
      </div>
      {SIDE.map(([id, key]) => (
        <span key={id} className={id === on ? 'on' : ''}>
          {t(key)}
        </span>
      ))}
    </div>
  );
}

function Plates({ t, d, phone }: { t: Translate; d: DemoScreens; phone?: boolean }) {
  return (
    <div className="lsh-pl">
      <div className="r">
        <b>{d.overdue}</b>
        <small>{t('land.shot.pl.overdue')}</small>
      </div>
      <div className="y">
        <b>{d.week}</b>
        <small>{t('land.shot.pl.week')}</small>
      </div>
      {phone ? null : (
        <div className="g">
          <b>{d.done}</b>
          <small>{t('land.shot.pl.done')}</small>
        </div>
      )}
    </div>
  );
}

const Pill = ({ r }: { r: DemoReport }) => (
  <StatusPill label={r.status.label} tone={r.status.tone} icon={r.status.icon} size="sm" />
);

/** Экран «Отчеты для сдачи» на ПК; `hero` — без столбца «К уплате» (первый экран). */
export function DeskScreen({
  t,
  d,
  today,
  hero = false,
}: {
  t: Translate;
  d: DemoScreens;
  today: string;
  hero?: boolean;
}) {
  return (
    <div className="lsh lsh-desk">
      <Top url="buhuchet.kg/#reports" />
      <div className="lsh-body">
        <Side t={t} on="reports" />
        <div className="lsh-m">
          <div className="lsh-h">{t('nav.reports')}</div>
          <div className="lsh-tb">
            <span className="on">{t('land.shot.tab.week')}</span>
            <span>{t('land.shot.tab.overdue')}</span>
            <span>{t('land.shot.tab.wait')}</span>
            <span>{t('land.shot.tab.all')}</span>
          </div>
          <Plates t={t} d={d} />
          <table className="lsh-t">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>{t('land.shot.col.cp')}</th>
                <th style={{ width: '22%' }}>{t('land.shot.col.report')}</th>
                <th style={{ width: '15%' }}>{t('land.shot.col.due')}</th>
                <th style={{ width: '16%' }}>{t('land.shot.col.status')}</th>
                {hero ? null : (
                  <th className="num c-sum" style={{ width: '13%' }}>
                    {t('land.shot.col.sum')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.contractor}</td>
                  <td>{r.type}</td>
                  <td className={r.due < today ? 'red' : ''}>{formatDateRu(r.due)}</td>
                  <td>
                    <Pill r={r} />
                  </td>
                  {hero ? null : <td className="num c-sum">{sum(r.sum)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Тот же экран на телефоне: плитки, карточки отчётов и нижняя панель из 4 модулей. */
export function PhoneScreen({ t, d, today }: { t: Translate; d: DemoScreens; today: string }) {
  return (
    <div className="lsh lsh-ph">
      <div className="lsh-pt">
        <i />
      </div>
      <div className="lsh-m">
        <div className="lsh-h">{t('land.shot.phone.title')}</div>
        <Plates t={t} d={d} phone />
        {d.rows.slice(0, 4).map((r, i) => (
          <div key={i} className="lsh-cd">
            <b>{r.contractor}</b>
            <span>
              <span>{r.type}</span>
              <Pill r={r} />
            </span>
            <span>
              <span className={r.due < today ? 'red' : ''}>
                {t('land.shot.phone.due', { дата: formatDateRu(r.due) })}
              </span>
              <span>{r.sum != null ? sum(r.sum) : ''}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="lsh-nav">
        <span>{t('land.shot.nav.home')}</span>
        <span className="on">{t('land.shot.nav.reports')}</span>
        <span>{t('land.shot.nav.tasks')}</span>
        <span>{t('land.shot.nav.more')}</span>
      </div>
    </div>
  );
}

/** Карточка контрагента: «Основное» и последние отчёты. */
export function CardScreen({ t, d }: { t: Translate; d: DemoScreens }) {
  const c = d.card;
  if (!c) return null;
  return (
    <div className="lsh lsh-desk">
      <Top url="buhuchet.kg/#cps" />
      <div className="lsh-body">
        <Side t={t} on="cps" />
        <div className="lsh-m">
          <div className="lsh-h">
            {c.name} <span className="lsh-reg">{c.regime}</span>
          </div>
          <div className="lsh-tb">
            <span className="on">{t('land.shot.card.main')}</span>
            <span>{t('land.shot.card.reports')}</span>
            <span>{t('land.shot.card.pick')}</span>
            <span>{t('land.shot.card.money')}</span>
            <span>{t('land.shot.card.fees')}</span>
          </div>
          <div className="lsh-kv">
            <div>
              <small>{t('land.shot.card.inn')}</small>
              <b className="font-mono">{c.inn}</b>
            </div>
            <div>
              <small>{t('land.shot.card.resp')}</small>
              <b>{c.resp || '—'}</b>
            </div>
            <div>
              <small>{t('land.shot.card.head')}</small>
              <b>{c.head || '—'}</b>
            </div>
            <div>
              <small>{t('land.shot.card.start')}</small>
              <b>{c.start ? formatDateRu(c.start) : '—'}</b>
            </div>
          </div>
          <table className="lsh-t">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>{t('land.shot.col.report')}</th>
                <th style={{ width: '20%' }}>{t('land.shot.col.period')}</th>
                <th style={{ width: '24%' }}>{t('land.shot.col.status')}</th>
                <th className="num c-sum" style={{ width: '22%' }}>
                  {t('land.shot.col.sum')}
                </th>
              </tr>
            </thead>
            <tbody>
              {c.reports.map((r, i) => (
                <tr key={i}>
                  <td>{r.type}</td>
                  <td>{r.period}</td>
                  <td>
                    <Pill r={r} />
                  </td>
                  <td className="num c-sum">{sum(r.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
