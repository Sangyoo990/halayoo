// Notion 결과 보관함 — "team 상유 Office" 페이지와 팀별 데이터베이스
// (ID는 비밀값이 아니에요. 읽고 쓰려면 Notion 연결 권한이 따로 필요합니다.)

export const NOTION = {
  /** 상위 페이지: team 상유 Office */
  rootPage: "https://app.notion.com/p/40d01b1dbf7c81b9ba01e1b82903c783",
  databases: {
    /** ✅ 대표 결재함 — 매일 결재 + 정기보고 */
    approvals: { url: "https://app.notion.com/p/7f66a0aa6e3a471bbba613db7357e14a", dataSource: "35029f57-aeb6-41aa-9fa9-e4cbe020508b" },
    /** 🎯 취업 공고 — 매일 09:00 */
    jobs: { url: "https://app.notion.com/p/3a3c9bb7e7da4b55a046089157b13ede", dataSource: "249d7251-c143-4b56-80a3-67a9c5a7af0c" },
    /** 📰 일일 소식 — 일반지원팀 */
    news: { url: "https://app.notion.com/p/408fedb992f347b2b87a20e4bc4c30bb", dataSource: "ddc6ba59-8fcb-49fc-b40a-c573c21f56f7" },
    /** 🌏 국제동향 — 월 10:00 / 금 17:00 */
    global: { url: "https://app.notion.com/p/f5e5e258fc9048f2af054524e25dd865", dataSource: "dd6d3ed4-3356-40a3-97b3-ae93d781af86" },
    /** 🔬 연구 소모임 — 회의록 · 수 14:00 */
    lab: { url: "https://app.notion.com/p/e6ea457920344d41a05d90c3055e0d4b", dataSource: "0e7f410d-aa5f-484b-9a5d-c90a2df6df44" },
  },
} as const;
