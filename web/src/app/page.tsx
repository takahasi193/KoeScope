"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import { SearchTopNav } from "@/components/TopNav";
import { getJson, sendJson, wait } from "@/lib/api";
import { arrayOf, compactText, formatNumber, formatPrice, imageOf, workTitle } from "@/lib/format";
import {
  AGE_FILTERS,
  PERSON_CATEGORY_FILTERS,
  TYPE_FILTERS,
  aliasValues,
  countBy,
  defaultSearchAliases,
  isVoiceActorPerson,
  matchesWorkFilter,
  personCategoryLabel,
  prioritizeSearchAliases
} from "@/lib/searchView";

type Person = Record<string, any>;
type WorkItem = Record<string, any>;

const orderOptions = [
  { key: "dl_d", label: "贩卖数" },
  { key: "release_d", label: "最新" }
];

function selectedAliases(primaryKeyword: string, selected: Set<string>) {
  return prioritizeSearchAliases(primaryKeyword, [...selected]);
}

function defaultAliasSelection(person: Person | null, limit: number, primaryKeyword = "") {
  return new Set(defaultSearchAliases(person, limit, primaryKeyword));
}

function ResultCard({ item, onWatch }: { item: WorkItem; onWatch: (item: WorkItem) => void }) {
  const image = imageOf(item);
  return (
    <article className="result-card">
      <div className="result-media">
        {image ? <img className="result-image" src={image} alt="" /> : <div className="result-image placeholder" />}
      </div>
      <div className="result-body">
        <div className="result-title-line">
          <a className="result-title" href={item.url} target="_blank" rel="noreferrer">
            {workTitle(item)}
          </a>
          <span className="badge">{compactText(item.productId)}</span>
        </div>
        <div className="next-kv">
          <span>{compactText(item.circle, "Circle 未同步")}</span>
          <span>{compactText(item.typeLabel || item.type, "分类未知")}</span>
          <span>{compactText(item.ageLabel || item.ageCategory, "年龄未知")}</span>
          <span>{formatPrice(item.priceJpy)}</span>
          <span>销量 {formatNumber(item.sales, "-")}</span>
        </div>
        <p className="result-meta">
          匹配别名：{arrayOf(item.matchedAliases).join(" / ") || "未记录"}；来源页：
          {arrayOf(item.matchedPages).length || 0}
        </p>
        <div className="next-card-actions">
          <a className="result-open" href={item.url} target="_blank" rel="noreferrer">
            打开
          </a>
          <button className="mini-action result-watch" type="button" onClick={() => onWatch(item)}>
            加入关注
          </button>
        </div>
      </div>
    </article>
  );
}

export default function SearchPage() {
  const [serverStatus, setServerStatus] = useState("连接中");
  const [keyword, setKeyword] = useState("");
  const [personCategory, setPersonCategory] = useState("all");
  const [persons, setPersons] = useState<Person[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxAliases, setMaxAliases] = useState(12);
  const [maxPages, setMaxPages] = useState(50);
  const [perPage, setPerPage] = useState(100);
  const [scope, setScope] = useState("all");
  const [verifyDetails, setVerifyDetails] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(true);
  const [order, setOrder] = useState("dl_d");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");
  const [payload, setPayload] = useState<Record<string, any> | null>(null);
  const [busyAction, setBusyAction] = useState<"resolve" | "search" | null>(null);
  const [toast, setToast] = useState("");
  const pollingToken = useRef(0);

  const aliases = useMemo(() => prioritizeSearchAliases(keyword, person ? aliasValues(person) : []), [keyword, person]);
  const selectedPersonIsVoiceActor = isVoiceActorPerson(person);
  const allItems = arrayOf<WorkItem>(payload?.items);
  const typeSourceItems = useMemo(
    () => allItems.filter((item) => matchesWorkFilter(item, typeFilter, "all")),
    [allItems, typeFilter]
  );
  const visibleItems = useMemo(
    () => typeSourceItems.filter((item) => matchesWorkFilter(item, "all", ageFilter)),
    [ageFilter, typeSourceItems]
  );
  const typeCounts = useMemo(() => countBy(allItems, (item) => compactText(item.type || item.category, "other")), [allItems]);
  const ageCounts = useMemo(() => countBy(typeSourceItems, (item) => compactText(item.ageCategory || item.age, "unknown")), [typeSourceItems]);
  const busy = busyAction !== null;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function checkHealth() {
    try {
      const health = await getJson("/api/health");
      setServerStatus(health.ok ? "后端在线" : "状态异常");
    } catch {
      setServerStatus("后端离线");
    }
  }

  async function loadLatestFromHistory() {
    const params = new URLSearchParams(window.location.search);
    const q = compactText(params.get("q"));
    if (q) {
      setKeyword(q);
      return;
    }
    try {
      const history = await getJson<Record<string, any>>("/api/search/history?limit=1");
      const latest = arrayOf<Record<string, any>>(history.items)[0];
      if (!latest?.id) return;
      const detail = await getJson<Record<string, any>>(`/api/search/history/${encodeURIComponent(latest.id)}`);
      const restored = detail.payload ?? detail;
      setKeyword(compactText(restored.keyword));
      setPayload(restored);
      if (restored.person) {
        setPerson(restored.person);
        setSelected(new Set(arrayOf<string>(restored.searchedAliases)));
      }
    } catch {
      // History is a convenience only; a fresh install can start empty.
    }
  }

  useEffect(() => {
    void checkHealth();
    void loadLatestFromHistory();
  }, []);

  async function resolvePersons() {
    const value = keyword.trim();
    if (!value) return showToast("请输入人物名或别名。");
    setBusyAction("resolve");
    try {
      const data = await sendJson<Record<string, any>>("/api/persons", { keyword: value, limit: 10, personCategory });
      const nextPersons = arrayOf<Person>(data.persons);
      setPersons(nextPersons);
      if (nextPersons[0]) {
        setPerson(nextPersons[0]);
        setSelected(defaultAliasSelection(nextPersons[0], maxAliases, value));
      } else {
        setPerson(null);
        setSelected(defaultAliasSelection(null, maxAliases, value));
      }
      showToast(nextPersons.length ? `找到 ${nextPersons.length} 个候选人物。` : "未找到候选人物。");
    } catch (error: any) {
      showToast(error.message || "解析失败。");
    } finally {
      setBusyAction(null);
    }
  }

  function choosePerson(nextPerson: Person) {
    setPerson(nextPerson);
    setSelected(defaultAliasSelection(nextPerson, maxAliases, keyword));
  }

  async function pollSearch(jobId: string, token: number) {
    for (;;) {
      await wait(900);
      if (pollingToken.current !== token) return;
      const nextPayload = await getJson<Record<string, any>>(`/api/search/progressive/${encodeURIComponent(jobId)}`);
      setPayload(nextPayload);
      if (nextPayload.progress?.isComplete) {
        setBusyAction(null);
        showToast(nextPayload.progress?.status === "failed" ? "搜索失败，请查看摘要。" : "搜索完成。");
        return;
      }
    }
  }

  async function runSearch({
    orderOverride = order,
    resetFilters = true
  }: { orderOverride?: string; resetFilters?: boolean } = {}) {
    const searchOrder = orderOverride;
    const aliasesToSearch = selectedAliases(keyword, selected);
    if (!aliasesToSearch.length) return showToast("请至少选择一个别名。");
    if ((scope === "all" || scope === "adult") && !adultConfirmed) {
      return showToast("包含 R18 范围时需要确认合法年龄与地区。");
    }
    setBusyAction("search");
    if (resetFilters) {
      setTypeFilter("all");
      setAgeFilter("all");
    }
    try {
      const nextPayload = await sendJson<Record<string, any>>("/api/search/progressive", {
        keyword: keyword.trim(),
        personId: person?.id,
        person,
        aliases: aliasesToSearch,
        maxAliases,
        maxPagesPerAlias: maxPages,
        perPage,
        scope,
        order: searchOrder,
        verifyDetails
      });
      setPayload(nextPayload);
      const jobId = nextPayload.progress?.jobId;
      if (jobId && !nextPayload.progress?.isComplete) {
        const token = pollingToken.current + 1;
        pollingToken.current = token;
        void pollSearch(jobId, token).catch((error) => {
          setBusyAction(null);
          showToast(error.message || "轮询失败。");
        });
      } else {
        setBusyAction(null);
      }
    } catch (error: any) {
      setBusyAction(null);
      showToast(error.message || "搜索失败。");
    }
  }

  function changeOrder(nextOrder: string) {
    if (nextOrder === order || busy) return;
    setOrder(nextOrder);
    if (!payload) return;
    void runSearch({ orderOverride: nextOrder, resetFilters: false });
  }

  async function importWatch(item: WorkItem) {
    try {
      await sendJson("/api/watchlist/import", { work: item });
      showToast(`${workTitle(item)} 已加入本地关注。`);
    } catch (error: any) {
      showToast(error.message || "加入关注失败。");
    }
  }

  function setAliasMode(mode: "all" | "none" | "pen") {
    if (mode === "none") return setSelected(new Set());
    if (mode === "all") return setSelected(new Set(aliases));
    setSelected(new Set(defaultSearchAliases(person, maxAliases, keyword, "penNames")));
  }

  const progress = payload?.progress ?? {};
  const resultSummary = payload
    ? `${formatNumber(visibleItems.length)} / ${formatNumber(allItems.length)} 件显示；${progress.status || "ready"}，别名 ${formatNumber(progress.completedAliases ?? 0)} / ${formatNumber(progress.totalAliases ?? selectedAliases(keyword, selected).length)}。`
    : "先解析人物，再选择别名搜索。";

  return (
    <>
      <link rel="stylesheet" href="/enterprise.css" />
      <SearchTopNav status={serverStatus} />
      <main className="shell">
        <section className="workspace" data-section="01 Search">
          <div className="search-row">
            <label className="search-field">
              <span>人物名或别名</span>
              <Input
                className="ks-hero-input"
                type="search"
                value={keyword}
                placeholder="例如：青山ゆかり"
                autoComplete="off"
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void resolvePersons();
                }}
              />
            </label>
            <Button className="primary-action ks-hero-button ks-hero-button-primary" type="button" isDisabled={busy} aria-busy={busyAction === "resolve"} onPress={() => void resolvePersons()}>
              {busyAction === "resolve" ? <span className="search-busy-dot" aria-hidden="true" /> : null}
              {busyAction === "resolve" ? "解析中" : "解析人物"}
            </Button>
            <Button className="secondary-action ks-hero-button" type="button" isDisabled={busy || !keyword.trim()} aria-busy={busyAction === "search"} onPress={() => void runSearch()}>
              {busyAction === "search" ? <span className="search-busy-dot" aria-hidden="true" /> : null}
              {busyAction === "search" ? "搜索中" : "搜索 DLsite"}
            </Button>
          </div>

          <div className="settings-row">
            <label>
              <span>人物分类</span>
              <select value={personCategory} onChange={(event) => setPersonCategory(event.target.value)}>
                {PERSON_CATEGORY_FILTERS.map((filter) => (
                  <option value={filter.key} key={filter.key}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>默认勾选数</span>
              <input type="number" min={1} max={80} value={maxAliases} onChange={(event) => setMaxAliases(Number(event.target.value) || 1)} />
            </label>
            <label>
              <span>每个别名最大页数</span>
              <input type="number" min={1} max={100} value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value) || 1)} />
            </label>
            <label>
              <span>每页数量</span>
              <select value={perPage} onChange={(event) => setPerPage(Number(event.target.value))}>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <label>
              <span>年龄范围</span>
              <select value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="all">全部</option>
                <option value="adult">仅 R18</option>
                <option value="nonAdult">全年龄/R15</option>
              </select>
            </label>
            <label className="check-control verify-check">
              <input type="checkbox" checked={verifyDetails} onChange={(event) => setVerifyDetails(event.target.checked)} />
              <span>详情验证</span>
            </label>
            <label className="legal-check">
              <input type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)} />
              <span>我确认仅在合法年龄与地区使用 R18 搜索</span>
            </label>
          </div>
        </section>

        <section className="layout">
          <aside className="side-panel" data-section="02 Persons">
            <div className="panel-head">
              <h2>候选人物</h2>
              <span>{persons.length}</span>
            </div>
            <div className="candidate-list">
              {persons.length ? (
                persons.map((candidate) => (
                  <button
                    className={`candidate ${person?.id === candidate.id ? "active" : ""}`}
                    key={candidate.id}
                    type="button"
                    onClick={() => choosePerson(candidate)}
                  >
                    {imageOf(candidate) ? <img src={imageOf(candidate)} alt="" /> : null}
                    <span>
                      <strong>{compactText(candidate.name, `#${candidate.id}`)}</strong>
                      <small>
                        {personCategoryLabel(candidate)} · {aliasValues(candidate).slice(0, 3).join(" / ") || "无别名记录"}
                      </small>
                    </span>
                    <a className="mini-link" href={`/person.html?id=${encodeURIComponent(candidate.id)}`}>
                      详情
                    </a>
                  </button>
                ))
              ) : (
                <div className="next-empty">输入关键词后解析 Bangumi 人物候选。</div>
              )}
            </div>
          </aside>

          <section className="main-panel" data-section="03 Works">
            <div className="panel-head">
              <h2>别名</h2>
              <span>{selected.size}</span>
            </div>
            <div className="alias-tools">
              <button className="mini-action" type="button" disabled={!selectedPersonIsVoiceActor} onClick={() => setAliasMode("pen")}>
                优先声优马甲
              </button>
              <button className="mini-action" type="button" onClick={() => setAliasMode("all")}>
                全选
              </button>
              <button className="mini-action" type="button" onClick={() => setAliasMode("none")}>
                清空
              </button>
            </div>
            <div className="alias-grid">
              {aliases.map((alias) => (
                <label className="alias-chip" key={alias}>
                  <input
                    type="checkbox"
                    checked={selected.has(alias)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(alias);
                      else next.delete(alias);
                      setSelected(next);
                    }}
                  />
                  <span>{alias}</span>
                </label>
              ))}
            </div>

            <div className="result-head">
              <div>
                <h2>结果</h2>
                <p>{resultSummary}</p>
              </div>
              <div className="result-sort" role="group" aria-label="作品排序" data-order={order}>
                {orderOptions.map((option) => (
                  <button
                    className={order === option.key ? "active" : ""}
                    data-order={option.key}
                    key={option.key}
                    type="button"
                    disabled={busy}
                    onClick={() => changeOrder(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tabs">
              {TYPE_FILTERS.map((filter) => (
                <button className={typeFilter === filter.key ? "active" : ""} key={filter.key} type="button" onClick={() => setTypeFilter(filter.key)}>
                  {filter.label}
                  <span>{filter.key === "all" ? allItems.length : typeCounts.get(filter.key) ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="tabs age-tabs">
              {AGE_FILTERS.map((filter) => (
                <button className={ageFilter === filter.key ? "active" : ""} key={filter.key} type="button" onClick={() => setAgeFilter(filter.key)}>
                  {filter.label}
                  <span>{filter.key === "all" ? typeSourceItems.length : ageCounts.get(filter.key) ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="result-list">
              {visibleItems.length ? (
                visibleItems.map((item) => <ResultCard item={item} key={compactText(item.productId, item.url)} onWatch={importWatch} />)
              ) : (
                <div className="next-empty">{payload ? "当前筛选下没有结果。" : "搜索结果会先显示首批，再在后台继续补齐。"}</div>
              )}
            </div>
          </section>
        </section>
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
