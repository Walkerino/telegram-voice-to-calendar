import { buildIcs } from "@/lib/services/ics";
import type { EventDraft } from "@/lib/types/event";

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

export type ICloudCreateEventResult = {
  principalUrl: string;
  calendarUrl: string;
  eventUrl: string;
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
  }): Promise<string>;
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
  }): Promise<string> {
    const calendarUrl = ensureTrailingSlash(options.calendarUrl);
    const eventUrl = `${calendarUrl}${encodeURIComponent(options.uid)}.ics`;

    const response = await fetch(eventUrl, {
      method: "PUT",
      headers: {
        Authorization: toBasicAuthHeader(options.credentials),
        "Content-Type": "text/calendar; charset=utf-8"
      },
      body: options.ics
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 300);
      throw new Error(`iCloud CalDAV PUT failed: ${response.status} ${response.statusText} ${details}`);
    }

    return eventUrl;
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
  const eventUrl = await client.createEventIcs({
    credentials: options.credentials,
    calendarUrl,
    uid: options.uid,
    ics
  });

  return { principalUrl, calendarUrl, eventUrl };
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
