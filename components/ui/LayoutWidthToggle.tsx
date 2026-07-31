'use client';

import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LayoutWidthToggleProps {
  isFullWidth: boolean;
  onToggle: (full: boolean) => void;
}

export function LayoutWidthToggle({ isFullWidth, onToggle }: LayoutWidthToggleProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onToggle(!isFullWidth)}
      className="h-8 gap-2 border-border/80 text-xs font-semibold rounded-xl"
      title={isFullWidth ? 'Сжать контент по центру' : 'Растянуть контент на весь экран'}
    >
      {isFullWidth ? (
        <>
          <Minimize2 className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">По центру</span>
        </>
      ) : (
        <>
          <Maximize2 className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">На всю ширину</span>
        </>
      )}
    </Button>
  );
}
