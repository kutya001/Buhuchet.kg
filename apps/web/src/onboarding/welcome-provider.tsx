'use client';

import type { Feature } from '@buhuchet/domain';
import type { ApplyOnboardingResult, Onboarding } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import { FeatureOnDialog } from '../org/feature-on-dialog';
import { policyQuery, useOrgRefresh } from '../org/org-data';
import type { ShellAccess } from '../shell/modules';
import { markWelcomeSeen, onboardingQuery, postponeOnboarding } from './onboarding-data';
import { WelcomeWindow, type WelcomeOpen } from './welcome-window';

/*
 * Приветствие поверх экрана (задача 2.33): после входа — вместо «Что нового», если приветствие нужно
 * (владельцу новой организации — пока опросник не пройден и не отложен, сотруднику — при самом первом
 * входе); из «Базы знаний» → «Мой уровень» — «Приветствие и обзор модулей»; из учётной политики —
 * «Пройти опросник (заново)». Прототип modules/onboard.js — firstLogin, welcomeOpen.
 */

/** Приветствие открывается чуть позже рабочей страницы (прототип: 350 мс). */
const WELCOME_DELAY_MS = 350;

export interface WelcomeControls {
  /** `again` — «Приветствие и обзор модулей» без опросника; `retake` — «Пройти опросник заново». */
  open: (mode: 'again' | 'retake') => void;
}

export const WelcomeContext = createContext<WelcomeControls>({ open: () => {} });

export function useWelcome(): WelcomeControls {
  return useContext(WelcomeContext);
}

/** Что приветствие берёт у оболочки. */
export interface WelcomeShellInfo {
  access: ShellAccess;
  /** Модули меню вошедшего. */
  modules: readonly string[];
  /** «Осмотреться самому» и «Пропустить» — Главная. */
  homeHref: string;
  /** «Начать обучение» — «База знаний» → «Уроки». */
  lessonsHref: string;
}

export function useWelcomeRuntime(shell: WelcomeShellInfo): {
  controls: WelcomeControls;
  overlays: ReactNode;
  /** Сразу после входа: открыть приветствие, если нужно; true — открыто, «Что нового» не показывать. */
  atLogin: () => Promise<boolean>;
} {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const refreshOrg = useOrgRefresh();
  const [slot, setSlot] = useState<DialogSlot<WelcomeOpen> | null>(null);
  const [featOn, setFeatOn] = useState<DialogSlot<Feature[]> | null>(null);
  const { access } = shell;

  /** Тексты (и учётная политика — у опросника) перед открытием окна. */
  const load = useCallback(
    async (kind: WelcomeOpen['kind'], known?: Onboarding): Promise<WelcomeOpen | null> => {
      const data = known ?? (await client.fetchQuery({ ...onboardingQuery, staleTime: 0 }));
      if (!data.content) return null;
      const policy =
        kind === 'quiz' || kind === 'retake'
          ? await client.fetchQuery({ ...policyQuery, staleTime: 0 })
          : null;
      return { kind, data, content: data.content, policy };
    },
    [client],
  );

  const atLogin = useCallback(async () => {
    if (access.admin) return false;
    try {
      const data = await client.fetchQuery({ ...onboardingQuery, staleTime: 0 });
      if (!data.welcome || !data.content) return false;
      const opened = await load(data.welcome, data);
      if (!opened) return false;
      void markWelcomeSeen().catch(() => {});
      setTimeout(() => setSlot(openSlot(opened)), WELCOME_DELAY_MS);
      return true;
    } catch {
      return false;
    }
  }, [access.admin, client, load]);

  const open = useCallback(
    (mode: 'again' | 'retake') => {
      load(mode)
        .then((opened) => {
          if (opened) setSlot(openSlot(opened));
          else toast(t('onboarding.load_error'), { bad: true });
        })
        .catch(() => toast(t('onboarding.load_error'), { bad: true }));
    },
    [load, toast, t],
  );

  const onboardingChanged = useCallback(
    () => void client.invalidateQueries({ queryKey: onboardingQuery.queryKey }),
    [client],
  );

  // Уведомление — после ответа сервера: ушли со страницы раньше — запрос мог не дойти.
  const postpone = useCallback(
    (withToast: boolean) => {
      postponeOnboarding()
        .then(() => {
          onboardingChanged();
          if (withToast) toast(t('onboarding.later_done'), { icon: 'info' });
        })
        .catch(() => {});
    },
    [onboardingChanged, toast, t],
  );

  const retakeDone = (result: ApplyOnboardingResult) => {
    setSlot(closeSlot);
    if (result.on.length) {
      setFeatOn(openSlot(result.on));
      return;
    }
    const changed = result.off.length > 0 || result.taskConfirm !== null;
    toast(t(changed ? 'onboarding.retake.updated' : 'onboarding.retake.same'), { icon: 'check' });
  };

  const controls = useMemo<WelcomeControls>(() => ({ open }), [open]);

  const overlays = (
    <>
      {slot ? (
        <WelcomeWindow
          key={`welcome-${slot.n}`}
          {...slot.data}
          open={slot.open}
          access={access}
          modules={shell.modules}
          homeHref={shell.homeHref}
          lessonsHref={shell.lessonsHref}
          onPostpone={postpone}
          onApplied={() => {
            onboardingChanged();
            refreshOrg(true);
          }}
          onRetakeDone={retakeDone}
          onClose={() => setSlot(closeSlot)}
        />
      ) : null}
      {featOn ? (
        <FeatureOnDialog
          key={`feat-on-${featOn.n}`}
          features={featOn.data}
          open={featOn.open}
          onClose={() => setFeatOn(closeSlot)}
        />
      ) : null}
    </>
  );
  return { controls, overlays, atLogin };
}
