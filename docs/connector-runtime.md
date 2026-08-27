# VIIMsignal 커넥터 실행 설정

## 지원 범위

- Google Sheets: 공개 읽기 시트 CSV를 직접 수집
- WMS/ERP: SFTP에 접근하는 사내·외부 HTTPS 게이트웨이를 통해 최신 파일 수집
- 채널 API: 서버에 등록된 계정별 API 엔드포인트에서 CSV 또는 JSON 행 배열 수집
- 공통 적재 유형: `product_master`, `sales_order`, `inventory_snapshot`
- 모든 수집 결과는 기존 파일 업로드와 동일하게 원본 보관, 컬럼 매핑, 행 검증, 중복 방지, 정합성 검사, 적재 이력, 감사 로그를 거친다.

## Vercel 환경변수

### `CRON_SECRET`

Vercel Cron이 자동 동기화 API를 호출할 때 사용하는 서버 전용 값이다. 충분히 긴 임의 문자열을 사용한다.

### `VIIMSIGNAL_CONNECTOR_CREDENTIALS`

DB에는 비밀번호나 토큰을 저장하지 않고 `credential_ref`만 저장한다. 실제 값은 아래 JSON을 Vercel의 암호화된 환경변수로 등록한다.

```json
{
  "wms-production": {
    "kind": "sftp_relay",
    "endpoint": "https://connector.company.com/sftp/pull",
    "token": "SERVER_ONLY_TOKEN"
  },
  "naver-production": {
    "kind": "channel_api",
    "endpoint": "https://connector.company.com/naver/orders",
    "token": "SERVER_ONLY_TOKEN",
    "response_path": "data.orders"
  }
}
```

SFTP 게이트웨이는 POST 요청으로 `host`, `port`, `remote_path`, `entity_type`을 받고 CSV 본문 또는 `{ "download_url": "https://..." }` JSON을 반환해야 한다.

채널 API 엔드포인트는 CSV 본문을 직접 반환하거나, `response_path`가 가리키는 JSON 행 배열을 반환해야 한다. API별 서명·토큰 갱신은 게이트웨이/어댑터에서 담당하며 VIIMsignal DB에는 원문 자격증명이 남지 않는다.

### `CONNECTOR_SYSTEM_USER_ID` (선택)

기존 소스에 `created_by`가 없는 경우 자동 동기화의 감사 로그 작성자로 사용할 Supabase Auth 사용자 UUID다. 새로 등록된 소스는 등록자를 사용하므로 일반적으로 필요하지 않다.

## 실행 흐름

1. 데이터 연결에서 소스를 등록한다.
2. `지금 동기화`로 첫 수집과 컬럼 검증을 확인한다.
3. 첫 적재 성공 시 소스가 `active / connected`로 전환된다.
4. Vercel Cron이 15분마다 예약 소스를 확인한다.
5. 각 소스의 `15분`, `1시간`, `매일 06:00` 주기가 지난 경우에만 동기화한다.
6. 실패하면 기존 정상 데이터는 유지하고 소스는 `error / stale`과 오류 메시지를 표시한다.

## WMS API가 없을 때의 베타 운영 경로

WMS API 계약 전에도 재고 운영과 재주문 검증을 진행할 수 있다. 데이터 입력원만 아래 우선순위로 바꾸고, 적재 이후의 정규화·재고 진단·이동 제안·재주문·생산오더 흐름은 동일하게 유지한다.

1. **재고 CSV/XLSX 업로드**: WMS에서 내려받은 일별 재고 파일을 데이터 연결 화면에 업로드한다. 베타의 기본 운영 경로다.
2. **Google Sheets 예약 동기화**: 동일 컬럼 구조의 재고표를 공개 읽기 시트로 관리하고 `inventory_snapshot` 소스로 연결한다.
3. **SFTP 파일 수집**: WMS가 API 대신 정기 파일을 제공하면 HTTPS 릴레이를 통해 최신 파일을 자동 수집한다.
4. **WMS API 전환**: API와 자격증명이 준비되면 기존 소스의 제공 방식만 교체한다. 표준 엔티티와 대시보드는 변경하지 않는다.

베타 필수 재고 컬럼은 `snapshot_date`, `store_code`, `sku_code`, `on_hand_qty`다. 가능하면 `available_qty`, `reserved_qty`, `in_transit_qty`, `safety_stock_qty`, `updated_at`도 함께 받는다. 파일 업로드가 성공하면 등록 파일, 처리 상태, 유효/오류 행 수와 마지막 반영 시각을 화면에서 확인해야 한다.

## Google Sheets 주의사항

- 현재 베타는 `published_read` 방식만 지원한다.
- 링크를 가진 사용자가 읽을 수 있는 시트여야 한다.
- 비공개 회사 시트는 다음 단계에서 Google OAuth 서비스 계정 방식을 추가한다.
