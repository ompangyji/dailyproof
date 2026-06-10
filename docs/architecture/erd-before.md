# ERD — 통합 전 (기존 6개 테이블)

비동기 파이프라인(proof_assets/jobs) 통합 **전**의 DB 구조.
습관/기록 도메인이며, 모든 사용자 데이터는 `auth.users` 소유로 RLS owner-only가 걸린다.

기준: `supabase/schema.sql` · 짝 문서: [erd-after.md](./erd-after.md)

> `auth_users`는 Supabase 내장 `auth.users`(우리 스키마 밖, 모든 소유 FK의 대상)를 가리킨다.

```mermaid
erDiagram
    auth_users ||--o{ activity_templates : owns
    auth_users ||--o{ activity_logs : owns
    auth_users ||--o{ doits : owns
    auth_users ||--o{ pages : owns
    auth_users ||--|| user_preferences : has
    auth_users ||--o{ trackers : owns
    activity_templates ||--o{ activity_logs : "logged as"
    activity_templates ||--o{ pages : "has page"

    auth_users {
        uuid id PK
    }
    activity_templates {
        uuid id PK
        uuid user_id FK
        text title
        text[] tags
        int sort_order
    }
    activity_logs {
        uuid id PK
        uuid user_id FK
        uuid template_id FK
        date log_date
    }
    doits {
        uuid id PK
        uuid user_id FK
        text title
        text[] image_urls
        text[] tags
        date doit_date
    }
    pages {
        uuid template_id PK
        date log_date PK
        uuid user_id FK
        jsonb content
    }
    user_preferences {
        uuid user_id PK
        text[] custom_colors
        text[] custom_tags
    }
    trackers {
        uuid id PK
        uuid user_id FK
        text name
        text[] tags
        bool include_doits
        text token UK
    }
```

요약: 활동 정의(`activity_templates`) ↔ 날짜별 기록(`activity_logs`)·페이지(`pages`), 일회성 기록(`doits`), 사용자 설정(`user_preferences`), 외부 임베드용 잔디 정의(`trackers`). 이미지 업로드는 `doits.image_urls`(text 경로 배열)로만 들고 있고 **처리 상태/메타데이터 개념이 없다.**
