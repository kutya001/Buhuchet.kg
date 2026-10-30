'use client';

import { scaleTextKey, type UiTextKey } from '@buhuchet/domain';
import {
  buttonClass,
  Card,
  ConfirmDialog,
  Icon,
  Modal,
  RollbackDialog,
  StatusHistory,
  StatusHistoryDetails,
  StatusMini,
  StatusMiniNone,
  StatusNone,
  StatusPill,
  StatusScale,
  StatusScales,
  useToast,
  type MaxPrefs,
} from '@buhuchet/ui';
import type { FileSource } from '@buhuchet/shared';
import { useState } from 'react';
import { RecordFiles } from '../files/record-files';
import { useT } from '../l10n/provider';
import { QueryProvider } from '../query';
import type { Translate } from '../l10n/translate';
import { UiProviders } from '../shell/ui-providers';
import {
  confirmMarkLabel,
  historyLabels,
  historyView,
  miniView,
  rollbackLabels,
  rollbackTitle,
  scaleView,
  statusName,
  type ScaleView,
} from '../status/status-view';
import { ReportPickSamples } from './report-pick-samples';
import {
  buildSamples,
  moveSample,
  rollbackFrom,
  rollbackSample,
  sampleBack,
  sampleNext,
  type Sample,
  type SampleId,
  type SampleScale,
} from './status-samples-data';

interface StatusSamplesProps {
  /** Краткое ФИО вошедшего — автор переходов и откатов в демо-истории. */
  actor: string;
  /** Есть ли у вошедшего право «Откат статусов» (на странице его можно выключить и включить). */
  canRollback: boolean;
  /** Показать блок «Файлы»: право «Просматривать файлы» и функция «Файлы в карточках» включена. */
  showFiles: boolean;
  /** Показать окна «Подбор отчётов» и «Льготы и особые статусы»: право «Просматривать контрагентов». */
  showPick: boolean;
  /** Контрагент вкладки «Подбор отчётов» из адреса страницы (`?cp=`). */
  cp: string | null;
  initialMax: MaxPrefs;
  /** Момент показа страницы на сервере (мс): от него отсчитана демо-история. */
  now: number;
}

/**
 * Страница образцов общих компонентов (задача #17; на рабочем сайте её нет): шкалы статусов всех
 * видов на демо-записях — компактные в плитках, полные и «История статусов» в карточке записи,
 * переход на следующий шаг и откат с причиной (ничего не сохраняется); блок «Файлы» записи (задача
 * 2.04) — на общих файлах организации, файлы сохраняются по-настоящему; окна «Подбор отчётов» и
 * «Льготы и особые статусы» (задача 2.07).
 */
export function StatusSamples({ initialMax, ...props }: StatusSamplesProps) {
  return (
    <QueryProvider>
      <UiProviders initialMax={initialMax}>
        <SamplesPage {...props} />
      </UiProviders>
    </QueryProvider>
  );
}

/** Общие файлы организации — запись без номера («Загружен вручную»). */
const ORG_FILES: FileSource = { kind: 'manual', id: null };

/** Момент действия (из обработчиков нажатий): часы устройства, но не раньше прошлой записи истории. */
const actionTime = (after: number) => Math.max(Date.now(), after);

/** Окно над карточкой: какая шкала карточки и в какой статус; `open` — окно показано. */
type StepTarget = { index: number; to: string; open: boolean };

function SamplesPage({
  actor,
  canRollback,
  showFiles,
  showPick,
  cp,
  now: serverNow,
}: Omit<StatusSamplesProps, 'initialMax'>) {
  const t = useT();
  const toast = useToast();
  const [samples, setSamples] = useState(() => buildSamples(t, serverNow, actor));
  const [now, setNow] = useState(serverNow);
  const [right, setRight] = useState(canRollback);
  const [card, setCard] = useState<{ id: SampleId; open: boolean } | null>(null);
  const [move, setMove] = useState<StepTarget | null>(null);
  const [back, setBack] = useState<StepTarget | null>(null);
  const sample = card ? samples.find((s) => s.id === card.id)! : null;

  const change = (index: number, apply: (s: SampleScale, at: Date) => SampleScale) => {
    if (!sample) return;
    const at = actionTime(now);
    setNow(at);
    setSamples((list) =>
      list.map((s) =>
        s.id === sample.id
          ? { ...s, scales: s.scales.map((x, i) => (i === index ? apply(x, new Date(at)) : x)) }
          : s,
      ),
    );
  };
  const moveScale = move && sample ? sample.scales[move.index]! : null;
  const backScale = back && sample ? sample.scales[back.index]! : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 px-4 py-6 max-md:py-4">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-xl font-bold">{t('samples.title')}</h1>
        <p className="m-0 text-[13px] text-muted">{t('samples.hint')}</p>
      </header>
      <Card title={t('samples.status_title')}>
        <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            data-rollback-right=""
            className="m-0 h-4 w-4 flex-none cursor-pointer accent-accent"
            checked={right}
            onChange={(e) => setRight(e.target.checked)}
          />
          {t('samples.right')}
        </label>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5 p-0 max-md:grid-cols-1">
          {samples.map((s) => (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                data-sample={s.id}
                title={t('samples.open')}
                className="flex w-full min-w-0 flex-col items-start gap-1.5 rounded-lg border border-line bg-raised p-3 text-left hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={() => setCard({ id: s.id, open: true })}
              >
                <span className="text-[13px] font-semibold">{t(s.title)}</span>
                {s.scales.map((x) => (
                  <Mini key={x.scale} t={t} scale={x} now={now} />
                ))}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {showFiles ? (
        <Card title={t('samples.files_title')}>
          <p className="mt-0 mb-3 text-[13px] text-muted">{t('samples.files_hint')}</p>
          <div data-sample-files="">
            <RecordFiles source={ORG_FILES} />
          </div>
        </Card>
      ) : null}

      {showPick ? <ReportPickSamples initialCp={cp} /> : null}

      {sample ? (
        <Modal
          open={card!.open}
          onClose={() => setCard({ id: sample.id, open: false })}
          kind="card"
          size="mid"
          title={t(sample.title)}
          sub={t('samples.status_title')}
          footer={rollbackButtons(t, sample, right, setBack)}
        >
          <div className="flex flex-col gap-4" data-sample-card={sample.id}>
            <StatusScales>
              {sample.scales.map((s, index) => {
                const to = sampleBack(s, right);
                return (
                  <ScaleBlock
                    key={s.scale}
                    view={scaleView(t, {
                      scale: s.scale,
                      status: s.status,
                      history: s.history,
                      confirm: !!s.confirm,
                      mark: s.mark ?? null,
                      markLabel: s.mark
                        ? confirmMarkLabel(t, s.history, s.mark, new Date(now))
                        : null,
                      next: sampleNext(s),
                      back: to,
                      ...blockedStep(t, sample, s),
                    })}
                    onStep={(next) => setMove({ index, to: next, open: true })}
                    onBack={(step) => setBack({ index, to: step, open: true })}
                    onUndo={to ? () => setBack({ index, to, open: true }) : undefined}
                  />
                );
              })}
            </StatusScales>
            <HistoryBlock t={t} sample={sample} now={now} />
          </div>
        </Modal>
      ) : null}

      {move && moveScale ? (
        <ConfirmDialog
          open={move.open}
          onClose={() => setMove({ ...move, open: false })}
          title={t('samples.move_title', { name: statusName(t, moveScale.scale, move.to) })}
          text={t('samples.move_text')}
          ok={t('samples.move_ok')}
          onConfirm={() => {
            change(move.index, (s, at) => moveSample(s, move.to, at, actor));
            toast(t('samples.moved', { name: statusName(t, moveScale.scale, move.to) }));
          }}
        />
      ) : null}

      {back && backScale && sample ? (
        <RollbackDialog
          open={back.open}
          onClose={() => setBack({ ...back, open: false })}
          title={
            isUnconfirm(backScale, back.to)
              ? t('status.unconfirm_title')
              : rollbackTitle(t, backScale.scale, rollbackFrom(backScale, back.to), back.to)
          }
          sub={t(sample.title)}
          consequences={t(
            isUnconfirm(backScale, back.to)
              ? 'status.unconfirm_effect'
              : (`status.rollback_effect.${backScale.scale}` satisfies UiTextKey),
          )}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => {
            change(back.index, (s, at) => rollbackSample(s, back.to, reason, at, actor));
            setBack({ ...back, open: false });
            toast(t('status.rollback_done'), { icon: 'history' });
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * Образец закрытого шага: у отчёта с налогом к уплате «Сдан» — только после отметки оплаты (так модуль
 * «Отчёты» передаёт причину шкале).
 */
function blockedStep(t: Translate, sample: Sample, s: SampleScale) {
  const payment = sample.scales.find((x) => x.scale === 'payment');
  if (s.scale !== 'report' || !payment || payment.status !== 'unpaid') return {};
  if (!sampleNext(s).includes('submitted')) return {};
  const why = t('samples.blocked_pay');
  return {
    blocked: { submitted: why },
    hints: [t('status.step_blocked', { name: statusName(t, 'report', 'submitted'), why })],
  };
}

/** Снять подтверждение сдачи — свой заголовок, пункт и последствия (прототип `rollbackDlg`). */
const isUnconfirm = (s: SampleScale, to: string) => s.scale === 'report' && to === 'waiting';

/**
 * «История статусов» карточки: по шкале на запись; у контрагента (обслуживание) — свёрнутая строкой,
 * как в его карточке (прототип `.sh-d`).
 */
function HistoryBlock({ t, sample, now }: { t: Translate; sample: Sample; now: number }) {
  const blocks = sample.scales.map((s) => {
    const view = historyView(t, s.scale, s.history, new Date(now));
    return (
      <StatusHistory
        key={s.scale}
        rows={view.rows}
        totals={view.totals}
        title={sample.scales.length > 1 ? t(scaleTextKey(s.scale)) : undefined}
        labels={historyLabels(t)}
      />
    );
  });
  if (sample.id === 'service')
    return <StatusHistoryDetails title={t('status.history')}>{blocks}</StatusHistoryDetails>;
  return (
    <section className="flex min-w-0 flex-col">
      <h3 className="mt-0 mb-2 text-[13px] font-semibold text-muted">{t('status.history')}</h3>
      {blocks}
    </section>
  );
}

function Mini({ t, scale, now }: { t: Translate; scale: SampleScale; now: number }) {
  const view = miniView(t, {
    scale: scale.scale,
    status: scale.status,
    history: scale.history,
    confirm: !!scale.confirm,
    mark: scale.mark ?? null,
    markLabel: scale.mark ? confirmMarkLabel(t, scale.history, scale.mark, new Date(now)) : null,
  });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}

function ScaleBlock({
  view,
  onStep,
  onBack,
  onUndo,
}: {
  view: ScaleView;
  onStep: (to: string) => void;
  onBack: (to: string) => void;
  /** «Снять «Не требуется»» — откат статуса без шкалы. */
  onUndo?: (() => void) | undefined;
}) {
  if (view.kind === 'none') {
    return (
      <StatusNone
        title={view.title}
        text={view.text}
        since={view.since}
        undo={view.undo && onUndo ? { label: view.undo, onClick: onUndo } : null}
      />
    );
  }
  if (view.kind === 'pill') return <StatusPill {...view.pill} />;
  return <StatusScale {...view.props} onStep={onStep} onBack={onBack} />;
}

/**
 * Кнопки отката в карточке (как пункт «Откатить в «…»» меню записи): без права «Откат статусов» видны,
 * но недоступны, с подсказкой, какое право нужно (ТЗ «Откат статуса»).
 */
function rollbackButtons(
  t: Translate,
  sample: Sample,
  right: boolean,
  onBack: (target: StepTarget) => void,
) {
  const buttons = sample.scales.flatMap((s, index) => {
    const to = sampleBack(s, true);
    if (!to) return [];
    return [
      <button
        key={index}
        type="button"
        className={`${buttonClass('default')} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none`}
        data-rollback-to={to}
        {...(right
          ? { onClick: () => onBack({ index, to, open: true }) }
          : { 'aria-disabled': true, title: t('status.need_rollback_right') })}
      >
        <Icon name="history" size="sm" />
        {isUnconfirm(s, to)
          ? t('status.unconfirm')
          : t('status.rollback_to', { name: statusName(t, s.scale, to) })}
      </button>,
    ];
  });
  return buttons.length > 0 ? <>{buttons}</> : undefined;
}
