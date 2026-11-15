'use client';

import { buttonClass, Icon, Modal } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';

/**
 * Итог после отправки на странице контрагента (доработки 15.11.2026, пункты 5.1 и 5.3; прототип v120
 * `cphDone`): вместо короткого уведомления — окно с понятным итогом, что будет дальше, и «Понятно».
 * `show(заголовок, текст)` открывает его, `dialog` — в разметку.
 */
export function useDoneDialog(): {
  show: (title: string, text: string) => void;
  dialog: ReactNode;
} {
  const t = useT();
  const [done, setDone] = useState<{ n: number; title: string; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const show = (title: string, text: string) => {
    setDone((d) => ({ n: (d?.n ?? 0) + 1, title, text }));
    setOpen(true);
  };
  const dialog = done ? (
    <Modal
      key={`pub-done-${done.n}`}
      open={open}
      onClose={() => setOpen(false)}
      title={done.title}
      kind="message"
      noMax
      touch
      footer={
        <button
          type="button"
          data-pub-done-ok=""
          className={`${buttonClass('cta')} max-md:min-h-11`}
          onClick={() => setOpen(false)}
        >
          {t('cph.done.ok')}
        </button>
      }
    >
      <div data-pub-done="" className="flex items-start gap-3">
        <Icon name="ok" className="h-7 w-7 flex-none text-ok" />
        <p className="m-0 text-[15px] leading-[1.55] max-md:text-[16px]">{done.text}</p>
      </div>
    </Modal>
  ) : null;
  return { show, dialog };
}
