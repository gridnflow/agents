import axios from "axios";
import { ENV } from "../config";

interface Article {
  title: string;
  description: string;
}

export async function fetchNews(keywords: string[]): Promise<string> {
  const query = keywords.join(" OR ");

  const { data } = await axios.get("https://newsapi.org/v2/everything", {
    params: {
      q: query,
      language: "en",
      sortBy: "publishedAt",
      pageSize: 5,
      apiKey: ENV.NEWS_API_KEY,
    },
  });

  const articles: Article[] = data.articles ?? [];

  if (articles.length === 0) return "No relevant news today.";

  return articles
    .map((a, i) => `${i + 1}. ${a.title}\n   ${a.description ?? ""}`)
    .join("\n\n");
}
