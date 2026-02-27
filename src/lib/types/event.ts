export type EventReminder = {
  minutesBefore: number;
};

export type EventDraft = {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timezone: string;
  reminders: EventReminder[];
  confidence: number;
  questions?: string[];
};

export type ParseResult = {
  draft?: EventDraft;
  question?: string;
};
