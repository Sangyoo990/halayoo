import { useEffect, useRef, useState } from "react";
import { SECRETARY } from "../company.config";
import type { Snapshot } from "./game/sim";
import {
  addSchedule,
  allSchedule,
  dateKey,
  formatItem,
  parseCsv,
  parseIcs,
  removeSchedule,
  subscribeSchedule,
  todaySchedule,
  upcomingSchedule,
  type ScheduleItem,
} from "./game/schedule";

/** 수행비서 유지민의 일정 창 — 오늘 / 다가오는 7일 / 결재 알림 / 일정 추가·파일 업로드 */
export default function SchedulePanel({ snap }: { snap: Snapshot }) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: dateKey(), time: "", title: "", note: "" });
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = subscribeSchedule(() => setTick((n) => n + 1));
    return () => {
      off();
    };
  }, []);

  const today = todaySchedule();
  const upcoming = upcomingSchedule(7);
  const total = allSchedule().length;
  const pending = snap.approvalPending ? snap.approvalTotal - snap.approvalDone : 0;

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2600);
  };

  const submit = () => {
    if (!form.title.trim()) return flash("일정 이름을 적어주세요.");
    const added = addSchedule([
      { date: form.date, time: form.time || undefined, title: form.title.trim(), note: form.note.trim() || undefined },
    ]);
    flash(added ? "일정을 추가했어요." : "이미 있는 일정이에요.");
    setForm((f) => ({ ...f, time: "", title: "", note: "" }));
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    const items = /\.ics$/i.test(file.name) || text.includes("BEGIN:VCALENDAR") ? parseIcs(text) : parseCsv(text);
    const added = addSchedule(items);
    flash(items.length ? `${items.length}건 읽고 ${added}건 추가했어요.` : "읽을 수 있는 일정이 없어요. 형식을 확인해주세요.");
  };

  const row = (item: ScheduleItem, withDate: boolean) => (
    <li key={item.id}>
      <span>{formatItem(item, withDate)}</span>
      {item.source === "local" ? (
        <button className="sch-del" onClick={() => removeSchedule(item.id)} aria-label={`${item.title} 삭제`}>
          ✕
        </button>
      ) : null}
    </li>
  );

  return (
    <section className="win rail-card schedule-card-win" id="my-schedule">
      <div className="win-bar">
        <span>📅 my.schedule — 비서 {SECRETARY.name}</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body sch-body">
        {pending ? (
          <button
            className="sch-alert"
            onClick={() => document.getElementById("ceo-approval")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          >
            ✅ 결재 {pending}건 기다리고 있어요 — {snap.approvalItem?.title}
          </button>
        ) : null}

        <p className="sch-head">오늘 · {today.length}건</p>
        {today.length ? <ul className="sch-list">{today.map((item) => row(item, false))}</ul> : <p className="sch-empty">오늘 등록된 일정이 없어요.</p>}

        <p className="sch-head">다가오는 7일 · {upcoming.length}건</p>
        {upcoming.length ? (
          <ul className="sch-list">{upcoming.map((item) => row(item, true))}</ul>
        ) : (
          <p className="sch-empty">{total ? "7일 안에는 일정이 없어요." : "아직 등록된 일정이 없어요. 아래에서 추가하거나 파일을 올려주세요."}</p>
        )}

        <div className="sch-actions">
          <button className="sch-btn" onClick={() => setOpen((v) => !v)}>
            {open ? "닫기" : "＋ 일정 추가"}
          </button>
          <button className="sch-btn" onClick={() => fileRef.current?.click()} title=".ics(구글 캘린더 내보내기) 또는 .csv(날짜,시간,일정,메모)">
            ⬆ 파일 올리기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".ics,.csv,text/calendar,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = "";
            }}
          />
        </div>

        {open ? (
          <form
            className="sch-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="날짜" />
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} aria-label="시간" />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="일정 (예: 면접)" aria-label="일정" />
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="메모 (장소 등)" aria-label="메모" />
            <button type="submit">추가</button>
          </form>
        ) : null}
        {message ? <p className="sch-msg">{message}</p> : null}
        <p className="sch-tip">화면에서 추가한 일정은 이 브라우저에만 저장돼요.</p>
      </div>
    </section>
  );
}
