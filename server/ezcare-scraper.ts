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

function extractLinks(html: string, _pattern: RegExp): Array<{ guid: string; name: string }> {
  // EZCare property list has 3 propertyDetailV2 links per unit:
  //   1. numeric ID (e.g. "560564")
  //   2. internal code (e.g. "CO.VA.5020MainGorePl.A29")
  //   3. human address (e.g. "5020 Main Gore Place 29")  <-- best for matching
  // We collect all three and keep the longest text (the address) per GUID.
  const byGuid = new Map<string, { guid: string; name: string }>();
  const linkRe = /<a\s[^>]*href="([^"]*propertyDetailV2[^"]*[?&]Id=([a-f0-9\-]{36})[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const guid = m[2];
    const text = m[3].replace(/<[^>]+>/g, "").trim();
    const existing = byGuid.get(guid);
    // Keep the longest name (the human-readable address)
    if (!existing || text.length > existing.name.length) {
      byGuid.set(guid, { guid, name: text });
    }
  }
  return Array.from(byGuid.values());
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
  onProgress?: (msg: string) => void,
  onBatch?: (batch: EZCareUnit[]) => void
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

  // ── Get unit list (paginated via ASP.NET postback) ──────────────────────
  // EZCare shows 100 units per page. Pages 2+ require a __doPostBack POST.
  log("Loading units list...");
  let currentPageHtml = await httpGet(EZCARE_UNITS_URL, jar);
  if (currentPageHtml.includes("login.aspx")) throw new Error("Session expired fetching unit list");

  const allUnitMap = new Map<string, string>(); // guid -> name
  let pageNum = 1;

  while (true) {
    log(`Collecting unit list page ${pageNum}...`);
    const pageLinks = extractLinks(currentPageHtml, /[?&]Id=([a-f0-9\-]{36})/i);
    let newOnPage = 0;
    for (const u of pageLinks) {
      if (!allUnitMap.has(u.guid)) { allUnitMap.set(u.guid, u.name); newOnPage++; }
    }
    log(`Page ${pageNum}: ${pageLinks.length} units, ${newOnPage} new. Total so far: ${allUnitMap.size}`);

    // Check if there's a next page in the ASP.NET pager
    const nextPageNum = pageNum + 1;
    const hasNextPage = currentPageHtml.includes(`'_ctl0$Main$PropertyListAspNetPager','${nextPageNum}'`);
    if (!hasNextPage) break;

    // POST the ASP.NET postback to navigate to next page
    const vs = extractHidden(currentPageHtml, "__VIEWSTATE");
    const vsg2 = extractHidden(currentPageHtml, "__VIEWSTATEGENERATOR");
    const pp = extractHidden(currentPageHtml, "__PREVIOUSPAGE");
    const pagerBody = new URLSearchParams({
      __EVENTTARGET: "_ctl0$Main$PropertyListAspNetPager",
      __EVENTARGUMENT: String(nextPageNum),
      __LASTFOCUS: "",
      __VIEWSTATE: vs,
      __VIEWSTATEGENERATOR: vsg2,
      __PREVIOUSPAGE: pp,
      Main_ddlUnitStatus: "",
      Main_ddlJobStatus: "",
      Main_ddlLocation: "",
      Main_ddlZone: "",
      Main_ddlUnitGroup: "",
      Main_txtSearch: "",
    }).toString();
    const { html: nextHtml } = await httpPost(EZCARE_UNITS_URL, pagerBody, jar, EZCARE_UNITS_URL);
    if (nextHtml.includes("login.aspx")) break;
    currentPageHtml = nextHtml;
    pageNum++;
  }

  const uniqueUnits = Array.from(allUnitMap.entries()).map(([guid, name]) => ({ guid, name }));

  // ── Pull each unit detail — concurrent batches ──────────────────
  const CONCURRENCY = 5; // Keep memory low on Render's 512MB free tier

  log(`Found ${uniqueUnits.length} units. Starting detail pull (concurrent batches of ${CONCURRENCY})...`);

  async function fetchUnitDetail(unit: { guid: string; name: string }, index: number): Promise<EZCareUnit | null> {
    try {
      log(`[${index + 1}/${uniqueUnits.length}] Pulling: ${unit.name || unit.guid}`);
      const detailUrl = `${EZCARE_DETAIL_BASE}/propertyDetailV2.aspx?Id=${unit.guid}&b=s`;
      const html = await httpGet(detailUrl, jar);

      if (html.includes("login.aspx")) {
        errors.push(`Session expired at unit ${index + 1}`);
        return null;
      }

      const doorCode = extractInputValue(html, "Main_hiddenDOORCODE") || extractFieldByLabel(html, ["Door Code"]);
      const gateCode = extractRepeaterFieldByCode(html, "GATECODE") || extractFieldByLabel(html, ["Gate Code"]);
      const lockboxCode = extractRepeaterFieldByCode(html, "LOCKBOXCODE") || extractFieldByLabel(html, ["Lockbox Code"]);
      const lockboxLocation = extractRepeaterFieldByCode(html, "LockboxLocation") || extractFieldByLabel(html, ["Lockbox Location"]);
      const amenitiesCode = extractRepeaterFieldByCode(html, "ComAmenAccessCode") || extractFieldByLabel(html, ["Amenities"]);
      const adminNote = extractTextareaValue(html, "Main_TxtAdminUnitNote") || findLargestTextarea(html);
      const parsed = parseAdminNote(adminNote);

      return {
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
      };
    } catch (e: any) {
      const errMsg = `Error pulling ${unit.name} (${unit.guid}): ${e.message}`;
      log(errMsg);
      errors.push(errMsg);
      return null;
    }
  }

  for (let i = 0; i < uniqueUnits.length; i += CONCURRENCY) {
    const batch = uniqueUnits.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((u, j) => fetchUnitDetail(u, i + j)));
    const batchUnits: EZCareUnit[] = [];
    for (const r of results) { if (r) { units.push(r); batchUnits.push(r); } }
    log(`Batch done: ${Math.min(i + CONCURRENCY, uniqueUnits.length)}/${uniqueUnits.length} units processed`);
    // Fire incremental save callback so data is persisted progressively
    if (batchUnits.length > 0 && onBatch) onBatch(batchUnits);
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
  // Decode EZCare internal codes like CO.AVO.15HIGHLANDSLN.309 -> "15 highlands ln 309"
  function decodeEZCode(s: string): string {
    // Strip state prefix (CO.XXX.) then split on dots/uppercase boundaries
    const stripped = s.replace(/^[A-Z]{2}\.[A-Z]+\./, "");
    return stripped.replace(/\./, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
  function scoreMatch(a: string, b: string): number {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    const wa = new Set(na.split(" ").filter(w => w.length > 1));
    const wb = new Set(nb.split(" ").filter(w => w.length > 1));
    const intersection = [...wa].filter(w => wb.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union > 0 ? intersection / union : 0;
  }
  return ezUnits.map(unit => {
    // Build all name variants for this EZCare unit to match against
    const ezVariants = [unit.name, decodeEZCode(unit.name)];
    let best: { id: string; score: number } | null = null;
    for (const listing of hostawayListings) {
      for (const ezName of ezVariants) {
        const nameScore = scoreMatch(ezName, listing.name);
        const addrScore = listing.address ? scoreMatch(ezName, listing.address) : 0;
        const score = Math.max(nameScore, addrScore);
        if (!best || score > best.score) best = { id: String(listing.id), score };
      }
    }
    return {
      ezUnit: unit,
      hostawayId: best && best.score >= 0.25 ? best.id : null,
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
