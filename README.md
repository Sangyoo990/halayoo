# team 상유 Office (껍데기 버전)

원본 "AI OFFICE" 화면을 그대로 옮기고, 서버·외부 연동(Notion, Discord, Cloudflare, DB, 로그인)은 모두 뺀 버전입니다.
브라우저만으로 돌아가는 화면입니다.

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
npm run dev
```

http://localhost:3000 을 열고 **"오늘 업무 시작하기"** 를 누르세요.

## 배포 (선택)

```bash
npm run build
```

`dist/` 폴더를 Netlify, Vercel, GitHub Pages 등 아무 정적 호스팅에 올리면 됩니다.
## 내 회사로 바꾸기

**`company.config.ts` 하나만 고치면 됩니다.**

| 고칠 것 | 어디 |
|---|---|
| 회사 이름, 로고 글자, 출근 시각 | `COMPANY` |
| 대표(나) 이름·성격 | `CEO_PROFILE` |
| 팀 이름·아이콘·오늘 업무·한줄보고 | `DEPARTMENTS` |
| 브리핑 담당 팀 | `BRIEFING_DEPT` |
| 오늘의 대표 결재 안건 | `APPROVAL` |
| 매주 정기 일정 (월·수·금) · 월별 담당 국가 | `WEEKLY_SCHEDULE`, `regionOfMonth` |
| 대표 수행비서 (유지민) | `SECRETARY` |
| 내 일정 기본값 | `MY_SCHEDULE` (화면 "my.schedule" 창에서 추가 · .ics/.csv 업로드도 가능) |
| 팀원 이름·역할·색·혼잣말 | `STAFF_LIST` |
| 대시보드 연동 목록·결과물 창고 | `INTEGRATIONS`, `RECENT_OUTPUTS` |

- 팀은 최대 4개 (사무실 2×2 배치).
- 한 팀에 팀장(`lead`) 1명 + 팀원 최대 5명 (책상 6개).
- 업무 문장은 오늘 요일·월에 따라 자동으로 바뀝니다 (`onDay`, `REGION`).

### 하루 흐름

출근 → 비서 일정 브리핑 → 아침 업무 공유(팀장 회의) → 팀별 업무(동시 진행) → 대표 결재(매일 결재 + 그날 정기보고) → 최종 정리 → 대표 브리핑 → 퇴근

### 일정 파일 형식

- `.ics`: 구글 캘린더 → 설정 → 가져오기/내보내기 → 내보내기
- `.csv`: `날짜,시간,일정,메모` (예: `2026-11-05,14:00,면접,강남역` / 시간 비우면 종일)


## 폴더 구조

| 경로 | 내용 |
|---|---|
| `company.config.ts` | 회사·직원 설정 (여기만 고치면 됨) |
| `src/App.tsx` | 화면 전체 (라이브 오피스 / 대시보드 / 모달) |
| `src/game/` | 픽셀 사무실 엔진 (시뮬레이션·지도·길찾기) |
| `src/game/report.ts` | 보고 발행 — 껍데기라서 "미연동"으로 응답하고 브라우저에만 저장 |
| `src/globals.css`, `src/office.css` | 원본 스타일 그대로 |

나중에 진짜 연동을 붙이려면 `src/game/report.ts`의 `publish()`와 `fetchIntegrations()`만 실제 API 호출로 바꾸면 됩니다.

---

원본 UI는 갓생맘 🎀 (@godseng.mom)이 만들었습니다. 화면 하단 크레딧은 원작자 요청에 따라 남겨두었고, 무단 재판매는 금지입니다.
