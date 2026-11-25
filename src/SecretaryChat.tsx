import { useCallback, useEffect, useRef, useState } from "react";
import { createEvents, loadEvents, updateEvent, type EventInput, type RemoteEvent } from "./game/report";
import { setRemoteSchedule } from "./game/schedule";

/* 💬 비서 채팅창 — 대표가 편하게 말하면 비서(Claude)가 일정을 골라 📅 대표 일정(Notion)에 저장한다.
   저장된 일정은 당일 아침 07:51 아이폰 알림, 전날 저녁 마감 요약에 "내일 일정"으로 나간다. */

type Use = (n: string) => Promise<unknown>;
type SampleFn = {
  json: <T>(input: string, opts?: { modelTier?: "quick" | "default" | "complex"; cache?: false }) => Promise<T>;
};
type Line = { id: string; from: "me" | "sec"; text: string; time: string };
type Plan = {
  reply?: string;
  add?: { title?: string; date?: string; time?: string; place?: string; memo?: string; needsCheck?: boolean }[];
  update?: { ref?: number; title?: string; date?: string; time?: string; place?: string; memo?: string; status?: string }[];
};

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

/** Claude를 못 쓸 때의 간단한 해석: 오늘/내일/모레/○요일/M월 D일/M/D + HH:MM·오후 N시 */
function simpleParse(text: string, today: string, wd: number): EventInput[] {
  const out: EventInput[] = [];
  for (const part of text.split(/[,，]|\s그리고\s|있고|이고|\n/).map((s) => s.trim()).filter(Boolean)) {
    let date = "";
    let m: RegExpMatchArray | null;
    if (/오늘/.test(part)) date = today;
    else if (/내일/.test(part)) date = addDays(today, 1);
    else if (/모레/.test(part)) date = addDays(today, 2);
    else if ((m = part.match(/(\d{1,2})\s*(?:월|\/)\s*(\d{1,2})\s*일?/))) {
      const y = Number(today.slice(0, 4));
      let cand = `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      if (cand < today) cand = `${y + 1}${cand.slice(4)}`;
      date = cand;
    } else if ((m = part.match(/(다음\s*주\s*)?([일월화수목금토])요일/))) {
      const target = DAYS.indexOf(m[2]);
      if (m[1]) {
        const toNextMon = (8 - wd) % 7 || 7;
        date = addDays(today, toNextMon + (target === 0 ? 6 : target - 1));
      } else date = addDays(today, (target - wd + 7) % 7);
    }
    if (!date) continue;
    let time = "";
    if ((m = part.match(/(\d{1,2}):(\d{2})/))) time = `${m[1].padStart(2, "0")}:${m[2]}`;
    else if ((m = part.match(/(오전|오후|저녁|밤)?\s*(\d{1,2})시\s*(반|(\d{1,2})분)?/))) {
      let h = Number(m[2]);
      if (m[1] && m[1] !== "오전" && h < 12) h += 12;
      const min = m[3] === "반" ? "30" : (m[4] ?? "00").padStart(2, "0");
      time = `${String(h).padStart(2, "0")}:${min}`;
    }
    const title = part
      .replace(/(다음\s*주\s*)?(오늘|내일|모레|[일월화수목금토]요일|\d{1,2}\s*(월|\/)\s*\d{1,2}\s*일?)/g, "")
      .replace(/(오전|오후)?\s*\d{1,2}(:\d{2}|시\s*(반|\d{1,2}분)?)\s*(에|부터)?/g, "")
      .replace(/(있어|있음|있다|잡혀\s*있어|예정이야|예정)\.?$/g, "")
      .trim();
    if (title) out.push({ title, date, time, raw: part, status: "예정" });
  }
  return out;
}

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
    push("me", text);
    setBusy(true);
    try {
      const now = seoulParts();
      const list = await refresh();
      const upcoming = list.filter((e) => e.date >= addDays(now.date, -1) && e.status !== "취소");
      let plan: Plan;
      if (sample) {
        const context = upcoming
          .map((e, i) => `${i}. ${e.date}(${DAYS[new Date(`${e.date}T00:00:00Z`).getUTCDay()]}) ${e.time || "시간 미정"} ${e.title}${e.place ? ` @${e.place}` : ""} [${e.status}]${e.memo ? ` 메모: ${e.memo}` : ""}`)
          .join("\n");
        const prompt = [
          `너는 대표 이상유의 수행비서 ${secName}이야. 대표가 비서 채팅창에 보낸 말을 읽고 일정을 저장·수정해.`,
          `지금: ${now.date} (${DAYS[now.wd]}요일) ${now.time}, 한국 시간.`,
          `날짜 규칙: "내일"=+1일, "모레"=+2일, "○요일"=오늘 포함 가장 가까운 그 요일, "다음주 ○요일"=다음 주(월요일 시작) 그 요일, "M/D"·"M월 D일"=올해(이미 지났으면 내년). 시간은 24시간 HH:MM, "오후 3시 반"=15:30. 시간이 없으면 "".`,
          `애매하면 지어내지 말고 needsCheck=true와 memo에 무엇이 애매한지 적어 (예: "저녁 오찬" → 오찬은 보통 점심이라 확인 필요, 시간 없음).`,
          `이미 저장된 일정 (번호. 날짜 시간 일정 [상태]):\n${context || "(없음)"}`,
          `이미 있는 일정과 같은 건 새로 넣지 말고, 대표가 시간·장소를 알려주거나 확인해 주면 update로 그 번호(ref)를 고쳐 (확인되면 status "예정"). 취소한다고 하면 status "취소".`,
          `일정이 아닌 말(질문·잡담)은 add/update 없이 reply로만 짧게 답해. "이번 주 일정 뭐야" 같은 질문은 위 목록으로 답해.`,
          `reply는 존댓말 1~3문장, 저장·수정한 내용과 확인이 필요한 것(질문 1개)을 말해.`,
          `JSON만 답해: {"reply":"...","add":[{"title":"","date":"YYYY-MM-DD","time":"HH:MM 또는 빈 문자열","place":"","memo":"","needsCheck":false}],"update":[{"ref":0,"title":"(바꿀 때만)","date":"","time":"","place":"","memo":"","status":""}]}`,
          `대표의 말:\n${text}`,
        ].join("\n\n");
        try {
          plan = await sample.json<Plan>(prompt, { modelTier: "default", cache: false });
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "rate_limited") {
            push("sec", "잠시 요청이 많아요. 조금 뒤에 다시 말씀해 주세요.");
            return;
          }
          const add = simpleParse(text, now.date, now.wd);
          plan = { reply: add.length ? "" : "말씀을 일정으로 읽지 못했어요. 날짜(내일·금요일·12/3)와 시간을 같이 말씀해 주세요.", add };
        }
      } else {
        const add = simpleParse(text, now.date, now.wd);
        plan = { reply: add.length ? "" : "날짜를 못 읽었어요. 예: \"내일 12:00 오찬\", \"금요일 15:30 인터뷰 촬영\"", add };
      }

      const adds: EventInput[] = (plan.add ?? [])
        .filter((a) => a && a.title && okDate(a.date) && okTime(a.time))
        .map((a) => ({
          title: String(a.title), date: String(a.date), time: a.time ?? "", place: a.place ?? "", memo: a.memo ?? "",
          status: a.needsCheck ? "확인 필요" : "예정", raw: text,
        }));
      const done: string[] = [];
      const problems: string[] = [];
      if (adds.length) {
        const r = await createEvents(adds);
        if (r.ok) adds.forEach((a) => done.push(`📅 ${md(a.date)} ${a.time || "시간 미정"} ${a.title}${a.status === "확인 필요" ? " (확인 필요)" : ""}`));
        else problems.push(r.detail ?? "저장 실패");
      }
      for (const u of plan.update ?? []) {
        const target = typeof u.ref === "number" ? upcoming[u.ref] : undefined;
        if (!target) continue;
        const change: Partial<EventInput> = {};
        if (u.title) change.title = u.title;
        if (okDate(u.date)) change.date = u.date;
        if (u.time !== undefined && u.time !== "" && okTime(u.time)) change.time = u.time;
        if (u.place) change.place = u.place;
        if (u.memo !== undefined && u.memo !== "") change.memo = u.memo;
        if (u.status && STATUSES.includes(u.status)) change.status = u.status;
        if (!Object.keys(change).length) continue;
        const r = await updateEvent(target.url, change);
        if (r.ok) done.push(`✏️ ${md(change.date ?? target.date)} ${change.time ?? (target.time || "시간 미정")} ${change.title ?? target.title}${change.status ? ` → ${change.status}` : ""}`);
        else problems.push(r.detail ?? "수정 실패");
      }
      const msg = [plan.reply?.trim(), done.length ? done.join("\n") : "", problems.length ? `⚠️ ${problems.join(" · ")}` : ""]
        .filter(Boolean)
        .join("\n");
      push("sec", msg || "알겠습니다.");
      if (done.length) {
        await refresh();
        push("sec", "🔔 당일 아침 07:51에 아이폰으로, 전날 저녁 마감 요약에서 미리 알려드릴게요.");
      }
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
              <p>{"일정은 편하게 말씀만 주세요. 제가 저장해 두고 당일 아침에 알려드릴게요.\n예: 내일 12시 오찬 있고, 금요일 15:30에 인터뷰 촬영 있어"}</p>
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
            placeholder="예: 금요일 15:30 인터뷰 촬영 있어"
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
