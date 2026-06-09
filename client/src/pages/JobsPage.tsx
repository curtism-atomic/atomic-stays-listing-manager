import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, RefreshCw, Image, Wrench, FileText } from "lucide-react";

const JOB_ICONS: Record<string, any> = {
  hostaway_bulk: RefreshCw,
  photos: Image,
  ezcare: Wrench,
};

function timeAgo(date: Date | null): string {
  if (!date) return "—";
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function JobsPage() {
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/jobs");
      return res.json() as Promise<any[]>;
    },
    refetchInterval: 5000,
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-display font-800">Activity</h1>
        <p className="text-sm text-muted-foreground mt-1">All push jobs and recent automation runs</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : jobs.length === 0 ? (
        <Card className="border-border">
          <CardContent className="pt-12 pb-12 text-center">
            <Clock size={32} className="mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">No jobs yet. Run a bulk update, photo push, or EZCare push to see activity here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {jobs.map((job: any) => {
            const Icon = JOB_ICONS[job.jobType] || FileText;
            const listingIds: string[] = JSON.parse(job.listingIds || "[]");
            const createdAt = job.createdAt ? new Date(job.createdAt * 1000) : null;
            const completedAt = job.completedAt ? new Date(job.completedAt * 1000) : null;

            return (
              <Card key={job.id} className="border-border" data-testid={`job-row-${job.id}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-muted shrink-0">
                      <Icon size={15} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium capitalize">{job.jobType.replace("_", " ")}</span>
                        <span className={`status-pill ${job.status}`}>{job.status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{listingIds.length} listing{listingIds.length !== 1 ? "s" : ""}</div>
                      {job.details && (
                        <details className="mt-2">
                          <summary className="text-xs text-primary cursor-pointer">Show details</summary>
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted rounded p-2 mt-1 max-h-32 overflow-y-auto">
                            {job.details}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-muted-foreground">{timeAgo(createdAt)}</div>
                      {completedAt && <div className="text-xs text-muted-foreground">{timeAgo(completedAt)}</div>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
