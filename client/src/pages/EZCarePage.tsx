import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Wrench, Save, RefreshCw, Clock, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useEffect, useMemo } from "react";

const EZCARE_FIELDS = [
  { key: "doorCodeGuest", label: "Door Code (Guest)", hint: "Guest entry code" },
  { key: "doorCodeMaster", label: "Door Code (Master)", hint: "Staff/master code" },
  { key: "lockboxCode", label: "Lockbox Code", hint: "Primary lockbox code" },
  { key: "lockboxLocation", label: "Lockbox Location", hint: "Where the lockbox is located" },
  { key: "lockboxGuestUse", label: "Lockbox — Guest Use", hint: "Guest-facing lockbox instructions" },
  { key: "lockboxCompanyOnly", label: "Lockbox — Company Only", hint: "Staff-only lockbox code/location" },
  { key: "garageCode", label: "Garage / Gate Code", hint: "Garage or gate entry code" },
  { key: "amenitiesCode", label: "Community Amenities Code", hint: "Pool, gym, or amenity access" },
  { key: "smartLockInstructions", label: "Smart Lock / Admin Note", hint: "Full access note from EZCare", multiline: true },
  { key: "trashInstructions", label: "Trash Instructions", hint: "Where to place bins, any special notes", multiline: true },
  { key: "garbagePickupDay", label: "Garbage Pickup Day", hint: "e.g. Tuesday and Friday" },
];

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function EZCarePage() {
  const { toast } = useToast();
  const [selectedListing, setSelectedListing] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [syncJobId, setSyncJobId] = useState<number | null>(null);
  const [showSyncLog, setShowSyncLog] = useState(false);
  const [listingSearch, setListingSearch] = useState("");

  const { data: listingsData, isLoading: listingsLoading } = useQuery({
    queryKey: ["/api/hostaway/listings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/hostaway/listings");
      const json = await res.json();
      return (json.result || json) as any[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: allTemplates = [] } = useQuery({
    queryKey: ["/api/templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/templates");
      return res.json() as Promise<any[]>;
    },
  });

  // Last sync status
  const { data: syncStatus, refetch: refetchSyncStatus } = useQuery({
    queryKey: ["/api/ezcare/sync/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ezcare/sync/status");
      return res.json() as Promise<{ lastSync: any | null }>;
    },
    refetchInterval: syncJobId ? 3000 : false,
  });

  // Live sync job polling
  const { data: syncJob } = useQuery({
    queryKey: ["/api/jobs", syncJobId, "status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jobs/${syncJobId}/status`);
      return res.json();
    },
    enabled: !!syncJobId,
    refetchInterval: (data: any) => (data?.status === "running" ? 2000 : false),
  });

  // When sync completes, refresh everything
  useEffect(() => {
    if (syncJob?.status === "done" || syncJob?.status === "error") {
      queryClient.invalidateQueries({ queryKey: ["/api/ezcare/sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      if (selectedListing) loadOverrides(selectedListing);
      setShowSyncLog(true);
    }
  }, [syncJob?.status]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ezcare/sync", {});
      return res.json();
    },
    onSuccess: (data) => {
      setSyncJobId(data.jobId);
      setShowSyncLog(true);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "EZCare sync started", description: "Logging into EZCare and pulling all property data..." });
    },
    onError: () => toast({ title: "Sync failed to start", variant: "destructive" }),
  });

  async function loadOverrides(listingId: string) {
    setSelectedListing(listingId);
    const templateMap: Record<string, string> = {};
    for (const t of allTemplates.filter((t: any) => t.category === "ezcare")) {
      templateMap[t.fieldKey] = t.value;
    }
    try {
      const res = await apiRequest("GET", `/api/overrides/${listingId}`);
      const overrides: any[] = await res.json();
      for (const o of overrides) {
        templateMap[o.fieldKey] = o.value;
      }
    } catch {}
    setFieldValues(templateMap);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const [fieldKey, value] of Object.entries(fieldValues)) {
        if (value.trim()) {
          await apiRequest("POST", "/api/overrides", { hostawayListingId: selectedListing, fieldKey, value });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overrides", selectedListing] });
      toast({ title: "Property data saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const listings = listingsData ?? [];
  const filteredListings = useMemo(() => {
    if (!listingSearch) return listings;
    const q = listingSearch.toLowerCase();
    return listings.filter((l: any) =>
      l.name?.toLowerCase().includes(q) ||
      l.address?.toLowerCase().includes(q) ||
      String(l.id).includes(q)
    );
  }, [listings, listingSearch]);
  const selectedListingObj = listings.find((l: any) => String(l.id) === selectedListing);
  const lastSync = syncStatus?.lastSync;
  const syncRunning = syncJob?.status === "running" || syncMutation.isPending;
  const filledFields = Object.values(fieldValues).filter(v => v.trim()).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-800">EZCare Sync</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pull property access data from EZCare and keep it synced weekly across all platforms.
        </p>
      </div>

      {/* Sync control card */}
      <Card className="border-border">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Auto-sync from EZCare</div>
              <div className="text-xs text-muted-foreground">
                Logs into ezcare.io, pulls all unit access fields, and maps them to your Hostaway listings.
              </div>
              {lastSync && (
                <div className="flex items-center gap-2 mt-1">
                  {lastSync.status === "done"
                    ? <CheckCircle2 size={12} className="text-green-500" />
                    : <AlertCircle size={12} className="text-amber-500" />}
                  <span className="text-xs text-muted-foreground">
                    Last sync: {timeAgo(lastSync.createdAt)} — <span className={`status-pill ${lastSync.status} !py-0 !px-1.5 !text-[10px]`}>{lastSync.status}</span>
                  </span>
                </div>
              )}
              {!lastSync && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={11} /> Never synced
                </div>
              )}
            </div>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncRunning}
              className="shrink-0"
              data-testid="button-run-ezcare-sync"
            >
              <RefreshCw size={14} className={`mr-2 ${syncRunning ? "animate-spin" : ""}`} />
              {syncRunning ? "Syncing..." : "Sync Now"}
            </Button>
          </div>

          {/* Live sync log */}
          {(syncJob || showSyncLog) && (
            <div className="mt-4 border-t border-border pt-4">
              <button
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground mb-2"
                onClick={() => setShowSyncLog(s => !s)}
              >
                {showSyncLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {syncJob?.status === "running" ? "Live progress" : "Sync log"}
              </button>
              {showSyncLog && syncJob?.details && (
                <pre className="text-xs font-mono text-muted-foreground bg-muted rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {syncJob.details}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly schedule note */}
      <Card className="border-border bg-accent/20">
        <CardContent className="pt-3 pb-3 flex items-center gap-3">
          <Clock size={14} className="text-primary shrink-0" />
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">Weekly auto-sync</strong> is configured — EZCare data refreshes automatically every Monday at 6 AM. You can also trigger a manual sync anytime above.
          </span>
        </CardContent>
      </Card>

      {/* Per-property editor */}
      <div>
        <h2 className="text-sm font-semibold mb-3">View / Edit Property Data</h2>
        <Card className="border-border">
          <CardContent className="pt-4 pb-4">
            <div className="space-y-1.5">
              <Label>Select Property</Label>
              {listingsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <>
                  <Input
                    placeholder="Search by name or address..."
                    value={listingSearch}
                    onChange={e => setListingSearch(e.target.value)}
                    className="mb-1.5"
                  />
                  <Select value={selectedListing} onValueChange={(v) => { loadOverrides(v); setListingSearch(""); }}>
                    <SelectTrigger data-testid="select-ezcare-listing">
                      <SelectValue placeholder="Choose a property..." />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredListings.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No properties match</div>
                      )}
                      {filteredListings.map((l: any) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          <span>{l.name}</span>
                          {l.address && <span className="block text-xs text-muted-foreground">{l.address}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedListing && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">{selectedListingObj?.name || `Listing ${selectedListing}`}</h3>
              <p className="text-xs text-muted-foreground">{selectedListingObj?.address || ""}</p>
            </div>
            <div className="flex items-center gap-2">
              {filledFields > 0 && (
                <Badge variant="secondary" className="text-xs">{filledFields} fields populated</Badge>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {EZCARE_FIELDS.map(field => (
              <Card key={field.key} className="border-border">
                <CardContent className="pt-3 pb-3">
                  <div className="space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <Label className="text-sm font-medium">{field.label}</Label>
                      <span className="text-xs text-muted-foreground">{field.hint}</span>
                    </div>
                    {field.multiline ? (
                      <Textarea
                        rows={2}
                        value={fieldValues[field.key] ?? ""}
                        onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.hint}
                        className="text-sm resize-none"
                        data-testid={`ezcare-input-${field.key}`}
                      />
                    ) : (
                      <Input
                        value={fieldValues[field.key] ?? ""}
                        onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.hint}
                        className="text-sm"
                        data-testid={`ezcare-input-${field.key}`}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-ezcare"
            >
              <Save size={14} className="mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
