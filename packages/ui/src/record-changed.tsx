import type { ReactNode } from 'react';

export interface RecordChangedNoticeProps {
  /** «Запись изменена другим пользователем» — из словаря. */
  message: ReactNode;
  /** Подпись кнопки, например «Перечитать». */
  reloadLabel: string;
  /** Перечитать запись из API; несохранённая правка пользователя пропадает. */
  onReload: () => void;
  /** Запись перечитывается — кнопка неактивна. */
  reloading?: boolean;
}

/**
 * Предупреждение при ответе API 409 `record_changed` (ТЗ «Общие правила для всей платформы»): пока
 * пользователь правил запись, её сохранил кто-то другой. Правка не сохранена; пользователь
 * перечитывает запись и при необходимости правит снова. Вид — `.note.warn` прототипа
 * (spec/prototype/src/css/cards.css), значок — `alert`.
 */
export function RecordChangedNotice({
  message,
  reloadLabel,
  onReload,
  reloading = false,
}: RecordChangedNoticeProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-[9px] rounded-lg bg-[hsla(21,81%,59%,0.16)] px-3 py-[9px] text-[12.5px] leading-[1.45] text-[hsl(18,69%,42%)] dark:bg-[hsla(24,84%,50%,0.17)] dark:text-[hsl(26,85%,62%)]"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4 flex-none fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onReload}
        disabled={reloading}
        aria-busy={reloading}
        className="inline-flex min-h-[33px] cursor-pointer items-center rounded-lg border border-current px-[13px] text-[13px] font-[550] whitespace-nowrap disabled:cursor-default disabled:opacity-60"
      >
        {reloadLabel}
      </button>
    </div>
  );
}
