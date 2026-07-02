import fs from "fs";
import path from "path";
import { baseDir } from "./paths";

// 에이전트별 대화 기억 영속화 — memory/conversations.json
// 히스토리 소유권은 메인 프로세스에 있고, 렌더러는 새 메시지 텍스트만 보낸다.

export interface Msg {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

const MAX_STORED = 60;      // 파일에 보관할 에이전트당 최대 메시지 수
export const CONTEXT_WINDOW = 20; // LLM에 보낼 최근 메시지 수 (토큰 절약)

function filePath(): string {
  return path.join(baseDir(), "memory", "conversations.json");
}

let cache: Record<string, Msg[]> | null = null;

function load(): Record<string, Msg[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(filePath(), "utf-8"));
  } catch {
    cache = {};
  }
  return cache!;
}

function save() {
  const file = filePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), "utf-8");
}

export function appendMessage(
  agentId: string,
  role: "user" | "assistant",
  content: string
) {
  const db = load();
  (db[agentId] ??= []).push({ role, content, ts: Date.now() });
  if (db[agentId].length > MAX_STORED) db[agentId] = db[agentId].slice(-MAX_STORED);
  save();
}

// LLM 요청용 최근 컨텍스트 (role/content만)
export function getContext(
  agentId: string
): { role: "user" | "assistant"; content: string }[] {
  const db = load();
  return (db[agentId] ?? [])
    .slice(-CONTEXT_WINDOW)
    .map(({ role, content }) => ({ role, content }));
}
