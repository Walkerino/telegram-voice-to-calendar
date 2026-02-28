declare module "luxon" {
  export class DateTime {
    static now(): DateTime;
    static fromJSDate(date: Date, options?: { zone?: string }): DateTime;
    static fromISO(text: string, options?: { zone?: string }): DateTime;

    readonly isValid: boolean;
    readonly weekday: number;

    plus(duration: { days?: number; hours?: number; minutes?: number }): DateTime;
    startOf(unit: string): DateTime;
    set(values: { hour?: number; minute?: number; second?: number; millisecond?: number }): DateTime;
    setZone(zone: string): DateTime;
    toUTC(): DateTime;
    toISO(): string | null;
    toFormat(format: string): string;
    valueOf(): number;
  }
}
