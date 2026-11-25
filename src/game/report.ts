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
    const [approvalsRes, jobsRes, libraryRes, ordersRes] = await Promise.allSettled([
      rows(mcp, NOTION.databases.approvals.view),
      rows(mcp, NOTION.databases.jobs.view),
      rows(mcp, NOTION.databases.library.view),
      rows(mcp, NOTION.databases.orders.view),
    ]);
    const readFailed = {
      approvals: approvalsRes.status === "rejected",
      jobs: jobsRes.status === "rejected",
      library: libraryRes.status === "rejected",
      orders: ordersRes.status === "rejected",
    };
    // 🎓 취업 자료실 — 오늘(또는 어제 밤 이후) 올라온 자료. 정밀 분석·강의 추천 같은 미션 결과가 여기 들어간다
    const yesterday = new Date(Date.now() - 864e5).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const library = (libraryRes.status === "fulfilled" ? libraryRes.value : []).filter((r) => dateStr(r, "날짜") === today);
    const libraryOrder = ["자료 분석", "공고 부합도", "경험 정리 검토", "강의 추천", "가산점·자격증", "면접 기본기", "합격 자소서", "다국적 기업 검토", "유튜브"];
    library.sort((a, b) => {
      const ia = libraryOrder.indexOf(str(a["구분"]));
      const ib = libraryOrder.indexOf(str(b["구분"]));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    // 📮 대표 지시함 — 어제·오늘 지시와 처리 상태
    const orders = (ordersRes.status === "fulfilled" ? ordersRes.value : []).filter((r) => {
      const d = dateStr(r, "접수일");
      return d === today || d === yesterday || str(r["상태"]) === "접수" || str(r["상태"]) === "처리 중";
    });
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
    lines.push("", "## 📮 대표 지시 처리 현황");
    if (readFailed.orders) lines.push("- ⚠️ 지시함을 읽지 못해 확인 못 함");
    else lines.push(
      ...(orders.length
        ? orders.map((r) => {
            const done = str(r["결과 링크"]);
            const result = md(str(r["처리 결과"])).slice(0, 160);
            return `- [${md(str(r["상태"])) || "접수"}] ${link(str(r["지시"]) || "(지시)", str(r.url))} · ${md(str(r["담당팀"]))}${result ? ` — ${result}` : ""}${/^https?:\/\//.test(done) ? ` · [결과](${done})` : ""}`;
          })
        : ["- 없음"]),
    );
    lines.push("", "## 🎓 오늘 취업 자료실");
    if (readFailed.library) lines.push("- ⚠️ 자료실을 읽지 못해 확인 못 함");
    else lines.push(
      ...(library.length
        ? library.slice(0, 25).map((r) => {
            const summary = md(str(r["요약"])).slice(0, 140);
            return `- [${md(str(r["구분"]))}] ${link(str(r["제목"]) || "(제목 없음)", str(r.url))}${summary ? ` — ${summary}` : ""}`;
          })
        : ["- 오늘 올라온 자료 없음"]),
    );
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

    const anyFailed = Object.values(readFailed).some(Boolean);
    const summary = `${anyFailed ? "⚠️ 일부 확인 못 함 · " : ""}결재 대기 ${approvals.length}건 · 지시 ${orders.length}건 · 자료실 ${library.length}건 · 오늘 공고 ${todayJobs.length}건 · 마감 임박 ${urgent.length}건 · 오늘 일정 ${extras.todaySchedule.length}건`;

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

export type OrderResult = { ok: boolean; detail: string; url?: string };

/** 지시창의 지시를 📮 대표 지시함에 "접수"로 남긴다 — 아침(08:41)·저녁(17:27) 업무가 꺼내서 처리한다 */
export async function submitOrder(text: string, team: string): Promise<OrderResult> {
  const mcp = await getMcp();
  if (!mcp) return { ok: false, detail: "claude.ai에서 열었을 때만 지시함에 등록돼요" };
  const { NOTION } = await import("../../notion.config");
  try {
    const res = await mcp.callTool(
      SERVER,
      "notion-create-pages",
      {
        parent: { type: "data_source_id", data_source_id: NOTION.databases.orders.dataSource },
        pages: [
          {
            properties: {
              "지시": text.slice(0, 1900),
              "담당팀": team,
              "상태": "접수",
              "date:접수일:start": seoulToday(),
              "date:접수일:is_datetime": 0,
            },
          },
        ],
      },
      { cache: false },
    );
    const created = (res.payload as { pages?: { url?: string }[] } | undefined)?.pages?.[0];
    return { ok: true, detail: "지시함에 등록했어요", url: created?.url };
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
            : `지시함 등록에 실패했어요 (${code})`;
    return { ok: false, detail };
  }
}

/** 연동 상태 — 대시보드 표시는 company.config.ts 의 INTEGRATIONS 를 쓴다 */
export async function fetchIntegrations(): Promise<IntegrationStatus> {
  return {};
}

/** 오피스 아티팩트 주소 — 공유 파일(asset)을 루틴이 받아 읽을 때 쓴다 */
export const OFFICE_ARTIFACT_URL = "https://claude.ai/artifact/JyQYmSJUzXXnDZhD3EEYnE";
/** 지시함을 처리하는 루틴 (아침 업무 루틴의 📮 지시함 절차를 그대로 쓴다) */
const ORDER_TRIGGER_ID = "trig_01Y8Tdr8HtKMHYez8WhE1k41";
const REMOTE = "Claude Code Remote";

export type Attachment = { name: string; id: string; type: string };

export function attachmentText(files: Attachment[]) {
  if (!files.length) return "";
  return (
    "\n📎 첨부 파일 (오피스 파일 공유창):\n" +
    files
      .map((f) => `- ${f.name} (${f.type}) · asset id ${f.id} · Artifact 도구 read: url=${OFFICE_ARTIFACT_URL}, path=${f.id}`)
      .join("\n")
  );
}

/** ⚡ 바로 처리 — 아침 업무 루틴을 지금 한 번 돌리되, 📮 지시함 절차만 이 지시 1건에 대해 수행하게 한다 */
export async function runOrderNow(orderText: string, team: string, orderUrl?: string): Promise<OrderResult> {
  const mcp = await getMcp();
  if (!mcp) return { ok: false, detail: "claude.ai에서 열었을 때만 바로 처리할 수 있어요" };
  const text = [
    "⚡ 대표 즉시 처리 요청 — 이번 실행은 정기 업무(0~4단계, 푸시 형식 포함)를 모두 건너뛰고, 📮 대표 지시함 처리 절차만 아래 지시 1건에 대해 수행해.",
    `담당팀: ${team}`,
    orderUrl ? `지시함 항목: ${orderUrl}` : "지시함 항목: 지시함에서 이 지시 원문과 같은 '접수' 항목을 찾아 처리해.",
    `지시 원문:\n${orderText}`,
    "끝나면 지시함 항목을 완료/처리 중/보류로 수정하고, 마지막 응답(푸시)은 '⚡ 즉시 지시 처리 — <결론 1줄>' 형식으로 2줄 이내.",
  ].join("\n");
  try {
    await mcp.callTool(REMOTE, "fire_trigger", { trigger_id: ORDER_TRIGGER_ID, text }, { cache: false });
    return { ok: true, detail: "업무 루틴을 지금 돌렸어요" };
  } catch (err) {
    const code = (err as McpErr)?.code ?? "upstream_error";
    const detail =
      code === "server_not_connected" || code === "selection_required"
        ? "Claude Code Remote 커넥터가 연결돼 있지 않아요 — 다음 업무 시간에 처리돼요"
        : code === "needs_reauth"
          ? "Claude Code Remote를 다시 연결해 주세요 — 다음 업무 시간에 처리돼요"
          : code === "not_in_manifest" || code === "approval_required" || code === "consent_required"
            ? "바로 처리 허용이 필요해요 — 허용하면 다음부터 바로 돌아가요"
            : code === "blocked_by_policy"
              ? "조직 정책상 바로 처리를 쓸 수 없어요 — 다음 업무 시간에 처리돼요"
              : code === "server_unavailable" || code === "upstream_error"
                ? `실행 여부를 확인 못 했어요 (${code}) — 지시함은 남아 있으니 다음 업무 시간에 처리돼요`
                : `바로 처리에 실패했어요 (${code}) — 다음 업무 시간에 처리돼요`;
    return { ok: false, detail };
  }
}

// ── 📅 대표 일정 (비서 채팅창) ─────────────────────────────

export type RemoteEvent = {
  url: string;
  title: string;
  date: string;
  time: string;
  place: string;
  memo: string;
  status: string;
};

export type EventInput = { title: string; date: string; time?: string; place?: string; memo?: string; status?: string; raw?: string };

function mcpDetail(err: unknown, what: string) {
  const code = (err as McpErr)?.code ?? "upstream_error";
  if (code === "server_not_connected") return "Notion이 연결돼 있지 않아요 (claude.ai 설정 → 커넥터)";
  if (code === "needs_reauth") return "Notion을 다시 연결해 주세요";
  if (code === "not_in_manifest" || code === "approval_required" || code === "consent_required") return "Notion 허용이 필요해요";
  return `${what}에 실패했어요 (${code})`;
}

export async function loadEvents(): Promise<{ ok: boolean; events: RemoteEvent[]; detail?: string }> {
  const mcp = await getMcp();
  if (!mcp) return { ok: false, events: [], detail: "claude.ai에서 열었을 때만 일정을 불러와요" };
  const { NOTION } = await import("../../notion.config");
  try {
    const list = await rows(mcp, NOTION.databases.schedule.view);
    const events = list
      .map((r) => ({
        url: str(r.url),
        title: str(r["일정"]),
        date: dateStr(r, "날짜"),
        time: str(r["시간"]),
        place: str(r["장소"]),
        memo: str(r["메모"]),
        status: str(r["상태"]) || "예정",
      }))
      .filter((e) => e.title && e.date)
      .sort((a, b) => `${a.date} ${a.time || "99:99"}`.localeCompare(`${b.date} ${b.time || "99:99"}`));
    return { ok: true, events };
  } catch (err) {
    return { ok: false, events: [], detail: mcpDetail(err, "일정 불러오기") };
  }
}

function eventProps(e: Partial<EventInput>) {
  const p: Record<string, string | number> = {};
  if (e.title !== undefined) p["일정"] = e.title.slice(0, 200);
  if (e.date !== undefined) {
    p["date:날짜:start"] = e.date;
    p["date:날짜:is_datetime"] = 0;
  }
  if (e.time !== undefined) p["시간"] = e.time;
  if (e.place !== undefined) p["장소"] = e.place.slice(0, 200);
  if (e.memo !== undefined) p["메모"] = e.memo.slice(0, 500);
  if (e.status !== undefined) p["상태"] = e.status;
  return p;
}

export async function createEvents(items: EventInput[]): Promise<{ ok: boolean; detail?: string }> {
  if (!items.length) return { ok: true };
  const mcp = await getMcp();
  if (!mcp) return { ok: false, detail: "claude.ai에서 열었을 때만 일정을 저장해요" };
  const { NOTION } = await import("../../notion.config");
  try {
    await mcp.callTool(
      SERVER,
      "notion-create-pages",
      {
        parent: { type: "data_source_id", data_source_id: NOTION.databases.schedule.dataSource },
        pages: items.map((e) => ({
          properties: { ...eventProps({ ...e, status: e.status ?? "예정" }), "원문": (e.raw ?? "").slice(0, 500), "등록": "비서 채팅" },
        })),
        allow_async: false,
      },
      { cache: false },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: mcpDetail(err, "일정 저장") };
  }
}

export async function updateEvent(url: string, change: Partial<EventInput>): Promise<{ ok: boolean; detail?: string }> {
  const mcp = await getMcp();
  if (!mcp) return { ok: false, detail: "claude.ai에서 열었을 때만 일정을 고쳐요" };
  try {
    await mcp.callTool(
      SERVER,
      "notion-update-page",
      { page_id: url, command: "update_properties", properties: eventProps(change), allow_async: false },
      { cache: false },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: mcpDetail(err, "일정 수정") };
  }
}

/** 대표가 비서 채팅창에서 "삭제해"라고 한 일정만 Notion 휴지통으로 (복구 가능) */
export async function deleteEvents(urls: string[]): Promise<{ ok: boolean; detail?: string }> {
  if (!urls.length) return { ok: true };
  const mcp = await getMcp();
  if (!mcp) return { ok: false, detail: "claude.ai에서 열었을 때만 일정을 지워요" };
  const ids = urls.map((u) => u.match(/[0-9a-f]{32}/i)?.[0]).filter((x): x is string => !!x);
  try {
    await mcp.callTool(SERVER, "notion-delete-pages", { page_ids: ids, user_confirmed: true }, { cache: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: mcpDetail(err, "일정 삭제") };
  }
}
