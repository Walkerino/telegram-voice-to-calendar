import { buildIcs } from "@/lib/services/ics";
import type { EventDraft } from "@/lib/types/event";
import { DateTime } from "luxon";

const DEFAULT_CALDAV_BASE_URL = "https://caldav.icloud.com";

const PRINCIPAL_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

const CALENDAR_HOME_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <c:calendar-home-set />
    <cs:calendar-home-set />
  </d:prop>
</d:propfind>`;

const CALENDARS_LIST_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;

export type ICloudCredentials = {
  appleId: string;
  appSpecificPassword: string;
  baseUrl?: string;
};

export type ICloudCreateEventOptions = {
  uid: string;
  draft: EventDraft;
  credentials: ICloudCredentials;
  calendarName?: string;
};

export type ICloudUpdateEventOptions = {
  uid: string;
  draft: EventDraft;
  credentials: ICloudCredentials;
  calendarName?: string;
  calendarUrl?: string;
  eventUrl?: string;
  etag?: string;
};

export type ICloudDeleteEventOptions = {
  uid: string;
  credentials: ICloudCredentials;
  calendarName?: string;
  calendarUrl?: string;
  eventUrl?: string;
  etag?: string;
};

export type ICloudFetchEventsOptions = {
  credentials: ICloudCredentials;
  calendarName?: string;
  calendarUrl?: string;
  from: Date;
  to: Date;
};

export type ICloudCreateEventResult = {
  principalUrl: string;
  calendarUrl: string;
  eventUrl: string;
  etag?: string;
};

export type ICloudUpsertEventResult = ICloudCreateEventResult & {
  created: boolean;
};

export type ICloudDeleteEventResult = {
  calendarUrl: string;
  eventUrl: string;
  deleted: boolean;
};

export type ICloudFetchedEvent = {
  uid: string;
  summary: string;
  start: string;
  end?: string;
  eventUrl: string;
  etag?: string;
  rawIcs: string;
};

export type ICloudFetchEventsResult = {
  calendarUrl: string;
  events: ICloudFetchedEvent[];
};

export interface ICloudCalendarClient {
  discoverPrincipalUrl(credentials: ICloudCredentials): Promise<string>;
  discoverCalendarUrl(options: {
    credentials: ICloudCredentials;
    principalUrl?: string;
    calendarName?: string;
  }): Promise<string>;
  createEventIcs(options: {
    credentials: ICloudCredentials;
    calendarUrl: string;
    uid: string;
    ics: string;
  }): Promise<{ eventUrl: string; etag?: string }>;
  upsertEventIcs(options: {
    credentials: ICloudCredentials;
    uid: string;
    ics: string;
    calendarUrl?: string;
    eventUrl?: string;
    etag?: string;
  }): Promise<{ eventUrl: string; etag?: string; created: boolean }>;
  deleteEvent(options: {
    credentials: ICloudCredentials;
    uid: string;
    calendarUrl?: string;
    eventUrl?: string;
    etag?: string;
  }): Promise<{ eventUrl: string; deleted: boolean }>;
  queryEvents(options: {
    credentials: ICloudCredentials;
    calendarUrl: string;
    from: Date;
    to: Date;
  }): Promise<ICloudFetchedEvent[]>;
}

export class CalDavICloudClient implements ICloudCalendarClient {
  async discoverPrincipalUrl(credentials: ICloudCredentials): Promise<string> {
    const baseUrl = normalizeBaseUrl(credentials.baseUrl);
    const responseXml = await propfind({
      url: baseUrl,
      depth: "0",
      body: PRINCIPAL_PROPFIND_BODY,
      credentials
    });

    const principalHref = findHrefInsideProperty(responseXml, "current-user-principal");
    if (!principalHref) {
      throw new Error("iCloud CalDAV: current-user-principal not found");
    }

    return absolutizeHref(principalHref, baseUrl);
  }

  async discoverCalendarUrl(options: {
    credentials: ICloudCredentials;
    principalUrl?: string;
    calendarName?: string;
  }): Promise<string> {
    const baseUrl = normalizeBaseUrl(options.credentials.baseUrl);
    const principalUrl = options.principalUrl ?? (await this.discoverPrincipalUrl(options.credentials));

    const principalXml = await propfind({
      url: principalUrl,
      depth: "0",
      body: CALENDAR_HOME_PROPFIND_BODY,
      credentials: options.credentials
    });

    const homeHref = findHrefInsideProperty(principalXml, "calendar-home-set");
    if (!homeHref) {
      throw new Error(`iCloud CalDAV: calendar-home-set not found (${principalXml.slice(0, 300)})`);
    }

    const homeUrl = absolutizeHref(homeHref, baseUrl);

    const calendarsXml = await propfind({
      url: homeUrl,
      depth: "1",
      body: CALENDARS_LIST_PROPFIND_BODY,
      credentials: options.credentials
    });

    const calendars = parseCalendarsFromMultistatus(calendarsXml, baseUrl);
    if (calendars.length === 0) {
      throw new Error("iCloud CalDAV: no writable calendars discovered");
    }

    const preferred = options.calendarName?.trim().toLowerCase();
    if (preferred) {
      const match = calendars.find((item) => item.displayName.toLowerCase() === preferred);
      if (match) {
        return ensureTrailingSlash(match.url);
      }
    }

    return ensureTrailingSlash(calendars[0].url);
  }

  async createEventIcs(options: {
    credentials: ICloudCredentials;
    calendarUrl: string;
    uid: string;
    ics: string;
  }): Promise<{ eventUrl: string; etag?: string }> {
    const result = await this.upsertEventIcs({
      credentials: options.credentials,
      calendarUrl: options.calendarUrl,
      uid: options.uid,
      ics: options.ics
    });

    return { eventUrl: result.eventUrl, etag: result.etag };
  }

  async upsertEventIcs(options: {
    credentials: ICloudCredentials;
    uid: string;
    ics: string;
    calendarUrl?: string;
    eventUrl?: string;
    etag?: string;
  }): Promise<{ eventUrl: string; etag?: string; created: boolean }> {
    const eventUrl = resolveEventUrl(options.uid, options.calendarUrl, options.eventUrl);
    const response = await putIcs({
      url: eventUrl,
      credentials: options.credentials,
      ics: options.ics,
      etag: options.etag
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 300);
      throw new Error(`iCloud CalDAV PUT failed: ${response.status} ${response.statusText} ${details}`);
    }

    return {
      eventUrl,
      etag: response.headers.get("etag") ?? undefined,
      created: response.status === 201
    };
  }

  async deleteEvent(options: {
    credentials: ICloudCredentials;
    uid: string;
    calendarUrl?: string;
    eventUrl?: string;
    etag?: string;
  }): Promise<{ eventUrl: string; deleted: boolean }> {
    const eventUrl = resolveEventUrl(options.uid, options.calendarUrl, options.eventUrl);
    const response = await deleteResource({
      url: eventUrl,
      credentials: options.credentials,
      etag: options.etag
    });

    if (response.status === 404 || response.status === 410) {
      return { eventUrl, deleted: false };
    }

    if (!response.ok) {
      const details = (await response.text()).slice(0, 300);
      throw new Error(`iCloud CalDAV DELETE failed: ${response.status} ${response.statusText} ${details}`);
    }

    return { eventUrl, deleted: true };
  }

  async queryEvents(options: {
    credentials: ICloudCredentials;
    calendarUrl: string;
    from: Date;
    to: Date;
  }): Promise<ICloudFetchedEvent[]> {
    const calendarUrl = ensureTrailingSlash(options.calendarUrl);
    const xml = await report({
      url: calendarUrl,
      depth: "1",
      body: buildCalendarQueryBody(options.from, options.to),
      credentials: options.credentials
    });

    return parseEventsFromMultistatus(xml, calendarUrl);
  }
}

export async function createICloudEventFromDraft(options: ICloudCreateEventOptions): Promise<ICloudCreateEventResult> {
  const client = new CalDavICloudClient();
  const principalUrl = await client.discoverPrincipalUrl(options.credentials);
  const calendarUrl = await client.discoverCalendarUrl({
    credentials: options.credentials,
    principalUrl,
    calendarName: options.calendarName
  });
  const ics = buildIcs({ uid: options.uid, draft: options.draft });
  const created = await client.createEventIcs({
    credentials: options.credentials,
    calendarUrl,
    uid: options.uid,
    ics
  });

  return { principalUrl, calendarUrl, eventUrl: created.eventUrl, etag: created.etag };
}

export async function updateICloudEventFromDraft(options: ICloudUpdateEventOptions): Promise<ICloudUpsertEventResult> {
  const client = new CalDavICloudClient();
  const resolved = await resolveCalendarLocation(client, {
    credentials: options.credentials,
    calendarName: options.calendarName,
    calendarUrl: options.calendarUrl,
    eventUrl: options.eventUrl
  });
  const ics = buildIcs({ uid: options.uid, draft: options.draft });
  const updated = await client.upsertEventIcs({
    credentials: options.credentials,
    uid: options.uid,
    ics,
    calendarUrl: resolved.calendarUrl,
    eventUrl: options.eventUrl,
    etag: options.etag
  });

  return {
    principalUrl: resolved.principalUrl,
    calendarUrl: resolved.calendarUrl,
    eventUrl: updated.eventUrl,
    etag: updated.etag,
    created: updated.created
  };
}

export async function deleteICloudEvent(options: ICloudDeleteEventOptions): Promise<ICloudDeleteEventResult> {
  const client = new CalDavICloudClient();
  const resolved = await resolveCalendarLocation(client, {
    credentials: options.credentials,
    calendarName: options.calendarName,
    calendarUrl: options.calendarUrl,
    eventUrl: options.eventUrl
  });
  const result = await client.deleteEvent({
    credentials: options.credentials,
    uid: options.uid,
    calendarUrl: resolved.calendarUrl,
    eventUrl: options.eventUrl,
    etag: options.etag
  });

  return {
    calendarUrl: resolved.calendarUrl,
    eventUrl: result.eventUrl,
    deleted: result.deleted
  };
}

export async function fetchICloudEvents(options: ICloudFetchEventsOptions): Promise<ICloudFetchEventsResult> {
  const client = new CalDavICloudClient();
  const resolved = await resolveCalendarLocation(client, {
    credentials: options.credentials,
    calendarName: options.calendarName,
    calendarUrl: options.calendarUrl
  });
  const events = await client.queryEvents({
    credentials: options.credentials,
    calendarUrl: resolved.calendarUrl,
    from: options.from,
    to: options.to
  });

  return {
    calendarUrl: resolved.calendarUrl,
    events
  };
}

function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? DEFAULT_CALDAV_BASE_URL).trim();
  if (!normalized) {
    return DEFAULT_CALDAV_BASE_URL;
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function propfind(options: {
  url: string;
  depth: "0" | "1";
  body: string;
  credentials: ICloudCredentials;
}): Promise<string> {
  const response = await fetch(options.url, {
    method: "PROPFIND",
    headers: {
      Authorization: toBasicAuthHeader(options.credentials),
      Depth: options.depth,
      "Content-Type": "application/xml; charset=utf-8"
    },
    body: options.body
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`iCloud CalDAV PROPFIND failed: ${response.status} ${response.statusText} ${xml.slice(0, 300)}`);
  }

  return xml;
}

async function report(options: {
  url: string;
  depth: "0" | "1";
  body: string;
  credentials: ICloudCredentials;
}): Promise<string> {
  const response = await fetch(options.url, {
    method: "REPORT",
    headers: {
      Authorization: toBasicAuthHeader(options.credentials),
      Depth: options.depth,
      "Content-Type": "application/xml; charset=utf-8"
    },
    body: options.body
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`iCloud CalDAV REPORT failed: ${response.status} ${response.statusText} ${xml.slice(0, 300)}`);
  }

  return xml;
}

async function putIcs(options: {
  url: string;
  credentials: ICloudCredentials;
  ics: string;
  etag?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: toBasicAuthHeader(options.credentials),
    "Content-Type": "text/calendar; charset=utf-8"
  };

  if (options.etag?.trim()) {
    headers["If-Match"] = options.etag.trim();
  }

  const firstAttempt = await fetch(options.url, {
    method: "PUT",
    headers,
    body: options.ics
  });

  if (firstAttempt.status === 412 && headers["If-Match"]) {
    const retryHeaders = { ...headers };
    delete retryHeaders["If-Match"];
    return fetch(options.url, {
      method: "PUT",
      headers: retryHeaders,
      body: options.ics
    });
  }

  return firstAttempt;
}

async function deleteResource(options: {
  url: string;
  credentials: ICloudCredentials;
  etag?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: toBasicAuthHeader(options.credentials)
  };

  if (options.etag?.trim()) {
    headers["If-Match"] = options.etag.trim();
  }

  const firstAttempt = await fetch(options.url, {
    method: "DELETE",
    headers
  });

  if (firstAttempt.status === 412 && headers["If-Match"]) {
    const retryHeaders = { ...headers };
    delete retryHeaders["If-Match"];
    return fetch(options.url, {
      method: "DELETE",
      headers: retryHeaders
    });
  }

  return firstAttempt;
}

function toBasicAuthHeader(credentials: ICloudCredentials): string {
  const token = Buffer.from(`${credentials.appleId}:${credentials.appSpecificPassword}`, "utf-8").toString("base64");
  return `Basic ${token}`;
}

function findHrefInsideProperty(xml: string, propertyName: string): string | null {
  const propertyRegex = new RegExp(
    `<(?:\\w+:)?${escapeRegex(propertyName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegex(propertyName)}>`,
    "gi"
  );

  for (const match of xml.matchAll(propertyRegex)) {
    const innerXml = match[1];
    const hrefMatch = innerXml.match(/<(?:\w+:)?href[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i);
    if (!hrefMatch) {
      continue;
    }
    return decodeXmlText(hrefMatch[1].trim());
  }

  return null;
}

function parseCalendarsFromMultistatus(xml: string, baseUrl: string): Array<{ url: string; displayName: string }> {
  const responseBlocks = xml.match(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi) ?? [];
  const calendars: Array<{ url: string; displayName: string }> = [];

  for (const block of responseBlocks) {
    if (!/<(?:\w+:)?calendar\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?calendar>)/i.test(block)) {
      continue;
    }

    const hrefMatch = block.match(/<(?:\w+:)?href[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i);
    if (!hrefMatch) {
      continue;
    }

    const displayMatch = block.match(/<(?:\w+:)?displayname[^>]*>([\s\S]*?)<\/(?:\w+:)?displayname>/i);
    const url = absolutizeHref(decodeXmlText(hrefMatch[1].trim()), baseUrl);
    const displayName = decodeXmlText((displayMatch?.[1] ?? "").trim()) || "Calendar";

    calendars.push({ url, displayName });
  }

  return calendars;
}

function parseEventsFromMultistatus(xml: string, baseUrl: string): ICloudFetchedEvent[] {
  const responseBlocks = xml.match(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi) ?? [];
  const events: ICloudFetchedEvent[] = [];

  for (const block of responseBlocks) {
    const hrefMatch = block.match(/<(?:\w+:)?href[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i);
    const calendarDataMatch = block.match(
      /<(?:\w+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:\w+:)?calendar-data>/i
    );
    if (!hrefMatch || !calendarDataMatch) {
      continue;
    }

    const rawIcs = decodeXmlText(calendarDataMatch[1].trim());
    const parsed = parseFirstVevent(rawIcs);
    if (!parsed) {
      continue;
    }

    const etagMatch = block.match(/<(?:\w+:)?getetag[^>]*>([\s\S]*?)<\/(?:\w+:)?getetag>/i);
    events.push({
      uid: parsed.uid,
      summary: parsed.summary,
      start: parsed.start,
      end: parsed.end,
      eventUrl: absolutizeHref(decodeXmlText(hrefMatch[1].trim()), baseUrl),
      etag: etagMatch ? decodeXmlText(etagMatch[1].trim()) : undefined,
      rawIcs
    });
  }

  return events;
}

function parseFirstVevent(ics: string): { uid: string; summary: string; start: string; end?: string } | null {
  const lines = unfoldIcsLines(ics);
  const eventLines: string[] = [];
  let inEvent = false;

  for (const line of lines) {
    const normalized = line.trim();
    if (normalized.toUpperCase() === "BEGIN:VEVENT") {
      inEvent = true;
      continue;
    }
    if (normalized.toUpperCase() === "END:VEVENT") {
      break;
    }
    if (inEvent) {
      eventLines.push(line);
    }
  }

  if (eventLines.length === 0) {
    return null;
  }

  const properties = eventLines.map(parseIcsProperty).filter((item): item is IcsProperty => Boolean(item));
  const uid = getPropertyValue(properties, "UID");
  const summary = unescapeIcsText(getPropertyValue(properties, "SUMMARY") ?? "Событие");
  const dtStart = getProperty(properties, "DTSTART");
  const dtEnd = getProperty(properties, "DTEND");
  if (!uid || !dtStart) {
    return null;
  }

  const start = parseIcsDateTime(dtStart.value, dtStart.params.TZID);
  if (!start) {
    return null;
  }

  const end = dtEnd ? parseIcsDateTime(dtEnd.value, dtEnd.params.TZID) ?? undefined : undefined;
  return { uid: uid.trim(), summary: summary.trim() || "Событие", start, end };
}

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

function parseIcsProperty(line: string): IcsProperty | null {
  const separator = line.indexOf(":");
  if (separator <= 0) {
    return null;
  }

  const left = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!left) {
    return null;
  }

  const [name, ...rawParams] = left.split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const idx = raw.indexOf("=");
    if (idx <= 0) {
      continue;
    }

    const key = raw.slice(0, idx).trim().toUpperCase();
    const paramValue = raw
      .slice(idx + 1)
      .trim()
      .replace(/^"|"$/g, "");

    if (key) {
      params[key] = paramValue;
    }
  }

  return {
    name: name.trim().toUpperCase(),
    params,
    value
  };
}

function getProperty(properties: IcsProperty[], name: string): IcsProperty | null {
  const needle = name.trim().toUpperCase();
  return properties.find((item) => item.name === needle) ?? null;
}

function getPropertyValue(properties: IcsProperty[], name: string): string | null {
  return getProperty(properties, name)?.value ?? null;
}

function unfoldIcsLines(ics: string): string[] {
  const source = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const result: string[] = [];

  for (const line of source.split("\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (result.length > 0) {
        result[result.length - 1] += line.slice(1);
      }
      continue;
    }

    result.push(line);
  }

  return result;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDateTime(raw: string, tzid?: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  const zone = tzid?.trim() || "utc";
  const withSecondsUtc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u);
  const withoutSecondsUtc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/u);
  const withSecondsLocal = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u);
  const withoutSecondsLocal = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/u);
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/u);

  let parsed: DateTime;
  if (withSecondsUtc) {
    parsed = DateTime.fromISO(
      `${withSecondsUtc[1]}-${withSecondsUtc[2]}-${withSecondsUtc[3]}T${withSecondsUtc[4]}:${withSecondsUtc[5]}:${withSecondsUtc[6]}Z`,
      { zone: "utc" }
    );
  } else if (withoutSecondsUtc) {
    parsed = DateTime.fromISO(
      `${withoutSecondsUtc[1]}-${withoutSecondsUtc[2]}-${withoutSecondsUtc[3]}T${withoutSecondsUtc[4]}:${withoutSecondsUtc[5]}:00Z`,
      { zone: "utc" }
    );
  } else if (withSecondsLocal) {
    parsed = DateTime.fromISO(
      `${withSecondsLocal[1]}-${withSecondsLocal[2]}-${withSecondsLocal[3]}T${withSecondsLocal[4]}:${withSecondsLocal[5]}:${withSecondsLocal[6]}`,
      { zone }
    );
  } else if (withoutSecondsLocal) {
    parsed = DateTime.fromISO(
      `${withoutSecondsLocal[1]}-${withoutSecondsLocal[2]}-${withoutSecondsLocal[3]}T${withoutSecondsLocal[4]}:${withoutSecondsLocal[5]}:00`,
      { zone }
    );
  } else if (dateOnly) {
    parsed = DateTime.fromISO(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00`, { zone });
  } else {
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) {
      return null;
    }
    parsed = DateTime.fromJSDate(new Date(millis), { zone: "utc" });
  }

  if (!parsed.isValid) {
    return null;
  }

  return parsed.toUTC().toISO() ?? null;
}

function buildCalendarQueryBody(from: Date, to: Date): string {
  const fromUtc = formatCalDavUtc(from);
  const toUtc = formatCalDavUtc(to);

  return `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fromUtc}" end="${toUtc}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

function formatCalDavUtc(value: Date): string {
  return DateTime.fromJSDate(value, { zone: "utc" }).toFormat("yyyyLLdd'T'HHmmss'Z'");
}

async function resolveCalendarLocation(
  client: CalDavICloudClient,
  options: {
    credentials: ICloudCredentials;
    calendarName?: string;
    calendarUrl?: string;
    eventUrl?: string;
  }
): Promise<{ principalUrl: string; calendarUrl: string }> {
  if (options.calendarUrl?.trim()) {
    return {
      principalUrl: "",
      calendarUrl: ensureTrailingSlash(options.calendarUrl.trim())
    };
  }

  if (options.eventUrl?.trim()) {
    return {
      principalUrl: "",
      calendarUrl: eventUrlToCalendarUrl(options.eventUrl.trim())
    };
  }

  const principalUrl = await client.discoverPrincipalUrl(options.credentials);
  const calendarUrl = await client.discoverCalendarUrl({
    credentials: options.credentials,
    principalUrl,
    calendarName: options.calendarName
  });
  return { principalUrl, calendarUrl };
}

function resolveEventUrl(uid: string, calendarUrl?: string, eventUrl?: string): string {
  if (eventUrl?.trim()) {
    return eventUrl.trim();
  }
  if (!calendarUrl?.trim()) {
    throw new Error("calendarUrl or eventUrl is required for CalDAV event operation");
  }
  return `${ensureTrailingSlash(calendarUrl.trim())}${encodeURIComponent(uid)}.ics`;
}

function eventUrlToCalendarUrl(eventUrl: string): string {
  try {
    const url = new URL(eventUrl);
    const pathname = url.pathname;
    const lastSlash = pathname.lastIndexOf("/");
    if (lastSlash <= 0) {
      throw new Error("Invalid event URL path");
    }

    url.pathname = `${pathname.slice(0, lastSlash + 1)}`;
    url.search = "";
    url.hash = "";
    return ensureTrailingSlash(url.toString());
  } catch {
    throw new Error(`Invalid event URL: ${eventUrl}`);
  }
}

function absolutizeHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    throw new Error(`Invalid CalDAV href: ${href}`);
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
