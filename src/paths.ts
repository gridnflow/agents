import path from "path";
import fs from "fs";

// 쓰기 가능한 데이터 경로의 단일 진실 공급원.
// dev: 프로젝트 루트 / 패키징(asar): userData — asar 내부는 읽기 전용이므로.
// Electron 없이(plain node, headless 테스트) 실행돼도 동작한다.

function electronApp(): any | null {
  try {
    const { app } = require("electron");
    return app ?? null;
  } catch {
    return null;
  }
}

export function baseDir(): string {
  const app = electronApp();
  if (app?.isPackaged) return app.getPath("userData");
  if (app?.getAppPath) return app.getAppPath();
  return process.cwd();
}

// baseDir 하위 폴더 경로를 만들고(없으면 생성) 반환
export function dataPath(...sub: string[]): string {
  const p = path.join(baseDir(), ...sub);
  const dir = sub[sub.length - 1]?.includes(".") ? path.dirname(p) : p;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return p;
}
