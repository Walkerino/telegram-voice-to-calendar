import { InlineKeyboard } from "grammy";

export function buildDraftKeyboard(messageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Save / Create", `create:${messageId}`)
    .text("✏️ Edit", `edit:${messageId}`)
    .row()
    .text("🗑 Cancel", `cancel:${messageId}`);
}

export function parseAction(data: string): { action: "create" | "edit" | "cancel"; messageId: string } | null {
  const match = data.match(/^(create|edit|cancel):([a-zA-Z0-9_-]+)$/);
  if (!match) {
    return null;
  }

  return {
    action: match[1] as "create" | "edit" | "cancel",
    messageId: match[2]
  };
}
