// ============================================================
//  team 상유 — 회사 설정 (여기 한 파일만 고치면 됩니다)
// ============================================================
//  회사 이름, 팀, 직원 이름·성격·색, 대표 결재 안건까지 전부 여기 있어요.
//
//  규칙
//   1. 팀은 1~4개. 사무실이 2×2 배치라 최대 4개까지 들어갑니다.
//   2. 팀 id는 영문 소문자로, 한 번 정하면 바꾸지 않는 게 좋아요.
//   3. 한 팀에 팀장(lead) 1명 + 팀원 최대 5명 (책상 6개).
// ============================================================

// ── 날짜에 따라 바뀌는 업무용 (오늘 요일·월) ─────────────────
const NOW = new Date();
/** 0=일 1=월 … 6=토 */
export const TODAY = NOW.getDay();
const MONTH = NOW.getMonth() + 1;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 국제동향팀 월별 담당 국가 — 11·1월: 미국·일본 / 12·2월: 중국·유럽·남미·중동 */
export function regionOfMonth(month: number): string {
  if (month === 11 || month === 1) return "미국·일본";
  if (month === 12 || month === 2) return "중국·유럽·남미·중동";
  return "담당 국가 미정";
}
export const REGION = regionOfMonth(MONTH);

/**
 * 매주 정기 일정 — 대시보드 "weekly.schedule"과 그날 업무에 반영됩니다.
 * day: 0=일 1=월 … 6=토
 */
export type WeeklyItem = {
  day: number;
  time: string;
  dept: string;
  title: string;
  /** 결재 안건으로 올라올 때 보이는 설명 */
  summary: string;
  reasons: string[];
};

export const WEEKLY_SCHEDULE: WeeklyItem[] = [
  {
    day: 1, time: "10:00", dept: "global", title: `국가별 기사 후보 5가지 정리 (${REGION})`,
    summary: `이번 달 담당 국가(${REGION}) 기준으로 이번 주 기사 후보 5가지를 골랐어요. 승인하시면 후보를 확정하고 자료를 모읍니다.`,
    reasons: ["① 국가별 후보 5가지", "② 출처·발표일 확인", "③ 지시사항 반영 여부"],
  },
  {
    day: 3, time: "14:00", dept: "lab", title: "주간 자료조사·디벨롭 결과 보고",
    summary: "이번 주 연구 소모임 자료조사·디벨롭 결과예요. 승인하시면 다음 모임 자료로 반영합니다.",
    reasons: ["① 이번 주 조사 내용", "② 디벨롭 포인트", "③ 다음 단계 제안"],
  },
  {
    day: 5, time: "17:00", dept: "global", title: "대표 확인용 주간 국제 뉴스 정리",
    summary: "보고서용이 아닌 대표님 확인용이에요. 분야 상관없이 이번 주 이슈된 국제 뉴스 위주로 정리했어요.",
    reasons: ["① 이번 주 주요 이슈", "② 한 줄 요약", "③ 더 볼 만한 기사"],
  },
];
/** 오늘 있는 정기 일정 */
export const TODAY_SCHEDULE = WEEKLY_SCHEDULE.filter((item) => item.day === TODAY);
export const TODAY_LABEL = `${MONTH}월 · ${DAY_NAMES[TODAY]}요일`;

/** 요일별로 업무를 바꿀 때: onDay({ 1: "월요일 업무" }, "평소 업무") */
function onDay(byDay: Record<number, string>, normal: string): string {
  return byDay[TODAY] ?? normal;
}

/** 회사 기본 정보 */
export const COMPANY = {
  /** 좌측 상단 헤더에 뜨는 회사 이름 */
  name: "team 상유",
  /** 헤더 로고 배지에 들어갈 글자 1개 */
  logoLetter: "상",
  /** 화면 상단 큰 제목 (앞부분) */
  titlePrefix: "team",
  /** 화면 상단 큰 제목 (강조되는 뒷부분) */
  titleAccent: "상유 Office",
  /** 브라우저 탭 제목 */
  pageTitle: "team 상유 — Office",
  /** 검색·공유될 때 뜨는 설명 */
  description: "취업준비·일반지원·국제동향·연구소모임 4개 팀이 함께 일하는 team 상유 오피스",
  /** 창 상단 파일명 느낌의 라벨 */
  windowLabel: "team_sangyu.exe — 대표실",
  /** 일일 브리핑 제목에 들어갈 이름 */
  reportName: "team 상유",
  /** 출근 시각 (시) */
  startHour: 9,
  /** 시계에 표시할 도시 */
  city: "SEOUL",
} as const;

/** 대표(나) — 대표실에 앉아 있는 캐릭터 */
export const CEO_PROFILE = {
  name: "상유",
  callsign: "대표님",
  role: "대표 · 최종 의사결정",
  hair: "#1f2a3d",
  shirt: "#1e3a6e",
  accent: "#f6ecc4",
  skin: "#ffdcc4",
  thoughts: [
    "오늘 꼭 끝낼 일 하나만 정하자.",
    "보고서는 결론부터 보자.",
    "팀별로 막힌 데 없는지 확인.",
  ],
};

/**
 * 팀 목록 (최대 4개) — 순서대로 사무실 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래
 * id = 영문 고정값 / name·short·icon = 화면 표시용
 * task = 팀 업무 한 줄 요약 / report = 끝나면 팀장이 하는 한줄보고
 * duties = 팀 업무 전체 목록 (직원 프로필에 표시)
 * priority = true 이면 "최우선" 표시 + 업무에 시간을 더 씀
 * keywords = 대표 지시창에서 이 팀을 알아듣는 단어
 */
type Department = {
  id: string;
  name: string;
  short: string;
  icon: string;
  task: string;
  report: string;
  duties?: string[];
  priority?: boolean;
  keywords?: string[];
};

export const DEPARTMENTS: Department[] = [
  {
    id: "career",
    name: "취업준비팀",
    short: "career.hq",
    icon: "🎯",
    priority: true,
    task: "신입 공고 수집·경험 검토·자소서 분석",
    report: "오늘 공고 정리, 경험 검토, 자소서 분석까지 마쳤어요.",
    duties: [
      "매일 09:00 신입 공고 수집 — 공기업 일반사무직 / 대기업·중견기업 인사·총무·대관·대외협력 등 문과 직무 (재무·인턴 제외)",
      "경험 정리 검토 → 수정 제안 + 보충할 점 지정, 자격증 등 가산점 요건 점검",
      "공기업·대기업·중견기업 합격 자소서(최신본) 수집·분석 → 자소서 작성용 자료로 정리",
      "취업 관련 유튜브 영상 매일 체크 + 면접 기본기 조금씩 준비",
      "다국적 기업 중 내 경험이 강점이 되거나 요건에 맞는 곳 검토·제안",
    ],
    keywords: ["취업", "채용", "공고", "자소서", "자기소개서", "면접", "경험", "가산점", "자격증", "다국적", "외국계", "공기업", "대기업", "유튜브"],
  },
  {
    id: "support",
    name: "일반지원팀",
    short: "support.desk",
    icon: "🗂️",
    task: "수행비서·총괄 — 뉴스 요약, 요청 대응, 업무 개선",
    report: "오늘 소식 요약 끝났고, 팀별 흐름 점검해서 개선점 정리했어요.",
    duties: [
      "일일 소식 요약 — ⚽ 축구: 한국 남자 A대표팀 / EPL 빅6 / 라리가 레알 마드리드",
      "일일 소식 요약 — ⚾ 야구: KBO 전체 / 롯데 자이언츠",
      "일일 헤드라인 종합 (국내 + 해외)",
      "대표님 자료·검색 요청 시 즉시 응답 준비",
      "다른 팀 업무 흐름 파악 + 전체 업무 개선 제안",
      "기타 대표님을 위한 지원 업무",
    ],
    keywords: ["지원", "비서", "총괄", "뉴스", "소식", "헤드라인", "축구", "야구", "롯데", "레알", "epl", "EPL", "국대", "대표팀", "kbo", "KBO", "개선"],
  },
  {
    id: "global",
    name: "국제동향보고서팀",
    short: "global.report",
    icon: "🌏",
    task: onDay(
      { 1: `국가별 기사 후보 5가지 정리 (${REGION})`, 5: "대표 확인용 주간 국제 뉴스 정리" },
      `‘국제정세 동향 파악’ 팔로우 (이번 달: ${REGION})`,
    ),
    report: onDay(
      { 1: `${REGION} 기사 후보 5가지 정리했어요.`, 5: "이번 주 이슈 중심으로 국제 뉴스 정리했어요." },
      `${REGION} 동향 체크하고 지시사항 업데이트했어요.`,
    ),
    duties: [
      "프로젝트 내 ‘국제정세 동향 파악’ 내용 전체 팔로우 + 관련 지시사항 확인",
      "매주 월요일 10:00 — 국가별 기사 후보 5가지 정리",
      "담당 국가: 11·1월 미국·일본 / 12·2월 중국·유럽·남미·중동",
      "매주 금요일 17:00 — 대표 확인용 주간 국제 뉴스 정리 (보고서용 아님, 분야 무관·이슈 위주)",
    ],
    keywords: ["국제", "동향", "정세", "해외", "기사 후보", "미국", "일본", "중국", "유럽", "남미", "중동", "주간 뉴스", "국제 뉴스"],
  },
  {
    id: "lab",
    name: "연구소모임팀",
    short: "lab.meetup",
    icon: "🔬",
    task: onDay({ 3: "주간 자료조사 결과 보고 (14:00)" }, "‘연구 소모임’ 팔로우 · 자료조사·디벨롭"),
    report: onDay(
      { 3: "이번 주 자료조사·디벨롭 결과 보고 준비 끝났어요." },
      "자료조사 진행했고, 수요일 보고에 맞춰 정리 중이에요.",
    ),
    duties: [
      "프로젝트 내 ‘연구 소모임’ 영역 전체 팔로우",
      "월 2회 대표님이 주시는 회의록 반영·검토 → 발전 방향 제안, 개선·추가 건의",
      "회의·연구 관련 자료조사 또는 디벨롭 주 1회 → 매주 수요일 14:00 보고",
      "연구 주제 관련 방문 기관·인터뷰 대상자 추천",
      "보고서·발표문 등 문서 작성 사전 작업, 지시 시 작성",
    ],
    keywords: ["연구", "소모임", "연구소", "회의록", "인터뷰", "방문 기관", "발표문", "디벨롭"],
  },
];

/** 대표 브리핑을 맡는 팀 (이 팀 팀장이 수행비서·비서실장 역할) */
export const BRIEFING_DEPT = "support";

/**
 * 오늘의 대표 결재 안건 — 팀 업무가 끝나면 회의실로 올라옵니다.
 * fromDept = 안건을 올리는 팀
 */
export const APPROVAL = {
  fromDept: "career",
  title: "오늘의 지원 추천 공고",
  summary: "오늘 09:00에 모은 신입 공고 중 조건에 맞는 곳을 추렸어요. 승인하시면 지원 일정과 자소서 준비에 들어갑니다.",
  badge: "오늘의 결재",
  reasons: ["① 공기업 일반사무직", "② 대기업·중견 인사/총무/대관/대외협력", "③ 자격요건·가산점 점검 완료"],
  approvedNote: "승인 이후 지원 일정 정리 → 자소서 자료 연결 → 브리핑까지 이어집니다.",
};

/** 결재 안건 하나 */
export type ApprovalItem = {
  id: string;
  fromDept: string;
  title: string;
  summary: string;
  badge: string;
  reasons: string[];
  approvedNote: string;
};

/** 오늘 올라올 결재 전체 — 매일 결재(취업준비팀) + 오늘 있는 정기보고 */
export const TODAY_APPROVALS: ApprovalItem[] = [
  { id: "daily", ...APPROVAL },
  ...TODAY_SCHEDULE.map((item) => ({
    id: `weekly-${item.day}-${item.time}`,
    fromDept: item.dept,
    title: item.title,
    summary: item.summary,
    badge: `정기보고 · ${item.time}`,
    reasons: item.reasons,
    approvedNote: "승인된 정기보고는 최종 정리 후 보관합니다.",
  })),
];

/**
 * 대표 수행비서 — 대표실 안 자리 (대표와 함께 항상 자리에 있음).
 * 내 일정 리마인드 + 결재 등 대표가 챙길 일 알림.
 */
export const SECRETARY = {
  name: "유지민",
  gender: "f" as "f" | "m",
  role: "대표 수행비서 · 일정·결재 리마인드",
  task: "대표님 일정 리마인드 · 결재 챙기기",
  colors: ["#3a2a2a", "#f4f7fb", "#1e3a6e"] as [string, string, string],
  thoughts: ["다음 일정 30분 전에 말씀드려야지.", "결재 밀린 거 없나 확인.", "이번 주 일정 겹치는 거 체크."],
  duties: [
    "대표님 전체 일정 관리 · 리마인드 (당일 아침 + 일정 30분 전)",
    "결재 대기 안건 알림 — 밀리지 않게 챙기기",
    "다가오는 7일 일정 미리 정리",
  ],
};

/**
 * 내 일정 (기본값) — 화면의 "my.schedule" 창에서 추가하거나 .ics / .csv 파일로 올릴 수도 있어요.
 * 여기에 적은 일정은 모든 브라우저에서 보이고, 화면에서 추가한 일정은 그 브라우저에만 저장됩니다.
 * 형식: { date: "2026-11-05", time: "14:00", title: "면접", note: "강남역" }
 */
export const MY_SCHEDULE: { date: string; time?: string; title: string; note?: string }[] = [];

/**
 * 직원 명단 (임시 — 실제 팀원 이름·역할로 바꿔주세요)
 * dept = 위 팀 id / rank: "lead"(팀장) 또는 "member"(팀원)
 * colors = [머리색, 옷색, 포인트색]
 * thoughts = 자리에서 가끔 떠올리는 혼잣말
 */
export type StaffEntry = {
  dept: string;
  rank: "lead" | "member";
  name: string;
  role: string;
  /** 성별 — "f"(여자) 이면 긴 머리 캐릭터, 없으면 남자 캐릭터 */
  gender?: "f" | "m";
  /** 매일 맡는 업무 — 일하는 동안 머리 위·프로필에 표시 */
  task?: string;
  colors: [string, string, string];
  thoughts: string[];
  callsign?: string;
};

export const STAFF_LIST: StaffEntry[] = [
  // ① 취업준비팀 — 핵심·최우선 (팀장 1 + 팀원 5)
  { dept: "career", rank: "lead", name: "김대현", role: "취업전략 팀장",
    task: "취업 전략 총괄 · 다국적 기업 검토",
    colors: ["#1f2a3d", "#1e3a6e", "#f3e7bd"],
    thoughts: ["오늘 지원할 곳 우선순위부터 정하자.", "이 외국계, 대표님 경험이 강점이 될 것 같은데?", "마감 임박한 공고부터 챙깁니다."] },
  { dept: "career", rank: "member", name: "최아현", gender: "f", role: "공고 수집 · 공기업",
    task: "공기업 일반사무직 신입 공고 수집",
    colors: ["#6b3d34", "#f4f7fb", "#3b5b92"],
    thoughts: ["NCS 일정이랑 같이 정리해둘게요.", "가산점 항목 따로 표시!"] },
  { dept: "career", rank: "member", name: "박정수", role: "공고 수집 · 대기업/중견",
    task: "대기업·중견 인사·총무·대관·대외협력 공고 수집",
    colors: ["#2c2638", "#dbe3f0", "#1e3a6e"],
    thoughts: ["인턴 공고랑 재무 직무는 빼고요.", "중견기업 기준 다시 확인."] },
  { dept: "career", rank: "member", name: "김시은", gender: "f", role: "경험 정리 · 스펙 점검",
    task: "경험 정리 검토 · 수정 제안 · 가산점 점검",
    colors: ["#33304a", "#cfe9de", "#1e3a6e"],
    thoughts: ["이 경험은 숫자로 보여주면 좋겠어요.", "보충하면 좋을 자격증 체크 중."] },
  { dept: "career", rank: "member", name: "오나경", gender: "f", role: "합격 자소서 분석",
    task: "합격 자소서 최신본 수집·분석",
    colors: ["#7a453c", "#b8c7e3", "#f3e7bd"],
    thoughts: ["올해 문항 경향이 조금 바뀌었네요.", "자주 나오는 소재 정리해둘게요."] },
  { dept: "career", rank: "member", name: "이승훈", role: "취업 영상 · 면접 준비",
    task: "취업 유튜브 체크 · 면접 기본기 준비",
    colors: ["#463227", "#dbe3f0", "#3b5b92"],
    thoughts: ["오늘 볼 만한 영상 두 개 찾았어요.", "면접은 천천히, 1분 자기소개부터."] },

  // ② 일반지원팀 — 수행비서 + 총괄 (팀장 1 + 팀원 3)
  { dept: "support", rank: "lead", name: "우세진", role: "수행비서 · 총괄 팀장",
    task: "팀별 업무 흐름 점검 · 개선 제안",
    colors: ["#3c3a4f", "#3b5b92", "#cfe9de"],
    thoughts: ["대표님이 결정할 것만 추릴게요.", "취업준비팀 흐름이 제일 중요해요.", "막힌 팀부터 먼저 보고."] },
  { dept: "support", rank: "member", name: "지수정", gender: "f", role: "스포츠 소식 담당",
    task: "축구(국대·EPL 빅6·레알) / 야구(KBO·롯데) 소식 요약",
    colors: ["#4a3a2a", "#dbe3f0", "#1e3a6e"],
    thoughts: ["롯데 어제 경기 결과부터 정리!", "레알 경기 일정 체크.", "EPL 빅6 이적 소식 있나?"] },
  { dept: "support", rank: "member", name: "정민석", role: "헤드라인 담당",
    task: "국내·해외 일일 헤드라인 종합",
    colors: ["#5d3a2c", "#b8c7e3", "#1e3a6e"],
    thoughts: ["국내 3개, 해외 3개로 압축.", "제목만 봐도 알 수 있게 요약하자."] },
  { dept: "support", rank: "member", name: "박담비", gender: "f", role: "자료·검색 지원",
    task: "대표님 요청 대기 · 자료 준비 · 기타 지원",
    colors: ["#274a44", "#f4f7fb", "#3b5b92"],
    thoughts: ["요청 오면 바로 찾을 수 있게 대기 중.", "자주 찾는 자료는 미리 모아둘게요."] },

  // ③ 국제동향보고서팀 (팀장 1 + 팀원 2)
  { dept: "global", rank: "lead", name: "박재석", role: "국제동향 팀장",
    task: `‘국제정세 동향 파악’ 팔로우 · 지시사항 확인 (${REGION})`,
    colors: ["#2a2f45", "#1e3a6e", "#f3e7bd"],
    thoughts: ["이번 달 담당은 " + REGION + "!", "지시사항 바뀐 거 없는지 확인.", "후보 5개, 국가별로 균형 맞추자."] },
  { dept: "global", rank: "member", name: "김형준", role: "국가별 기사 후보 담당",
    task: onDay({ 1: `국가별 기사 후보 5가지 정리 (${REGION})` }, `${REGION} 기사 후보 모으기`),
    colors: ["#4a3a2a", "#cfe9de", "#3b5b92"],
    thoughts: ["월요일 10시까지 후보 5개!", "원문 출처부터 확인할게요."] },
  { dept: "global", rank: "member", name: "최현지", gender: "f", role: "주간 국제 뉴스 담당",
    task: onDay({ 5: "대표 확인용 주간 국제 뉴스 정리 (17:00)" }, "이번 주 국제 이슈 모으기"),
    colors: ["#7a453c", "#b8c7e3", "#1e3a6e"],
    thoughts: ["보고서용 아니고 대표님 확인용이니까 가볍게.", "분야 상관없이 이슈된 것 위주로."] },

  // ④ 연구소모임팀 (팀장 1 + 팀원 3)
  { dept: "lab", rank: "lead", name: "윤서연", gender: "f", role: "연구소모임 팀장",
    task: "‘연구 소모임’ 팔로우 · 회의록 검토 · 발전 방향 제안",
    colors: ["#463227", "#1e3a6e", "#cfe9de"],
    thoughts: ["회의록 오면 발전 방향부터 정리하자.", "개선할 점, 추가할 점 나눠서 건의."] },
  { dept: "lab", rank: "member", name: "김주희", gender: "f", role: "자료조사·디벨롭",
    task: onDay({ 3: "주간 자료조사 결과 보고 준비 (14:00)" }, "회의·연구 관련 자료조사 · 디벨롭"),
    colors: ["#2c2638", "#dbe3f0", "#1e3a6e"],
    thoughts: ["수요일 2시 보고에 맞춰 정리.", "참고 자료 출처 표기 꼼꼼히."] },
  { dept: "lab", rank: "member", name: "최민주", gender: "f", role: "방문 기관·인터뷰 섭외 리서치",
    task: "방문 기관 · 인터뷰 대상자 추천",
    colors: ["#5a3450", "#f4f7fb", "#3b5b92"],
    thoughts: ["연구 주제랑 딱 맞는 기관 찾는 중.", "인터뷰 후보 3명 추려볼게요."] },
  { dept: "lab", rank: "member", name: "서혜원", gender: "f", role: "문서 작성",
    task: "보고서·발표문 사전 작업 · 지시 시 작성",
    colors: ["#7a453c", "#b8c7e3", "#f3e7bd"],
    thoughts: ["목차부터 잡아두면 작성이 빨라요.", "발표문은 3분 분량 기준으로."] },
];

/**
 * 외부 연동이 아직 안 된 팀 → 화면에 "연동 대기"로 표시되고 그날 업무를 쉬어요.
 * 예: { career: "채용 사이트 연동" }
 */
export const PENDING_INTEGRATIONS: Record<string, string> = {};

/** 대시보드 "integrations.link"에 보일 항목 (껍데기 버전이라 전부 미연동) */
export const INTEGRATIONS: { name: string; status: string }[] = [
  { name: "Notion 보고서 저장", status: "미연동" },
  { name: "Google Drive 자료", status: "미연동" },
  { name: "Discord 알림", status: "미연동" },
];

/** 대시보드 "결과물 창고"에 보일 예시 항목 */
export const RECENT_OUTPUTS: { title: string; dept: string; status: string }[] = [
  { title: "신입 공고 리스트 (공기업·대기업·중견)", dept: "career", status: "매일 갱신" },
  { title: "합격 자소서 분석 노트", dept: "career", status: "작성 중" },
  { title: "일일 소식 요약 (축구·야구·헤드라인)", dept: "support", status: "매일 갱신" },
  { title: `국가별 기사 후보 5가지 (${REGION})`, dept: "global", status: "매주 월요일" },
  { title: "연구 소모임 주간 자료조사 보고", dept: "lab", status: "매주 수요일" },
];

/**
 * 결과 보관함 링크 (Notion 등). 비워두면 화면에서 링크 버튼이 숨겨집니다.
 */
export const STORAGE_LINK = "https://app.notion.com/p/40d01b1dbf7c81b9ba01e1b82903c783";
