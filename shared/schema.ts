import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Templates for consistent fields across listings
export const fieldTemplates = sqliteTable("field_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // e.g. "Guest Access", "House Rules"
  category: text("category").notNull(), // "airbnb" | "hostaway" | "ezcare"
  fieldKey: text("field_key").notNull(), // actual API field name
  value: text("value").notNull().default(""),
  isGlobal: integer("is_global", { mode: "boolean" }).notNull().default(true),
});

export const insertFieldTemplateSchema = createInsertSchema(fieldTemplates).omit({ id: true });
export type InsertFieldTemplate = z.infer<typeof insertFieldTemplateSchema>;
export type FieldTemplate = typeof fieldTemplates.$inferSelect;

// Per-property overrides for template fields
export const propertyOverrides = sqliteTable("property_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostawayListingId: text("hostaway_listing_id").notNull(),
  fieldKey: text("field_key").notNull(),
  value: text("value").notNull(),
});

export const insertPropertyOverrideSchema = createInsertSchema(propertyOverrides).omit({ id: true });
export type InsertPropertyOverride = z.infer<typeof insertPropertyOverrideSchema>;
export type PropertyOverride = typeof propertyOverrides.$inferSelect;

// Photo captions for Hostaway listings
export const photoCaption = sqliteTable("photo_captions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostawayListingId: text("hostaway_listing_id").notNull(),
  photoId: text("photo_id").notNull(),
  caption: text("caption").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertPhotoCaptionSchema = createInsertSchema(photoCaption).omit({ id: true });
export type InsertPhotoCaption = z.infer<typeof insertPhotoCaptionSchema>;
export type PhotoCaption = typeof photoCaption.$inferSelect;

// Push job log
export const pushJobs = sqliteTable("push_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type").notNull(), // "hostaway_bulk" | "ezcare" | "photos"
  status: text("status").notNull().default("pending"), // "pending" | "running" | "done" | "error"
  listingIds: text("listing_ids").notNull().default("[]"), // JSON array
  details: text("details").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const insertPushJobSchema = createInsertSchema(pushJobs).omit({ id: true, createdAt: true, completedAt: true });
export type InsertPushJob = z.infer<typeof insertPushJobSchema>;
export type PushJob = typeof pushJobs.$inferSelect;
