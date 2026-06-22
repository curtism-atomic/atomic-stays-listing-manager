import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { scrapeEZCare, matchEZCareToHostaway, saveEZCareData } from "./ezcare-scraper";

// Hostaway credentials — loaded from environment variables
const HOSTAWAY_ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID;
const HOSTAWAY_CLIENT_SECRET = process.env.HOSTAWAY_CLIENT_SECRET;

let hostawayToken: string | null = null;
let tokenExpiry: number = 0;

async function getHostawayToken(): Promise<string> {
  if (hostawayToken && Date.now() < tokenExpiry) return hostawayToken;
  const res = await fetch("https://api.hostaway.com/v1/accessTokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: HOSTAWAY_ACCOUNT_ID,
      client_secret: HOSTAWAY_CLIENT_SECRET,
      scope: "general",
    }),
  });
  const data = await res.json() as any;
  hostawayToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return hostawayToken!;
}

async function hostawayGet(path: string) {
  const token = await getHostawayToken();
  const res = await fetch(`https://api.hostaway.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Cache-control": "no-cache" },
  });
  return res.json();
}

async function hostawayPut(path: string, body: object) {
  const token = await getHostawayToken();
  const res = await fetch(`https://api.hostaway.com/v1${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Cache-control": "no-cache",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.status === "error" || data.code >= 400) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Hostaway: fetch all listings (paginated) ────────────────────────────
  app.get("/api/hostaway/listings", async (req, res) => {
    try {
      const allListings: any[] = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const data = await hostawayGet(`/listings?limit=${limit}&offset=${offset}&includeResources=0`);
        const page: any[] = data.result || data;
        if (!Array.isArray(page) || page.length === 0) break;
        allListings.push(...page);
        if (page.length < limit) break;
        offset += limit;
      }
      res.json({ result: allListings, count: allListings.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Hostaway: fetch single listing detail ─────────────────────────────────
  app.get("/api/hostaway/listings/:id", async (req, res) => {
    try {
      const data = await hostawayGet(`/listings/${req.params.id}`);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Hostaway: fetch listing photos ────────────────────────────────────────
  // Photos are embedded in the listing detail as `listingImages` — no separate endpoint exists
  app.get("/api/hostaway/listings/:id/photos", async (req, res) => {
    try {
      const data = await hostawayGet(`/listings/${req.params.id}`);
      const listing = data.result ?? data;
      const images = listing.listingImages ?? [];
      res.json({ status: "success", result: images });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Hostaway: bulk update consistent fields ───────────────────────────────
  app.post("/api/hostaway/bulk-update", async (req, res) => {
    const { listingIds, fields } = req.body as { listingIds: string[]; fields: Record<string, any> };
    if (!listingIds?.length || !fields) {
      return res.status(400).json({ error: "listingIds and fields required" });
    }
    const job = storage.createPushJob({
      jobType: "hostaway_bulk",
      status: "running",
      listingIds: JSON.stringify(listingIds),
      details: `Updating ${listingIds.length} listings`,
    });

    // Run async
    (async () => {
      const results: string[] = [];
      let successCount = 0, errorCount = 0;
      for (const id of listingIds) {
        try {
          // Send ONLY the changed fields — Hostaway silently ignores updates
          // when the full listing body is sent (nested objects like listingAmenities
          // cause the update to be swallowed without error).
          await hostawayPut(`/listings/${id}`, fields);
          results.push(`✓ ${id}`);
          successCount++;
        } catch (e: any) {
          results.push(`✗ ${id}: ${e.message}`);
          errorCount++;
        }
      }
      storage.updatePushJobStatus(job.id, "done",
        `Updated ${successCount}/${listingIds.length} listings${errorCount ? ` (${errorCount} errors)` : ""}\n` + results.join("\n")
      );
    })();

    res.json({ jobId: job.id, message: "Bulk update started" });
  });

  // ── Hostaway: update photos (captions + order) ────────────────────────────
  app.post("/api/hostaway/listings/:id/photos/update", async (req, res) => {
    const { photos } = req.body as { photos: Array<{ id: string; caption: string; sortOrder: number }> };
    const listingId = req.params.id;

    if (!photos?.length) return res.status(400).json({ error: "photos required" });

    const job = storage.createPushJob({
      jobType: "photos",
      status: "running",
      listingIds: JSON.stringify([listingId]),
      details: `Updating ${photos.length} photos for listing ${listingId}`,
    });

    // Save captions locally
    storage.bulkUpsertCaptions(
      photos.map((p) => ({
        hostawayListingId: listingId,
        photoId: p.id,
        caption: p.caption,
        sortOrder: p.sortOrder,
      }))
    );

    // Push to Hostaway
    (async () => {
      const results: string[] = [];
      for (const photo of photos) {
        try {
          await hostawayPut(`/listings/${listingId}/photos/${photo.id}`, {
            caption: photo.caption,
            sortOrder: photo.sortOrder,
          });
          results.push(`✓ photo ${photo.id}`);
        } catch (e: any) {
          results.push(`✗ photo ${photo.id}: ${e.message}`);
        }
      }
      storage.updatePushJobStatus(job.id, "done", results.join("\n"));
    })();

    res.json({ jobId: job.id });
  });

  // ── Templates CRUD ────────────────────────────────────────────────────────
  app.get("/api/templates", (req, res) => {
    const { category } = req.query as { category?: string };
    const templates = category
      ? storage.getTemplatesByCategory(category)
      : storage.getTemplates();
    res.json(templates);
  });

  app.post("/api/templates", (req, res) => {
    try {
      const template = storage.upsertTemplate(req.body);
      res.json(template);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/templates/:id", (req, res) => {
    storage.deleteTemplate(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Property overrides ────────────────────────────────────────────────────
  app.get("/api/overrides/:listingId", (req, res) => {
    res.json(storage.getOverridesForListing(req.params.listingId));
  });

  app.post("/api/overrides", (req, res) => {
    res.json(storage.upsertOverride(req.body));
  });

  app.delete("/api/overrides/:listingId/:fieldKey", (req, res) => {
    storage.deleteOverride(req.params.listingId, req.params.fieldKey);
    res.json({ ok: true });
  });

  // ── Photo captions (local) ────────────────────────────────────────────────
  app.get("/api/captions/:listingId", (req, res) => {
    res.json(storage.getCaptionsForListing(req.params.listingId));
  });

  // ── Push job status ───────────────────────────────────────────────────────
  app.get("/api/jobs", (req, res) => {
    res.json(storage.getPushJobs());
  });

  app.get("/api/jobs/:id/status", (req, res) => {
    const jobs = storage.getPushJobs(100);
    const job = jobs.find((j) => j.id === Number(req.params.id));
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  // ── EZCare: get fields for a listing ─────────────────────────────────────
  app.get("/api/ezcare/fields/:listingId", async (req, res) => {
    try {
      const data = await hostawayGet(`/listings/${req.params.listingId}`);
      const listing = data.result || data;
      res.json({
        listingId: req.params.listingId,
        propertyName: listing.name || "",
        address: listing.address || "",
        fields: storage.getOverridesForListing(req.params.listingId),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── EZCare: trigger full sync ─────────────────────────────────────────────
  app.post("/api/ezcare/sync", async (req, res) => {
    const username = process.env.EZCARE_USERNAME;
    const password = process.env.EZCARE_PASSWORD;
    if (!username || !password) {
      return res.status(400).json({ error: "EZCare credentials not configured." });
    }
    const job = storage.createPushJob({
      jobType: "ezcare_sync",
      status: "running",
      listingIds: JSON.stringify([]),
      details: "Starting EZCare sync...",
    });
    res.json({ jobId: job.id, message: "EZCare sync started" });

    (async () => {
      const progressLines: string[] = [];
      const log = (msg: string) => {
        progressLines.push(msg);
        storage.updatePushJobStatus(job.id, "running", progressLines.slice(-40).join("\n"));
      };
      try {
        // Fetch Hostaway listings BEFORE scraping so we can match+save each batch incrementally
        log("Fetching Hostaway listings for matching...");
        const allListings: any[] = [];
        let offset = 0;
        while (true) {
          const data = await hostawayGet(`/listings?limit=100&offset=${offset}&includeResources=0`);
          const page: any[] = data.result || data;
          if (!Array.isArray(page) || page.length === 0) break;
          allListings.push(...page);
          if (page.length < 100) break;
          offset += 100;
        }
        log(`Loaded ${allListings.length} Hostaway listings. Starting EZCare scrape...`);

        let totalSaved = 0;
        let totalMatched = 0;

        // onBatch: called after each 10-unit concurrent batch — match & save immediately
        const onBatch = (batch: any[]) => {
          const matched = matchEZCareToHostaway(batch, allListings);
          totalMatched += matched.filter(m => m.hostawayId).length;
          const { saved } = saveEZCareData(matched);
          totalSaved += saved;
          log(`Saved batch: ${saved} matched. Running total — matched: ${totalMatched}, saved: ${totalSaved}`);
        };

        const { errors } = await scrapeEZCare(username, password, log, onBatch);

        storage.updatePushJobStatus(job.id, "done",
          `✓ EZCare sync complete\nUnits scraped: ${totalMatched + (errors.length)}\nMatched to Hostaway: ${totalMatched}\nSaved: ${totalSaved}${errors.length ? `\nErrors: ${errors.slice(0,5).join("; ")}` : ""}`
        );
      } catch (e: any) {
        storage.updatePushJobStatus(job.id, "error", `Sync failed: ${e.message}`);
      }
    })();
  });

  // ── EZCare: last sync status ──────────────────────────────────────────────
  app.get("/api/ezcare/sync/status", (req, res) => {
    const jobs = storage.getPushJobs(50);
    const lastSync = jobs.find(j => j.jobType === "ezcare_sync") || null;
    res.json({ lastSync });
  });

  // ── EZCare: reset any stuck running job (for cron use) ───────────────────
  app.post("/api/ezcare/sync/reset-stuck", (req, res) => {
    const jobs = storage.getPushJobs(5);
    const stuck = jobs.find(j => j.jobType === "ezcare_sync" && j.status === "running");
    if (stuck) {
      const age = stuck.createdAt
        ? Date.now() - new Date(stuck.createdAt as string).getTime()
        : Infinity;
      // Only reset if >30 minutes old (so we don't kill a freshly started sync)
      if (age > 30 * 60 * 1000) {
        storage.updatePushJobStatus(stuck.id, "error", "Marked failed: job was stuck in 'running' state (reset by cron)");
        return res.json({ reset: true, jobId: stuck.id });
      }
      return res.json({ reset: false, reason: "Job is running but less than 30 minutes old — not resetting" });
    }
    res.json({ reset: false, reason: "No stuck job found" });
  });
}
