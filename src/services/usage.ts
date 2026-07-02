import fs from "fs";
import path from "path";
import { baseDir } from "../paths";

// API 사용량 기록 + 예상 비용 계산 — usage.json에 일 단위로 누적
// 단가는 docs/COSTS.md 기준 (2026-07). 변경 시 PRICES만 수정.

const PRICES = {
  gptInPerMTok: 2.5,        // gpt-4o 입력, $/1M tokens
  gptOutPerMTok: 10.0,      // gpt-4o 출력, $/1M tokens
  whisperPerMin: 0.006,     // whisper-1, $/분
  ttsPerChar: 5 / 30000,    // ElevenLabs Starter($5/30,000크레딧) 환산, $/글자
};

export interface DayUsage {
  gptIn: number;      // 토큰
  gptOut: number;     // 토큰
  whisperSec: number; // 초
  ttsChars: number;   // 글자(=크레딧)
}

const EMPTY: DayUsage = { gptIn: 0, gptOut: 0, whisperSec: 0, ttsChars: 0 };

function filePath(): string {
  return path.join(baseDir(), "memory", "usage.json");
}

let cache: Record<string, DayUsage> | null = null;

function load(): Record<string, DayUsage> {
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function bump(patch: Partial<DayUsage>) {
  const db = load();
  const day = (db[today()] ??= { ...EMPTY });
  for (const [k, v] of Object.entries(patch)) {
    (day as any)[k] += v as number;
  }
  save();
}

export function recordGpt(inTokens: number, outTokens: number) {
  bump({ gptIn: inTokens, gptOut: outTokens });
}

export function recordWhisper(seconds: number) {
  bump({ whisperSec: seconds });
}

export function recordTts(chars: number) {
  bump({ ttsChars: chars });
}

export function costOf(u: DayUsage) {
  const gpt =
    (u.gptIn / 1_000_000) * PRICES.gptInPerMTok +
    (u.gptOut / 1_000_000) * PRICES.gptOutPerMTok;
  const whisper = (u.whisperSec / 60) * PRICES.whisperPerMin;
  const tts = u.ttsChars * PRICES.ttsPerChar;
  return { gpt, whisper, tts, total: gpt + whisper + tts };
}

// 오늘 / 이번 달 집계 (위젯용)
export function getUsageSummary() {
  const db = load();
  const t = today();
  const month = t.slice(0, 7);

  const sum = (days: DayUsage[]): DayUsage =>
    days.reduce(
      (acc, d) => ({
        gptIn: acc.gptIn + d.gptIn,
        gptOut: acc.gptOut + d.gptOut,
        whisperSec: acc.whisperSec + d.whisperSec,
        ttsChars: acc.ttsChars + d.ttsChars,
      }),
      { ...EMPTY }
    );

  const todayUsage = db[t] ?? { ...EMPTY };
  const monthUsage = sum(
    Object.entries(db)
      .filter(([date]) => date.startsWith(month))
      .map(([, u]) => u)
  );

  return {
    today: { usage: todayUsage, cost: costOf(todayUsage) },
    month: { usage: monthUsage, cost: costOf(monthUsage) },
  };
}
