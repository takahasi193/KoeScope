export type MobileNavKey = "search" | "person" | "monitor" | "activities";

export type MobileNavItem = {
  key: MobileNavKey;
  label: string;
  href: string;
};

export const mobileNavItems: MobileNavItem[] = [
  { key: "search", label: "搜索", href: "/" },
  { key: "person", label: "人物", href: "/person.html" },
  { key: "monitor", label: "Monitor", href: "/dashboard.html" },
  { key: "activities", label: "活动", href: "/activities.html" }
];

export function resolveMobileNavKey(pathname = "/"): MobileNavKey {
  const cleanPath = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  if (cleanPath === "/activities" || cleanPath === "/activities.html") return "activities";
  if (cleanPath === "/dashboard" || cleanPath === "/dashboard.html") return "monitor";
  if (cleanPath === "/person" || cleanPath === "/person.html") return "person";
  return "search";
}
