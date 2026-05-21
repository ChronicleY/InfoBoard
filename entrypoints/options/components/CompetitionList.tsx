import { useState, useEffect } from "react";
import type { Competition } from "../../../modules/types";
import competitionsData from "../../../data/competitions.json";

export default function CompetitionList() {
  const [competitions] = useState<Competition[]>(competitionsData as Competition[]);
  const [search, setSearch] = useState("");

  const filtered = search
    ? competitions.filter((c) => c.name.includes(search) || c.note.includes(search))
    : competitions;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">竞赛目录</h2>
      <p className="text-xs text-gray-500 mb-3">
        《全国普通高校大学生竞赛分析报告》竞赛目录（共 {competitions.length} 项），用于匹配"比赛"类公文。
      </p>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索竞赛..."
        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg mb-3 focus:outline-none focus:ring-1 focus:ring-accent-blue"
      />
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-gray-500">
              <th className="py-1.5 px-2 font-medium w-12">序号</th>
              <th className="py-1.5 px-2 font-medium">竞赛名称</th>
              <th className="py-1.5 px-2 font-medium w-24">备注</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((comp) => (
              <tr key={comp.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="py-1.5 px-2 text-gray-400">{comp.id}</td>
                <td className="py-1.5 px-2 text-gray-800">{comp.name}</td>
                <td className="py-1.5 px-2 text-gray-400">{comp.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
