(function attachActivityUi(global) {
  const DETAIL_STATUS_LABELS = {
    parsed: "详情",
    fallback: "摘要",
    failed: "详情暂不可读",
    external: "外部专题",
    skipped: "未抓取",
    pending: "待解析",
  };

  function createActivityUi({
    formatNumber,
    formatPrice,
    formatDate,
    escapeHtml,
    escapeAttribute,
    detailPreviewLength = 54,
    relatedPreviewLimit = 2,
    detailFactLimit = 4,
  }) {
    function formatTimeLeft(value) {
      if (!value) return "结束时间未公开";
      const deltaMs = new Date(value).getTime() - Date.now();
      if (!Number.isFinite(deltaMs)) return value;
      if (deltaMs <= 0) return "已结束";
      const hours = Math.ceil(deltaMs / (60 * 60 * 1000));
      if (hours < 24) return `还剩 ${hours} 小时`;
      return `还剩 ${Math.ceil(hours / 24)} 天`;
    }

    function formatActivityWindow(item) {
      const parts = [];
      if (item.startsAt) parts.push(`开始 ${formatDate(item.startsAt)}`);
      if (item.endsAt) parts.push(`结束 ${formatDate(item.endsAt)}`);
      return parts.join(" · ") || "活动时间以 DLsite 页面为准";
    }

    function compactDetailSummary(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      return text.length > detailPreviewLength ? `${text.slice(0, detailPreviewLength - 3).trim()}...` : text;
    }

    function renderActivityDetails(details) {
      if (!details) return "";
      const status = details.status || "pending";
      const summary = details.summary || details.error || "";
      const summaryPreview = compactDetailSummary(summary);
      const facts = [];
      if (details.claimCondition) facts.push(["领取", details.claimCondition]);
      if (details.applicableScope) facts.push(["范围", details.applicableScope]);
      if (details.requiresLogin === true) facts.push(["登录", "需要"]);
      if (details.requiresLogin === false) facts.push(["登录", "未标明需要"]);
      if (details.isLimited === true) facts.push(["限量", "可能限量"]);
      if (details.isLimited === false) facts.push(["限量", "未标明限量"]);
      if (details.endsAt) facts.push(["详情截止", formatDate(details.endsAt)]);

      if (!summary && !facts.length) return "";
      return `
        <details class="activity-detail ${escapeAttribute(status)}">
          <summary class="activity-detail-head">
            <span>${escapeHtml(DETAIL_STATUS_LABELS[status] || status)}</span>
            ${summaryPreview ? `<strong>${escapeHtml(summaryPreview)}</strong>` : ""}
            ${details.fetchedAt ? `<small>${escapeHtml(formatDate(details.fetchedAt))}</small>` : ""}
          </summary>
          <div class="activity-detail-body">
            ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
            ${
              facts.length
                ? `<div class="activity-detail-facts">
                    ${facts
                      .slice(0, detailFactLimit)
                      .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`)
                      .join("")}
                  </div>`
                : ""
            }
          </div>
        </details>
      `;
    }

    function renderActivityAlerts(alerts) {
      if (!alerts?.length) return "";
      return `
        <div class="activity-alerts">
          ${alerts
            .map(
              (alert) => `
                <div class="activity-alert">
                  <span>${escapeHtml(alert.message)}</span>
                  <button data-action="read-activity-alert" data-id="${escapeAttribute(alert.id)}" type="button">已读</button>
                </div>
              `
            )
            .join("")}
        </div>
      `;
    }

    function relatedWorkTitle(work) {
      const title = String(work?.title || "").trim();
      const productId = String(work?.productId || "").trim();
      if (title && title !== productId) return title;
      if (work?.circle && productId) return `${work.circle} / ${productId}`;
      return title || productId || "未命名作品";
    }

    function renderRelatedWorkMeta(work) {
      const parts = [];
      const productId = String(work?.productId || "").trim();
      if (work?.title && work.title === productId && work.circle) parts.push("标题待同步");
      if (Number.isFinite(Number(work?.latestPriceJpy))) parts.push(`当前 ${formatPrice(work.latestPriceJpy)}`);
      if (Number.isFinite(Number(work?.latestDiscountRate)) && Number(work.latestDiscountRate) > 0) {
        parts.push(`${formatNumber(work.latestDiscountRate)}%OFF`);
      }
      parts.push(...(work?.sourceLabels ?? []));
      parts.push(...(work?.reasons ?? []).slice(0, 2));
      return parts.filter(Boolean).join(" · ");
    }

    function renderActivityRelatedWorks(works) {
      if (!works?.length) return "";
      const preview = works
        .slice(0, relatedPreviewLimit)
        .map(relatedWorkTitle)
        .filter(Boolean)
        .join(" / ");
      return `
        <details class="activity-related">
          <summary>
            <span>可能相关作品</span>
            <strong>${formatNumber(works.length)}</strong>
            ${preview ? `<small>${escapeHtml(preview)}</small>` : ""}
          </summary>
          <div class="activity-related-body">
            ${works
              .map(
                (work) => `
                  <a class="activity-related-work" href="${escapeAttribute(work.url)}" target="_blank" rel="noreferrer">
                    ${work.imageUrl ? `<img class="activity-related-thumb" src="${escapeAttribute(work.imageUrl)}" alt="" loading="lazy" />` : '<span class="activity-related-thumb placeholder" aria-hidden="true"></span>'}
                    <span>
                      <strong>${escapeHtml(relatedWorkTitle(work))}</strong>
                      <small>${escapeHtml(renderRelatedWorkMeta(work))}</small>
                    </span>
                  </a>
                `
              )
              .join("")}
            <p>仅表示可能相关，优惠券领取和适用条件请在 DLsite 确认。</p>
          </div>
        </details>
      `;
    }

    return {
      formatTimeLeft,
      formatActivityWindow,
      renderActivityDetails,
      renderActivityAlerts,
      renderActivityRelatedWorks,
    };
  }

  global.DlsiteActivityUi = { createActivityUi };
})(window);
