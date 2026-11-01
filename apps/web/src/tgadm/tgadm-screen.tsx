'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef } from 'react';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { TgAdmBot } from './tgadm-bot';
import { TgAdmCast } from './tgadm-cast';
import { TgAdmLog } from './tgadm-log';

/**
 * Админка → «Телеграм» (прототип admin/telegram.js, renderTg): «Журнал», «Бот платформы», «Рассылка».
 * «+ Добавить» → «Объявление» открывает «Рассылку» (прототип `go('tg','cast')`), на ней — ставит курсор в
 * текст объявления.
 */
export function TgAdmScreen({ tab }: { tab: string }) {
  const { addRequest, clearAddRequest } = useShell();
  const router = useRouter();
  const request = addRequest?.moduleId === 'tg' ? addRequest : null;
  const castText = useRef<HTMLTextAreaElement>(null);
  const start = useEffectEvent((actionId: string) => {
    if (actionId !== 'cast') return;
    if (tab === 'cast') castText.current?.focus();
    else router.push(tabHref('tg', 'cast'));
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);

  if (tab === 'bot') return <TgAdmBot />;
  if (tab === 'cast') return <TgAdmCast textRef={castText} />;
  return <TgAdmLog />;
}
