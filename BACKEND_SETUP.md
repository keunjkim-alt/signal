# VIIMsginal 백엔드 설정

## 구성

- Vercel Functions: `api/`
- Supabase Postgres/Auth/Storage: `supabase/migrations/`
- 정적 프론트엔드: 프로젝트 루트 파일과 `dist/`

현재 구현은 DB 없이 보이는 데모 모드와 Supabase가 연결된 운영 모드를 자동으로 구분합니다. 환경변수가 모두 있으면 실제 회사 계정 로그인을 요구하고, 없으면 기존 데모 계정과 샘플 데이터로 동작합니다.

## 1. Supabase 프로젝트

1. Supabase에서 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase/migrations/0001_fashion_ax_core.sql`부터 최신 migration까지 번호 순서대로 실행합니다. 운영 파일 적재 기능에는 `0007_operational_ingestion.sql`이 필요합니다.
3. 데모 단계에서는 `supabase/seed_demo.sql`을 실행해 45일 판매·재고 데이터를 적재합니다. 같은 스크립트를 다시 실행해도 VIIMsginal 데모 소스만 교체됩니다.
4. Authentication에서 회사 사용자를 생성합니다.
5. `organizations`, `profiles`, `organization_memberships`에 회사·사용자·역할을 등록합니다.

첫 번째 대표 계정은 Supabase Authentication에서 생성한 사용자 UUID로 `organization_memberships.role='owner'`를 한 번 등록해야 합니다. `supabase/bootstrap_owner.example.sql`을 복사해 UUID·회사명을 바꾸면 됩니다. 이후 계정은 서비스의 **사용자·권한 관리 → 회사 계정 초대**에서 추가할 수 있습니다.

사용자 역할은 `owner`, `admin`, `manager`, `member`, `viewer` 중 하나입니다. 모든 운영 테이블은 `organization_id`와 RLS 정책으로 회사 간 데이터가 분리됩니다. 일반 사용자는 `page_permissions`의 조회·업데이트·승인 권한을 따르며, `data_scope`의 `countries`, `channels`, `locations` 범위가 서버와 DB 집계 함수에서 모두 검사됩니다.

## 2. Vercel 환경변수

Vercel Project Settings → Environment Variables에 `.env.example`의 값을 등록합니다. `APP_URL`은 배포 도메인으로 설정합니다. `SUPABASE_SERVICE_ROLE_KEY`와 `OPENAI_API_KEY`는 브라우저 코드에 노출하지 않습니다.

## 3. API

| Endpoint | 용도 |
|---|---|
| `GET /api/health` | 백엔드·OpenAI 설정 확인 |
| `POST /api/auth/login` | Supabase 이메일 로그인 및 HttpOnly 세션 발급 |
| `GET /api/auth/session` | 현재 사용자·회사·역할 확인 |
| `POST /api/auth/logout` | 세션 제거 |
| `GET/POST /api/integrations/sources` | WMS·ERP·POS·채널 소스 관리 |
| `POST /api/uploads/data` | 판매·재고 CSV/XLSX 미리보기 및 표준 데이터 적재 |
| `GET/POST/PUT /api/permissions/users` | 회사 사용자 초대와 역할·페이지·데이터 범위 관리 |
| `POST /api/permissions/bulk` | CSV/XLSX로 사용자 일괄 초대·권한 등록 |
| `POST /api/dashboards/query` | 허용된 지표·차원 기반 분석 조회 |
| `GET /api/dashboards/overview` | 판매 허브용 채널·매장·제품·일자·재고 통합 조회 |
| `POST /api/ax/query` | 자연어 질문 → 안전한 분석/차트 명세 |
| `GET /api/ax/history` | 회사·사용자별 AX 대화 및 메시지 이력 조회 |
| `GET/POST /api/dashboards/query?resource=inventory-workflows` | 재고 이동·재주문 승인과 입고·배송 상태 이력 |

## 4. WMS 파일 업로드

`POST /api/uploads/data`는 `multipart/form-data`를 사용합니다. 기존 `/api/uploads/wms` 경로는 동일 엔드포인트로 호환 라우팅됩니다.

- `file`: CSV/XLSX 파일, 최대 20MB
- `mode`: `preview` 또는 `import`
- `entityType`: `auto`, `sales_order`, `inventory_snapshot`. `auto`는 미리보기에서만 허용되며 판매·재고 적합도를 비교한 추천 결과를 확인한 뒤 확정 유형으로 적재합니다.
- `sourceId`: 등록된 데이터 소스 UUID
- `mapping`: 선택적 JSON 컬럼 매핑

판매 필수 표준 필드는 `sold_at`, `channel_code`, `sku_code`, `quantity`, `net_sales`이며 재고 필수 표준 필드는 `sku_code`, `location_code`, `snapshot_at`, `available_qty`입니다. 재고 적재 전에 `skus`와 `locations` 마스터에 코드가 등록되어 있어야 하며, 누락 코드는 오류 행으로 격리됩니다.

원본 파일은 private Storage의 `raw-imports/{organization_id}/...`에 보관되고, 검증 결과는 `import_jobs`와 `import_errors`에 기록됩니다. 동일 SKU·위치·시각의 재고 스냅샷은 중복 생성하지 않고 upsert 됩니다.

## 5. AX 분석 방식

AX는 자연어를 SQL로 직접 변환하지 않습니다. OpenAI Responses API가 허용 목록의 `metric`, `dimension`, `visualization`, 기간과 필터만 포함한 JSON 분석 명세를 만들고, 서버가 Supabase RPC로 집계합니다. OpenAI 키가 없으면 동일한 허용 목록을 사용하는 규칙 기반 라우터로 대체됩니다.

- 판매: 순매출, 수량, 주문, 기여이익, 반품률
- 재고: 최신 가용재고, 판매속도 기반 재고 커버일, 소진율
- 차원: 일, 채널, 매장·위치, 제품
- 결과: 프론트가 자유롭게 렌더링할 수 있는 차트 JSON

AX 대화는 `organization_id`, `user_id`, `conversation_id`로 구분해 저장합니다. 따라서 회사 간 대화가 섞이지 않고, 한 사용자는 자신의 이전 대화를 다시 열어 질문을 이어갈 수 있습니다. 질문·답변뿐 아니라 사용된 분석 명세, 시각화 명세, 모델과 생성 출처도 함께 보관합니다.

OpenAI 연결은 Vercel 서버 환경변수에 `OPENAI_API_KEY`, `OPENAI_ROUTER_MODEL=gpt-5.6-luna`, `OPENAI_ROUTER_TIMEOUT_MS=8000`을 등록하면 활성화됩니다. AX 라우터는 원천 데이터를 모델에 보내지 않고 질문을 허용된 분석 명세로만 변환합니다. 8초를 넘기거나 일시적으로 혼잡하면 규칙 기반 라우터로 전환해 화면 응답을 계속 제공합니다. API 키는 회사별로 별도 보관하도록 확장할 수 있지만, 초기 운영은 서비스 서버 키 하나를 사용하고 조직·사용자별 사용량과 이력을 DB에서 분리하는 구성이 단순하고 안전합니다.

## 6. 사용자 일괄 등록

**사용자·권한 관리 → 사용자 일괄 등록**에서 CSV/XLSX 파일을 올릴 수 있습니다. 템플릿은 `assets/templates/user_bulk_template.csv`이며 다음 열을 사용합니다.

- `email` 또는 `이메일` (필수)
- `name` / `이름`
- `team` / `팀`
- `role` / `역할`: owner, admin, manager, member, viewer
- `pages` / `페이지`: 쉼표로 구분한 페이지 키

각 행의 사용자는 Supabase 초대 메일을 받고, 가입이 끝나면 동일 회사의 역할과 페이지 권한이 적용됩니다. 실패한 행은 성공 행과 분리되어 결과에 표시됩니다.

## 7. 로컬 검증

```bash
pnpm test
pnpm build
```

정적 개발 서버는 `pnpm dev`로 실행합니다. Vercel Functions까지 로컬에서 실행하려면 Vercel CLI의 `vercel dev`를 사용합니다.

Vercel 호환 빌드는 다음으로 확인합니다.

```bash
vercel build --yes
```

## 보안 원칙

- AI에 SQL 실행 권한을 주지 않습니다.
- AX 질문은 허용된 지표·차원·차트 JSON 명세로 변환합니다.
- 서비스 역할 키는 서버 함수에서만 사용합니다.
- 모든 회사 데이터는 `organization_id`와 RLS로 분리합니다.
- 업로드, 권한 변경, 승인 작업은 `audit_logs`에 기록합니다.
