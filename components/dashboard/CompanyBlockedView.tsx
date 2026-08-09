'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { AlertCircle, ShieldAlert, Phone, Mail, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/app/(auth)/actions';

interface CompanyBlockedViewProps {
  companyName?: string;
  companyInn?: string;
  moderationComment?: string | null;
}

export function CompanyBlockedView({
  companyName,
  companyInn,
  moderationComment,
}: CompanyBlockedViewProps) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 relative overflow-hidden">
      {/* Декоративное сияние */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />

      <Card className="max-w-xl w-full bg-card/90 border-rose-500/30 text-card-foreground shadow-2xl backdrop-blur-xl relative z-10">
        <CardHeader className="text-center pb-2 pt-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 mb-4 animate-pulse">
            <ShieldAlert className="h-8 w-8 stroke-[2.2]" />
          </div>
          <CardTitle className="text-xl md:text-2xl font-bold tracking-tight text-card-foreground">
            Организация заблокирована
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-1">
            Доступ к функциям платформы для вашей компании временно приостановлен Суперадминистратором.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4 text-xs">
          {/* Информация о компании */}
          <div className="p-4 rounded-xl bg-background/80 border border-border space-y-1">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">Блокированная организация</span>
            <p className="font-bold text-sm text-foreground">{companyName || 'Моя Организация'}</p>
            {companyInn && <p className="text-[11px] font-mono text-muted-foreground">ИНН: {companyInn}</p>}
          </div>

          {/* Причина блокировки */}
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-1.5">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider font-mono flex items-center">
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              Причина блокировки
            </span>
            <p className="text-rose-200 text-xs leading-relaxed font-medium">
              {moderationComment && moderationComment.trim().length > 0
                ? moderationComment
                : 'Нарушение регламента использования платформы или неоплата подписки.'}
            </p>
          </div>

          {/* Контакты поддержки */}
          <div className="p-4 rounded-xl bg-background/60 border border-border space-y-2 text-muted-foreground">
            <p className="font-semibold text-foreground">Для восстановления доступа и разблокировки:</p>
            <div className="flex flex-col sm:flex-row gap-2 pt-1 text-[11px]">
              <span className="flex items-center text-muted-foreground">
                <Mail className="h-3.5 w-3.5 mr-1 text-blue-400" />
                support@buhuchet.kg
              </span>
              <span className="flex items-center text-muted-foreground sm:ml-4">
                <Phone className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                +996 (555) 00-11-22
              </span>
            </div>
          </div>

          <form action={signOutAction} className="pt-2">
            <Button
              type="submit"
              variant="outline"
              className="w-full border-border text-muted-foreground hover:text-foreground hover:bg-muted text-xs min-h-[44px] rounded-xl font-bold"
            >
              <Lock className="h-4 w-4 mr-2 text-muted-foreground" />
              Выйти из системы
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
