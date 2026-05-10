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
};

const els = {
  serverStatus: document.querySelector("#serverStatus"),
  personImage: document.querySelector("#personImage"),
  personName: document.querySelector("#personName"),
  personMeta: document.querySelector("#personMeta"),
  dataSource: document.querySelector("#dataSource"),
  aliasSummary: document.querySelector("#aliasSummary"),
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
  workList: document.querySelector("#workList"),
  toast: document.querySelector("#toast"),
};

function toast(message) {
  els.toast.textContent = message;
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
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
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
  document.title = `${person.name || "声优详情"} - KoeScope`;
  els.personName.textContent = person.name || "未命名人物";
  els.personImage.src = person.image || "";
  els.personImage.alt = person.name || "";
  els.dataSource.textContent = "数据来自本地搜索历史";
  els.personMeta.textContent = `Bangumi ID ${person.id ?? "未知"} · ${profile.stats.searchSessions} 次本地搜索 · 最近 ${formatDate(
    profile.stats.latestSearchAt
  )}`;
  if (person.name && !els.keywordInput.value) els.keywordInput.value = person.name;

  renderAliases();
  renderStats();
  renderRecentSearches();
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
          </div>
          <div class="person-work-actions">
            <button class="result-watch" data-action="watch" data-product-id="${escapeAttribute(item.productId)}" type="button">
              ${item.isWatched ? "更新" : "监测"}
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

async function resolveKeyword() {
  const keyword = els.keywordInput.value.trim();
  if (!keyword) {
    toast("请输入声优名或马甲。");
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
els.recentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");
  if (button) selectSession(button.dataset.sessionId).catch((error) => toast(error.message));
});
els.workList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='watch']");
  if (!button) return;
  const item = state.workById.get(button.dataset.productId);
  if (item) importWorkToMonitor(item).catch((error) => toast(error.message));
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
};
