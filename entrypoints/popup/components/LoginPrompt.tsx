interface LoginPromptProps {
  onRetry: () => void;
}

export default function LoginPrompt({ onRetry }: LoginPromptProps) {
  const handleLogin = () => {
    chrome.tabs.create({ url: "https://www1.szu.edu.cn/" });
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-3">🔐</div>
      <h2 className="text-base font-semibold text-gray-900 mb-1">登录已过期</h2>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        请先在浏览器中登录
        <br />
        www1.szu.edu.cn
        <br />
        确保可以正常访问公文通
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleLogin}
          className="px-4 py-2 text-xs font-medium rounded-md bg-szu-red text-white hover:bg-red-900 transition-colors"
        >
          打开公文通登录
        </button>
        <button
          onClick={onRetry}
          className="px-4 py-2 text-xs font-medium rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          重试
        </button>
      </div>
    </div>
  );
}
