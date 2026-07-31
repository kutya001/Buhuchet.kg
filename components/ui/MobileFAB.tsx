'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MobileFABProps {
  onClick?: () => void;
  title?: string;
}

export function MobileFAB({ onClick, title = 'Создать' }: MobileFABProps) {
  return (
    <div className="md:hidden fixed bottom-20 right-4 z-50">
      <Button
        onClick={onClick || (() => {})}
        size="icon"
        aria-label={title}
        className="w-13 h-13 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/50 hover:scale-105 active:scale-95 transition-all flex items-center justify-center border-2 border-background"
      >
        <Plus className="w-6 h-6 stroke-[3]" />
      </Button>
    </div>
  );
}
