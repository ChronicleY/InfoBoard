import competitions from "../../data/competitions.json";
import type { Competition } from "../types";

const list = competitions as Competition[];

export function matchCompetition(title: string, summary: string): string | null {
  const text = `${title} ${summary}`;
  for (const competition of list) {
    const name = competition.name.trim();
    if (!name) continue;
    if (text.includes(name)) return name;
  }
  return null;
}
