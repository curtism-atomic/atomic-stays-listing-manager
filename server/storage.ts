import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc } from "drizzle-orm";
import {
  fieldTemplates, propertyOverrides, photoCaption, pushJobs,
  type FieldTemplate, type InsertFieldTemplate,
  type PropertyOverride, type InsertPropertyOverride,
  type PhotoCaption, type InsertPhotoCaption,
  type PushJob, type InsertPushJob,
} from "@shared/schema";

// Use /tmp on serverless (Vercel), project root elsewhere
const DB_PATH = process.env.VERCEL ? "/tmp/data.db" : "data.db";
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite);

// Auto-migrate
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS field_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    is_global INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS property_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostaway_listing_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photo_captions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostaway_listing_id TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS push_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    listing_ids TEXT NOT NULL DEFAULT '[]',
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER,
    completed_at INTEGER
  );
`);

export interface IStorage {
  // Templates
  getTemplates(): FieldTemplate[];
  getTemplatesByCategory(category: string): FieldTemplate[];
  upsertTemplate(data: InsertFieldTemplate): FieldTemplate;
  deleteTemplate(id: number): void;

  // Overrides
  getOverridesForListing(listingId: string): PropertyOverride[];
  upsertOverride(data: InsertPropertyOverride): PropertyOverride;
  deleteOverride(listingId: string, fieldKey: string): void;

  // Photos
  getCaptionsForListing(listingId: string): PhotoCaption[];
  upsertCaption(data: InsertPhotoCaption): PhotoCaption;
  bulkUpsertCaptions(items: InsertPhotoCaption[]): void;

  // Push jobs
  createPushJob(data: InsertPushJob): PushJob;
  getPushJobs(limit?: number): PushJob[];
  updatePushJobStatus(id: number, status: string, details?: string): void;

  // Stats
  getOverridesForAllListings(): number;
}

export const storage: IStorage = {
  getTemplates() {
    return db.select().from(fieldTemplates).all();
  },
  getTemplatesByCategory(category) {
    return db.select().from(fieldTemplates).where(eq(fieldTemplates.category, category)).all();
  },
  upsertTemplate(data) {
    const existing = db.select().from(fieldTemplates)
      .where(and(eq(fieldTemplates.category, data.category), eq(fieldTemplates.fieldKey, data.fieldKey)))
      .get();
    if (existing) {
      db.update(fieldTemplates).set({ value: data.value, name: data.name }).where(eq(fieldTemplates.id, existing.id)).run();
      return db.select().from(fieldTemplates).where(eq(fieldTemplates.id, existing.id)).get()!;
    }
    return db.insert(fieldTemplates).values(data).returning().get();
  },
  deleteTemplate(id) {
    db.delete(fieldTemplates).where(eq(fieldTemplates.id, id)).run();
  },

  getOverridesForListing(listingId) {
    return db.select().from(propertyOverrides).where(eq(propertyOverrides.hostawayListingId, listingId)).all();
  },
  upsertOverride(data) {
    const existing = db.select().from(propertyOverrides)
      .where(and(eq(propertyOverrides.hostawayListingId, data.hostawayListingId), eq(propertyOverrides.fieldKey, data.fieldKey)))
      .get();
    if (existing) {
      db.update(propertyOverrides).set({ value: data.value }).where(eq(propertyOverrides.id, existing.id)).run();
      return db.select().from(propertyOverrides).where(eq(propertyOverrides.id, existing.id)).get()!;
    }
    return db.insert(propertyOverrides).values(data).returning().get();
  },
  deleteOverride(listingId, fieldKey) {
    db.delete(propertyOverrides)
      .where(and(eq(propertyOverrides.hostawayListingId, listingId), eq(propertyOverrides.fieldKey, fieldKey)))
      .run();
  },

  getCaptionsForListing(listingId) {
    return db.select().from(photoCaption).where(eq(photoCaption.hostawayListingId, listingId)).all();
  },
  upsertCaption(data) {
    const existing = db.select().from(photoCaption)
      .where(and(eq(photoCaption.hostawayListingId, data.hostawayListingId), eq(photoCaption.photoId, data.photoId)))
      .get();
    if (existing) {
      db.update(photoCaption).set({ caption: data.caption, sortOrder: data.sortOrder }).where(eq(photoCaption.id, existing.id)).run();
      return db.select().from(photoCaption).where(eq(photoCaption.id, existing.id)).get()!;
    }
    return db.insert(photoCaption).values(data).returning().get();
  },
  bulkUpsertCaptions(items) {
    for (const item of items) {
      storage.upsertCaption(item);
    }
  },

  createPushJob(data) {
    return db.insert(pushJobs).values({ ...data, createdAt: new Date() }).returning().get();
  },
  getPushJobs(limit = 20) {
    return db.select().from(pushJobs).orderBy(desc(pushJobs.id)).limit(limit).all();
  },
  updatePushJobStatus(id, status, details) {
    db.update(pushJobs).set({
      status,
      details: details ?? "",
      completedAt: ["done", "error"].includes(status) ? new Date() : undefined,
    }).where(eq(pushJobs.id, id)).run();
  },

  getOverridesForAllListings() {
    const result = sqlite.prepare("SELECT COUNT(DISTINCT hostaway_listing_id) as cnt FROM property_overrides").get() as any;
    return result?.cnt ?? 0;
  },
};
