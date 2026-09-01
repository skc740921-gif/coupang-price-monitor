쿠팡 가격 모니터 v6

이번 버전에서 수정한 핵심
- www.coupang.com / m.coupang.com / coupang.com URL 판정 오류 수정
- 상품 상세페이지 JSON-LD + 여러 DOM 가격 선택자 + 제한적 스크립트 상태값 추출
- 검색결과 상품 카드 추출
- HTTP 401/403/429 및 차단 화면 별도 진단
- 서버 진단 버튼 추가
- 응답 JSON 오류를 사용자 화면에서 명확하게 표시
- 모바일 화면 대응
- 최근 가격 기록 브라우저 저장

배포
1. GitHub 저장소에서 Add file > Upload files
2. 이 폴더 안의 Dockerfile, package.json, README.txt, server.js, public 폴더를 전부 업로드/덮어쓰기
3. Commit changes
4. Render 자동 배포 완료 후 View
5. 먼저 '서버 진단' 클릭 -> 서버 정상 확인
6. 쿠팡 상품 상세 URL 붙여넣기 -> 가격 확인

중요
이 프로그램 자체의 URL 검사/서버/파싱 오류는 보완했습니다.
다만 쿠팡이 Render 같은 클라우드 서버 IP 자체를 차단하면 어떤 HTML 파서도 가격을 가져올 수 없습니다.
그 경우 화면에 '쿠팡이 Render 서버 접속을 제한했습니다'라고 명확히 표시되며,
다음 단계는 사용자 PC 브라우저 기반 수집 방식 또는 합법적인 외부 데이터 수집 서비스를 검토해야 합니다.
