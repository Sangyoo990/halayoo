import { useCallback, useEffect, useRef, useState } from "react";
import { createEvents, deleteEvents, loadEvents, submitOrder, updateEvent, type EventInput, type RemoteEvent } from "./game/report";
import { setRemoteSchedule } from "./game/schedule";

/* 💬 비서 채팅창 — 대표가 편하게 말하면 비서(Claude)가 일정을 골라 📅 대표 일정(Notion)에 저장한다.
   저장된 일정은 당일 아침 07:51 아이폰 알림, 전날 저녁 마감 요약에 "내일 일정"으로 나간다. */

type Use = (n: string) => Promise<unknown>;
type SampleFn = {
  json: <T>(input: string, opts?: { cache?: false }) => Promise<T>;
};
type Line = { id: string; from: "me" | "sec"; text: string; time: string };
type Plan = {
  reply?: string;
  add?: { title?: string; date?: string; time?: string; place?: string; memo?: string; needsCheck?: boolean }[];
  update?: { id?: string; title?: string; date?: string; time?: string; place?: string; memo?: string; status?: string }[];
  delete?: string[];
  order?: { team?: string; text?: string } | null;
};
const TEAMS = ["취업준비팀", "일반지원팀", "국제동향보고서팀", "연구소모임팀"];

const KEY = "team-sangyu:secretary-chat";
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const STATUSES = ["예정", "확인 필요", "취소", "알림 완료"];

function seoulParts(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const date = `${g("year")}-${g("month")}-${g("day")}`;
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, time: `${g("hour").replace("24", "00")}:${g("minute")}`, wd };
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function md(date: string) {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${DAYS[wd]})`;
}

function readLines(): Line[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Line[]).slice(-60) : [];
  } catch {
    return [];
  }
}

function writeLines(lines: Line[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines.slice(-60)));
  } catch {
    // 저장이 막혀도 이번 화면에서는 동작
  }
}

const okDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const okTime = (s?: string) => !s || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export default function SecretaryChat({ secName }: { secName: string }) {
  const [lines, setLines] = useState<Line[]>(readLines);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [sample, setSample] = useState<SampleFn | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<RemoteEvent[]>([]);

  const push = useCallback((from: Line["from"], text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, from, text, time: seoulParts().time }];
      writeLines(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const r = await loadEvents();
    if (!r.ok) {
      setLoadErr(r.detail ?? "일정을 못 불러왔어요");
      return eventsRef.current;
    }
    setLoadErr("");
    eventsRef.current = r.events;
    setEvents(r.events);
    setRemoteSchedule(
      r.events.map((e) => ({
        id: `notion-${e.url}`, date: e.date, time: e.time || undefined, title: e.title,
        note: [e.place, e.status === "확인 필요" ? "확인 필요" : ""].filter(Boolean).join(" · ") || undefined,
        source: "notion" as const, url: e.url, status: e.status,
      })),
    );
    return r.events;
  }, []);

  useEffect(() => {
    void refresh();
    const use = (window as unknown as { claude?: { use: Use } }).claude?.use;
    if (use) use("sample").then((s) => setSample((s as SampleFn) ?? null)).catch(() => setSample(null));
  }, [refresh]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    const history = lines.slice(-16);
    push("me", text);
    setBusy(true);
    try {
      if (!sample) {
        push("sec", "⚠️ 지금은 비서(Claude)와 연결이 안 돼요. claude.ai에서 이 오피스를 열고, Claude 사용 허용을 물어보면 허용해 주세요. 그 전엔 일정을 함부로 저장하지 않을게요.");
        return;
      }
      const now = seoulParts();
      const list = await refresh();
      const upcoming = list.filter((e) => e.date >= addDays(now.date, -7) && e.status !== "취소");
      const ids = new Map(upcoming.map((e, i) => [`E${i + 1}`, e]));
      const context = upcoming
        .map((e, i) => `E${i + 1} | ${e.date}(${DAYS[new Date(`${e.date}T00:00:00Z`).getUTCDay()]}) | ${e.time || "시간 미정"} | ${e.title}${e.place ? ` | 장소 ${e.place}` : ""} | 상태 ${e.status}${e.memo ? ` | 메모 ${e.memo}` : ""}`)
        .join("\n");
      const transcript = history.map((l) => `${l.from === "me" ? "대표" : secName}: ${l.text}`).join("\n");
      const prompt = [
        `너는 "team 상유"의 대표 이상유(행정안전부 국제협력담당관실 청년인턴, 연구소모임 4조 조장, 공기업·대기업 문과 직무 취업 준비 중)를 모시는 수행비서 ${secName}이야.`,
        `대표와 평소처럼 대화해: 질문에 답하고, 상의에 의견을 주고, 문장 다듬기·아이디어·간단한 정리도 도와. 일정 얘기가 나오면 일정 DB를 관리하고, 팀에 맡길 조사·자료 작업이면 지시함에 올려. 모르는 사실·최신 정보는 지어내지 말고 "확인이 필요해요"라고 하거나 팀에 조사 지시를 올리자고 제안해.`,
        `지금: ${now.date} (${DAYS[now.wd]}요일) ${now.time}, 한국 시간.`,
        `## 저장된 일정 (id | 날짜 | 시간 | 일정 | ...)\n${context || "(없음)"}`,
        `## 최근 대화\n${transcript || "(없음)"}`,
        `## 대표의 새 말\n${text}`,
        `## 일정 규칙
- "내일"=+1일, "모레"=+2일, "○요일"=오늘 포함 가장 가까운 그 요일, "다음주 ○요일"=다음 주(월요일 시작), "M/D"=올해(지났으면 내년). 시간은 24시간 HH:MM. "전일·종일·하루 종일"이면 time "" 이고 memo에 "종일".
- 새 일정만 add. 이미 있는 일정을 말하면 add 하지 말고 update(id).
- 대표가 "맞아/응/그래"처럼 확인해 주면, 최근 대화에서 비서가 물어본 그 일정을 update: status "예정", memo는 확인된 내용으로 고쳐 써 (예: "저녁 맞음 · 시간 미정").
- "삭제/지워/없애"는 delete에 그 id. "취소됐어"도 delete (대표가 기록을 남기라고 하면 update status "취소").
- 애매하면 add/update 하지 말고 reply로 짧게 물어봐. 확실한 건 바로 처리.
## 지시 규칙
- 대표가 팀에게 조사·자료·보고를 시키면 order = {"team": 취업준비팀/일반지원팀/국제동향보고서팀/연구소모임팀 중 하나, "text": 지시 내용 한두 문장}. 아니면 order = null.
## 답장
- reply: 존댓말, 비서답게 간결하게(보통 1~4문장, 필요하면 더 길게). 처리한 내용은 앱이 따로 덧붙이니 반복 나열하지 말고 핵심만.
JSON 하나로만 답해:
{"reply":"...","add":[{"title":"","date":"YYYY-MM-DD","time":"","place":"","memo":"","needsCheck":false}],"update":[{"id":"E1","title":"","date":"","time":"","place":"","memo":"","status":""}],"delete":["E2"],"order":null}
update에는 바꿀 필드만 넣어 (안 바꾸는 필드는 빼).`,
      ].join("\n\n");

      let plan: Plan;
      try {
        plan = await sample.json<Plan>(prompt, { cache: false });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "upstream_error";
        const why =
          code === "not_granted" ? "Claude 사용이 허용되지 않았어요 — 페이지의 권한 메뉴에서 허용해 주세요"
          : code === "rate_limited" ? "요청이 잠시 많아요 — 조금 뒤에 다시 말씀해 주세요"
          : code === "session_expired" ? "다시 로그인해 주세요"
          : code === "invalid_json" ? "답을 정리하다 꼬였어요 — 한 번만 다시 말씀해 주세요"
          : `연결 문제가 생겼어요 (${code}) — 다시 말씀해 주세요`;
        push("sec", `⚠️ ${why}. 이번 말씀은 아무것도 저장하지 않았어요.`);
        return;
      }

      const done: string[] = [];
      const problems: string[] = [];
      const adds: EventInput[] = (plan.add ?? [])
        .filter((a) => a && a.title && okDate(a.date) && okTime(a.time))
        .map((a) => ({
          title: String(a.title), date: String(a.date), time: a.time ?? "", place: a.place ?? "", memo: a.memo ?? "",
          status: a.needsCheck ? "확인 필요" : "예정", raw: text,
        }));
      if (adds.length) {
        const r = await createEvents(adds);
        if (r.ok) adds.forEach((a) => done.push(`📅 추가 · ${md(a.date)} ${a.time || "시간 미정"} ${a.title}${a.status === "확인 필요" ? " (확인 필요)" : ""}`));
        else problems.push(r.detail ?? "저장 실패");
      }
      for (const u of plan.update ?? []) {
        const target = u?.id ? ids.get(u.id) : undefined;
        if (!target) continue;
        const change: Partial<EventInput> = {};
        if (typeof u.title === "string" && u.title.trim()) change.title = u.title.trim();
        if (okDate(u.date)) change.date = u.date;
        if (typeof u.time === "string" && okTime(u.time) && "time" in u) change.time = u.time;
        if (typeof u.place === "string" && "place" in u) change.place = u.place;
        if (typeof u.memo === "string" && "memo" in u) change.memo = u.memo;
        if (u.status && STATUSES.includes(u.status)) change.status = u.status;
        if (!Object.keys(change).length) continue;
        const r = await updateEvent(target.url, change);
        if (r.ok) done.push(`✏️ 수정 · ${md(change.date ?? target.date)} ${(change.time ?? target.time) || "시간 미정"} ${change.title ?? target.title}${change.status ? ` → ${change.status}` : ""}`);
        else problems.push(r.detail ?? "수정 실패");
      }
      const dels = (plan.delete ?? []).map((id) => ids.get(id)).filter((e): e is RemoteEvent => !!e);
      if (dels.length) {
        const r = await deleteEvents(dels.map((e) => e.url));
        if (r.ok) dels.forEach((e) => done.push(`🗑️ 삭제 · ${md(e.date)} ${e.time || "시간 미정"} ${e.title}`));
        else problems.push(r.detail ?? "삭제 실패");
      }
      if (plan.order && plan.order.text && TEAMS.includes(plan.order.team ?? "")) {
        const r = await submitOrder(plan.order.text, plan.order.team!);
        if (r.ok) done.push(`📮 ${plan.order.team}에 지시 등록 — 다음 업무 시간(08:41 / 17:27)에 처리`);
        else problems.push(r.detail);
      }
      const msg = [plan.reply?.trim(), done.join("\n"), problems.length ? `⚠️ ${problems.join(" · ")}` : ""].filter(Boolean).join("\n");
      push("sec", msg || "네, 알겠습니다.");
      if (adds.length || dels.length || (plan.update ?? []).length) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const today = seoulParts().date;
  const shown = events.filter((e) => e.date >= today && e.status !== "취소").slice(0, 6);

  return (
    <section className="win rail-card sec-card" id="secretary-chat">
      <div className="win-bar">
        <span>💬 secretary.chat — 비서 {secName}</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body sec-body">
        <div className="sec-log console-log" ref={logRef}>
          {lines.length === 0 ? (
            <div className="console-line staff">
              <b>{secName}</b>
              <p>{`대표님, ${secName}입니다. 편하게 말씀 주세요.\n· 일정: \"금요일 15:30 인터뷰 촬영 있어\" → 저장하고 당일 아침에 알려드려요. 고치기·삭제도 말로 하시면 돼요.\n· 상의·질문·문장 다듬기도 같이 해드려요.\n· \"취업팀에 ○○ 조사시켜\" → 지시함에 올려요.`}</p>
            </div>
          ) : null}
          {lines.map((l) => (
            <div key={l.id} className={`console-line ${l.from === "me" ? "ceo" : "staff"}`}>
              <b>{l.from === "me" ? "대표님" : secName}</b>
              <p>{l.text}</p>
              <small>{l.time}</small>
            </div>
          ))}
          {busy ? (
            <div className="console-line staff">
              <b>{secName}</b>
              <p>메모하는 중…</p>
            </div>
          ) : null}
        </div>

        <form
          className="console-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="유지민에게 말하기 (일정·질문·지시 무엇이든)"
            aria-label="비서에게 보내기"
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            보내기
          </button>
        </form>

        <div className="sec-upcoming">
          <div className="sec-up-head">
            <b>📅 다가오는 일정</b>
            <button onClick={() => void refresh()} aria-label="일정 새로고침">
              ↻
            </button>
          </div>
          {loadErr ? <p className="file-note">{loadErr}</p> : null}
          {shown.length ? (
            <ul>
              {shown.map((e) => (
                <li key={e.url} className={e.status === "확인 필요" ? "check" : ""}>
                  <span>{md(e.date)}</span>
                  <span>{e.time || "미정"}</span>
                  {e.url.startsWith("https://") ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.title}
                    </a>
                  ) : (
                    <span>{e.title}</span>
                  )}
                  {e.status === "확인 필요" ? <em>확인 필요</em> : null}
                </li>
              ))}
            </ul>
          ) : !loadErr ? (
            <p className="file-note">예정된 일정이 없어요.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
