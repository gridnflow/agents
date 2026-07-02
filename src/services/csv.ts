import fs from "fs";
import path from "path";
import { baseDir } from "../paths";

// Bunny의 CSV 분석 도구 — data/ 폴더의 최신 CSV를 요약해 프롬프트 컨텍스트로 제공

const MAX_SAMPLE_ROWS = 5;
const MAX_OUTPUT_CHARS = 1500;

// 따옴표 안의 쉼표를 처리하는 최소 CSV 라인 파서
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function summarizeLatestCsv(): string | null {
  const dir = path.join(baseDir(), "data");
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) return null;

  const name = files[0].f;
  const lines = fs
    .readFileSync(path.join(dir, name), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return null;

  const header = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);

  // 숫자 컬럼 통계 (₩1,000 / $5.99 같은 통화 표기 허용, 날짜 등은 제외)
  const NUMERIC = /^[\s$₩€£]*-?[\d,]+(\.\d+)?\s*%?$/;
  const stats: string[] = [];
  header.forEach((col, idx) => {
    const nums = rows
      .filter((r) => NUMERIC.test(r[idx] ?? ""))
      .map((r) => parseFloat((r[idx] ?? "").replace(/[^0-9.-]/g, "")))
      .filter((n) => !isNaN(n));
    if (nums.length >= rows.length * 0.8 && nums.length > 0) {
      const sum = nums.reduce((a, b) => a + b, 0);
      stats.push(
        `- ${col}: total ${round(sum)}, avg ${round(sum / nums.length)}, ` +
          `min ${round(Math.min(...nums))}, max ${round(Math.max(...nums))}`
      );
    }
  });

  const sample = rows
    .slice(0, MAX_SAMPLE_ROWS)
    .map((r) => `  ${r.join(" | ")}`)
    .join("\n");

  const out =
    `Budget data loaded from "${name}" (${rows.length} rows).\n` +
    `Columns: ${header.join(", ")}\n` +
    (stats.length ? `Numeric column stats:\n${stats.join("\n")}\n` : "") +
    `First rows:\n${sample}`;

  return out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS) + "…" : out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
