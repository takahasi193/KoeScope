const DEFAULT_BACKEND = "http://localhost:5178";
const HISTORY_LIMIT = 8;
const ALIAS_RENDER_LIMIT = 20;
const DEFAULT_MAX_PAGES = 50;
const MAX_PAGES = 100;
const DLSITE_LOGIN_URL = "https://www.dlsite.com/home/mypage";
const ACCOUNT_SYNC_STATUS_KEY = "dlsiteAccountSyncStatus";

const state = {
  backendBase: DEFAULT_BACKEND,
  candidates: [],
  selectedPersonId: null,
  results: null,
  activeType: "all",
  activeAge: "all",
  history: [],
  account: null,
  accountSyncStatus: null,
  accountSyncPollTimer: null,
  searchJobId: null,
  searchPollTimer: null,
  searchRunToken: 0,
};

const els = {
  serverStatus: document.querySelector("#serverStatus"),
  backendSettings: document.querySelector("#backendSettings"),
  backendBaseInput: document.querySelector("#backendBaseInput"),
  saveBackendButton: document.querySelector("#saveBackendButton"),
  accountStatus: document.querySelector("#accountStatus"),
  accountSummary: document.querySelector("#accountSummary"),
  openDlsiteLoginButton: document.querySelector("#openDlsiteLoginButton"),
  syncDlsiteAccountButton: document.querySelector("#syncDlsiteAccountButton"),
  deepSyncDlsiteAccountButton: document.querySelector("#deepSyncDlsiteAccountButton"),
  openDashboardButton: document.querySelector("#openDashboardButton"),
  keywordInput: document.querySelector("#keywordInput"),
  resolveButton: document.querySelector("#resolveButton"),
  searchButton: document.querySelector("#searchButton"),
  scopeInput: document.querySelector("#scopeInput"),
  orderInput: document.querySelector("#orderInput"),
  pagesInput: document.querySelector("#pagesInput"),
  perPageInput: document.querySelector("#perPageInput"),
  verifyDetailsInput: document.querySelector("#verifyDetailsInput"),
  adultConfirmInput: document.querySelector("#adultConfirmInput"),
  historyPanel: document.querySelector("#historyPanel"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  candidateCount: document.querySelector("#candidateCount"),
  candidateList: document.querySelector("#candidateList"),
  aliasCount: document.querySelector("#aliasCount"),
  aliasList: document.querySelector("#aliasList"),
  selectPenNamesButton: document.querySelector("#selectPenNamesButton"),
  selectAllAliasesButton: document.querySelector("#selectAllAliasesButton"),
  clearAliasesButton: document.querySelector("#clearAliasesButton"),
  summary: document.querySelector("#summary"),
  typeTabs: document.querySelector("#typeTabs"),
  ageTabs: document.querySelector("#ageTabs"),
  resultList: document.querySelector("#resultList"),
  openFullAppButton: document.querySelector("#openFullAppButton"),
  toast: document.querySelector("#toast"),
};

function normalizeKeyword(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function getChromeStorage() {
  return globalThis.chrome?.storage?.local;
}

async function readChromeStorage(keys) {
  const storage = getChromeStorage();
  if (!storage) return {};
  return storage.get(keys);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new Error("扩展后台不可用，请重新加载扩展。"));
      return;
    }

    globalThis.chrome.runtime.sendMessage(message, (response) => {
      const error = globalThis.chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response ?? {});
    });
  });
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function apiUrl(path) {
  return `${state.backendBase}${path}`;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ja-JP") : "0";
}

function formatDate(value) {
  if (!value) return "未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function accountStatusLabel(account) {
  if (account?.loginState === "active") return account.isStale ? "已连接，数据待刷新" : "已连接";
  if (account?.loginState === "expired") return account.lastSyncedAt ? "登录待确认" : "会话过期";
  return "待同步";
}

function accountSummaryText(account) {
  const listParts = Object.entries(account?.lists ?? {})
    .filter(([, value]) => value.count > 0)
    .map(([type, value]) => `${type === "collection" ? "已购" : "关注"} ${formatNumber(value.count)}`);
  const freshness = account?.isStale ? " · 数据可能不是最新" : "";
  return `点数 ${formatNumber(account?.pointsJpy)}円${account?.displayName ? ` · ${account.displayName}` : ""} · ${listParts.join(" · ") || "暂无账号列表"} · ${formatDate(account?.lastSyncedAt)}${freshness}`;
}

async function loadSettings() {
  const storage = getChromeStorage();
  if (!storage) {
    els.backendBaseInput.value = state.backendBase;
    return;
  }

  const data = await storage.get(["backendBase", "pendingKeyword", "searchHistory", "popupSettings"]);
  state.backendBase = normalizeBackend(data.backendBase) || DEFAULT_BACKEND;
  state.history = Array.isArray(data.searchHistory) ? data.searchHistory.slice(0, HISTORY_LIMIT) : [];

  const settings = data.popupSettings ?? {};
  if (["all", "adult", "nonAdult"].includes(settings.scope)) els.scopeInput.value = settings.scope;
  if (["release_d", "dl_d"].includes(settings.order)) els.orderInput.value = settings.order;

  const storedPages = Number(settings.pages);
  els.pagesInput.value =
    Number.isFinite(storedPages) && storedPages > 1
      ? String(clampNumber(storedPages, 1, MAX_PAGES, DEFAULT_MAX_PAGES))
      : String(DEFAULT_MAX_PAGES);

  if ([30, 50, 100].includes(Number(settings.perPage))) {
    els.perPageInput.value = String(settings.perPage);
  }
  els.verifyDetailsInput.checked = Boolean(settings.verifyDetails);
  els.backendBaseInput.value = state.backendBase;

  const pendingKeyword = normalizeKeyword(data.pendingKeyword);
  if (pendingKeyword) {
    els.keywordInput.value = pendingKeyword;
    await storage.remove(["pendingKeyword", "pendingKeywordAt"]);
    await globalThis.chrome?.action?.setBadgeText?.({ text: "" });
  }
}

function normalizeBackend(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return raw;
  return "";
}

async function saveBackend() {
  const backendBase = normalizeBackend(els.backendBaseInput.value);
  if (!backendBase) {
    toast("后端地址只能是 localhost 或 127.0.0.1。");
    els.backendBaseInput.value = state.backendBase;
    return;
  }

  state.backendBase = backendBase;
  const storage = getChromeStorage();
  if (storage) await storage.set({ backendBase });
  toast("后端地址已保存。");
  if (await checkHealth()) await loadAccountProfile();
}

async function savePopupSettings() {
  const storage = getChromeStorage();
  if (!storage) return;

  await storage.set({
    popupSettings: {
      scope: els.scopeInput.value,
      order: els.orderInput.value || "release_d",
      pages: clampNumber(els.pagesInput.value, 1, MAX_PAGES, DEFAULT_MAX_PAGES),
      perPage: Number(els.perPageInput.value) || 100,
      verifyDetails: els.verifyDetailsInput.checked,
    },
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

async function postJson(path, body) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function getJson(path) {
  const response = await fetch(apiUrl(path));
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function renderAccount() {
  const sync = state.accountSyncStatus;
  if (sync?.status === "running") {
    els.accountStatus.textContent = "同步中";
    els.accountSummary.textContent = sync.message || "正在后台同步 DLsite 账号...";
    els.syncDlsiteAccountButton.disabled = true;
    els.deepSyncDlsiteAccountButton.disabled = true;
    return;
  }

  if (sync?.status === "failed") {
    els.accountStatus.textContent = state.account?.hasSession ? "同步失败，显示缓存" : "同步失败";
    els.accountSummary.textContent = state.account?.hasSession
      ? `${sync.error || sync.message || "账号同步异常终止。"} · 上次数据：${accountSummaryText(state.account)}`
      : sync.error || sync.message || "账号同步异常终止。";
    els.syncDlsiteAccountButton.disabled = false;
    els.deepSyncDlsiteAccountButton.disabled = false;
    return;
  }

  const account = state.account;
  if (!account?.hasSession) {
    els.accountStatus.textContent = "未连接";
    els.accountSummary.textContent = "先在 Chrome 登录 DLsite，再点击同步账号。";
    els.syncDlsiteAccountButton.disabled = false;
    els.deepSyncDlsiteAccountButton.disabled = false;
    return;
  }

  els.accountStatus.textContent = accountStatusLabel(account);
  els.accountSummary.textContent = accountSummaryText(account);
  els.syncDlsiteAccountButton.disabled = false;
  els.deepSyncDlsiteAccountButton.disabled = false;
}

async function loadAccountProfile() {
  try {
    state.account = await getJson("/api/account/dlsite");
    renderAccount();
  } catch {
    state.account = null;
    renderAccount();
  }
}

async function loadAccountSyncStatus() {
  const data = await readChromeStorage(ACCOUNT_SYNC_STATUS_KEY);
  state.accountSyncStatus = data[ACCOUNT_SYNC_STATUS_KEY] ?? null;
  renderAccount();
  if (state.accountSyncStatus?.status === "running") scheduleAccountSyncPoll();
}

function scheduleAccountSyncPoll(delayMs = 1000) {
  clearTimeout(state.accountSyncPollTimer);
  state.accountSyncPollTimer = setTimeout(refreshAccountSyncStatus, delayMs);
}

async function refreshAccountSyncStatus() {
  await loadAccountSyncStatus();
  if (state.accountSyncStatus?.status === "completed") await loadAccountProfile();
}

async function syncDlsiteAccount(mode = "quick") {
  els.syncDlsiteAccountButton.disabled = true;
  els.deepSyncDlsiteAccountButton.disabled = true;
  const isDeep = mode === "full";
  state.accountSyncStatus = {
    status: "running",
    mode,
    message: isDeep ? "已交给扩展后台深度同步，可以关闭弹窗。" : "已交给扩展后台快速同步，可以关闭弹窗。",
    updatedAt: new Date().toISOString(),
  };
  renderAccount();
  try {
    const response = await sendRuntimeMessage({
      type: "START_DLSITE_ACCOUNT_SYNC",
      backendBase: state.backendBase,
      mode,
    });
    toast(response.alreadyRunning ? "账号同步已经在后台运行。" : isDeep ? "深度同步已在后台启动。" : "快速同步已在后台启动。");
    scheduleAccountSyncPoll(700);
  } catch (error) {
    state.accountSyncStatus = { status: "failed", error: error.message, updatedAt: new Date().toISOString() };
    toast(error.message);
    renderAccount();
  }
}

async function openDlsiteLogin() {
  if (globalThis.chrome?.tabs?.create) {
    await globalThis.chrome.tabs.create({ url: DLSITE_LOGIN_URL });
    return;
  }
  window.open(DLSITE_LOGIN_URL, "_blank", "noreferrer");
}

async function openDashboard() {
  const url = `${state.backendBase}/dashboard.html`;
  if (globalThis.chrome?.tabs?.create) {
    await globalThis.chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noreferrer");
}

function selectedPerson() {
  return state.candidates.find((person) => person.id === state.selectedPersonId) ?? null;
}

function selectedAliases() {
  return [...els.aliasList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function searchIsRunning() {
  return Boolean(state.results?.progress && !state.results.progress.isComplete);
}

function clearSearchPolling() {
  clearTimeout(state.searchPollTimer);
  state.searchPollTimer = null;
  state.searchJobId = null;
  state.searchRunToken += 1;
}

function scheduleSearchPoll(delayMs = 1000) {
  clearTimeout(state.searchPollTimer);
  const jobId = state.searchJobId;
  const token = state.searchRunToken;
  if (!jobId) return;

  state.searchPollTimer = setTimeout(() => {
    pollProgressiveSearch(jobId, token);
  }, delayMs);
}

async function pollProgressiveSearch(jobId, token) {
  if (!jobId || token !== state.searchRunToken) return;

  try {
    const payload = await getJson(`/api/search/progressive/${encodeURIComponent(jobId)}`);
    if (token !== state.searchRunToken) return;

    state.results = payload;
    renderResults();

    if (payload.progress?.isComplete) {
      state.searchJobId = null;
      toast(payload.progress.status === "failed" ? "后台加载失败。" : "搜索完成。");
      return;
    }

    scheduleSearchPoll(1000);
  } catch (error) {
    if (token !== state.searchRunToken) return;
    clearSearchPolling();
    renderResults();
    toast(error.message);
  }
}

function setBusy(isBusy, label = "") {
  els.resolveButton.disabled = isBusy;
  els.searchButton.disabled = isBusy || !selectedPerson() || searchIsRunning();
  els.saveBackendButton.disabled = isBusy;
  els.syncDlsiteAccountButton.disabled = isBusy;
  els.deepSyncDlsiteAccountButton.disabled = isBusy;
  els.openDlsiteLoginButton.disabled = isBusy;
  els.openDashboardButton.disabled = isBusy;
  document.body.classList.toggle("busy", isBusy);
  if (label) els.summary.textContent = label;
}

function renderHistory() {
  els.historyPanel.hidden = state.history.length === 0;
  els.historyList.innerHTML = "";

  for (const keyword of state.history) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = keyword;
    button.addEventListener("click", async () => {
      els.keywordInput.value = keyword;
      await resolvePersons();
    });
    els.historyList.append(button);
  }
}

async function addHistory(keyword) {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return;

  state.history = [normalized, ...state.history.filter((item) => item !== normalized)].slice(
    0,
    HISTORY_LIMIT
  );
  renderHistory();

  const storage = getChromeStorage();
  if (storage) await storage.set({ searchHistory: state.history });
}

async function clearHistory() {
  state.history = [];
  renderHistory();

  const storage = getChromeStorage();
  if (storage) await storage.remove("searchHistory");
}

function renderCandidates() {
  els.candidateCount.textContent = String(state.candidates.length);
  els.candidateList.innerHTML = "";

  if (state.candidates.length === 0) {
    els.candidateList.innerHTML = '<div class="empty">没有候选人物。</div>';
    state.selectedPersonId = null;
    renderAliases();
    return;
  }

  for (const person of state.candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `candidate ${person.id === state.selectedPersonId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(person.name)}</strong>
      <small>${escapeHtml(aliasPreview(person) || `Bangumi person #${person.id}`)}</small>
    `;
    button.addEventListener("click", () => {
      clearSearchPolling();
      state.selectedPersonId = person.id;
      state.results = null;
      state.activeType = "all";
      state.activeAge = "all";
      renderCandidates();
      renderAliases();
      renderResults();
    });
    els.candidateList.append(button);
  }
}

function aliasPreview(person) {
  const penNames = person.aliases.filter((alias) => alias.isPenName).slice(0, 3);
  const sample = penNames.length ? penNames : person.aliases.slice(0, 3);
  return sample.map((alias) => alias.value).join(" / ");
}

function renderAliases() {
  const person = selectedPerson();
  els.aliasList.innerHTML = "";
  els.aliasCount.textContent = person ? String(person.aliases.length) : "0";
  els.searchButton.disabled = !person || searchIsRunning();

  if (!person) {
    els.aliasList.innerHTML = '<div class="empty">请选择候选人物。</div>';
    return;
  }

  person.aliases.slice(0, ALIAS_RENDER_LIMIT).forEach((alias, index) => {
    const label = document.createElement("label");
    label.className = `alias-chip ${alias.isPenName ? "pen" : ""}`;
    label.title = alias.sourceKeys.join(", ");
    label.innerHTML = `
      <input type="checkbox" value="${escapeAttribute(alias.value)}" ${index < 8 ? "checked" : ""} />
      <span>${escapeHtml(alias.value)}</span>
    `;
    els.aliasList.append(label);
  });
}

function setAliasSelection(mode) {
  const person = selectedPerson();
  if (!person) return;

  const inputs = [...els.aliasList.querySelectorAll('input[type="checkbox"]')];
  inputs.forEach((input, index) => {
    const alias = person.aliases[index];
    if (mode === "all") input.checked = true;
    if (mode === "none") input.checked = false;
    if (mode === "pen") input.checked = Boolean(alias?.isPenName) || index === 0;
  });
}

function groupCounts(results) {
  return {
    all: { key: "all", label: "全部", count: results?.total ?? 0 },
    ...(results?.groups ?? {}),
  };
}

function ageGroupCounts(results, activeType = "all") {
  const groups = {
    all: { key: "all", label: "全部年龄", count: results?.total ?? 0 },
    ...(results?.ageGroups ?? {}),
  };

  if (!results || activeType === "all") return groups;

  const typedItems = results.items.filter((item) => item.type === activeType);
  return Object.fromEntries(
    Object.entries(groups).map(([key, group]) => [
      key,
      {
        ...group,
        count:
          key === "all"
            ? typedItems.length
            : typedItems.filter((item) => item.ageCategory === key).length,
      },
    ])
  );
}

function renderTabSet(container, groups, activeKey, onSelect) {
  container.innerHTML = "";

  for (const group of Object.values(groups)) {
    if (group.count === 0 && group.key !== "all") continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${activeKey === group.key ? "active" : ""}`;
    button.textContent = `${group.label} ${group.count}`;
    button.addEventListener("click", () => onSelect(group.key));
    container.append(button);
  }
}

function renderTabs() {
  if (!state.results) {
    els.typeTabs.innerHTML = "";
    els.ageTabs.innerHTML = "";
    return;
  }

  renderTabSet(els.typeTabs, groupCounts(state.results), state.activeType, (key) => {
    state.activeType = key;
    state.activeAge = "all";
    renderResults();
  });

  renderTabSet(els.ageTabs, ageGroupCounts(state.results, state.activeType), state.activeAge, (key) => {
    state.activeAge = key;
    renderResults();
  });
}

function filteredItems(results) {
  return results.items.filter((item) => {
    const typeMatches = state.activeType === "all" || item.type === state.activeType;
    const ageMatches = state.activeAge === "all" || item.ageCategory === state.activeAge;
    return typeMatches && ageMatches;
  });
}

function renderResults() {
  const results = state.results;
  els.resultList.innerHTML = "";
  renderTabs();
  els.searchButton.disabled = !selectedPerson() || searchIsRunning();

  if (!results) {
    els.summary.textContent = "先解析人物，再搜索作品。";
    els.resultList.innerHTML = '<div class="empty">右键页面选中文本也可以带入搜索词。</div>';
    return;
  }

  const visibleItems = filteredItems(results);
  els.summary.textContent = `已搜索 ${results.searchedAliases.length} 个别名，去重 ${results.total} 个作品，当前显示 ${visibleItems.length} 个${orderSummary(results)}${pageLimitSummary(results)}${verificationSummary(results)}${progressSummary(results)}${timingSummary(results)}。`;

  if (visibleItems.length === 0) {
    els.resultList.innerHTML = '<div class="empty">当前筛选没有结果。</div>';
    return;
  }

  for (const item of visibleItems.slice(0, 30)) {
    const article = document.createElement("article");
    article.className = "result";
    article.innerHTML = `
      <a class="result-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        ${escapeHtml(item.title)}
      </a>
      <div class="result-meta">
        <span class="tag">${escapeHtml(item.typeLabel)}</span>
        <span class="tag ${escapeAttribute(item.ageCategory ?? "unknown")}">${escapeHtml(item.ageLabel ?? "未知")}</span>
        ${verificationBadge(item)}
        ${item.circle ? `<span>${escapeHtml(item.circle)}</span>` : ""}
      </div>
      <div class="result-meta">命中：${escapeHtml(item.matchedAliases.join(" / "))}</div>
    `;
    els.resultList.append(article);
  }
}

function verificationSummary(results) {
  if (!results?.options?.verifyDetails) return "";

  const counts = results.items.reduce(
    (acc, item) => {
      const status = item.verification?.status ?? "unknown";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    { matched: 0, unknown: 0, not_matched: 0 }
  );

  return `，验证 ${counts.matched}/${results.items.length}`;
}

function pageLimitSummary(results) {
  const count = results?.truncatedAliases?.length ?? 0;
  return count > 0 ? `，${count} 个别名达到页数上限` : "";
}

function orderSummary(results) {
  return results?.orderLabel ? `，排序 ${results.orderLabel}` : "";
}

function timingSummary(results) {
  const totalMs = results?.timing?.totalMs;
  return Number.isFinite(totalMs) ? `，耗时 ${(totalMs / 1000).toFixed(1)}s` : "";
}

function progressSummary(results) {
  const progress = results?.progress;
  if (!progress) return "";
  if (progress.status === "verifying") return "，作品已加载完，正在详情验证";
  if (progress.status === "completed") {
    return `，已完成，实际加载 ${progress.pagesFetched} 页（上限 ${progress.totalPageBudget} 页）`;
  }
  if (progress.status === "failed") return "，后台加载失败";
  return `，后台加载中 ${progress.pagesFetched}/${progress.totalPageBudget} 页上限`;
}

function verificationBadge(item) {
  const status = item.verification?.status;
  if (!status || status === "unknown") return "";

  const labels = {
    matched: "已验证",
    not_matched: "疑似误报",
  };
  return `<span class="tag verify-${escapeAttribute(status)}">${labels[status] ?? "未确认"}</span>`;
}

async function checkHealth() {
  try {
    const response = await fetch(apiUrl("/api/health"));
    if (!response.ok) throw new Error("bad status");
    els.serverStatus.textContent = "已连接";
    els.serverStatus.classList.remove("error");
    els.serverStatus.classList.add("ok");
    return true;
  } catch {
    els.serverStatus.textContent = "未连接";
    els.serverStatus.classList.remove("ok");
    els.serverStatus.classList.add("error");
    els.backendSettings.open = true;
    return false;
  }
}

async function resolvePersons() {
  const keyword = normalizeKeyword(els.keywordInput.value);
  if (!keyword) {
    toast("请输入声优名或马甲。");
    return;
  }

  clearSearchPolling();
  setBusy(true, "正在解析 Bangumi 候选人物...");
  try {
    const payload = await postJson("/api/persons", { keyword, limit: 8 });
    state.candidates = payload.persons ?? [];
    state.selectedPersonId = state.candidates[0]?.id ?? null;
    state.results = null;
    state.activeType = "all";
    state.activeAge = "all";
    renderCandidates();
    renderAliases();
    renderResults();
    await addHistory(keyword);
    toast(state.candidates.length ? "解析完成。" : "没有候选人物。");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function searchDlsiteProgressive() {
  const person = selectedPerson();
  if (!person) {
    toast("请先选择候选人物。");
    return;
  }

  const scope = els.scopeInput.value || "all";
  if (scope !== "nonAdult" && !els.adultConfirmInput.checked) {
    toast("请先确认合法年龄与地区。");
    return;
  }

  const aliases = selectedAliases();
  if (aliases.length === 0) {
    toast("请至少选择一个别名。");
    return;
  }

  await savePopupSettings();
  clearSearchPolling();
  setBusy(true, `正在启动后台搜索，${aliases.length} 个别名会一次性加载完整内容...`);
  try {
    const payload = await postJson("/api/search/progressive", {
      keyword: normalizeKeyword(els.keywordInput.value),
      personId: person.id,
      aliases,
      scope,
      order: els.orderInput.value || "release_d",
      verifyDetails: els.verifyDetailsInput.checked,
      maxAliases: aliases.length,
      maxPagesPerAlias: clampNumber(els.pagesInput.value, 1, MAX_PAGES, DEFAULT_MAX_PAGES),
      perPage: Number(els.perPageInput.value) || 100,
    });
    state.results = payload;
    state.searchJobId = payload.progress?.jobId ?? null;
    state.activeType = "all";
    state.activeAge = "all";
    renderResults();

    if (state.searchJobId && !payload.progress?.isComplete) {
      scheduleSearchPoll(700);
      toast("已显示首批结果，剩余内容正在后台加载。");
    } else {
      toast("搜索完成。");
    }
  } catch (error) {
    clearSearchPolling();
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleOrderChange() {
  if (!state.results || !selectedPerson()) {
    await savePopupSettings();
    return;
  }

  await searchDlsiteProgressive();
}

async function openFullApp() {
  const keyword = normalizeKeyword(els.keywordInput.value);
  const url = keyword ? `${state.backendBase}/?q=${encodeURIComponent(keyword)}` : state.backendBase;
  if (globalThis.chrome?.tabs?.create) {
    await globalThis.chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noreferrer");
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

els.saveBackendButton.addEventListener("click", saveBackend);
els.openDlsiteLoginButton.addEventListener("click", openDlsiteLogin);
els.syncDlsiteAccountButton.addEventListener("click", () => syncDlsiteAccount("quick"));
els.deepSyncDlsiteAccountButton.addEventListener("click", () => syncDlsiteAccount("full"));
els.openDashboardButton.addEventListener("click", openDashboard);
els.resolveButton.addEventListener("click", resolvePersons);
els.searchButton.addEventListener("click", searchDlsiteProgressive);
els.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolvePersons();
});
els.scopeInput.addEventListener("change", savePopupSettings);
els.orderInput.addEventListener("change", handleOrderChange);
els.pagesInput.addEventListener("change", savePopupSettings);
els.perPageInput.addEventListener("change", savePopupSettings);
els.verifyDetailsInput.addEventListener("change", savePopupSettings);
els.clearHistoryButton.addEventListener("click", clearHistory);
els.selectPenNamesButton.addEventListener("click", () => setAliasSelection("pen"));
els.selectAllAliasesButton.addEventListener("click", () => setAliasSelection("all"));
els.clearAliasesButton.addEventListener("click", () => setAliasSelection("none"));
els.openFullAppButton.addEventListener("click", openFullApp);

await loadSettings();
renderHistory();
renderCandidates();
renderAliases();
renderResults();
if (await checkHealth()) await loadAccountProfile();
await loadAccountSyncStatus();
