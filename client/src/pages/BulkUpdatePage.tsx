import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, CheckSquare, Square, AlertCircle, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";

export default function BulkUpdatePage() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: listingsData, isLoading } = useQuery({
    queryKey: ["/api/hostaway/listings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/hostaway/listings");
      const json = await res.json();
      return (json.result || json) as any[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["/api/templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/templates");
      return res.json() as Promise<any[]>;
    },
  });

  const { data: jobStatus } = useQuery({
    queryKey: ["/api/jobs", jobId, "status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jobs/${jobId}/status`);
      return res.json();
    },
    enabled: !!jobId,
    refetchInterval: (data: any) => (data?.status === "running" ? 2000 : false),
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      // Build fields object from templates
      const fields: Record<string, string> = {};
      for (const t of templates.filter((t: any) => t.category === "hostaway" || t.category === "airbnb")) {
        fields[t.fieldKey] = t.value;
      }
      const res = await apiRequest("POST", "/api/hostaway/bulk-update", {
        listingIds: Array.from(selected),
        fields,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Bulk update started", description: `Updating ${selected.size} listings...` });
    },
    onError: () => toast({ title: "Failed to start update", variant: "destructive" }),
  });

  const listings = listingsData ?? [];
  const filtered = useMemo(() =>
    listings.filter((l: any) =>
      !search || l.name?.toLowerCase().includes(search.toLowerCase()) ||
      String(l.id).includes(search)
    ),
    [listings, search]
  );

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l: any) => String(l.id))));
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const hostawayTemplates = templates.filter((t: any) => t.category === "hostaway" || t.category === "airbnb");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-display font-800">Bulk Update</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Apply your saved template fields to multiple Hostaway listings at once. Airbnb syncs automatically via Hostaway.
        </p>
      </div>

      {/* Template preview */}
      <Card className="border-border bg-accent/30">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold">Fields to be applied</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          {hostawayTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates saved yet. Go to <strong>Templates</strong> to set up your default fields first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hostawayTemplates.map((t: any) => (
                <Badge key={t.id} variant="secondary" className="text-xs">
                  {t.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job result */}
      {jobStatus && (
        <Card className={`border-border ${jobStatus.status === "done" ? "border-green-500/40 bg-green-50 dark:bg-green-950/20" : jobStatus.status === "error" ? "border-red-500/40 bg-red-50 dark:bg-red-950/20" : ""}`}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`status-pill ${jobStatus.status}`}>{jobStatus.status}</span>
              <span className="text-sm font-medium">
                {jobStatus.status === "running" ? "Update in progress..." : jobStatus.status === "done" ? "Update complete" : "Update failed"}
              </span>
            </div>
            {jobStatus.details && (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted rounded p-2 max-h-32 overflow-y-auto">
                {jobStatus.details}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Listing selector */}
      <Card className="border-border">
        <CardHeader className="pb-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-semibold">
              Select Listings {selected.size > 0 && <span className="text-primary">({selected.size} selected)</span>}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={toggleAll} data-testid="button-select-all" className="text-xs">
                {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={14} className="mr-1" /> : <Square size={14} className="mr-1" />}
                {selected.size === filtered.length && filtered.length > 0 ? "Deselect all" : "Select all"}
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 text-sm h-8"
              placeholder="Search listings..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-listings"
            />
          </div>
        </CardHeader>
        <CardContent className="pb-4 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No listings found</p>
          ) : (
            <div className="space-y-1">
              {filtered.map((listing: any) => {
                const id = String(listing.id);
                return (
                  <label
                    key={id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted cursor-pointer"
                    data-testid={`listing-row-${id}`}
                  >
                    <Checkbox
                      checked={selected.has(id)}
                      onCheckedChange={() => toggle(id)}
                      data-testid={`checkbox-listing-${id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{listing.name}</div>
                      <div className="text-xs text-muted-foreground">{listing.address || `ID: ${id}`}</div>
                    </div>
                    <Badge variant={listing.status === "active" ? "default" : "secondary"} className="text-xs shrink-0">
                      {listing.status || "active"}
                    </Badge>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle size={13} />
          This will update {selected.size} listing{selected.size !== 1 ? "s" : ""} in Hostaway. Airbnb syncs automatically.
        </div>
        <Button
          onClick={() => bulkMutation.mutate()}
          disabled={selected.size === 0 || hostawayTemplates.length === 0 || bulkMutation.isPending}
          data-testid="button-run-bulk-update"
        >
          <RefreshCw size={14} className={`mr-2 ${bulkMutation.isPending ? "animate-spin" : ""}`} />
          {bulkMutation.isPending ? "Starting..." : `Update ${selected.size} Listing${selected.size !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
