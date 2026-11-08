'use client';

import { buttonClass, inputClass, Modal, useToast } from '@buhuchet/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../l10n/provider';

/**
 * «Скопировать ссылку» видео (прототип `copyText`): ссылка — в буфер обмена и сообщение; браузер не дал
 * записать — окно «Скопируйте данные» с выделенным текстом, его копируют сами.
 */
export function useCopyText() {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const copy = useCallback(
    async (value: string, okMsg: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast(okMsg, { icon: 'link' });
      } catch {
        setText(value);
      }
    },
    [toast],
  );
  const node = <CopyFallback text={text} onClose={() => setText(null)} />;
  return { copy, node };
}

function CopyFallback({ text, onClose }: { text: string | null; onClose: () => void }) {
  const t = useT();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (text === null) return;
    area.current?.focus();
    area.current?.select();
  }, [text]);
  return (
    <Modal
      open={text !== null}
      onClose={onClose}
      kind="message"
      title={t('video.copy.fb_title')}
      sub={t('video.copy.fb_sub')}
      footer={
        <button type="button" className={buttonClass('cta')} onClick={onClose}>
          {t('btn.done')}
        </button>
      }
    >
      <textarea
        ref={area}
        className={`${inputClass()} font-mono min-h-[260px]`}
        readOnly
        value={text ?? ''}
      />
    </Modal>
  );
}
