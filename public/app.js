const state = {
  keyword: "",
  candidates: [],
  selectedPersonId: null,
  results: null,
  activeType: "all",
  activeAge: "all",
};

const els = {
  serverStatus: document.querySelector("#serverStatus"),
  keywordInput: document.querySelector("#keywordInput"),
  resolveButton: document.querySelector("#resolveButton"),
  runButton: document.querySelector("#runButton"),
  maxAliasesInput: document.querySelector("#maxAliasesInput"),
  maxPagesInput: document.querySelector("#maxPagesInput"),
  perPageInput: document.querySelector("#perPageInput"),
  ageScopeInput: document.querySelector("#ageScopeInput"),
  verifyDetailsInput: document.querySelector("#verifyDetailsInput"),
  adultConfirm: document.querySelector("#adultConfirm"),
  candidateCount: document.querySelector("#candidateCount"),
  candidateList: document.querySelector("#candidateList"),
  aliasCount: document.querySelector("#aliasCount"),
  aliasGrid: document.querySelector("#aliasGrid"),
  selectPenNamesButton: document.querySelector("#selectPenNamesButton"),
  selectAllAliasesButton: document.querySelector("#selectAllAliasesButton"),
  clearAliasesButton: document.querySelector("#clearAliasesButton"),
  resultSummary: document.querySelector("#resultSummary"),
  categoryTabs: document.querySelector("#categoryTabs"),
  ageTabs: document.querySelector("#ageTabs"),
  resultList: document.querySelector("#resultList"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
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

function setBusy(isBusy, label = "") {
  els.resolveButton.disabled = isBusy;
  els.runButton.disabled = isBusy || !state.selectedPersonId;
  document.body.classList.toggle("loading", isBusy);
  if (label) els.resultSummary.textContent = label;
}

function selectedPerson() {
  return state.candidates.find((person) => person.id === state.selectedPersonId) ?? null;
}

function candidateSubtitle(person) {
  const penNames = person.aliases.filter((alias) => alias.isPenName).slice(0, 3);
  const sample = penNames.length ? penNames : person.aliases.slice(0, 3);
  return sample.map((alias) => alias.value).join(" / ");
}

function renderCandidates() {
  els.candidateCount.textContent = String(state.candidates.length);
  els.candidateList.innerHTML = "";

  if (state.candidates.length === 0) {
    els.candidateList.innerHTML = '<div class="empty">没有候选人物。</div>';
    return;
  }

  for (const person of state.candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `candidate ${person.id === state.selectedPersonId ? "active" : ""}`;
    button.dataset.id = String(person.id);
    button.innerHTML = `
      <img src="${person.image || ""}" alt="" loading="lazy" />
      <span>
        <strong>${escapeHtml(person.name)}</strong>
        <small>${escapeHtml(candidateSubtitle(person) || "Bangumi person #" + person.id)}</small>
      </span>
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

function renderAliases() {
  const person = selectedPerson();
  els.aliasGrid.innerHTML = "";
  els.aliasCount.textContent = person ? String(person.aliases.length) : "0";

  if (!person) {
    els.aliasGrid.innerHTML = '<div class="empty">请选择 Bangumi 候选人物。</div>';
    els.runButton.disabled = true;
    return;
  }

  const maxAliases = Number(els.maxAliasesInput.value) || 12;
  person.aliases.forEach((alias, index) => {
    const label = document.createElement("label");
    label.className = `alias-chip ${alias.isPenName ? "pen" : ""}`;
    label.title = alias.sourceKeys.join(", ");
    label.innerHTML = `
      <input type="checkbox" value="${escapeAttribute(alias.value)}" ${index < maxAliases ? "checked" : ""} />
      <span>${escapeHtml(alias.value)}</span>
    `;
    els.aliasGrid.append(label);
  });

  els.runButton.disabled = false;
}

function groupCounts(results) {
  const groups = {
    all: { key: "all", label: "全部", count: results?.total ?? 0 },
    ...(results?.groups ?? {}),
  };
  return groups;
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${activeKey === group.key ? "active" : ""}`;
    button.textContent = `${group.label} ${group.count}`;
    button.addEventListener("click", () => onSelect(group.key));
    container.append(button);
  }
}

function renderTabs() {
  const groups = groupCounts(state.results);
  renderTabSet(els.categoryTabs, groups, state.activeType, (key) => {
    state.activeType = key;
    renderResults();
  });

  const ageGroups = ageGroupCounts(state.results, state.activeType);
  renderTabSet(els.ageTabs, ageGroups, state.activeAge, (key) => {
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

function ageSummary(results) {
  if (!results?.ageGroups) return "";

  const parts = ["general", "r15", "r18", "unknown"]
    .map((key) => results.ageGroups[key])
    .filter((group) => group && group.count > 0)
    .map((group) => `${group.label} ${group.count}`);

  return parts.length ? `，${parts.join("，")}` : "";
}

function renderResults() {
  const results = state.results;
  renderTabs();
  els.resultList.innerHTML = "";
  els.exportJsonButton.disabled = !results;
  els.exportCsvButton.disabled = !results;

  if (!results) {
    els.resultSummary.textContent = "先解析人物，再选择别名搜索。";
    els.resultList.innerHTML = '<div class="empty">结果会按作品形式和年龄分级筛选。</div>';
    return;
  }

  const errors = results.errors?.length ? `，${results.errors.length} 个别名失败` : "";
  const verification = verificationSummary(results);
  els.resultSummary.textContent = `已搜索 ${results.searchedAliases.length} 个别名，去重后 ${results.total} 个作品${ageSummary(results)}${errors}${verification}。`;

  const visibleItems = filteredItems(results);

  if (visibleItems.length === 0) {
    els.resultList.innerHTML = '<div class="empty">当前筛选没有结果。</div>';
    return;
  }

  for (const item of visibleItems) {
    const node = document.createElement("article");
    node.className = "result-item";
    node.innerHTML = `
      <img class="result-image" src="${item.image || ""}" alt="" loading="lazy" />
      <div>
        <a class="result-title" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
        <div class="meta-line">
          <span class="tag">${escapeHtml(item.typeLabel)}</span>
          ${ageBadge(item)}
          ${verificationBadge(item)}
          ${item.category ? `<span>${escapeHtml(item.category)}</span>` : ""}
          ${item.circle ? `<span>${escapeHtml(item.circle)}</span>` : ""}
          ${item.priceJpy ? `<span>${item.priceJpy.toLocaleString("ja-JP")}円</span>` : ""}
          ${item.sales ? `<span>销售 ${item.sales.toLocaleString("ja-JP")}</span>` : ""}
        </div>
        <div class="meta-line">
          <span>命中：${escapeHtml(item.matchedAliases.join(" / "))}</span>
          ${verifiedAliasLine(item)}
        </div>
      </div>
      <a class="result-open" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">打开</a>
    `;
    els.resultList.append(node);
  }
}

function ageBadge(item) {
  const status = item.ageCategory ?? "unknown";
  return `<span class="tag age-status ${escapeAttribute(status)}">${escapeHtml(item.ageLabel ?? "未知")}</span>`;
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

  return `，已验证 ${counts.matched}，未确认 ${counts.unknown}，疑似误报 ${counts.not_matched}`;
}

function verificationBadge(item) {
  const status = item.verification?.status ?? "unknown";
  const labels = {
    matched: "已验证",
    unknown: "未确认",
    not_matched: "疑似误报",
  };
  return `<span class="tag verify-status ${escapeAttribute(status)}">${labels[status] ?? labels.unknown}</span>`;
}

function verifiedAliasLine(item) {
  const verification = item.verification;
  if (!verification || verification.status !== "matched" || verification.matchedAliases.length === 0) {
    return "";
  }
  const fields = verification.fields.length ? ` (${verification.fields.join(" / ")})` : "";
  return `<span>验证：${escapeHtml(verification.matchedAliases.join(" / ") + fields)}</span>`;
}

function selectedAliases() {
  return [...els.aliasGrid.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

async function resolvePersons() {
  const keyword = els.keywordInput.value.trim();
  if (!keyword) {
    toast("请输入声优名或马甲。");
    return;
  }

  state.keyword = keyword;
  setBusy(true, "正在从 Bangumi 解析候选人物与别名...");

  try {
    const payload = await postJson("/api/persons", { keyword, limit: 10 });
    state.candidates = payload.persons ?? [];
    state.selectedPersonId = state.candidates[0]?.id ?? null;
    state.results = null;
    state.activeType = "all";
    state.activeAge = "all";
    renderCandidates();
    renderAliases();
    renderResults();
    toast(state.candidates.length ? "已解析 Bangumi 候选人物。" : "没有找到候选人物。");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function runDlsiteSearch() {
  const person = selectedPerson();
  if (!person) {
    toast("请先选择候选人物。");
    return;
  }
  const scope = els.ageScopeInput.value || "all";
  if (scope !== "nonAdult" && !els.adultConfirm.checked) {
    toast("请先确认 R18 使用条件。");
    return;
  }

  const aliases = selectedAliases();
  if (aliases.length === 0) {
    toast("请至少选择一个别名。");
    return;
  }

  setBusy(true, `正在搜索 DLsite：${aliases.length} 个别名，可能需要一点时间...`);

  try {
    const payload = await postJson("/api/search", {
      keyword: state.keyword || els.keywordInput.value.trim(),
      personId: person.id,
      aliases,
      scope,
      verifyDetails: els.verifyDetailsInput.checked,
      maxAliases: Number(els.maxAliasesInput.value) || 12,
      maxPagesPerAlias: Number(els.maxPagesInput.value) || 1,
      perPage: Number(els.perPageInput.value) || 30,
    });
    state.results = payload;
    state.activeType = "all";
    state.activeAge = "all";
    renderResults();
    toast("DLsite 搜索完成。");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function setAliasSelection(mode) {
  const person = selectedPerson();
  if (!person) return;

  const inputs = [...els.aliasGrid.querySelectorAll('input[type="checkbox"]')];
  const maxAliases = Number(els.maxAliasesInput.value) || 12;
  inputs.forEach((input, index) => {
    const alias = person.aliases[index];
    if (mode === "all") input.checked = true;
    if (mode === "none") input.checked = false;
    if (mode === "pen") input.checked = alias?.isPenName || index === 0;
  });

  if (mode !== "all") {
    const checked = inputs.filter((input) => input.checked);
    checked.slice(maxAliases).forEach((input) => {
      input.checked = false;
    });
  }
}

function exportJson() {
  if (!state.results) return;
  downloadBlob(
    `dl-voice-search-${Date.now()}.json`,
    "application/json",
    JSON.stringify(state.results, null, 2)
  );
}

function exportCsv() {
  if (!state.results) return;
  const rows = [
    [
      "productId",
      "title",
      "type",
      "ageCategory",
      "ageLabel",
      "category",
      "circle",
      "priceJpy",
      "sales",
      "matchedAliases",
      "verificationStatus",
      "verifiedAliases",
      "verificationFields",
      "url",
    ],
    ...state.results.items.map((item) => [
      item.productId,
      item.title,
      item.typeLabel,
      item.ageCategory ?? "",
      item.ageLabel ?? "",
      item.category,
      item.circle,
      item.priceJpy ?? "",
      item.sales ?? "",
      item.matchedAliases.join(" / "),
      item.verification?.status ?? "unknown",
      item.verification?.matchedAliases?.join(" / ") ?? "",
      item.verification?.fields?.join(" / ") ?? "",
      item.url,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(`dl-voice-search-${Date.now()}.csv`, "text/csv;charset=utf-8", csv);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadBlob(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

els.resolveButton.addEventListener("click", resolvePersons);
els.runButton.addEventListener("click", runDlsiteSearch);
els.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolvePersons();
});
els.maxAliasesInput.addEventListener("change", renderAliases);
els.selectPenNamesButton.addEventListener("click", () => setAliasSelection("pen"));
els.selectAllAliasesButton.addEventListener("click", () => setAliasSelection("all"));
els.clearAliasesButton.addEventListener("click", () => setAliasSelection("none"));
els.exportJsonButton.addEventListener("click", exportJson);
els.exportCsvButton.addEventListener("click", exportCsv);

renderCandidates();
renderAliases();
renderResults();
checkHealth();
