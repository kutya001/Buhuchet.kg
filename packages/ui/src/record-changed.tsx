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
 * перечитывает запись и при необходимости правит снова. Вид — как в прототипе: `.note.warn` со значком
 * `alert`, текст `.grow` и кнопка `.btn.sm` (spec/prototype/src/css/cards.css, controls.css). Цвета —
 * токены темы прототипа (`--orange`, `--btn` …) с их значениями по умолчанию, пока оболочка (#10) их
 * не задала.
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
      className="flex items-start gap-[9px] rounded-lg border border-transparent bg-[color:var(--orange-bg,hsla(21,81%,59%,0.16))] px-3 py-[9px] text-[12.5px] leading-[1.45] text-[color:var(--orange,hsl(18,69%,42%))] dark:bg-[color:var(--orange-bg,hsla(24,84%,50%,0.17))] dark:text-[color:var(--orange,hsl(26,85%,62%))]"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="mt-px h-4 w-4 flex-none fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <span className="min-w-0 grow">{message}</span>
      <button
        type="button"
        onClick={onReload}
        disabled={reloading}
        aria-busy={reloading}
        className="inline-flex min-h-[29px] cursor-pointer items-center rounded-lg bg-[color:var(--btn,hsl(35,37%,93%))] px-[10px] py-1 text-[12.5px] font-[550] whitespace-nowrap text-[color:var(--text,hsl(31,45%,24%))] shadow-[var(--sh-btn,inset_0_0_0_1px_rgba(0,0,0,.1),0_2px_4px_-2.7px_rgba(0,0,0,.1))] hover:bg-[color:var(--btn-hover,hsl(36,38%,96%))] disabled:cursor-default disabled:opacity-60 dark:bg-[color:var(--btn,hsl(29,16%,13%))] dark:text-[color:var(--text,hsl(34,39%,76%))] dark:hover:bg-[color:var(--btn-hover,hsl(30,18%,15%))]"
      >
        {reloadLabel}
      </button>
    </div>
  );
}
