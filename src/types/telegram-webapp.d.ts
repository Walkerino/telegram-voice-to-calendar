type TelegramMiniAppUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
};

type TelegramWindow = {
  WebApp: TelegramWebApp;
};

declare global {
  interface Window {
    Telegram?: TelegramWindow;
  }
}

export {};

