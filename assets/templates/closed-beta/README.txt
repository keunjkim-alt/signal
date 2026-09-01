VIIMsignal 클로즈드 베타 연결형 데이터팩
1) Sales_30D 파일을 판매 주문으로 미리보기·적재합니다.
2) Inventory 파일을 재고 스냅샷으로 미리보기·적재합니다.
3) 판매 현황, 수익성·할인, 고객·지역, 반품·취소, 재고 운영, 오늘 결정할 일을 확인합니다.
직접 식별정보는 없으며 customer_token은 가상의 익명 ID입니다.

운영 보조 파일
- VIIMsignal_Beta_Field_Mapping.csv: 회사 원천 컬럼·담당자·갱신 주기 확인
- VIIMsignal_Beta_User_Roster.csv: 팀 사용자 일괄 등록 예시
- VIIMsignal_Beta_Daily_Checklist.csv: 매일 데이터·AX·안건 상태 점검
- VIIMsignal_Beta_Feedback_Log.csv: 사용자 피드백과 효과 기록
- VIIMsignal_Beta_Quick_Start.txt: 첫 로그인부터 승인·감사 이력까지 빠른 시작

운영 시나리오 데이터팩 (scenario-packs 폴더)
1) VIIMsignal_Pack1_Baseline_Sales_90D_v2.csv: 2026-05-20–08-17 판매 기준선 · 6,480행
2) VIIMsignal_Pack1_Baseline_Inventory_v2.csv: 2026-08-17 이벤트 전 재고 기준 · 84행
3) VIIMsignal_Pack2_Event_Sales_14D_v2.csv: 2026-08-18–08-31 급증·둔화·반품 이벤트 · 1,008행
4) VIIMsignal_Pack2_Event_Inventory_14D_v2.csv: 2026-08-18–08-31 부족·잉여·재주문 재고 변화 · 1,176행
- 판매 기준팩과 이벤트팩은 날짜가 겹치지 않습니다.
- VIIMsignal_Closed_Beta_DataPacks_v2_20260901.xlsx: 위 4개 업로드 파일과 업무 검증 기준을 한 번에 보는 통합 문서
- VIIMsignal_Pack3_Workflow_Scenarios.csv, VIIMsignal_Pack3_Production_Events.csv: 기대 결과 확인용이며 직접 업로드하지 않습니다.

권장 업로드 순서
① 기준 판매 → ② 기준 재고 → ③ 이벤트 판매 → ④ 이벤트 재고
재고 이동·재주문·생산오더는 참고 CSV를 적재하지 않고 서비스 화면에서 승인하여 생성합니다.
