import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { ENV } from "../config";
import { recordTts } from "./usage";
import fs from "fs";
import path from "path";

const client = new ElevenLabsClient({ apiKey: ENV.ELEVENLABS_API_KEY });

export async function textToSpeech(
  text: string,
  voiceId: string,
  outputPath: string
): Promise<string> {
  const audio = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
  });

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const chunks: Buffer[] = [];
  for await (const chunk of audio) {
    chunks.push(Buffer.from(chunk));
  }

  fs.writeFileSync(outputPath, Buffer.concat(chunks));
  recordTts(text.length); // 1글자 = 1크레딧 (multilingual v2)
  return outputPath;
}
