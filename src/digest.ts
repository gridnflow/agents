import fs from "fs";
import path from "path";
import type { BrowserWindow } from "electron";
import { AGENTS, AgentConfig } from "./config";
import { BaseAgent } from "./agents/BaseAgent";
import { fetchNews } from "./services/news";
import { generateMeetingResponse, summarizeDigest } from "./services/openai";

// Electron 없이(headless 테스트) 실행돼도 동작하도록 앱 경로를 안전하게 조회
function getBaseDir(): string {
  try {
    const { app } = require("electron");
    if (app?.getAppPath) return app.getAppPath();
  } catch {
    /* plain node */
  }
  return process.cwd();
}

function byId(id: string): AgentConfig {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Agent not found: ${id}`);
  return agent;
}

interface Turn {
  name: string;
  text: string;
}

// 에이전트 한 명에게 단발 발언 요청 (다이제스트 릴레이용)
async function speakTurn(agent: AgentConfig, prompt: string): Promise<string> {
  return generateMeetingResponse(agent.systemPrompt, [
    { role: "user", content: prompt },
  ]);
}

/**
 * 자동 아침 회의 → 데일리 다이제스트
 * Foxy(문제 제기) → Kitty(아이디어) → Bunny(비용) → Kitty(런칭 전술) 릴레이를 돌리고
 * 결과를 digests/YYYY-MM-DD.md 로 저장한다.
 * windows가 주어지면 Foxy가 바에서 음성으로 완료를 알린다.
 */
export async function runDailyDigest(
  windows?: Map<string, BrowserWindow>
): Promise<string> {
  const foxy = byId("fox_news_anchor");
  const kitty = byId("cat_idea_planner");
  const bunny = byId("rabbit_budget_analyst");

  console.log("[digest] 데일리 다이제스트 시작");

  const news = await fetchNews(foxy.keywords).catch(() => "No news available today.");

  const transcript: Turn[] = [];
  const push = (name: string, text: string) => transcript.push({ name, text });

  const foxyText = await speakTurn(
    foxy,
    `[Daily standup — no user present, you are briefing the team] ` +
      `Here are today's news search results:\n${news}\n\n` +
      `Report the single most interesting real-world problem or complaint people have today.`
  );
  push(foxy.name, foxyText);

  const kittyText = await speakTurn(
    kitty,
    `[Daily standup — do NOT greet, answer directly] Foxy reported: "${foxyText}"\n` +
      `Propose one concrete product or service idea that solves this.`
  );
  push(kitty.name, kittyText);

  const bunnyText = await speakTurn(
    bunny,
    `[Daily standup — do NOT greet, answer directly] Foxy reported: "${foxyText}"\n` +
      `Kitty proposed: "${kittyText}"\n` +
      `Give a rough cost estimate (APIs, infra, tools) to build an MVP of Kitty's idea.`
  );
  push(bunny.name, bunnyText);

  const kittyTactic = await speakTurn(
    kitty,
    `[Daily standup — do NOT greet, answer directly] Your idea: "${kittyText}"\n` +
      `Bunny's cost estimate: "${bunnyText}"\n` +
      `Name the single first tactic to validate or launch this idea.`
  );
  push(kitty.name, kittyTactic);

  const transcriptText = transcript
    .map((t) => `**${t.name}**: ${t.text}`)
    .join("\n\n");
  const summary = await summarizeDigest(transcriptText).catch(() => "");

  // digests/YYYY-MM-DD.md 저장 (같은 날 재실행 시 -HHMM 붙임)
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dir = path.join(getBaseDir(), "digests");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let filePath = path.join(dir, `${dateStr}.md`);
  if (fs.existsSync(filePath)) {
    const hm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    filePath = path.join(dir, `${dateStr}-${hm}.md`);
  }

  const md =
    `# Daily Digest — ${dateStr}\n\n` +
    (summary ? `${summary}\n\n` : "") +
    `## Transcript\n\n${transcriptText}\n`;
  fs.writeFileSync(filePath, md, "utf-8");
  console.log(`[digest] 저장 완료: ${filePath}`);

  // 바에 음성 알림 (Foxy가 발표)
  if (windows) {
    const win = windows.get(foxy.id);
    if (win && !win.isDestroyed()) {
      const line = `Daily digest is ready, boss! ${foxyText}`;
      const audioPath = await new BaseAgent(foxy).speak(line).catch(() => "");
      win.webContents.send("briefing", {
        agentId: foxy.id,
        text: `${line}\n\n📝 digests/${path.basename(filePath)}`,
        audioPath,
      });
    }
  }

  return filePath;
}
