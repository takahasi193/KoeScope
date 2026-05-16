const state = {
  category: "all",
  floor: "home",
  period: "week",
  alertsStatus: "unread",
  ranking: null,
  summary: null,
  status: null,
  activityStatus: null,
  activities: null,
  activityAlertSummary: null,
  account: null,
  recommendations: null,
  bundleRecommendations: null,
  maintenance: null,
  alerts: [],
  watchlist: [],
  refreshTimer: null,
  refreshInFlight: false,
  dashboardNotificationKeys: new Set(),
};

const RUNNING_REFRESH_MS = 3000;
const IDLE_REFRESH_MS = 10000;
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
const CATEGORY_LABELS = {
  all: "总榜",
  voice: "ASMR/音声",
  game: "游戏",
  manga: "漫画",
};
const FLOOR_LABELS = {
  home: "全年龄",
  maniax: "R18",
};
const PERIOD_LABELS = {
  day: "日榜",
  week: "周榜",
  month: "月榜",
};
const els = {
  syncButton: document.querySelector("#syncButton"),
  syncStatus: document.querySelector("#syncStatus"),
  totalWorks: document.querySelector("#totalWorks"),
  discountedWorks: document.querySelector("#discountedWorks"),
  watchedWorks: document.querySelector("#watchedWorks"),
  unreadAlerts: document.querySelector("#unreadAlerts"),
  accountPoints: document.querySelector("#accountPoints"),
  activeActivities: document.querySelector("#activeActivities"),
  unreadActivityAlerts: document.querySelector("#unreadActivityAlerts"),
  lastSyncText: document.querySelector("#lastSyncText"),
  nextSyncText: document.querySelector("#nextSyncText"),
  activitySyncButton: document.querySelector("#activitySyncButton"),
  activityStatus: document.querySelector("#activityStatus"),
  activityCaption: document.querySelector("#activityCaption"),
  activityAccount: document.querySelector("#activityAccount"),
  activityList: document.querySelector("#activityList"),
  categoryInput: document.querySelector("#categoryInput"),
  floorInput: document.querySelector("#floorInput"),
  periodInput: document.querySelector("#periodInput"),
  rankingCaption: document.querySelector("#rankingCaption"),
  rankingBody: document.querySelector("#rankingBody"),
  alertList: document.querySelector("#alertList"),
  showAllAlertsButton: document.querySelector("#showAllAlertsButton"),
  accountState: document.querySelector("#accountState"),
  accountMeta: document.querySelector("#accountMeta"),
  accountSyncButton: document.querySelector("#accountSyncButton"),
  accountClearButton: document.querySelector("#accountClearButton"),
  recommendationCount: document.querySelector("#recommendationCount"),
  recommendationList: document.querySelector("#recommendationList"),
  bundleCount: document.querySelector("#bundleCount"),
  bundleList: document.querySelector("#bundleList"),
  maintenanceSummary: document.querySelector("#maintenanceSummary"),
  maintenanceDryRunButton: document.querySelector("#maintenanceDryRunButton"),
  maintenanceCleanupButton: document.querySelector("#maintenanceCleanupButton"),
  watchCount: document.querySelector("#watchCount"),
  watchList: document.querySelector("#watchList"),
  dropList: document.querySelector("#dropList"),
  historyPanel: document.querySelector("#historyPanel"),
  historyTitle: document.querySelector("#historyTitle"),
  historyMeta: document.querySelector("#historyMeta"),
  priceHistory: document.querySelector("#priceHistory"),
  rankHistory: document.querySelector("#rankHistory"),
  priceTrendChart: document.querySelector("#priceTrendChart"),
  rankTrendChart: document.querySelector("#rankTrendChart"),
  priceTrendEmpty: document.querySelector("#priceTrendEmpty"),
  rankTrendEmpty: document.querySelector("#rankTrendEmpty"),
  annotationForm: document.querySelector("#annotationForm"),
  annotationStatus: document.querySelector("#annotationStatus"),
  annotationTags: document.querySelector("#annotationTags"),
  annotationNote: document.querySelector("#annotationNote"),
  saveAnnotationButton: document.querySelector("#saveAnnotationButton"),
  deleteAnnotationButton: document.querySelector("#deleteAnnotationButton"),
  closeHistoryButton: document.querySelector("#closeHistoryButton"),
  toast: document.querySelector("#toast"),
};

const ANNOTATION_STATUS_LABELS = {
  favorite: "神作",
  owned: "已入",
  planned: "待购",
};

const historyCharts = {
  price: null,
  rank: null,
};
let deferredRefreshInFlight = false;
let chartLoadPromise = null;

function loadChartLibrary() {
  if (typeof window.Chart === "function") return Promise.resolve(true);
  if (chartLoadPromise) return chartLoadPromise;

  chartLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "/vendor/chart.js/chart.umd.js";
    script.async = true;
    script.onload = () => resolve(typeof window.Chart === "function");
    script.onerror = () => resolve(false);
    const target = document.head || document.body || document.documentElement;
    if (target?.append) target.append(script);
    else resolve(false);
  });

  return chartLoadPromise;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function sendJson(url, body = {}, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ja-JP") : "0";
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("ja-JP")}円` : "未知";
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDate(value) {
  if (!value) return "无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function imageSource(item) {
  return item?.cachedImageUrl || item?.imageUrl || "";
}

function imageFallbackAttribute(item) {
  const primary = item?.cachedImageUrl || "";
  const fallback = item?.imageUrl || item?.remoteImageUrl || "";
  return primary && fallback && primary !== fallback ? ` data-fallback-src="${escapeAttribute(fallback)}"` : "";
}

function installImageFallbacks() {
  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!image || image.tagName !== "IMG") return;
      const fallback = image.dataset?.fallbackSrc;
      if (!fallback) return;
      image.removeAttribute("data-fallback-src");
      image.src = fallback;
    },
    true
  );
}

const activityUi = window.DlsiteActivityUi.createActivityUi({
  formatNumber,
  formatPrice,
  formatDate,
  escapeHtml,
  escapeAttribute,
  detailPreviewLength: 54,
  relatedPreviewLimit: 2,
  detailFactLimit: 4,
});

installImageFallbacks();
const {
  formatTimeLeft,
  formatActivityWindow,
  renderActivityAlerts,
  renderActivityRelatedWorks,
} = activityUi;

function setStatus(status) {
  els.syncStatus.className = "status-pill";
  if (status?.running || status?.latestRun?.status === "running") {
    els.syncStatus.textContent = "同步中";
    els.syncStatus.classList.add("busy");
    els.syncButton.disabled = true;
    return;
  }
  if (status?.latestRun?.status === "failed") {
    els.syncStatus.textContent = "同步失败";
    els.syncStatus.classList.add("error");
    els.syncButton.disabled = false;
    return;
  }
  els.syncStatus.textContent = "就绪";
  els.syncStatus.classList.add("ok");
  els.syncButton.disabled = false;
}

function setActivityStatus(status) {
  els.activityStatus.className = "status-pill";
  if (status?.running || status?.latestRun?.status === "running") {
    els.activityStatus.textContent = "刷新中";
    els.activityStatus.classList.add("busy");
    els.activitySyncButton.disabled = true;
    return;
  }
  if (status?.latestRun?.status === "failed") {
    els.activityStatus.textContent = "刷新失败";
    els.activityStatus.classList.add("error");
    els.activitySyncButton.disabled = false;
    return;
  }
  els.activityStatus.textContent = "就绪";
  els.activityStatus.classList.add("ok");
  els.activitySyncButton.disabled = false;
}

function renderActivityAccount() {
  const account = state.activities?.account ?? state.account ?? {};
  const syncText = account.lastSyncedAt ? `账号同步 ${formatDate(account.lastSyncedAt)}` : "账号尚未同步";
  const staleText = account.isStale ? " · 数据可能不是最新" : "";
  els.activityAccount.textContent = account.hasSession
    ? `当前点数 ${formatPrice(account.pointsJpy)} · ${syncText}${staleText}`
    : "连接 DLsite 账号后，这里会显示你的点数摘要；活动领取条件仍以外部页面为准。";
}

function renderActivities() {
  const payload = state.activities ?? {};
  const items = payload.items ?? [];
  const activeTotal = state.summary?.activeActivities ?? items.length;
  renderActivityAccount();

  const latest = state.activityStatus?.latestRun ?? payload.syncStatus?.latestRun;
  if (state.activityStatus?.running || latest?.status === "running") {
    els.activityCaption.textContent = "正在刷新 DLsite 活动，完成后会自动更新。";
  } else if (latest?.status === "failed") {
    els.activityCaption.textContent = `活动刷新失败：${latest.error || "未知错误"}`;
  } else if (latest) {
    els.activityCaption.textContent = `进行中 ${formatNumber(activeTotal)} 个 · 上次刷新 ${formatDate(latest.finishedAt || latest.startedAt)} · 未读 ${formatNumber(payload.unreadCount)}`;
  } else {
    els.activityCaption.textContent = "还没有活动快照，点击刷新活动后会显示。";
  }

  els.activityList.innerHTML = "";
  if (!items.length) {
    els.activityList.innerHTML = '<div class="empty">当前暂无进行中的活动。</div>';
    return;
  }

  const visibleItems = items.slice(0, 3);
  for (const item of visibleItems) {
    const node = document.createElement("article");
    node.className = "activity-card";
    node.innerHTML = `
      <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        <img src="${escapeAttribute(imageSource(item))}"${imageFallbackAttribute(item)} alt="" loading="lazy" />
      </a>
      <div class="activity-card-body">
        <a class="activity-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
        <div class="muted-line">
          <span class="badge discount">${escapeHtml(item.benefitLabel || "活动")}</span>
          <span class="badge">${escapeHtml(formatTimeLeft(item.endsAt))}</span>
        </div>
        <p class="activity-summary">${escapeHtml(item.benefitSummary || "打开活动页查看详情。")}</p>
        <p class="activity-summary">${escapeHtml(formatActivityWindow(item))}</p>
        ${renderActivityRelatedWorks(item.relatedWorks)}
        ${renderActivityAlerts(item.unreadAlerts)}
      </div>
    `;
    els.activityList.append(node);
  }

  if (activeTotal > visibleItems.length) {
    const more = document.createElement("div");
    more.className = "activity-more";
    more.innerHTML = `<a class="link-action" href="/activities.html">查看全部 ${formatNumber(activeTotal)} 个活动</a>`;
    els.activityList.append(more);
  }
}

function renderSummary() {
  const summary = state.summary ?? {};
  els.totalWorks.textContent = formatNumber(summary.totalWorks);
  els.discountedWorks.textContent = formatNumber(summary.discountedWorks);
  els.watchedWorks.textContent = formatNumber(summary.watchedWorks);
  els.unreadAlerts.textContent = formatNumber(summary.unreadAlerts);
  els.accountPoints.textContent = formatNumber(state.account?.pointsJpy);
  els.activeActivities.textContent = formatNumber(summary.activeActivities);
  els.unreadActivityAlerts.textContent = formatNumber(summary.unreadActivityAlerts);

  const latest = state.status?.latestRun ?? summary.latestRun;
  if (!latest) {
    els.lastSyncText.textContent = "尚未同步。";
  } else if (latest.status === "running") {
    const progress = latest.progress ?? {};
    els.lastSyncText.textContent = `正在同步 ${progress.completedTargets ?? 0}/${progress.totalTargets ?? latest.totalTargets}：${progress.current || "准备中"}`;
  } else if (latest.status === "failed") {
    els.lastSyncText.textContent = `上次同步失败：${latest.error || "未知错误"}`;
  } else {
    els.lastSyncText.textContent = `上次同步：${formatDate(latest.finishedAt || latest.startedAt)}，${formatNumber(latest.enrichedWorks)} 个作品。`;
  }
  els.nextSyncText.textContent = `下次计划：${formatDate(state.status?.nextScheduledAt)}`;
}

function priceTrend(item) {
  if (!Number.isFinite(Number(item.priceDeltaJpy))) return '<span class="badge">无历史</span>';
  if (item.priceDeltaJpy < 0) {
    return `<span class="badge drop">${formatPrice(Math.abs(item.priceDeltaJpy))}↓</span>`;
  }
  if (item.priceDeltaJpy > 0) {
    return `<span class="badge">${formatPrice(item.priceDeltaJpy)}↑</span>`;
  }
  return '<span class="badge">持平</span>';
}

function discountBadge(item) {
  return item.latestDiscountRate
    ? `<span class="badge discount">${escapeHtml(item.latestDiscountRate)}%OFF</span>`
    : "";
}

function watchBadge(item) {
  return item.isWatched ? '<span class="badge watch">关注中</span>' : "";
}

function historicalLowBadge(item) {
  return item?.isHistoricalLow ? '<span class="badge historical-low">史低</span>' : "";
}

function alertTypeBadge(alert) {
  if (alert?.type === "possible_new_work") {
    return '<span class="badge discovery">可能的新作</span>';
  }
  if (alert?.type === "target_price") {
    return '<span class="badge discount">目标价</span>';
  }
  if (alert?.type === "price_drop") {
    return '<span class="badge drop">降价</span>';
  }
  return "";
}

function annotationSummary(annotation) {
  if (!annotation) return "";
  const tags = Array.isArray(annotation.tags) ? annotation.tags : [];
  const hasStatus = Boolean(annotation.status && ANNOTATION_STATUS_LABELS[annotation.status]);
  const hasTags = tags.length > 0;
  const hasNote = Boolean(annotation.note);
  if (!hasStatus && !hasTags && !hasNote) return "";

  const status = hasStatus
    ? `<span class="badge annotation-status">${escapeHtml(ANNOTATION_STATUS_LABELS[annotation.status])}</span>`
    : "";
  const tagBadges = tags
    .map((tag) => `<span class="badge annotation-tag">${escapeHtml(tag)}</span>`)
    .join("");
  const note = hasNote ? `<p class="annotation-note">${escapeHtml(annotation.note)}</p>` : "";
  return `
    <div class="annotation-summary">
      <div class="muted-line">${status}${tagBadges}</div>
      ${note}
    </div>
  `;
}

function renderRankingEmptyState(categoryLabel) {
  if (!syncIsRunning()) {
    els.rankingCaption.textContent = `还没有 ${categoryLabel} 快照数据。点击同步后会显示对应排行榜。`;
    els.rankingBody.innerHTML = '<tr><td colspan="5"><div class="empty">暂无排行数据。</div></td></tr>';
    return;
  }

  const progress = state.status?.latestRun?.progress ?? {};
  const completed = progress.completedTargets ?? 0;
  const total = progress.totalTargets ?? state.status?.latestRun?.totalTargets ?? 0;
  const current = progress.current || "准备中";
  const scope = `${categoryLabel} / ${FLOOR_LABELS[state.floor] ?? state.floor} / ${PERIOD_LABELS[state.period] ?? state.period}`;
  const progressText = total ? `同步进度 ${completed}/${total}` : "同步进行中";

  els.rankingCaption.textContent = `正在同步，${scope} 暂无快照；完成后会自动显示。`;
  els.rankingBody.innerHTML = `
    <tr>
      <td colspan="5">
        <div class="empty sync-empty">
          <div class="sync-empty-head">
            <span class="sync-spinner" aria-hidden="true"></span>
            <strong>${escapeHtml(progressText)}</strong>
          </div>
          <p>当前任务：${escapeHtml(current)}</p>
          <p>正在后台抓取排行榜；当前分类有数据后会自动刷新到这里。</p>
        </div>
      </td>
    </tr>
  `;
}

function renderRankings() {
  const ranking = state.ranking;
  const categoryLabel = CATEGORY_LABELS[state.category] ?? state.category;
  els.rankingBody.innerHTML = "";

  if (!ranking?.items?.length) {
    renderRankingEmptyState(categoryLabel);
    return;
  }

  els.rankingCaption.textContent = `${categoryLabel} / ${state.floor}/${state.period}，快照 ${formatDate(ranking.capturedAt)}。`;

  for (const item of ranking.items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="rank-cell">#${escapeHtml(item.latestRank)}</td>
      <td>
        <div class="work-cell">
          <img src="${escapeAttribute(imageSource(item))}"${imageFallbackAttribute(item)} alt="" loading="lazy" />
          <div>
            <a class="work-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
            <div class="muted-line">
              <span>${escapeHtml(item.circle || "未知社团")}</span>
              <span>${escapeHtml(item.workType || "SOU")}</span>
              ${watchBadge(item)}
            </div>
          </div>
        </div>
      </td>
      <td>
        <div class="price-main">${formatPrice(item.latestPriceJpy)}</div>
        <div class="price-sub">${item.latestOfficialPriceJpy && item.latestOfficialPriceJpy !== item.latestPriceJpy ? `原价 ${formatPrice(item.latestOfficialPriceJpy)}` : ""}</div>
      </td>
      <td>
        <div class="muted-line">
          ${priceTrend(item)}
          ${discountBadge(item)}
          ${historicalLowBadge(item)}
          <span class="badge">销售 ${formatNumber(item.latestSales)}</span>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="mini-button primary" data-action="watch" data-id="${escapeAttribute(item.productId)}" data-price="${escapeAttribute(item.latestPriceJpy)}" type="button">${item.isWatched ? "更新" : "关注"}</button>
          <button class="mini-button" data-action="history" data-id="${escapeAttribute(item.productId)}" type="button">历史</button>
        </div>
      </td>
    `;
    els.rankingBody.append(row);
  }
}

function renderAlerts() {
  els.alertList.innerHTML = "";
  if (!state.alerts.length) {
    els.alertList.innerHTML = '<div class="empty">没有未读提醒。</div>';
    return;
  }

  for (const alert of state.alerts) {
    const node = document.createElement("article");
    node.className = "mini-work";
    node.innerHTML = `
      <img src="${escapeAttribute(imageSource(alert))}"${imageFallbackAttribute(alert)} alt="" loading="lazy" />
      <div>
        <strong>${escapeHtml(alert.title || alert.productId)}</strong>
        <p>${escapeHtml(alert.message)} · ${formatDate(alert.createdAt)}</p>
        <div class="muted-line">
          ${alertTypeBadge(alert)}
          ${alert.personId ? `<a class="mini-link" href="/person.html?id=${encodeURIComponent(alert.personId)}">${escapeHtml(alert.personName || "人物详情")}</a>` : ""}
          ${historicalLowBadge(alert)}
        </div>
        <div class="mini-actions">
          <button class="mini-button" data-action="read-alert" data-id="${escapeAttribute(alert.id)}" type="button">已读</button>
          <button class="mini-button" data-action="history" data-id="${escapeAttribute(alert.productId)}" type="button">历史</button>
        </div>
      </div>
    `;
    els.alertList.append(node);
  }
}

function renderWatchlist() {
  els.watchCount.textContent = String(state.watchlist.length);
  els.watchList.innerHTML = "";
  if (!state.watchlist.length) {
    els.watchList.innerHTML = '<div class="empty">在排行榜中点击关注。</div>';
    return;
  }

  for (const item of state.watchlist) {
    const node = document.createElement("article");
    node.className = "mini-work";
    node.innerHTML = `
      <a class="mini-thumb" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        <img src="${escapeAttribute(imageSource(item))}"${imageFallbackAttribute(item)} alt="" loading="lazy" />
      </a>
      <div>
        <a class="mini-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.productId)}</a>
        <p>当前 ${formatPrice(item.latestPriceJpy)}${item.targetPriceJpy ? ` · 目标 ${formatPrice(item.targetPriceJpy)}` : ""}</p>
        ${annotationSummary(item.annotation)}
        <div class="mini-actions">
          <button class="mini-button" data-action="watch" data-id="${escapeAttribute(item.productId)}" data-price="${escapeAttribute(item.latestPriceJpy)}" type="button">目标价</button>
          <button class="mini-button" data-action="annotate" data-id="${escapeAttribute(item.productId)}" type="button">标注</button>
          <button class="mini-button" data-action="unwatch" data-id="${escapeAttribute(item.productId)}" type="button">移除</button>
        </div>
      </div>
    `;
    els.watchList.append(node);
  }
}

function renderDrops() {
  const drops = state.summary?.notableDrops ?? [];
  els.dropList.innerHTML = "";
  if (!drops.length) {
    els.dropList.innerHTML = '<div class="empty">暂无明显降价。</div>';
    return;
  }

  for (const item of drops) {
    const node = document.createElement("article");
    node.className = "mini-work";
    node.innerHTML = `
      <a class="mini-thumb" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        <img src="${escapeAttribute(imageSource(item))}"${imageFallbackAttribute(item)} alt="" loading="lazy" />
      </a>
      <div>
        <a class="mini-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.productId)}</a>
        <p>${formatPrice(item.previousPriceJpy)} → ${formatPrice(item.latestPriceJpy)}</p>
        <div class="muted-line">${historicalLowBadge(item)}</div>
      </div>
    `;
    els.dropList.append(node);
  }
}

function renderAccount() {
  const account = state.account ?? {};
  const listParts = Object.entries(account.lists ?? {})
    .filter(([, value]) => value.count > 0)
    .map(([type, value]) => `${type === "collection" ? "已购" : "关注"} ${formatNumber(value.count)}`);

  els.accountSyncButton.disabled = false;
  els.accountClearButton.disabled = !account.hasSession;

  if (!account.hasSession) {
    els.accountState.textContent = "未连接";
    els.accountMeta.textContent = "在 Chrome 中登录 DLsite 后，通过 KoeScope Companion 扩展同步账号。";
    return;
  }

  const statusLabel =
    account.loginState === "active"
      ? account.isStale
        ? "已连接，数据待刷新"
        : "已连接"
      : account.loginState === "expired" && account.lastSyncedAt
        ? "登录待确认"
        : account.loginState === "expired"
          ? "会话过期"
          : "待同步";
  const staleNote = account.isStale ? " · 数据可能不是最新，可继续使用上次成功同步数据" : "";
  els.accountState.textContent = `${statusLabel}${account.displayName ? ` · ${account.displayName}` : ""}`;
  els.accountMeta.textContent = `点数 ${formatPrice(account.pointsJpy)} · ${listParts.join(" · ") || "暂无账号列表"} · ${formatDate(account.lastSyncedAt)}${staleNote}`;
}

function recommendationBadges(item) {
  const reasons = item.reasons ?? [];
  return reasons.slice(0, 3).map((reason) => `<span class="badge">${escapeHtml(reason)}</span>`).join("");
}

function renderRecommendations() {
  const items = state.recommendations?.items ?? [];
  els.recommendationCount.textContent = String(items.length);
  els.recommendationList.innerHTML = "";

  if (!state.account?.hasSession) {
    els.recommendationList.innerHTML = '<div class="empty">连接账号后按点数推荐。</div>';
    return;
  }

  if (!items.length) {
    els.recommendationList.innerHTML = '<div class="empty">当前点数下暂无同时热门且实惠的候选。</div>';
    return;
  }

  for (const item of items) {
    const node = document.createElement("article");
    node.className = "mini-work recommendation";
    node.innerHTML = `
      <img src="${escapeAttribute(imageSource(item))}"${imageFallbackAttribute(item)} alt="" loading="lazy" />
      <div>
        <a class="mini-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.productId)}</a>
        <p>${formatPrice(item.latestPriceJpy)} · 热度 ${escapeHtml(item.popularityScore)} · 实惠 ${escapeHtml(item.valueScore)}</p>
        <div class="muted-line">${recommendationBadges(item)}</div>
      </div>
    `;
    els.recommendationList.append(node);
  }
}

function renderBundleRecommendations() {
  const bundles = state.bundleRecommendations?.items ?? [];
  els.bundleCount.textContent = String(bundles.length);
  els.bundleList.innerHTML = "";

  if (!state.account?.hasSession) {
    els.bundleList.innerHTML = '<div class="empty">连接账号后显示同社团组合。</div>';
    return;
  }

  if (!bundles.length) {
    els.bundleList.innerHTML = '<div class="empty">当前点数下暂无同社团预算组合。</div>';
    return;
  }

  for (const bundle of bundles) {
    const node = document.createElement("article");
    node.className = "bundle-recommendation";
    const titles = (bundle.items ?? [])
      .slice(0, 3)
      .map((item) => item.title || item.productId)
      .join(" / ");
    node.innerHTML = `
      <div class="bundle-summary">
        <strong>${escapeHtml(bundle.circle || "未知社团")}</strong>
        <span>${escapeHtml(bundle.itemCount)} 件 · ${formatPrice(bundle.totalPriceJpy)}</span>
      </div>
      <p>${escapeHtml(titles)}</p>
      <div class="muted-line">
        <span class="badge">余量 ${formatPrice(bundle.leftoverJpy)}</span>
        ${bundle.discountRate ? `<span class="badge">${escapeHtml(bundle.discountRate)}%OFF</span>` : ""}
        <span class="badge">非结算最优声明</span>
      </div>
    `;
    els.bundleList.append(node);
  }
}

function renderMaintenance() {
  const maintenance = state.maintenance;
  const syncRunning = anySyncIsRunning();
  els.maintenanceDryRunButton.disabled = syncRunning;
  els.maintenanceCleanupButton.disabled = syncRunning || !maintenance || maintenance.totalDeletable <= 0;

  if (!maintenance) {
    els.maintenanceSummary.textContent = "点击预览检查可清理快照。";
    return;
  }

  if (syncRunning) {
    els.maintenanceSummary.textContent = "同步运行中，数据维护会等同步结束后再执行。";
    return;
  }

  const priceCount = maintenance.priceSnapshots?.deletable ?? 0;
  const rankCount = maintenance.rankingSnapshots?.deletable ?? 0;
  const total = maintenance.totalDeletable ?? priceCount + rankCount;
  const cutoffText = formatDate(maintenance.cutoffAt);
  els.maintenanceSummary.innerHTML = `
    <p>一年以前可清理 ${formatNumber(total)} 条快照。</p>
    <div class="muted-line">
      <span class="badge">价格 ${formatNumber(priceCount)}</span>
      <span class="badge">排行 ${formatNumber(rankCount)}</span>
    </div>
    <p>最新、史低和提醒引用快照会保留；截止 ${escapeHtml(cutoffText)}。</p>
  `;
}

function destroyHistoryChart(key) {
  if (historyCharts[key]?.destroy) historyCharts[key].destroy();
  historyCharts[key] = null;
}

function renderHistoryChart(key, { canvas, empty, points, label, color, reverseY = false }) {
  destroyHistoryChart(key);
  const chartPoints = points
    .map((point) => ({ ...point, value: toFiniteNumber(point.value) }))
    .filter((point) => point.value !== null);
  const hasData = chartPoints.length > 0;
  if (empty) {
    empty.hidden = hasData;
    empty.textContent = hasData ? "" : "No trend data.";
  }
  if (canvas) canvas.hidden = !hasData;
  if (!hasData) return;

  const ChartConstructor = window.Chart;
  const context = typeof canvas?.getContext === "function" ? canvas.getContext("2d") : null;
  if (typeof ChartConstructor !== "function" || !context) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Chart unavailable.";
    }
    if (canvas) canvas.hidden = true;
    return;
  }

  historyCharts[key] = new ChartConstructor(context, {
    type: "line",
    data: {
      labels: chartPoints.map((point) => point.label),
      datasets: [
        {
          label,
          data: chartPoints.map((point) => point.value),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { intersect: false, mode: "index" },
      },
      scales: {
        x: {
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5 },
          grid: { display: false },
        },
        y: {
          reverse: reverseY,
          ticks: { precision: 0 },
        },
      },
    },
  });
}

function renderHistoryAnnotation(annotation = {}) {
  const productId = annotation.productId || els.historyPanel?.dataset?.productId || "";
  els.annotationForm.dataset.productId = productId;
  els.annotationStatus.value = annotation.status || "";
  els.annotationTags.value = Array.isArray(annotation.tags) ? annotation.tags.join(", ") : "";
  els.annotationNote.value = annotation.note || "";
}

function renderHistory(payload) {
  els.historyPanel.hidden = false;
  els.historyPanel.dataset.productId = payload.work.productId;
  els.historyTitle.textContent = payload.work.title || payload.work.productId;
  els.historyMeta.textContent = `${payload.work.productId} · ${payload.work.circle || "未知社团"}`;
  const priceSummary = payload.priceSummary ?? {};
  renderHistoryAnnotation(payload.annotation ?? payload.work.annotation ?? { productId: payload.work.productId });

  renderHistoryChart("price", {
    canvas: els.priceTrendChart,
    empty: els.priceTrendEmpty,
    label: "Price",
    color: "#0095ff",
    points: (payload.prices ?? []).map((item) => ({
      label: formatDate(item.capturedAt),
      value: toFiniteNumber(item.priceJpy),
    })),
  });

  renderHistoryChart("rank", {
    canvas: els.rankTrendChart,
    empty: els.rankTrendEmpty,
    label: "Rank",
    color: "#9b6200",
    reverseY: true,
    points: (payload.ranks ?? []).map((item) => ({
      label: `${formatDate(item.capturedAt)} ${item.floor || ""}/${item.period || ""}`,
      value: toFiniteNumber(item.rank),
    })),
  });

  els.priceHistory.innerHTML =
    payload.prices
      .slice(-10)
      .reverse()
      .map(
        (item) => `
          <div class="history-row">
            <span>${formatDate(item.capturedAt)}</span>
            <strong>${formatPrice(item.priceJpy)}${
              toFiniteNumber(item.priceJpy) !== null &&
              toFiniteNumber(item.priceJpy) === toFiniteNumber(priceSummary.historicalLowPriceJpy)
                ? ' <span class="badge historical-low">史低</span>'
                : ""
            }</strong>
          </div>
        `
      )
      .join("") || '<div class="empty">暂无价格历史。</div>';

  els.rankHistory.innerHTML =
    payload.ranks
      .slice(-10)
      .reverse()
      .map(
        (item) => `
          <div class="history-row">
            <span>${escapeHtml(item.floor)}/${escapeHtml(item.period)}</span>
            <strong>#${escapeHtml(item.rank)}</strong>
          </div>
        `
      )
      .join("") || '<div class="empty">暂无排名历史。</div>';
}

function closeHistory() {
  els.historyPanel.hidden = true;
  destroyHistoryChart("price");
  destroyHistoryChart("rank");
}

function renderAll() {
  renderSummary();
  setStatus(state.status);
  setActivityStatus(state.activityStatus);
  renderActivities();
  renderRankings();
  renderAlerts();
  renderAccount();
  renderRecommendations();
  renderBundleRecommendations();
  renderMaintenance();
  renderWatchlist();
  renderDrops();
}

function syncIsRunning(status = state.status) {
  return Boolean(status?.running || status?.latestRun?.status === "running");
}

function anySyncIsRunning() {
  return syncIsRunning(state.status) || syncIsRunning(state.activityStatus);
}

function scheduleRefresh(delayMs) {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null;
    refreshAll();
  }, delayMs);
}

function scheduleNextRefresh() {
  scheduleRefresh(syncIsRunning() ? RUNNING_REFRESH_MS : IDLE_REFRESH_MS);
}

function dashboardNotificationItems() {
  const priceAlerts = (state.alerts ?? [])
    .filter((alert) => alert.status === "unread" || state.alertsStatus === "unread")
    .map((alert) => ({
      key: `price:${alert.id || alert.type || "alert"}:${alert.productId || ""}`,
      title: alert.type === "possible_new_work" ? "KoeScope 新作提醒" : "KoeScope 价格提醒",
      body: alert.message || alert.title || alert.productId || "有新的 KoeScope 提醒。",
    }));
  const activityAlerts = (state.activityAlertSummary?.items ?? []).map((alert) => ({
    key: `activity:${alert.id || alert.activityId || "activity"}:${alert.type || ""}`,
    title: "KoeScope 活动提醒",
    body: alert.message || alert.activityTitle || "有新的 DLsite 活动提醒。",
  }));
  return [...priceAlerts, ...activityAlerts];
}

function notifyDashboardUnread() {
  const NotificationConstructor = window.Notification;
  if (typeof NotificationConstructor !== "function" || NotificationConstructor.permission !== "granted") return;

  for (const item of dashboardNotificationItems().slice(0, 4)) {
    if (state.dashboardNotificationKeys.has(item.key)) continue;
    state.dashboardNotificationKeys.add(item.key);
    new NotificationConstructor(item.title, {
      body: item.body,
      tag: item.key,
    });
  }
}

function dashboardStateUrl() {
  const params = new URLSearchParams({
    sections: PRIMARY_DASHBOARD_SECTIONS,
    floor: state.floor,
    period: state.period,
    category: state.category,
    alertsStatus: state.alertsStatus,
    activityLimit: "3",
    alertLimit: "50",
  });
  return `/api/dashboard/state?${params.toString()}`;
}

function deferredDashboardStateUrl() {
  const params = new URLSearchParams({
    sections: DEFERRED_DASHBOARD_SECTIONS,
  });
  return `/api/dashboard/state?${params.toString()}`;
}

async function loadDeferredDashboardSections() {
  if (deferredRefreshInFlight) return;
  deferredRefreshInFlight = true;

  try {
    const dashboardState = await getJson(deferredDashboardStateUrl());
    state.watchlist = dashboardState.watchlist?.items ?? [];
    state.recommendations = dashboardState.recommendations ?? {};
    state.bundleRecommendations = dashboardState.bundles ?? {};
    renderWatchlist();
    renderRecommendations();
    renderBundleRecommendations();
  } catch (error) {
    toast(error.message);
  } finally {
    deferredRefreshInFlight = false;
  }
}

async function refreshAll() {
  if (state.refreshInFlight) {
    scheduleRefresh(syncIsRunning() ? RUNNING_REFRESH_MS : 1000);
    return;
  }
  state.refreshInFlight = true;

  try {
    const dashboardState = await getJson(dashboardStateUrl());
    state.summary = dashboardState.summary ?? {};
    state.status = dashboardState.syncStatus ?? {};
    state.activityStatus = dashboardState.activityStatus ?? {};
    state.activities = dashboardState.activities ?? {};
    state.activityAlertSummary = dashboardState.activityAlerts ?? {};
    state.ranking = dashboardState.rankings ?? {};
    state.alerts = dashboardState.alerts?.items ?? [];
    state.account = dashboardState.account ?? {};
    renderAll();
    notifyDashboardUnread();
    loadDeferredDashboardSections();
  } catch (error) {
    toast(error.message);
    renderAll();
  } finally {
    state.refreshInFlight = false;
    scheduleNextRefresh();
  }
}

async function startSync() {
  try {
    const payload = await sendJson("/api/sync/dlsite-rankings", {
      priority: {
        category: state.category,
        floor: state.floor,
        period: state.period,
      },
    });
    state.status = { running: true, latestRun: payload.run };
    renderAll();
    toast(payload.alreadyRunning ? "同步已经在运行。" : "同步已启动。");
    scheduleRefresh(0);
  } catch (error) {
    toast(error.message);
  }
}

async function startActivitySync() {
  try {
    const payload = await sendJson("/api/sync/dlsite-activities", {
      reason: "manual",
    });
    state.activityStatus = { running: true, latestRun: payload.run };
    renderAll();
    toast(payload.alreadyRunning ? "活动刷新已经在运行。" : "活动刷新已启动。");
    scheduleRefresh(0);
  } catch (error) {
    toast(error.message);
  }
}

async function syncAccount() {
  toast("请在 Chrome 工具栏打开 KoeScope Companion，并点击“同步账号”。");
}

async function clearAccountSession() {
  try {
    await sendJson("/api/account/dlsite/session", {}, "DELETE");
    state.account = null;
    state.recommendations = null;
    toast("已断开 DLsite 账号。");
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function previewSnapshotCleanup() {
  try {
    state.maintenance = await getJson("/api/maintenance/snapshot-cleanup?retentionDays=365");
    renderMaintenance();
    toast(`可清理 ${formatNumber(state.maintenance.totalDeletable)} 条旧快照。`);
  } catch (error) {
    toast(error.message);
  }
}

async function runSnapshotCleanup() {
  if (anySyncIsRunning()) {
    toast("同步运行中，暂不执行数据维护。");
    return;
  }
  if (typeof window.confirm === "function") {
    const confirmed = window.confirm("执行本地快照清理？最新、史低和提醒引用快照会保留。");
    if (!confirmed) return;
  }

  try {
    const payload = await sendJson("/api/maintenance/snapshot-cleanup", {
      dryRun: false,
      retentionDays: 365,
    });
    state.maintenance = payload;
    renderMaintenance();
    toast(`已清理 ${formatNumber(payload.totalDeleted)} 条旧快照。`);
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function addOrUpdateWatch(productId, currentPrice) {
  let raw;
  try {
    raw = window.prompt("目标价（日元，可留空）", currentPrice ? String(currentPrice) : "");
  } catch {
    toast("当前浏览器不支持弹窗输入目标价。");
    return;
  }
  if (raw === null) return;
  const targetPriceJpy = raw.trim() ? Number(raw.trim()) : null;
  if (raw.trim() && (!Number.isFinite(targetPriceJpy) || targetPriceJpy < 0)) {
    toast("目标价需要是有效数字。");
    return;
  }

  try {
    await sendJson("/api/watchlist", { productId, targetPriceJpy });
    toast("关注已更新。");
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function removeWatch(productId) {
  try {
    await sendJson(`/api/watchlist/${encodeURIComponent(productId)}`, {}, "DELETE");
    toast("已移除关注。");
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function saveHistoryAnnotation(event) {
  event.preventDefault();
  const productId = els.annotationForm.dataset.productId;
  if (!productId) return;
  try {
    const annotation = await sendJson(
      `/api/works/${encodeURIComponent(productId)}/annotation`,
      {
        status: els.annotationStatus.value,
        tags: els.annotationTags.value
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        note: els.annotationNote.value,
      },
      "PUT"
    );
    renderHistoryAnnotation(annotation);
    toast("本地标注已保存。");
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function deleteHistoryAnnotation() {
  const productId = els.annotationForm.dataset.productId;
  if (!productId) return;
  try {
    const payload = await sendJson(`/api/works/${encodeURIComponent(productId)}/annotation`, {}, "DELETE");
    renderHistoryAnnotation(payload.annotation ?? { productId });
    toast("本地标注已清空。");
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function markAlertRead(id) {
  try {
    await sendJson(`/api/alerts/${encodeURIComponent(id)}/read`);
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function markActivityAlertRead(id) {
  try {
    await sendJson(`/api/activity-alerts/${encodeURIComponent(id)}/read`);
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
}

async function showHistory(productId, { focusAnnotation = false } = {}) {
  try {
    const payload = await getJson(`/api/works/${encodeURIComponent(productId)}/history`);
    await loadChartLibrary();
    renderHistory(payload);
    if (focusAnnotation) els.annotationNote.focus?.();
  } catch (error) {
    toast(error.message);
  }
}

function handleAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "watch") addOrUpdateWatch(id, button.dataset.price);
  if (action === "unwatch") removeWatch(id);
  if (action === "annotate") showHistory(id, { focusAnnotation: true });
  if (action === "read-alert") markAlertRead(id);
  if (action === "read-activity-alert") markActivityAlertRead(id);
  if (action === "history") showHistory(id);
}

els.syncButton.addEventListener("click", startSync);
els.activitySyncButton.addEventListener("click", startActivitySync);
els.categoryInput.addEventListener("change", async () => {
  state.category = els.categoryInput.value;
  await refreshAll();
});
els.floorInput.addEventListener("change", async () => {
  state.floor = els.floorInput.value;
  await refreshAll();
});
els.periodInput.addEventListener("change", async () => {
  state.period = els.periodInput.value;
  await refreshAll();
});
els.showAllAlertsButton.addEventListener("click", async () => {
  state.alertsStatus = state.alertsStatus === "unread" ? "all" : "unread";
  els.showAllAlertsButton.textContent = state.alertsStatus === "unread" ? "全部" : "未读";
  await refreshAll();
});
els.accountSyncButton.addEventListener("click", syncAccount);
els.accountClearButton.addEventListener("click", clearAccountSession);
els.maintenanceDryRunButton.addEventListener("click", previewSnapshotCleanup);
els.maintenanceCleanupButton.addEventListener("click", runSnapshotCleanup);
els.annotationForm.addEventListener("submit", saveHistoryAnnotation);
els.deleteAnnotationButton.addEventListener("click", deleteHistoryAnnotation);
els.closeHistoryButton.addEventListener("click", closeHistory);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.historyPanel.hidden) closeHistory();
});
document.addEventListener("click", handleAction);

refreshAll();
