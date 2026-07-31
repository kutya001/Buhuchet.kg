'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MobileFABProps {
  onClick?: () => void;
  title?: string;
  hasBottomNav?: boolean;
}

export function MobileFAB({ onClick, title = 'Создать', hasBottomNav = true }: MobileFABProps) {
  // Если на мобилке уже отображается нижняя панель навигации с кнопкой +, не дублируем второй плюс
  if (hasBottomNav) {
    return null;
  }

  return (
    <div className="md:hidden fixed bottom-6 right-5 z-50">
      <Button
        onClick={onClick || (() => {})}
        size="icon"
        aria-label={title}
        className="w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/40 hover:scale-105 active:scale-95 transition-all flex items-center justify-center border-2 border-background"
      >
        <Plus className="w-7 h-7 stroke-[2.5]" />
      </Button>
    </div>
  );
}
