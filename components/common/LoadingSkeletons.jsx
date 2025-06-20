import { Skeleton } from "@/components/ui/skeleton";

// Dashboard skeleton for better CLS scores
export function DashboardSkeleton() {
  return (
    <div className="w-full min-h-screen flex flex-col gap-4 bg-background p-4">
      {/* Top bar skeleton */}
      <div className="mb-2 flex gap-2 items-center justify-end bg-white/80 rounded-lg shadow-sm px-4 py-2 border">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-6 w-20" />
      </div>

      <div className="flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Main content skeleton */}
        <div className="bg-white rounded-lg border flex-1">
          {/* Header */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between bg-zinc-50 border-b p-4">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-9 w-40" />
          </div>

          {/* Content */}
          <div className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Calendar skeleton */}
              <div className="lg:col-span-1">
                <Skeleton className="h-80 w-full rounded-lg" />
              </div>

              {/* Table skeleton */}
              <div className="lg:col-span-2 space-y-3">
                {/* Desktop table */}
                <div className="hidden sm:block">
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                </div>

                {/* Mobile cards */}
                <div className="block sm:hidden space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-2/3" />
                      <div className="flex gap-2 mt-2">
                        <Skeleton className="h-8 flex-1" />
                        <Skeleton className="h-8 flex-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Services skeleton for homepage
export function ServicesSkeleton() {
  return (
    <div className="min-h-[200px] py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header skeleton */}
        <div className="text-center mb-12">
          <Skeleton className="h-8 w-64 mx-auto mb-4" />
          <Skeleton className="h-4 w-96 mx-auto" />
        </div>

        {/* Services grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-6 space-y-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Booking skeleton
export function BookingSkeleton() {
  return (
    <div className="min-h-[300px] py-12 px-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Skeleton className="h-8 w-48 mx-auto mb-4" />
          <Skeleton className="h-4 w-80 mx-auto" />
        </div>

        {/* Form skeleton */}
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="mt-6 flex justify-center">
            <Skeleton className="h-12 w-40" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Newsletter skeleton
export function NewsletterSkeleton() {
  return (
    <div className="min-h-[150px] py-12 px-4 bg-white">
      <div className="max-w-md mx-auto text-center space-y-4">
        <Skeleton className="h-6 w-48 mx-auto" />
        <Skeleton className="h-4 w-64 mx-auto" />
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
    </div>
  );
}