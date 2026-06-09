/**
 * EZCare scraper — logs in, iterates all units, extracts access fields
 * Runs headlessly via Playwright. Credentials injected via env vars.
 */

import { chromium, type Browser, type Page } from "playwright";
import { storage } from "./storage";

const EZCARE_LOGIN_URL = "https://www.ezcare.io/inspManager/login.aspx";
const EZCARE_UNITS_URL = "https://www.ezcare.io/dbAdmin/propertyListV2.aspx?from=menu&s=0";

export interface EZCareUnit {
  guid: string;
  name: string;
  doorCode: string;
  gateCode: string;
  lockboxCode: string;
  lockboxLocation: string;
  amenitiesCode: string;
  adminNote: string; // contains trash instructions, garage code, etc.
  // Parsed from adminNote:
  trashInstructions: string;
  garbagePickupDay: string;
  garageCode: string;
  lockboxGuestUse: string;
  lockboxCompanyOnly: string;
}

/** Parse the free-text Admin Unit Note for specific fields */
function parseAdminNote(note: string): Partial<EZCareUnit> {
  const lower = note.toLowerCase();
  const result: Partial<EZCareUnit> = {
    trashInstructions: "",
    garbagePickupDay: "",
    garageCode: "",
    lockboxGuestUse: "",
    lockboxCompanyOnly: "",
  };

  // Trash day — "trash day: tuesday" or "garbage pickup: monday/wednesday"
  const trashDayMatch = note.match(/(?:trash|garbage|recycle)\s*(?:day|pickup|collection)\s*[:\-–]?\s*([^\n\r.]+)/i);
  if (trashDayMatch) {
    result.garbagePickupDay = trashDayMatch[1].trim();
  }

  // Full trash instruction line
  const trashLineMatch = note.match(/(?:trash|garbage)[^\n\r]{0,120}/i);
  if (trashLineMatch) {
    result.trashInstructions = trashLineMatch[0].trim();
  }

  // Garage lockbox / garage code
  const garageMatch = note.match(/garage(?:\s+lockbox)?\s*(?:code|#|number)?\s*[=:\-–]?\s*([0-9A-Za-z#*]+)/i);
  if (garageMatch) {
    result.garageCode = garageMatch[1].trim();
  }

  // Lockbox guest vs company — look for "guest" context
  const lockboxGuestMatch = note.match(/(?:guest\s+lockbox|lockbox.*guest)[^\n\r=:]*[=:\-–]?\s*([0-9A-Za-z#*]+)/i);
  if (lockboxGuestMatch) {
    result.lockboxGuestUse = lockboxGuestMatch[1].trim();
  }

  const lockboxCompanyMatch = note.match(/(?:company\s+lockbox|lockbox.*company|staff\s+lockbox)[^\n\r=:]*[=:\-–]?\s*([0-9A-Za-z#*]+)/i);
  if (lockboxCompanyMatch) {
    result.lockboxCompanyOnly = lockboxCompanyMatch[1].trim();
  }

  return result;
}

export async function scrapeEZCare(
  username: string,
  password: string,
  onProgress?: (msg: string) => void
): Promise<{ units: EZCareUnit[]; errors: string[] }> {
  const log = (msg: string) => { console.log(msg); onProgress?.(msg); };
  const errors: string[] = [];
  const units: EZCareUnit[] = [];

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();

    // ── Login ──────────────────────────────────────────────────────────────
    log("Logging into EZCare...");
    await page.goto(EZCARE_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.fill('#txtLogin, input[name="txtLogin"], input[type="text"]', username);
    await page.fill('input[type="password"]', password);
    // EZCare uses a __doPostBack button with id="btnRun"
    await page.click('#btnRun, input[type="submit"], button[type="submit"], input[value*="Log"]');
    await page.waitForURL(/dbAdmin|inspManager|propertyList|unitList/, { timeout: 20000 });
    log("Login successful");

    // ── Get unit list ──────────────────────────────────────────────────────
    log("Loading units list...");
    await page.goto(EZCARE_UNITS_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Collect all unit GUIDs and names across all pages
    const allUnitLinks: Array<{ guid: string; name: string }> = [];
    let pageNum = 0;

    while (true) {
      pageNum++;
      log(`Collecting unit list page ${pageNum}...`);

      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="propertyDetailV2"]'));
        return anchors.map(a => {
          const href = (a as HTMLAnchorElement).href;
          const match = href.match(/Id=([a-f0-9\-]{36})/i);
          return {
            guid: match ? match[1] : "",
            name: (a.textContent || "").trim(),
          };
        }).filter(u => u.guid);
      });

      allUnitLinks.push(...links);

      // Check for next page link
      const nextPage = await page.$('a[href*="propertyList"][href*="page"], .pagination a:last-child, a:has-text("Next"), a:has-text(">")');
      if (!nextPage) break;
      const isDisabled = await nextPage.evaluate(el => el.classList.contains("disabled") || (el as HTMLAnchorElement).getAttribute("disabled") !== null);
      if (isDisabled) break;

      // Alternative: look for numbered pagination
      const currentPageEl = await page.$('.pagination .active, .pager .active');
      if (currentPageEl) {
        const nextPageEl = await page.$('.pagination .active + li a, .pager .active + li a');
        if (!nextPageEl) break;
        await nextPageEl.click();
      } else {
        await nextPage.click();
      }
      await page.waitForTimeout(1500);

      // If same units appear, we've looped — stop
      if (links.length === 0) break;
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueUnits = allUnitLinks.filter(u => {
      if (seen.has(u.guid)) return false;
      seen.add(u.guid);
      return true;
    });

    log(`Found ${uniqueUnits.length} units. Starting detail pull...`);

    // ── Pull each unit detail ──────────────────────────────────────────────
    for (let i = 0; i < uniqueUnits.length; i++) {
      const unit = uniqueUnits[i];
      try {
        log(`[${i + 1}/${uniqueUnits.length}] Pulling: ${unit.name}`);
        const detailUrl = `https://www.ezcare.io/dbAdmin/propertyDetailV2.aspx?Id=${unit.guid}&b=s`;
        await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(800);

        const fields = await page.evaluate(() => {
          function getFieldValue(labelTexts: string[]): string {
            for (const label of labelTexts) {
              // Try label elements
              const labels = Array.from(document.querySelectorAll("label, th, td, span, div"));
              for (const el of labels) {
                if (el.textContent?.trim().toLowerCase().includes(label.toLowerCase())) {
                  // Check sibling, next element, or associated input
                  const next = el.nextElementSibling as HTMLElement;
                  if (next) {
                    const input = next.querySelector("input, textarea") as HTMLInputElement | null;
                    if (input) return input.value || input.textContent?.trim() || "";
                    return next.textContent?.trim() || "";
                  }
                  // Check for associated input by id
                  const forAttr = el.getAttribute("for");
                  if (forAttr) {
                    const input = document.getElementById(forAttr) as HTMLInputElement | null;
                    if (input) return input.value || "";
                  }
                }
              }
              // Direct input search by placeholder or name
              const inputs = Array.from(document.querySelectorAll("input, textarea")) as HTMLInputElement[];
              for (const input of inputs) {
                const name = (input.name + input.id + input.placeholder).toLowerCase();
                if (name.includes(label.toLowerCase())) {
                  return input.value || "";
                }
              }
            }
            return "";
          }

          return {
            doorCode: getFieldValue(["door code", "doorcode", "door_code"]),
            gateCode: getFieldValue(["gate code", "gatecode", "gate_code"]),
            lockboxCode: getFieldValue(["lockbox code", "lockboxcode", "lockbox_code"]),
            lockboxLocation: getFieldValue(["lockbox location", "lockbox loc"]),
            amenitiesCode: getFieldValue(["amenities", "community amenities"]),
            adminNote: (() => {
              const textareas = Array.from(document.querySelectorAll("textarea")) as HTMLTextAreaElement[];
              for (const ta of textareas) {
                const label = document.querySelector(`label[for="${ta.id}"]`);
                if (label?.textContent?.toLowerCase().includes("note") ||
                    ta.name?.toLowerCase().includes("note") ||
                    ta.id?.toLowerCase().includes("note")) {
                  return ta.value || "";
                }
              }
              // Fallback: largest textarea
              const sorted = textareas.sort((a, b) => (b.value?.length || 0) - (a.value?.length || 0));
              return sorted[0]?.value || "";
            })(),
          };
        });

        const parsed = parseAdminNote(fields.adminNote);

        units.push({
          guid: unit.guid,
          name: unit.name,
          doorCode: fields.doorCode,
          gateCode: fields.gateCode,
          lockboxCode: fields.lockboxCode,
          lockboxLocation: fields.lockboxLocation,
          amenitiesCode: fields.amenitiesCode,
          adminNote: fields.adminNote,
          trashInstructions: parsed.trashInstructions || "",
          garbagePickupDay: parsed.garbagePickupDay || "",
          garageCode: parsed.garageCode || "",
          lockboxGuestUse: parsed.lockboxGuestUse || fields.lockboxCode || "",
          lockboxCompanyOnly: parsed.lockboxCompanyOnly || "",
        });

        // Small delay to avoid hammering the server
        await page.waitForTimeout(300);
      } catch (e: any) {
        const errMsg = `Error pulling ${unit.name} (${unit.guid}): ${e.message}`;
        log(errMsg);
        errors.push(errMsg);
      }
    }

    log(`Done. Pulled ${units.length} units, ${errors.length} errors.`);
  } finally {
    await browser?.close();
  }

  return { units, errors };
}

/** Map EZCare unit name to Hostaway listing ID using fuzzy address matching */
export function matchEZCareToHostaway(
  ezUnits: EZCareUnit[],
  hostawayListings: Array<{ id: string | number; name: string; address?: string }>
): Array<{ ezUnit: EZCareUnit; hostawayId: string | null; matchScore: number }> {
  function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  }

  function scoreMatch(a: string, b: string): number {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    // Word overlap score
    const wa = new Set(na.split(" ").filter(w => w.length > 2));
    const wb = new Set(nb.split(" ").filter(w => w.length > 2));
    const intersection = [...wa].filter(w => wb.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union > 0 ? intersection / union : 0;
  }

  return ezUnits.map(unit => {
    let best: { id: string; score: number } | null = null;
    for (const listing of hostawayListings) {
      const nameScore = scoreMatch(unit.name, listing.name);
      const addrScore = listing.address ? scoreMatch(unit.name, listing.address) : 0;
      const score = Math.max(nameScore, addrScore);
      if (!best || score > best.score) {
        best = { id: String(listing.id), score };
      }
    }
    return {
      ezUnit: unit,
      hostawayId: best && best.score >= 0.3 ? best.id : null,
      matchScore: best?.score ?? 0,
    };
  });
}

/** Save matched EZCare data into the app's property_overrides table */
export function saveEZCareData(
  matched: ReturnType<typeof matchEZCareToHostaway>
): { saved: number; skipped: number } {
  let saved = 0;
  let skipped = 0;

  for (const { ezUnit, hostawayId } of matched) {
    if (!hostawayId) { skipped++; continue; }

    const fieldMap: Record<string, string> = {
      doorCodeGuest: ezUnit.doorCode,
      gateCode: ezUnit.gateCode,
      lockboxCode: ezUnit.lockboxCode,
      lockboxLocation: ezUnit.lockboxLocation,
      lockboxGuestUse: ezUnit.lockboxGuestUse || ezUnit.lockboxCode,
      lockboxCompanyOnly: ezUnit.lockboxCompanyOnly,
      garageCode: ezUnit.garageCode || ezUnit.gateCode,
      amenitiesCode: ezUnit.amenitiesCode,
      trashInstructions: ezUnit.trashInstructions,
      garbagePickupDay: ezUnit.garbagePickupDay,
      smartLockInstructions: ezUnit.adminNote,
      ezCareGuid: ezUnit.guid,
    };

    for (const [fieldKey, value] of Object.entries(fieldMap)) {
      if (value?.trim()) {
        storage.upsertOverride({ hostawayListingId: hostawayId, fieldKey, value });
      }
    }
    saved++;
  }

  return { saved, skipped };
}
