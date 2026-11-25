import { useEffect, useRef, useState } from "react";
import type { Company } from "./game/sim";
import { attachmentText, runOrderNow, submitOrder, type Attachment } from "./game/report";

/* 📎 파일 공유창 — 파일은 아티팩트 assets 에, 목록(이름·담당팀·메모)은 db "files" 컬렉션에 둔다.
   지시를 함께 적으면 📮 대표 지시함에 첨부 정보와 같이 등록되고, ⚡ 바로 처리를 켜면 업무 루틴을 지금 돌린다. */

type Use = (n: string) => Promise<unknown>;
type AssetsNs = {
  upload: (b: Blob, o?: { type?: string }) => Promise<{ id: string; url: string; sizeBytes: number; contentType: string }>;
  delete: (ref: string) => Promise<{ deleted: boolean }>;
};
type Snap = { docs: { id: string; data: () => Record<string, unknown> | undefined }[] };
type DbNs = {
  collection: (p: string) => {
    add: (d: Record<string, unknown>) => Promise<{ id: string }>;
    doc: (id: string) => { delete: () => Promise<void> };
    orderBy: (f: string, d?: "asc" | "desc") => {
      limit: (n: number) => { onSnapshot: (n: (s: Snap) => void, e?: (err: { code?: string }) => void) => () => void };
    };
  };
};

type FileRow = { docId: string; name: string; assetId: string; type: string; size: number; team: string; memo: string; date: string };

const TEAMS = ["취업준비팀", "연구소모임팀", "국제동향보고서팀", "일반지원팀"];

const TEXT_TYPES: Record<string, string> = {
  csv: "text/csv", md: "text/markdown", markdown: "text/markdown", json: "application/json", txt: "text/plain",
};
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.webm,.csv,.md,.json,.txt";

function contentType(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_TYPES[ext]) return TEXT_TYPES[ext];
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  return file.type || undefined;
}

function seoulToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function size(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

function uploadError(code?: string) {
  switch (code) {
    case "too_large": return "파일이 너무 커요 (20MB까지, SVG 2MB)";
    case "unsupported_type": return "올릴 수 없는 형식이에요 — PDF·이미지·영상·CSV·MD·JSON·TXT만 돼요 (한글/워드는 PDF로 바꿔 주세요)";
    case "quota_or_state": return "저장 공간이 꽉 찼어요 — 안 쓰는 파일을 지워 주세요";
    case "invalid_request": return "파일을 읽지 못했어요 (텍스트는 UTF-8이어야 해요)";
    case "rate_limited": return "잠시 후 다시 올려 주세요";
    case "upstream_auth": return "다시 로그인하거나 새로고침해 주세요";
    case "store_unavailable": return "저장소가 잠시 불안정해요 — 다시 시도해 주세요";
    default: return `업로드 실패 (${code ?? "오류"})`;
  }
}

export default function FilePanel({ engine }: { engine: Company }) {
  const [assets, setAssets] = useState<AssetsNs | null>(null);
  const [db, setDb] = useState<DbNs | null>(null);
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [listErr, setListErr] = useState("");
  const [team, setTeam] = useState(TEAMS[0]);
  const [memo, setMemo] = useState("");
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const use = (window as unknown as { claude?: { use: Use } }).claude?.use;
    if (!use) {
      setReady(true);
      return;
    }
    let alive = true;
    Promise.all([use("assets").catch(() => null), use("db").catch(() => null)]).then(([a, d]) => {
      if (!alive) return;
      setAssets((a as AssetsNs) ?? null);
      setDb((d as DbNs) ?? null);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    const timer = window.setTimeout(() => setListErr("목록을 불러오는 중이 길어지고 있어요"), 10000);
    const unsub = db
      .collection("files")
      .orderBy("createdAt", "desc")
      .limit(50)
      .onSnapshot(
        (snap) => {
          window.clearTimeout(timer);
          setListErr("");
          setFiles(
            snap.docs.map((d) => {
              const v = d.data() ?? {};
              const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
              return {
                docId: d.id,
                name: s("name") || "이름 없음",
                assetId: s("assetId"),
                type: s("type"),
                size: typeof v.size === "number" ? v.size : 0,
                team: s("team"),
                memo: s("memo"),
                date: s("date"),
              };
            }),
          );
        },
        (e) => {
          window.clearTimeout(timer);
          setListErr(`목록을 못 불러왔어요 (${e?.code ?? "오류"})`);
        },
      );
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, [db]);

  const onPick = async (file: File | undefined) => {
    if (!file || !assets || !db || busy) return;
    setBusy(true);
    setMsg(`⏳ ${file.name} 올리는 중…`);
    try {
      const up = await assets.upload(file, { type: contentType(file) });
      const order = memo.trim();
      await db.collection("files").add({
        name: file.name.slice(0, 200),
        assetId: up.id,
        type: up.contentType,
        size: up.sizeBytes,
        team,
        memo: order.slice(0, 500),
        date: seoulToday(),
        createdAt: Date.now(),
      });
      setMemo("");
      const att: Attachment = { name: file.name, id: up.id, type: up.contentType };
      const text = `${order || `공유 파일 확인하고 정리해서 보고해줘: ${file.name}`}${attachmentText([att])}`;
      setMsg(`✅ ${file.name} 공유 완료 · 📮 지시함 등록 중…`);
      const r = await submitOrder(text, team);
      if (!r.ok) {
        setMsg(`✅ 파일은 공유됐어요. ⚠️ 지시함 등록 실패 — ${r.detail}`);
        return;
      }
      let line = `📎 ${file.name} 공유 + 📮 ${team} 지시 등록 완료 — 다음 업무 시간(08:41 / 17:27)에 처리해요.`;
      if (now) {
        const run = await runOrderNow(text, team, r.url);
        line = run.ok
          ? `📎 ${file.name} 공유 + ⚡ ${team}에서 바로 처리 시작 (보통 10~30분)`
          : `📎 ${file.name} 공유 + 📮 지시 등록 완료. ⚠️ ${run.detail}`;
      }
      setMsg(line);
      engine.pushChat("staff", "파일 공유창", `${line}${r.url ? `\n${r.url}` : ""}`);
    } catch (err) {
      setMsg(`⚠️ ${uploadError((err as { code?: string })?.code)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (f: FileRow) => {
    if (!assets || !db) return;
    if (!window.confirm(`"${f.name}"을(를) 지울까요? 지시함에 남은 링크도 더는 열리지 않아요.`)) return;
    try {
      if (f.assetId) await assets.delete(f.assetId);
      await db.collection("files").doc(f.docId).delete();
    } catch (err) {
      setMsg(`⚠️ 삭제 실패 (${(err as { code?: string })?.code ?? "오류"})`);
    }
  };

  const canUpload = !!assets && !!db;

  return (
    <section className="win rail-card file-card" id="file-share">
      <div className="win-bar">
        <span>📎 files.share — 파일 공유창</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body file-body">
        {!ready ? (
          <p className="file-note">불러오는 중…</p>
        ) : !canUpload ? (
          <p className="file-note">
            파일 공유는 claude.ai에서 이 오피스를 편집 권한으로 열었을 때만 쓸 수 있어요.
          </p>
        ) : (
          <>
            <div className="file-form">
              <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="담당팀">
                {TEAMS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="지시 (예: 이 PDF 심층 분석해줘)"
                aria-label="파일과 함께 보낼 지시"
              />
            </div>
            <label className="console-now">
              <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} />
              ⚡ 바로 처리
            </label>
            <label className={`file-drop ${busy ? "busy" : ""}`}>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                disabled={busy}
                onChange={(e) => void onPick(e.target.files?.[0])}
              />
              {busy ? "올리는 중…" : "＋ 파일 선택해서 올리기 (PDF·이미지·CSV·MD·TXT, 20MB까지)"}
            </label>
          </>
        )}
        {msg ? <p className="file-msg">{msg}</p> : null}
        {listErr ? <p className="file-note">{listErr}</p> : null}
        {files.length ? (
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.docId}>
                <a href={f.assetId ? `/_blob/${f.assetId}` : undefined} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
                <small>
                  {f.date} · {f.team} · {size(f.size)}
                  {f.memo ? ` · ${f.memo}` : ""}
                </small>
                {canUpload ? (
                  <button className="file-del" onClick={() => void remove(f)} aria-label={`${f.name} 삭제`}>
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : canUpload && !listErr ? (
          <p className="file-note">아직 공유한 파일이 없어요.</p>
        ) : null}
      </div>
    </section>
  );
}
