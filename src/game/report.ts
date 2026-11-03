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

// ── Notion 발행 (claude.ai에서 열었을 때, 보는 사람의 Notion 연결로) ──────────

type McpNs = {
  callTool: (server: string, tool: string, input?: unknown, options?: { cache?: false }) => Promise<{ payload?: unknown }>;
};
type McpErr = { code?: string; message?: string };
type Row = Record<string, unknown>;

const SERVER = "Notion";

async function getMcp(): Promise<McpNs | null> {
  const use = (window as unknown as { claude?: { use: (n: string) => Promise<unknown> } }).claude?.use;
  if (!use) return null;
  try {
    return ((await use("mcp")) as McpNs) ?? null;
  } catch {
    return null;
  }
}

function seoulToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function str(v: unknown) {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function dateStr(r: Row, name: string) {
  const raw = str(r[`date:${name}:start`]) || str(r[name]);
  return raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

/** 보기(view) 방식으로 읽기 — 무료 요금제 조회 한도에 걸리지 않는다 */
async function rows(mcp: McpNs, viewUrl: string): Promise<Row[]> {
  const res = await mcp.callTool(
    SERVER,
    "notion-query-data-sources",
    { data: { mode: "view", view_url: viewUrl, page_size: 100 } },
    { cache: false },
  );
  const payload = res.payload as { results?: Row[] } | undefined;
  return Array.isArray(payload?.results) ? payload!.results : [];
}

export type PublishExtras = {
  /** 오늘 내 일정 (오피스 일정 창) */
  todaySchedule: string[];
};

/** 실제 Notion 상황 + 내 일정 + 오피스 진행 기록으로 브리핑 페이지를 만든다 */
export async function publish(report: DayReport, extras: PublishExtras = { todaySchedule: [] }): Promise<PublishResult> {
  const now = new Date().toISOString();
  const mcp = await getMcp();
  if (!mcp) {
    return {
      notion: { ok: false, status: "unconfigured", detail: "claude.ai에서 열었을 때만 발행돼요" },
      discord: { ok: false, status: "unconfigured", detail: "미사용" },
      publishedAt: now,
    };
  }
  const { NOTION } = await import("../../notion.config");
  const today = seoulToday();

  try {
    // 1) 실제 결과 읽기 — 읽기가 실패해도 브리핑은 만든다 (그 칸은 "확인 못 함")
    const [approvalsRes, jobsRes] = await Promise.allSettled([
      rows(mcp, NOTION.databases.approvals.view),
      rows(mcp, NOTION.databases.jobs.view),
    ]);
    const readFailed = { approvals: approvalsRes.status === "rejected", jobs: jobsRes.status === "rejected" };
    const approvals = approvalsRes.status === "fulfilled" ? approvalsRes.value.filter((r) => str(r["상태"]) === "결재 대기") : [];
    const jobs = (jobsRes.status === "fulfilled" ? jobsRes.value : []).sort((a, b) =>
      dateStr(b, "수집일").localeCompare(dateStr(a, "수집일")),
    );
    const todayJobs = jobs.filter((r) => dateStr(r, "수집일") === today);
    const in3 = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const urgent = jobs
      .filter((r) => {
        const d = dateStr(r, "마감일");
        const st = str(r["상태"]);
        return d && d >= today && d <= in3 && st !== "지원 완료" && st !== "제외";
      })
      .sort((a, b) => dateStr(a, "마감일").localeCompare(dateStr(b, "마감일")));

    // 2) 본문 (Markdown)
    const md = (s: string) => s.replace(/[\\*_`#[\]<>|]/g, " ").trim();
    const link = (title: string, url: string) => (/^https?:\/\//.test(url) ? `[${md(title)}](${url})` : md(title));
    const lines: string[] = [];
    lines.push("## ✅ 결재 대기");
    if (readFailed.approvals) lines.push("- ⚠️ 결재함을 읽지 못해 확인 못 함");
    else lines.push(...(approvals.length ? approvals.map((r) => `- ${link(str(r["안건"]) || "(제목 없음)", str(r.url))} · ${md(str(r["팀"]))}`) : ["- 없음"]));
    lines.push("", "## 🎯 오늘 수집 공고");
    if (readFailed.jobs) lines.push("- ⚠️ 공고 목록을 읽지 못해 확인 못 함");
    else lines.push(
      ...(todayJobs.length
        ? todayJobs.slice(0, 15).map((r) => `- ${link(str(r["공고명"]) || "(제목 없음)", str(r["링크"]) || str(r.url))} — ${md(str(r["기업·기관"]))} (${md(str(r["구분"]))})`)
        : ["- 없음"]),
    );
    lines.push("", "## ⏰ 마감 임박 (3일 이내)");
    if (readFailed.jobs) lines.push("- ⚠️ 확인 못 함");
    else lines.push(
      ...(urgent.length
        ? urgent.slice(0, 10).map((r) => `- ${link(str(r["공고명"]) || "(제목 없음)", str(r["링크"]) || str(r.url))} — 마감 ${dateStr(r, "마감일")}`)
        : ["- 없음"]),
    );
    lines.push("", "## 📅 오늘 일정");
    lines.push(...(extras.todaySchedule.length ? extras.todaySchedule.map((t) => `- ${md(t)}`) : ["- 등록된 일정 없음"]));
    lines.push("", "## 🏢 오피스 진행 기록 (시뮬레이션)");
    lines.push(`- 단계: ${md(report.phase)} · 완료 ${report.counts.done}팀 · 진행 ${report.counts.working}팀`);
    lines.push(...report.log.slice(-12).map((l) => `- ${l.time} ${md(l.text)}`));

    const summary = `${readFailed.approvals || readFailed.jobs ? "⚠️ 일부 확인 못 함 · " : ""}결재 대기 ${approvals.length}건 · 오늘 공고 ${todayJobs.length}건 · 마감 임박 ${urgent.length}건 · 오늘 일정 ${extras.todaySchedule.length}건`;

    // 3) 페이지 만들기
    const res = await mcp.callTool(
      SERVER,
      "notion-create-pages",
      {
        parent: { type: "data_source_id", data_source_id: NOTION.databases.briefing.dataSource },
        pages: [
          {
            properties: {
              "브리핑명": `${today} 대표 브리핑`,
              "date:날짜:start": today,
              "date:날짜:is_datetime": 0,
              "결재 대기": approvals.length,
              "오늘 수집 공고": todayJobs.length,
              "마감 임박 공고": urgent.length,
              "오늘 일정": extras.todaySchedule.length,
              "요약": summary,
            },
            content: lines.join("\n"),
          },
        ],
      },
      { cache: false },
    );
    const created = (res.payload as { pages?: { url?: string }[] } | undefined)?.pages?.[0];
    return {
      notion: { ok: true, status: "sent", detail: summary, url: created?.url },
      discord: { ok: false, status: "unconfigured", detail: "미사용" },
      publishedAt: now,
    };
  } catch (err) {
    const e = err as McpErr;
    const code = e?.code ?? "upstream_error";
    const detail =
      code === "server_not_connected"
        ? "Notion이 연결돼 있지 않아요 (claude.ai 설정 → 커넥터)"
        : code === "needs_reauth"
          ? "Notion을 다시 연결해 주세요"
          : code === "not_in_manifest" || code === "approval_required" || code === "consent_required"
            ? "Notion 쓰기 허용이 필요해요"
            : code === "server_unavailable" || code === "upstream_error"
              ? "응답이 없었어요. Notion에서 저장됐는지 먼저 확인해 주세요"
              : `Notion 저장에 실패했어요 (${code}${e?.message ? `: ${String(e.message).slice(0, 80)}` : ""})`;
    return {
      notion: { ok: false, status: "failed", detail },
      discord: { ok: false, status: "unconfigured", detail: "미사용" },
      publishedAt: now,
    };
  }
}

/** 연동 상태 — 대시보드 표시는 company.config.ts 의 INTEGRATIONS 를 쓴다 */
export async function fetchIntegrations(): Promise<IntegrationStatus> {
  return {};
}
