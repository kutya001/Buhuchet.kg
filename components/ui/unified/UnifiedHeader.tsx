'use client';

import React from 'react';
import Link from 'next/link';
import { Menu, Building2, Bell, User, Search, ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface UnifiedHeaderProps {
  companyName?: string;
  companyInn?: string;
  userName?: string;
  isSuperAdmin?: boolean;
  onOpenMobileMenu?: () => void;
  daysRemaining?: number;
  isExpiringSoon?: boolean;
  isExpired?: boolean;
}

export function UnifiedHeader({
  companyName = 'Организация',
  companyInn,
  userName = 'Пользователь',
  isSuperAdmin = false,
  onOpenMobileMenu,
  daysRemaining,
  isExpiringSoon,
  isExpired,
}: UnifiedHeaderProps) {
  const showWarning = !isSuperAdmin && !isExpired && (isExpiringSoon || (typeof daysRemaining === 'number' && daysRemaining <= 2 && daysRemaining >= 0));

  return (
    <div className="sticky top-0 z-30 w-full">
      {/* ПРЕДУПРЕЖДАЮЩИЙ БАННЕР О СКОРОМ ИСТЕЧЕНИИ ПОДПИСКИ */}
      {showWarning && (
        <div className="w-full bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600 text-white px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 shadow-md">
          <div className="flex items-center space-x-2 font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 animate-pulse text-amber-200" />
            <span>
              Срок действия подписки истекает {daysRemaining === 0 ? 'сегодня' : `через ${daysRemaining} дн.`}. Подайте заявку на продление, чтобы сохранить доступ к модулям.
            </span>
          </div>

          <Link
            href="/uchet/subscription"
            className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold transition-all text-[11px] shadow-sm ml-auto"
          >
            <span>Продлить тариф</span>
            <ArrowRight className="h-3 w-3 ml-1" />
          </Link>
        </div>
      )}

      <header className="w-full bg-card/90 backdrop-blur-md border-b border-border min-h-[64px] flex items-center px-4 md:px-6 justify-between shadow-md">
        {/* Левая часть: кнопка мобильного меню + Индикатор текущей организации */}
        <div className="flex items-center space-x-3 truncate">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenMobileMenu}
            className="md:hidden h-11 w-11 p-0 text-foreground hover:bg-muted"
          >
            <Menu className="h-6 w-6" />
          </Button>

          <div className="flex items-center space-x-2.5 bg-background/60 p-1.5 px-3 rounded-xl border border-border truncate">
            <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <div className="truncate text-xs">
              <span className="font-bold text-foreground truncate block">{companyName}</span>
              {companyInn && <span className="text-[10px] text-muted-foreground font-mono">ИНН: {companyInn}</span>}
            </div>
          </div>
        </div>

        {/* Правая часть: Уведомления + Профиль пользователя */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {isSuperAdmin && (
            <Badge className="hidden sm:inline-flex bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px]">
              <ShieldCheck className="h-3 w-3 mr-1" />
              Суперадмин
            </Badge>
          )}

          <Link href={isSuperAdmin ? '/admin/profile' : '/uchet/profile'}>
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-muted min-h-[40px] px-3 rounded-xl flex items-center space-x-2"
            >
              <div className="h-6 w-6 rounded-full bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center">
                {userName.substring(0, 1).toUpperCase()}
              </div>
              <span className="hidden sm:inline text-xs font-semibold max-w-[120px] truncate">{userName}</span>
            </Button>
          </Link>
        </div>
      </header>
    </div>
  );
}

