import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function DocumentsLoading() {
  return (
    <div className="space-y-6 animate-pulse p-2 md:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-60 bg-slate-800/80 rounded-xl" />
          <Skeleton className="h-4 w-80 bg-slate-800/60 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-44 bg-blue-600/30 rounded-xl" />
      </div>

      {/* Filters Skeleton */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col md:flex-row gap-4">
        <Skeleton className="h-11 flex-1 bg-slate-800/60 rounded-xl" />
        <Skeleton className="h-11 w-40 bg-slate-800/60 rounded-xl" />
        <Skeleton className="h-11 w-40 bg-slate-800/60 rounded-xl" />
      </div>

      {/* List Skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 5, 6].map((i) => (
          <div key={i} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-48 bg-slate-800/80" />
              <Skeleton className="h-4 w-64 bg-slate-800/50" />
            </div>
            <div className="flex items-center space-x-3 w-full sm:w-auto justify-between">
              <Skeleton className="h-7 w-24 bg-slate-800/80 rounded-full" />
              <Skeleton className="h-9 w-28 bg-slate-800/60 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
