'use client';

import type { PageTipId } from '@buhuchet/domain';
import {
  Icon,
  PHONE_QUERY,
  Popover,
  iconButtonClass,
  useMediaQuery,
  type IconName,
} from '@buhuchet/ui';
import { createContext, useContext, type ReactNode } from 'react';

/*
 * Общие части разделов открытой страницы контрагента (прототип modules/cp-page.js: pubSec, pubTp,
 * pubMore, tipI; стили css/pages.css `.pub-*`): раздел со сворачиванием на телефоне, пояснение «ⓘ»,
 * метка с пояснением, «Показать ещё» на телефоне.
 */

/** Пояснения страницы из «Текстов элементов экрана» по обозначениям страницы (PAGE_TIPS). */
export type PageTexts = Readonly<Partial<Record<PageTipId, string>>>;

export const PageTextsContext = createContext<PageTexts>({});

/** Пояснение страницы (прототип `PGT`); нет — пустая строка. */
export function usePageText(): (id: PageTipId) => string {
  const texts = useContext(PageTextsContext);
  return (id) => texts[id] ?? '';
}

/** «ⓘ» с пояснением: при наведении на ПК, по нажатию на телефоне (прототип `tipI`). */
export function PageTip({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <Popover
      label={label}
      padded
      hover
      className="relative inline-flex align-middle"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          className={`${iconButtonClass('sm')} -my-1 h-6 w-6 min-w-6 text-current opacity-80`}
        >
          <Icon name="info" size="sm" />
        </button>
      )}
    >
      {() => <span className="block max-w-[300px] text-[12.5px] whitespace-normal">{text}</span>}
    </Popover>
  );
}

/**
 * Метка с пояснением (прототип `pubTp`): цвет дополнен значком и текстом, нажатие на метку открывает
 * пояснение. Без пояснения — просто метка.
 */
export function TipPill({ pill, label, text }: { pill: ReactNode; label: string; text: string }) {
  if (!text) return <>{pill}</>;
  return (
    <Popover
      label={label}
      padded
      hover
      className="relative inline-flex align-middle"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={id}
          className="inline-flex cursor-help items-center gap-[3px] border-0 bg-transparent p-0 font-[inherit] text-faint"
        >
          {pill}
          <Icon name="info" size="sm" />
        </button>
      )}
    >
      {() => <span className="block max-w-[300px] text-[12.5px] whitespace-normal">{text}</span>}
    </Popover>
  );
}

/** Порядок разделов на телефоне (ТЗ «Порядок блоков»): разделы идут один под другим. */
const ORDER: Record<string, string> = {
  main: 'max-md:order-1',
  pay: 'max-md:order-2',
  acc: 'max-md:order-3',
  reports: 'max-md:order-4',
  files: 'max-md:order-5',
  money: 'max-md:order-6',
  fee: 'max-md:order-7',
  kpi: 'max-md:order-8',
  contacts: 'max-md:order-9',
};

/**
 * Раздел страницы (прототип `pubSec`): заголовок со значком, строка «что это», содержимое. На
 * телефоне раздел, кроме «Главного» и «Как оплатить», свёрнут: заголовок — кнопка, в свёрнутом —
 * итог раздела (`sum`); на ПК всё раскрыто.
 */
export function PageSection({
  id,
  icon,
  title,
  what,
  sum,
  extra,
  fold = true,
  open,
  onToggle,
  flash,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  what: string;
  sum?: string;
  extra?: ReactNode;
  fold?: boolean;
  open: boolean;
  onToggle: () => void;
  flash: boolean;
  children: ReactNode;
}) {
  const folded = fold && !open;
  // Сворачивается только на телефоне; на ПК заголовок не переключает раздел (прототип pubClick, pubSec).
  const phone = useMediaQuery(PHONE_QUERY);
  const head = (
    <>
      <Icon name={icon} className="text-accent" />
      <span className="flex-none whitespace-nowrap">{title}</span>
      {sum ? (
        <span
          className={`min-w-0 text-[13px] font-medium text-muted md:hidden ${folded ? 'block whitespace-normal max-md:col-start-2 max-md:row-start-2' : 'hidden'}`}
        >
          {sum}
        </span>
      ) : null}
      <span className="grow max-md:hidden" />
    </>
  );
  return (
    <section
      id={`pub-${id}`}
      data-sec={id}
      data-folded={folded ? '' : undefined}
      className={`flex min-w-0 scroll-mt-3 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5 transition-shadow duration-700 max-md:px-3.5 max-md:py-3 ${ORDER[id] ?? ''} ${flash ? 'shadow-[0_0_0_3px_var(--color-info-bg)]' : ''}`}
    >
      <h3 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink">
        {fold ? (
          <button
            type="button"
            data-pub-toggle={id}
            aria-expanded={!(folded && phone)}
            onClick={phone ? onToggle : undefined}
            className="flex min-w-0 flex-1 cursor-default items-center gap-2 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit max-md:grid max-md:min-h-7 max-md:cursor-pointer max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-x-2 max-md:gap-y-px"
          >
            {head}
            <Icon
              name="down"
              size="sm"
              className={`text-faint transition-transform md:hidden max-md:col-start-3 max-md:row-span-2 max-md:row-start-1 ${folded ? '' : 'rotate-180'}`}
            />
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">{head}</span>
        )}
        {extra ? <span className={folded ? 'max-md:hidden' : ''}>{extra}</span> : null}
      </h3>
      <div
        data-pub-body=""
        className={`flex min-w-0 flex-col gap-2.5 ${folded ? 'max-md:hidden' : ''}`}
      >
        {what ? <p className="m-0 -mt-0.5 text-[13px] leading-[1.45] text-muted">{what}</p> : null}
        {children}
      </div>
    </section>
  );
}

/**
 * Список с «Показать ещё» (прототип `pubMore`): на телефоне — первые 5 строк и кнопка, на ПК —
 * целиком.
 */
export function PageList({
  count,
  all,
  onAll,
  more,
  children,
  className = '',
}: {
  count: number;
  all: boolean;
  onAll: () => void;
  more: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-pub-list=""
      className={`flex min-w-0 flex-col gap-2 ${all ? '' : 'max-md:[&>*:nth-child(n+6):not([data-pub-more])]:hidden'} ${className}`}
    >
      {children}
      {count > 5 && !all ? (
        <button
          type="button"
          data-pub-more=""
          onClick={onAll}
          className="hidden cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 font-[550] text-link max-md:inline-flex"
        >
          <Icon name="down" size="sm" />
          {more}
        </button>
      ) : null}
    </div>
  );
}

/** Строка списка (прототип `.pub-row`): просроченная — с красной рамкой. */
export function PageRow({
  late = false,
  inner = false,
  children,
}: {
  late?: boolean;
  inner?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-pub-row=""
      className={`flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-[9px] ${late ? 'border-danger/45' : 'border-line'} ${inner ? 'bg-pane-alt' : 'bg-raised'}`}
    >
      {children}
    </div>
  );
}

export const ROW1 = 'flex flex-wrap items-center gap-1.5 text-[13.5px]';
export const ROW2 =
  'flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted [&_b]:text-ink';

/** Раскрывающаяся плитка (прототип `.pub-rt`, `.pub-grp`, `.pub-k`): заголовок-кнопка и периоды. */
export function PageFoldTile({
  id,
  late = false,
  open,
  onToggle,
  head,
  children,
}: {
  id: string;
  late?: boolean;
  open: boolean;
  onToggle: () => void;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-pub-tile={id}
      data-open={open ? '' : undefined}
      className={`min-w-0 overflow-hidden rounded-xl border bg-raised ${late ? 'border-danger/45' : 'border-line'}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer flex-col items-stretch gap-[5px] border-0 bg-transparent px-3.5 py-[11px] text-left font-[inherit] text-inherit hover:bg-row-hover"
      >
        {head}
      </button>
      {open ? <div className="flex flex-col gap-2 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

/** Строка заголовка плитки: название, метки и стрелка (`.pub-rt1`). */
export function TileTitle({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {children}
      <span className="grow" />
      <Icon
        name="down"
        size="sm"
        className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </span>
  );
}

/** «просрочено N» красным со значком. */
export function LateMark({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-danger">
      <Icon name="alert" size="sm" />
      {text}
    </span>
  );
}

/**
 * Пары «подпись — значение» (прототип `.kv`): подпись мелко сверху, значение под ней; по сетке не уже
 * 220 px, на телефоне — по два, до 420 px — по одному. Подпись может нести «ⓘ».
 */
export function PageKv({
  items,
}: {
  items: readonly { id: string; label: ReactNode; value: ReactNode; className?: string }[];
}) {
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-[18px] gap-y-3 max-md:grid-cols-2 max-[420px]:grid-cols-1">
      {items.map((item) => (
        <div key={item.id} data-kv={item.id} className="flex min-w-0 flex-col gap-0.5">
          <dt className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-faint">
            {item.label}
          </dt>
          <dd
            className={`m-0 text-[13.5px] tabular-nums [overflow-wrap:anywhere] ${item.className ?? ''}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
