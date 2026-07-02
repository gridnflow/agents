import axios from "axios";

// find_complain 백엔드 (Reddit 불만 수집·분석, Spring Boot) 연동
// 꺼져 있으면 null을 반환하고 호출부가 NewsAPI로 폴백한다.

const BASE = process.env.FIND_COMPLAIN_URL ?? "http://localhost:8080";

interface AppIdea {
  subreddit?: string;
  originalTitle?: string;
  problemSummary?: string;
  proposedSolution?: string;
  viabilityScore?: number;
  score?: number;
}

export async function fetchComplaints(): Promise<string | null> {
  try {
    const { data } = await axios.get<AppIdea[]>(`${BASE}/api/app-ideas/top`, {
      timeout: 3000,
    });
    if (!Array.isArray(data) || data.length === 0) return null;

    const lines = data.slice(0, 5).map((idea, i) => {
      const head = `${i + 1}. [r/${idea.subreddit ?? "?"}] ${idea.problemSummary ?? idea.originalTitle ?? ""}`;
      const extra = [
        idea.proposedSolution ? `   Possible angle: ${idea.proposedSolution}` : "",
        idea.viabilityScore ? `   Viability: ${idea.viabilityScore}/10` : "",
      ].filter(Boolean);
      return [head, ...extra].join("\n");
    });

    return `Real complaints mined from Reddit (find_complain):\n${lines.join("\n\n")}`;
  } catch {
    return null; // 백엔드 미실행 → 호출부에서 NewsAPI 폴백
  }
}
