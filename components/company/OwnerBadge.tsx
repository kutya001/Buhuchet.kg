'use client';

import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, Lock } from 'lucide-react';

interface OwnerBadgeProps {
  isOwner: boolean;
}

export function OwnerBadge({ isOwner }: OwnerBadgeProps) {
  if (isOwner) {
    return (
      <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 rounded-2xl p-3 sm:p-4">
        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
        <AlertDescription className="text-xs sm:text-sm font-medium leading-normal ml-2">
          Вы являетесь <strong>Владельцем организации</strong>. Вам полностью доступны редактирование юридических реквизитов и управление настройками закрытых периодов.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-400 rounded-2xl p-3 sm:p-4">
      <Lock className="h-5 w-5 text-amber-400 shrink-0" />
      <AlertDescription className="text-xs sm:text-sm font-medium leading-normal ml-2">
        <strong>Режим просмотра профиля.</strong> Изменение реквизитов и настроек компании доступно исключительно Руководителю (Владельцу) организации.
      </AlertDescription>
    </Alert>
  );
}
