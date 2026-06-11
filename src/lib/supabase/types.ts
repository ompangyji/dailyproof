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

// 업로드 자산의 처리 상태 + 후처리 메타데이터 (비동기 파이프라인).
export type ProofAsset = {
  id: string;
  user_id: string;
  source_path: string;
  kind: "doits" | "pages" | null;
  status: "uploaded" | "processing" | "ready" | "failed";
  content_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  thumb_path: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

// 자산당 후처리 작업 큐. proof_assets insert 시 트리거가 자동 생성.
export type Job = {
  id: string;
  asset_id: string;
  user_id: string;
  type: string;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};
