'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CreditCard, Lock, MessageCircle, ArrowRight, Building2 } from 'lucide-react';

interface SubscriptionExpiredViewProps {
  companyName?: string;
  expiresAt?: string | null;
  moduleName?: string;
}

export function SubscriptionExpiredView({
  companyName,
  expiresAt,
  moduleName = 'данному модулю',
}: SubscriptionExpiredViewProps) {
  const formattedDate = expiresAt ? new Date(expiresAt).toLocaleDateString('ru-RU') : 'ранее';

  return (
    <div className="w-full flex items-center justify-center p-4 min-h-[60vh]">
      <Card className="w-full max-w-xl bg-card border-rose-500/30 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-rose-500 via-amber-500 to-rose-500" />
        
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-4 text-rose-400">
            <Lock className="h-7 w-7" />
          </div>

          <div className="flex items-center justify-center gap-2 mb-2">
            <Badge variant="destructive" className="bg-rose-500/20 text-rose-300 border-rose-500/30 font-semibold text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Подписка приостановлена
            </Badge>
          </div>

          <CardTitle className="text-2xl font-bold text-foreground">
            Срок действия тарифа истек
          </CardTitle>

          <CardDescription className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Доступ к {moduleName} для организации{' '}
            <span className="font-semibold text-foreground">{companyName || 'вашей компании'}</span> временно ограничен (срок подписки завершился {formattedDate}).
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-2 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground flex items-center">
              <Building2 className="h-4 w-4 mr-1.5 text-blue-400" />
              Как возобновить доступ:
            </div>
            <ul className="list-disc list-inside space-y-1 text-foreground/80 pl-1">
              <li>Подайте заявку на продление или смену тарифа в разделе «Подписка»</li>
              <li>После подтверждения суперадминистратором доступ ко всем модулям восстановится автоматически</li>
              <li>Все сохраненные первичные документы, файлы и реестры остаются в полной безопасности</li>
            </ul>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row gap-3 pt-2 pb-8">
          <Button
            asChild
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/25 min-h-[42px]"
          >
            <Link href="/uchet/subscription">
              <CreditCard className="mr-2 h-4 w-4" />
              Перейти к продлению подписки
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            className="w-full sm:w-auto border-border text-xs min-h-[42px]"
          >
            <a href="https://t.me/buhuchet_support_bot" target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 h-4 w-4 text-sky-400" />
              Техподдержка
            </a>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
