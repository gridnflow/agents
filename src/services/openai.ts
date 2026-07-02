import OpenAI from "openai";
import { ENV } from "../config";
import fs from "fs";
import os from "os";
import path from "path";

const client = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

export async function transcribeAudio(buffer: Buffer): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `whisper_${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      language: "en",
    });
    return transcription.text;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

export async function generateMeetingResponse(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
    ],
    max_tokens: 120,
  });
  return response.choices[0].message.content ?? "";
}

export async function summarizeDigest(transcript: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          `You summarize a short standup between AI agents (Foxy: problem hunter, Kitty: idea planner, Bunny: budget analyst) ` +
          `into an English markdown digest for their boss. ` +
          `Use exactly these sections: "### Today's Problem", "### Proposed Idea", "### Estimated Cost", "### Action Items" (2-3 bullets). ` +
          `Be concrete and concise. English only.`,
      },
      { role: "user", content: transcript },
    ],
    max_tokens: 500,
  });
  return response.choices[0].message.content ?? "";
}

export async function generateBriefing(
  systemPrompt: string,
  newsContent: string
): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: newsContent },
    ],
    max_tokens: 80,
  });

  return response.choices[0].message.content ?? "";
}
