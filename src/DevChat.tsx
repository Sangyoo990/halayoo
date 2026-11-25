import { useEffect, useRef, useState } from "react";

/* 🛠️ 개발팀장 창 — 여기 쓴 요청은 claude.ai의 "Claude에게 보내기"와 같은 길로
   이 오피스를 만드는 Claude 대화에 바로 전달된다. 답은 이 창에 붙는 댓글 스레드로 온다. */

type Use = (n: string) => Promise<unknown>;
type Anchor = { path: string; x: number; y: number };
type CommentsNs = {
  anchorFor: (el: Element) => Promise<Anchor>;
  canSendToClaude: () => Promise<"available" | "writers_only" | "no_session" | "off">;
  sendToClaude: (t: { anchor: Anchor; text: string } | { threadId: string; text: string }) => Promise<{ threadId: string }>;
};
type Sent = { id: string; text: string; time: string; threadId: string };

const KEY = "team-sangyu:dev-chat";
const MAX = 3800;

function readSent(): Sent[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Sent[]).slice(-20) : [];
  } catch {
    return [];
  }
}
function writeSent(list: Sent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* 저장 안 돼도 이번 화면에선 동작 */
  }
}
function nowTime() {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

const WHY: Record<string, string> = {
  writers_only: "개발 요청은 이 오피스의 편집 권한이 있는 사람만 보낼 수 있어요.",
  no_session: "지금은 개발 대화가 연결돼 있지 않아요. 잠시 뒤 다시 시도하거나, 화면 댓글에서 \"Claude에게 보내기\"를 써 주세요.",
  off: "이 화면에서는 개발 요청을 보낼 수 없어요. claude.ai에서 오피스를 열어 주세요.",
};

export default function DevChat({ devName }: { devName: string }) {
  const [comments, setComments] = useState<CommentsNs | null | undefined>(undefined);
  const [can, setCan] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState<Sent[]>(readSent);
  const [followUp, setFollowUp] = useState(false);
  const boxRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const use = (window as unknown as { claude?: { use: Use } }).claude?.use;
    if (!use) {
      setComments(null);
      return;
    }
    use("comments")
      .then((c) => setComments((c as CommentsNs) ?? null))
      .catch(() => setComments(null));
  }, []);

  const check = async (c: CommentsNs) => {
    try {
      const v = await c.canSendToClaude();
      setCan(v);
      return v;
    } catch {
      setCan("off");
      return "off";
    }
  };

  useEffect(() => {
    if (comments) void check(comments);
  }, [comments]);

  const last = sent[sent.length - 1];

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !comments || !boxRef.current) return;
    setBusy(true);
    setMsg("");
    try {
      const state = await check(comments);
      if (state !== "available") {
        setMsg(WHY[state] ?? WHY.off);
        return;
      }
      const body = `[🛠️ 개발팀장 ${devName}에게 · 대표 요청]\n${text}`.slice(0, MAX);
      const res =
        followUp && last
          ? await comments.sendToClaude({ threadId: last.threadId, text: body })
          : await comments.sendToClaude({ anchor: await comments.anchorFor(boxRef.current), text: body });
      const next = [...sent, { id: `${Date.now()}`, text, time: nowTime(), threadId: res.threadId }];
      setSent(next);
      writeSent(next);
      setDraft("");
      setMsg("✅ 전달했어요. 작업이 끝나면 이 창에 붙은 💬 댓글 스레드에 답이 달려요 (화면이 새 버전으로 바뀔 수도 있어요).");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "upstream_error";
      setMsg(
        code === "consent_required" ? "⚠️ 댓글 쓰기 허용이 필요해요. 허용 창이 뜨면 허용하고 다시 보내 주세요. (쓴 내용은 그대로 있어요)"
        : code === "forbidden" ? "⚠️ 이 화면에서는 댓글로 보낼 수 없게 설정돼 있어요. claude.ai 댓글 패널에서 허용해 주세요."
        : code === "claude_unavailable" ? `⚠️ ${WHY.no_session}`
        : code === "rate_limited" ? "⚠️ 조금 천천히 보내 주세요. 잠시 뒤 다시 시도해 주세요."
        : code === "not_found" ? "⚠️ 이어 쓸 스레드가 없어졌어요. '새 요청'으로 보내 주세요."
        : `⚠️ 보내지 못했어요 (${code}). 다시 한 번 눌러 주세요.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="win rail-card dev-card" id="dev-chat" ref={boxRef}>
      <div className="win-bar">
        <span>🛠️ dev.chat — 개발팀장 {devName}</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body dev-body">
        <p className="dev-intro">
          오피스 화면·기능을 고치거나 새로 만들 일은 여기에 말씀하세요. 개발 담당 Claude에게 바로 가고, 끝나면 이 창에 댓글로 답해요.
        </p>
        {comments === null ? (
          <p className="file-note">claude.ai에서 이 오피스를 열었을 때만 보낼 수 있어요.</p>
        ) : (
          <>
            {can && can !== "available" ? <p className="file-note">{WHY[can] ?? WHY.off}</p> : null}
            <textarea
              className="dev-input"
              value={draft}
              maxLength={MAX - 40}
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="예: 결재 창 글씨 키워줘 / 공고 창에 마감 임박 표시 추가해줘"
              aria-label="개발팀장에게 요청"
              disabled={busy}
            />
            <div className="dev-actions">
              {last ? (
                <label className="console-now">
                  <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
                  직전 요청에 이어서
                </label>
              ) : (
                <span />
              )}
              <button className="dev-send" onClick={() => void send()} disabled={busy || !draft.trim() || comments === undefined}>
                {busy ? "보내는 중…" : "개발팀장에게 보내기"}
              </button>
            </div>
          </>
        )}
        {msg ? <p className="file-msg">{msg}</p> : null}
        {sent.length ? (
          <ul className="dev-sent">
            {sent
              .slice(-4)
              .reverse()
              .map((s) => (
                <li key={s.id}>
                  <small>{s.time}</small>
                  <span>{s.text}</span>
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
