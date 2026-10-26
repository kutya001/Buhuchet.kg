import type { ReactNode } from 'react';

/**
 * Каркас рабочей страницы (прототип index.html `.app`, css/shell.css): три «площадки» со скруглёнными
 * углами и тенью на фоне рамки — левая панель модулей во всю высоту окна, справа от неё верхняя панель
 * и под ней рабочая область. Скрытая левая панель — верхняя панель и рабочая область во всю ширину.
 * Уже 768 px левой панели нет (нижняя панель телефона — задача #11). Прокручивается только рабочая
 * область, верхняя панель остаётся на месте.
 */
export function AppFrame({
  navHidden,
  side,
  topBar,
  children,
  paneLabel,
}: {
  navHidden: boolean;
  side: ReactNode;
  topBar: ReactNode;
  children: ReactNode;
  /** Название рабочей области для экранного диктора (текущий модуль). */
  paneLabel?: string;
}) {
  return (
    <div
      data-nav={navHidden ? 'hidden' : 'shown'}
      className="group/app grid h-dvh grid-cols-[276px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-2.5 data-[nav=hidden]:grid-cols-[minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)_auto] max-md:gap-2 max-md:p-2 max-md:pb-[calc(8px+env(safe-area-inset-bottom,0px))]"
    >
      {topBar}
      {side}
      <main
        aria-label={paneLabel}
        className="relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-auto rounded-xl border border-line bg-pane shadow-pane group-data-[nav=hidden]/app:col-start-1 max-md:col-start-1 max-md:rounded-2xl"
      >
        <div className="mx-auto flex max-w-[1640px] min-w-0 flex-col gap-3.5 px-7 pt-[22px] pb-12 max-md:gap-3 max-md:px-4 max-md:pt-4 max-md:pb-[92px]">
          {children}
        </div>
      </main>
    </div>
  );
}
