export type DayGroup<T> = {
  dateKey: string; // local YYYY-MM-DD, used as the React key
  label: string;
  items: T[];
};

function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function label(ms: number, now: number): string {
  const today = dateKey(now);
  const key = dateKey(ms);
  if (key === today) return "Today";
  const yesterday = dateKey(now - 24 * 60 * 60 * 1000);
  if (key === yesterday) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

// Groups already-chronologically-sorted items into day buckets, oldest
// group first — the timeline renders newest at the bottom (THI-17 acceptance
// criteria), so groups and the items within them both stay in ascending
// createdAt order.
export function groupByDay<T>(items: T[], getCreatedAt: (item: T) => number, now: number): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const createdAt = getCreatedAt(item);
    const key = dateKey(createdAt);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === key) {
      last.items.push(item);
    } else {
      groups.push({ dateKey: key, label: label(createdAt, now), items: [item] });
    }
  }
  return groups;
}
