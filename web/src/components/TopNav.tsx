"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip, Link } from "@heroui/react";
import { ThemeToggle } from "@/components/ThemeProvider";

type TemplateKey = "search" | "monitor";

const TEMPLATE_TRANSITION_KEY = "koescope-template-transition";

function readTemplate(pathname: string): TemplateKey {
  return pathname.includes("dashboard") || pathname.includes("activities") ? "monitor" : "search";
}

function targetHref(template: TemplateKey) {
  return template === "monitor" ? "/dashboard" : "/";
}

function TemplateSwitcher({ initial }: { initial: TemplateKey }) {
  const router = useRouter();
  const [active, setActive] = useState<TemplateKey>(initial);

  useEffect(() => {
    setActive(readTemplate(window.location.pathname));
    router.prefetch("/");
    router.prefetch("/dashboard");
    const shouldEnter = window.sessionStorage.getItem(TEMPLATE_TRANSITION_KEY);
    if (!shouldEnter) return;
    window.sessionStorage.removeItem(TEMPLATE_TRANSITION_KEY);
    document.documentElement.dataset.pageTransition = "slide-in-right";
    const timeout = window.setTimeout(() => {
      delete document.documentElement.dataset.pageTransition;
    }, 430);
    return () => window.clearTimeout(timeout);
  }, []);

  function switchTemplate(nextTemplate: TemplateKey) {
    if (nextTemplate === active) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setActive(nextTemplate);
    window.sessionStorage.setItem(TEMPLATE_TRANSITION_KEY, "1");
    if (reduceMotion) {
      router.push(targetHref(nextTemplate));
      return;
    }
    document.documentElement.dataset.pageTransition = "slide-out-left";
    window.setTimeout(() => {
      router.push(targetHref(nextTemplate));
    }, 240);
  }

  return (
    <div className="template-switcher" data-active={active} role="group" aria-label="模板切换">
      <button type="button" aria-pressed={active === "search"} onClick={() => switchTemplate("search")}>
        搜索
      </button>
      <button type="button" aria-pressed={active === "monitor"} onClick={() => switchTemplate("monitor")}>
        Monitor
      </button>
    </div>
  );
}

export function SearchTopNav({ status = "连接中" }: { status?: string }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">KoeScope</p>
        <h1>声优作品搜索</h1>
      </div>
      <nav className="top-actions" aria-label="页面操作">
        <Link className="top-link ks-nav-link" href="/person.html">
          声优详情
        </Link>
        <TemplateSwitcher initial="search" />
        <ThemeToggle />
        <Chip className="status-pill ks-status-chip">{status}</Chip>
      </nav>
    </header>
  );
}

export function MonitorTopNav({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="monitor-topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <nav className="top-actions" aria-label="页面操作">
        {children}
        <TemplateSwitcher initial="monitor" />
        <ThemeToggle />
      </nav>
    </header>
  );
}
