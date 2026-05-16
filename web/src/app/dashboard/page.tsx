"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { MonitorTopNav } from "@/components/TopNav";
import { buildQuery, getJson, sendJson } from "@/lib/api";
import { accountLine, personalSummaryLine } from "@/lib/activityView";
import { arrayOf, compactText, formatDateTime, formatNumber, formatPercent, formatPrice, imageOf, workTitle } from "@/lib/format";

type Json = Record<string, any>;

const PRIMARY_DASHBOARD_SECTIONS = [
  "summary",
  "statuses",
  "activities",
  "activityAlerts",
  "rankings",
  "alerts",
  "account",
].join(",");
const DEFERRED_DASHBOARD_SECTIONS = ["watchlist", "recommendations", "bundles"].join(",");

function MiniWork({ item, onHistory, onWatch, onDelete }: { item: Json; onHistory?: (id: string) => void; onWatch?: (item: Json) => void; onDelete?: (id: string) => void }) {
  return (
    <article className="mini-work">
      <a className="mini-thumb" href={item.url || "#"} target="_blank" rel="noreferrer">
        {imageOf(item) ? <img src={imageOf(item)} alt="" /> : null}
      </a>
      <div>
        <a className="mini-title" href={item.url || "#"} target="_blank" rel="noreferrer">{workTitle(item)}</a>
        <div className="next-kv">
          <span>{compactText(item.productId)}</span>
          <span>{formatPrice(item.priceJpy ?? item.latestPriceJpy)}</span>
          {formatPercent(item.discountRate ?? item.latestDiscountRate) ? <span>{formatPercent(item.discountRate ?? item.latestDiscountRate)}</span> : null}
        </div>
        <div className="next-card-actions">
          {onHistory && item.productId ? <button className="mini-button" type="button" onClick={() => onHistory(String(item.productId))}>历史</button> : null}
          {onWatch ? <button className="mini-button" type="button" onClick={() => onWatch(item)}>关注</button> : null}
          {onDelete && item.productId ? <button className="mini-button" type="button" onClick={() => onDelete(String(item.productId))}>移除</button> : null}
        </div>
      </div>
    </article>
  );
}

function RankingCard({
  item,
  position,
  onWatch,
  onHistory
}: {
  item: Json;
  position: number;
  onWatch: (item: Json) => void;
  onHistory: (id: string) => void;
}) {
  const image = imageOf(item);
  const productId = compactText(item.productId);
  const trend = formatPercent(item.discountRate ?? item.latestDiscountRate) || compactText(item.rankChangeLabel, "-");
  const rankLabel = Number.isFinite(Number(item.rank)) ? `#${item.rank}` : `#${position}`;
  return (
    <article className="ranking-card">
      <a className="ranking-cover" href={item.url || "#"} target="_blank" rel="noreferrer" aria-label={workTitle(item)}>
        {image ? <img src={image} alt="" /> : <div className="ranking-cover-placeholder">{rankLabel}</div>}
        <span className="ranking-rank">{rankLabel}</span>
      </a>
      <div className="ranking-card-body">
        <a className="work-title ranking-title" href={item.url || "#"} target="_blank" rel="noreferrer">
          {workTitle(item)}
        </a>
        <div className="next-kv ranking-meta">
          {productId ? <span>{productId}</span> : null}
          <span>{formatPrice(item.priceJpy ?? item.latestPriceJpy)}</span>
          <span>{trend}</span>
          {compactText(item.circle) ? <span>{compactText(item.circle)}</span> : null}
        </div>
        <div className="next-card-actions ranking-actions">
          <a className="mini-button" href={item.url || "#"} target="_blank" rel="noreferrer">
            打开
          </a>
          {productId ? (
            <button className="mini-button" type="button" onClick={() => onHistory(productId)}>
              历史
            </button>
          ) : null}
          <button className="mini-button primary" type="button" onClick={() => onWatch(item)}>
            关注
          </button>
        </div>
      </div>
    </article>
  );
}

function ActivityPreview({ payload, onRead }: { payload: Json; onRead: (id: string) => void }) {
  const items = arrayOf<Json>(payload.items).slice(0, 3);
  return (
    <>
      <div className="activity-account">{accountLine(payload)}</div>
      <div className="activity-personal"><strong>本地相关性</strong><span>{personalSummaryLine(payload)}</span></div>
      <div className="activity-list">
        {items.length ? items.map((item) => (
          <article className="activity-card" key={compactText(item.activityId, item.url)}>
            <a href={item.url || "#"} target="_blank" rel="noreferrer">{imageOf(item) ? <img src={imageOf(item)} alt="" /> : null}</a>
            <div className="activity-card-body">
              <a className="activity-title" href={item.url || "#"} target="_blank" rel="noreferrer">{compactText(item.title, "未命名活动")}</a>
              <p className="activity-summary">{compactText(item.benefitSummary || item.details?.summary, "公开活动摘要暂未同步。")}</p>
              <div className="next-kv">
                <span>{compactText(item.benefitLabel || item.benefitType, "活动")}</span>
                <span>{formatDateTime(item.endsAt)}</span>
                <span>{arrayOf(item.relatedWorks).length} 个可能相关作品</span>
              </div>
              {arrayOf<Json>(item.unreadAlerts).map((alert) => (
                <div className="activity-alert" key={alert.id}>
                  <span>{compactText(alert.message, "活动提醒")}</span>
                  <button type="button" onClick={() => onRead(String(alert.id))}>已读</button>
                </div>
              ))}
            </div>
          </article>
        )) : <div className="next-empty">暂无活动摘要。</div>}
      </div>
      <div className="activity-more"><a className="link-action" href="/activities.html">查看全部活动</a></div>
    </>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Json>({});
  const [syncStatus, setSyncStatus] = useState<Json>({});
  const [activityStatus, setActivityStatus] = useState<Json>({});
  const [activities, setActivities] = useState<Json>({ items: [] });
  const [activityAlerts, setActivityAlerts] = useState<Json>({});
  const [rankings, setRankings] = useState<Json>({ items: [] });
  const [alerts, setAlerts] = useState<Json>({ items: [] });
  const [watchlist, setWatchlist] = useState<Json>({ items: [] });
  const [account, setAccount] = useState<Json>({});
  const [recommendations, setRecommendations] = useState<Json>({ items: [] });
  const [bundles, setBundles] = useState<Json>({ items: [] });
  const [maintenance, setMaintenance] = useState<Json | null>(null);
  const [category, setCategory] = useState("all");
  const [floor, setFloor] = useState("home");
  const [period, setPeriod] = useState("week");
  const [alertsStatus, setAlertsStatus] = useState("unread");
  const [history, setHistory] = useState<Json | null>(null);
  const [annotation, setAnnotation] = useState({ status: "", tags: "", note: "" });
  const [toast, setToast] = useState("");
  const [chartsReady, setChartsReady] = useState(false);
  const priceChartRef = useRef<any>(null);
  const rankChartRef = useRef<any>(null);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function loadDashboard() {
    try {
      const nextState = await getJson<Json>(
        `/api/dashboard/state${buildQuery({
          sections: PRIMARY_DASHBOARD_SECTIONS,
          floor,
          period,
          category,
          alertsStatus,
          activityLimit: 3,
          alertLimit: 50
        })}`
      );
      setSummary(nextState.summary ?? {});
      setSyncStatus(nextState.syncStatus ?? {});
      setActivityStatus(nextState.activityStatus ?? {});
      setActivities(nextState.activities ?? { items: [] });
      setActivityAlerts(nextState.activityAlerts ?? {});
      setRankings(nextState.rankings ?? { items: [] });
      setAlerts(nextState.alerts ?? { items: [] });
      setAccount(nextState.account ?? {});
    } catch (error: any) {
      showToast(error.message || "Dashboard 读取失败。");
    }
  }

  async function loadDeferredDashboardSections() {
    try {
      const nextState = await getJson<Json>(
        `/api/dashboard/state${buildQuery({
          sections: DEFERRED_DASHBOARD_SECTIONS
        })}`
      );
      setWatchlist(nextState.watchlist ?? { items: [] });
      setRecommendations(nextState.recommendations ?? { items: [] });
      setBundles(nextState.bundles ?? { items: [] });
    } catch (error: any) {
      showToast(error.message || "Dashboard 延迟模块读取失败。");
    }
  }

  async function refreshDashboard() {
    await loadDashboard();
    await loadDeferredDashboardSections();
  }

  useEffect(() => {
    void refreshDashboard();
  }, [category, floor, period, alertsStatus]);

  useEffect(() => {
    if (!history) return;
    const next = history.annotation ?? {};
    setAnnotation({
      status: compactText(next.status),
      tags: arrayOf(next.tags).join(", "),
      note: compactText(next.note)
    });
  }, [history]);

  useEffect(() => {
    if (!history || typeof window === "undefined") return;
    const Chart = (window as any).Chart;
    if (typeof Chart !== "function") return;
    priceChartRef.current?.destroy?.();
    rankChartRef.current?.destroy?.();
    const priceCanvas = document.querySelector<HTMLCanvasElement>("#priceTrendChart");
    const rankCanvas = document.querySelector<HTMLCanvasElement>("#rankTrendChart");
    const prices = arrayOf<Json>(history.prices).filter((point) => Number.isFinite(Number(point.priceJpy)));
    const ranks = arrayOf<Json>(history.ranks).filter((point) => Number.isFinite(Number(point.rank)));
    if (priceCanvas && prices.length) {
      priceChartRef.current = new Chart(priceCanvas, {
        type: "line",
        data: { labels: prices.map((p) => formatDateTime(p.capturedAt)), datasets: [{ label: "Price", data: prices.map((p) => p.priceJpy), borderColor: "#0095ff" }] },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
    if (rankCanvas && ranks.length) {
      rankChartRef.current = new Chart(rankCanvas, {
        type: "line",
        data: { labels: ranks.map((p) => formatDateTime(p.capturedAt)), datasets: [{ label: "Rank", data: ranks.map((p) => p.rank), borderColor: "#00c8f6" }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { reverse: true } } }
      });
    }
  }, [history, chartsReady]);

  async function startSync() {
    try {
      const payload = await sendJson<Json>("/api/sync/dlsite-rankings", { manual: true });
      showToast(payload.alreadyRunning ? "排行榜同步已在运行。" : "已启动排行榜同步。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "同步失败。");
    }
  }

  async function startActivitySync() {
    try {
      const payload = await sendJson<Json>("/api/sync/dlsite-activities", { manual: true });
      showToast(payload.alreadyRunning ? "活动同步已在运行。" : "已启动活动同步。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "活动同步失败。");
    }
  }

  async function clearAccountSession() {
    try {
      await sendJson("/api/account/dlsite/session", {}, "DELETE");
      showToast("已断开本地账号会话。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "断开失败。");
    }
  }

  async function previewCleanup() {
    try {
      const payload = await getJson<Json>("/api/maintenance/snapshot-cleanup?retentionDays=365");
      setMaintenance(payload);
      showToast(`可清理 ${formatNumber(payload.totalDeletable)} 条快照。`);
    } catch (error: any) {
      showToast(error.message || "预览失败。");
    }
  }

  async function runCleanup() {
    if (!window.confirm("确认执行本地快照清理？")) return;
    try {
      const payload = await sendJson<Json>("/api/maintenance/snapshot-cleanup", { dryRun: false, retentionDays: 365 });
      setMaintenance(payload);
      showToast(`已清理 ${formatNumber(payload.totalDeleted)} 条快照。`);
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "清理失败。");
    }
  }

  async function importWatch(item: Json) {
    try {
      await sendJson("/api/watchlist/import", { work: item });
      showToast("已加入关注。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "加入关注失败。");
    }
  }

  async function deleteWatch(productId: string) {
    try {
      await sendJson(`/api/watchlist/${encodeURIComponent(productId)}`, {}, "DELETE");
      showToast("已移除关注。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "移除失败。");
    }
  }

  async function markAlertRead(id: string, activity = false) {
    try {
      await sendJson(`/${activity ? "api/activity-alerts" : "api/alerts"}/${encodeURIComponent(id)}/read`, {});
      showToast("提醒已标记为已读。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "标记失败。");
    }
  }

  async function openHistory(productId: string) {
    try {
      const payload = await getJson<Json>(`/api/works/${encodeURIComponent(productId)}/history`);
      setHistory(payload);
    } catch (error: any) {
      showToast(error.message || "历史读取失败。");
    }
  }

  async function saveAnnotation(event: React.FormEvent) {
    event.preventDefault();
    const productId = history?.work?.productId;
    if (!productId) return;
    try {
      const payload = await sendJson<Json>(`/api/works/${encodeURIComponent(productId)}/annotation`, {
        status: annotation.status,
        tags: annotation.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        note: annotation.note
      }, "PUT");
      setHistory({ ...history, annotation: payload });
      showToast("标注已保存。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "保存失败。");
    }
  }

  async function deleteAnnotation() {
    const productId = history?.work?.productId;
    if (!productId) return;
    try {
      await sendJson(`/api/works/${encodeURIComponent(productId)}/annotation`, {}, "DELETE");
      setHistory({ ...history, annotation: {} });
      showToast("标注已清空。");
      await refreshDashboard();
    } catch (error: any) {
      showToast(error.message || "清空失败。");
    }
  }

  const rankingItems = arrayOf<Json>(rankings.items);
  const alertItems = arrayOf<Json>(alerts.items);
  const watchItems = arrayOf<Json>(watchlist.items);
  const dropItems = arrayOf<Json>(summary.notableDrops);
  const recommendationItems = arrayOf<Json>(recommendations.items);
  const bundleItems = arrayOf<Json>(bundles.items);
  const syncLabel = syncStatus.running ? "同步中" : "已就绪";
  const maintenanceText = useMemo(() => {
    if (!maintenance) return "点击预览检查可清理快照。";
    const deletable = Number(maintenance.totalDeletable ?? 0);
    const deleted = Number(maintenance.totalDeleted ?? 0);
    return maintenance.dryRun === false
      ? `本次已清理 ${formatNumber(deleted)} 条快照。`
      : `可清理 ${formatNumber(deletable)} 条冗余快照，执行前会保留低价、最新和提醒引用快照。`;
  }, [maintenance]);

  return (
    <>
      <link rel="stylesheet" href="/dashboard.css" />
      {history ? (
        <Script
          src="/vendor/chart.js/chart.umd.js"
          strategy="lazyOnload"
          onLoad={() => setChartsReady(true)}
          onReady={() => setChartsReady(true)}
        />
      ) : null}
      <MonitorTopNav title="KoeScope Monitor" eyebrow="Monitor 03 / Local SQLite">
        <button className="primary-action" type="button" onClick={startSync}>同步</button>
        <span className="status-pill">{syncLabel}</span>
      </MonitorTopNav>

      <main className="monitor-shell">
        <section className="metric-strip" data-section="01 Metrics" aria-label="监测概览">
          <div><span>作品</span><strong>{formatNumber(summary.totalWorks)}</strong></div>
          <div><span>折扣中</span><strong>{formatNumber(summary.discountedWorks)}</strong></div>
          <div><span>关注</span><strong>{formatNumber(summary.watchedWorks)}</strong></div>
          <div><span>未读提醒</span><strong>{formatNumber(summary.unreadAlerts)}</strong></div>
          <div><span>点数</span><strong>{formatNumber(account.pointsJpy ?? summary.accountPoints)}</strong></div>
          <div><span>活动</span><strong>{formatNumber(summary.activeActivities)}</strong></div>
          <div><span>活动提醒</span><strong>{formatNumber(summary.unreadActivityAlerts ?? activityAlerts.unreadCount)}</strong></div>
        </section>

        <section className="sync-line">
          <span>最近同步：{formatDateTime(syncStatus.latestRun?.finishedAt ?? syncStatus.latestRun?.startedAt)}</span>
          <span>下次同步：{formatDateTime(syncStatus.nextScheduledAt)}</span>
        </section>

        <section className="activity-pane" id="activities" data-section="02 Activity">
          <div className="section-head activity-head">
            <div>
              <h2>DLsite 活动</h2>
              <p>{activityStatus.running ? "活动同步运行中。" : "显示公开活动摘要和本地可能相关匹配。"}</p>
            </div>
            <div className="filters">
              <a className="text-action" href="/activities.html">活动中心</a>
              <button className="text-action" type="button" onClick={startActivitySync}>刷新活动</button>
              <span className="status-pill">{activityStatus.running ? "同步中" : "已就绪"}</span>
            </div>
          </div>
          <ActivityPreview payload={activities} onRead={(id) => markAlertRead(id, true)} />
        </section>

        <section className="monitor-layout">
          <section className="ranking-pane" data-section="03 Ranking">
            <div className="section-head">
              <div>
                <h2>排行榜</h2>
                <p>{rankingItems.length ? `最近快照 ${formatDateTime(rankings.capturedAt)}` : "总榜，按最近一次快照显示。"}</p>
              </div>
              <div className="filters">
                <label><span>分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">总榜</option><option value="voice">ASMR / 音声</option><option value="game">游戏</option><option value="manga">漫画</option></select></label>
                <label><span>楼层</span><select value={floor} onChange={(event) => setFloor(event.target.value)}><option value="home">全年龄</option><option value="maniax">R18</option></select></label>
                <label><span>周期</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="day">日榜</option><option value="week">周榜</option><option value="month">月榜</option></select></label>
              </div>
            </div>
            <div className="ranking-card-list">
              {rankingItems.length ? (
                rankingItems.map((item, index) => (
                  <RankingCard
                    item={item}
                    key={`${compactText(item.productId, item.url)}-${index}`}
                    position={index + 1}
                    onHistory={openHistory}
                    onWatch={importWatch}
                  />
                ))
              ) : (
                <div className="next-empty">暂无排行榜快照。</div>
              )}
            </div>
          </section>

          <aside className="side-rail">
            <section className="side-section account-section" data-section="04 Account">
              <div className="section-head compact">
                <h2>DLsite 账号</h2>
                <button className="text-action" type="button" onClick={() => showToast("请通过 KoeScope Companion 扩展同步账号。")}>扩展同步</button>
              </div>
              <div className="account-box">
                <div className="account-state">{account.hasSession ? `${formatNumber(account.pointsJpy)} pt` : "未连接"}</div>
                <div className="account-meta">{account.hasSession ? `最近同步：${formatDateTime(account.lastSyncedAt)}` : "在 Chrome 中登录 DLsite 后，通过 KoeScope Companion 扩展同步账号。"}</div>
                <div className="mini-actions">
                  <a className="mini-button" href="https://www.dlsite.com/home/regist/user" target="_blank" rel="noreferrer">打开登录</a>
                  <button className="mini-button" type="button" onClick={clearAccountSession}>断开</button>
                </div>
              </div>
            </section>

            <section className="side-section">
              <div className="section-head compact"><h2>点数推荐</h2><span>{recommendationItems.length}</span></div>
              <div className="recommendation-list next-mini-list">
                {recommendationItems.length ? recommendationItems.map((item) => <MiniWork item={item} key={compactText(item.productId, item.url)} onHistory={openHistory} onWatch={importWatch} />) : <div className="next-empty">暂无推荐。</div>}
              </div>
            </section>

            <section className="side-section">
              <div className="section-head compact"><h2>组合建议</h2><span>{bundleItems.length}</span></div>
              <div className="bundle-list next-mini-list">
                {bundleItems.length ? bundleItems.map((bundle, index) => (
                  <article className="bundle-card" key={`${bundle.circle}-${index}`}>
                    <strong>{compactText(bundle.circle, "Circle")}</strong>
                    <p>{formatNumber(bundle.itemCount)} 件 / {formatPrice(bundle.totalPriceJpy)} / 余 {formatPrice(bundle.leftoverJpy, "0円")}</p>
                    <small>{bundle.claimsCheckoutOptimization === false ? "仅公开价格分析，不声明最终结算最优。" : ""}</small>
                  </article>
                )) : <div className="next-empty">暂无组合建议。</div>}
              </div>
            </section>

            <section className="side-section">
              <div className="section-head compact"><h2>数据维护</h2><button className="text-action" type="button" onClick={previewCleanup}>预览</button></div>
              <div className="maintenance-box">
                <div className="maintenance-summary">{maintenanceText}</div>
                <div className="mini-actions"><button className="mini-button primary" type="button" onClick={runCleanup}>执行清理</button></div>
              </div>
            </section>

            <section className="side-section">
              <div className="section-head compact"><h2>提醒</h2><button className="text-action" type="button" onClick={() => setAlertsStatus(alertsStatus === "all" ? "unread" : "all")}>{alertsStatus === "all" ? "未读" : "全部"}</button></div>
              <div className="alert-list next-mini-list">
                {alertItems.length ? alertItems.map((alert) => (
                  <article className="alert-card" key={alert.id}>
                    <strong>{compactText(alert.message, compactText(alert.title, "提醒"))}</strong>
                    <p>{alert.personId ? <a className="mini-link" href={`/person.html?id=${encodeURIComponent(alert.personId)}`}>{compactText(alert.personName, "人物详情")}</a> : compactText(alert.productId)}</p>
                    <button className="mini-button" type="button" onClick={() => markAlertRead(String(alert.id))}>已读</button>
                  </article>
                )) : <div className="next-empty">暂无提醒。</div>}
              </div>
            </section>

            <section className="side-section">
              <div className="section-head compact"><h2>关注</h2><span>{watchItems.length}</span></div>
              <div className="watch-list next-mini-list">
                {watchItems.length ? watchItems.map((item) => <MiniWork item={item} key={compactText(item.productId, item.url)} onHistory={openHistory} onDelete={deleteWatch} />) : <div className="next-empty">暂无关注作品。</div>}
              </div>
            </section>

            <section className="side-section">
              <div className="section-head compact"><h2>明显降价</h2></div>
              <div className="drop-list next-mini-list">
                {dropItems.length ? dropItems.map((item) => <MiniWork item={item} key={compactText(item.productId, item.url)} onHistory={openHistory} onWatch={importWatch} />) : <div className="next-empty">暂无明显降价。</div>}
              </div>
            </section>
          </aside>
        </section>

        {history ? (
          <aside className="history-panel next-dialog" role="dialog" aria-modal="false" aria-labelledby="historyTitle">
            <div className="section-head">
              <div>
                <h2 id="historyTitle">{history.work?.title || history.work?.productId || "历史"}</h2>
                <p>{history.work?.circle || history.work?.productId}</p>
              </div>
              <button className="text-action" type="button" onClick={() => setHistory(null)}>关闭</button>
            </div>
            <form className="annotation-editor" onSubmit={saveAnnotation}>
              <div className="annotation-fields">
                <label><span>状态</span><select value={annotation.status} onChange={(event) => setAnnotation({ ...annotation, status: event.target.value })}><option value="">未设置</option><option value="favorite">神作</option><option value="owned">已入</option><option value="planned">待购</option></select></label>
                <label><span>标签</span><input type="text" value={annotation.tags} onChange={(event) => setAnnotation({ ...annotation, tags: event.target.value })} /></label>
              </div>
              <label className="annotation-note-field"><span>备注</span><textarea rows={3} value={annotation.note} onChange={(event) => setAnnotation({ ...annotation, note: event.target.value })} /></label>
              <div className="mini-actions">
                <button className="mini-button primary" type="submit">保存标注</button>
                <button className="mini-button" type="button" onClick={deleteAnnotation}>清空</button>
              </div>
            </form>
            <div className="history-grid">
              <div>
                <h3>价格快照</h3>
                <div className="history-chart"><canvas id="priceTrendChart" aria-label="Price trend chart" /></div>
                <div className="history-list">
                  {arrayOf<Json>(history.prices).map((item, index) => <div className="history-row" key={index}><strong>{formatPrice(item.priceJpy ?? item.officialPriceJpy)}</strong><span>{formatDateTime(item.capturedAt)}</span></div>)}
                </div>
              </div>
              <div>
                <h3>排名快照</h3>
                <div className="history-chart"><canvas id="rankTrendChart" aria-label="Rank trend chart" /></div>
                <div className="history-list">
                  {arrayOf<Json>(history.ranks).map((item, index) => <div className="history-row" key={index}><strong>#{item.rank}</strong><span>{compactText(item.category)} / {formatDateTime(item.capturedAt)}</span></div>)}
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
