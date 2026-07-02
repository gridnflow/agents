import schedule from "node-schedule";
import { BrowserWindow } from "electron";
import { AGENTS, AgentConfig } from "./config";
import { BaseAgent } from "./agents/BaseAgent";
import { runDailyDigest } from "./digest";

// 에이전트별 job 저장
const jobs = new Map<string, schedule.Job>();

// 자동 아침 회의(데일리 다이제스트) 스케줄 등록/변경
export function scheduleDailyDigest(
  time: string,
  windows: Map<string, BrowserWindow>
) {
  const existing = jobs.get("digest");
  if (existing) existing.cancel();

  const [hour, minute] = time.split(":").map(Number);
  const job = schedule.scheduleJob({ hour, minute }, async () => {
    try {
      await runDailyDigest(windows);
    } catch (err) {
      console.error("[digest] 실행 실패:", err);
    }
  });

  jobs.set("digest", job);
  console.log(`[스케줄러] Daily Digest - 매일 ${time} 등록 완료`);
}

export function startScheduler(windows: Map<string, BrowserWindow>) {
  for (const agentConfig of AGENTS) {
    scheduleAgent(agentConfig, windows);
  }
}

export function scheduleAgent(
  agentConfig: AgentConfig,
  windows: Map<string, BrowserWindow>
) {
  // 기존 job 취소
  const existing = jobs.get(agentConfig.id);
  if (existing) existing.cancel();

  const [hour, minute] = agentConfig.scheduleTime.split(":").map(Number);
  const job = schedule.scheduleJob({ hour, minute }, async () => {
    await triggerAgent(agentConfig, windows);
  });

  jobs.set(agentConfig.id, job);
  console.log(`[스케줄러] ${agentConfig.name} - 매일 ${agentConfig.scheduleTime} 등록 완료`);
}

export function rescheduleAgent(
  agentId: string,
  newTime: string,
  windows: Map<string, BrowserWindow>
) {
  const agentConfig = AGENTS.find((a) => a.id === agentId);
  if (!agentConfig) return;
  agentConfig.scheduleTime = newTime;
  scheduleAgent(agentConfig, windows);
}

export async function triggerAgent(
  agentConfig: AgentConfig,
  windows: Map<string, BrowserWindow>
) {
  const win = windows.get(agentConfig.id);
  if (!win) {
    console.error(`[에러] 창을 찾을 수 없음: ${agentConfig.id}`);
    return;
  }

  console.log(`[${agentConfig.name}] 브리핑 요청 시작`);
  const agent = new BaseAgent(agentConfig);
  const { text, audioPath } = await agent.runBriefing();
  console.log(`[${agentConfig.name}] 브리핑 완료, 오디오: ${audioPath}`);

  win.webContents.send("briefing", { agentId: agentConfig.id, text, audioPath });
}
