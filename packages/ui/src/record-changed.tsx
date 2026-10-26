import type { ReactNode } from 'react';
import { buttonClass } from './button';

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
 * из темы (theme.css).
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
      className="flex items-start gap-[9px] rounded-lg border border-transparent bg-caution-bg px-3 py-[9px] text-[12.5px] leading-[1.45] text-caution-label"
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
        className={buttonClass('default', 'sm')}
      >
        {reloadLabel}
      </button>
    </div>
  );
}
