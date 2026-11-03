// 라이브 오피스의 하루 결과 → 보고서로 변환한다.
// 껍데기 버전: 서버가 없으므로 외부 발행 대신 "미연동" 결과를 돌려주고,
// 마지막 보고서는 브라우저(localStorage)에만 저장한다.
import type { Snapshot } from "./sim";
import { BLOCK_NEED, DEPT_BRIEF } from "./staff";
import { roomOf } from "./world";
import { COMPANY } from "../../company.config";

export type DayReport = {
  title: string;
  clock: string;
  phase: string;
  counts: { total: number; done: number; working: number; approval: number; blocked: number };
  highlights: string[];
  decisions: string[];
  risks: string[];
  next: string[];
  log: { time: string; text: string }[];
};

export type PublishResult = {
  notion: { ok: boolean; status: string; detail?: string; url?: string };
  discord: { ok: boolean; status: string; detail?: string };
  publishedAt: string;
};

export type IntegrationStatus = Record<
  string,
  { configured: boolean; label: string; need?: string }
>;

export function buildReport(snap: Snapshot): DayReport {
  const entries = Object.entries(snap.deptStatus);

  const highlights = entries
    .filter(([, status]) => status === "완료")
    .map(([dept]) => `${roomOf(dept).name} — ${DEPT_BRIEF[dept]?.report ?? "완료"}`);

  const risks = entries
    .filter(([, status]) => status === "연동 대기")
    .map(([dept]) => `${roomOf(dept).name} — ${BLOCK_NEED[dept] ?? "외부 연동"} 대기로 오늘 진행 불가`);

  const decisions = snap.approved
    ? ["TOP 1 콘텐츠 제작 승인 — 대본·제작까지 진행 완료"]
    : snap.approvalPending
      ? ["TOP 1 콘텐츠 승인 여부 (결재 대기 중)"]
      : ["오늘 대표 결재 안건 없음"];

  const next = [
    ...risks.map((risk) => `${risk.split(" — ")[0]}: 연동 완료되면 즉시 재가동`),
    snap.approved ? "제작된 콘텐츠 업로드 및 성과 기록" : "TOP 3 재검토",
  ];

  return {
    title: `${snap.clock} ${COMPANY.reportName} 일일 브리핑`,
    clock: snap.clock,
    phase: snap.phase,
    counts: {
      total: entries.length,
      done: snap.stats.done,
      working: snap.stats.working,
      approval: snap.stats.approval,
      blocked: snap.stats.blocked,
    },
    highlights,
    decisions,
    risks,
    next,
    log: [...snap.log].reverse().map((entry) => ({ time: entry.time, text: `${entry.icon} ${entry.text}` })),
  };
}

/** 외부 연동이 없는 껍데기 버전 — 실제로 보내지 않고 "미연동"으로 응답한다 */
export async function publish(report: DayReport): Promise<PublishResult> {
  try {
    localStorage.setItem("my-office:last-report", JSON.stringify(report));
  } catch {
    // 저장이 막혀 있어도 화면은 정상 동작
  }
  return {
    notion: { ok: false, status: "unconfigured", detail: "미연동" },
    discord: { ok: false, status: "unconfigured", detail: "미연동" },
    publishedAt: new Date().toISOString(),
  };
}

/** 연동 상태 — 껍데기 버전은 전부 미설정 */
export async function fetchIntegrations(): Promise<IntegrationStatus> {
  return {
    notion: { configured: false, label: "Notion 저장" },
    discord: { configured: false, label: "Discord 전송" },
    instagram: { configured: false, label: "Instagram 지표", need: "연동 대기" },
    gmail: { configured: false, label: "Gmail 읽기", need: "연동 대기" },
    finance: { configured: false, label: "재무 파일", need: "자료 대기" },
  };
}
