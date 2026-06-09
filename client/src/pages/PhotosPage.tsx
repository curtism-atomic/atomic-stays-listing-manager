import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Upload, GripVertical, Save } from "lucide-react";
import { useState, useRef } from "react";

interface Photo {
  id: string;
  url: string;
  caption: string;
  sortOrder: number;
}

export default function PhotosPage() {
  const { toast } = useToast();
  const [selectedListing, setSelectedListing] = useState<string>("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);
  const dropIdx = useRef<number | null>(null);

  const { data: listingsData, isLoading: listingsLoading } = useQuery({
    queryKey: ["/api/hostaway/listings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/hostaway/listings");
      const json = await res.json();
      return (json.result || json) as any[];
    },
    staleTime: 5 * 60 * 1000,
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

  async function loadPhotos(listingId: string) {
    setLoaded(false);
    setSelectedListing(listingId);
    try {
      const res = await apiRequest("GET", `/api/hostaway/listings/${listingId}/photos`);
      const json = await res.json();
      const rawPhotos: any[] = json.result || json || [];

      // Also load saved captions
      const captionRes = await apiRequest("GET", `/api/captions/${listingId}`);
      const savedCaptions: any[] = await captionRes.json();
      const captionMap = Object.fromEntries(savedCaptions.map((c: any) => [c.photoId, c]));

      const mapped: Photo[] = rawPhotos
        .map((p: any, i: number) => ({
          id: String(p.id),
          url: p.url || p.imageUrl || p.thumbnailUrl || "",
          caption: captionMap[String(p.id)]?.caption ?? p.caption ?? "",
          sortOrder: captionMap[String(p.id)]?.sortOrder ?? p.sortOrder ?? i,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      setPhotos(mapped);
      setLoaded(true);
    } catch (e) {
      toast({ title: "Failed to load photos", variant: "destructive" });
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/hostaway/listings/${selectedListing}/photos/update`, {
        photos: photos.map((p, i) => ({ id: p.id, caption: p.caption, sortOrder: i })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Photo update started" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  function updateCaption(id: string, caption: string) {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, caption } : p));
  }

  // Drag and drop handlers
  function onDragStart(i: number) { dragIdx.current = i; }
  function onDragEnter(i: number) { dropIdx.current = i; }
  function onDragEnd() {
    if (dragIdx.current === null || dropIdx.current === null) return;
    if (dragIdx.current === dropIdx.current) return;
    const arr = [...photos];
    const [moved] = arr.splice(dragIdx.current, 1);
    arr.splice(dropIdx.current, 0, moved);
    setPhotos(arr.map((p, i) => ({ ...p, sortOrder: i })));
    dragIdx.current = null;
    dropIdx.current = null;
  }

  const listings = listingsData ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-display font-800">Photos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Drag to reorder photos and add captions for any listing. Changes are pushed directly to Hostaway.
        </p>
      </div>

      {/* Listing picker */}
      <Card className="border-border">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">Select Listing</label>
              {listingsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedListing} onValueChange={loadPhotos}>
                  <SelectTrigger data-testid="select-listing">
                    <SelectValue placeholder="Choose a listing to edit photos..." />
                  </SelectTrigger>
                  <SelectContent>
                    {listings.map((l: any) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Job status */}
      {jobStatus && (
        <Card className={`border-border ${jobStatus.status === "done" ? "border-green-500/40" : ""}`}>
          <CardContent className="pt-3 pb-3 flex items-center gap-3">
            <span className={`status-pill ${jobStatus.status}`}>{jobStatus.status}</span>
            <span className="text-sm">
              {jobStatus.status === "done" ? "Photos updated in Hostaway" : jobStatus.status === "running" ? "Pushing to Hostaway..." : ""}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Photo grid */}
      {loaded && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{photos.length} photos — drag to reorder</div>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-photos"
            >
              <Save size={14} className="mr-2" />
              {saveMutation.isPending ? "Pushing..." : "Push to Hostaway"}
            </Button>
          </div>

          {photos.length === 0 ? (
            <Card className="border-border">
              <CardContent className="pt-12 pb-12 text-center text-muted-foreground">
                <Upload size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No photos found for this listing</p>
              </CardContent>
            </Card>
          ) : (
            <div className="photo-grid">
              {photos.map((photo, i) => (
                <div
                  key={photo.id}
                  className="photo-card bg-card border border-border shadow-sm"
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragEnter={() => onDragEnter(i)}
                  onDragEnd={onDragEnd}
                  onDragOver={e => e.preventDefault()}
                  data-testid={`photo-card-${photo.id}`}
                >
                  <div className="photo-badge">{i + 1}</div>
                  <GripVertical size={14} className="absolute top-6 right-2 text-white opacity-70" />
                  {photo.url ? (
                    <img src={photo.url} alt={`Photo ${i + 1}`} loading="lazy" />
                  ) : (
                    <div className="w-full aspect-[4/3] bg-muted flex items-center justify-center text-xs text-muted-foreground">
                      No preview
                    </div>
                  )}
                  <input
                    className="caption-input"
                    value={photo.caption}
                    onChange={e => updateCaption(photo.id, e.target.value)}
                    placeholder="Add caption..."
                    data-testid={`caption-input-${photo.id}`}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
