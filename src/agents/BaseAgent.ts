import { AgentConfig } from "../config";
import { generateBriefing, generateMeetingResponse } from "../services/openai";
import { textToSpeech } from "../services/elevenlabs";
import { fetchNews } from "../services/news";
import { fetchComplaints } from "../services/findComplain";
import { baseDir } from "../paths";
import path from "path";

export class BaseAgent {
  constructor(public config: AgentConfig) {}

  // 뉴스 기반 브리핑 실행
  async runBriefing(): Promise<{ text: string; audioPath: string }> {
    console.log(`[${this.config.name}] 브리핑 시작...`);

    // Foxy는 find_complain(Reddit 불만 분석) 실데이터 우선, 없으면 뉴스 폴백
    const complaints =
      this.config.id === "fox_news_anchor" ? await fetchComplaints() : null;
    const news = complaints ?? (await fetchNews(this.config.keywords));
    const text = await generateBriefing(this.config.systemPrompt, news);
    const audioPath = await this.speak(text);

    return { text, audioPath };
  }

  // 미팅 메시지 응답 (contextNote: 도구가 제공하는 근거 데이터, 시스템 프롬프트에 덧붙임)
  async runMeeting(
    history: { role: "user" | "assistant"; content: string }[],
    contextNote?: string
  ): Promise<{ text: string; audioPath: string }> {
    const systemPrompt = contextNote
      ? `${this.config.systemPrompt}\n\n[Tool data — use these real numbers when relevant]\n${contextNote}`
      : this.config.systemPrompt;
    const text = await generateMeetingResponse(systemPrompt, history);
    const audioPath = await this.speak(text);
    return { text, audioPath };
  }

  // 텍스트를 음성으로 변환
  async speak(text: string): Promise<string> {
    const outputPath = path.join(
      baseDir(),
      "assets/audio",
      `${this.config.id}_${Date.now()}.mp3`
    );
    return textToSpeech(text, this.config.voiceId, outputPath);
  }
}
