import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";

const workbook = XLSX.readFile("list.xlsx");
const sheet = workbook.Sheets[workbook.SheetNames[0]];
// Parse as raw arrays; row 0 is title, row 1 is headers, rows 2+ are data
const raw = XLSX.utils.sheet_to_json<(string | number)[][]>(sheet, { header: 1 });

const headerRow = raw[1] as string[];
const nameCol = headerRow.indexOf("竞赛名称");
const noteCol = headerRow.indexOf("备注");

const competitions = raw
  .slice(2) // skip title and header rows
  .filter((row) => row[0] && row[nameCol])
  .map((row, i) => ({
    id: i + 1,
    name: String(row[nameCol]).trim(),
    note: String(row[noteCol] || "").trim(),
  }));

const outDir = "data";
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, "competitions.json"),
  JSON.stringify(competitions, null, 2),
  "utf-8",
);

console.log(`Compiled ${competitions.length} competitions to data/competitions.json`);
