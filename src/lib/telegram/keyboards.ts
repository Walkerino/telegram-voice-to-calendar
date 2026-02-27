import { InlineKeyboard } from "grammy";

export function buildDraftKeyboard(messageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Создать", `create:${messageId}`)
    .text("✏️ Изменить", `edit:${messageId}`)
    .row()
    .text("🗑 Отмена", `cancel:${messageId}`);
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
