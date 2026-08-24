# VIIMsignal 운영 데이터 전환 — 1차 구현 기록

## 이번 구현 범위

v2.0 계획의 첫 번째 수직 슬라이스인 **판매 CSV/XLSX → 미리보기 → 검증 → 중복 제거 적재 → 판매 허브 집계**를 구현했다. Google Sheets는 이 공통 적재 기반이 검증된 다음 단계로 유지한다.

## 기존 구조 감사 결과

| 영역 | 기존 상태 | 이번 변경 |
|---|---|---|
| 인증·조직 격리 | Supabase Auth, membership, RLS/페이지 권한 구현 | 유지 |
| 재고 파일 | CSV/XLSX 파싱, 서버 검증, 원본 저장, 오류 격리 구현 | 공통 업로드 API로 호환 유지 |
| 판매 파일 | 미구현 | 필수 5개 컬럼, 한/영 alias, 실제 preview/적재 구현 |
| 중복 방지 | 재고 snapshot 자연키 upsert만 존재 | 파일 SHA-256 중복 차단 + 주문/라인 source key upsert |
| 판매 집계 | `query_sales_dashboard` RPC 구현 | 업로드 결과가 같은 fact와 RPC로 연결 |
| 데이터 모드 | UI가 샘플과 실제 값을 혼합할 수 있음 | `sample / connected / stale` 분리 및 출처·시각 표시 |
| 연결 관리 | 대부분 하드코딩 | 실제 `data_sources` 목록, 상태, 마지막 정상 동기화 표시 |

## 판매 파일 계약

필수:

- `sold_at`: 판매/주문 시각
- `channel_code`: 판매 채널
- `sku_code`: SKU/상품 코드
- `quantity`: 판매 수량, 0보다 커야 함
- `net_sales`: 순매출/실결제금액, 0 이상

선택:

- 매장 코드·명, 상품명, 카테고리
- 주문번호, 주문상세번호
- 국가·통화 코드
- 원천 수정 시각

샘플 파일: `assets/templates/VIIMsignal_Sales_Import_Template.csv`

## 중복 및 재처리 규칙

1. 원본 파일 SHA-256이 조직·entity 단위로 이미 완료됐다면 다시 적재하지 않는다.
2. 주문번호가 있으면 `organization + source + source_order_id`를 주문 자연키로 사용한다.
3. 주문상세번호가 있으면 주문 내부 line 자연키로 사용한다.
4. 번호가 없으면 날짜·채널·매장·행 번호 기반 fallback identity를 만든다. 이 fallback은 같은 형식의 파일 수정 재업로드에는 안정적이지만 행 순서가 바뀌면 달라질 수 있으므로 운영 연동에서는 원천 주문번호를 권장한다.
5. 실패해도 기존 fact는 삭제하지 않으며 source를 `stale`로 표시하고 마지막 정상 동기화 시각을 유지한다.

## 자동 마스터 정책

1차 데모에서는 판매 파일에 처음 등장한 상품/SKU/매장을 자동 생성한다.

- 상품 코드: SKU 코드
- 상품명: 제공 값, 없으면 SKU 코드
- 매장 유형: `store`
- 생성 근거: `created_from: sales_file`

실운영 전에는 회사별로 `자동 생성 / 격리 / 업로드 차단` 정책을 설정값으로 분리한다.

## 화면 상태 규칙

- `sample`: 하드코딩/데모 생성 데이터. 실제 고객 데이터와 혼합 금지.
- `preview`: 저장 전 실제 파일 분석 결과. 화면 안에서만 존재.
- `connected`: 마지막 정상 적재 결과를 RPC로 집계.
- `stale`: 최근 동기화 실패. 마지막 정상 결과를 유지하고 지연 상태 표시.

## DB 적용

`supabase/migrations/0007_operational_ingestion.sql`을 기존 `0001`~`0006` 다음에 적용해야 한다. 적용 전에는 신규 upload endpoint가 추가 컬럼을 찾지 못하므로 배포 순서는 다음과 같다.

1. DB migration `0007` 적용
2. Vercel API/프론트 배포
3. 판매 CSV preview
4. 1차 import 후 판매 허브 변화 확인
5. 동일 파일 재업로드 후 `duplicate: true`와 미중복 집계 확인

## 다음 구현 순서

1. 실제 회사 판매 파일로 alias/변환 규칙 보강
2. 재고 파일에도 자동 마스터 정책 선택 옵션 추가
3. Google Sheets adapter가 동일 validation/import service를 호출하도록 연결
4. import job 상세/오류 CSV 다운로드
5. 시간대/매장/상품별 aggregate cache 및 증분 갱신
