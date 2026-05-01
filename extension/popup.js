const DEFAULT_BACKEND = "http://localhost:5178";

const state = {
  backendBase: DEFAULT_BACKEND,
  candidates: [],
  selectedPersonId: null,
  results: null,
};

const els = {
  serverStatus: document.querySelector("#serverStatus"),
  keywordInput: document.querySelector("#keywordInput"),
  resolveButton: document.querySelector("#resolveButton"),
  searchButton: document.querySelector("#searchButton"),
  scopeInput: document.querySelector("#scopeInput"),
  pagesInput: document.querySelector("#pagesInput"),
  adultConfirmInput: document.querySelector("#adultConfirmInput"),
  candidateCount: document.querySelector("#candidateCount"),
  candidateList: document.querySelector("#candidateList"),
  aliasCount: document.querySelector("#aliasCount"),
  aliasList: document.querySelector("#aliasList"),
  summary: document.querySelector("#summary"),
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
  if (!storage) return;

  const data = await storage.get(["backendBase", "pendingKeyword"]);
  state.backendBase = normalizeBackend(data.backendBase) || DEFAULT_BACKEND;

  const pendingKeyword = normalizeKeyword(data.pendingKeyword);
  if (pendingKeyword) {
    els.keywordInput.value = pendingKeyword;
    await storage.remove(["pendingKeyword", "pendingKeywordAt"]);
    await globalThis.chrome.action?.setBadgeText?.({ text: "" });
  }
}

function normalizeBackend(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return raw;
  return "";
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
  if (label) els.summary.textContent = label;
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

  person.aliases.slice(0, 12).forEach((alias, index) => {
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

function renderResults() {
  const results = state.results;
  els.resultList.innerHTML = "";

  if (!results) {
    els.summary.textContent = "先解析人物，再搜索作品。";
    els.resultList.innerHTML = '<div class="empty">右键页面选中文本也可以带入搜索词。</div>';
    return;
  }

  els.summary.textContent = `已搜索 ${results.searchedAliases.length} 个别名，去重 ${results.total} 个作品。`;
  const items = results.items.slice(0, 20);

  if (items.length === 0) {
    els.resultList.innerHTML = '<div class="empty">没有找到作品。</div>';
    return;
  }

  for (const item of items) {
    const article = document.createElement("article");
    article.className = "result";
    article.innerHTML = `
      <a class="result-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        ${escapeHtml(item.title)}
      </a>
      <div class="result-meta">
        <span class="tag">${escapeHtml(item.typeLabel)}</span>
        <span class="tag ${escapeAttribute(item.ageCategory ?? "unknown")}">${escapeHtml(item.ageLabel ?? "未知")}</span>
        ${item.circle ? `<span>${escapeHtml(item.circle)}</span>` : ""}
      </div>
      <div class="result-meta">命中：${escapeHtml(item.matchedAliases.join(" / "))}</div>
    `;
    els.resultList.append(article);
  }
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
    renderCandidates();
    renderAliases();
    renderResults();
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

  setBusy(true, `正在搜索 ${aliases.length} 个别名...`);
  try {
    state.results = await postJson("/api/search", {
      keyword: normalizeKeyword(els.keywordInput.value),
      personId: person.id,
      aliases,
      scope,
      verifyDetails: false,
      maxAliases: aliases.length,
      maxPagesPerAlias: Math.min(Math.max(Number(els.pagesInput.value) || 1, 1), 3),
      perPage: 30,
    });
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

els.resolveButton.addEventListener("click", resolvePersons);
els.searchButton.addEventListener("click", searchDlsite);
els.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolvePersons();
});
els.openFullAppButton.addEventListener("click", openFullApp);

await loadSettings();
renderCandidates();
renderAliases();
renderResults();
await checkHealth();
