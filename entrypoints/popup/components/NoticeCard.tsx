import { useState, useRef } from "react";
import type { Article } from "../../../modules/types";
import ContextMenu from "./ContextMenu";

type PersonalMatch = "relevant" | "irrelevant" | "neutral";

interface NoticeCardProps {
  article: Article;
  expanded: boolean;
  personalMatch?: PersonalMatch;
  onToggleExpand: (id: string) => void;
  onReclassify?: (article: Article) => void;
  onRefresh: () => void;
}

export default function NoticeCard({ article, expanded, personalMatch, onToggleExpand, onReclassify, onRefresh }: NoticeCardProps) {
  const [favorite, setFavorite] = useState(article.favorite);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasLongPress = useRef(false);

  const startPress = (clientX: number, clientY: number) => {
    wasLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      wasLongPress.current = true;
      setMenuPos({ x: clientX, y: clientY });
      setShowMenu(true);
    }, 500);
  };

  const endPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    startPress(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) startPress(touch.clientX, touch.clientY);
  };

  const handleCardClick = () => {
    endPress();
    if (wasLongPress.current) {
      wasLongPress.current = false;
      return;
    }
    onToggleExpand(article.id);
  };

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newFav = !favorite;
    setFavorite(newFav);
    await chrome.runtime.sendMessage({ type: "notice:favorite", id: article.id, favorite: newFav });
    onRefresh();
  };

  const handleOpenLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    chrome.tabs.create({ url: article.url });
  };

  const handleDelete = async () => {
    await chrome.runtime.sendMessage({ type: "notice:delete", id: article.id });
    setShowMenu(false);
    onRefresh();
  };

  const handleReclassifyAction = () => {
    onReclassify?.(article);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const isRelevant = personalMatch === "relevant";

  const cardClass = [
    "border rounded-lg bg-white hover:shadow-sm transition-shadow cursor-pointer",
    isRelevant ? "border-yellow-400 bg-yellow-50" : "border-card-border",
  ].join(" ");

  return (
    <>
      <div
        className={cardClass}
        onClick={handleCardClick}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onMouseUp={endPress}
        onTouchEnd={endPress}
        onMouseLeave={endPress}
      >
        {/* Collapsed view */}
        <div className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {isRelevant && (
                  <span className="shrink-0 text-[10px] text-yellow-700 bg-yellow-200 px-1 py-0 rounded">相关</span>
                )}
                <h3 className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
                  {article.title}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {article.publishDate && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {formatDate(article.publishDate)}
                  </span>
                )}
                {article.location && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {article.location}
                  </span>
                )}
                <span className="text-[10px] text-gray-400">{article.section}</span>
                {article.competitionMatch && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-szu-gold bg-yellow-50 px-1.5 py-0.5 rounded font-medium">
                    {article.competitionMatch}
                  </span>
                )}
                {article.llmClassified && (
                  <span className="text-[10px] text-accent-blue bg-blue-50 px-1 py-0.5 rounded">AI分类</span>
                )}
              </div>
            </div>
            <button
              onClick={handleFavorite}
              className={`shrink-0 text-base transition-colors ${favorite ? "text-szu-gold" : "text-gray-300 hover:text-szu-gold"}`}
              title={favorite ? "取消收藏" : "收藏"}
            >
              {favorite ? "★" : "☆"}
            </button>
          </div>
        </div>

        {/* Expanded view */}
        {expanded && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100">
            <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
              {article.summary.substring(0, 300)}
              {article.summary.length > 300 && "..."}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
              发布单位：{article.publisher}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleOpenLink}
                className="text-xs text-accent-blue hover:underline"
              >
                查看原文 →
              </button>
            </div>
          </div>
        )}
      </div>

      {showMenu && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onDelete={handleDelete}
          onReclassify={onReclassify ? handleReclassifyAction : undefined}
          onClose={() => setShowMenu(false)}
        />
      )}
    </>
  );
}
