import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse p-2 md:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 bg-slate-800/80 rounded-xl" />
          <Skeleton className="h-4 w-96 bg-slate-800/60 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-40 bg-blue-600/30 rounded-xl" />
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <div className="flex justify-between items-center">
              <Skeleton className="h-4 w-28 bg-slate-800/60" />
              <Skeleton className="h-9 w-9 rounded-xl bg-slate-800/80" />
            </div>
            <Skeleton className="h-8 w-16 bg-slate-700/80 rounded-lg" />
            <Skeleton className="h-3 w-36 bg-slate-800/50" />
          </div>
        ))}
      </div>

      {/* Main Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
          <Skeleton className="h-6 w-48 bg-slate-800/80" />
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full bg-slate-800/40 rounded-xl" />
          ))}
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
          <Skeleton className="h-6 w-40 bg-slate-800/80" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full bg-slate-800/40 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
