"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorTopNav } from "@/components/TopNav";
import { getJson, sendJson } from "@/lib/api";
import { accountLine, activityQuery, activityStats, personalSummaryLine } from "@/lib/activityView";
import { arrayOf, claimsText, compactText, formatDateTime, formatNumber, formatPercent, formatPrice, imageOf } from "@/lib/format";

const benefitFilters = [
  ["all", "全部"],
  ["point", "点数"],
  ["coupon", "优惠券"],
  ["discount", "折扣"],
  ["free", "免费"],
  ["bonus", "福利"],
  ["info", "专题"]
];

const statusFilters = [
  ["active", "进行中"],
  ["all", "全部"],
  ["endingSoon", "即将结束"],
  ["unread", "未读提醒"]
];

function ActivityRelated({ works }: { works: Record<string, any>[] }) {
  if (!works.length) return null;
  return (
    <details className="activity-related">
      <summary>
        <span>可能相关作品</span>
        <strong>{works.length}</strong>
        <small>仅按公开活动和本地数据保守匹配</small>
      </summary>
      <div className="activity-related-body">
        {works.map((work) => (
          <a className="activity-related-work" href={work.url || "#"} target="_blank" rel="noreferrer" key={compactText(work.productId, work.url)}>
            {imageOf(work) ? <img className="activity-related-thumb" src={imageOf(work)} alt="" /> : <div className="activity-related-thumb placeholder" />}
            <span>
              <strong>{compactText(work.title, compactText(work.productId, "标题待同步"))}</strong>
              <small>
                {compactText(work.circle)}
                {work.latestPriceJpy ? ` / 当前 ${formatPrice(work.latestPriceJpy)}` : ""}
                {formatPercent(work.latestDiscountRate) ? ` / ${formatPercent(work.latestDiscountRate)}` : ""}
              </small>
              <small>{arrayOf(work.sourceLabels).join(" / ") || claimsText(work.claimsEntitlement)}</small>
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}

function ActivityCard({ item, onRead }: { item: Record<string, any>; onRead: (id: string) => void }) {
  const details = item.details ?? {};
  const related = arrayOf<Record<string, any>>(item.relatedWorks);
  const alerts = arrayOf<Record<string, any>>(item.unreadAlerts);
  const image = imageOf(item);
  return (
    <article className="activity-card activity-center-card">
      <a href={item.url} target="_blank" rel="noreferrer">
        {image ? <img src={image} alt="" /> : null}
      </a>
      <div className="activity-card-body">
        <div className="next-kv">
          <span>{compactText(item.benefitLabel || item.benefitType, "活动")}</span>
          <span>{formatDateTime(item.startsAt)} - {formatDateTime(item.endsAt)}</span>
          <span>{claimsText(item.claimsEntitlement)}</span>
        </div>
        <a className="activity-title" href={item.url} target="_blank" rel="noreferrer">
          {compactText(item.title, "未命名活动")}
        </a>
        <p className="activity-summary">{compactText(item.benefitSummary || details.summary, "公开活动摘要暂未同步。")}</p>
        <details className={`activity-detail ${compactText(details.status, "fallback")}`}>
          <summary className="activity-detail-head">
            <span>详情</span>
            <strong>{compactText(details.status, "fallback")}</strong>
            <small>{formatDateTime(details.fetchedAt, "未抓取")}</small>
          </summary>
          <div className="activity-detail-body">
            <p>{compactText(details.summary, "详情页未能稳定解析，保留公开入口。")}</p>
            <div className="activity-detail-facts">
              {details.claimCondition ? <span><strong>领取</strong>{details.claimCondition}</span> : null}
              {details.applicableScope ? <span><strong>范围</strong>{details.applicableScope}</span> : null}
              {details.requiresLogin ? <span><strong>登录</strong>需要在 DLsite 确认</span> : null}
              {details.isLimited ? <span><strong>数量</strong>可能有限</span> : null}
            </div>
          </div>
        </details>
        <ActivityRelated works={related} />
        {alerts.length ? (
          <div className="activity-alerts">
            {alerts.map((alert) => (
              <div className="activity-alert" key={alert.id}>
                <span>{compactText(alert.message, "未读活动提醒")}</span>
                <button type="button" onClick={() => onRead(String(alert.id))}>已读</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function ActivitiesPage() {
  const [benefit, setBenefit] = useState("all");
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [relatedOnly, setRelatedOnly] = useState(false);
  const [payload, setPayload] = useState<Record<string, any>>({ items: [] });
  const [syncStatus, setSyncStatus] = useState("读取中");
  const [filterStatus, setFilterStatus] = useState("准备中");
  const [toast, setToast] = useState("");

  const filters = useMemo(() => ({ status, benefit, search, relatedOnly, limit: 100 }), [benefit, relatedOnly, search, status]);
  const items = arrayOf<Record<string, any>>(payload.items);
  const stats = activityStats(payload);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function loadActivities() {
    setFilterStatus("读取中");
    try {
      const [statusPayload, activities] = await Promise.all([
        getJson<Record<string, any>>("/api/activities/status"),
        getJson<Record<string, any>>(activityQuery(filters))
      ]);
      setPayload(activities);
      setSyncStatus(statusPayload.running ? "同步中" : "已就绪");
      setFilterStatus(`${formatNumber(arrayOf(activities.items).length)} 件`);
    } catch (error: any) {
      setFilterStatus("失败");
      showToast(error.message || "活动读取失败。");
    }
  }

  useEffect(() => {
    void loadActivities();
  }, [filters]);

  async function startActivitySync() {
    try {
      const result = await sendJson<Record<string, any>>("/api/sync/dlsite-activities", { manual: true });
      setSyncStatus(result.alreadyRunning ? "已在同步" : "同步中");
      showToast(result.alreadyRunning ? "活动同步已经在运行。" : "已启动活动同步。");
      await loadActivities();
    } catch (error: any) {
      showToast(error.message || "启动活动同步失败。");
    }
  }

  async function markRead(id: string) {
    try {
      await sendJson(`/api/activity-alerts/${encodeURIComponent(id)}/read`, {});
      showToast("活动提醒已标记为已读。");
      await loadActivities();
    } catch (error: any) {
      showToast(error.message || "标记失败。");
    }
  }

  return (
    <>
      <MonitorTopNav title="活动中心" eyebrow="Activity 04 / DLsite 活动">
        <a className="link-action" href="/dashboard.html">返回 Monitor</a>
        <a className="link-action" href="/">返回搜索</a>
        <button className="primary-action" type="button" onClick={startActivitySync}>刷新活动</button>
        <span className="status-pill">{syncStatus}</span>
      </MonitorTopNav>

      <main className="monitor-shell activity-center-shell">
        <section className="metric-strip activity-center-metrics" data-section="01 Metrics" aria-label="活动概览">
          <div><span>当前结果</span><strong>{formatNumber(stats.resultCount)}</strong></div>
          <div><span>未读提醒</span><strong>{formatNumber(stats.unreadCount)}</strong></div>
          <div><span>可能相关</span><strong>{formatNumber(stats.matchCount)}</strong></div>
          <div><span>点数活动</span><strong>{formatNumber(stats.pointCount)}</strong></div>
        </section>

        <section className="activity-center-controls" data-section="02 Filter" aria-label="活动筛选">
          <div className="activity-filter-block">
            <span>福利类型</span>
            <div className="segmented-control" role="group" aria-label="福利类型">
              {benefitFilters.map(([key, label]) => (
                <button className={benefit === key ? "is-active" : ""} key={key} type="button" onClick={() => setBenefit(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="activity-filter-block">
            <span>状态</span>
            <div className="segmented-control" role="group" aria-label="活动状态">
              {statusFilters.map(([key, label]) => (
                <button className={status === key ? "is-active" : ""} key={key} type="button" onClick={() => setStatus(key)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="activity-search">
            <span>搜索</span>
            <input type="search" placeholder="活动标题或摘要" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="activity-related-toggle">
            <input type="checkbox" checked={relatedOnly} onChange={(event) => setRelatedOnly(event.target.checked)} />
            <span>只看与我相关</span>
          </label>
        </section>

        <section className="activity-pane activity-center-pane" data-section="03 Activity">
          <div className="section-head activity-head">
            <div>
              <h2>活动列表</h2>
              <p>{items.length ? `当前显示 ${formatNumber(items.length)} 个活动。` : "正在读取活动。"}</p>
            </div>
            <span className="status-pill">{filterStatus}</span>
          </div>
          <div className="activity-account">{accountLine(payload)}</div>
          <div className="activity-personal"><strong>本地相关性</strong><span>{personalSummaryLine(payload)}</span></div>
          <div className="activity-list activity-center-list">
            {items.length ? items.map((item) => <ActivityCard item={item} key={compactText(item.activityId, item.url)} onRead={markRead} />) : <div className="next-empty">当前筛选下没有活动。</div>}
          </div>
        </section>
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
