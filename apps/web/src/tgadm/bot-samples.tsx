'use client';

import {
  bishkekTime,
  BOT_TEST_ACTION,
  botTemplate,
  botTestMessage,
  codeBotMessage,
  fillTemplate,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import { buttonClass, CheckRow, Hint, Modal, Note } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../l10n/provider';
import { pdictsTemplatesQuery } from '../platform-dicts/pdicts-data';
import { BotChat, pressChatButton, type BotChatItem } from './bot-chat';

/** Код в примере сообщения с кодом (как в прототипе `tgSamplesDlg`). */
const SAMPLE_CODE = '482913';
const SAMPLE_CODE_AT = '09:12';

/**
 * «Показать примеры сообщений» (Админка → «Телеграм» → «Бот платформы»; прототип `tgSamplesDlg`,
 * `tgBotDlg`): код подтверждения с копированием и сообщение с таблицей и кнопкой — текстами шаблонов
 * «Справочников платформы», в виде с таблицами и простым текстом. `rich` — «Таблицы…» платформы:
 * выключены — пример сразу простым текстом.
 */
export function BotSamplesDialog({
  open,
  rich,
  onClose,
}: {
  open: boolean;
  rich: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={t('tgadm.samples.title')}
      sub={t('tgadm.samples.sub')}
      footer={
        <button type="button" className={buttonClass('cta')} onClick={onClose}>
          {t('btn.done')}
        </button>
      }
    >
      {open ? <Samples rich={rich} /> : null}
    </Modal>
  );
}

function Samples({ rich }: { rich: boolean }) {
  const t = useT();
  const templates = useQuery(pdictsTemplatesQuery);
  const [plain, setPlain] = useState(!rich);
  const [now] = useState(() => bishkekTime(new Date()));
  const [pressed, setPressed] = useState<readonly BotChatItem[] | null>(null);

  // Тексты — шаблоны «Справочников платформы»; пока их нет (или нет обязательной подстановки) —
  // тексты по умолчанию, как у бота.
  const text = (key: TelegramTemplateKey, values: Record<string, string> = {}) =>
    fillTemplate(botTemplate(key, templates.data?.find((x) => x.key === key)?.text), values);
  const initial: readonly BotChatItem[] = [
    { kind: 'day', text: t('tgadm.chat.today') },
    {
      kind: 'message',
      at: SAMPLE_CODE_AT,
      message: codeBotMessage(
        text('tgCode', { код: SAMPLE_CODE }),
        SAMPLE_CODE,
        text('tgBtnCopyCode'),
      ),
    },
    { kind: 'message', at: now, message: botTestMessage(text('tgTest'), text('tgBtnTest')) },
  ];
  const list = pressed ?? initial;

  return (
    <>
      <CheckRow
        plain
        checked={plain}
        onChange={setPlain}
        label={t('tgadm.chat.plain')}
        data-chat-plain=""
      >
        <Hint>{t(rich ? 'tgadm.chat.plain_hint' : 'tgadm.chat.plain_hint_all')}</Hint>
      </CheckRow>
      <BotChat
        who="Buhuchet.kg"
        list={list}
        plain={plain}
        onPress={(index, button) =>
          setPressed(
            pressChatButton(list, index, button, {
              [BOT_TEST_ACTION]: () => ({ reply: text('tgTestOk') }),
            }),
          )
        }
      />
      <Note icon="info">{t('tgadm.chat.note')}</Note>
    </>
  );
}
