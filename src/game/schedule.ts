// 대표 일정 저장소 — company.config.ts 의 MY_SCHEDULE + 화면에서 추가한 일정(브라우저 저장)
// .ics(구글 캘린더 내보내기) / .csv 파일도 읽어서 추가할 수 있다.

import { MY_SCHEDULE } from "../../company.config";

export type ScheduleItem = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (없으면 종일) */
  time?: string;
  title: string;
  note?: string;
  source: "config" | "local";
};

const KEY = "team-sangyu:my-schedule";

function readLocal(): ScheduleItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScheduleItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(items: ScheduleItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 저장이 막혀 있어도 이번 화면에서는 동작
  }
}

let local: ScheduleItem[] = typeof window === "undefined" ? [] : readLocal();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  writeLocal(local);
  listeners.forEach((fn) => fn());
}

export function subscribeSchedule(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function scheduleVersion() {
  return version;
}

export function allSchedule(): ScheduleItem[] {
  const base: ScheduleItem[] = MY_SCHEDULE.map((item, i) => ({ ...item, id: `config-${i}`, source: "config" }));
  return [...base, ...local].sort((a, b) => `${a.date} ${a.time ?? "00:00"}`.localeCompare(`${b.date} ${b.time ?? "00:00"}`));
}

export function addSchedule(items: Omit<ScheduleItem, "id" | "source">[]) {
  const existing = new Set(allSchedule().map((s) => `${s.date}|${s.time ?? ""}|${s.title}`));
  let added = 0;
  for (const item of items) {
    const key = `${item.date}|${item.time ?? ""}|${item.title}`;
    if (!item.title || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || existing.has(key)) continue;
    existing.add(key);
    local.push({ ...item, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, source: "local" });
    added += 1;
  }
  if (added) changed();
  return added;
}

export function removeSchedule(id: string) {
  local = local.filter((item) => item.id !== id);
  changed();
}

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todaySchedule(): ScheduleItem[] {
  const today = dateKey();
  return allSchedule().filter((item) => item.date === today);
}

/** 내일부터 days일 안의 일정 */
export function upcomingSchedule(days = 7): ScheduleItem[] {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date();
  end.setDate(end.getDate() + days);
  const from = dateKey(start);
  const to = dateKey(end);
  return allSchedule().filter((item) => item.date >= from && item.date <= to);
}

export function minutesOf(time?: string) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

export function formatItem(item: ScheduleItem, withDate = false) {
  const date = withDate ? `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))} ` : "";
  return `${date}${item.time ?? "종일"} ${item.title}${item.note ? ` (${item.note})` : ""}`;
}

// ── 파일 읽기 ─────────────────────────────────────────────

/** .ics (구글 캘린더 · 아웃룩 내보내기) */
export function parseIcs(text: string): Omit<ScheduleItem, "id" | "source">[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const out: Omit<ScheduleItem, "id" | "source">[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const field = (name: string) => {
      const match = block.match(new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, "m"));
      return match ? { params: match[1] ?? "", value: match[2].trim() } : null;
    };
    const start = field("DTSTART");
    const summary = field("SUMMARY");
    if (!start || !summary) continue;
    const v = start.value;
    let date = "";
    let time: string | undefined;
    if (/^\d{8}$/.test(v)) {
      date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    } else {
      const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
      if (!m) continue;
      if (m[7] === "Z") {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
        date = dateKey(d);
        time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      } else {
        date = `${m[1]}-${m[2]}-${m[3]}`;
        time = `${m[4]}:${m[5]}`;
      }
    }
    const unescape = (s: string) => s.replace(/\\n/g, " ").replace(/\\([,;\\])/g, "$1");
    const location = field("LOCATION");
    out.push({ date, time, title: unescape(summary.value), note: location ? unescape(location.value) : undefined });
  }
  return out;
}

/** .csv — 첫 줄 제목 생략 가능. 열 순서: 날짜, 시간, 일정, 메모 (예: 2026-11-05,14:00,면접,강남역) */
export function parseCsv(text: string): Omit<ScheduleItem, "id" | "source">[] {
  const out: Omit<ScheduleItem, "id" | "source">[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    const date = cols[0].replace(/[./]/g, "-").replace(/-(\d)(?=-|$)/g, "-0$1");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const isTime = /^\d{1,2}:\d{2}$/.test(cols[1]);
    // 시간 칸이 있는 형식(시간이 비어 있어도): 날짜, 시간, 일정, 메모
    const hasTimeCol = isTime || (cols[1] === "" && cols.length >= 3);
    const time = isTime ? cols[1].padStart(5, "0") : undefined;
    const title = hasTimeCol ? cols[2] : cols[1];
    const note = hasTimeCol ? cols[3] : cols[2];
    if (title) out.push({ date, time, title, note: note || undefined });
  }
  return out;
}
