"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchTopNav } from "@/components/TopNav";
import { buildQuery, getJson, sendJson } from "@/lib/api";
import { arrayOf, compactText, formatDateTime, formatNumber, formatPrice, imageOf, workTitle } from "@/lib/format";

type WorkItem = Record<string, any>;

const sortOptions = [
  ["hot", "热门"],
  ["latest", "最新"]
];

const typeOptions = [
  ["all", "全部"],
  ["voice", "ASMR/音声"],
  ["game", "游戏"],
  ["manga", "漫画"],
  ["cg", "CG/插画"],
  ["video", "视频"],
  ["other", "其他"]
];

const ageOptions = [
  ["all", "全部"],
  ["general", "全年龄"],
  ["r15", "R15"],
  ["r18", "R18"],
  ["unknown", "未知"]
];

function WorkCard({ item, onWatch }: { item: WorkItem; onWatch: (item: WorkItem) => void }) {
  const annotation = item.annotation ?? {};
  return (
    <article className="result-card person-work">
      <div className="result-media">
        {imageOf(item) ? <img className="result-image" src={imageOf(item)} alt="" /> : <div className="result-image placeholder" />}
      </div>
      <div className="result-body">
        <div className="result-title-line">
          <a className="result-title" href={item.url} target="_blank" rel="noreferrer">{workTitle(item)}</a>
          <span className={`watch-state ${item.isWatched ? "active" : ""}`}>{item.isWatched ? "关注中" : "未关注"}</span>
        </div>
        <div className="next-kv">
          <span>{compactText(item.circle, "Circle 未同步")}</span>
          <span>{compactText(item.typeLabel || item.type, "类型未知")}</span>
          <span>{compactText(item.ageLabel || item.ageCategory, "年龄未知")}</span>
          <span>{formatPrice(item.priceJpy)}</span>
          <span>销量 {formatNumber(item.sales, "-")}</span>
        </div>
        {annotation.status || arrayOf(annotation.tags).length || annotation.note ? (
          <p className="result-meta">
            本地标注：{compactText(annotation.status, "未分类")} {arrayOf(annotation.tags).join(" / ")} {compactText(annotation.note)}
          </p>
        ) : (
          <p className="result-meta">匹配别名：{arrayOf(item.matchedAliases).join(" / ") || "未记录"}</p>
        )}
        <div className="next-card-actions">
          <a className="result-open" href={item.url} target="_blank" rel="noreferrer">打开</a>
          <button className="mini-action" type="button" onClick={() => onWatch(item)}>加入关注</button>
        </div>
      </div>
    </article>
  );
}

export default function PersonPage() {
  const [serverStatus, setServerStatus] = useState("连接中");
  const [keyword, setKeyword] = useState("");
  const [personId, setPersonId] = useState("");
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [works, setWorks] = useState<Record<string, any>>({ items: [] });
  const [sort, setSort] = useState("hot");
  const [type, setType] = useState("all");
  const [age, setAge] = useState("all");
  const [sessionId, setSessionId] = useState("");
  const [toast, setToast] = useState("");
  const currentPerson = profile?.person ?? {};
  const subscription = profile?.subscription;
  const aliases = arrayOf<Record<string, any>>(profile?.aliases);
  const recentSearches = arrayOf<Record<string, any>>(profile?.recentSearches);
  const stats = profile?.stats ?? {};
  const workItems = arrayOf<WorkItem>(works.items);

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

  async function loadPerson(id = personId) {
    if (!id) return;
    try {
      const nextProfile = await getJson<Record<string, any>>(`/api/persons/${encodeURIComponent(id)}/profile`);
      setProfile(nextProfile);
      if (nextProfile.person?.name && !keyword) setKeyword(nextProfile.person.name);
      document.title = `${nextProfile.person?.name || "声优详情"} - KoeScope`;
    } catch (error: any) {
      showToast(error.message || "人物资料读取失败。");
    }
  }

  async function loadWorks(id = personId) {
    if (!id) return;
    try {
      const nextWorks = await getJson<Record<string, any>>(
        `/api/persons/${encodeURIComponent(id)}/works${buildQuery({ sort, type, age, sessionId, limit: 300 })}`
      );
      setWorks(nextWorks);
    } catch (error: any) {
      showToast(error.message || "作品读取失败。");
    }
  }

  useEffect(() => {
    void checkHealth();
    const params = new URLSearchParams(window.location.search);
    const id = compactText(params.get("id"));
    const q = compactText(params.get("keyword"));
    if (q) setKeyword(q);
    if (id) setPersonId(id);
    else if (q) void resolveKeyword(q);
  }, []);

  useEffect(() => {
    if (!personId) return;
    void loadPerson(personId);
  }, [personId]);

  useEffect(() => {
    if (!personId) return;
    void loadWorks(personId);
  }, [personId, sort, type, age, sessionId]);

  async function resolveKeyword(value = keyword) {
    const text = value.trim();
    if (!text) return showToast("请输入声优名或马甲。");
    try {
      const payload = await sendJson<Record<string, any>>("/api/persons", { keyword: text, limit: 1 });
      const first = arrayOf<Record<string, any>>(payload.persons)[0];
      if (!first?.id) return showToast("未找到候选人物。");
      setPersonId(String(first.id));
      setKeyword(text);
      window.history.replaceState(null, "", `/person.html?id=${encodeURIComponent(first.id)}`);
    } catch (error: any) {
      showToast(error.message || "查找失败。");
    }
  }

  async function importWatch(item: WorkItem) {
    try {
      await sendJson("/api/watchlist/import", { work: item });
      showToast(`${workTitle(item)} 已加入本地关注。`);
      await loadWorks();
    } catch (error: any) {
      showToast(error.message || "加入关注失败。");
    }
  }

  async function saveSubscription() {
    if (!personId || !currentPerson.name) return showToast("请先载入人物。");
    try {
      await sendJson(
        `/api/persons/${encodeURIComponent(personId)}/subscription`,
        {
          personId,
          personName: currentPerson.name,
          aliases: aliases.map((alias) => compactText(alias.value)).filter(Boolean),
          keyword: keyword || currentPerson.name
        },
        "PUT"
      );
      showToast("已保存声优订阅。");
      await loadPerson();
    } catch (error: any) {
      showToast(error.message || "订阅失败。");
    }
  }

  async function deleteSubscription() {
    if (!personId) return;
    try {
      await sendJson(`/api/persons/${encodeURIComponent(personId)}/subscription`, {}, "DELETE");
      showToast("已取消订阅。");
      await loadPerson();
    } catch (error: any) {
      showToast(error.message || "取消订阅失败。");
    }
  }

  async function checkSubscription() {
    if (!personId) return;
    try {
      const payload = await sendJson<Record<string, any>>(`/api/persons/${encodeURIComponent(personId)}/subscription/check`, {});
      showToast(`检查完成，可能新作 ${formatNumber(arrayOf(payload.newItems).length)} 件。`);
      await Promise.all([loadPerson(), loadWorks()]);
    } catch (error: any) {
      showToast(error.message || "检查失败。");
    }
  }

  const activeSource = useMemo(() => {
    if (!sessionId) return "当前来源：全部本地搜索历史";
    const selected = recentSearches.find((item) => item.id === sessionId);
    return `当前来源：${selected?.orderLabel || selected?.id || sessionId}`;
  }, [recentSearches, sessionId]);

  return (
    <>
      <SearchTopNav status={serverStatus} />
      <main className="shell person-shell">
        <section className="person-workspace">
          {imageOf(currentPerson) ? <img id="personImage" className="person-avatar" src={imageOf(currentPerson)} alt="" /> : <div className="person-avatar" />}
          <div className="person-title-block">
            <p className="eyebrow">{profile ? "数据来自本地搜索历史" : "输入关键词查找人物"}</p>
            <h2>{compactText(currentPerson.name, "加载中")}</h2>
            <p>{personId ? `Bangumi person #${personId}` : "URL 中缺少有效的 Bangumi personId。"}</p>
            <div className="person-alias-summary">
              {aliases.slice(0, 8).map((alias) => <span className="next-chip" key={compactText(alias.value)}>{compactText(alias.value)}</span>)}
            </div>
          </div>
          <div className="person-lookup">
            <label className="search-field">
              <span>声优名或马甲</span>
              <input type="search" value={keyword} placeholder="例如：青山ゆかり" autoComplete="off" onChange={(event) => setKeyword(event.target.value)} />
            </label>
            <button className="secondary-action" type="button" onClick={() => void resolveKeyword()}>查找</button>
          </div>
          <div className="person-subscription-box">
            <div>
              <strong>{subscription ? "Subscribed" : "Not subscribed"}</strong>
              <p>
                {subscription
                  ? `最近检查：${formatDateTime(subscription.lastCheckedAt)}；可能新作 ${formatNumber(subscription.lastNewItemCount)} 件。`
                  : "Save this voice actor for low-frequency possible-new-work checks."}
              </p>
            </div>
            <div className="mini-actions">
              <button className="mini-button primary" type="button" onClick={saveSubscription}>Subscribe</button>
              {subscription ? <button className="mini-button" type="button" onClick={checkSubscription}>Check now</button> : null}
              {subscription ? <button className="mini-button" type="button" onClick={deleteSubscription}>Unsubscribe</button> : null}
            </div>
          </div>
        </section>

        <section className="layout">
          <aside className="side-panel">
            <div className="panel-head"><h2>别名</h2><span>{aliases.length}</span></div>
            <div className="alias-grid person-alias-list">
              {aliases.map((alias) => <span className="alias-chip" key={compactText(alias.value)}>{compactText(alias.value)}{alias.isPenName ? " / 马甲" : ""}</span>)}
            </div>
            <div className="panel-head"><h2>最近搜索</h2><span>{recentSearches.length}</span></div>
            <div className="recent-list next-mini-list">
              {recentSearches.map((item) => (
                <button className="candidate" type="button" key={item.id} onClick={() => setSessionId(item.id)}>
                  <span><strong>{formatDateTime(item.updatedAt)}</strong><small>{item.orderLabel || item.order} / {formatNumber(item.total)} 件</small></span>
                </button>
              ))}
            </div>
          </aside>

          <section className="main-panel">
            <div className="stats-grid">
              <div><span>总作品</span><strong>{formatNumber(stats.totalWorks)}</strong></div>
              <div><span>音声</span><strong>{formatNumber(stats.voiceWorks)}</strong></div>
              <div><span>R18</span><strong>{formatNumber(stats.r18Works)}</strong></div>
              <div><span>关注</span><strong>{formatNumber(stats.watchedWorks)}</strong></div>
            </div>
            <div className="result-head">
              <div>
                <h2>作品</h2>
                <p>{works.total ? `当前显示 ${formatNumber(works.total)} 件。` : "数据来自本地搜索历史，可切换最近搜索作为数据来源。"}</p>
              </div>
              <div className="result-sort" role="group" aria-label="作品排序">
                {sortOptions.map(([key, label]) => <button className={sort === key ? "active" : ""} key={key} type="button" onClick={() => setSort(key)}>{label}</button>)}
              </div>
            </div>
            <div className="settings-row">
              <label><span>类型</span><select value={type} onChange={(event) => setType(event.target.value)}>{typeOptions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <label><span>年龄</span><select value={age} onChange={(event) => setAge(event.target.value)}>{ageOptions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <span className="status-pill">{activeSource}</span>
              {sessionId ? <button className="mini-action" type="button" onClick={() => setSessionId("")}>使用全部历史</button> : null}
            </div>
            <div className="result-list person-work-list">
              {workItems.length ? workItems.map((item) => <WorkCard item={item} key={compactText(item.productId, item.url)} onWatch={importWatch} />) : <div className="next-empty">暂无本地作品记录。先从首页完成一次搜索。</div>}
            </div>
          </section>
        </section>
      </main>
      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}
    </>
  );
}
