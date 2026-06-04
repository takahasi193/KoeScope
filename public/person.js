const state = {
  personId: null,
  keyword: "",
  profile: null,
  works: null,
  sort: "hot",
  type: "all",
  age: "all",
  sessionId: "",
  workById: new Map(),
  subscription: null,
};

const els = {
  serverStatus: document.querySelector("#serverStatus"),
  personImage: document.querySelector("#personImage"),
  personName: document.querySelector("#personName"),
  personMeta: document.querySelector("#personMeta"),
  dataSource: document.querySelector("#dataSource"),
  aliasSummary: document.querySelector("#aliasSummary"),
  moegirlStatus: document.querySelector("#moegirlStatus"),
  moegirlSummary: document.querySelector("#moegirlSummary"),
  moegirlWorks: document.querySelector("#moegirlWorks"),
  moegirlSource: document.querySelector("#moegirlSource"),
  keywordInput: document.querySelector("#keywordInput"),
  keywordButton: document.querySelector("#keywordButton"),
  aliasCount: document.querySelector("#aliasCount"),
  aliasList: document.querySelector("#aliasList"),
  searchCount: document.querySelector("#searchCount"),
  recentList: document.querySelector("#recentList"),
  statsGrid: document.querySelector("#statsGrid"),
  workSummary: document.querySelector("#workSummary"),
  sortInput: document.querySelector("#sortInput"),
  sortButtons: [...document.querySelectorAll("[data-person-sort]")],
  typeInput: document.querySelector("#typeInput"),
  ageInput: document.querySelector("#ageInput"),
  activeSource: document.querySelector("#activeSource"),
  clearSessionButton: document.querySelector("#clearSessionButton"),
  subscriptionStatus: document.querySelector("#subscriptionStatus"),
  subscriptionMeta: document.querySelector("#subscriptionMeta"),
  subscribeButton: document.querySelector("#subscribeButton"),
  checkSubscriptionButton: document.querySelector("#checkSubscriptionButton"),
  unsubscribeButton: document.querySelector("#unsubscribeButton"),
  workList: document.querySelector("#workList"),
  toast: document.querySelector("#toast"),
};

function toast(message) {
  const text = String(message ?? "").trim() || "\u64cd\u4f5c\u5df2\u5b8c\u6210\u3002";
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3600);
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function postJson(url, body) {
  return sendJson(url, body, "POST");
}

async function sendJson(url, body = {}, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

const ANNOTATION_STATUS_LABELS = {
  favorite: "神作",
  owned: "已入",
  planned: "待购",
};

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

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString("ja-JP") : "0";
}

function formatDate(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function selectedSession() {
  return state.profile?.recentSearches?.find((session) => session.id === state.sessionId) ?? null;
}

function renderEmpty(message) {
  els.personName.textContent = "暂无本地详情";
  els.personMeta.textContent = message;
  els.dataSource.textContent = "数据来自本地搜索历史";
  els.personImage.removeAttribute("src");
  els.aliasSummary.innerHTML = "";
  els.aliasCount.textContent = "0";
  els.aliasList.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  els.searchCount.textContent = "0";
  els.recentList.innerHTML = '<div class="empty">还没有搜索记录。</div>';
  els.statsGrid.innerHTML = "";
  els.workSummary.textContent = message;
  els.workList.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  state.subscription = null;
  renderMoegirl(null);
  renderSubscription();
}

function renderMoegirl(moegirl) {
  const profile = moegirl ?? {};
  const status = profile.status || "not_found";
  const found = status === "found";
  const unavailable = status === "unavailable";
  els.moegirlStatus.textContent = found
    ? "萌娘百科资料"
    : unavailable
      ? "萌娘百科资料暂时无法读取"
      : "萌娘百科资料暂未匹配";
  els.moegirlSummary.textContent = found
    ? profile.summary || "萌娘百科条目暂未提供稳定简介。"
    : unavailable
      ? profile.error || "暂时无法读取萌娘百科公开页面，作品库仍可正常使用。"
      : "当前人物还没有匹配到可展示的萌娘百科资料。";

  if (found && profile.sourceUrl) {
    els.moegirlSource.href = profile.sourceUrl;
    els.moegirlSource.textContent = profile.title ? `来源：${profile.title}` : "来源：萌娘百科";
    els.moegirlSource.hidden = false;
  } else {
    els.moegirlSource.hidden = true;
  }

  const works = Array.isArray(profile.notableWorks) ? profile.notableWorks : [];
  els.moegirlWorks.innerHTML = works.length
    ? works
        .map(
          (work) => `
            <span class="moegirl-work-chip">
              <strong>${escapeHtml(work.title || "代表作品")}</strong>
              ${work.role ? `<span>${escapeHtml(work.role)}</span>` : ""}
            </span>
          `
        )
        .join("")
    : found && profile.representativeText
      ? `<span class="moegirl-work-chip"><strong>代表角色</strong><span>${escapeHtml(profile.representativeText)}</span></span>`
      : "";
}

function renderAliases() {
  const aliases = state.profile?.aliases ?? [];
  els.aliasCount.textContent = String(aliases.length);

  if (aliases.length === 0) {
    els.aliasList.innerHTML = '<div class="empty">本地历史里还没有保存别名。</div>';
    els.aliasSummary.innerHTML = "";
    return;
  }

  els.aliasSummary.innerHTML = aliases
    .slice(0, 6)
    .map((alias) => `<span class="tag">${escapeHtml(alias.value)}</span>`)
    .join("");
  els.aliasList.innerHTML = aliases
    .map(
      (alias) => `
        <span class="alias-chip ${alias.isPenName ? "pen" : ""}" title="${escapeAttribute(
          alias.sourceKeys?.join(", ") || ""
        )}">
          <span>${escapeHtml(alias.value)}</span>
          ${alias.isPenName ? '<span class="tag">马甲</span>' : ""}
        </span>
      `
    )
    .join("");
}

function renderStats() {
  const stats = state.profile?.stats ?? {};
  const cells = [
    ["总作品", stats.totalWorks],
    ["音声/ASMR", stats.voiceWorks],
    ["R18", stats.r18Works],
    ["全年龄", stats.generalWorks],
    ["已监测", stats.watchedWorks],
    ["可统计销量", stats.totalSales],
  ];

  els.statsGrid.innerHTML = cells
    .map(
      ([label, value]) => `
        <div class="stat-cell">
          <strong>${formatNumber(value ?? 0)}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      `
    )
    .join("");
}

function renderRecentSearches() {
  const searches = state.profile?.recentSearches ?? [];
  els.searchCount.textContent = String(searches.length);

  if (searches.length === 0) {
    els.recentList.innerHTML = '<div class="empty">还没有搜索记录。</div>';
    return;
  }

  els.recentList.innerHTML = searches
    .map(
      (session) => `
        <button class="recent-search ${session.id === state.sessionId ? "active" : ""}" data-session-id="${escapeAttribute(
        session.id
      )}" type="button">
          <strong>${formatDate(session.updatedAt)} · ${escapeHtml(session.orderLabel || session.order)}</strong>
          <span>${escapeHtml(session.aliases?.length ?? 0)} 个别名，${escapeHtml(session.total ?? 0)} 个结果，状态 ${escapeHtml(
        session.status
      )}</span>
        </button>
      `
    )
    .join("");
}

function renderProfile() {
  const profile = state.profile;
  if (!profile) return;

  const person = profile.person ?? {};
  document.title = `${person.name || "人物详情"} - KoeScope`;
  els.personName.textContent = person.name || "未命名人物";
  els.personImage.src = person.image || "";
  els.personImage.alt = person.name || "";
  els.dataSource.textContent = "数据来自本地搜索历史";
  els.personMeta.textContent = `Bangumi ID ${person.id ?? "未知"} · ${profile.stats.searchSessions} 次本地搜索 · 最近 ${formatDate(
    profile.stats.latestSearchAt
  )}`;
  if (person.name && !els.keywordInput.value) els.keywordInput.value = person.name;
  state.subscription = profile.subscription ?? null;

  renderAliases();
  renderStats();
  renderRecentSearches();
  renderMoegirl(profile.moegirl);
  renderSubscription();
}

function renderSubscription() {
  const subscription = state.subscription;
  if (!subscription) {
    els.subscriptionStatus.textContent = "\u672a\u8ba2\u9605";
    els.subscriptionMeta.textContent = "\u4fdd\u5b58\u8fd9\u4e2a\u4eba\u7269\u540e\uff0cKoeScope \u4f1a\u4f4e\u9891\u68c0\u67e5 DLsite \u53ef\u80fd\u76f8\u5173\u4f5c\u54c1\u3002";
    els.subscribeButton.textContent = "\u8ba2\u9605\u65b0\u4f5c";
    els.checkSubscriptionButton.hidden = true;
    els.unsubscribeButton.hidden = true;
    return;
  }

  const statusLabel =
    subscription.lastCheckStatus === "failed"
      ? "\u5df2\u8ba2\u9605\u00b7\u4e0a\u6b21\u68c0\u67e5\u5931\u8d25"
      : subscription.lastCheckStatus === "running"
        ? "\u6b63\u5728\u68c0\u67e5"
        : "\u5df2\u8ba2\u9605";
  const metaParts = [
    `${subscription.aliases?.length ?? 0} \u4e2a\u522b\u540d`,
    subscription.lastCheckedAt
      ? `\u4e0a\u6b21\u68c0\u67e5 ${formatDate(subscription.lastCheckedAt)}`
      : "\u8fd8\u6ca1\u6709\u68c0\u67e5\u8bb0\u5f55",
  ];
  if (subscription.lastCheckStatus === "failed" && subscription.lastError) {
    metaParts.push(subscription.lastError);
  } else if (subscription.lastCheckedAt) {
    metaParts.push(
      subscription.lastNewItemCount > 0
        ? `\u4e0a\u6b21\u65b0\u589e ${subscription.lastNewItemCount} \u6761\u63d0\u9192`
        : "\u4e0a\u6b21\u672a\u53d1\u73b0\u65b0\u63d0\u9192"
    );
  }

  els.subscriptionStatus.textContent = statusLabel;
  els.subscriptionMeta.textContent = metaParts.join(" \u00b7 ");
  els.subscribeButton.textContent = "\u66f4\u65b0\u8ba2\u9605";
  els.checkSubscriptionButton.hidden = false;
  els.unsubscribeButton.hidden = false;
}

function renderControls() {
  for (const button of els.sortButtons) {
    const active = button.dataset.personSort === state.sort;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  els.typeInput.value = state.type;
  els.ageInput.value = state.age;

  const session = selectedSession();
  els.activeSource.textContent = session
    ? `当前来源：${formatDate(session.updatedAt)} 的单次搜索`
    : "当前来源：全部本地搜索历史";
  els.clearSessionButton.hidden = !session;
}

function workAgeBadge(item) {
  const status = item.ageCategory ?? "unknown";
  return `<span class="tag age-status ${escapeAttribute(status)}">${escapeHtml(item.ageLabel ?? "未知")}</span>`;
}

function renderAnnotationSummary(annotation) {
  if (!annotation) return "";
  const tags = Array.isArray(annotation.tags) ? annotation.tags : [];
  const statusLabel = ANNOTATION_STATUS_LABELS[annotation.status] || "";
  if (!statusLabel && tags.length === 0 && !annotation.note) return "";
  return `
    <div class="work-annotation">
      <div class="meta-line">
        ${statusLabel ? `<span class="tag annotation-status">${escapeHtml(statusLabel)}</span>` : ""}
        ${tags.map((tag) => `<span class="tag annotation-tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      ${annotation.note ? `<p>${escapeHtml(annotation.note)}</p>` : ""}
    </div>
  `;
}

function renderWorks() {
  const payload = state.works;
  renderControls();
  state.workById = new Map((payload?.items ?? []).map((item) => [item.productId, item]));

  if (!payload) {
    els.workList.innerHTML = '<div class="empty">正在读取作品库。</div>';
    return;
  }

  const sourceText = selectedSession() ? "单次搜索" : "全部本地搜索历史";
  els.workSummary.textContent = `${sourceText} · ${payload.total} 个作品 · ${
    state.sort === "hot" ? "按销量排序" : "按最近搜索顺序"
  }。`;

  if (payload.items.length === 0) {
    els.workList.innerHTML = '<div class="empty">当前筛选没有作品。</div>';
    return;
  }

  els.workList.innerHTML = payload.items
    .map(
      (item, index) => `
        <article class="person-work">
          <div class="result-media">
            <span class="rank-badge">#${index + 1}</span>
            <img class="result-image" src="${escapeAttribute(item.image || "")}" alt="" loading="lazy" />
          </div>
          <div>
            <a class="result-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(
        item.title
      )}</a>
            <div class="meta-line">
              <span class="tag">${escapeHtml(item.typeLabel ?? item.type ?? "未知类型")}</span>
              ${workAgeBadge(item)}
              ${item.isWatched ? '<span class="tag watch-state">已关注</span>' : ""}
              ${item.circle ? `<span>${escapeHtml(item.circle)}</span>` : ""}
              ${item.priceJpy ? `<span>${formatNumber(item.priceJpy)}円</span>` : ""}
              ${item.sales ? `<span>销量 ${formatNumber(item.sales)}</span>` : ""}
            </div>
            <div class="meta-line">
              <span>命中：${escapeHtml((item.matchedAliases ?? []).join(" / ") || "本地历史")}</span>
              <span>来源：${formatDate(item.searchUpdatedAt)}</span>
            </div>
            ${renderAnnotationSummary(item.annotation)}
          </div>
          <div class="person-work-actions">
            <button class="result-watch" data-action="watch" data-product-id="${escapeAttribute(item.productId)}" type="button">
              ${item.isWatched ? "更新" : "监测"}
            </button>
            <button class="result-watch annotation-action" data-action="annotation" data-product-id="${escapeAttribute(item.productId)}" type="button">
              标注
            </button>
            <a class="result-open" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">打开</a>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadWorks() {
  if (!state.personId) return;
  const params = new URLSearchParams({
    sort: state.sort,
    type: state.type,
    age: state.age,
    limit: "120",
  });
  if (state.sessionId) params.set("sessionId", state.sessionId);
  state.works = await getJson(`/api/persons/${encodeURIComponent(state.personId)}/works?${params}`);
  renderWorks();
}

async function loadPerson(personId = state.personId) {
  state.personId = Number(personId);
  if (!Number.isFinite(state.personId)) {
    renderEmpty("URL 中缺少有效的 Bangumi personId。");
    return;
  }

  try {
    state.profile = await getJson(`/api/persons/${encodeURIComponent(state.personId)}/profile`);
    renderProfile();
    await loadWorks();
  } catch (error) {
    renderEmpty(error.message);
    toast(error.message);
  }
}

function subscriptionPayload() {
  const person = state.profile?.person ?? {};
  return {
    personName: person.name || state.keyword || "",
    personImage: person.image || "",
    sourceUrl: person.sourceUrl || "",
    keyword: state.keyword || person.name || "",
    aliases: (state.profile?.aliases ?? []).map((alias) => alias.value),
  };
}

function subscriptionSavedMessage(subscription, wasSubscribed) {
  const action = wasSubscribed
    ? "\u8ba2\u9605\u5df2\u66f4\u65b0"
    : "\u58f0\u4f18\u8ba2\u9605\u5df2\u4fdd\u5b58";
  const aliasCount = subscription?.aliases?.length ?? 0;
  return aliasCount > 0
    ? `${action}\uff1a${aliasCount} \u4e2a\u522b\u540d\u5c06\u7528\u4e8e\u65b0\u4f5c\u68c0\u67e5\u3002`
    : `${action}\u3002`;
}

function setSubscriptionBusy(busy) {
  els.subscribeButton.disabled = busy;
  els.checkSubscriptionButton.disabled = busy;
  els.unsubscribeButton.disabled = busy;
}

async function resolveKeyword() {
  const keyword = els.keywordInput.value.trim();
  if (!keyword) {
    toast("请输入人物名或别名。");
    return;
  }

  try {
    const payload = await postJson("/api/persons", { keyword, limit: 1 });
    const person = payload.persons?.[0];
    if (!person) throw new Error("Bangumi 没有找到候选人物。");
    state.keyword = keyword;
    state.sessionId = "";
    if (window.history?.replaceState) {
      window.history.replaceState(null, "", `/person.html?id=${encodeURIComponent(person.id)}`);
    }
    await loadPerson(person.id);
  } catch (error) {
    renderEmpty(error.message);
    toast(error.message);
  }
}

async function importWorkToMonitor(item) {
  const raw = window.prompt("目标价（日元，可留空）", item.priceJpy ? String(item.priceJpy) : "");
  if (raw === null) return;
  const targetPriceJpy = raw.trim() ? Number(raw.trim()) : null;
  if (raw.trim() && (!Number.isFinite(targetPriceJpy) || targetPriceJpy < 0)) {
    toast("目标价需要是有效数字。");
    return;
  }

  await postJson("/api/watchlist/import", {
    targetPriceJpy,
    work: {
      productId: item.productId,
      title: item.title,
      url: item.url,
      imageUrl: item.image,
      circle: item.circle,
      circleId: (item.circleUrl || "").match(/maker_id\/([^/.]+)/)?.[1] ?? "",
      floor: item.floor,
      ageCategory: item.ageCategory,
      workType: item.workType,
      categoryLabel: item.category,
      genres: item.genres,
      priceJpy: item.priceJpy,
      officialPriceJpy: item.priceJpy,
      sales: item.sales,
      ratingCount: item.ratingCount,
      raw: { source: "dl_voice_person_detail", searchSessionId: item.searchSessionId },
    },
  });
  toast(item.isWatched ? "已更新关注作品。" : "已加入监测关注。");
  await Promise.all([loadWorks(), loadPerson(state.personId)]);
}

async function editWorkAnnotation(item) {
  const annotation = item.annotation ?? {};
  const status = window.prompt("状态：favorite=神作, owned=已入, planned=待购，留空清除", annotation.status || "");
  if (status === null) return;
  const tags = window.prompt("标签（逗号分隔）", (annotation.tags ?? []).join(", "));
  if (tags === null) return;
  const note = window.prompt("本地备注", annotation.note || "");
  if (note === null) return;

  const saved = await sendJson(
    `/api/works/${encodeURIComponent(item.productId)}/annotation`,
    {
      status,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      note,
    },
    "PUT"
  );
  item.annotation = saved;
  toast("本地标注已保存。");
  await loadWorks();
}

async function saveSubscription() {
  if (!state.personId || !state.profile?.person?.name) {
    toast("\u8bf7\u5148\u52a0\u8f7d\u58f0\u4f18\u6863\u6848\u3002");
    return;
  }

  setSubscriptionBusy(true);
  try {
    const wasSubscribed = Boolean(state.subscription);
    state.subscription = await sendJson(
      `/api/persons/${encodeURIComponent(state.personId)}/subscription`,
      subscriptionPayload(),
      "PUT"
    );
    toast(subscriptionSavedMessage(state.subscription, wasSubscribed));
    await loadPerson(state.personId);
  } finally {
    setSubscriptionBusy(false);
  }
}

async function deleteSubscription() {
  if (!state.personId || !state.subscription) return;

  setSubscriptionBusy(true);
  try {
    await sendJson(`/api/persons/${encodeURIComponent(state.personId)}/subscription`, {}, "DELETE");
    state.subscription = null;
    toast("\u5df2\u53d6\u6d88\u8ba2\u9605\u3002");
    await loadPerson(state.personId);
  } finally {
    setSubscriptionBusy(false);
  }
}

async function checkSubscription() {
  if (!state.personId || !state.subscription) return;

  setSubscriptionBusy(true);
  try {
    const payload = await sendJson(
      `/api/persons/${encodeURIComponent(state.personId)}/subscription/check`,
      { reason: "manual" },
      "POST"
    );
    state.subscription = payload.subscription ?? state.subscription;
    toast(
      payload.newAlertCount
        ? `\u53d1\u73b0 ${payload.newAlertCount} \u6761\u65b0\u7684\u65b0\u4f5c\u63d0\u9192\u3002`
        : "\u672c\u6b21\u68c0\u67e5\u6ca1\u6709\u65b0\u63d0\u9192\u3002"
    );
    await loadPerson(state.personId);
  } finally {
    setSubscriptionBusy(false);
  }
}

async function setSort(sort) {
  state.sort = sort === "latest" ? "latest" : "hot";
  await loadWorks();
}

async function setFilters() {
  state.type = els.typeInput.value || "all";
  state.age = els.ageInput.value || "all";
  await loadWorks();
}

async function selectSession(sessionId) {
  state.sessionId = sessionId || "";
  renderRecentSearches();
  await loadWorks();
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("bad status");
    els.serverStatus.textContent = "已连接";
    els.serverStatus.classList.add("ok");
  } catch {
    els.serverStatus.textContent = "未连接";
    els.serverStatus.classList.add("error");
  }
}

function readInitialParams() {
  const params = new URLSearchParams(window.location.search);
  state.personId = Number(params.get("id"));
  state.keyword = params.get("keyword")?.trim() ?? "";
  if (state.keyword) els.keywordInput.value = state.keyword;
}

els.keywordButton.addEventListener("click", resolveKeyword);
els.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolveKeyword();
});
els.sortInput.addEventListener("click", (event) => {
  const button = event.target.closest("[data-person-sort]");
  if (button) setSort(button.dataset.personSort).catch((error) => toast(error.message));
});
els.typeInput.addEventListener("change", () => setFilters().catch((error) => toast(error.message)));
els.ageInput.addEventListener("change", () => setFilters().catch((error) => toast(error.message)));
els.clearSessionButton.addEventListener("click", () => selectSession("").catch((error) => toast(error.message)));
els.subscribeButton.addEventListener("click", () => saveSubscription().catch((error) => toast(error.message)));
els.checkSubscriptionButton.addEventListener("click", () => checkSubscription().catch((error) => toast(error.message)));
els.unsubscribeButton.addEventListener("click", () => deleteSubscription().catch((error) => toast(error.message)));
els.recentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");
  if (button) selectSession(button.dataset.sessionId).catch((error) => toast(error.message));
});
els.workList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = state.workById.get(button.dataset.productId);
  if (!item) return;
  if (button.dataset.action === "watch") {
    importWorkToMonitor(item).catch((error) => toast(error.message));
  }
  if (button.dataset.action === "annotation") {
    editWorkAnnotation(item).catch((error) => toast(error.message));
  }
});

readInitialParams();
renderEmpty("正在读取本地搜索历史。");
checkHealth();
if (state.personId) {
  loadPerson(state.personId);
} else if (state.keyword) {
  resolveKeyword();
} else {
  renderEmpty("请从首页人物候选进入详情页，或在上方输入名称。");
}

window.__personDetail = {
  state,
  loadPerson,
  loadWorks,
  resolveKeyword,
  setSort,
  selectSession,
  saveSubscription,
  checkSubscription,
  deleteSubscription,
};
