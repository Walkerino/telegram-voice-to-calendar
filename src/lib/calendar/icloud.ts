export type ICloudCredentials = {
  appleId: string;
  encryptedAppPassword: string;
};

export interface ICloudCalendarClient {
  discoverPrincipalUrl(credentials: ICloudCredentials): Promise<string>;
  createEventIcs(options: {
    principalUrl: string;
    calendarUrl: string;
    uid: string;
    ics: string;
  }): Promise<void>;
}

// TODO(stage2): Implement CalDAV discovery + PUT event.
