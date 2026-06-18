/**
 * EZCare scraper — logs in via HTTP (no browser), iterates all units, extracts access fields.
 * Uses node-fetch style requests with cookie handling. No Playwright/Chromium needed.
 */

import { storage } from "./storage";

const EZCARE_LOGIN_URL = "https://www.ezcare.io/inspManager/login.aspx";
const EZCARE_UNITS_URL = "https://www.ezcare.io/dbAdmin/propertyListV2.aspx?from=menu&s=0";
const EZCARE_DETAIL_BASE = "https://www.ezcare.io/dbAdmin";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface EZCareUnit {
  guid: string;
  name: string;
  doorCode: string;
  gateCode: string;
  lockboxCode: string;
  lockboxLocation: string;
  amenitiesCode: string;
  adminNote: string;
  trashInstructions: string;
  garbagePickupDay: string;
  garageCode: string;
  lockboxGuestUse: string;
  lockboxCompanyOnly: string;
}

// ── Lightweight cookie jar ─────────────────────────────────────────────────

interface Cookie { name: string; value: string; domain: string; path: string }

class CookieJar {
  private cookies: Cookie[] = [];

  addFromHeader(header: string, domain: string) {
    for (const part of header.split(",")) {
      const seg = part.trim().split(";")[0].trim();
      const eq = seg.indexOf("=");
      if (eq < 1) continue;
      const name = seg.slice(0, eq).trim();
      const value = seg.slice(eq + 1).trim();
      const existing = this.cookies.findIndex(c => c.name === name && c.domain === domain);
      if (existing >= 0) this.cookies[existing].value = value;
      else this.cookies.push({ name, value, domain, path: "/" });
    }
  }

  forDomain(domain: string): string {
    return this.cookies
      .filter(c => domain.includes(c.domain) || c.domain.includes(domain))
      .map(c => `${c.name}=${c.value}`)
      .join("; ");
  }
}

// ── HTTP helper ────────────────────────────────────────────────────────────

async function httpGet(url: string, jar: CookieJar): Promise<string> {
  const u = new URL(url);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": jar.forDomain(u.hostname),
    },
    redirect: "follow",
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) jar.addFromHeader(sc, u.hostname);
  return res.text();
}

async function httpPost(url: string, body: string, jar: CookieJar, referer?: string): Promise<{ html: string; finalUrl: string }> {
  const u = new URL(url);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": referer || url,
      "Cookie": jar.forDomain(u.hostname),
    },
    body,
    redirect: "follow",
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) jar.addFromHeader(sc, u.hostname);
  return { html: await res.text(), finalUrl: res.url };
}

// ── HTML parsing helpers ───────────────────────────────────────────────────

function extractHidden(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i"))
    || html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`, "i"))
    || html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`, "i"));
  return m ? m[1] : "";
}

function extractLinks(html: string, pattern: RegExp): Array<{ guid: string; name: string }> {
  const results: Array<{ guid: string; name: string }> = [];
  const linkRe = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    const guidMatch = href.match(pattern);
    if (guidMatch) results.push({ guid: guidMatch[1], name: text });
  }
  return results;
}

function extractInputValue(html: string, idOrName: string): string {
  // Try id="..." value="..."
  const byId = html.match(new RegExp(`id="${idOrName}"[^>]*value="([^"]*)"`, "i"))
    || html.match(new RegExp(`value="([^"]*)"[^>]*id="${idOrName}"`, "i"));
  if (byId) return byId[1];
  // Try name="..." value="..."
  const byName = html.match(new RegExp(`name="${idOrName}"[^>]*value="([^"]*)"`, "i"))
    || html.match(new RegExp(`value="([^"]*)"[^>]*name="${idOrName}"`, "i"));
  if (byName) return byName[1];
  return "";
}

function extractTextareaValue(html: string, idOrName: string): string {
  const m = html.match(new RegExp(`<textarea[^>]*(?:id|name)="${idOrName}"[^>]*>([\\s\\S]*?)<\\/textarea>`, "i"));
  return m ? m[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim() : "";
}

function findLargestTextarea(html: string): string {
  const re = /<textarea[^>]*>([\s\S]*?)<\/textarea>/gi;
  let largest = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const val = m[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
    if (val.length > largest.length) largest = val;
  }
  return largest;
}

function extractFieldByLabel(html: string, labelTexts: string[]): string {
  for (const label of labelTexts) {
    // Find label text then nearby input value
    const labelRe = new RegExp(`>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*<`, "i");
    const lm = labelRe.exec(html);
    if (!lm) continue;
    const after = html.slice(lm.index, lm.index + 2000);
    // Look for input value= in the following HTML
    const vm = after.match(/value="([^"]*)"/i);
    if (vm && vm[1]) return vm[1];
  }
  return "";
}

// EZCare stores gate/lockbox/amenity codes in repeater hidden fields:
// hiddenCode_N = field code (e.g. "GATECODE"), hiddenValue_N = the actual value
// We find the index where hiddenCode=code, then grab the corresponding value from a nearby text input
function extractRepeaterFieldByCode(html: string, code: string): string {
  // Find the index of this code in the repeater
  const codeRe = new RegExp(`hiddenCode[^"]*"[^"]*"[^>]*value="${code}"`, "i");
  const m = codeRe.exec(html);
  if (!m) return "";
  // Look for a text input within 1500 chars after this hidden field
  const after = html.slice(m.index, m.index + 1500);
  const inputVal = after.match(/<input[^>]*type="text"[^>]*value="([^"]*)"/i)
    || after.match(/value="([^"]+)"[^>]*type="text"/i);
  return inputVal ? inputVal[1].trim() : "";
}

// ── Admin note parser ──────────────────────────────────────────────────────

function parseAdminNote(note: string): Partial<EZCareUnit> {
  const result: Partial<EZCareUnit> = {
    trashInstructions: "",
    garbagePickupDay: "",
    garageCode: "",
    lockboxGuestUse: "",
    lockboxCompanyOnly: "",
  };

  const trashDayMatch = note.match(/(?:trash|garbage|recycle)\s*(?:day|pickup|collection)\s*[:\-–]?\s*([^\n\r.]+)/i);
  if (trashDayMatch) result.garbagePickupDay = trashDayMatch[1].trim();

  const trashLineMatch = note.match(/(?:trash|garbage)[^\n\r]{0,120}/i);
  if (trashLineMatch) result.trashInstructions = trashLineMatch[0].trim();

  const garageMatch = note.match(/garage(?:\s+lockbox)?\s*(?:code|#|number)?\s*[=:\-–]?\s*([0-9A-Za-z#*]+)/i);
  if (garageMatch) result.garageCode = garageMatch[1].trim();

  const lockboxGuestMatch = note.match(/(?:guest\s+lockbox|lockbox.*guest)[^\n\r=:]*[=:\-–]?\s*([0-9A-Za-z#*]+)/i);
  if (lockboxGuestMatch) result.lockboxGuestUse = lockboxGuestMatch[1].trim();

  const lockboxCompanyMatch = note.match(/(?:company\s+lockbox|lockbox.*company|staff\s+lockbox)[^\n\r=:]*[=:\-–]?\s*([0-9A-Za-z#*]+)/i);
  if (lockboxCompanyMatch) result.lockboxCompanyOnly = lockboxCompanyMatch[1].trim();

  return result;
}

// ── Main scraper ───────────────────────────────────────────────────────────

export async function scrapeEZCare(
  username: string,
  password: string,
  onProgress?: (msg: string) => void
): Promise<{ units: EZCareUnit[]; errors: string[] }> {
  const log = (msg: string) => { console.log(msg); onProgress?.(msg); };
  const errors: string[] = [];
  const units: EZCareUnit[] = [];
  const jar = new CookieJar();

  // ── Login ──────────────────────────────────────────────────────────────
  log("Logging into EZCare...");
  const loginPage = await httpGet(EZCARE_LOGIN_URL, jar);
  const viewstate = extractHidden(loginPage, "__VIEWSTATE");
  const vsgenerator = extractHidden(loginPage, "__VIEWSTATEGENERATOR");

  const loginBody = new URLSearchParams({
    __EVENTTARGET: "btnRun",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewstate,
    __VIEWSTATEGENERATOR: vsgenerator,
    firstTimer: "0",
    Main_hiddenBackToList: "Y",
    queryCompany: "",
    txtLogin: username,
    txtPassword: password,
    chkRemember: "on",
    autoLogin: "0",
    hidScreenSize: "1920x1080",
  }).toString();

  const { html: afterLogin, finalUrl } = await httpPost(EZCARE_LOGIN_URL, loginBody, jar, EZCARE_LOGIN_URL);

  if (finalUrl.includes("login") && !finalUrl.includes("summary")) {
    throw new Error("EZCare login failed — check credentials");
  }
  log("Login successful");

  // ── Get unit list ──────────────────────────────────────────────────────
  // EZCare loads all units on a single page (no pagination needed)
  log("Loading units list...");
  const pageHtml = await httpGet(EZCARE_UNITS_URL, jar);
  if (pageHtml.includes("login.aspx")) throw new Error("Session expired fetching unit list");
  log("Collecting unit list...");
  const allUnitLinks = extractLinks(pageHtml, /[?&]Id=([a-f0-9\-]{36})/i);

  // Deduplicate
  const seen = new Set<string>();
  const uniqueUnits = allUnitLinks.filter(u => {
    if (!u.guid || seen.has(u.guid)) return false;
    seen.add(u.guid);
    return true;
  });

  log(`Found ${uniqueUnits.length} units. Starting detail pull...`);

  // ── Pull each unit detail ──────────────────────────────────────────────
  for (let i = 0; i < uniqueUnits.length; i++) {
    const unit = uniqueUnits[i];
    try {
      log(`[${i + 1}/${uniqueUnits.length}] Pulling: ${unit.name || unit.guid}`);
      const detailUrl = `${EZCARE_DETAIL_BASE}/propertyDetailV2.aspx?Id=${unit.guid}&b=s`;
      const html = await httpGet(detailUrl, jar);

      if (html.includes("login.aspx")) {
        errors.push(`Session expired at unit ${i + 1}`);
        break;
      }

      // Extract fields using exact EZCare hidden field IDs
      const doorCode = extractInputValue(html, "Main_hiddenDOORCODE") || extractFieldByLabel(html, ["Door Code"]);
      const gateCode = extractRepeaterFieldByCode(html, "GATECODE") || extractFieldByLabel(html, ["Gate Code"]);
      const lockboxCode = extractRepeaterFieldByCode(html, "LOCKBOXCODE") || extractFieldByLabel(html, ["Lockbox Code"]);
      const lockboxLocation = extractRepeaterFieldByCode(html, "LockboxLocation") || extractFieldByLabel(html, ["Lockbox Location"]);
      const amenitiesCode = extractRepeaterFieldByCode(html, "ComAmenAccessCode") || extractFieldByLabel(html, ["Amenities"]);
      // Admin note uses Main_TxtAdminUnitNote
      const adminNote = extractTextareaValue(html, "Main_TxtAdminUnitNote") || findLargestTextarea(html);

      const parsed = parseAdminNote(adminNote);

      units.push({
        guid: unit.guid,
        name: unit.name,
        doorCode,
        gateCode,
        lockboxCode,
        lockboxLocation,
        amenitiesCode,
        adminNote,
        trashInstructions: parsed.trashInstructions || "",
        garbagePickupDay: parsed.garbagePickupDay || "",
        garageCode: parsed.garageCode || "",
        lockboxGuestUse: parsed.lockboxGuestUse || lockboxCode || "",
        lockboxCompanyOnly: parsed.lockboxCompanyOnly || "",
      });

      // Small delay — be polite to the server
      await new Promise(r => setTimeout(r, 200));
    } catch (e: any) {
      const errMsg = `Error pulling ${unit.name} (${unit.guid}): ${e.message}`;
      log(errMsg);
      errors.push(errMsg);
    }
  }

  log(`Done. Pulled ${units.length} units, ${errors.length} errors.`);
  return { units, errors };
}

// ── Matching & saving (unchanged) ──────────────────────────────────────────

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
      if (!best || score > best.score) best = { id: String(listing.id), score };
    }
    return {
      ezUnit: unit,
      hostawayId: best && best.score >= 0.3 ? best.id : null,
      matchScore: best?.score ?? 0,
    };
  });
}

export function saveEZCareData(
  matched: ReturnType<typeof matchEZCareToHostaway>
): { saved: number; skipped: number } {
  let saved = 0, skipped = 0;
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
