const DEFAULT_BACKEND = "http://localhost:5178";
const HISTORY_LIMIT = 8;
const ALIAS_RENDER_LIMIT = 20;

const state = {
  backendBase: DEFAULT_BACKEND,
  candidates: [],
  selectedPersonId: null,
  results: null,
  activeType: "all",
  activeAge: "all",
  history: [],
};

const els = {
  serverStatus: document.querySelector("#serverStatus"),
  backendSettings: document.querySelector("#backendSettings"),
  backendBaseInput: document.querySelector("#backendBaseInput"),
  saveBackendButton: document.querySelector("#saveBackendButton"),
  keywordInput: document.querySelector("#keywordInput"),
  resolveButton: document.querySelector("#resolveButton"),
  searchButton: document.querySelector("#searchButton"),
  scopeInput: document.querySelector("#scopeInput"),
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
  if (["all", "adult", "nonAdult"].includes(settings.scope)) {
    els.scopeInput.value = settings.scope;
  }
  if ([1, 2, 3].includes(Number(settings.pages))) {
    els.pagesInput.value = String(settings.pages);
  }
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
  await checkHealth();
}

async function savePopupSettings() {
  const storage = getChromeStorage();
  if (!storage) return;

  await storage.set({
    popupSettings: {
      scope: els.scopeInput.value,
      pages: clampNumber(els.pagesInput.value, 1, 3, 1),
      perPage: Number(els.perPageInput.value) || 30,
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

function selectedPerson() {
  return state.candidates.find((person) => person.id === state.selectedPersonId) ?? null;
}

function selectedAliases() {
  return [...els.aliasList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function setBusy(isBusy, label = "") {
  els.resolveButton.disabled = isBusy;
  els.searchButton.disabled = isBusy || !selectedPerson();
  els.saveBackendButton.disabled = isBusy;
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
  els.searchButton.disabled = !person;

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

  if (!results) {
    els.summary.textContent = "先解析人物，再搜索作品。";
    els.resultList.innerHTML = '<div class="empty">右键页面选中文本也可以带入搜索词。</div>';
    return;
  }

  const visibleItems = filteredItems(results);
  const verification = verificationSummary(results);
  els.summary.textContent = `已搜索 ${results.searchedAliases.length} 个别名，去重 ${results.total} 个作品，当前显示 ${visibleItems.length} 个${verification}。`;

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

async function searchDlsite() {
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
  setBusy(true, `正在搜索 ${aliases.length} 个别名...`);
  try {
    state.results = await postJson("/api/search", {
      keyword: normalizeKeyword(els.keywordInput.value),
      personId: person.id,
      aliases,
      scope,
      verifyDetails: els.verifyDetailsInput.checked,
      maxAliases: aliases.length,
      maxPagesPerAlias: clampNumber(els.pagesInput.value, 1, 3, 1),
      perPage: Number(els.perPageInput.value) || 30,
    });
    state.activeType = "all";
    state.activeAge = "all";
    renderResults();
    toast("搜索完成。");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
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
els.resolveButton.addEventListener("click", resolvePersons);
els.searchButton.addEventListener("click", searchDlsite);
els.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolvePersons();
});
els.scopeInput.addEventListener("change", savePopupSettings);
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
await checkHealth();
