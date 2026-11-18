'use client';

import type { PageTipId } from '@buhuchet/domain';
import { Icon, PHONE_QUERY, Popover, iconButtonClass, useMediaQuery } from '@buhuchet/ui';
import { createContext, useContext, type ReactNode } from 'react';

/*
 * Общие части разделов открытой страницы контрагента (прототип v135 modules/cp-page.js: pubSec, pubDet,
 * pubMore, tipI; стили css/pages.css `.pub-*`): раздел со сворачиванием на телефоне, пояснение «?» у
 * заголовка, сворачиваемая строка внутри раздела, «Показать ещё» на телефоне.
 */

/** Пояснения страницы из «Текстов элементов экрана» по обозначениям страницы (PAGE_TIPS). */
export type PageTexts = Readonly<Partial<Record<PageTipId, string>>>;

export const PageTextsContext = createContext<PageTexts>({});

/** Пояснение страницы (прототип `PGT`); нет — пустая строка. */
export function usePageText(): (id: PageTipId) => string {
  const texts = useContext(PageTextsContext);
  return (id) => texts[id] ?? '';
}

/** «?» с пояснением: при наведении на ПК, по нажатию на телефоне (прототип v131 `tipI`). */
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
          data-pub-tip=""
          className={`${iconButtonClass('sm')} -my-1 h-6 w-6 min-w-6 text-current opacity-80`}
        >
          <Icon name="help" size="sm" />
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

/**
 * Порядок разделов на телефоне (прототип v135): «Оплата», «Отчёты», «Файлы», «Связь», «Цифры
 * компании» — один под другим; на ПК — две колонки.
 */
const ORDER: Record<string, string> = {
  pay: 'max-md:order-1',
  reports: 'max-md:order-2',
  files: 'max-md:order-3',
  acc: 'max-md:order-4',
  kpi: 'max-md:order-5',
};

/**
 * Раздел страницы (прототип v135 `pubSec`): заголовок, итог раздела (`sum`), поле заголовка (`extra`),
 * кнопки, видные и в свёрнутом разделе (`act`), пояснение — под «?» у заголовка, а не абзацем. На
 * телефоне раздел, кроме «Оплаты», свёрнут до строки с итогом: заголовок и стрелка — кнопки; на ПК всё
 * раскрыто.
 */
export function PageSection({
  id,
  title,
  what,
  sum,
  extra,
  act,
  fold = true,
  open,
  onToggle,
  flash,
  children,
}: {
  id: string;
  title: string;
  what: string;
  sum?: ReactNode;
  extra?: ReactNode;
  act?: ReactNode;
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
      <span className="flex-none whitespace-nowrap">{title}</span>
      {sum ? (
        <span
          data-pub-sum=""
          className={`min-w-0 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap text-muted md:before:content-['·_'] ${fold ? 'max-md:whitespace-normal' : 'max-md:hidden'}`}
        >
          {sum}
        </span>
      ) : null}
    </>
  );
  return (
    <section
      id={`pub-${id}`}
      data-sec={id}
      data-folded={folded ? '' : undefined}
      className={`flex min-w-0 scroll-mt-3 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5 transition-shadow duration-700 max-md:px-3.5 max-md:py-3 ${ORDER[id] ?? ''} ${flash ? 'shadow-[0_0_0_3px_var(--color-info-bg)]' : ''}`}
    >
      <h3 className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] font-bold text-ink">
        {fold ? (
          <button
            type="button"
            data-pub-toggle={id}
            aria-expanded={!(folded && phone)}
            onClick={phone ? onToggle : undefined}
            className="flex min-w-0 flex-1 cursor-default items-center gap-2 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit max-md:min-h-11 max-md:cursor-pointer max-md:flex-col max-md:items-start max-md:justify-center max-md:gap-px"
          >
            {head}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">{head}</span>
        )}
        {extra ? <span className={folded ? 'max-md:hidden' : ''}>{extra}</span> : null}
        {act ? <span className="flex items-center gap-1.5">{act}</span> : null}
        <PageTip label={title} text={what} />
        {fold ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={onToggle}
            className="hidden h-11 w-8 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-faint max-md:inline-flex"
          >
            <Icon
              name="down"
              size="sm"
              className={`transition-transform motion-reduce:transition-none ${folded ? '' : 'rotate-180'}`}
            />
          </button>
        ) : null}
      </h3>
      <div
        data-pub-body=""
        className={`flex min-w-0 flex-col gap-2.5 ${folded ? 'max-md:hidden' : fold ? 'max-md:animate-slide-up max-md:motion-reduce:animate-none' : ''}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Сворачиваемая строка внутри раздела (прототип v135 `pubDet`): «Из чего сумма», «За год», «История
 * оплат», «Куда переводить» — редкое свёрнуто под одной строкой.
 */
export function PageDet({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-pub-det={id}
      data-open={open ? '' : undefined}
      className="border-t border-dashed border-line"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-1.5 text-left font-[inherit] text-[13.5px] font-semibold text-muted max-md:min-h-11"
      >
        <span>{label}</span>
        <span className="grow" />
        <Icon
          name="down"
          size="sm"
          className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="flex animate-slide-up flex-col gap-2 pb-2.5 motion-reduce:animate-none">
          {children}
        </div>
      ) : null}
    </div>
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

/**
 * Строка списка (прототип `.pub-row`): несданный в срок отчёт — спокойно, без красной рамки (v135:
 * отчёты сдаёт бухгалтер, клиента это не пугает).
 */
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
      data-late={late ? '' : undefined}
      className={`flex min-w-0 flex-col gap-1 rounded-lg border border-line px-3 py-[9px] ${inner ? 'bg-pane-alt' : 'bg-raised'}`}
    >
      {children}
    </div>
  );
}

export const ROW1 = 'flex flex-wrap items-center gap-1.5 text-[14px]';
export const ROW2 =
  'flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted [&_b]:text-ink';

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
      data-late={late ? '' : undefined}
      className="min-w-0 overflow-hidden rounded-xl border border-line bg-raised"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer flex-col items-stretch gap-[5px] border-0 bg-transparent px-3.5 py-[11px] text-left font-[inherit] text-inherit hover:bg-row-hover"
      >
        {head}
      </button>
      {open ? (
        <div className="flex animate-slide-up flex-col gap-2 px-3 pb-3 motion-reduce:animate-none">
          {children}
        </div>
      ) : null}
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
