import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function PartnershipsLoading() {
  return (
    <div className="space-y-6 animate-pulse p-2 md:p-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64 bg-slate-800/80 rounded-xl" />
        <Skeleton className="h-4 w-96 bg-slate-800/60 rounded-lg" />
      </div>

      {/* Segmented Control Skeleton */}
      <Skeleton className="h-14 w-full bg-slate-900/60 border border-slate-800 rounded-2xl" />

      {/* Requests Skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <div className="flex justify-between items-center">
              <Skeleton className="h-5 w-44 bg-slate-800/80" />
              <Skeleton className="h-6 w-24 bg-slate-800/60 rounded-full" />
            </div>
            <Skeleton className="h-4 w-32 bg-slate-800/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
