import type { Competition } from "../types";
import competitionsData from "../../data/competitions.json";

export function getCompetitions(): Competition[] {
  return competitionsData as Competition[];
}

export function matchCompetition(title: string, summary: string): string | null {
  const competitions = getCompetitions();
  const text = `${title} ${summary}`;

  for (const comp of competitions) {
    // Try exact match first
    if (text.includes(comp.name)) return comp.name;

    // Try matching core name (remove prefixes/suffixes in brackets)
    const coreName = comp.name.replace(/[（(].+?[）)]/g, "").replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "").trim();
    if (coreName.length > 4 && text.includes(coreName)) return comp.name;

    // Try matching without common suffixes
    const shortName = coreName.replace(/(?:大赛|竞赛|赛|比赛)$/, "").trim();
    if (shortName.length > 4 && text.includes(shortName)) return comp.name;
  }

  return null;
}
