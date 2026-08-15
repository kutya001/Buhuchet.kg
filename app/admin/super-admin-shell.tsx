'use client';

import React, { useState } from 'react';
import { UnifiedSidebar } from '@/components/ui/unified/UnifiedSidebar';
import { UnifiedHeader } from '@/components/ui/unified/UnifiedHeader';
import { UnifiedBottomNav } from '@/components/ui/unified/UnifiedBottomNav';

export interface SuperAdminShellProps {
  userName?: string;
  children: React.ReactNode;
}

export function SuperAdminShell({
  userName = 'Суперадминистратор',
  children,
}: SuperAdminShellProps) {
  const [isOpenMobile, setIsOpenMobile] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground antialiased w-full overflow-x-hidden flex flex-col md:flex-row">
      {/* 1. БОКОВОЕ МЕНЮ СУПЕРАДМИНИСТРАТОРА */}
      <UnifiedSidebar
        userRole="owner"
        isSuperAdmin={true}
        companyName="Панель Управления"
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
      />

      {/* 2. ОСНОВНАЯ РАБОЧАЯ ОБЛАСТЬ */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-64 transition-all duration-300">
        <UnifiedHeader
          companyName="Суперадминистрирование"
          userName={userName}
          isSuperAdmin={true}
          onOpenMobileMenu={() => setIsOpenMobile(true)}
        />

        <main className="flex-1 p-4 md:p-6 w-full">
          {children}
        </main>
      </div>

      {/* 3. НИЖНЯЯ НАВИГАЦИЯ ДЛЯ МОБИЛЬНЫХ УСТРОЙСТВ */}
      <UnifiedBottomNav />
    </div>
  );
}
