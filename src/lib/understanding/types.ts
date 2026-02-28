import type { InboxItemType, TaskPriority } from "@prisma/client";
import type { EventDraft } from "@/lib/types/event";

export type StructuredEventItem = {
  type: "event";
  event: EventDraft;
  tags: string[];
  nextAction: string;
};

export type StructuredTaskItem = {
  type: "task";
  task: {
    title: string;
    notes?: string;
    dueAt?: string;
    priority: TaskPriority;
    tags: string[];
    project?: string;
  };
  tags: string[];
  nextAction: string;
};

export type StructuredReminderItem = {
  type: "reminder";
  reminder: {
    remindAt: string;
    message: string;
    tags: string[];
  };
  tags: string[];
  nextAction: string;
};

export type StructuredNoteItem = {
  type: "note";
  note: {
    text: string;
    topic?: string;
    tags: string[];
  };
  tags: string[];
  nextAction: string;
};

export type StructuredJournalItem = {
  type: "journal";
  journal: {
    text: string;
    mood?: string;
    tags: string[];
  };
  tags: string[];
  nextAction: string;
};

export type StructuredItem =
  | StructuredEventItem
  | StructuredTaskItem
  | StructuredReminderItem
  | StructuredNoteItem
  | StructuredJournalItem;

export type ClassifyOutput = {
  type: InboxItemType;
  confidence: number;
  reason: string;
};

export type ParseStructuredInput = {
  text: string;
  type: InboxItemType;
  timezone: string;
  now?: Date;
};

export type ParseStructuredOutput = {
  item?: StructuredItem;
  question?: string;
  confidence: number;
};

export type DailyDigestInput = {
  date: Date;
  timezone: string;
  inboxItemsCount: number;
  openTasks: Array<{
    title: string;
    dueAt: Date | null;
    priority: TaskPriority;
    tags: string[];
  }>;
  remindersTomorrow: Array<{
    remindAt: Date;
    message: string;
  }>;
  tomorrowEvents: Array<{
    title: string;
    startAt: Date;
    endAt: Date;
  }>;
  recentNotes: Array<{
    text: string;
    tags: string[];
  }>;
};

export type DigestOutput = {
  message: string;
};
