// 라이브 오피스 시뮬레이션 엔진
// 직원 상태머신 + A* 이동 + 회의 엔진 + 하루 시나리오 스크립트

import { findPath } from "./pathfinding";
import { CEO, DEPT_BRIEF, DEPT_LEAD, SECRETARY_DEPT, SECRETARY_SEED, STAFF, type StaffSeed } from "./staff";
import {
  APPROVAL,
  BRIEFING_DEPT,
  COMPANY,
  DEPARTMENTS,
  PENDING_INTEGRATIONS,
  TODAY_APPROVALS,
  TODAY_LABEL,
  TODAY_SCHEDULE,
  type ApprovalItem,
} from "../../company.config";
import { formatItem, minutesOf, todaySchedule, upcomingSchedule } from "./schedule";
import {
  CEO_REPORT_SPOT,
  CEO_SEAT,
  COLS,
  DEPT_ROOMS,
  ENTRANCE,
  LOUNGE_ROOM,
  MEETING_SEATS,
  SECRETARY_SEAT,
  doorApproach,
  roomOf,
  walkable,
  type Pt,
} from "./world";

export type DeptStatus = "완료" | "진행 중" | "승인 대기" | "연동 대기" | "대기";
export type AgentStatus =
  | "출근 전"
  | "출근 중"
  | "대기"
  | "이동 중"
  | "업무 중"
  | "회의 중"
  | "보고 중"
  | "휴식"
  | "연동 대기";
export type Anim = "idle" | "walk" | "type" | "talk" | "sit";
export type Facing = "up" | "down" | "left" | "right";

const WALK_SPEED = 3.6; // tiles / sec
/**
 * 사내 시계는 '시뮬레이션 시간' 기준으로 흐른다 — 시뮬 1초 = 1.6분.
 * 배속을 올리면 시계도 같이 빨라지므로, 몇 배속으로 보든 하루는 07:00 → 약 17:00으로 끝난다.
 */
const SIM_MIN_PER_SEC = 1.6;
/** ⏭ 건너뛰기(터보)일 때의 배속 */
const TURBO_SPEED = 10;

type Action =
  | { k: "walk"; to: Pt }
  | { k: "say"; text: string; dur: number; kind: "talk" | "think" }
  | { k: "wait"; dur: number }
  | { k: "face"; dir: Facing }
  | { k: "anim"; a: Anim }
  | { k: "status"; s: AgentStatus }
  | { k: "work"; dur: number; label: string }
  | { k: "fn"; fn: () => void };

export type Agent = {
  id: string;
  name: string;
  callsign?: string;
  role: string;
  deptId: string;
  rank: StaffSeed["rank"];
  hair: string;
  shirt: string;
  accent: string;
  skin: string;
  thoughts: string[];
  /** 매일 맡는 업무 */
  task?: string;

  x: number;
  y: number;
  facing: Facing;
  anim: Anim;
  status: AgentStatus;
  home: Pt;
  progress: number;
  taskLabel: string;

  path: Pt[];
  pathIdx: number;
  blockedFor: number;
  queue: Action[];
  current: Action | null;
  timer: number;
  speech: string | null;
  speechKind: "talk" | "think";
  speechFor: number;
  idleFor: number;
  /** 렌더링에서 겹침을 줄이는 미세 오프셋 */
  jitter: number;
};

export type LogEntry = { id: number; time: string; icon: string; text: string; tone: string };
/** 대표 지시창 대화 */
export type ChatEntry = {
  id: number;
  time: string;
  from: "ceo" | "staff";
  name: string;
  text: string;
};

type Slot = {
  gen: Generator<number | (() => boolean), void, void> | null;
  wait: number;
  until: (() => boolean) | null;
};

export type Snapshot = {
  clock: string;
  running: boolean;
  paused: boolean;
  speed: number;
  turbo: boolean;
  dayComplete: boolean;
  phase: string;
  phaseIndex: number;
  approvalPending: boolean;
  approved: boolean;
  /** 지금 회의실에 올라와 있는 결재 안건 */
  approvalItem: ApprovalItem | null;
  /** 오늘 결재 안건 전체 / 그중 처리한 수 */
  approvalTotal: number;
  approvalDone: number;
  approvedTitles: string[];
  briefingReady: boolean;
  deptStatus: Record<string, DeptStatus>;
  counts: Record<AgentStatus, number>;
  stats: { done: number; working: number; approval: number; blocked: number };
  log: LogEntry[];
  meetingTitle: string | null;
  chat: ChatEntry[];
  focusMode: boolean;
  spotlight: string | null;
  busyWithOrder: boolean;
};

const START_HOUR: number = COMPANY.startHour;
const HH = String(START_HOUR).padStart(2, "0");

const PHASES = [
  "출근 대기",
  `${HH}:00 전원 출근`,
  "아침 업무 공유",
  "팀별 업무",
  "대표 승인 대기",
  "최종 정리",
  "대표 브리핑",
  "업무 종료",
];
/** 단계 번호 — 화면(카메라·진행률)에서도 쓴다 */
export const PHASE = { arrive: 1, standup: 2, work: 3, approval: 4, finalize: 5, briefing: 6, end: 7 } as const;

const BLOCKED_DEPTS = new Set(Object.keys(PENDING_INTEGRATIONS));

/** 연동 대기 팀이 멈춰 있는 이유 */
const BLOCK_REASON: Record<string, string> = Object.fromEntries(
  Object.entries(PENDING_INTEGRATIONS).map(([dept, need]) => [
    dept,
    `${need}이(가) 아직 연결 전이라 오늘은 대기합니다. 연결되면 바로 시작할게요.`,
  ]),
);

/** 지시창에서 팀을 찾을 때 쓰는 키워드 */
const DEPT_KEYWORDS: [string, string[]][] = DEPARTMENTS.map((d) => [
  d.id,
  [d.name, d.name.replace(/팀$/, ""), d.short, ...((d as { keywords?: string[] }).keywords ?? [])],
]);

/** 브리핑 담당(비서실장 역할) */
const SEC_ID = DEPT_LEAD[BRIEFING_DEPT]?.id ?? STAFF[0]?.id ?? "ceo";
const SEC_NAME = DEPT_LEAD[BRIEFING_DEPT]?.name ?? "비서실";

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class Company {
  agents: Agent[] = [];
  agentById = new Map<string, Agent>();
  deptStatus: Record<string, DeptStatus> = {};
  log: LogEntry[] = [];
  clockMinutes = START_HOUR * 60;
  /** 재생 속도 — 시뮬레이션 전체(걷기·업무·대사)를 함께 배속한다. 실제 외부 작업 속도와는 무관 */
  speed = 2;
  turbo = false;
  paused = false;
  running = false;
  dayComplete = false;
  phaseIndex = 0;
  approvalPending = false;
  approved = false;
  /** 오늘 결재 안건 · 처리 수 */
  approvals: ApprovalItem[] = [];
  approvalDone = 0;
  briefingReady = false;
  meetingTitle: string | null = null;
  onBriefing: (() => void) | null = null;
  /** 대표 지시창 */
  chat: ChatEntry[] = [];
  focusMode = false;
  spotlight: string | null = null;

  private spotlightUntil = 0;
  private elapsed = 0;
  private approvalSince: number | null = null;
  private logSeq = 0;
  /** 하루 시나리오(main)와 대표 지시로 끼어드는 장면(side)을 각각 돌린다 */
  private main: Slot = { gen: null, wait: 0, until: null };
  private side: Slot = { gen: null, wait: 0, until: null };
  private occupancy = new Set<number>();
  private seatBook = new Map<string, Pt>();
  /** 시나리오 장면에 참여 중인 직원 — 자율 행동(커피·잡담)이 끼어들지 못하게 잠근다 */
  private locked = new Set<string>();
  /** 비서: 이미 알려드린 일정 · 마지막 결재 알림 시각 */
  private reminded = new Set<string>();
  private lastNag = -999;

  constructor() {
    this.reset();
  }

  reset() {
    this.agents = [];
    this.agentById.clear();
    this.log = [];
    this.logSeq = 0;
    this.clockMinutes = START_HOUR * 60;
    this.running = false;
    this.paused = false;
    this.dayComplete = false;
    this.phaseIndex = 0;
    this.approvalPending = false;
    this.approved = false;
    this.approvals = [];
    this.approvalDone = 0;
    this.reminded.clear();
    this.lastNag = -999;
    this.briefingReady = false;
    this.meetingTitle = null;
    this.main = { gen: null, wait: 0, until: null };
    this.side = { gen: null, wait: 0, until: null };
    this.seatBook.clear();
    this.locked.clear();
    this.chat = [];
    this.focusMode = false;
    this.spotlight = null;
    this.spotlightUntil = 0;
    this.elapsed = 0;
    this.approvalSince = null;

    const seats = new Map<string, Pt[]>();
    for (const room of DEPT_ROOMS) seats.set(room.id, room.desks.map((d) => d.seat));

    for (const seed of STAFF) {
      const pool = seats.get(seed.deptId);
      const home =
        seed.deptId === SECRETARY_DEPT ? SECRETARY_SEAT : (pool?.shift() ?? { x: ENTRANCE.x, y: ENTRANCE.y - 2 });
      this.spawn(seed, home, { x: ENTRANCE.x, y: ENTRANCE.y });
    }
    this.spawn(CEO, CEO_SEAT, CEO_SEAT);

    const ceo = this.agentById.get("ceo")!;
    ceo.status = "업무 중";
    ceo.anim = "sit";
    ceo.facing = "down";

    for (const room of DEPT_ROOMS) {
      this.deptStatus[room.id] = BLOCKED_DEPTS.has(room.id) ? "연동 대기" : "대기";
    }
    this.pushLog("🏛️", "대표실 준비 완료. 출근 버튼을 기다리는 중이에요.", "lav");
    this.pushChat("staff", SEC_NAME, `대표님, ${SEC_NAME}입니다. 궁금한 건 여기에 바로 물어보세요.`);
  }

  private spawn(seed: StaffSeed, home: Pt, at: Pt) {
    const agent: Agent = {
      ...seed,
      x: at.x,
      y: at.y,
      facing: "down",
      anim: seed.rank === "ceo" ? "sit" : "idle",
      status: seed.rank === "ceo" ? "업무 중" : "출근 전",
      home,
      progress: 0,
      taskLabel: seed.task ?? DEPT_BRIEF[seed.deptId]?.task ?? "대표 업무",
      path: [],
      pathIdx: 0,
      blockedFor: 0,
      queue: [],
      current: null,
      timer: 0,
      speech: null,
      speechKind: "talk",
      speechFor: 0,
      idleFor: Math.random() * 8,
      jitter: (Math.random() - 0.5) * 0.28,
    };
    this.agents.push(agent);
    this.agentById.set(agent.id, agent);
  }

  // ── 로그 ────────────────────────────────────────────────
  pushLog(icon: string, text: string, tone = "pink") {
    this.log.unshift({ id: this.logSeq++, time: this.clockText(), icon, text, tone });
    if (this.log.length > 60) this.log.pop();
  }

  clockText() {
    const total = Math.floor(this.clockMinutes) % (24 * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // ── 액션 큐 ──────────────────────────────────────────────
  private enqueue(agent: Agent, ...actions: Action[]) {
    agent.queue.push(...actions);
  }

  private goto(agent: Agent, to: Pt, status: AgentStatus = "이동 중") {
    this.enqueue(agent, { k: "status", s: status }, { k: "walk", to });
  }

  private sitAtDesk(agent: Agent) {
    this.enqueue(
      agent,
      { k: "walk", to: agent.home },
      { k: "face", dir: "up" },
      { k: "anim", a: "sit" },
      { k: "status", s: "대기" },
    );
  }

  say(agent: Agent, text: string, dur = 2.6, kind: "talk" | "think" = "talk") {
    agent.speech = text;
    agent.speechKind = kind;
    agent.speechFor = dur;
  }

  /** 장면 시작: 진행 중이던 자율 행동을 끊고 잠근다 */
  private lock(agents: Agent[]) {
    for (const agent of agents) {
      this.locked.add(agent.id);
      agent.queue.length = 0;
      agent.current = null;
      agent.path = [];
      agent.pathIdx = 0;
    }
  }

  private unlock(agents: Agent[]) {
    for (const agent of agents) this.locked.delete(agent.id);
  }

  private busy(agent: Agent) {
    return agent.queue.length > 0 || agent.current !== null;
  }

  private allFree(agents: Agent[]) {
    return () => agents.every((a) => !this.busy(a));
  }

  private deptAgents(deptId: string) {
    return this.agents.filter((a) => a.deptId === deptId && a.rank !== "ceo");
  }

  // ── 하루 시나리오 ─────────────────────────────────────────
  start() {
    if (this.running) return;
    this.reset();
    this.running = true;
    this.main.gen = this.dayScript();
  }

  private *dayScript(): Generator<number | (() => boolean), void, void> {
    // ① 출근
    this.phaseIndex = PHASE.arrive;
    const workers = this.agents.filter((a) => a.rank !== "ceo");
    this.pushLog("🚪", `${HH}:00 출근 시작! 팀원 ${workers.length}명 입장합니다.`, "yellow");
    this.lock(workers);
    for (const agent of workers) {
      this.enqueue(
        agent,
        { k: "status", s: "출근 중" },
        { k: "wait", dur: Math.random() * 6 },
        { k: "fn", fn: () => this.say(agent, rand(["좋은 아침이에요!", "출근했습니다", "오늘도 화이팅!", "커피부터…"]), 2.4) },
        { k: "walk", to: agent.home },
        { k: "face", dir: "up" },
        { k: "anim", a: "sit" },
        { k: "status", s: "대기" },
      );
    }
    yield this.allFree(workers);
    this.unlock(workers);
    this.pushLog("✅", "전원 착석 완료. 오늘 업무를 시작합니다.", "mint");
    if (TODAY_SCHEDULE.length) {
      this.pushLog(
        "📅",
        `오늘(${TODAY_LABEL}) 정기 일정 — ${TODAY_SCHEDULE.map((item) => `${item.time} ${item.title}`).join(" / ")}`,
        "yellow",
      );
    }
    if (!this.side.gen) this.side.gen = this.secretaryMorning();
    yield 0.6;

    const ceo = this.agentById.get("ceo")!;
    const depts = DEPARTMENTS.filter((d) => this.deptStatus[d.id] !== undefined);
    const active = depts.filter((d) => !BLOCKED_DEPTS.has(d.id));
    const leads = depts.map((d) => this.agentById.get(DEPT_LEAD[d.id]?.id ?? "")).filter((a): a is Agent => !!a);

    // ② 아침 업무 공유 — 팀장 회의
    this.phaseIndex = PHASE.standup;
    const secLead = this.agentById.get(SEC_ID);
    const lines: [string, string][] = [];
    if (secLead) lines.push([secLead.id, "오늘 팀별 업무 공유할게요. 한 줄씩 부탁해요."]);
    for (const d of depts) {
      const lead = DEPT_LEAD[d.id];
      if (!lead) continue;
      lines.push([
        lead.id,
        BLOCKED_DEPTS.has(d.id) ? (BLOCK_REASON[d.id] ?? "오늘은 대기합니다.") : `오늘은 ‘${d.task}’ 진행합니다.`,
      ]);
    }
    yield* this.meeting("아침 업무 공유", leads.map((a) => a.id), lines);

    // ③ 팀별 업무 — 동시에 진행
    this.phaseIndex = PHASE.work;
    for (const d of depts.filter((d) => BLOCKED_DEPTS.has(d.id))) {
      const lead = this.agentById.get(DEPT_LEAD[d.id]?.id ?? "");
      if (!lead) continue;
      this.stand(lead);
      this.say(lead, "연동 전이라 오늘은 대기할게요.", 3);
      this.pushLog(d.icon, `${d.name}: ${PENDING_INTEGRATIONS[d.id]} 대기 → 오늘은 쉬어갑니다`, "lav");
      this.goto(lead, rand(LOUNGE_ROOM.loiter), "휴식");
      this.enqueue(lead, { k: "wait", dur: 4 });
      this.sitAtDesk(lead);
    }
    active.forEach((d, i) => this.startDept(d.id, d.task, (d.priority ? 9 : 6) + i * 1.2, true));
    yield () => active.every((d) => this.deptStatus[d.id] === "완료");
    for (const d of active) {
      const lead = this.agentById.get(DEPT_LEAD[d.id]?.id ?? "");
      if (lead) this.say(lead, d.report, 3);
    }
    yield 1.6;

    // ④ 대표 승인 회의 — 매일 결재 + 오늘 정기보고를 차례로 올린다
    const activeIds = new Set(active.map((d) => d.id));
    this.approvals = TODAY_APPROVALS.filter((item) => activeIds.has(item.fromDept));
    if (this.approvals.length) {
      this.phaseIndex = PHASE.approval;
      this.approvalPending = true;
      this.turbo = false; // 대표 결정 지점에서는 즉시 정상 속도로 돌아온다
      for (const item of this.approvals) this.deptStatus[item.fromDept] = "승인 대기";
      this.meetingTitle = `대표 결재 ${this.approvals.length}건`;
      this.pushLog(
        "📋",
        `대표 승인 대기: 결재 ${this.approvals.length}건 — ${this.approvals.map((item) => `‘${item.title}’`).join(", ")}`,
        "yellow",
      );
      this.secretaryApprovalAlert();

      const presenters = [...new Set(this.approvals.map((item) => DEPT_LEAD[item.fromDept]?.id))]
        .map((id) => this.agentById.get(id ?? ""))
        .filter((a): a is Agent => !!a);
      const approvers = [...presenters, ...(secLead && !presenters.includes(secLead) ? [secLead] : [])];
      this.lock([...approvers, ceo]);
      approvers.forEach((agent, i) => {
        this.stand(agent);
        const seat = this.bookSeat(agent, i);
        this.goto(agent, seat, "회의 중");
        this.enqueue(agent, { k: "face", dir: seat.y < 7 ? "down" : "up" }, { k: "anim", a: "sit" });
      });
      const ceoSeat = this.bookSeat(ceo, approvers.length);
      this.enqueue(
        ceo,
        { k: "anim", a: "idle" },
        { k: "status", s: "회의 중" },
        { k: "walk", to: ceoSeat },
        { k: "face", dir: ceoSeat.y < 7 ? "down" : "up" },
        { k: "anim", a: "sit" },
      );
      yield this.allFree([...approvers, ceo]);

      if (secLead) {
        this.say(secLead, `대표님, 오늘 결재는 ${this.approvals.length}건이에요.`, 3.2);
        yield 2.2;
      }
      for (let i = 0; i < this.approvals.length; i += 1) {
        const item = this.approvals[i];
        const presenter = this.agentById.get(DEPT_LEAD[item.fromDept]?.id ?? "");
        if (presenter) {
          presenter.anim = "talk";
          this.say(presenter, `‘${item.title}’ 올려드립니다.`, 3.4);
        }
        yield 2.4;
        if (presenter) presenter.anim = "sit";
        this.say(ceo, "확인해볼게요.", 2.4);
        // 대표가 승인 버튼을 누를 때까지 대기
        yield () => this.approvalDone > i;
        this.say(ceo, "승인!", 2.2);
        this.pushLog("✅", `대표 승인 — ${item.title}`, "mint");
        yield 1.2;
      }

      this.approved = true;
      this.approvalPending = false;
      this.meetingTitle = null;
      this.say(ceo, "전부 승인! 이대로 갑시다.", 2.8);
      yield 1.6;
      for (const agent of approvers) {
        this.releaseSeat(agent);
        this.stand(agent);
        this.sitAtDesk(agent);
      }
      this.releaseSeat(ceo);
      this.enqueue(ceo, { k: "anim", a: "idle" }, { k: "walk", to: CEO_SEAT }, { k: "face", dir: "down" }, { k: "anim", a: "sit" }, { k: "status", s: "업무 중" });
      yield this.allFree([...approvers, ceo]);
      this.unlock([...approvers, ceo]);

      // ⑤ 최종 정리 — 결재 받은 팀들이 동시에
      this.phaseIndex = PHASE.finalize;
      const finalDepts = [...new Set(this.approvals.map((item) => item.fromDept))];
      for (const deptId of finalDepts) {
        const titles = this.approvals.filter((item) => item.fromDept === deptId).map((item) => item.title);
        this.startDept(deptId, `승인안 최종 정리 — ${titles.join(", ")}`, 5);
      }
      yield () => finalDepts.every((deptId) => this.deptStatus[deptId] === "완료");
      yield 1.2;
    }

    // ⑥ 대표 브리핑
    this.phaseIndex = PHASE.briefing;
    if (secLead) {
      this.lock([secLead]);
      this.stand(secLead);
      this.say(secLead, "팀별 보고 취합했어요. 대표님께 갑니다.", 3);
      this.goto(secLead, CEO_REPORT_SPOT, "보고 중");
      this.enqueue(secLead, { k: "face", dir: "up" });
      yield this.allFree([secLead]);
      this.say(secLead, "대표님, 오늘 결정할 건 이제 없어요.", 3.2);
    }
    this.say(ceo, "다들 고생했어요!", 2.6);
    this.briefingReady = true;
    this.onBriefing?.();
    const stats = this.snapshot().stats;
    this.pushLog("📋", `${SEC_NAME} 최종 브리핑 완료 — 완료 ${stats.done}팀 · 연동 대기 ${stats.blocked}팀`, "pink");
    yield 3;
    if (secLead) {
      this.stand(secLead);
      this.sitAtDesk(secLead);
      yield this.allFree([secLead]);
      this.unlock([secLead]);
    }

    this.phaseIndex = PHASE.end;
    this.dayComplete = true;
    this.running = false;
    this.pushLog("🌙", "오늘 업무 종료. 팀원들이 라운지로 이동합니다.", "yellow");

    for (const agent of workers) {
      if (Math.random() < 0.45) {
        this.stand(agent);
        this.goto(agent, rand(LOUNGE_ROOM.loiter), "휴식");
      }
    }
  }

  /** 부서 업무 시작(비동기) */
  /** own = true 이면 직원마다 자기 담당 업무(task)를 한다 */
  private startDept(deptId: string, label: string, dur: number, own = false) {
    this.deptStatus[deptId] = "진행 중";
    const crew = this.deptAgents(deptId);
    this.lock(crew);
    this.pushLog(roomOf(deptId).icon, `${roomOf(deptId).name} 업무 시작 — ${label}`, "pink");
    crew.forEach((agent, i) => {
      this.enqueue(
        agent,
        { k: "wait", dur: i * 0.35 },
        { k: "walk", to: agent.home },
        { k: "face", dir: "up" },
        { k: "status", s: "업무 중" },
        { k: "work", dur: dur + Math.random() * 1.5, label: own ? (agent.task ?? label) : label },
        { k: "anim", a: "sit" },
        { k: "status", s: "대기" },
        { k: "fn", fn: () => this.finishDept(deptId) },
      );
    });
  }

  private finishDept(deptId: string) {
    if (this.deptAgents(deptId).some((a) => a.status === "업무 중")) return;
    if (this.deptStatus[deptId] === "완료") return;
    this.deptStatus[deptId] = "완료";
    this.unlock(this.deptAgents(deptId));
    const lead = DEPT_LEAD[deptId];
    const agent = lead ? this.agentById.get(lead.id) : null;
    if (agent) this.say(agent, "완료했어요!", 2.4);
    this.pushLog(roomOf(deptId).icon, `${roomOf(deptId).name} 완료 — ${DEPT_BRIEF[deptId].report}`, "mint");
  }

  private *runDept(deptId: string, label: string, dur: number, report: string) {
    this.startDept(deptId, label, dur);
    yield () => this.deptStatus[deptId] === "완료";
    const lead = this.agentById.get(DEPT_LEAD[deptId]?.id ?? "");
    if (lead) this.say(lead, report, 3.2);
    yield 1.2;
  }

  /** 회의: 참석자 소집 → 대사 → 자리 복귀 */
  private *meeting(title: string, ids: string[], lines: [string, string][]) {
    this.meetingTitle = title;
    this.pushLog("💬", `회의 소집: ${title} (${ids.length}명)`, "lav");
    const crew = ids.map((id) => this.agentById.get(id)!);
    this.lock(crew);
    crew.forEach((agent, i) => {
      this.stand(agent);
      this.say(agent, "회의실로 갈게요.", 2);
      const seat = this.bookSeat(agent, i);
      this.goto(agent, seat, "회의 중");
      this.enqueue(
        agent,
        { k: "face", dir: seat.y < 7 ? "down" : "up" },
        { k: "anim", a: "sit" },
        { k: "status", s: "회의 중" },
      );
    });
    yield this.allFree(crew);
    yield 0.6;

    for (const [id, text] of lines) {
      const speaker = this.agentById.get(id)!;
      speaker.anim = "talk";
      this.say(speaker, text, 3.2);
      this.pushLog("🗣️", `${speaker.name}: “${text}”`, "lav");
      yield 2.3;
      speaker.anim = "sit";
    }

    yield 0.8;
    for (const agent of crew) {
      this.releaseSeat(agent);
      this.stand(agent);
      this.sitAtDesk(agent);
    }
    this.meetingTitle = null;
    yield this.allFree(crew);
    this.unlock(crew);
  }

  /** 부서 간 전달 — 직접 걸어가서 말하고 돌아온다 */
  private *deliver(fromId: string, toDeptId: string, line: string, reply: string) {
    const from = this.agentById.get(fromId)!;
    const toLead = this.agentById.get(DEPT_LEAD[toDeptId].id)!;
    const room = roomOf(toDeptId);
    const spot = { x: toLead.home.x, y: Math.min(toLead.home.y + 2, room.y + room.h - 2) };

    this.lock([from, toLead]);
    this.stand(from);
    this.goto(from, walkable(spot.x, spot.y) ? spot : doorApproach(room), "이동 중");
    yield this.allFree([from]);
    from.anim = "talk";
    this.say(from, line, 3);
    this.pushLog("🤝", `${from.name} → ${room.name}: “${line}”`, "pink");
    yield 2;
    this.say(toLead, reply, 2.8);
    yield 1.6;
    from.anim = "idle";
    this.sitAtDesk(from);
    yield this.allFree([from]);
    this.unlock([from, toLead]);
  }

  private stand(agent: Agent) {
    agent.anim = "idle";
    agent.progress = 0;
  }

  /** 테이블을 사이에 두고 마주보도록 위·아래 줄을 번갈아 배정한다 */
  private bookSeat(agent: Agent, preferred: number): Pt {
    const zigzag = [0, 4, 1, 5, 2, 6, 3, 7];
    const taken = new Set([...this.seatBook.values()].map((p) => `${p.x},${p.y}`));
    const order = [zigzag[preferred % zigzag.length], ...zigzag];
    for (const i of order) {
      const seat = MEETING_SEATS[i % MEETING_SEATS.length];
      if (!taken.has(`${seat.x},${seat.y}`)) {
        this.seatBook.set(agent.id, seat);
        return seat;
      }
    }
    return MEETING_SEATS[0];
  }

  private releaseSeat(agent: Agent) {
    this.seatBook.delete(agent.id);
  }

  // ── 대표 지시창 ──────────────────────────────────────────
  pushChat(from: "ceo" | "staff", name: string, text: string) {
    this.chat.push({ id: this.logSeq++, time: this.clockText(), from, name, text });
    if (this.chat.length > 60) this.chat.shift();
  }

  /** 지시창에 들어온 한 줄을 해석해 보고하거나 실제로 지시를 실행한다 */
  command(raw: string) {
    const text = raw.trim();
    if (!text) return;
    this.pushChat("ceo", CEO.name, text);
    const q = text.toLowerCase();

    // ⓪-1 수행비서 — 일정 · 결재 확인
    if (/유지민|일정|스케줄|리마인드|약속/.test(text)) return this.secretarySchedule();
    if (/결재|할 일|챙길/.test(text) && !/승인해|오케이/.test(text)) return this.secretaryTodo();

    // ⓪ 일반지원팀 전용 — 소식 요약 / 자료·검색 요청
    if (/소식|뉴스|헤드라인|축구|야구|롯데|레알|epl|국대|kbo/i.test(text) && !/공고|채용/.test(text)) {
      return this.newsBrief();
    }
    if (/회의록/.test(text)) return this.minutesReceived(text);
    if (/자료|검색|찾아|알아봐|조사해|추천해/.test(text)) return this.requestSupport(text);

    // ① 특정 부서·직원 지목
    const deptId = this.matchDept(text);
    if (deptId && !/전체|모두|다들/.test(text)) {
      this.deptReport(deptId, text);
      return;
    }

    // ② 지시(실제로 동작하는 명령)
    if (/집중|커피 ?금지|딴짓|자리 지켜/.test(text)) return this.setFocusMode(true);
    if (/자유|쉬어|휴식 허용|집중 해제/.test(text)) return this.setFocusMode(false);
    if (/자리로|복귀|착석/.test(text)) return this.recallAll();
    if (/빨리|서둘|속도|급해|당겨/.test(text)) return this.boost();
    if (/회의|모여|소집/.test(text)) return this.convene();
    if (/브리핑|보고하러|올라와/.test(text)) return this.briefNow();
    if (/승인|오케이|고고|진행해/.test(text) && this.approvalPending) {
      this.approve();
      this.pushChat("staff", SEC_NAME, "승인 접수했습니다. 바로 최종 정리에 들어갈게요.");
      return;
    }
    if (/수고|칭찬|잘했|좋아요|고마/.test(text)) return this.cheer();

    // ③ 질문(보고)
    if (/왜|늦|지연|막힘|블로|안 되|안돼|문제/.test(text)) return this.reportDelay();
    if (/뭐|현황|상황|진행|보고|어디까지|status/.test(q)) return this.reportStatus();

    this.pushChat(
      "staff",
      SEC_NAME,
      `이렇게 물어보시면 제일 빨라요 — “현황 보고” / “오늘 소식” / “○○ 자료 찾아줘” / “${DEPARTMENTS[0]?.name ?? "팀"} 뭐해?” / “회의 소집” / “지금 브리핑”.`,
    );
  }

  // ── 보고 ────────────────────────────────────────────────
  private reportStatus() {
    if (!this.running && !this.dayComplete) {
      this.pushChat("staff", SEC_NAME, "아직 출근 전이에요. ‘오늘 업무 시작하기’를 눌러주시면 전원 출근합니다.");
      return;
    }
    const working = this.workingDepts();
    const lines: string[] = [`지금 ${this.clockText()} · ‘${PHASES[this.phaseIndex]}’ 단계입니다.`];

    if (working.length) {
      lines.push(`진행 중: ${working.map((d) => `${roomOf(d).name} ${this.deptProgress(d)}%`).join(" · ")}`);
    } else if (this.approvalPending) {
      lines.push("전 부서가 대표님 결재를 기다리는 중입니다.");
    } else if (this.dayComplete) {
      lines.push("오늘 업무는 모두 끝났어요.");
    } else if (this.meetingTitle) {
      lines.push(`회의 진행 중 — ${this.meetingTitle}`);
    } else {
      lines.push("지금은 앞 단계 결과를 넘기는 중이라 잠깐 비어 있어요. 곧 다음 팀이 붙습니다.");
    }

    const stats = this.snapshot().stats;
    lines.push(`완료 ${stats.done}팀 · 연동 대기 ${stats.blocked}팀 · 근무 인원 ${this.onDutyCount()}명.`);
    const next = PHASES[this.phaseIndex + 1];
    if (next && !this.dayComplete) lines.push(`다음 순서는 ‘${next}’입니다.`);

    this.pushChat("staff", SEC_NAME, lines.join("\n"));
    this.speakSecretary("현황 정리해서 올렸어요.");
  }

  private reportDelay() {
    const lines: string[] = [];

    if (this.approvalPending) {
      const waited = Math.max(1, Math.round(this.elapsed - (this.approvalSince ?? this.elapsed)));
      lines.push(
        `원인은 하나예요 — 대표님 결재 대기입니다. 회의실에서 결재 ${this.approvals.length - this.approvalDone}건이 ${waited}초째 기다리고 있어요.`,
      );
      lines.push("승인만 눌러주시면 바로 최종 정리로 넘어갑니다.");
    }

    const working = this.workingDepts();
    for (const dept of working) {
      lines.push(`${roomOf(dept).name}: ${this.deptTaskLabel(dept)} — 진행률 ${this.deptProgress(dept)}%. 정상 속도예요.`);
    }

    const blocked = Object.entries(this.deptStatus)
      .filter(([, s]) => s === "연동 대기")
      .map(([dept]) => dept);
    if (blocked.length) {
      if (lines.length) {
        // 이미 진짜 병목을 짚었으면 연동 대기는 한 줄로 요약한다
        lines.push(`그 외 연동 대기 ${blocked.length}팀(${blocked.map((d) => roomOf(d).name).join("·")})은 외부 연결 문제라 오늘 진행이 어려워요.`);
      } else {
        for (const dept of blocked) {
          lines.push(`${roomOf(dept).name}: ${BLOCK_REASON[dept] ?? "외부 연동 대기 중이에요."}`);
        }
      }
    }

    const away = this.agents.filter((a) => a.status === "휴식").length;
    if (away) lines.push(`참고로 지금 ${away}명이 라운지에 있어요. ‘집중 모드’라고 하시면 전원 자리로 붙입니다.`);

    if (!lines.length) {
      lines.push(
        this.running ? "지연 없습니다. 대기 중인 병목도 없어요." : "아직 출근 전이라 진행할 업무가 없어요.",
      );
    }
    this.pushChat("staff", SEC_NAME, lines.join("\n"));
    this.speakSecretary("지연 사유 보고드렸어요.");
  }

  private deptReport(deptId: string, question: string) {
    const room = roomOf(deptId);
    const lead = this.agentById.get(DEPT_LEAD[deptId]?.id ?? "") ?? this.agentById.get("ceo")!;
    const status = this.deptStatus[deptId];
    const crew = this.deptAgents(deptId);
    const lines: string[] = [];

    if (status === "진행 중") {
      lines.push(`${this.deptTaskLabel(deptId)} 작업 중이에요. 진행률 ${this.deptProgress(deptId)}%.`);
    } else if (status === "완료") {
      lines.push(`오늘 몫은 끝냈어요. ${DEPT_BRIEF[deptId].report}`);
    } else if (status === "연동 대기") {
      lines.push(BLOCK_REASON[deptId] ?? "외부 연동을 기다리는 중이에요.");
    } else if (status === "승인 대기") {
      lines.push("대표님 결재를 기다리는 중입니다. 승인 주시면 바로 움직여요.");
    } else {
      lines.push(`앞 단계 결과를 기다리는 중이에요. 오늘 제 일은 ‘${DEPT_BRIEF[deptId].task}’입니다.`);
    }
    lines.push(
      "팀원 현황:\n" +
        crew
          .map((a) => `· ${a.name}(${a.status}) — ${a.task ?? a.role}${a.anim === "type" ? ` ${Math.round(a.progress * 100)}%` : ""}`)
          .join("\n"),
    );
    if (/왜|늦|지연/.test(question) && status === "대기") {
      lines.push("저희가 늦는 게 아니라 앞 팀 산출물이 아직 안 왔어요.");
    }

    this.pushChat("staff", `${lead.name} · ${room.name}`, lines.join("\n"));
    this.say(lead, "대표님, 보고드릴게요!", 3);
    lead.anim = "talk";
    this.spotlightRoom(deptId, 8);
    this.pushLog("🎤", `대표 지시: ${room.name} 상황 확인`, "yellow");
  }

  // ── 지시 실행 ────────────────────────────────────────────
  private setFocusMode(on: boolean) {
    this.focusMode = on;
    if (on) {
      this.recallAll(true);
      this.pushChat("staff", SEC_NAME, "집중 모드 켰습니다. 커피·잡담 없이 전원 자리에서 업무만 봅니다.");
      this.pushLog("🎤", "대표 지시: 집중 모드 ON — 자율 휴식 중단", "yellow");
    } else {
      this.pushChat("staff", SEC_NAME, "집중 모드 껐어요. 다들 숨 좀 돌리겠습니다 ☕");
      this.pushLog("🎤", "대표 지시: 집중 모드 OFF", "yellow");
    }
  }

  private recallAll(quiet = false) {
    let moved = 0;
    for (const agent of this.agents) {
      if (agent.rank === "ceo" || this.locked.has(agent.id) || agent.status === "출근 전") continue;
      if (Math.abs(agent.x - agent.home.x) < 0.2 && Math.abs(agent.y - agent.home.y) < 0.2) continue;
      agent.queue.length = 0;
      agent.current = null;
      this.say(agent, "네, 바로 갈게요!", 2.4);
      this.sitAtDesk(agent);
      moved += 1;
    }
    if (!quiet) {
      this.pushChat("staff", SEC_NAME, moved ? `${moved}명 자리로 복귀시켰습니다.` : "다들 이미 자리에 있어요.");
      this.pushLog("🎤", `대표 지시: 전원 자리 복귀 (${moved}명 이동)`, "yellow");
    }
  }

  private boost() {
    let count = 0;
    for (const agent of this.agents) {
      if (agent.current?.k === "work") {
        agent.current.dur = Math.max(agent.timer + 0.8, agent.current.dur * 0.55);
        this.say(agent, "네! 속도 올릴게요", 2.4);
        count += 1;
      }
    }
    this.speed = Math.min(4, this.speed * 2);
    this.pushChat(
      "staff",
      SEC_NAME,
      count ? `작업 ${count}건 속도 올렸고 배속도 ${this.speed}x로 바꿨습니다.` : `지금 돌아가는 작업이 없어서 배속만 ${this.speed}x로 올렸어요.`,
    );
    this.pushLog("🎤", `대표 지시: 속도 올리기 (${this.speed}x)`, "yellow");
  }

  private cheer() {
    for (const agent of this.agents) {
      if (agent.rank === "ceo" || agent.status === "출근 전") continue;
      this.say(agent, rand(["감사합니다!", "힘나요!", "더 잘할게요 💙"]), 3.2);
    }
    this.pushChat("staff", SEC_NAME, "대표님 한마디에 사무실 분위기가 확 살았어요 💙");
    this.pushLog("💙", "대표 격려 — 전 직원 사기 상승", "pink");
  }

  private convene() {
    if (this.side.gen) {
      this.pushChat("staff", SEC_NAME, "앞선 지시를 아직 처리 중이에요. 끝나면 바로 잡겠습니다.");
      return;
    }
    const ids = Object.keys(this.deptStatus)
      .map((dept) => DEPT_LEAD[dept]?.id)
      .filter((id): id is string => !!id && !this.locked.has(id) && this.agentById.get(id)?.status !== "출근 전")
      .slice(0, 6);
    if (!ids.length) {
      this.pushChat("staff", SEC_NAME, "지금은 다들 진행 중인 업무가 있어 소집이 어려워요. 잠시 뒤 다시 불러주세요.");
      return;
    }
    this.pushChat("staff", SEC_NAME, `${ids.length}명 회의실로 소집했습니다. 각자 한 줄씩 보고할게요.`);
    this.pushLog("🎤", `대표 지시: 긴급 회의 소집 (${ids.length}명)`, "yellow");
    this.spotlightRoom("meeting", 24);
    this.side.gen = this.conveneScene(ids);
  }

  private *conveneScene(ids: string[]): Generator<number | (() => boolean), void, void> {
    const lines = ids.map((id) => {
      const agent = this.agentById.get(id)!;
      const status = this.deptStatus[agent.deptId];
      const text =
        status === "진행 중"
          ? `${this.deptTaskLabel(agent.deptId)} ${this.deptProgress(agent.deptId)}% 진행 중입니다.`
          : status === "완료"
            ? "오늘 몫은 끝냈습니다."
            : status === "연동 대기"
              ? (BLOCK_REASON[agent.deptId] ?? "외부 연동 대기 중입니다.")
              : "앞 단계 결과를 기다리는 중입니다.";
      return [id, text] as [string, string];
    });
    yield* this.meeting("대표 긴급 소집 · 전 부서 한 줄 보고", ids, lines);
    this.pushChat("staff", SEC_NAME, "회의 마쳤습니다. 전원 자리로 복귀했어요.");
  }

  private briefNow() {
    if (this.side.gen) {
      this.pushChat("staff", SEC_NAME, "앞선 지시를 처리 중이에요. 끝나고 바로 올라가겠습니다.");
      return;
    }
    const seri = this.agentById.get(SEC_ID)!;
    if (this.locked.has(seri.id)) {
      this.pushChat("staff", SEC_NAME, "지금 다른 일정에 묶여 있어요. 마치는 대로 대표실로 가겠습니다.");
      return;
    }
    this.pushLog("🎤", "대표 지시: 즉시 브리핑 요청", "yellow");
    this.side.gen = this.briefScene(seri);
  }

  /** 일반지원팀: 오늘 소식 요약 보고 */
  private newsBrief() {
    const status = this.deptStatus[BRIEFING_DEPT];
    const lines: string[] = [];
    if (status === "진행 중") lines.push(`지금 정리 중이에요 (진행률 ${this.deptProgress(BRIEFING_DEPT)}%). 항목은 이렇게 올라갑니다.`);
    else if (status === "완료") lines.push("오늘 소식 요약 준비됐어요.");
    else lines.push("출근하면 바로 정리 시작합니다. 항목은 이렇게 올라가요.");
    lines.push(
      "⚽ 축구 — 한국 남자 A대표팀 / EPL 빅6 / 레알 마드리드",
      "⚾ 야구 — KBO 전체 / 롯데 자이언츠",
      "📰 헤드라인 — 국내 · 해외 종합",
      "※ 아직 뉴스 연동 전이라 실제 기사 내용은 비어 있어요. 연동되면 여기 채워집니다.",
    );
    const reporter = this.deptAgents(BRIEFING_DEPT).find((a) => /축구|소식/.test(a.task ?? "")) ?? this.agentById.get(SEC_ID);
    this.pushChat("staff", reporter ? `${reporter.name} · 소식 요약` : SEC_NAME, lines.join("\n"));
    if (reporter && reporter.status !== "출근 전") {
      this.say(reporter, "오늘 소식 바로 올려드릴게요!", 3);
      reporter.anim = "talk";
    }
    this.spotlightRoom(BRIEFING_DEPT, 6);
    this.pushLog("📰", "대표 요청: 오늘 소식 요약", "yellow");
  }

  /** 연구소모임팀: 대표 회의록 접수 → 검토·발전 방향 제안 */
  private minutesReceived(text: string) {
    const lab = DEPARTMENTS.find((d) => d.id === "lab") ? "lab" : this.matchDept(text);
    const lead = lab ? this.agentById.get(DEPT_LEAD[lab]?.id ?? "") : undefined;
    if (!lab || !lead) return this.requestSupport(text);
    this.pushChat(
      "staff",
      `${lead.name} · ${roomOf(lab).name}`,
      "회의록 접수했어요 (월 2회 정기 검토).\n① 회의 내용 반영 ② 향후 발전 방향 제안 ③ 개선·추가 건의 순서로 정리해서 올릴게요.\n※ 파일 연동 전이라 지금은 접수·응대까지만 돼요.",
    );
    this.pushLog("📝", `대표 회의록 전달 → ${roomOf(lab).name} 검토 시작`, "yellow");
    if (lead.status !== "출근 전") {
      this.say(lead, "회의록 받았어요! 검토해볼게요.", 3);
      lead.anim = "talk";
    }
    this.spotlightRoom(lab, 6);
  }

  /** 자료·검색 요청 접수 → 맞는 팀 담당자가 대표실로 와서 응답 (기본: 일반지원팀) */
  private requestSupport(text: string) {
    const matched = this.matchDept(text);
    const deptId = matched && DEPT_LEAD[matched] ? matched : BRIEFING_DEPT;
    const crew = this.deptAgents(deptId);
    // 요청 문장과 담당 업무가 가장 많이 겹치는 직원에게 맡긴다
    const words = (text.match(/[가-힣A-Za-z]{2,}/g) ?? []).flatMap((w) =>
      w.length > 2 ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))] : [w],
    );
    const score = (a: Agent) => words.filter((w) => `${a.task ?? ""} ${a.role}`.includes(w)).length;
    const ranked = crew.filter((a) => a.rank === "member").sort((x, y) => score(y) - score(x));
    const helper =
      (ranked[0] && score(ranked[0]) > 0 ? ranked[0] : undefined) ??
      crew.find((a) => /요청|자료조사|수집/.test(a.task ?? "")) ??
      ranked[0] ??
      crew[0];
    if (!helper) return;
    this.pushChat(
      "staff",
      `${helper.name} · ${roomOf(deptId).name}`,
      `요청 접수했어요: “${text}”\n바로 찾아서 정리해 올릴게요.\n※ 검색 연동 전이라 지금은 접수·응대까지만 돼요.`,
    );
    this.pushLog("🔎", `대표 요청 접수 — ${helper.name}: “${text}”`, "yellow");
    if (helper.status === "출근 전" || this.side.gen || this.locked.has(helper.id)) {
      if (helper.status !== "출근 전") this.say(helper, "요청 접수했어요!", 3);
      return;
    }
    this.side.gen = this.helperScene(helper);
  }

  private *helperScene(helper: Agent): Generator<number | (() => boolean), void, void> {
    this.lock([helper]);
    this.stand(helper);
    this.say(helper, "대표님 요청 접수! 바로 갑니다.", 3);
    this.goto(helper, CEO_REPORT_SPOT, "보고 중");
    this.enqueue(helper, { k: "face", dir: "up" });
    yield this.allFree([helper]);
    helper.anim = "talk";
    this.say(helper, "찾는 대로 정리해서 올릴게요!", 3);
    yield 3;
    helper.anim = "idle";
    this.stand(helper);
    this.sitAtDesk(helper);
    yield this.allFree([helper]);
    this.unlock([helper]);
  }

  private *briefScene(seri: Agent): Generator<number | (() => boolean), void, void> {
    this.lock([seri]);
    this.stand(seri);
    this.say(seri, "대표님께 지금 보고드리러 갑니다.", 3);
    this.goto(seri, CEO_REPORT_SPOT, "보고 중");
    this.enqueue(seri, { k: "face", dir: "up" });
    yield this.allFree([seri]);
    seri.anim = "talk";
    this.say(seri, "바로 보고드릴게요.", 3);
    this.reportStatus();
    yield 3;
    seri.anim = "idle";
    this.stand(seri);
    this.sitAtDesk(seri);
    yield this.allFree([seri]);
    this.unlock([seri]);
  }

  // ── 보고용 계산 ──────────────────────────────────────────
  private workingDepts() {
    return Object.entries(this.deptStatus)
      .filter(([, status]) => status === "진행 중")
      .map(([dept]) => dept);
  }

  private deptProgress(deptId: string) {
    const crew = this.deptAgents(deptId);
    if (!crew.length) return 0;
    return Math.round((crew.reduce((sum, a) => sum + a.progress, 0) / crew.length) * 100);
  }

  private deptTaskLabel(deptId: string) {
    const crew = this.deptAgents(deptId);
    return crew.find((a) => a.status === "업무 중")?.taskLabel ?? DEPT_BRIEF[deptId].task;
  }

  private onDutyCount() {
    return this.agents.filter((a) => a.rank !== "ceo" && a.status !== "출근 전").length;
  }

  private speakSecretary(text: string) {
    const seri = this.agentById.get(SEC_ID);
    if (seri && seri.status !== "출근 전") this.say(seri, text, 3);
  }

  private spotlightRoom(roomId: string, seconds: number) {
    this.spotlight = roomId;
    this.spotlightUntil = this.elapsed + seconds;
  }

  /** 질문에 등장한 부서·이름을 찾아낸다 (구체적인 키워드부터 검사) */
  private matchDept(text: string): string | null {
    for (const [deptId, words] of DEPT_KEYWORDS) {
      if (words.some((word) => text.includes(word))) return deptId;
    }
    const staff = STAFF.find(
      (s) => s.deptId !== SECRETARY_DEPT && (text.includes(s.name) || (s.callsign && text.includes(s.callsign))),
    );
    return staff?.deptId ?? null;
  }

  // ── 대표 액션 ────────────────────────────────────────────
  approve() {
    if (!this.approvalPending) return;
    // 지금 올라온 안건 하나를 승인한다 (스크립트가 다음 안건으로 넘어감)
    if (this.approvalDone < this.approvals.length) this.approvalDone += 1;
  }

  // ── 대표 수행비서 ────────────────────────────────────────
  private secretary() {
    return this.agentById.get(SECRETARY_SEED.id);
  }

  private secretarySay(chat: string, bubble: string) {
    const sec = this.secretary();
    this.pushChat("staff", `${SECRETARY_SEED.name} · 수행비서`, chat);
    if (sec && sec.status !== "출근 전") this.say(sec, bubble, 3.2);
  }

  /** 오늘·다가오는 일정 정리 */
  private scheduleLines() {
    const today = todaySchedule();
    const upcoming = upcomingSchedule(7);
    const lines: string[] = [];
    lines.push(today.length ? `오늘 일정 ${today.length}건:` : "오늘 등록된 일정은 없어요.");
    for (const item of today) lines.push(`· ${formatItem(item)}`);
    if (upcoming.length) {
      lines.push(`다가오는 7일 ${upcoming.length}건:`);
      for (const item of upcoming.slice(0, 6)) lines.push(`· ${formatItem(item, true)}`);
      if (upcoming.length > 6) lines.push(`· 외 ${upcoming.length - 6}건`);
    }
    if (TODAY_SCHEDULE.length) lines.push(`정기보고: ${TODAY_SCHEDULE.map((w) => `${w.time} ${w.title}`).join(" / ")}`);
    if (!today.length && !upcoming.length) lines.push("‘my.schedule’ 창에서 일정을 추가하거나 .ics/.csv 파일을 올려주세요.");
    return lines;
  }

  private secretarySchedule() {
    this.secretarySay(this.scheduleLines().join("\n"), "일정 정리해서 올렸어요!");
  }

  /** 대표님이 챙길 일 — 결재 대기 + 다음 일정 */
  private secretaryTodo() {
    const lines: string[] = [];
    const left = this.approvals.length - this.approvalDone;
    if (this.approvalPending && left > 0) {
      lines.push(`결재 대기 ${left}건이에요:`);
      for (const item of this.approvals.slice(this.approvalDone)) lines.push(`· ${item.title} (${roomOf(item.fromDept).name})`);
    } else if (this.approved) {
      lines.push("오늘 결재는 모두 끝났어요.");
    } else {
      lines.push(`오늘 올라올 결재 ${TODAY_APPROVALS.length}건 — 팀 업무가 끝나면 회의실로 올라와요:`);
      for (const item of TODAY_APPROVALS) lines.push(`· ${item.title}`);
    }
    const next = this.nextSchedule();
    if (next) lines.push(`다음 일정: ${formatItem(next)}`);
    this.secretarySay(lines.join("\n"), "챙기실 것 정리했어요!");
  }

  private nextSchedule() {
    const now = Math.floor(this.clockMinutes);
    return todaySchedule().find((item) => (minutesOf(item.time) ?? -1) >= now);
  }

  /** 출근 직후: 대표실로 가서 오늘 일정 보고 */
  private *secretaryMorning(): Generator<number | (() => boolean), void, void> {
    const sec = this.secretary();
    if (!sec) return;
    this.lock([sec]);
    this.stand(sec);
    this.goto(sec, CEO_REPORT_SPOT, "보고 중");
    this.enqueue(sec, { k: "face", dir: "up" });
    yield this.allFree([sec]);
    sec.anim = "talk";
    const count = todaySchedule().length;
    this.say(sec, count ? `대표님, 오늘 일정 ${count}건 있어요.` : "대표님, 오늘 일정 정리해드릴게요.", 3.2);
    const lines = this.scheduleLines();
    lines.push(`오늘 결재 예정 ${TODAY_APPROVALS.length}건: ${TODAY_APPROVALS.map((item) => item.title).join(" / ")}`);
    this.pushChat("staff", `${SECRETARY_SEED.name} · 수행비서`, `좋은 아침이에요, 대표님.\n${lines.join("\n")}`);
    this.pushLog("📅", `수행비서 ${SECRETARY_SEED.name}: 오늘 일정 브리핑`, "lav");
    yield 3;
    sec.anim = "idle";
    this.stand(sec);
    this.sitAtDesk(sec);
    yield this.allFree([sec]);
    this.unlock([sec]);
  }

  /** 결재가 올라오면 바로 알림 */
  private secretaryApprovalAlert() {
    const left = this.approvals.length - this.approvalDone;
    this.secretarySay(
      `대표님, 회의실에 결재 ${left}건이 올라왔어요.\n${this.approvals
        .slice(this.approvalDone)
        .map((item) => `· ${item.title}`)
        .join("\n")}`,
      `결재 ${left}건 기다리고 있어요!`,
    );
    this.lastNag = this.elapsed;
  }

  /** 매 틱: 일정 30분 전 리마인드 + 결재가 오래 밀리면 다시 알림 */
  private secretaryWatch() {
    const sec = this.secretary();
    if (!sec || sec.status === "출근 전") return;
    const now = this.clockMinutes;
    for (const item of todaySchedule()) {
      const at = minutesOf(item.time);
      if (at === null || this.reminded.has(item.id)) continue;
      if (now >= at - 30 && now < at + 5) {
        this.reminded.add(item.id);
        const left = Math.max(0, Math.round(at - now));
        this.secretarySay(
          `대표님, ${left ? `${left}분 뒤` : "지금"} 일정이에요.\n· ${formatItem(item)}`,
          `${item.time} ${item.title} 곧이에요!`,
        );
        this.pushLog("⏰", `리마인드: ${formatItem(item)}`, "yellow");
      } else if (now >= at + 5) {
        this.reminded.add(item.id); // 이미 지난 일정은 건너뜀
      }
    }
    if (this.approvalPending && this.elapsed - this.lastNag > 45) {
      const left = this.approvals.length - this.approvalDone;
      this.say(sec, `결재 ${left}건 아직 대기 중이에요!`, 3);
      this.lastNag = this.elapsed;
    }
  }

  setBriefingHandler(handler: (() => void) | null) {
    this.onBriefing = handler;
  }

  togglePause() {
    this.paused = !this.paused;
  }

  setSpeed(value: number) {
    this.speed = value;
    this.turbo = false;
  }

  /** 대표가 결정할 일이 생길 때까지(또는 업무 종료까지) 단숨에 건너뛴다 */
  skipToDecision() {
    if (!this.running || this.approvalPending || this.dayComplete) return;
    this.turbo = true;
    this.paused = false;
    this.pushLog("⏭", "대표 지시: 결정이 필요한 지점까지 건너뜁니다.", "yellow");
  }

  // ── 틱 ──────────────────────────────────────────────────
  tick(rawDt: number) {
    if (this.paused) return;
    // 터보(건너뛰기)는 대표 결정이 필요한 지점이나 업무 종료에서 자동 해제된다
    if (this.turbo && (this.approvalPending || this.dayComplete || !this.running)) this.turbo = false;

    const raw = Math.min(rawDt, 0.05);
    const dt = raw * (this.turbo ? TURBO_SPEED : this.speed);
    if (this.running) this.clockMinutes += dt * SIM_MIN_PER_SEC;

    this.occupancy.clear();
    for (const agent of this.agents) {
      this.occupancy.add(Math.round(agent.y) * COLS + Math.round(agent.x));
    }

    for (const agent of this.agents) this.stepAgent(agent, dt);
    this.runSlot(this.main, dt);
    this.runSlot(this.side, dt);
    if (this.running) this.secretaryWatch();

    this.elapsed += dt;
    if (this.spotlight && this.elapsed > this.spotlightUntil) this.spotlight = null;
    if (this.approvalPending && this.approvalSince === null) this.approvalSince = this.elapsed;
    if (!this.approvalPending) this.approvalSince = null;
  }

  private runSlot(slot: Slot, dt: number) {
    if (!slot.gen) return;
    if (slot.wait > 0) {
      slot.wait -= dt;
      return;
    }
    if (slot.until) {
      if (!slot.until()) return;
      slot.until = null;
    }
    const result = slot.gen.next();
    if (result.done) {
      slot.gen = null;
      return;
    }
    if (typeof result.value === "number") slot.wait = result.value;
    else slot.until = result.value;
  }

  private stepAgent(agent: Agent, dt: number) {
    if (agent.speechFor > 0) {
      agent.speechFor -= dt;
      if (agent.speechFor <= 0) agent.speech = null;
    }

    if (!agent.current) {
      const next = agent.queue.shift();
      if (next) {
        agent.current = next;
        agent.timer = 0;
        this.beginAction(agent, next);
      } else {
        this.idleBrain(agent, dt);
        return;
      }
    }

    const action = agent.current;
    if (!action) return;
    agent.timer += dt;

    switch (action.k) {
      case "walk": {
        this.stepWalk(agent, dt);
        if (agent.pathIdx >= agent.path.length) {
          agent.path = [];
          agent.anim = "idle";
          agent.current = null;
        }
        break;
      }
      case "wait":
      case "say": {
        if (agent.timer >= action.dur) agent.current = null;
        break;
      }
      case "work": {
        agent.anim = "type";
        agent.progress = Math.min(1, agent.timer / action.dur);
        agent.taskLabel = action.label;
        if (agent.timer >= action.dur) {
          agent.progress = 1;
          agent.current = null;
        }
        break;
      }
      default:
        agent.current = null;
    }
  }

  private beginAction(agent: Agent, action: Action) {
    switch (action.k) {
      case "walk": {
        const path = findPath(
          { x: Math.round(agent.x), y: Math.round(agent.y) },
          action.to,
          this.occupancy,
        );
        agent.path = path;
        agent.pathIdx = 0;
        agent.anim = path.length ? "walk" : "idle";
        if (agent.status === "대기" || agent.status === "휴식") agent.status = "이동 중";
        break;
      }
      case "say":
        this.say(agent, action.text, action.dur, action.kind);
        break;
      case "face":
        agent.facing = action.dir;
        agent.current = null;
        break;
      case "anim":
        agent.anim = action.a;
        agent.current = null;
        break;
      case "status":
        agent.status = action.s;
        agent.current = null;
        break;
      case "fn":
        action.fn();
        agent.current = null;
        break;
      default:
        break;
    }
  }

  private stepWalk(agent: Agent, dt: number) {
    if (agent.pathIdx >= agent.path.length) return;
    const node = agent.path[agent.pathIdx];
    const dx = node.x - agent.x;
    const dy = node.y - agent.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.06) {
      agent.x = node.x;
      agent.y = node.y;
      agent.pathIdx += 1;
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) agent.facing = dx > 0 ? "right" : "left";
    else agent.facing = dy > 0 ? "down" : "up";

    const step = WALK_SPEED * dt;
    agent.x += (dx / dist) * Math.min(step, dist);
    agent.y += (dy / dist) * Math.min(step, dist);
    agent.anim = "walk";
  }

  /** 할 일이 없을 때의 자율 행동 — 생각 말풍선, 커피, 잡담 */
  private idleBrain(agent: Agent, dt: number) {
    if (agent.rank === "ceo" || this.locked.has(agent.id)) return;
    agent.idleFor -= dt;
    if (agent.idleFor > 0) return;
    agent.idleFor = 7 + Math.random() * 14;

    const roll = Math.random();
    const blocked = BLOCKED_DEPTS.has(agent.deptId) && this.deptStatus[agent.deptId] === "연동 대기";

    if (agent.status === "출근 전") return;

    if (roll < 0.5 || this.focusMode) {
      // 집중 모드에서는 자리에서 생각만 한다 — 커피·잡담 금지
      this.say(agent, rand(agent.thoughts), 3.4, "think");
      return;
    }
    if (roll < 0.68 || blocked) {
      // 라운지 커피 타임
      this.stand(agent);
      this.enqueue(
        agent,
        { k: "status", s: "휴식" },
        { k: "walk", to: rand(LOUNGE_ROOM.loiter) },
        { k: "say", text: rand(["잠깐 커피 ☕", "머리 좀 식히고요", "당 충전 필요해요"]), dur: 2.6, kind: "talk" },
        { k: "wait", dur: 3 + Math.random() * 4 },
      );
      this.sitAtDesk(agent);
      return;
    }
    if (roll < 0.82) {
      // 옆자리 잡담
      const mate = this.agents.find(
        (a) => a.deptId === agent.deptId && a.id !== agent.id && !this.busy(a) && a.status !== "출근 전",
      );
      if (mate) {
        this.say(agent, rand(["이거 어떻게 생각해요?", "잠깐만요, 이거 봐봐요", "이 자료 괜찮나요?"]), 3);
        this.say(mate, rand(["오, 괜찮은데요?", "순서만 살짝 바꾸면 좋겠어요", "근거만 붙이면 돼요"]), 3);
        agent.anim = "talk";
        mate.anim = "talk";
        this.enqueue(agent, { k: "wait", dur: 2.6 }, { k: "anim", a: "sit" });
        this.enqueue(mate, { k: "wait", dur: 2.6 }, { k: "anim", a: "sit" });
      }
      return;
    }
    // 자리 정리
    if (Math.abs(agent.x - agent.home.x) > 0.1 || Math.abs(agent.y - agent.home.y) > 0.1) {
      this.sitAtDesk(agent);
    }
  }

  // ── 스냅샷 ──────────────────────────────────────────────
  snapshot(): Snapshot {
    const counts = {} as Record<AgentStatus, number>;
    for (const agent of this.agents) {
      counts[agent.status] = (counts[agent.status] ?? 0) + 1;
    }
    const values = Object.values(this.deptStatus);
    return {
      clock: this.clockText(),
      running: this.running,
      paused: this.paused,
      speed: this.speed,
      turbo: this.turbo,
      dayComplete: this.dayComplete,
      phase:
        this.phaseIndex === PHASE.approval && this.approved ? "승인 완료 · 자리 복귀" : PHASES[this.phaseIndex] ?? "",
      phaseIndex: this.phaseIndex,
      approvalPending: this.approvalPending,
      approved: this.approved,
      approvalItem: this.approvalPending ? (this.approvals[this.approvalDone] ?? null) : null,
      approvalTotal: this.approvals.length,
      approvalDone: this.approvalDone,
      approvedTitles: this.approvals.slice(0, this.approvalDone).map((item) => item.title),
      briefingReady: this.briefingReady,
      deptStatus: { ...this.deptStatus },
      counts,
      stats: {
        done: values.filter((v) => v === "완료").length,
        working: values.filter((v) => v === "진행 중").length,
        approval: values.filter((v) => v === "승인 대기").length,
        blocked: values.filter((v) => v === "연동 대기").length,
      },
      log: this.log.slice(0, 24),
      meetingTitle: this.meetingTitle,
      chat: this.chat.slice(-24),
      focusMode: this.focusMode,
      spotlight: this.spotlight,
      busyWithOrder: this.side.gen !== null,
    };
  }
}

export const TOTAL_PHASES = PHASES.length;
export { PHASES };
