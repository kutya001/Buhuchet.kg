import { Card } from '@/components/ui/card';

export default function CompaniesLoading() {
  return (
    <div className="space-y-6 animate-pulse p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-56 bg-muted/60 rounded-lg" />
          <div className="h-4 w-80 bg-muted/40 rounded-md" />
        </div>
        <div className="h-9 w-36 bg-muted/60 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 bg-card/60 border border-border/60">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-3 w-20 bg-muted/50 rounded" />
                <div className="h-6 w-16 bg-muted/80 rounded" />
              </div>
              <div className="h-10 w-10 bg-muted/50 rounded-xl" />
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5 bg-card/60 border border-border/60 space-y-4">
        <div className="h-10 w-full bg-muted/40 rounded-lg" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-12 w-full bg-muted/30 rounded-lg" />
          ))}
        </div>
      </Card>
    </div>
  );
}
