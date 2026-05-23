import { useEffect, useRef } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  onDelete: () => void;
  onReclassify?: () => void;
  onClose: () => void;
}

export default function ContextMenu({ x, y, onDelete, onReclassify, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the same mousedown that opened the menu from closing it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // Clamp position within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 120),
    top: Math.min(y, window.innerHeight - 80),
    zIndex: 100,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[100px]"
    >
      {onReclassify && (
        <button
          onClick={() => { onReclassify(); onClose(); }}
          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 transition-colors"
        >
          重新分类
        </button>
      )}
      <button
        onClick={() => { onDelete(); onClose(); }}
        className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
      >
        删除
      </button>
    </div>
  );
}
