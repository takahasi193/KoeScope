import { arrayOf, compactText } from "@/lib/format";

export const TYPE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "voice", label: "ASMR/音声" },
  { key: "game", label: "游戏" },
  { key: "manga", label: "漫画" },
  { key: "other", label: "其他" }
];

export const AGE_FILTERS = [
  { key: "all", label: "全部年龄" },
  { key: "general", label: "全年龄" },
  { key: "r15", label: "R15" },
  { key: "r18", label: "R18" },
  { key: "unknown", label: "未知" }
];

export function matchesWorkFilter(item: Record<string, any>, type: string, age: string) {
  const itemType = compactText(item.type || item.category || "other");
  const itemAge = compactText(item.ageCategory || item.age || "unknown");
  const typeOk = type === "all" || itemType === type || (type === "other" && !["voice", "game", "manga"].includes(itemType));
  const ageOk = age === "all" || itemAge === age;
  return typeOk && ageOk;
}

export function countBy(items: Record<string, any>[], keyOf: (item: Record<string, any>) => string, fallback = "unknown") {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = compactText(keyOf(item), fallback);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function aliasValues(person: Record<string, any>) {
  return arrayOf<Record<string, any>>(person.aliases)
    .map((alias) => compactText(alias.value ?? alias.name ?? alias))
    .filter(Boolean);
}
