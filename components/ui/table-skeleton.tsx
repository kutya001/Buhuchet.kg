import React from 'react';

export function TableSkeleton({ rows = 6, title = 'Загрузка данных...' }: { rows?: number; title?: string }) {
  return (
    <div className="w-full space-y-4 p-4 rounded-2xl bg-card/60 border border-border/60 animate-pulse">
      <div className="flex items-center justify-between pb-2 border-b border-border/40">
        <div className="h-5 w-48 bg-muted rounded-lg" />
        <div className="h-8 w-32 bg-muted rounded-lg" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center space-x-4 h-12 bg-muted/40 rounded-xl px-4">
            <div className="h-4 w-1/4 bg-muted/60 rounded" />
            <div className="h-4 w-1/4 bg-muted/60 rounded" />
            <div className="h-4 w-1/4 bg-muted/60 rounded" />
            <div className="h-4 w-1/4 bg-muted/60 rounded" />
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-muted-foreground pt-2">
        <span>{title}</span>
      </div>
    </div>
  );
}
