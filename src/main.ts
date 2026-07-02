import { app, BrowserWindow, ipcMain, screen, session, Tray, Menu, nativeImage } from "electron";
import path from "path";
import fs from "fs";
import { AGENTS } from "./config";
import { triggerAgent, rescheduleAgent, scheduleDailyDigest } from "./scheduler";
import { runDailyDigest } from "./digest";
import { appendMessage, getContext } from "./memory";
import { summarizeLatestCsv } from "./services/csv";
import { baseDir } from "./paths";
import { getUsageSummary } from "./services/usage";
import { BaseAgent } from "./agents/BaseAgent";
import { transcribeAudio } from "./services/openai";

const windows = new Map<string, BrowserWindow>();
let barWin:      BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let meetingWin:  BrowserWindow | null = null;
let digestWin:   BrowserWindow | null = null;
let usageWin:    BrowserWindow | null = null;
let tray: Tray | null = null;
let digestRunning = false;
const greetingCache = new Map<string, string>(); // agentId → audioPath

// 설정 파일 경로 (.env는 dev: 프로젝트 루트 / 패키징: userData, settings.json은 userData)
const ENV_PATH = path.join(baseDir(), ".env");
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

// .env 파일 파싱
function parseEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
  const result: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) result[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

// .env 파일 저장 (기존 키 유지, 새 키 추가/덮어쓰기)
function writeEnv(updates: Record<string, string>) {
  const existing = parseEnv();
  const merged = { ...existing, ...updates };
  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  fs.writeFileSync(ENV_PATH, content, "utf-8");
}

// settings.json 읽기/쓰기
function readSettingsJson(): Record<string, string> {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")); }
  catch { return {}; }
}
function writeSettingsJson(data: Record<string, string>) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// 바 위치 저장/복원
function saveBarPosition(win: BrowserWindow) {
  const [x, y] = win.getPosition();
  const s = readSettingsJson();
  writeSettingsJson({ ...s, barX: String(x), barY: String(y) });
}

function createBarWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const barWidth = 600;

  const s = readSettingsJson();
  const x = s.barX ? Number(s.barX) : Math.floor((width - barWidth) / 2);
  const y = s.barY ? Number(s.barY) : height - 410;

  const win = new BrowserWindow({
    width: barWidth,
    height: 400,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, "../src/renderer/bar.html"));
  win.setIgnoreMouseEvents(false);

  // 드래그 후 위치 저장
  win.on("moved", () => saveBarPosition(win));

  return win;
}

function createMeetingWindow() {
  if (meetingWin && !meetingWin.isDestroyed()) {
    meetingWin.focus();
    return;
  }

  meetingWin = new BrowserWindow({
    width: 680,
    height: 640,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  meetingWin.loadFile(path.join(__dirname, "../src/renderer/meeting.html"));
  meetingWin.on("closed", () => { meetingWin = null; });
}

// 오늘의 다이제스트 위젯 창
function createDigestWindow() {
  if (digestWin && !digestWin.isDestroyed()) {
    digestWin.focus();
    return;
  }

  digestWin = new BrowserWindow({
    width: 400,
    height: 540,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  digestWin.loadFile(path.join(__dirname, "../src/renderer/digest.html"));
  digestWin.on("closed", () => { digestWin = null; });
}

// API 사용 비용 위젯 창
function createUsageWindow() {
  if (usageWin && !usageWin.isDestroyed()) {
    usageWin.focus();
    return;
  }

  usageWin = new BrowserWindow({
    width: 360,
    height: 440,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  usageWin.loadFile(path.join(__dirname, "../src/renderer/usage.html"));
  usageWin.on("closed", () => { usageWin = null; });
}

// 메뉴바 트레이 (랩탑 위젯)
function createTray() {
  const trayIcon = nativeImage.createFromPath(
    path.join(app.getAppPath(), "assets/icon/tray.png")
  );
  tray = new Tray(trayIcon);
  tray.setToolTip("AI Agents");

  const menu = Menu.buildFromTemplate([
    {
      label: "Show / Hide Bar",
      click: () => {
        if (!barWin || barWin.isDestroyed()) return;
        barWin.isVisible() ? barWin.hide() : barWin.show();
      },
    },
    { type: "separator" },
    {
      label: "📋 Run Daily Digest",
      click: async () => {
        if (digestRunning) return;
        digestRunning = true;
        try { await runDailyDigest(windows); }
        catch (err) { console.error("[digest] 트레이 실행 실패:", err); }
        finally { digestRunning = false; }
      },
    },
    { label: "📝 Today's Digest", click: () => createDigestWindow() },
    { label: "💰 API Usage", click: () => createUsageWindow() },
    { label: "💬 Meeting", click: () => createMeetingWindow() },
    { label: "⚙️ Settings", click: () => createSettingsWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 420,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  settingsWin.loadFile(path.join(__dirname, "../src/renderer/settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; });
}

app.whenReady().then(() => {
  // Allow microphone access from renderer windows
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media";
  });

  // 독 아이콘 (dev 실행에서도 적용)
  if (app.dock) {
    app.dock.setIcon(path.join(app.getAppPath(), "assets/icon/dock.png"));
  }

  barWin = createBarWindow();
  createTray();

  for (const agent of AGENTS) {
    windows.set(agent.id, barWin);
  }

  // startScheduler(windows); // 자동 브리핑 비활성화

  // 자동 아침 회의 → 데일리 다이제스트
  const digestTime = readSettingsJson()["schedule-digest"] ?? "09:00";
  scheduleDailyDigest(digestTime, windows);

  // 앱 시작 시 모든 에이전트 인사말 미리 캐싱 (호버 시 즉시 재생)
  for (const agent of AGENTS) {
    const a = new BaseAgent(agent);
    a.speak(agent.greeting)
      .then(path => { greetingCache.set(agent.id, path); console.log(`[greeting cached] ${agent.id}`); })
      .catch(err => console.error(`[greeting cache error] ${agent.id}:`, err));
  }
});

// 렌더러에서 수동 실행 요청
ipcMain.handle("trigger-agent", async (_event, agentId: string) => {
  const log = (msg: string) => {
    fs.appendFileSync("/tmp/agents-debug.log", msg + "\n");
    console.log(msg);
  };

  log(`[버튼 클릭] agentId: ${agentId}`);
  const agentConfig = AGENTS.find((a) => a.id === agentId);
  if (!agentConfig) {
    log(`[에러] 에이전트를 찾을 수 없음: ${agentId}`);
    return;
  }
  try {
    await triggerAgent(agentConfig, windows);
    log(`[완료] ${agentId} 브리핑 성공`);
  } catch (err) {
    log(`[에러] triggerAgent 실패: ${err}`);
  }
});

// 설정창 열기
ipcMain.handle("open-settings", () => {
  createSettingsWindow();
});

// 현재 설정 읽기 (env + settings.json 합쳐서)
ipcMain.handle("get-settings", () => {
  const env = parseEnv();
  const sj = readSettingsJson();
  // schedule-{agentId} 키는 settings.json에서 읽거나 기본값
  const schedules: Record<string, string> = {};
  for (const agent of AGENTS) {
    const key = `schedule-${agent.id}`;
    schedules[key] = sj[key] ?? agent.scheduleTime;
  }
  schedules["schedule-digest"] = sj["schedule-digest"] ?? "09:00";
  return { ...env, ...schedules };
});

// 설정 저장
ipcMain.handle("save-settings", (_event, data: Record<string, string>) => {
  // env 키
  const ENV_KEYS = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "NEWS_API_KEY", "VOICE_CAT", "VOICE_FOX", "VOICE_RABBIT", "USER_PROFILE"];
  const envUpdates: Record<string, string> = {};
  const sjUpdates: Record<string, string> = {};

  for (const [k, v] of Object.entries(data)) {
    if (ENV_KEYS.includes(k)) {
      if (v) envUpdates[k] = v;
    } else if (k.startsWith("schedule-")) {
      if (v) sjUpdates[k] = v;
    }
  }

  if (Object.keys(envUpdates).length > 0) writeEnv(envUpdates);

  const existing = readSettingsJson();
  writeSettingsJson({ ...existing, ...sjUpdates });

  // 스케줄 변경 적용
  for (const [k, v] of Object.entries(sjUpdates)) {
    const agentId = k.replace("schedule-", "");
    if (agentId === "digest") scheduleDailyDigest(v, windows);
    else rescheduleAgent(agentId, v, windows);
  }

  return { ok: true };
});

// 설정창 닫기
ipcMain.handle("close-settings", () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

// 앱 종료
ipcMain.handle("close-app", () => {
  app.quit();
});

// 데일리 다이제스트 수동 실행
ipcMain.handle("run-digest", async () => {
  if (digestRunning) return { ok: false, error: "already running" };
  digestRunning = true;
  try {
    const filePath = await runDailyDigest(windows);
    return { ok: true, path: filePath };
  } catch (err) {
    console.error("[digest] 수동 실행 실패:", err);
    return { ok: false, error: String(err) };
  } finally {
    digestRunning = false;
  }
});

// 가장 최근 다이제스트 내용 반환 (위젯용)
ipcMain.handle("get-latest-digest", () => {
  const dir = path.join(baseDir(), "digests");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) return null;
  const name = files[0].f;
  return { name, content: fs.readFileSync(path.join(dir, name), "utf-8") };
});

// 다이제스트 위젯 닫기
ipcMain.handle("close-digest", () => {
  if (digestWin && !digestWin.isDestroyed()) digestWin.close();
});

// API 사용량/비용 조회 (위젯용)
ipcMain.handle("get-usage", () => getUsageSummary());

// 사용량 위젯 닫기
ipcMain.handle("close-usage", () => {
  if (usageWin && !usageWin.isDestroyed()) usageWin.close();
});

// 미팅창 열기 (3-agent 그룹 미팅)
ipcMain.handle("open-meeting", () => {
  createMeetingWindow();
});

// 전체 에이전트 목록 반환
ipcMain.handle("get-agents", () =>
  AGENTS.map((a) => ({
    id:          a.id,
    name:        a.name,
    description: a.description,
    imageIdle:   a.imageIdle,
    greeting:    a.greeting,
  }))
);

// 미팅 메시지: 특정 에이전트에게 질문 → { text, audioPath }
// 히스토리는 메인 프로세스가 memory/conversations.json에 영속 관리한다.
ipcMain.handle("meeting-message", async (_event, agentId: string, text: string) => {
  const agentConfig = AGENTS.find((a) => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent not found: ${agentId}`);
  appendMessage(agentId, "user", text);
  const agent = new BaseAgent(agentConfig);
  // Bunny에게는 data/ 폴더의 최신 CSV 요약을 근거 데이터로 제공
  const contextNote =
    agentId === "rabbit_budget_analyst" ? summarizeLatestCsv() ?? undefined : undefined;
  const result = await agent.runMeeting(getContext(agentId), contextNote);
  if (result.text) appendMessage(agentId, "assistant", result.text);
  return result;
});

// 음성 → Whisper STT
ipcMain.handle("transcribe-audio", async (_event, base64: string) => {
  const buffer = Buffer.from(base64, "base64");
  return transcribeAudio(buffer);
});

// 미팅창 닫기
ipcMain.handle("close-meeting", () => {
  if (meetingWin && !meetingWin.isDestroyed()) meetingWin.close();
});

// 에이전트 인사 TTS (최초 1회 생성 후 캐싱)
ipcMain.handle("greet-agent", async (_event, agentId: string) => {
  if (greetingCache.has(agentId)) return greetingCache.get(agentId);
  const agentConfig = AGENTS.find((a) => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent not found: ${agentId}`);
  const agent = new BaseAgent(agentConfig);
  const audioPath = await agent.speak(agentConfig.greeting);
  greetingCache.set(agentId, audioPath);
  return audioPath;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
