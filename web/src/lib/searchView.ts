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

export const PERSON_CATEGORY_FILTERS = [
  { key: "all", label: "全部人物" },
  { key: "voice_actor", label: "声优" },
  { key: "illustration", label: "画师/插画" },
  { key: "manga", label: "漫画家" },
  { key: "writing", label: "脚本/作者" },
  { key: "performer", label: "演员/表演" },
  { key: "production", label: "制作/企划" },
  { key: "company", label: "公司/机构" },
  { key: "group", label: "组合/团体" },
  { key: "other", label: "其他人物" }
];

const PERSON_CATEGORY_LABELS = new Map(PERSON_CATEGORY_FILTERS.map((item) => [item.key, item.label]));

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

export function isVoiceActorPerson(person: Record<string, any> | null | undefined) {
  const category = compactText(person?.personCategory);
  const careers = arrayOf<string>(person?.career).map((career) => compactText(career).toLocaleLowerCase("en-US"));
  return category === "voice_actor" || careers.includes("seiyu");
}

export function personCategoryLabel(person: Record<string, any> | null | undefined) {
  const explicit = compactText(person?.personCategoryLabel);
  if (explicit) return explicit;
  const key = compactText(person?.personCategory, "other");
  return PERSON_CATEGORY_LABELS.get(key) ?? PERSON_CATEGORY_LABELS.get("other") ?? "其他人物";
}

function aliasKey(value: string) {
  return compactText(value).normalize("NFKC").toLocaleLowerCase("ja-JP");
}

export function prioritizeSearchAliases(primaryKeyword: unknown, aliases: unknown[] = [], limit = 80) {
  const values = [primaryKeyword, ...aliases];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const alias = compactText(value);
    const key = aliasKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
    if (result.length >= limit) break;
  }

  return result;
}

export function defaultSearchAliases(
  person: Record<string, any> | null | undefined,
  limit: number,
  primaryKeyword = "",
  mode: "smart" | "all" | "penNames" = "smart"
) {
  const values = aliasValues(person ?? {});
  const penNames = arrayOf<Record<string, any>>(person?.aliases)
    .filter((alias) => alias.isPenName)
    .map((alias) => compactText(alias.value));
  const canUsePenNames = isVoiceActorPerson(person) && (mode === "penNames" || mode === "smart");
  const selected = canUsePenNames && penNames.length ? penNames : values;
  return prioritizeSearchAliases(primaryKeyword, selected.slice(0, Math.max(1, limit)));
}
