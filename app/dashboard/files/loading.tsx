import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function FilesLoading() {
  return (
    <div className="space-y-6 animate-pulse p-2 md:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56 bg-slate-800/80 rounded-xl" />
          <Skeleton className="h-4 w-72 bg-slate-800/60 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-48 bg-emerald-600/30 rounded-xl" />
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-10 w-10 bg-slate-800/80 rounded-xl" />
              <Skeleton className="h-6 w-16 bg-slate-800/60 rounded-full" />
            </div>
            <Skeleton className="h-5 w-36 bg-slate-800/80" />
            <Skeleton className="h-3 w-28 bg-slate-800/50" />
            <Skeleton className="h-10 w-full bg-slate-800/60 rounded-xl mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
