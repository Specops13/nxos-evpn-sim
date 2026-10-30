export function platformKey(filename: string): string | null;
export function buildLatestJson(input: {
  version: string;
  notes: string;
  pubDate: string;
  repo: string;
  signatures: { name: string; signature: string }[];
}): {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
} | null;
