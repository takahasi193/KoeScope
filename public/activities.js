const state = {
  benefit: "all",
  status: "active",
  search: "",
  relatedOnly: false,
  payload: null,
  activityStatus: null,
  refreshInFlight: false,
  refreshTimer: null,
  searchTimer: null,
};

const BENEFIT_LABELS = {
  all: "全部",
  point: "点数",
  coupon: "优惠券",
  discount: "折扣",
  free: "免费",
  bonus: "福利",
  info: "专题",
};

const STATUS_LABELS = {
  active: "进行中",
  all: "全部",
  endingSoon: "即将结束",
  unread: "未读提醒",
};

const els = {
  activitySyncButton: document.querySelector("#activitySyncButton"),
  activityStatus: document.querySelector("#activityStatus"),
  activityFilterStatus: document.querySelector("#activityFilterStatus"),
  activityCaption: document.querySelector("#activityCaption"),
  activityAccount: document.querySelector("#activityAccount"),
  activityPersonal: document.querySelector("#activityPersonal"),
  activityList: document.querySelector("#activityList"),
  activityResultCount: document.querySelector("#activityResultCount"),
  activityUnreadCount: document.querySelector("#activityUnreadCount"),
  activityMatchCount: document.querySelector("#activityMatchCount"),
  activityPointCount: document.querySelector("#activityPointCount"),
  searchInput: document.querySelector("#activitySearchInput"),
  relatedOnlyInput: document.querySelector("#activityRelatedOnlyInput"),
  benefitButtons: [...document.querySelectorAll("[data-benefit-filter]")],
  statusButtons: [...document.querySelectorAll("[data-status-filter]")],
  toast: document.querySelector("#toast"),
};

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

const activityUi = window.DlsiteActivityUi.createActivityUi({
  formatNumber,
  formatPrice,
  formatDate,
  escapeHtml,
  escapeAttribute,
  detailPreviewLength: 74,
  relatedPreviewLimit: 3,
  detailFactLimit: 5,
});
const {
  formatTimeLeft,
  formatActivityWindow,
  renderActivityDetails,
  renderActivityAlerts,
  renderActivityRelatedWorks,
} = activityUi;

function buildActivitiesUrl() {
  const params = new URLSearchParams({
    status: state.status,
    benefit: state.benefit,
    limit: "100",
  });
  if (state.search) params.set("search", state.search);
  if (state.relatedOnly) params.set("related", "1");
  return `/api/activities?${params.toString()}`;
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

function syncFilterControls() {
  for (const button of els.benefitButtons) {
    button.classList.toggle("is-active", button.dataset.benefitFilter === state.benefit);
  }
  for (const button of els.statusButtons) {
    button.classList.toggle("is-active", button.dataset.statusFilter === state.status);
  }
  if (els.searchInput.value !== state.search) els.searchInput.value = state.search;
  els.relatedOnlyInput.checked = state.relatedOnly;
}

function renderOverview() {
  const payload = state.payload ?? {};
  const personal = payload.personalSummary ?? {};
  const account = payload.account ?? personal.account ?? {};
  const matches = payload.activityMatches ?? personal.relatedWorks ?? {};
  const items = payload.items ?? [];

  els.activityResultCount.textContent = formatNumber(items.length);
  els.activityUnreadCount.textContent = formatNumber(payload.unreadCount);
  els.activityMatchCount.textContent = formatNumber(matches.totalMatches);
  els.activityPointCount.textContent = formatNumber(account.pointsJpy);

  const latest = state.activityStatus?.latestRun ?? payload.syncStatus?.latestRun;
  if (state.activityStatus?.running || latest?.status === "running") {
    els.activityCaption.textContent = "正在刷新 DLsite 活动，完成后会自动更新。";
  } else if (latest?.status === "failed") {
    els.activityCaption.textContent = `活动刷新失败：${latest.error || "未知错误"}`;
  } else {
    const parts = [`${STATUS_LABELS[state.status]} / ${BENEFIT_LABELS[state.benefit]}`];
    if (state.search) parts.push(`搜索「${state.search}」`);
    if (state.relatedOnly) parts.push("只看与我相关");
    if (latest) parts.push(`上次刷新 ${formatDate(latest.finishedAt || latest.startedAt)}`);
    els.activityCaption.textContent = `${parts.join(" · ")} · ${formatNumber(items.length)} 个结果`;
  }

  els.activityFilterStatus.textContent = state.relatedOnly ? "相关筛选" : STATUS_LABELS[state.status];
  const syncText = account.lastSyncedAt ? `账号同步 ${formatDate(account.lastSyncedAt)}` : "账号尚未同步";
  const staleText = account.isStale ? " · 数据可能不是最新" : "";
  els.activityAccount.textContent = account.hasSession
    ? `当前点数 ${formatPrice(account.pointsJpy)} · ${syncText}${staleText}`
    : "连接 DLsite 账号后，这里会显示你的点数摘要；活动领取条件仍以外部页面为准。";

  const related = personal.relatedWorks ?? matches;
  els.activityPersonal.innerHTML = `
    <span>${escapeHtml(related.message || "当前活动会结合本地关注和 DLsite 愿望单做保守匹配。")}</span>
    <strong>${formatNumber(related.matchedWorks)} 个作品 / ${formatNumber(related.matchedActivities)} 个活动</strong>
  `;
}

function renderActivities() {
  const payload = state.payload ?? {};
  const items = payload.items ?? [];
  els.activityList.innerHTML = "";

  if (!items.length) {
    els.activityList.innerHTML = '<div class="empty">当前条件下暂无活动。</div>';
    return;
  }

  for (const item of items) {
    const node = document.createElement("article");
    node.className = "activity-card activity-center-card";
    node.innerHTML = `
      <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        <img src="${escapeAttribute(item.imageUrl)}" alt="" loading="lazy" />
      </a>
      <div class="activity-card-body">
        <a class="activity-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
        <div class="muted-line">
          <span class="badge discount">${escapeHtml(item.benefitLabel || "活动")}</span>
          <span class="badge">${escapeHtml(formatTimeLeft(item.endsAt))}</span>
          ${item.unreadAlerts?.length ? `<span class="badge drop">未读 ${formatNumber(item.unreadAlerts.length)}</span>` : ""}
          ${item.relatedWorks?.length ? `<span class="badge watch">相关 ${formatNumber(item.relatedWorks.length)}</span>` : ""}
        </div>
        <p class="activity-summary">${escapeHtml(item.benefitSummary || "打开活动页查看详情。")}</p>
        <p class="activity-summary">${escapeHtml(formatActivityWindow(item))}</p>
        ${renderActivityDetails(item.details)}
        ${renderActivityRelatedWorks(item.relatedWorks)}
        ${renderActivityAlerts(item.unreadAlerts)}
      </div>
    `;
    els.activityList.append(node);
  }
}

function renderAll() {
  syncFilterControls();
  setActivityStatus(state.activityStatus);
  renderOverview();
  renderActivities();
}

async function refreshAll() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    const [activityStatus, activities] = await Promise.all([
      getJson("/api/activities/status"),
      getJson(buildActivitiesUrl()),
    ]);
    state.activityStatus = activityStatus;
    state.payload = activities;
    renderAll();
  } catch (error) {
    toast(error.message);
    renderAll();
  } finally {
    state.refreshInFlight = false;
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
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshAll, 600);
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

function setBenefitFilter(benefit) {
  if (!BENEFIT_LABELS[benefit] || state.benefit === benefit) return;
  state.benefit = benefit;
  refreshAll();
}

function setStatusFilter(status) {
  if (!STATUS_LABELS[status] || state.status === status) return;
  state.status = status;
  refreshAll();
}

function setActivitySearch(search) {
  state.search = String(search ?? "").trim();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(refreshAll, 250);
}

function setRelatedOnly(relatedOnly) {
  state.relatedOnly = Boolean(relatedOnly);
  refreshAll();
}

function handleAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "read-activity-alert") markActivityAlertRead(button.dataset.id);
}

for (const button of els.benefitButtons) {
  button.addEventListener("click", () => setBenefitFilter(button.dataset.benefitFilter));
}
for (const button of els.statusButtons) {
  button.addEventListener("click", () => setStatusFilter(button.dataset.statusFilter));
}
els.searchInput.addEventListener("input", () => setActivitySearch(els.searchInput.value));
els.relatedOnlyInput.addEventListener("change", () => setRelatedOnly(els.relatedOnlyInput.checked));
els.activitySyncButton.addEventListener("click", startActivitySync);
document.addEventListener("click", handleAction);

window.__activityCenter = {
  state,
  buildActivitiesUrl,
  refreshAll,
  setBenefitFilter,
  setStatusFilter,
  setActivitySearch,
  setRelatedOnly,
  markActivityAlertRead,
};

refreshAll();
