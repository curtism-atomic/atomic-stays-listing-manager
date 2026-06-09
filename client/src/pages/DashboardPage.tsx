import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, FileText, RefreshCw, Image, Wrench } from "lucide-react";
import { Link } from "wouter";

export default function DashboardPage() {
  const { data: listings, isLoading } = useQuery({
    queryKey: ["/api/hostaway/listings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/hostaway/listings");
      const json = await res.json();
      return (json.result || json) as any[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: templates } = useQuery({
    queryKey: ["/api/templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/templates");
      return res.json() as Promise<any[]>;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/jobs");
      return res.json() as Promise<any[]>;
    },
  });

  const activeListings = listings?.filter((l: any) => l.status === "active" || !l.status) ?? [];
  const recentJobs = jobs?.slice(0, 3) ?? [];

  const cards = [
    {
      title: "Bulk Update",
      description: "Push consistent fields across all Hostaway listings at once",
      icon: RefreshCw,
      href: "/bulk-update",
      color: "text-blue-500",
    },
    {
      title: "Templates",
      description: "Manage reusable field values for Airbnb, Hostaway, and EZCare",
      icon: FileText,
      href: "/templates",
      color: "text-purple-500",
    },
    {
      title: "Photos",
      description: "Reorder photos and add captions for any listing",
      icon: Image,
      href: "/photos",
      color: "text-amber-500",
    },
    {
      title: "EZCare Push",
      description: "Push lockbox, garage, smart lock, and trash details to EZCare",
      icon: Wrench,
      href: "/ezcare",
      color: "text-teal-500",
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-800 text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage listings across Hostaway, Airbnb, and EZCare from one place</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Listings", value: isLoading ? "—" : activeListings.length.toString(), icon: Building2 },
          { label: "Templates", value: templates?.length?.toString() ?? "0", icon: FileText },
          { label: "Recent Jobs", value: jobs?.length?.toString() ?? "0", icon: RefreshCw },
          { label: "Systems Connected", value: "3", icon: Wrench },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-border">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Icon size={14} />
                <span className="text-xs font-medium">{label}</span>
              </div>
              {isLoading && label === "Active Listings" ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <div className="text-2xl font-display font-700 text-foreground">{value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Workflows</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(({ title, description, icon: Icon, href, color }) => (
            <Link key={href} href={href}>
              <Card className="border-border hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer h-full">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-4">
                    <div className={`p-2.5 rounded-lg bg-muted ${color}`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground text-sm">{title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      {recentJobs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Recent Activity</h2>
          <Card className="border-border">
            <CardContent className="pt-4 pb-2">
              {recentJobs.map((job: any) => (
                <div key={job.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                  <div>
                    <div className="text-sm font-medium text-foreground capitalize">{job.jobType.replace("_", " ")}</div>
                    <div className="text-xs text-muted-foreground">{job.details?.slice(0, 60)}</div>
                  </div>
                  <span className={`status-pill ${job.status}`}>{job.status}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
