// 인사기록부 — 직원 + 대표 1명
// 실제 내용은 프로젝트 루트의 company.config.ts 에서 가져옵니다.
// 이 파일은 고칠 필요 없어요. 이름·성격·색을 바꾸려면 company.config.ts 를 여세요.

import { CEO_PROFILE, DEPARTMENTS, DEV_LEAD, PENDING_INTEGRATIONS, SECRETARY, STAFF_LIST } from "../../company.config";

/** 대표 수행비서의 소속 id (팀 방이 아니라 대표방 앞 자리) */
export const SECRETARY_DEPT = "ceo-secretary";
/** 개발팀장 — 대표실 수행비서 옆 자리 */
export const DEV_DEPT = "ceo-dev";

export type StaffSeed = {
  id: string;
  name: string;
  callsign?: string;
  /** 이 직원이 매일 맡는 업무 (없으면 팀 업무) */
  task?: string;
  gender?: "f" | "m";
  role: string;
  deptId: string;
  rank: "lead" | "member" | "ceo";
  hair: string;
  shirt: string;
  accent: string;
  skin: string;
  /** 자리를 비웠을 때 혼잣말하는 생각 */
  thoughts: string[];
};

const SKIN = ["#ffdcc4", "#f7cdae", "#ffe3cf", "#eec39f"];

function skin(i: number) {
  return SKIN[i % SKIN.length];
}

let seq = 0;
function make(
  dept: string,
  rank: StaffSeed["rank"],
  name: string,
  role: string,
  colors: [string, string, string],
  thoughts: string[],
  callsign?: string,
): StaffSeed {
  const i = seq++;
  return {
    id: `${dept}-${rank === "lead" ? "lead" : `m${i}`}`,
    name,
    callsign,
    role,
    deptId: dept,
    rank,
    hair: colors[0],
    shirt: colors[1],
    accent: colors[2],
    skin: skin(i),
    thoughts,
  };
}

export const CEO: StaffSeed = {
  id: "ceo",
  name: CEO_PROFILE.name,
  callsign: CEO_PROFILE.callsign,
  role: CEO_PROFILE.role,
  deptId: "ceo",
  rank: "ceo",
  hair: CEO_PROFILE.hair,
  shirt: CEO_PROFILE.shirt,
  accent: CEO_PROFILE.accent,
  skin: CEO_PROFILE.skin,
  thoughts: [...CEO_PROFILE.thoughts],
};

/** 대표 수행비서 */
export const SECRETARY_SEED: StaffSeed = {
  id: "ceo-secretary",
  name: SECRETARY.name,
  role: SECRETARY.role,
  task: SECRETARY.task,
  gender: SECRETARY.gender,
  deptId: SECRETARY_DEPT,
  rank: "member",
  hair: SECRETARY.colors[0],
  shirt: SECRETARY.colors[1],
  accent: SECRETARY.colors[2],
  skin: "#ffe3cf",
  thoughts: [...SECRETARY.thoughts],
};

/** 개발팀장 */
export const DEV_SEED: StaffSeed = {
  id: "ceo-dev",
  name: DEV_LEAD.name,
  role: DEV_LEAD.role,
  task: DEV_LEAD.task,
  gender: DEV_LEAD.gender,
  deptId: DEV_DEPT,
  rank: "member",
  hair: DEV_LEAD.colors[0],
  shirt: DEV_LEAD.colors[1],
  accent: DEV_LEAD.colors[2],
  skin: "#f6d7bd",
  thoughts: [...DEV_LEAD.thoughts],
};

export const STAFF: StaffSeed[] = [
  ...STAFF_LIST.map((s) => ({ ...make(s.dept, s.rank, s.name, s.role, s.colors, s.thoughts, s.callsign), task: s.task, gender: s.gender })),
  SECRETARY_SEED,
  DEV_SEED,
];

export const DEPT_LEAD: Record<string, StaffSeed> = Object.fromEntries(
  STAFF.filter((s) => s.rank === "lead").map((s) => [s.deptId, s]),
);

/** 부서별 오늘 업무 · 한줄보고 */
export const DEPT_BRIEF: Record<string, { task: string; report: string; duties: string[]; priority: boolean }> =
  Object.fromEntries(
    DEPARTMENTS.map((d) => [
      d.id,
      { task: d.task, report: d.report, duties: d.duties ?? [], priority: Boolean(d.priority) },
    ]),
  );
DEPT_BRIEF[SECRETARY_DEPT] = { task: SECRETARY.task, report: "", duties: SECRETARY.duties, priority: false };
DEPT_BRIEF[DEV_DEPT] = { task: DEV_LEAD.task, report: "", duties: DEV_LEAD.duties, priority: false };

/** 아직 외부 연동이 안 붙은 부서 → 화면에 "연동 대기"로 표시 */
export const BLOCK_NEED: Record<string, string> = PENDING_INTEGRATIONS;
