interface SubscriptionSelectorProps {
  selected: string[];
  onSave: (subscriptions: string[]) => void;
}

const SECTIONS = ["学生事务", "荔园生活", "教师事务", "网上服务"];

export default function SubscriptionSelector({ selected, onSave }: SubscriptionSelectorProps) {
  const toggle = (section: string) => {
    const updated = selected.includes(section)
      ? selected.filter((s) => s !== section)
      : [...selected, section];
    onSave(updated);
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">订阅板块</h2>
      <p className="text-xs text-gray-500 mb-3">选择要抓取的公文通板块</p>
      <div className="space-y-1.5">
        {SECTIONS.map((section) => (
          <label key={section} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(section)}
              onChange={() => toggle(section)}
              className="w-4 h-4 rounded accent-szu-red"
            />
            <span className="text-sm text-gray-700">{section}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
