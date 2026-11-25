import { useEffect, useState } from "react";
import { SECRETARY } from "../company.config";
import type { Snapshot } from "./game/sim";
import {
  allSchedule,
  formatItem,
  removeSchedule,
  subscribeSchedule,
  todaySchedule,
  upcomingSchedule,
  type ScheduleItem,
} from "./game/schedule";

/** 수행비서 유지민의 일정 창 — 오늘 / 다가오는 7일 / 결재 알림 (추가·수정은 비서 채팅으로) */
export default function SchedulePanel({ snap }: { snap: Snapshot }) {
  const [, setTick] = useState(0);
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
          <p className="sch-empty">{total ? "7일 안에는 일정이 없어요." : "아직 등록된 일정이 없어요. 비서 채팅에 말씀하시면 저장돼요."}</p>
        )}

        <p className="sch-tip">일정 추가·수정·삭제는 위 💬 비서 채팅에 말씀하세요.</p>
      </div>
    </section>
  );
}
