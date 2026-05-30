export type ActivityTemplate = {
  id: string;
  user_id: string;
  title: string;
  color: string | null;
  emoji: string | null;
  tags: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ActivityLog = {
  id: string;
  user_id: string;
  template_id: string;
  log_date: string; // YYYY-MM-DD
  created_at: string;
};

export type Doit = {
  id: string;
  user_id: string;
  title: string;
  emoji: string | null;
  memo: string | null;
  image_urls: string[];
  tags: string[];
  doit_date: string; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
};

export type UserPreferences = {
  user_id: string;
  custom_colors: string[];
  custom_tags: string[];
  updated_at: string;
};

export type Tracker = {
  id: string;
  user_id: string;
  name: string;
  tags: string[];
  include_doits: boolean;
  token: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Page = {
  template_id: string;
  log_date: string;
  user_id: string;
  content: unknown | null;
  content_text: string | null;
  created_at: string;
  updated_at: string;
};
