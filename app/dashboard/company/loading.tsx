import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function CompanyLoading() {
  return (
    <div className="space-y-6 animate-pulse p-2 md:p-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 bg-slate-800/80 rounded-xl" />
        <Skeleton className="h-4 w-80 bg-slate-800/60 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
          <Skeleton className="h-6 w-48 bg-slate-800/80" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full bg-slate-800/40 rounded-xl" />
            ))}
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
          <Skeleton className="h-6 w-36 bg-slate-800/80" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full bg-slate-800/40 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
