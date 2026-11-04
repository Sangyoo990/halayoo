import { useCallback, useEffect, useState } from "react";
import { NOTION } from "../notion.config";

/**
 * Notion 결과 창 — 예약 작업이 Notion에 쌓은 결과를 오피스 화면에서 바로 보여준다.
 * claude.ai에서 열었을 때, 보는 사람(대표)의 Notion 연결로 읽는다. (읽기 전용)
 */

const SERVER = "Notion";
const TOOL = "notion-query-data-sources";

type Row = Record<string, unknown>;
type SectionState =
  | { status: "loading" }
  | { status: "ok"; rows: Row[]; at: number }
  | { status: "error"; code: string; message: string };

type McpErr = { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
type McpNs = {
  callTool: (
    server: string,
    tool: string,
    input?: unknown,
    options?: { cache?: false | { staleTime?: number; gcTime?: number; refresh?: boolean } },
  ) => Promise<{ payload?: unknown; cache?: { storedAt: number } }>;
};

declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<unknown> };
  }
}

/** 보기(view) 방식으로 읽기 — 무료 요금제의 조회 한도에 걸리지 않는다. 거르기·정렬은 화면에서 한다 */
const viewInput = (viewUrl: string) => ({ mode: "view", view_url: viewUrl, page_size: 100 });

/** 날짜 속성 기준 최신순 */
const byDateDesc = (name: string) => (a: Row, b: Row) =>
  isoOf(b, name).localeCompare(isoOf(a, name)) || text(b.createdTime).localeCompare(text(a.createdTime));

const SECTIONS = [
  {
    key: "approvals",
    title: "✅ 결재 대기",
    empty: "결재 대기 중인 안건이 없어요.",
    input: viewInput(NOTION.databases.approvals.view),
    pick: (rows: Row[]) => rows.filter((r) => text(r["상태"]) === "결재 대기").sort(byDateDesc("날짜")),
    titleKey: "안건",
    meta: (r: Row) => [text(r["팀"]), dateOf(r, "날짜")],
  },
  {
    key: "jobs",
    title: "🎯 최근 수집 공고",
    empty: "아직 수집된 공고가 없어요. 매일 아침 공고 수집이 끝나면 여기 쌓여요.",
    input: viewInput(NOTION.databases.jobs.view),
    pick: (rows: Row[]) => [...rows].sort(byDateDesc("수집일")),
    titleKey: "공고명",
    meta: (r: Row) => [text(r["기업·기관"]), text(r["구분"]), deadline(dateOf(r, "마감일")), text(r["상태"])],
    link: "링크",
  },
  {
    key: "library",
    title: "🎓 취업 자료실",
    empty: "아직 쌓인 자료가 없어요. 매일 아침 유튜브·면접 자료가 여기 쌓여요.",
    input: viewInput(NOTION.databases.library.view),
    pick: (rows: Row[]) => [...rows].sort(byDateDesc("날짜")),
    titleKey: "제목",
    meta: (r: Row) => [text(r["구분"]), text(r["출처"]), dateOf(r, "날짜")],
    link: "링크",
  },
  {
    key: "news",
    title: "📰 일일 소식",
    empty: "아직 정리된 소식이 없어요.",
    input: viewInput(NOTION.databases.news.view),
    pick: (rows: Row[]) => [...rows].sort(byDateDesc("날짜")),
    titleKey: "제목",
    meta: (r: Row) => [text(r["분야"]), dateOf(r, "날짜")],
    link: "링크",
  },
  {
    key: "global",
    title: "🌏 국제동향",
    empty: "아직 정리된 국제동향이 없어요.",
    input: viewInput(NOTION.databases.global.view),
    pick: (rows: Row[]) => [...rows].sort(byDateDesc("날짜")),
    titleKey: "제목",
    meta: (r: Row) => [text(r["구분"]), list(r["국가·지역"]), text(r["결재"])],
    link: "링크",
  },
  {
    key: "lab",
    title: "🔬 연구 소모임",
    empty: "아직 올라온 연구 소모임 결과가 없어요.",
    input: viewInput(NOTION.databases.lab.view),
    pick: (rows: Row[]) => [...rows].sort(byDateDesc("날짜")),
    titleKey: "제목",
    meta: (r: Row) => [text(r["구분"]), dateOf(r, "날짜"), text(r["결재"])],
    link: "원본 링크",
  },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

// ── 값 꺼내기 (Notion 행은 속성 이름 → 문자열) ─────────────────
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** 다중 선택은 '["a","b"]' 같은 JSON 문자열로 온다 */
function list(v: unknown): string {
  const s = text(v);
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(String).join("·");
    } catch {
      /* 그대로 표시 */
    }
  }
  return s;
}

/** 날짜는 "date:<이름>:start" 또는 "<이름>" 으로 올 수 있다 → YYYY-MM-DD */
function isoOf(r: Row, name: string): string {
  const raw = text(r[`date:${name}:start`]) || text(r[name]);
  return raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function dateOf(r: Row, name: string): string {
  const iso = isoOf(r, name);
  return iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "";
}

function deadline(md: string): string {
  return md ? `마감 ${md}` : "";
}

function safeUrl(v: unknown): string | null {
  const s = text(v).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function describeError(code: string): string {
  switch (code) {
    case "server_not_connected":
      return "Notion이 연결돼 있지 않아요. claude.ai 설정 → 커넥터에서 Notion을 추가해 주세요.";
    case "needs_reauth":
      return "Notion 연결이 만료됐어요. claude.ai 설정 → 커넥터에서 Notion을 다시 연결해 주세요.";
    case "selection_required":
      return "Notion 연결이 여러 개예요. 화면에 뜨는 선택 창에서 하나를 골라주세요.";
    case "not_in_manifest":
    case "approval_required":
    case "consent_required":
      return "이 페이지가 Notion을 읽도록 허용이 필요해요.";
    case "blocked_by_policy":
      return "조직 정책으로 이 Notion 기능이 막혀 있어요.";
    case "server_unavailable":
      return "Notion이 잠시 응답하지 않아요. 잠시 뒤 새로고침해 주세요.";
    case "tool_error":
      return "Notion이 요청을 처리하지 못했어요. 잠시 뒤 새로고침해 주세요.";
    default:
      return "Notion 결과를 불러오지 못했어요.";
  }
}

const NEEDS_ALLOW = new Set(["not_in_manifest", "approval_required", "consent_required"]);

export default function NotionPanel({ compact = false }: { compact?: boolean }) {
  const [mcp, setMcp] = useState<McpNs | null | undefined>(undefined);
  const [state, setState] = useState<Partial<Record<SectionKey, SectionState>>>({});

  useEffect(() => {
    let alive = true;
    const use = window.claude?.use;
    if (!use) {
      setMcp(null);
      return;
    }
    use("mcp")
      .then((ns) => alive && setMcp((ns as McpNs) ?? null))
      .catch(() => alive && setMcp(null));
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(
    async (fresh: boolean) => {
      if (!mcp) return;
      const keys = compact ? (["approvals", "jobs"] as SectionKey[]) : SECTIONS.map((s) => s.key);
      setState((prev) => {
        const next = { ...prev };
        for (const k of keys) if (!next[k] || next[k]?.status === "error") next[k] = { status: "loading" };
        return next;
      });
      await Promise.all(
        SECTIONS.filter((s) => keys.includes(s.key)).map(async (section) => {
          const run = () =>
            mcp.callTool(SERVER, TOOL, { data: section.input }, {
              cache: { staleTime: 60_000, gcTime: 600_000, refresh: fresh },
            });
          try {
            let res;
            try {
              res = await run();
            } catch (err) {
              const e = err as McpErr;
              if (!e?.retryable) throw err;
              await new Promise((r) => setTimeout(r, Math.min(e.retryAfterMs ?? 1500, 5000) + Math.random() * 500));
              res = await run();
            }
            const payload = res.payload as { results?: Row[] } | undefined;
            const rows = section.pick(Array.isArray(payload?.results) ? payload!.results : []);
            setState((prev) => ({ ...prev, [section.key]: { status: "ok", rows, at: res.cache?.storedAt ?? Date.now() } }));
          } catch (err) {
            const e = err as McpErr;
            setState((prev) => ({
              ...prev,
              [section.key]: { status: "error", code: e?.code ?? "upstream_error", message: e?.message ?? "" },
            }));
          }
        }),
      );
    },
    [mcp, compact],
  );

  useEffect(() => {
    if (mcp) void load(false);
  }, [mcp, load]);

  const sections = compact ? SECTIONS.filter((s) => s.key === "approvals" || s.key === "jobs") : SECTIONS;
  const states = sections.map((s) => state[s.key]);
  const allSameError =
    states.length > 0 &&
    states.every((s) => s?.status === "error") &&
    new Set(states.map((s) => (s?.status === "error" ? s.code : ""))).size === 1
      ? (states[0] as { code: string })
      : null;

  return (
    <section className={`win ${compact ? "rail-card" : ""} notion-win`} id={compact ? "notion-rail" : "notion-results"}>
      <div className="win-bar">
        <span>📥 notion.results{compact ? " — 결재·공고" : " — Notion 결과"}</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body nt-body">
        {mcp === undefined ? <p className="nt-note">Notion 연결 확인 중…</p> : null}

        {mcp === null ? (
          <div className="nt-note">
            <p>Notion 결과는 이 페이지를 <b>claude.ai</b>에서 열었을 때 바로 보여요.</p>
            <a className="nt-open" href={NOTION.rootPage} target="_blank" rel="noreferrer">
              Notion에서 열기 ↗
            </a>
          </div>
        ) : null}

        {mcp ? (
          <>
            <div className="nt-tools">
              <button className="nt-btn" onClick={() => void load(true)}>
                ↻ 새로고침
              </button>
              <a className="nt-btn" href={NOTION.rootPage} target="_blank" rel="noreferrer">
                Notion 열기 ↗
              </a>
            </div>

            {allSameError ? (
              <div className="nt-error">
                <p>{describeError(allSameError.code)}</p>
                {NEEDS_ALLOW.has(allSameError.code) ? (
                  <button className="nt-btn" onClick={() => void load(true)}>
                    Notion 읽기 허용하기
                  </button>
                ) : null}
              </div>
            ) : (
              <div className={`nt-grid ${compact ? "compact" : ""}`}>
                {sections.map((section) => {
                  const s = state[section.key];
                  const dbUrl = NOTION.databases[section.key].url;
                  return (
                    <div className="nt-sec" key={section.key}>
                      <p className="nt-sec-head">
                        <b>{section.title}</b>
                        {s?.status === "ok" ? <i>{s.rows.length}건</i> : null}
                        <a href={dbUrl} target="_blank" rel="noreferrer">
                          전체 ↗
                        </a>
                      </p>
                      {!s || s.status === "loading" ? <p className="nt-empty">불러오는 중…</p> : null}
                      {s?.status === "error" ? (
                        <div className="nt-error small">
                          <p>{describeError(s.code)}</p>
                          {NEEDS_ALLOW.has(s.code) ? (
                            <button className="nt-btn" onClick={() => void load(true)}>
                              허용하기
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {s?.status === "ok" ? (
                        s.rows.length ? (
                          <ul className="nt-list">
                            {s.rows.slice(0, compact ? 4 : 12).map((row, i) => {
                              const title = text(row[section.titleKey]) || "(제목 없음)";
                              const page = safeUrl(row.url);
                              const ext = "link" in section ? safeUrl(row[section.link]) : null;
                              const meta = section.meta(row).filter(Boolean).join(" · ");
                              return (
                                <li key={page ?? i}>
                                  {page ? (
                                    <a href={page} target="_blank" rel="noreferrer">
                                      {title}
                                    </a>
                                  ) : (
                                    <span>{title}</span>
                                  )}
                                  {meta ? <small>{meta}</small> : null}
                                  {ext ? (
                                    <a className="nt-ext" href={ext} target="_blank" rel="noreferrer">
                                      원문 ↗
                                    </a>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="nt-empty">{section.empty}</p>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="nt-tip">읽기 전용이에요. 결재는 제목을 눌러 Notion에서 상태를 "승인"으로 바꿔주세요.</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
