// ==UserScript==
// @name         TikTok Shop 卖家工具箱
// @namespace    local.codex.tiktok-shop
// @version      0.19.6
// @homepageURL  https://github.com/Earthones/tiktok-shop-seller-tools
// @updateURL    https://raw.githubusercontent.com/Earthones/tiktok-shop-seller-tools/main/tiktok-shop-partial-refund.user.js
// @downloadURL  https://raw.githubusercontent.com/Earthones/tiktok-shop-seller-tools/main/tiktok-shop-partial-refund.user.js
// @description  Alt+T 显示或隐藏卖家工具箱功能条；通过 Reverse SDK 处理售后，刷新或切换站点后停止自动计划。
// @match        https://seller.tiktokshopglobalselling.com/*
// @match        https://seller-vn.tiktok.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const APP_VERSION = "0.19.6";
  const REFUND_PERCENT = 10;
  const PAGE_SIZE = 20;
  const MAX_PAGES = 100;
  const TARGET_STATUS = "待客户退货";
  const DELIVERED_TARGET_STATUS = "待核发退款";
  const DELIVERED_FULFILLMENT_STATUS = "已送达";
  const LIST_API_PATH = "/reverse/component/orders/list";
  const KNOWN_SDK_URL =
    "https://lf-gs-frontend-cn.fanchenstatic.com/obj/she-op-static/i18n/ecom/mf_reverse_mpa/js/cwbqsafi.js";
  const REVERSE_CHUNK_MARKER = "/i18n/ecom/mf_reverse_mpa/js/";
  const SUCCESS_STORAGE_PREFIX = "tts-partial-refund-success-by-reverse-id:";
  const LEGACY_STORAGE_PREFIX = "tts-partial-refund-success:";
  const REFUND_ONLY_SUCCESS_STORAGE_PREFIX =
    "tts-refund-only-reject-success-by-reverse-id:";
  const DELIVERED_SUCCESS_STORAGE_PREFIX =
    "tts-delivered-return-reject-success-by-reverse-id:";
  const LAUNCHER_STATE_STORAGE_KEY = "tts-seller-tools-launcher-state";
  const ACTIVITY_LOG_STORAGE_KEY = "tts-seller-tools-activity-logs";
  const LEGACY_FAILURE_LOG_STORAGE_KEY = "tts-seller-tools-failure-logs";
  const MAX_ACTIVITY_LOG_ENTRIES = 100;
  const LOG_DATABASE_NAME = "tts-seller-tools-log-files";
  const LOG_DATABASE_VERSION = 1;
  const LOG_SEGMENT_STORE = "segments";
  const LOG_SEGMENT_LIMIT_BYTES = 1024 * 1024;
  const MAX_LOG_SEGMENTS = 2;
  const MAX_LOG_REASON_CHARS = 12000;
  const SETTINGS_STORAGE_KEY = "tts-seller-tools-site-settings-v1";
  const SETTINGS_BACKUP_STORAGE_KEY = "tts-seller-tools-site-settings-backup-v1";
  const SITES = Object.freeze([
    { id: "global_GB", label: "主站 · 英国", region: "GB", currency: "GBP", decimals: 2 },
    { id: "global_MY", label: "主站 · 马来西亚", region: "MY", currency: "MYR", decimals: 2 },
    { id: "global_PH", label: "主站 · 菲律宾", region: "PH", currency: "PHP", decimals: 2 },
    { id: "global_SG", label: "主站 · 新加坡", region: "SG", currency: "SGD", decimals: 2 },
    { id: "global_TH", label: "主站 · 泰国", region: "TH", currency: "THB", decimals: 2 },
    { id: "global_VN", label: "主站 · 越南", region: "VN", currency: "VND", decimals: 0 },
    { id: "local_VN", label: "独立站 · 越南", region: "VN", currency: "VND", decimals: 0 },
  ]);
  const AUTOMATION_SETTINGS_STORAGE_KEY =
    "tts-seller-tools-automation-settings";
  const AUTOMATION_LOCK_STORAGE_KEY = "tts-seller-tools-automation-lock";
  // 临时允许多标签页并行；活动计划与最短间隔改为标签页独立，仍保留单页防重入。
  const ALLOW_MULTI_TAB_AUTOMATION = true;
  const AUTOMATION_MIN_INTERVAL_MINUTES = 5;
  const AUTOMATION_LAST_START_STORAGE_KEY = "tts-seller-tools-automation-last-start";
  const AUTOMATION_MAX_INTERVAL_MINUTES = 1440;
  const AUTOMATION_DEFAULT_INTERVAL_MINUTES = 10;
  const AUTOMATION_FIRST_RUN_DELAY_MINUTES = 3;
  const AUTOMATION_LOCK_TTL_MS = 30 * 60 * 1000;
  const AUTOMATION_MAX_RUNS = 100000;
  const CONFIRM_TOKEN = "SEND_PARTIAL_REFUND";
  const REJECT_CONFIRM_TOKEN = "REJECT_REFUND_ONLY";
  const DELIVERED_REJECT_CONFIRM_TOKEN = "REJECT_DELIVERED_RETURN";
  const REFUND_ONLY_MISSING_ITEMS_REASON_KEY =
    "seller_reject_apply_reason_is_unclear_or_lack_of_evidence";
  const REFUND_ONLY_MISSING_ITEMS_COMMENT =
    "Hi dear, Did you have an unpacking video? if yes, please upload it and it will greatly help solve this problem";
  const REFUND_ONLY_NOT_RECEIVED_REASON_KEY =
    "seller_reject_apply_buyer's_responsibility_for_incorrect_address";
  const REFUND_ONLY_NOT_RECEIVED_REASON_LABEL =
    "The package has been delivered to the provided delivery address.";
  const DELIVERED_REJECT_REASON_KEY = "reverse_reject_return_parcel_reason_5";
  const DELIVERED_REJECT_COMMENT = `Hi dear,
Our warehouse colleagues are checking the returned package. 
Please wait patiently and sorry for any inconvenience.
Any problems, please contact us`;
  const DEFAULT_COMMENT = `Hi dear,
We found you have asked a return and refund request.
Would you agree if we issue a partial refund?
In this case, you need not return it to us
Any problems, you can contact us and we will provide a reasonable solution`;

  const state = {
    lastListRequestBody: null,
    lastListResponse: null,
    listSource: "",
    eligibleOrders: [],
    totalCount: 0,
    fetchedCount: 0,
    pagesFetched: 0,
    pageOffsets: [],
    pageSizes: [],
    loading: false,
    bulkSending: false,
    internalListRequestDepth: 0,
  };
  const refundOnlyState = {
    lastListRequestBody: null,
    lastListResponse: null,
    listSource: "",
    orders: [],
    totalCount: 0,
    fetchedCount: 0,
    pagesFetched: 0,
    pageOffsets: [],
    pageSizes: [],
    loading: false,
    bulkSending: false,
  };
  const deliveredState = {
    lastListRequestBody: null,
    lastListResponse: null,
    listSource: "",
    orders: [],
    totalCount: 0,
    fetchedCount: 0,
    pagesFetched: 0,
    pageOffsets: [],
    pageSizes: [],
    loading: false,
    bulkSending: false,
  };
  const activityLogState = {
    entries: loadActivityLogs(),
    fileWriteQueue: Promise.resolve(),
    fileError: "",
    segmentCount: null,
    totalBytes: null,
  };
  const automationState = {
    settings: null,
    timer: null,
    running: false,
    networkInterrupted: false,
    acquiringLock: false,
    runningPlanId: "",
    lockHeartbeat: null,
    cancelRequested: false,
    instanceId:
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  let sdkPromise;
  let ui;
  let siteSettings = loadSiteSettings();
  let activeSiteContext = contextFromUrl(window.location.href);
  let pageSiteSignals = readPageSiteSignals();
  if (pageSiteSignals.sellerCookie) activeSiteContext.sellerId = pageSiteSignals.sellerCookie;
  let latestListContext = activeSiteContext;
  let siteContextRevision = 0;
  let pageSiteWatchTimer = null;
  const responseContexts = new WeakMap();

  function availableSites() {
    const prefix = window.location.hostname === "seller-vn.tiktok.com" ? "local_" : "global_";
    return SITES.filter((site) => site.id.startsWith(prefix));
  }

  function loadSiteSettings() {
    let saved;
    for (const key of [SETTINGS_STORAGE_KEY, SETTINGS_BACKUP_STORAGE_KEY]) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (value && typeof value === "object" && !Array.isArray(value) &&
            value.thresholds && typeof value.thresholds === "object" && !Array.isArray(value.thresholds)) {
          saved = value; break;
        }
      } catch {}
    }
    return {
      savedAt: typeof saved?.savedAt === "string" ? saved.savedAt : "",
      thresholds: Object.fromEntries(SITES.map((site) => [site.id,
        typeof saved?.thresholds?.[site.id] === "string" ? saved.thresholds[site.id] : "",
      ])),
      exportSites: Array.isArray(saved?.exportSites)
        ? saved.exportSites.filter((id) => availableSites().some((site) => site.id === id))
        : availableSites().map((site) => site.id),
    };
  }

  function contextFromUrl(rawUrl, headers) {
    let params;
    try { params = new URL(rawUrl, window.location.href).searchParams; } catch { params = new URLSearchParams(); }
    let region = "";
    try { region = new Headers(headers).get("x-tt-oec-region") || ""; } catch {}
    region = String(region || params.get("shop_region") || params.get("cb_shop_region") || "").toUpperCase();
    if (window.location.hostname === "seller-vn.tiktok.com") region = "VN";
    const site = availableSites().find((item) => item.region === region);
    return {
      siteId: site?.id || "unknown",
      sellerId: params.get("oec_seller_id") || params.get("seller_id") || "",
      sourceHost: window.location.hostname,
    };
  }

  function contextForResponse(result) {
    if (responseContexts.has(result)) return responseContexts.get(result);
    const url = result?.url || result?.__META__?.url;
    const fromUrl = url ? contextFromUrl(url) : {};
    return {
      ...latestListContext,
      ...fromUrl,
      siteId: fromUrl.siteId && fromUrl.siteId !== "unknown" ? fromUrl.siteId : latestListContext.siteId,
      sellerId: fromUrl.sellerId || latestListContext.sellerId,
    };
  }

  function siteForPrice(priceText, context = activeSiteContext) {
    const text = String(priceText || "");
    const currency = /(?:₫|đ|VND)/i.test(text) ? "VND"
      : /(?:RM|MYR)/i.test(text) ? "MYR"
      : /(?:₱|PHP)/i.test(text) ? "PHP"
      : /(?:S\$|SGD)/i.test(text) ? "SGD"
      : /(?:฿|THB)/i.test(text) ? "THB"
      : /(?:£|GBP)/i.test(text) ? "GBP" : "";
    const explicit = availableSites().find((site) => site.id === context?.siteId);
    if (currency && explicit && currency !== explicit.currency) return null;
    return currency ? availableSites().find((site) => site.currency === currency) || null : explicit || null;
  }

  function orderSiteFields(priceText, context) {
    const site = siteForPrice(priceText, context);
    return {
      siteId: site?.id || "unknown", siteLabel: site?.label || "站点未知",
      currency: site?.currency || "", sellerId: context?.sellerId || "",
      sourceHost: context?.sourceHost || window.location.hostname,
    };
  }

  function observeSiteContext(rawUrl, headers) {
    const observed = contextFromUrl(rawUrl, headers);
    const sellerChanged = Boolean(observed.sellerId && activeSiteContext.sellerId && observed.sellerId !== activeSiteContext.sellerId);
    const next = {
      ...observed,
      sellerId: observed.sellerId || activeSiteContext.sellerId,
      siteId: observed.siteId !== "unknown" ? observed.siteId : sellerChanged ? "unknown" : activeSiteContext.siteId,
    };
    const regionChanged = next.siteId !== "unknown" && activeSiteContext.siteId !== "unknown" && next.siteId !== activeSiteContext.siteId;
    if (sellerChanged || regionChanged) {
      siteContextRevision += 1;
      stopAutomation({ node: "切换站点停止", reason: "检测到站点或店铺切换，原自动计划已停止，请在目标站点手动重新启用。" });
      sdkPromise = undefined;
      state.eligibleOrders = [];
      deliveredState.orders = [];
      refundOnlyState.orders = [];
      state.lastListResponse = deliveredState.lastListResponse = refundOnlyState.lastListResponse = null;
    }
    activeSiteContext = next;
    if (sellerChanged || regionChanged) {
      renderOrders(); renderDeliveredOrders(); renderRefundOnlyOrders();
    }
    return { ...next };
  }

  function readPageSiteSignals() {
    // 仅读取当前店铺标识，不读取/保存登录令牌。主站切换国家有时只更新这个 Cookie。
    let sellerCookie = "";
    try {
      sellerCookie = document.cookie.match(/(?:^|;\s*)oec_seller_id_unified_seller_env=(\d+)(?:;|$)/)?.[1] || "";
    } catch {}
    return { ...contextFromUrl(window.location.href), sellerCookie };
  }

  function checkPageSiteContext() {
    const previous = pageSiteSignals;
    const current = readPageSiteSignals();
    pageSiteSignals = current;
    if ((current.siteId !== "unknown" && current.siteId !== previous.siteId) ||
        (current.sellerId && current.sellerId !== previous.sellerId)) {
      observeSiteContext(window.location.href);
    }
    if (current.sellerCookie && current.sellerCookie !== previous.sellerCookie) {
      const url = new URL(window.location.href);
      url.searchParams.set("oec_seller_id", current.sellerCookie);
      observeSiteContext(url.href);
    } else if (previous.sellerCookie && !current.sellerCookie) {
      siteContextRevision += 1;
      stopAutomation({ node: "店铺状态变化停止", reason: "当前店铺标识已失效，自动计划已停止，请确认登录和站点后重新启用。" });
    }
  }

  function startPageSiteWatcher() {
    clearInterval(pageSiteWatchTimer);
    pageSiteWatchTimer = setInterval(checkPageSiteContext, 1000);
  }

  function installPageSiteObserver() {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const result = Reflect.apply(original, this, args);
        checkPageSiteContext();
        return result;
      };
    }
    window.addEventListener("popstate", checkPageSiteContext);
    startPageSiteWatcher();
  }

  function createRequestGuard() {
    checkPageSiteContext();
    const revision = siteContextRevision;
    const automaticPlanId = automationState.running ? automationState.runningPlanId : "";
    return () => {
      checkPageSiteContext();
      if (revision !== siteContextRevision) throw new Error("站点或店铺已切换，已阻止继续发送旧操作。");
      if (automaticPlanId && (automationState.runningPlanId !== automaticPlanId || !automationShouldContinue())) {
        throw new Error("自动计划已停止，已阻止继续发送请求。");
      }
    };
  }

  function assertOrderContext(order) {
    checkPageSiteContext();
    if (order.sellerId && activeSiteContext.sellerId && order.sellerId !== activeSiteContext.sellerId) {
      throw new Error("当前店铺已切换，请刷新订单列表后再处理。");
    }
    if (order.siteId && order.siteId !== "unknown" && activeSiteContext.siteId !== "unknown" && order.siteId !== activeSiteContext.siteId) {
      throw new Error("当前站点与订单所属站点不一致，请切回对应站点并刷新列表。");
    }
  }

  function decimalUnits(value, decimals) {
    const text = String(value);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    if (fraction.length > decimals) return null;
    return BigInt(whole + fraction.padEnd(decimals, "0"));
  }

  function formatUnits(units, decimals) {
    const digits = units.toString().padStart(decimals + 1, "0");
    return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  }

  function refundThresholdDecision(order) {
    const site = SITES.find((item) => item.id === order.siteId);
    if (!site) return { allowed: false, reason: "站点／币种未识别，待手动检查" };
    const amount = order.productPriceAmount;
    const amountUnits = decimalUnits(amount, site.decimals);
    if (amountUnits == null || decimalUnits(order.refundAmount, site.decimals) <= 0n) {
      return { allowed: false, reason: "金额无法计算或 10% 四舍五入后为 0" };
    }
    const threshold = siteSettings.thresholds[site.id];
    if (threshold === "") return { allowed: true, reason: "未设阈值（不限制）" };
    const limit = decimalUnits(threshold, site.decimals);
    if (limit == null) return { allowed: false, reason: "站点阈值格式错误，请检查设置" };
    return {
      allowed: amountUnits <= limit,
      reason: `商品原金额 ${amount} ${site.currency} ${amountUnits <= limit ? "≤" : ">"} 阈值 ${threshold} ${site.currency}`,
    };
  }

  function cloneSerializable(value) {
    if (value == null) return value;
    try {
      return structuredClone(value);
    } catch {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
  }

  function loadActivityLogs() {
    try {
      const current = localStorage.getItem(ACTIVITY_LOG_STORAGE_KEY);
      const legacy = localStorage.getItem(LEGACY_FAILURE_LOG_STORAGE_KEY);
      const parsed = JSON.parse(current || legacy || "[]");
      return Array.isArray(parsed)
        ? parsed.slice(0, MAX_ACTIVITY_LOG_ENTRIES).map((entry) => ({
            ...entry,
            status: entry?.status || "失败",
          }))
        : [];
    } catch {
      return [];
    }
  }

  function persistActivityLogs() {
    try {
      localStorage.setItem(
        ACTIVITY_LOG_STORAGE_KEY,
        JSON.stringify(activityLogState.entries),
      );
    } catch (error) {
      console.warn("[卖家工具箱] 日志无法写入 localStorage", error);
    }
  }

  function describeLogReason(value) {
    if (value instanceof Error) return value.message || value.name;
    if (typeof value === "string") return value;
    if (value == null) return "未知错误";

    const parts = [
      value?.code != null ? `code: ${String(value.code)}` : "",
      value?.message,
      value?.data?.result?.fail_reason,
      value?.fail_reason,
    ].filter(Boolean);
    if (parts.length) return parts.join("｜");
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function limitLogText(value) {
    const text = String(value || "未知错误");
    if (text.length <= MAX_LOG_REASON_CHARS) return text;
    return `${text.slice(0, MAX_LOG_REASON_CHARS)}\n…日志内容过长，已截断`;
  }

  function openLogDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const request = indexedDB.open(LOG_DATABASE_NAME, LOG_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(LOG_SEGMENT_STORE)) {
          database.createObjectStore(LOG_SEGMENT_STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("无法打开日志数据库"));
    });
  }

  async function appendPersistentLog(entry) {
    const database = await openLogDatabase();
    const line = `${JSON.stringify(entry)}\n`;
    const lineBytes = new TextEncoder().encode(line).byteLength;
    if (lineBytes > LOG_SEGMENT_LIMIT_BYTES) {
      database.close();
      throw new Error("单条日志超过 1 MiB，未写入持久日志。");
    }

    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          LOG_SEGMENT_STORE,
          "readwrite",
        );
        const store = transaction.objectStore(LOG_SEGMENT_STORE);
        const segmentsRequest = store.getAll();

        segmentsRequest.onsuccess = () => {
          const segments = (
            Array.isArray(segmentsRequest.result) ? segmentsRequest.result : []
          ).sort(
            (left, right) =>
              Number(left.sequence || 0) - Number(right.sequence || 0),
          );
          const latest = segments.at(-1);
          if (
            latest &&
            Number(latest.bytes || 0) + lineBytes <= LOG_SEGMENT_LIMIT_BYTES
          ) {
            for (const obsolete of segments.slice(0, -MAX_LOG_SEGMENTS)) {
              store.delete(obsolete.id);
            }
            store.put({
              ...latest,
              content: `${latest.content || ""}${line}`,
              bytes: Number(latest.bytes || 0) + lineBytes,
              updatedAt: entry.timestamp,
            });
          } else {
            const keepBeforeCreating = Math.max(0, MAX_LOG_SEGMENTS - 1);
            const deleteBeforeIndex = Math.max(
              0,
              segments.length - keepBeforeCreating,
            );
            for (const obsolete of segments.slice(0, deleteBeforeIndex)) {
              store.delete(obsolete.id);
            }
            store.add({
              sequence: Number(latest?.sequence || 0) + 1,
              createdAt: entry.timestamp,
              updatedAt: entry.timestamp,
              bytes: lineBytes,
              content: line,
            });
          }
        };
        segmentsRequest.onerror = () =>
          transaction.abort();
        transaction.oncomplete = resolve;
        transaction.onerror = () =>
          reject(transaction.error || new Error("日志文件写入失败"));
        transaction.onabort = () =>
          reject(transaction.error || new Error("日志文件写入已中止"));
      });
    } finally {
      database.close();
    }
  }

  function queuePersistentLog(entry) {
    activityLogState.fileWriteQueue = activityLogState.fileWriteQueue
      .catch(() => {})
      .then(() => appendPersistentLog(entry))
      .then(() => {
        activityLogState.fileError = "";
        activityLogState.segmentCount = null;
        activityLogState.totalBytes = null;
      })
      .catch((error) => {
        activityLogState.fileError = error?.message || String(error);
        console.error("[卖家工具箱] 持久日志文件写入失败", error);
      })
      .finally(() => renderActivityLogs());
  }

  async function trimPersistentLogSegments() {
    const database = await openLogDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          LOG_SEGMENT_STORE,
          "readwrite",
        );
        const store = transaction.objectStore(LOG_SEGMENT_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
          const segments = (
            Array.isArray(request.result) ? request.result : []
          ).sort(
            (left, right) =>
              Number(left.sequence || 0) - Number(right.sequence || 0),
          );
          for (const obsolete of segments.slice(0, -MAX_LOG_SEGMENTS)) {
            store.delete(obsolete.id);
          }
        };
        request.onerror = () => transaction.abort();
        transaction.oncomplete = resolve;
        transaction.onerror = () =>
          reject(transaction.error || new Error("日志轮转清理失败"));
        transaction.onabort = () =>
          reject(transaction.error || new Error("日志轮转清理已中止"));
      });
    } finally {
      database.close();
    }
  }

  async function readPersistentLogSegments() {
    await activityLogState.fileWriteQueue.catch(() => {});
    await trimPersistentLogSegments();
    return readStoredLogSegments();
  }

  async function readStoredLogSegments() {
    const database = await openLogDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(LOG_SEGMENT_STORE, "readonly");
        const request = transaction.objectStore(LOG_SEGMENT_STORE).getAll();
        request.onsuccess = () => {
          resolve(
            (Array.isArray(request.result) ? request.result : []).sort(
              (left, right) =>
                Number(left.sequence || 0) - Number(right.sequence || 0),
            ),
          );
        };
        request.onerror = () =>
          reject(request.error || new Error("读取日志文件失败"));
      });
    } finally {
      database.close();
    }
  }

  async function refreshPersistentLogStats() {
    try {
      const segments = await readPersistentLogSegments();
      activityLogState.segmentCount = segments.length;
      activityLogState.totalBytes = segments.reduce(
        (total, segment) => total + Number(segment.bytes || 0),
        0,
      );
      activityLogState.fileError = "";
    } catch (error) {
      activityLogState.fileError = error?.message || String(error);
    }
    renderActivityLogs();
  }

  async function clearLogsFromInterface() {
    if (ui.logClear.disabled) return;
    if (loadAutomationSettings().enabled || automationState.running ||
        [state, deliveredState, refundOnlyState].some((item) => item.loading || item.bulkSending)) {
      ui.logActionStatus.textContent = "请先取消自动运行，并等待当前列表获取或批量操作完成后再清空日志。";
      ui.logActionStatus.className = "show error";
      return;
    }
    if (!window.confirm(
      "确认清空前端最近日志？\n\n只清空当前域名的界面日志及最近记录缓存；持久日志副本保留，继续按每卷 1 MiB、最多两卷轮转。\n\n不会删除设置、自动计划、次数或防重复发送的成功记录。请关闭其他运行工具箱的同域名标签页，避免旧缓存重新写入。"
    )) return;
    ui.logClear.disabled = true;
    const oldEntries = new Set(activityLogState.entries);
    // Archive pending/legacy records before clearing only the front-end cache.
    const clearOperation = activityLogState.fileWriteQueue.catch(() => {}).then(async () => {
      const segments = await readStoredLogSegments();
      const legacy = JSON.parse(localStorage.getItem(LEGACY_FAILURE_LOG_STORAGE_KEY) || "[]");
      const archived = new Set();
      for (const segment of segments) {
        for (const line of String(segment.content || "").split("\n")) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line);
          archived.add(entry.id || JSON.stringify(entry));
        }
      }
      for (const entry of [...oldEntries, ...(Array.isArray(legacy) ? legacy : [])]) {
        if (!entry || typeof entry !== "object") continue;
        const key = entry.id || JSON.stringify(entry);
        if (!archived.has(key)) { await appendPersistentLog(entry); archived.add(key); }
      }
      localStorage.removeItem(LEGACY_FAILURE_LOG_STORAGE_KEY);
      const remaining = activityLogState.entries.filter((entry) => !oldEntries.has(entry));
      // Keep an explicit empty array so legacy fallback cannot restore deleted logs.
      localStorage.setItem(ACTIVITY_LOG_STORAGE_KEY, JSON.stringify(remaining));
      activityLogState.entries = remaining;
      activityLogState.fileError = "";
      activityLogState.segmentCount = null;
      activityLogState.totalBytes = null;
    });
    activityLogState.fileWriteQueue = clearOperation.catch(() => {});
    try {
      await clearOperation;
      await refreshPersistentLogStats();
      ui.logActionStatus.textContent = "已清空前端最近日志，持久日志副本保留（每卷 1 MiB、最多两卷轮转）。导出仍可读取副本；新日志继续正常记录。";
      ui.logActionStatus.className = "show ok";
    } catch (error) {
      ui.logActionStatus.textContent = `日志清理未完成：${error?.message || String(error)}`;
      ui.logActionStatus.className = "show error";
    } finally {
      ui.logClear.disabled = false;
      renderActivityLogs();
    }
  }

  function logCategory(entry) {
    if (String(entry.type).includes("退货退款")) return "退货退款";
    if (String(entry.type).includes("仅退款")) return "仅退款";
    if (String(entry.type).includes("已送达")) return "已送达";
    return "系统日志";
  }

  function formatExportTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return String(timestamp);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function isPackageOperationLog(entry) {
    const hasId = [entry.mainOrderId, entry.reverseMainOrderId].some((value) =>
      value != null && !["", "—", "-"].includes(String(value).trim()),
    );
    return hasId && ["成功", "失败"].includes(entry.status) && logCategory(entry) !== "系统日志" &&
      !/自动运行|自动调度/.test(`${entry.type || ""} ${entry.node || ""}`);
  }

  function csvCell(value, identifier = false) {
    let text = String(value ?? "");
    // Only numeric IDs may become a literal text formula, preserving >15 digits in WPS/Excel.
    // All other fields are data; neutralize spreadsheet formula injection from log messages.
    if (identifier && /^\d+$/.test(text)) text = `="${text}"`;
    else if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function groupLogFiles(entries, selectedSites, mode = "full") {
    if (!["full", "normal"].includes(mode)) throw new Error("未知日志导出类型。");
    const selected = new Set(selectedSites);
    if (!selected.size) return [];
    const groups = new Map();
    const headers = ["时间", "功能", "处理结果", "订单号", "售后退款单号", "执行节点", "结果"];
    const identifierColumns = new Set(["订单号", "售后退款单号"]);
    const modeLabel = mode === "normal" ? "普通日志" : "全量日志";
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const site = SITES.find((item) => item.id === entry.siteId);
      const siteId = site?.id || "unknown";
      // Full export also retains unassigned diagnostics, without adding an unknown-site UI option.
      if (!selected.has(siteId) && !(mode === "full" && siteId === "unknown")) continue;
      if (mode === "normal" && !isPackageOperationLog(entry)) continue;
      const category = logCategory(entry);
      const filename = `${siteId}_${site?.label.replace(/ · /g, "_") || "未归属站点"}_${modeLabel}.csv`;
      if (!groups.has(filename)) groups.set(filename, []);
      groups.get(filename).push({
        "时间": formatExportTime(entry.timestamp),
        "功能": category,
        "订单号": String(entry.mainOrderId || ""),
        "售后退款单号": String(entry.reverseMainOrderId || ""),
        "处理结果": entry.status || "",
        "执行节点": entry.node || "",
        "结果": entry.reason || "",
      });
    }
    return [...groups].map(([name, rows]) => {
      return {
        name, count: rows.length,
        content: "\uFEFF" + [
          headers.map((key) => csvCell(key)).join(","),
          ...rows.map((row) => headers.map((key) => csvCell(row[key], identifierColumns.has(key))).join(",")),
        ].join("\r\n") + "\r\n",
      };
    });
  }

  // 无外部依赖的 ZIP（Store 格式），一次下载，内含多个按条件拆分的日志文件。
  function createLogZip(files) {
    const encoder = new TextEncoder();
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    const crc32 = (bytes) => {
      let crc = 0xffffffff;
      for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    };
    const localParts = [], centralParts = [];
    let offset = 0, centralSize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const content = encoder.encode(file.content);
      const crc = crc32(content);
      const header = new Uint8Array(30 + name.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(12, 33, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, content.length, true);
      view.setUint32(22, content.length, true);
      view.setUint16(26, name.length, true);
      header.set(name, 30);
      localParts.push(header, content);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, content.length, true);
      cv.setUint32(24, content.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      centralSize += central.length;
      offset += header.length + content.length;
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  async function exportPersistentLogs(options = {}) {
    const mode = options.mode ?? "full";
    const segments = await readPersistentLogSegments();
    const entries = [], seen = new Set();
    for (const segment of segments) {
      for (const line of String(segment.content || "").split("\n")) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); }
        catch { throw new Error("持久日志存在无法解析的记录，导出已停止，请保留原始日志检查。"); }
        if (entry.id) seen.add(entry.id);
        entries.push(entry);
      }
    }
    // 存储写入失败时，仍纳入当前界面里尚未落盘的记录。
    for (const entry of activityLogState.entries) {
      if (!seen.has(entry.id)) entries.push(entry);
    }
    entries.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const files = groupLogFiles(
      entries, options.siteIds || siteSettings.exportSites, mode,
    );
    if (!files.length) throw new Error("勾选的站点没有可导出的日志；无法识别站点的旧记录仍保留在持久日志副本中。");
    const multiple = files.length > 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = multiple ? createLogZip(files) : new Blob([files[0].content], { type: "text/csv;charset=utf-8" });
    const filename = multiple ? `tiktok-shop-${mode}-logs-${stamp}.zip` : files[0].name.replace(/\.csv$/, `_${stamp}.csv`);
    downloadBlob(blob, filename);
    return { mode, archive: multiple, fileCount: files.length, entryCount: files.reduce((total, file) => total + file.count, 0) };
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }

  function recordActivityLog({
    status,
    type,
    node,
    mainOrderId = "",
    reverseMainOrderId = "",
    reason,
    order,
  }) {
    const timestamp = new Date().toISOString();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp,
      status: status === "成功" ? "成功" : "失败",
      type: String(type || "未知功能"),
      node: String(node || "未知节点"),
      mainOrderId: String(mainOrderId || ""),
      reverseMainOrderId: String(reverseMainOrderId || ""),
      reason: limitLogText(describeLogReason(reason)),
      ...orderSiteFields("", activeSiteContext),
      ...(order ? {
        siteId: order.siteId || "unknown", siteLabel: order.siteLabel || "站点未知",
        currency: order.currency || "", sellerId: order.sellerId || "",
        sourceHost: order.sourceHost || window.location.hostname,
      } : {}),
    };
    activityLogState.entries.unshift(entry);
    if (activityLogState.entries.length > MAX_ACTIVITY_LOG_ENTRIES) {
      activityLogState.entries.length = MAX_ACTIVITY_LOG_ENTRIES;
    }
    persistActivityLogs();
    queuePersistentLog(entry);
    renderActivityLogs();
    const consoleMethod = entry.status === "成功" ? "info" : "error";
    console[consoleMethod]("[卖家工具箱] 操作日志", entry);
    return entry;
  }

  function recordFailureLog(input) {
    return recordActivityLog({ ...input, status: "失败" });
  }

  function recordSuccessLog(input) {
    return recordActivityLog({ ...input, status: "成功" });
  }

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return cloneSerializable(body);
  }

  async function readFetchBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
      return parseBody(init.body);
    }
    if (input instanceof Request) {
      try {
        return parseBody(await input.clone().text());
      } catch {
        return null;
      }
    }
    return null;
  }

  function isReverseApi(value) {
    return Boolean(
      value &&
        typeof value.ActionPartialRefund === "function" &&
        typeof value.ActionReturnApplyReject === "function" &&
        typeof value.ActionReturnParcelReject === "function" &&
        typeof value.GetPartialRefundPreview === "function" &&
        typeof value.CheckActionExecutable === "function" &&
        typeof value.ListReverseCards === "function",
    );
  }

  function getSdkCandidates() {
    const loadedChunks = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter(
        (url) =>
          url.includes(REVERSE_CHUNK_MARKER) &&
          /\.js(?:\?|$)/i.test(url),
      );

    return [...new Set([KNOWN_SDK_URL, ...loadedChunks])];
  }

  async function locateSdk() {
    const failures = [];

    for (const url of getSdkCandidates()) {
      try {
        const module = await import(url);
        const matchedExport = Object.entries(module).find(([, value]) =>
          isReverseApi(value),
        );
        if (matchedExport) {
          const [exportName, api] = matchedExport;
          console.info("[卖家工具箱] 找到 Reverse API", {
            url,
            exportName,
            api,
          });
          return { api, exportName, url };
        }
      } catch (error) {
        failures.push({ url, error });
      }
    }

    console.error("[卖家工具箱] SDK 加载失败", failures);
    throw new Error(
      "未找到当前 Reverse API SDK。请打开退货/退款列表页面并刷新后重试。",
    );
  }

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = locateSdk().catch((error) => {
        sdkPromise = undefined;
        throw error;
      });
    }
    return sdkPromise;
  }

  async function parseSdkResult(rawResult) {
    if (rawResult instanceof Response) {
      return rawResult.json();
    }
    return rawResult;
  }

  function collectMessageContents(node, output = []) {
    if (!node || typeof node !== "object") return output;
    if (Array.isArray(node)) {
      for (const item of node) collectMessageContents(item, output);
      return output;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "message_content" && typeof value === "string") {
        output.push(value.trim());
      } else if (value && typeof value === "object") {
        collectMessageContents(value, output);
      }
    }
    return output;
  }

  function collectDisplayTexts(node, output = []) {
    if (!node || typeof node !== "object") return output;
    if (Array.isArray(node)) {
      for (const item of node) collectDisplayTexts(item, output);
      return output;
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        (key === "content" || key === "message_content") &&
        typeof value === "string" &&
        value.trim()
      ) {
        output.push(value.trim());
      } else if (value && typeof value === "object") {
        collectDisplayTexts(value, output);
      }
    }
    return output;
  }

  function getProductPriceText(productBlock, bizData) {
    const productPaid = productBlock?.content?.find(
      (item) => item?.name === "product_paid",
    );
    return (
      productPaid?.text_pair?.content?.content ||
      bizData?.return_price ||
      ""
    ).trim();
  }

  function parseMoney(priceText, context = activeSiteContext) {
    const normalizedText = String(priceText || "").trim();
    const site = siteForPrice(normalizedText, context);
    if (!site) return null;
    const match = normalizedText.match(/-?\d[\d.,]*/);
    if (!match || match[0].startsWith("-")) return null;
    const token = match[0];
    let numericText;
    if (site.currency === "VND") {
      // 越南盾展示中的 165.898 / 1,496,904 都是整数千分位。
      if (/^\d+$/.test(token)) numericText = token;
      else if (/^\d{1,3}(?:\.\d{3})+$/.test(token) || /^\d{1,3}(?:,\d{3})+$/.test(token)) {
        numericText = token.replace(/[.,]/g, "");
      } else if (/^\d+[.,]0{1,2}$/.test(token)) {
        numericText = token.replace(/[.,]0{1,2}$/, "");
      } else return null;
    } else {
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(token)) return null;
      numericText = token.replaceAll(",", "");
    }
    const priceUnits = decimalUnits(numericText, site.decimals);
    if (priceUnits == null) return null;
    // 用整数最小货币单位做 10% 和四舍五入，避免浮点误差。
    const refundUnits = (priceUnits * BigInt(REFUND_PERCENT) + 50n) / 100n;
    const priceAmount = formatUnits(priceUnits, site.decimals);
    const refundAmount = formatUnits(refundUnits, site.decimals);
    return {
      source: normalizedText,
      priceAmount, refundAmount,
      ...orderSiteFields(normalizedText, context),
      refundDisplay: `${refundAmount} ${site.currency}`,
    };
  }

  function extractEligibleOrders(responseData) {
    const context = contextForResponse(responseData);
    const cards = Array.isArray(responseData?.data?.cards)
      ? responseData.data.cards
      : [];
    const seenReverseIds = new Set();
    const orders = [];

    for (const entry of cards) {
      const blocks = Array.isArray(entry?.card?.blocks)
        ? entry.card.blocks
        : [];
      const statusBlock = blocks.find((block) => block?.name === "status_block");
      const productBlock = blocks.find((block) => block?.name === "product_block");
      const statusMessages = collectMessageContents(statusBlock?.title);
      const isWaitingForCustomerReturn = statusMessages.includes(TARGET_STATUS);
      const hasStatusContent = Boolean(
        statusBlock &&
          Object.prototype.hasOwnProperty.call(statusBlock, "content"),
      );

      if (!isWaitingForCustomerReturn || hasStatusContent) continue;

      const mainOrderId = String(entry?.biz_data?.main_order_id || "").trim();
      const reverseMainOrderId = String(
        entry?.biz_data?.reverse_main_order_id || "",
      ).trim();
      const money = parseMoney(
        getProductPriceText(productBlock, entry?.biz_data),
        context,
      );

      if (!mainOrderId || !reverseMainOrderId || !money) {
        console.warn("[卖家工具箱] 跳过字段不完整的 card", entry);
        recordFailureLog({
          type: "退货退款",
          node: "解析订单卡片",
          mainOrderId,
          reverseMainOrderId,
          reason: `必要字段缺失：${[
            !mainOrderId ? "main_order_id" : "",
            !reverseMainOrderId ? "reverse_main_order_id" : "",
            !money ? "product_block 价格" : "",
          ]
            .filter(Boolean)
            .join(", ")}`,
        });
        continue;
      }
      if (seenReverseIds.has(reverseMainOrderId)) continue;
      seenReverseIds.add(reverseMainOrderId);

      orders.push({
        mainOrderId,
        reverseMainOrderId,
        ...orderSiteFields(money.source, context),
        productPrice: money.source,
        productPriceAmount: money.priceAmount,
        refundAmount: money.refundAmount,
        refundDisplay: money.refundDisplay,
        status: TARGET_STATUS,
      });
    }

    return orders;
  }

  function getReasonText(reasonBlock) {
    const reasonName = Array.isArray(reasonBlock?.content)
      ? reasonBlock.content.find((item) => item?.name === "reason_name")
      : null;
    const directText = String(
      reasonName?.text_pair?.content?.content ||
        reasonName?.text?.content ||
        "",
    ).trim();
    if (directText) return directText;

    const textValues = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (
          key === "content" &&
          typeof value === "string" &&
          value.trim()
        ) {
          textValues.push(value.trim());
        } else if (value && typeof value === "object") {
          visit(value);
        }
      }
    };
    visit(reasonBlock?.content);
    return [...new Set(textValues)].join(" / ");
  }

  function classifyRefundOnlyScenario(reasonText) {
    const normalized = String(reasonText || "").replace(/\s+/g, "");
    if (normalized.includes("已收到包裹") && normalized.includes("部分商品缺失")) {
      return {
        type: "missing_items",
        label: "已收到包裹，但部分商品缺失",
        supported: true,
      };
    }
    if (normalized.includes("未收到包裹")) {
      return {
        type: "not_received",
        label: "未收到包裹",
        supported: true,
      };
    }
    return {
      type: "unknown",
      label: reasonText || "未识别售后原因",
      supported: false,
    };
  }

  function extractRefundOnlyOrders(responseData) {
    const context = contextForResponse(responseData);
    const cards = Array.isArray(responseData?.data?.cards)
      ? responseData.data.cards
      : [];
    const seenReverseIds = new Set();
    const orders = [];

    for (const entry of cards) {
      const blocks = Array.isArray(entry?.card?.blocks)
        ? entry.card.blocks
        : [];
      const reasonBlock = blocks.find((block) => block?.name === "reason_block");
      const statusBlock = blocks.find((block) => block?.name === "status_block");
      const productBlock = blocks.find((block) => block?.name === "product_block");
      const mainOrderId = String(entry?.biz_data?.main_order_id || "").trim();
      const reverseMainOrderId = String(
        entry?.biz_data?.reverse_main_order_id || "",
      ).trim();
      const productPrice = getProductPriceText(productBlock, entry?.biz_data);
      const reasonText = getReasonText(reasonBlock);
      const scenario = classifyRefundOnlyScenario(reasonText);
      const statusTexts = collectDisplayTexts(statusBlock);
      const isPlatformHandling = statusTexts.some((text) =>
        text.includes("平台处理"),
      );
      const money = parseMoney(productPrice, context);
      const actionType =
        scenario.type === "missing_items" && isPlatformHandling
          ? "partial_refund"
          : scenario.type === "missing_items"
            ? "reject_missing_items"
            : scenario.type === "not_received"
              ? "reject_not_received"
              : "manual";
      const supported =
        scenario.supported &&
        actionType !== "manual" &&
        (actionType !== "partial_refund" || Boolean(money));

      if (!mainOrderId || !reverseMainOrderId) {
        console.warn("[卖家工具箱] 跳过字段不完整的仅退款 card", entry);
        recordFailureLog({
          type: "仅退款",
          node: "解析订单卡片",
          mainOrderId,
          reverseMainOrderId,
          reason: `必要字段缺失：${[
            !mainOrderId ? "main_order_id" : "",
            !reverseMainOrderId ? "reverse_main_order_id" : "",
          ]
            .filter(Boolean)
            .join(", ")}`,
        });
        continue;
      }
      if (seenReverseIds.has(reverseMainOrderId)) continue;
      seenReverseIds.add(reverseMainOrderId);

      orders.push({
        mainOrderId,
        reverseMainOrderId,
        productPrice: productPrice || "未提供",
        ...orderSiteFields(productPrice, context),
        productPriceAmount: money?.priceAmount || "",
        reasonText: reasonText || "未识别售后原因",
        statusText: statusTexts.join(" / ") || "未识别状态",
        isPlatformHandling,
        scenarioType: scenario.type,
        scenarioLabel: scenario.label,
        actionType,
        supported,
        refundAmount: money?.refundAmount || "",
        refundDisplay: money?.refundDisplay || "",
      });
    }

    return orders;
  }

  function hasDeliveredReplyButton(blocks) {
    // Only an actual action button counts; status/help text mentioning 回复 does not.
    // Missing/unknown button labels fail closed instead of guessing numeric action values.
    return blocks.some((block) =>
      block?.name === "button_block" &&
      block.hidden !== true &&
      Array.isArray(block.content) &&
      block.content.some((item) => {
        const button = item?.button;
        const label = button?.text?.content;
        return typeof label === "string" && label.trim() === "回复" &&
          item.hidden !== true && item.disabled !== true &&
          button.hidden !== true && button.disabled !== true &&
          button.is_disabled !== true;
      }),
    );
  }

  function extractDeliveredOrders(responseData) {
    const context = contextForResponse(responseData);
    const cards = Array.isArray(responseData?.data?.cards)
      ? responseData.data.cards
      : [];
    const seenReverseIds = new Set();
    const orders = [];

    for (const entry of cards) {
      const blocks = Array.isArray(entry?.card?.blocks)
        ? entry.card.blocks
        : [];
      const statusBlock = blocks.find((block) => block?.name === "status_block");
      const fulfillmentBlock = blocks.find(
        (block) => block?.name === "fulfillment_block",
      );
      const productBlock = blocks.find((block) => block?.name === "product_block");
      const reasonBlock = blocks.find((block) => block?.name === "reason_block");
      const statusTexts = collectDisplayTexts(statusBlock);
      const fulfillmentTexts = collectDisplayTexts(fulfillmentBlock);
      const isPendingRefund = statusTexts.some((text) =>
        text.includes(DELIVERED_TARGET_STATUS),
      );
      const isDelivered = fulfillmentTexts.some(
        (text) => text === DELIVERED_FULFILLMENT_STATUS,
      );

      const hasReplyButton = hasDeliveredReplyButton(blocks);
      if (!isPendingRefund || !isDelivered || !hasReplyButton) continue;

      const mainOrderId = String(entry?.biz_data?.main_order_id || "").trim();
      const reverseMainOrderId = String(
        entry?.biz_data?.reverse_main_order_id || "",
      ).trim();
      const productPrice = getProductPriceText(productBlock, entry?.biz_data);
      const reasonText = getReasonText(reasonBlock);

      if (!mainOrderId || !reverseMainOrderId) {
        console.warn("[卖家工具箱] 跳过字段不完整的已送达 card", entry);
        recordFailureLog({
          type: "已送达",
          node: "解析订单卡片",
          mainOrderId,
          reverseMainOrderId,
          reason: `必要字段缺失：${[
            !mainOrderId ? "main_order_id" : "",
            !reverseMainOrderId ? "reverse_main_order_id" : "",
          ]
            .filter(Boolean)
            .join(", ")}`,
        });
        continue;
      }
      if (seenReverseIds.has(reverseMainOrderId)) continue;
      seenReverseIds.add(reverseMainOrderId);

      orders.push({
        mainOrderId,
        reverseMainOrderId,
        productPrice: productPrice || "未提供",
        reasonText: reasonText || "未提供",
        ...orderSiteFields(productPrice, context),
        status: DELIVERED_TARGET_STATUS,
        fulfillmentStatus: DELIVERED_FULFILLMENT_STATUS,
        hasReplyButton,
      });
    }

    return orders;
  }

  function isDeliveredListBody(requestBody) {
    const conditions = requestBody?.search_condition;
    return Boolean(
      conditions?.tab?.str_value_list?.includes("800") &&
        conditions?.sub_tab_pending?.str_value_list?.includes(
          "sub_tab_pending_all",
        ),
    );
  }

  function handleDeliveredListResponse(
    responseData,
    requestBody,
    source,
    metadata = {},
  ) {
    if (responseData?.code !== 0 || !responseData?.data) return false;

    deliveredState.lastListResponse = responseData;
    deliveredState.lastListRequestBody = cloneSerializable(requestBody ?? {});
    deliveredState.listSource = source;
    deliveredState.totalCount = Number(responseData.data.total_count || 0);
    deliveredState.fetchedCount = Number(
      metadata.fetchedCount ?? responseData.data.cards?.length ?? 0,
    );
    deliveredState.pagesFetched = Number(metadata.pagesFetched ?? 1);
    deliveredState.pageOffsets = Array.isArray(metadata.pageOffsets)
      ? [...metadata.pageOffsets]
      : [Number(requestBody?.offset || 0)];
    deliveredState.pageSizes = Array.isArray(metadata.pageSizes)
      ? [...metadata.pageSizes]
      : [Number(responseData.data.cards?.length || 0)];
    deliveredState.orders = extractDeliveredOrders(responseData);

    console.info("[卖家工具箱] 已送达列表解析完成", {
      source,
      totalCount: deliveredState.totalCount,
      fetchedCount: deliveredState.fetchedCount,
      pagesFetched: deliveredState.pagesFetched,
      orders: deliveredState.orders,
    });

    renderDeliveredOrders();
    return true;
  }

  function isRefundOnlyListBody(requestBody) {
    const conditions = requestBody?.search_condition;
    return Boolean(
      conditions?.request_type_comp?.str_value_list?.includes(
        "request_type_refund_only",
      ) &&
        conditions?.tab?.str_value_list?.includes("800") &&
        conditions?.sub_tab_pending?.str_value_list?.includes(
          "sub_tab_pending_to_refund",
        ),
    );
  }

  function handleRefundOnlyListResponse(
    responseData,
    requestBody,
    source,
    metadata = {},
  ) {
    if (responseData?.code !== 0 || !responseData?.data) return false;

    refundOnlyState.lastListResponse = responseData;
    refundOnlyState.lastListRequestBody = cloneSerializable(requestBody ?? {});
    refundOnlyState.listSource = source;
    refundOnlyState.totalCount = Number(responseData.data.total_count || 0);
    refundOnlyState.fetchedCount = Number(
      metadata.fetchedCount ?? responseData.data.cards?.length ?? 0,
    );
    refundOnlyState.pagesFetched = Number(metadata.pagesFetched ?? 1);
    refundOnlyState.pageOffsets = Array.isArray(metadata.pageOffsets)
      ? [...metadata.pageOffsets]
      : [Number(requestBody?.offset || 0)];
    refundOnlyState.pageSizes = Array.isArray(metadata.pageSizes)
      ? [...metadata.pageSizes]
      : [Number(responseData.data.cards?.length || 0)];
    refundOnlyState.orders = extractRefundOnlyOrders(responseData);

    console.info("[卖家工具箱] 仅退款列表解析完成", {
      source,
      totalCount: refundOnlyState.totalCount,
      fetchedCount: refundOnlyState.fetchedCount,
      pagesFetched: refundOnlyState.pagesFetched,
      orders: refundOnlyState.orders,
    });

    renderRefundOnlyOrders();
    return true;
  }

  function handleListResponse(responseData, requestBody, source, metadata = {}) {
    if (responseData?.code !== 0 || !responseData?.data) return false;

    state.lastListResponse = responseData;
    state.lastListRequestBody = cloneSerializable(requestBody ?? {});
    state.listSource = source;
    state.totalCount = Number(responseData.data.total_count || 0);
    state.fetchedCount = Number(
      metadata.fetchedCount ?? responseData.data.cards?.length ?? 0,
    );
    state.pagesFetched = Number(metadata.pagesFetched ?? 1);
    state.pageOffsets = Array.isArray(metadata.pageOffsets)
      ? [...metadata.pageOffsets]
      : [Number(requestBody?.offset || 0)];
    state.pageSizes = Array.isArray(metadata.pageSizes)
      ? [...metadata.pageSizes]
      : [Number(responseData.data.cards?.length || 0)];
    state.eligibleOrders = extractEligibleOrders(responseData);

    console.info("[卖家工具箱] 退货列表解析完成", {
      source,
      totalCount: state.totalCount,
      fetchedCount: state.fetchedCount,
      pagesFetched: state.pagesFetched,
      eligibleOrders: state.eligibleOrders,
    });

    renderOrders();
    return true;
  }

  function installListFetchObserver() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") return;

    window.fetch = async function sellerToolsFetchObserver(input, init) {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const isListRequest = rawUrl.includes(LIST_API_PATH);
      const requestContext = isListRequest
        ? observeSiteContext(rawUrl, init?.headers ?? (input instanceof Request ? input.headers : undefined))
        : null;
      if (requestContext) latestListContext = requestContext;
      const isToolboxListRequest =
        isListRequest && state.internalListRequestDepth > 0;
      const bodyPromise = isListRequest
        ? readFetchBody(input, init)
        : Promise.resolve(null);

      const response = await originalFetch.apply(this, arguments);

      if (isListRequest) {
        Promise.all([bodyPromise, response.clone().json()])
          .then(([requestBody, responseData]) => {
            responseContexts.set(responseData, requestContext);
            if (!isToolboxListRequest) {
              if (isDeliveredListBody(requestBody)) {
                if (!deliveredState.loading) {
                  handleDeliveredListResponse(
                    responseData,
                    requestBody,
                    "页面请求",
                  );
                }
              } else if (isRefundOnlyListBody(requestBody)) {
                if (!refundOnlyState.loading) {
                  handleRefundOnlyListResponse(
                    responseData,
                    requestBody,
                    "页面请求",
                  );
                }
              } else if (!state.loading) {
                handleListResponse(responseData, requestBody, "页面请求");
              }
            }
          })
          .catch((error) => {
            console.warn("[卖家工具箱] 读取页面列表响应失败", error);
          });
      }

      return response;
    };
  }

  installListFetchObserver();
  installPageSiteObserver();

  function normalizePayload(input) {
    const reverseOrderId = String(
      input.reverse_main_order_id ?? input.reverseOrderId ?? "",
    ).trim();
    const amountInput = String(
      input.reverse_total ?? input.amount ?? "",
    ).trim();
    const comment = String(
      input.seller_comment ?? input.comment ?? DEFAULT_COMMENT,
    ).trim();

    if (!/^\d+$/.test(reverseOrderId)) {
      throw new Error("售后退款单号 reverse_main_order_id 必须是纯数字。");
    }
    const site = SITES.find((item) => item.id === input.siteId) ||
      siteForPrice(input.currency || "", activeSiteContext);
    if (!site) throw new Error("无法确定退款币种，请先刷新该站点的订单列表。");
    const amountUnits = decimalUnits(amountInput, site.decimals);
    if (amountUnits == null || amountUnits <= 0n) {
      throw new Error(`${site.currency} 退款金额必须大于 0，最多保留 ${site.decimals} 位小数。`);
    }
    if (!comment) throw new Error("卖家留言不能为空。");

    return {
      reverse_main_order_id: reverseOrderId,
      reverse_total: formatUnits(amountUnits, site.decimals),
      upload_images: Array.isArray(input.upload_images)
        ? input.upload_images
        : [],
      seller_comment: comment,
      operation_client: 0,
    };
  }

  function getSuccessRecord(reverseMainOrderId, amount) {
    const current = localStorage.getItem(
      `${SUCCESS_STORAGE_PREFIX}${reverseMainOrderId}`,
    );
    const legacy = localStorage.getItem(
      `${LEGACY_STORAGE_PREFIX}${reverseMainOrderId}:${amount}`,
    );
    return current || legacy;
  }

  function saveSuccessRecord(reverseMainOrderId, amount) {
    localStorage.setItem(
      `${SUCCESS_STORAGE_PREFIX}${reverseMainOrderId}`,
      JSON.stringify({ amount, time: new Date().toISOString() }),
    );
  }

  function resultMessage(result) {
    const nestedResult = result?.data?.result;
    if (result?.code === 0 && nestedResult?.is_success === true) {
      return "发送成功，请等待客户回复。";
    }
    return [
      `发送失败（code: ${String(result?.code ?? "未知")}）`,
      result?.message,
      nestedResult?.fail_reason,
      result?.fail_reason,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function submitPartialRefund(input, confirmationToken) {
    if (confirmationToken !== CONFIRM_TOKEN) {
      throw new Error("缺少明确确认，已阻止退款请求。");
    }

    const guard = createRequestGuard();
    const payload = normalizePayload(input);
    const previousSuccess = getSuccessRecord(
      payload.reverse_main_order_id,
      payload.reverse_total,
    );
    if (previousSuccess) {
      throw new Error("本浏览器已记录该售后退款单发送成功，已阻止重复提交。");
    }

    const { api } = await loadSdk();
    guard();
    assertOrderContext(input);
    const result = await parseSdkResult(
      await api.ActionPartialRefund(payload),
    );
    const succeeded =
      result?.code === 0 && result?.data?.result?.is_success === true;

    if (succeeded) {
      saveSuccessRecord(payload.reverse_main_order_id, payload.reverse_total);
    }

    return {
      succeeded,
      message: resultMessage(result),
      result,
      payload,
    };
  }

  function buildReturnRefundListRequest(offset) {
    return {
      search_condition: {
        tab: {
          str_value_list: ["900"],
        },
        order_sort_comp: {
          str_value_list: ["OrderSort_UPADTE_TIME_DESC"],
        },
      },
      pagination_type: 0,
      offset,
      count: PAGE_SIZE,
      component_version: "hit_ui_opt",
    };
  }

  async function fetchAllReverseCards({
    api,
    label,
    buildRequest,
    renderProgress,
  }) {
    const guard = createRequestGuard();
    const allCards = [];
    const pageOffsets = [];
    const pageSizes = [];
    let lastResult = null;
    let batchContext = null;

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      guard();
      const offset = pageIndex * PAGE_SIZE;
      const requestBody = buildRequest(offset);
      renderProgress(
        `正在获取第 ${pageIndex + 1} 页：offset=${offset}，count=${PAGE_SIZE}，已累计 ${allCards.length} 条……`,
      );

      let result;
      state.internalListRequestDepth += 1;
      try {
        result = await parseSdkResult(
          await api.ListReverseCards(requestBody),
        );
      } finally {
        state.internalListRequestDepth -= 1;
      }
      guard();

      if (result?.code !== 0) {
        throw new Error(
          [
            `${label} offset=${offset} 列表接口失败（code: ${String(
              result?.code ?? "未知",
            )}）`,
            result?.message,
          ]
            .filter(Boolean)
            .join("："),
        );
      }

      const pageContext = contextForResponse(result);
      if (batchContext && (
        (batchContext.sellerId && pageContext.sellerId && batchContext.sellerId !== pageContext.sellerId) ||
        (batchContext.siteId !== "unknown" && pageContext.siteId !== "unknown" && batchContext.siteId !== pageContext.siteId)
      )) throw new Error("分页期间站点或店铺发生变化，请在目标站点重新刷新列表。");
      batchContext = pageContext;

      const pageCards = Array.isArray(result?.data?.cards)
        ? result.data.cards
        : [];
      pageOffsets.push(offset);
      pageSizes.push(pageCards.length);
      allCards.push(...pageCards);
      lastResult = result;

      // 以接口本页返回的原始 cards 数量判断，而不是以筛选后的订单数判断。
      if (pageCards.length < PAGE_SIZE) break;
      if (pageIndex === MAX_PAGES - 1) {
        throw new Error(
          `${label} 已达到安全上限 ${MAX_PAGES} 页，列表可能持续变化，已停止获取。`,
        );
      }
    }

    if (!lastResult) throw new Error(`${label}列表接口没有返回任何响应。`);

    const mergedResult = {
      ...lastResult,
      data: { ...lastResult.data, cards: allCards },
    };
    responseContexts.set(mergedResult, batchContext);
    return {
      allCards,
      pageOffsets,
      pageSizes,
      pagesFetched: pageOffsets.length,
      firstRequestBody: buildRequest(0),
      mergedResult,
    };
  }

  function formatPaginationTrace(pageOffsets, pageSizes) {
    if (!pageOffsets.length) return "未发出分页请求";
    let offsetsText;
    if (pageOffsets.length <= 6) {
      offsetsText = pageOffsets.join("→");
    } else {
      offsetsText = `${pageOffsets.slice(0, 3).join("→")}→…→${pageOffsets
        .slice(-2)
        .join("→")}`;
    }
    return `offset ${offsetsText}；末页 ${pageSizes.at(-1) ?? 0} 条`;
  }

  async function refreshOrderList() {
    if (state.loading) return state.eligibleOrders;
    state.loading = true;
    renderStatus("正在通过 Reverse SDK 分页获取退货列表……");
    renderOrders();

    try {
      const { api } = await loadSdk();
      const pagination = await fetchAllReverseCards({
        api,
        label: "退货退款",
        buildRequest: buildReturnRefundListRequest,
        renderProgress: renderStatus,
      });

      handleListResponse(
        pagination.mergedResult,
        pagination.firstRequestBody,
        "工具箱全量分页",
        {
          fetchedCount: pagination.allCards.length,
          pagesFetched: pagination.pagesFetched,
          pageOffsets: pagination.pageOffsets,
          pageSizes: pagination.pageSizes,
        },
      );
      renderStatus(
        `本次累计获取 ${pagination.allCards.length} 条（${pagination.pagesFetched} 页；${formatPaginationTrace(
          pagination.pageOffsets,
          pagination.pageSizes,
        )}），共筛选出 ${state.eligibleOrders.length} 条符合条件的订单。`,
        "ok",
      );
      return state.eligibleOrders;
    } catch (error) {
      console.error("[卖家工具箱] 获取退货列表失败", error);
      const fallbackAvailable = Boolean(state.lastListResponse);
      renderStatus(
        fallbackAvailable
          ? `刷新失败，继续显示最近一次页面数据：${error?.message || String(error)}`
          : `获取失败：${error?.message || String(error)}\n请先打开退货/退款列表页面并刷新一次。`,
        "error",
      );
      renderOrders();
      throw error;
    } finally {
      state.loading = false;
      renderOrders();
    }
  }

  function buildDeliveredListRequest(offset) {
    return {
      search_condition: {
        tab: {
          str_value_list: ["800"],
        },
        order_sort_comp: {
          str_value_list: ["OrderSort_UPADTE_TIME_DESC"],
        },
        sub_tab_pending: {
          str_value_list: ["sub_tab_pending_all"],
        },
      },
      pagination_type: 0,
      offset,
      count: PAGE_SIZE,
      component_version: "hit_ui_opt",
    };
  }

  async function refreshDeliveredList() {
    if (deliveredState.loading) return deliveredState.orders;
    deliveredState.loading = true;
    renderDeliveredStatus("正在通过 Reverse SDK 分页获取已送达列表……");
    renderDeliveredOrders();

    try {
      const { api } = await loadSdk();
      const pagination = await fetchAllReverseCards({
        api,
        label: "已送达",
        buildRequest: buildDeliveredListRequest,
        renderProgress: renderDeliveredStatus,
      });
      handleDeliveredListResponse(
        pagination.mergedResult,
        pagination.firstRequestBody,
        "工具箱全量分页",
        {
          fetchedCount: pagination.allCards.length,
          pagesFetched: pagination.pagesFetched,
          pageOffsets: pagination.pageOffsets,
          pageSizes: pagination.pageSizes,
        },
      );
      renderDeliveredStatus(
        `本次累计获取 ${pagination.allCards.length} 条（${pagination.pagesFetched} 页；${formatPaginationTrace(
          pagination.pageOffsets,
          pagination.pageSizes,
        )}），共筛选出 ${deliveredState.orders.length} 条“待核发退款 + 已送达 + 有回复按钮”订单。`,
        "ok",
      );
      return deliveredState.orders;
    } catch (error) {
      console.error("[卖家工具箱] 获取已送达列表失败", error);
      const fallbackAvailable = Boolean(deliveredState.lastListResponse);
      renderDeliveredStatus(
        fallbackAvailable
          ? `刷新失败，继续显示最近一次数据：${error?.message || String(error)}`
          : `获取失败：${error?.message || String(error)}\n请先打开退货/退款列表页面并刷新一次。`,
        "error",
      );
      renderDeliveredOrders();
      throw error;
    } finally {
      deliveredState.loading = false;
      renderDeliveredOrders();
    }
  }

  function buildRefundOnlyListRequest(offset) {
    return {
      search_condition: {
        request_type_comp: {
          str_value_list: ["request_type_refund_only"],
        },
        tab: {
          str_value_list: ["800"],
        },
        order_sort_comp: {
          str_value_list: ["OrderSort_UPADTE_TIME_DESC"],
        },
        sub_tab_pending: {
          str_value_list: ["sub_tab_pending_to_refund"],
        },
      },
      pagination_type: 0,
      offset,
      count: PAGE_SIZE,
      component_version: "hit_ui_opt",
    };
  }

  async function refreshRefundOnlyList() {
    if (refundOnlyState.loading) return refundOnlyState.orders;
    refundOnlyState.loading = true;
    renderRefundOnlyStatus("正在通过 Reverse SDK 分页获取仅退款列表……");
    renderRefundOnlyOrders();

    try {
      const { api } = await loadSdk();
      const pagination = await fetchAllReverseCards({
        api,
        label: "仅退款",
        buildRequest: buildRefundOnlyListRequest,
        renderProgress: renderRefundOnlyStatus,
      });
      handleRefundOnlyListResponse(
        pagination.mergedResult,
        pagination.firstRequestBody,
        "工具箱全量分页",
        {
          fetchedCount: pagination.allCards.length,
          pagesFetched: pagination.pagesFetched,
          pageOffsets: pagination.pageOffsets,
          pageSizes: pagination.pageSizes,
        },
      );
      const supportedCount = refundOnlyState.orders.filter(
        (order) => order.supported,
      ).length;
      renderRefundOnlyStatus(
        `本次累计获取 ${pagination.allCards.length} 条（${pagination.pagesFetched} 页；${formatPaginationTrace(
          pagination.pageOffsets,
          pagination.pageSizes,
        )}），其中 ${supportedCount} 条可自动处理。`,
        "ok",
      );
      return refundOnlyState.orders;
    } catch (error) {
      console.error("[卖家工具箱] 获取仅退款列表失败", error);
      const fallbackAvailable = Boolean(refundOnlyState.lastListResponse);
      renderRefundOnlyStatus(
        fallbackAvailable
          ? `刷新失败，继续显示最近一次数据：${error?.message || String(error)}`
          : `获取失败：${error?.message || String(error)}\n请先打开退货/退款列表页面并刷新一次。`,
        "error",
      );
      renderRefundOnlyOrders();
      throw error;
    } finally {
      refundOnlyState.loading = false;
      renderRefundOnlyOrders();
    }
  }

  function getDeliveredSuccessRecord(reverseMainOrderId) {
    return localStorage.getItem(
      `${DELIVERED_SUCCESS_STORAGE_PREFIX}${reverseMainOrderId}`,
    );
  }

  function saveDeliveredSuccessRecord(reverseMainOrderId) {
    localStorage.setItem(
      `${DELIVERED_SUCCESS_STORAGE_PREFIX}${reverseMainOrderId}`,
      JSON.stringify({ time: new Date().toISOString() }),
    );
  }

  async function rejectDeliveredReturn(reverseMainOrderId, confirmationToken) {
    if (confirmationToken !== DELIVERED_REJECT_CONFIRM_TOKEN) {
      throw new Error("缺少明确确认，已阻止已送达退货拒绝请求。");
    }

    const guard = createRequestGuard();
    const normalizedId = String(reverseMainOrderId || "").trim();
    if (!/^\d+$/.test(normalizedId)) {
      throw new Error("售后退款单号 reverse_main_order_id 必须是纯数字。");
    }
    if (getDeliveredSuccessRecord(normalizedId)) {
      throw new Error("本浏览器已记录该已送达订单拒绝成功，已阻止重复提交。");
    }

    const payload = {
      reverse_main_order_id: normalizedId,
      reject_reason_key: DELIVERED_REJECT_REASON_KEY,
      seller_comment: DELIVERED_REJECT_COMMENT,
      upload_images: [],
      operation_client: 0,
    };
    const { api } = await loadSdk();
    guard();
    const result = await parseSdkResult(
      await api.ActionReturnParcelReject(payload),
    );
    const nestedSuccess = result?.data?.result?.is_success;
    const succeeded = result?.code === 0 && nestedSuccess !== false;

    if (succeeded) saveDeliveredSuccessRecord(normalizedId);

    return {
      succeeded,
      message: succeeded
        ? "已送达退货拒绝请求发送成功。"
        : [
            `发送失败（code: ${String(result?.code ?? "未知")}）`,
            result?.message,
            result?.data?.result?.fail_reason,
            result?.fail_reason,
          ]
            .filter(Boolean)
            .join("\n"),
      payload,
      result,
    };
  }

  function getRefundOnlySuccessRecord(reverseMainOrderId) {
    return localStorage.getItem(
      `${REFUND_ONLY_SUCCESS_STORAGE_PREFIX}${reverseMainOrderId}`,
    );
  }

  function saveRefundOnlySuccessRecord(reverseMainOrderId) {
    localStorage.setItem(
      `${REFUND_ONLY_SUCCESS_STORAGE_PREFIX}${reverseMainOrderId}`,
      JSON.stringify({ time: new Date().toISOString() }),
    );
  }

  function getRefundOnlyOrderSuccessRecord(order) {
    if (order?.actionType === "partial_refund") {
      return getSuccessRecord(order.reverseMainOrderId, order.refundAmount);
    }
    return getRefundOnlySuccessRecord(order?.reverseMainOrderId);
  }

  async function rejectRefundOnlyRequest(
    reverseMainOrderId,
    scenarioType,
    confirmationToken,
  ) {
    if (confirmationToken !== REJECT_CONFIRM_TOKEN) {
      throw new Error("缺少明确确认，已阻止仅退款拒绝请求。");
    }

    const guard = createRequestGuard();
    const normalizedId = String(reverseMainOrderId || "").trim();
    if (!/^\d+$/.test(normalizedId)) {
      throw new Error("售后退款单号 reverse_main_order_id 必须是纯数字。");
    }
    if (getRefundOnlySuccessRecord(normalizedId)) {
      throw new Error("本浏览器已记录该仅退款申请拒绝成功，已阻止重复提交。");
    }

    const rejectConfig =
      scenarioType === "missing_items"
        ? {
            reasonKey: REFUND_ONLY_MISSING_ITEMS_REASON_KEY,
            comment: REFUND_ONLY_MISSING_ITEMS_COMMENT,
          }
        : scenarioType === "not_received"
          ? {
              reasonKey: REFUND_ONLY_NOT_RECEIVED_REASON_KEY,
              comment: "",
            }
          : null;
    if (!rejectConfig) {
      throw new Error(`尚未配置该仅退款场景：${String(scenarioType || "未知")}`);
    }

    const payload = {
      reverse_main_order_id: normalizedId,
      reject_reason_key: rejectConfig.reasonKey,
      upload_images: [],
      seller_comment: rejectConfig.comment,
      operation_client: 0,
    };
    const { api } = await loadSdk();
    guard();
    const result = await parseSdkResult(
      await api.ActionReturnApplyReject(payload),
    );
    const nestedSuccess = result?.data?.result?.is_success;
    const succeeded = result?.code === 0 && nestedSuccess !== false;

    if (succeeded) {
      saveRefundOnlySuccessRecord(normalizedId);
    }

    return {
      succeeded,
      message: succeeded
        ? "仅退款拒绝请求发送成功。"
        : [
            `发送失败（code: ${String(result?.code ?? "未知")}）`,
            result?.message,
            result?.data?.result?.fail_reason,
          ]
            .filter(Boolean)
            .join("\n"),
      payload,
      result,
    };
  }

  function rejectRefundOnlyMissingItems(reverseMainOrderId, confirmationToken) {
    return rejectRefundOnlyRequest(
      reverseMainOrderId,
      "missing_items",
      confirmationToken,
    );
  }

  function rejectRefundOnlyNotReceived(reverseMainOrderId, confirmationToken) {
    return rejectRefundOnlyRequest(
      reverseMainOrderId,
      "not_received",
      confirmationToken,
    );
  }

  const deliveredModule = Object.freeze({
    id: "delivered",
    title: "已送达",
    ready: true,
    refresh: refreshDeliveredList,
    getOrders: () => cloneSerializable(deliveredState.orders),
    parseOrders: extractDeliveredOrders,
    reject: rejectDeliveredReturn,
  });

  const refundOnlyModule = Object.freeze({
    id: "refundOnly",
    title: "仅退款",
    ready: true,
    supportedScenario: "已收到包裹，但部分商品缺失",
    refresh: refreshRefundOnlyList,
    getOrders: () => cloneSerializable(refundOnlyState.orders),
    parseOrders: extractRefundOnlyOrders,
    rejectMissingItems: rejectRefundOnlyMissingItems,
    rejectNotReceived: rejectRefundOnlyNotReceived,
  });

  const partialRefundModule = Object.freeze({
    id: "partialRefund",
    title: "待客户退货 · 10% 部分退款",
    loadSdk,
    refresh: refreshOrderList,
    getEligibleOrders: () => cloneSerializable(state.eligibleOrders),
    parseOrders: extractEligibleOrders,
    submit: submitPartialRefund,
    diagnose: async () => {
      const sdk = await loadSdk();
      return {
        sdkUrl: sdk.url,
        exportName: sdk.exportName,
        listType: typeof sdk.api.ListReverseCards,
        actionType: typeof sdk.api.ActionPartialRefund,
      };
    },
  });

  window.TikTokShopSellerTools = {
    name: "TikTok Shop 卖家工具箱",
    version: APP_VERSION,
    modules: {
      delivered: deliveredModule,
      refundOnly: refundOnlyModule,
      partialRefund: partialRefundModule,
    },
    logs: Object.freeze({
      getRecent: () => cloneSerializable(activityLogState.entries),
      getSegments: async () => cloneSerializable(await readPersistentLogSegments()),
      export: exportPersistentLogs,
    }),
  };
  window.TTSDelivered = deliveredModule;
  window.TTSPartialRefund = partialRefundModule;
  window.TTSRefundOnly = refundOnlyModule;

  function renderStatus(message, type = "") {
    if (!ui) return;
    ui.status.textContent = message;
    ui.status.className = `show ${type}`.trim();
  }

  function renderDeliveredStatus(message, type = "") {
    if (!ui) return;
    ui.deliveredStatus.textContent = message;
    ui.deliveredStatus.className = `show ${type}`.trim();
  }

  function renderRefundOnlyStatus(message, type = "") {
    if (!ui) return;
    ui.refundOnlyStatus.textContent = message;
    ui.refundOnlyStatus.className = `show ${type}`.trim();
  }

  function makeInfoLine(label, value, emphasize = false) {
    const line = document.createElement("div");
    line.className = "info-line";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement(emphasize ? "strong" : "span");
    valueNode.textContent = value;
    line.append(labelNode, valueNode);
    return line;
  }

  function renderDeliveredOrders() {
    if (!ui) return;
    const pendingCount = deliveredState.orders.filter(
      (order) => !getDeliveredSuccessRecord(order.reverseMainOrderId),
    ).length;
    ui.deliveredSummary.textContent = deliveredState.lastListResponse
      ? `接口总数 ${deliveredState.totalCount} · 本次累计获取 ${deliveredState.fetchedCount} 条（${deliveredState.pagesFetched} 页） · ${formatPaginationTrace(
          deliveredState.pageOffsets,
          deliveredState.pageSizes,
        )} · 符合 ${deliveredState.orders.length} 条`
      : "尚未获取已送达列表";
    ui.deliveredRefresh.disabled =
      deliveredState.loading || deliveredState.bulkSending;
    ui.deliveredRefresh.textContent = deliveredState.loading
      ? "获取中…"
      : "刷新列表";
    ui.deliveredSendAll.disabled =
      deliveredState.loading || deliveredState.bulkSending || pendingCount === 0;
    ui.deliveredSendAll.textContent = deliveredState.bulkSending
      ? "批量拒绝中…"
      : `一键拒绝全部（${pendingCount}）`;
    ui.deliveredOrders.replaceChildren();

    if (!deliveredState.orders.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = deliveredState.loading
        ? "正在读取已送达订单……"
        : "当前没有同时满足“待核发退款 + 已送达 + 有回复按钮”的订单。";
      ui.deliveredOrders.append(empty);
      return;
    }

    for (const order of deliveredState.orders) {
      const card = document.createElement("article");
      card.className = "order-card";
      const heading = document.createElement("div");
      heading.className = "order-heading";
      const title = document.createElement("strong");
      title.textContent = `订单 ${order.mainOrderId}`;
      const badge = document.createElement("span");
      badge.className = "badge delivered";
      badge.textContent = order.fulfillmentStatus;
      heading.append(title, badge);

      const details = document.createElement("div");
      details.className = "details";
      details.append(
        makeInfoLine("售后退款单号", order.reverseMainOrderId),
        makeInfoLine("处理状态", order.status),
        makeInfoLine("退货物流状态", order.fulfillmentStatus, true),
        makeInfoLine("商品价格", order.productPrice),
        makeInfoLine("售后原因", order.reasonText),
      );

      const actionRow = document.createElement("div");
      actionRow.className = "action-row";
      const result = document.createElement("span");
      result.className = "row-result";
      result.dataset.deliveredResultFor = order.reverseMainOrderId;
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "send-refund delivered-reject";
      reject.dataset.deliveredReverseId = order.reverseMainOrderId;
      const sentBefore = getDeliveredSuccessRecord(order.reverseMainOrderId);
      reject.disabled = Boolean(sentBefore) || deliveredState.bulkSending;
      reject.textContent = sentBefore ? "已拒绝" : "拒绝（商品物理损坏）";
      if (sentBefore) result.textContent = "本浏览器已有成功记录";

      actionRow.append(result, reject);
      card.append(heading, details, actionRow);
      ui.deliveredOrders.append(card);
    }
  }

  function renderOrders() {
    if (!ui) return;
    const eligibleCount = state.eligibleOrders.filter((order) => refundThresholdDecision(order).allowed).length;
    ui.summary.textContent = state.lastListResponse
      ? `接口总数 ${state.totalCount} · 本次累计获取 ${state.fetchedCount} 条（${state.pagesFetched} 页） · ${formatPaginationTrace(
          state.pageOffsets,
          state.pageSizes,
        )} · 可批量 ${eligibleCount} 条 · 待处理 ${state.eligibleOrders.length - eligibleCount} 条 · 退款比例 ${REFUND_PERCENT}%`
      : `尚未获取列表 · 退款比例 ${REFUND_PERCENT}%`;
    const pendingCount = state.eligibleOrders.filter(
      (order) =>
        refundThresholdDecision(order).allowed &&
        !getSuccessRecord(order.reverseMainOrderId, order.refundAmount),
    ).length;
    ui.refresh.disabled = state.loading || state.bulkSending;
    ui.refresh.textContent = state.loading ? "获取中…" : "刷新列表";
    ui.sendAll.disabled =
      state.loading || state.bulkSending || pendingCount === 0;
    ui.sendAll.textContent = state.bulkSending
      ? "批量发送中…"
      : `一键发送全部（${pendingCount}）`;
    ui.orders.replaceChildren();

    if (!state.eligibleOrders.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = state.loading
        ? "正在读取订单……"
        : "当前返回批次中没有符合条件的订单。";
      ui.orders.append(empty);
      return;
    }

    const automaticSection = document.createElement("section");
    const manualSection = document.createElement("section");
    automaticSection.className = "order-section";
    manualSection.className = "order-section review-section";
    for (const [section, text] of [
      [automaticSection, `阈值内 · 可批量处理（${eligibleCount}）`],
      [manualSection, `超出阈值／待检查（${state.eligibleOrders.length - eligibleCount}）· 不参与一键和自动发送`],
    ]) {
      const heading = document.createElement("h3");
      heading.textContent = text;
      section.append(heading);
      ui.orders.append(section);
    }
    for (const order of state.eligibleOrders) {
      const threshold = refundThresholdDecision(order);
      const card = document.createElement("article");
      card.className = "order-card";

      const heading = document.createElement("div");
      heading.className = "order-heading";
      const title = document.createElement("strong");
      title.textContent = `订单 ${order.mainOrderId}`;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = order.status;
      heading.append(title, badge);

      const details = document.createElement("div");
      details.className = "details";
      details.append(
        makeInfoLine("售后退款单号", order.reverseMainOrderId),
        makeInfoLine("商品已付价格", order.productPrice),
        makeInfoLine("来源站点", order.siteLabel || "站点未知"),
        makeInfoLine("阈值判断", threshold.reason),
        makeInfoLine(`${REFUND_PERCENT}% 建议退款`, order.refundDisplay, true),
      );

      const actionRow = document.createElement("div");
      actionRow.className = "action-row";
      const result = document.createElement("span");
      result.className = "row-result";
      result.dataset.resultFor = order.reverseMainOrderId;

      const send = document.createElement("button");
      send.type = "button";
      send.className = "send-refund";
      send.dataset.reverseId = order.reverseMainOrderId;
      const sentBefore = getSuccessRecord(
        order.reverseMainOrderId,
        order.refundAmount,
      );
      send.disabled = !threshold.allowed || Boolean(sentBefore) || state.bulkSending;
      send.textContent = sentBefore ? "已发送" : threshold.allowed ? `发送 ${order.refundDisplay}` : "待手动处理";
      if (sentBefore) result.textContent = "本浏览器已有成功记录";

      actionRow.append(result, send);
      card.append(heading, details, actionRow);
      (threshold.allowed ? automaticSection : manualSection).append(card);
    }
  }

  function getRefundOnlyActionLabel(order, retry = false) {
    const prefix = retry ? "重试" : "";
    if (order?.actionType === "partial_refund") {
      return `${prefix || "发送"} ${order.refundDisplay || "10% 部分退款"}`;
    }
    if (order?.actionType === "reject_not_received") {
      return `${prefix || "拒绝"}（包裹已送达）`;
    }
    if (order?.actionType === "reject_missing_items") {
      return `${prefix || "拒绝"}（证据不足）`;
    }
    return "无法自动处理";
  }

  function getRefundOnlyActionName(order) {
    if (order?.actionType === "partial_refund") return "10% 部分退款";
    if (order?.actionType === "reject_not_received") {
      return "拒绝（包裹已送达）";
    }
    if (order?.actionType === "reject_missing_items") {
      return "拒绝（证据不足）";
    }
    return "手动处理";
  }

  function renderRefundOnlyOrders() {
    if (!ui) return;
    const supportedOrders = refundOnlyState.orders.filter(
      (order) => order.supported && (order.actionType !== "partial_refund" || refundThresholdDecision(order).allowed),
    );
    const pendingOrders = supportedOrders.filter(
      (order) => !getRefundOnlyOrderSuccessRecord(order),
    );
    const manualCount = refundOnlyState.orders.length - supportedOrders.length;

    ui.refundOnlySummary.textContent = refundOnlyState.lastListResponse
      ? `接口总数 ${refundOnlyState.totalCount} · 本次累计获取 ${refundOnlyState.fetchedCount} 条（${refundOnlyState.pagesFetched} 页） · ${formatPaginationTrace(
          refundOnlyState.pageOffsets,
          refundOnlyState.pageSizes,
        )} · 可自动处理 ${supportedOrders.length} 条 · 待手动 ${manualCount} 条`
      : "尚未获取仅退款列表";
    ui.refundOnlyRefresh.disabled =
      refundOnlyState.loading || refundOnlyState.bulkSending;
    ui.refundOnlyRefresh.textContent = refundOnlyState.loading
      ? "获取中…"
      : "刷新列表";
    ui.refundOnlySendAll.disabled =
      refundOnlyState.loading ||
      refundOnlyState.bulkSending ||
      pendingOrders.length === 0;
    ui.refundOnlySendAll.textContent = refundOnlyState.bulkSending
      ? "批量处理中…"
      : `一键处理全部（${pendingOrders.length}）`;
    ui.refundOnlyOrders.replaceChildren();

    if (!refundOnlyState.orders.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = refundOnlyState.loading
        ? "正在读取仅退款订单……"
        : "当前筛选条件下没有仅退款待核发订单。";
      ui.refundOnlyOrders.append(empty);
      return;
    }

    const automaticSection = document.createElement("section");
    const manualSection = document.createElement("section");
    automaticSection.className = "order-section";
    manualSection.className = "order-section review-section";
    for (const [section, text] of [
      [automaticSection, `可批量处理（${supportedOrders.length}）`],
      [manualSection, `超出阈值／待手动处理（${manualCount}）· 不参与一键和自动发送`],
    ]) {
      const heading = document.createElement("h3");
      heading.textContent = text;
      section.append(heading);
      ui.refundOnlyOrders.append(section);
    }
    for (const order of refundOnlyState.orders) {
      const threshold = order.actionType === "partial_refund" ? refundThresholdDecision(order) : { allowed: true };
      const card = document.createElement("article");
      card.className = "order-card";

      const heading = document.createElement("div");
      heading.className = "order-heading";
      const title = document.createElement("strong");
      title.textContent = `订单 ${order.mainOrderId}`;
      const badge = document.createElement("span");
      badge.className = `badge ${order.supported ? "" : "manual"}`.trim();
      badge.textContent = order.supported
        ? getRefundOnlyActionName(order)
        : "需要手动处理";
      heading.append(title, badge);

      const details = document.createElement("div");
      details.className = "details";
      details.append(
        makeInfoLine("售后退款单号", order.reverseMainOrderId),
        makeInfoLine("商品价格", order.productPrice),
        makeInfoLine("售后原因", order.reasonText, true),
        makeInfoLine("来源站点", order.siteLabel || "站点未知"),
        makeInfoLine("当前状态", order.statusText, true),
      );
      if (order.actionType === "partial_refund") {
        details.append(
          makeInfoLine("阈值判断", threshold.reason),
          makeInfoLine(`${REFUND_PERCENT}% 建议退款`, order.refundDisplay, true),
        );
      }

      const actionRow = document.createElement("div");
      actionRow.className = "action-row";
      const result = document.createElement("span");
      result.className = "row-result";
      result.dataset.refundOnlyResultFor = order.reverseMainOrderId;

      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "send-refund refund-only-reject";
      reject.dataset.refundOnlyReverseId = order.reverseMainOrderId;
      const sentBefore = getRefundOnlyOrderSuccessRecord(order);
      reject.disabled =
        !threshold.allowed || !order.supported || Boolean(sentBefore) || refundOnlyState.bulkSending;
      if (sentBefore) {
        reject.textContent =
          order.actionType === "partial_refund" ? "已退款" : "已拒绝";
        result.textContent = "本浏览器已有成功记录";
      } else if (!threshold.allowed) {
        reject.textContent = "待手动处理";
        result.textContent = threshold.reason;
      } else if (!order.supported) {
        reject.textContent = "无法自动处理";
        result.textContent =
          order.actionType === "partial_refund"
            ? "无法解析商品价格，不能计算 10% 退款金额"
            : "售后原因尚未配置自动处理规则";
      } else {
        reject.textContent = getRefundOnlyActionLabel(order);
      }

      actionRow.append(result, reject);
      card.append(heading, details, actionRow);
      (order.supported && threshold.allowed ? automaticSection : manualSection).append(card);
    }
  }

  function formatLogTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return String(timestamp || "未知时间");
    try {
      return date.toLocaleString("zh-CN", {
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
    } catch {
      return date.toLocaleString("zh-CN", { hour12: false });
    }
  }

  function formatLogBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }

  function renderActivityLogs() {
    if (!ui?.logEntries) return;
    const entries = activityLogState.entries;
    ui.logTool.textContent = "Log";
    ui.logSummary.textContent =
      `界面保留最近 ${entries.length}/${MAX_ACTIVITY_LOG_ENTRIES} 条；` +
      (activityLogState.segmentCount == null
        ? "持久日志分卷统计尚未刷新。"
        : `持久日志共 ${activityLogState.segmentCount} 个分卷、${formatLogBytes(
            activityLogState.totalBytes,
          )}，单卷上限 1 MiB、最多 ${MAX_LOG_SEGMENTS} 卷。`);
    ui.logFileState.textContent = activityLogState.fileError
      ? `持久日志异常：${activityLogState.fileError}`
      : "持久日志：IndexedDB 写入正常";
    ui.logFileState.className = activityLogState.fileError
      ? "show error"
      : "show ok";
    ui.logEntries.replaceChildren();

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂时没有操作日志。";
      ui.logEntries.append(empty);
      return;
    }

    for (const entry of entries) {
      const card = document.createElement("article");
      card.className = `log-card ${entry.status === "成功" ? "success" : "failure"}`;
      const heading = document.createElement("div");
      heading.className = "order-heading";
      const title = document.createElement("strong");
      title.textContent = `${formatLogTime(entry.timestamp)} · ${entry.type}`;
      const badge = document.createElement("span");
      badge.className = `log-badge ${entry.status === "成功" ? "success" : "failure"}`;
      badge.textContent = entry.status;
      heading.append(title, badge);

      const details = document.createElement("div");
      details.className = "details log-details";
      details.append(
        makeInfoLine("执行节点", entry.node || "未知节点"),
        makeInfoLine("站点", entry.siteLabel || "历史日志／站点未知"),
        makeInfoLine("币种", entry.currency || "—"),
        makeInfoLine("普通订单号", entry.mainOrderId || "—"),
        makeInfoLine("售后退款单号", entry.reverseMainOrderId || "—"),
        makeInfoLine("结果 / 原因", entry.reason || "—", true),
      );
      card.append(heading, details);
      ui.logEntries.append(card);
    }
  }

  async function executeDeliveredRejection(order, button, bulkMode = false) {
    const resultNode = ui.root.querySelector(
      `[data-delivered-result-for="${order.reverseMainOrderId}"]`,
    );
    if (button) {
      button.disabled = true;
      button.textContent = "拒绝中…";
    }
    if (resultNode) resultNode.textContent = "正在调用 Reverse SDK";

    try {
      assertOrderContext(order);
      if (order.hasReplyButton !== true) {
        throw new Error("未确认订单具有回复按钮，已阻止拒绝请求，请刷新列表。");
      }
      const outcome = await rejectDeliveredReturn(
        order.reverseMainOrderId,
        DELIVERED_REJECT_CONFIRM_TOKEN,
      );
      console.info("[卖家工具箱] 已送达拒绝接口结果", outcome.result);

      if (outcome.succeeded) {
        recordSuccessLog({
          type: "已送达",
          node: "提交退货包裹拒绝",
          order,
          mainOrderId: order.mainOrderId,
          reverseMainOrderId: order.reverseMainOrderId,
          reason: outcome.message,
        });
        if (button) button.textContent = "拒绝成功";
        if (resultNode) {
          resultNode.textContent = outcome.message;
          resultNode.className = "row-result ok";
        }
      } else {
        recordFailureLog({
          type: "已送达",
          node: "提交退货包裹拒绝",
          order,
          mainOrderId: order.mainOrderId,
          reverseMainOrderId: order.reverseMainOrderId,
          reason: outcome.result || outcome.message,
        });
        if (button) {
          button.disabled = bulkMode;
          button.textContent = "重试拒绝";
        }
        if (resultNode) {
          resultNode.textContent = outcome.message;
          resultNode.className = "row-result error";
        }
      }
      return outcome;
    } catch (error) {
      console.error("[卖家工具箱] 已送达拒绝请求异常", error);
      recordFailureLog({
        type: "已送达",
        node: "调用退货包裹拒绝接口",
        order,
        mainOrderId: order.mainOrderId,
        reverseMainOrderId: order.reverseMainOrderId,
        reason: error,
      });
      if (button) {
        button.disabled = bulkMode;
        button.textContent = "重试拒绝";
      }
      if (resultNode) {
        resultNode.textContent = error?.message || String(error);
        resultNode.className = "row-result error";
      }
      return { succeeded: false, error };
    }
  }

  async function rejectDeliveredOrder(order, button) {
    const confirmed = window.confirm(
      `即将拒绝真实的已送达退货退款申请：\n\n普通订单号：${order.mainOrderId}\n售后退款单号：${order.reverseMainOrderId}\n处理状态：${order.status}\n退货物流状态：${order.fulfillmentStatus}\n拒绝原因：此商品存在物理损坏\n卖家回复：${DELIVERED_REJECT_COMMENT}\n\n是否继续？`,
    );
    if (!confirmed) return;
    return executeDeliveredRejection(order, button, false);
  }

  async function rejectAllDeliveredOrders(options = {}) {
    const automated = Boolean(options.automated);
    const shouldContinue =
      typeof options.shouldContinue === "function"
        ? options.shouldContinue
        : () => true;
    if (deliveredState.loading || deliveredState.bulkSending) {
      return { type: "已送达", skipped: true, reason: "模块当前正忙" };
    }
    const candidates = deliveredState.orders.filter(
      (order) => !getDeliveredSuccessRecord(order.reverseMainOrderId),
    );
    if (!candidates.length) {
      renderDeliveredStatus("没有尚未处理的已送达订单。", "ok");
      return { type: "已送达", total: 0, processed: 0, successCount: 0, failedCount: 0 };
    }

    if (!automated) {
      const confirmed = window.confirm(
        `确认批量操作：\n\n即将依次拒绝 ${candidates.length} 条真实的退货退款申请。\n这些订单均为“待核发退款 + 已送达 + 有回复按钮”。\n拒绝原因统一为“此商品存在物理损坏”。\n已经成功的请求无法由脚本撤回。\n\n确定全部拒绝吗？`,
      );
      if (!confirmed) return { type: "已送达", cancelled: true };
    }

    deliveredState.bulkSending = true;
    renderDeliveredOrders();
    let successCount = 0;
    let failedCount = 0;
    let processed = 0;
    let cancelled = false;
    const failedReverseIds = [];

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        if (!shouldContinue()) {
          cancelled = true;
          break;
        }
        const order = candidates[index];
        const button = ui.root.querySelector(
          `button[data-delivered-reverse-id="${order.reverseMainOrderId}"]`,
        );
        ui.deliveredSendAll.textContent =
          `正在拒绝 ${index + 1}/${candidates.length}`;
        renderDeliveredStatus(
          `批量拒绝进度 ${index + 1}/${candidates.length}\n当前售后退款单号：${order.reverseMainOrderId}`,
        );
        const outcome = await executeDeliveredRejection(order, button, true);
        processed += 1;
        if (outcome?.succeeded) successCount += 1;
        else {
          failedCount += 1;
          failedReverseIds.push(order.reverseMainOrderId);
        }
      }

      renderDeliveredStatus(
        `${cancelled ? "批量拒绝已停止" : "批量拒绝完成"}：成功 ${successCount} 条，失败 ${failedCount} 条，共处理 ${processed}/${candidates.length} 条。${
          failedReverseIds.length
            ? `\n失败售后退款单号：${failedReverseIds.join(", ")}`
            : ""
        }`,
        failedCount ? "error" : "ok",
      );
    } finally {
      deliveredState.bulkSending = false;
      renderDeliveredOrders();
    }
    return {
      type: "已送达",
      total: candidates.length,
      processed,
      successCount,
      failedCount,
      cancelled,
      failedReverseIds,
    };
  }

  async function executeOrderRefund(order, button, bulkMode = false) {
    const resultNode = ui.root.querySelector(
      `[data-result-for="${order.reverseMainOrderId}"]`,
    );
    if (button) {
      button.disabled = true;
      button.textContent = "发送中…";
    }
    if (resultNode) resultNode.textContent = "正在调用 Reverse SDK";

    try {
      assertOrderContext(order);
      const threshold = refundThresholdDecision(order);
      if (!threshold.allowed) throw new Error(`已移入待处理区：${threshold.reason}`);
      const outcome = await submitPartialRefund(
        {
          reverseOrderId: order.reverseMainOrderId,
          siteId: order.siteId,
          sellerId: order.sellerId,
          currency: order.currency,
          amount: order.refundAmount,
          comment: DEFAULT_COMMENT,
        },
        CONFIRM_TOKEN,
      );
      console.info("[卖家工具箱] 部分退款接口结果", outcome.result);

      if (outcome.succeeded) {
        recordSuccessLog({
          type: "退货退款",
          node: "提交部分退款提议",
          order,
          mainOrderId: order.mainOrderId,
          reverseMainOrderId: order.reverseMainOrderId,
          reason: outcome.message,
        });
        if (button) button.textContent = "发送成功";
        if (resultNode) {
          resultNode.textContent = outcome.message;
          resultNode.className = "row-result ok";
        }
      } else {
        recordFailureLog({
          type: "退货退款",
          node: "提交部分退款提议",
          order,
          mainOrderId: order.mainOrderId,
          reverseMainOrderId: order.reverseMainOrderId,
          reason: outcome.result || outcome.message,
        });
        if (button) {
          button.disabled = bulkMode;
          button.textContent = `重试 ${order.refundDisplay}`;
        }
        if (resultNode) {
          resultNode.textContent = outcome.message;
          resultNode.className = "row-result error";
        }
      }
      return outcome;
    } catch (error) {
      console.error("[卖家工具箱] 部分退款请求异常", error);
      recordFailureLog({
        type: "退货退款",
        node: "调用部分退款接口",
        order,
        mainOrderId: order.mainOrderId,
        reverseMainOrderId: order.reverseMainOrderId,
        reason: error,
      });
      if (button) {
        button.disabled = bulkMode;
        button.textContent = `重试 ${order.refundDisplay}`;
      }
      if (resultNode) {
        resultNode.textContent = error?.message || String(error);
        resultNode.className = "row-result error";
      }
      return { succeeded: false, error };
    }
  }

  async function sendOrderRefund(order, button) {
    const confirmed = window.confirm(
      `即将发送真实的部分退款提议：\n\n普通订单号：${order.mainOrderId}\n售后退款单号：${order.reverseMainOrderId}\n商品价格：${order.productPrice}\n退款比例：${REFUND_PERCENT}%\n退款金额：${order.refundDisplay}\n\n是否继续？`,
    );
    if (!confirmed) return;
    return executeOrderRefund(order, button, false);
  }

  async function sendAllEligibleOrders(options = {}) {
    const automated = Boolean(options.automated);
    const shouldContinue =
      typeof options.shouldContinue === "function"
        ? options.shouldContinue
        : () => true;
    if (state.loading || state.bulkSending) {
      return { type: "退货退款", skipped: true, reason: "模块当前正忙" };
    }

    const candidates = state.eligibleOrders.filter(
      (order) =>
        refundThresholdDecision(order).allowed &&
        !getSuccessRecord(order.reverseMainOrderId, order.refundAmount),
    );
    if (!candidates.length) {
      renderStatus("没有尚未发送的符合条件订单。", "ok");
      return { type: "退货退款", total: 0, processed: 0, successCount: 0, failedCount: 0 };
    }

    if (!automated) {
      const confirmed = window.confirm(
        `确认批量操作：\n\n即将为 ${candidates.length} 条订单依次发送真实的部分退款提议。\n每条退款金额为商品价格的 ${REFUND_PERCENT}%。\n操作开始后，已经成功的请求无法由脚本撤回。\n\n确定全部发送吗？`,
      );
      if (!confirmed) return { type: "退货退款", cancelled: true };
    }

    state.bulkSending = true;
    renderOrders();
    let successCount = 0;
    let failedCount = 0;
    let processed = 0;
    let cancelled = false;
    const failedReverseIds = [];

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        if (!shouldContinue()) {
          cancelled = true;
          break;
        }
        const order = candidates[index];
        const button = ui.root.querySelector(
          `button[data-reverse-id="${order.reverseMainOrderId}"]`,
        );
        ui.sendAll.textContent = `正在发送 ${index + 1}/${candidates.length}`;
        renderStatus(
          `批量发送进度 ${index + 1}/${candidates.length}\n当前售后退款单号：${order.reverseMainOrderId}`,
        );

        const outcome = await executeOrderRefund(order, button, true);
        processed += 1;
        if (outcome?.succeeded) successCount += 1;
        else {
          failedCount += 1;
          failedReverseIds.push(order.reverseMainOrderId);
        }
      }

      renderStatus(
        `${cancelled ? "批量发送已停止" : "批量发送完成"}：成功 ${successCount} 条，失败 ${failedCount} 条，共处理 ${processed}/${candidates.length} 条。${
          failedReverseIds.length
            ? `\n失败售后退款单号：${failedReverseIds.join(", ")}`
            : ""
        }`,
        failedCount ? "error" : "ok",
      );
    } finally {
      state.bulkSending = false;
      renderOrders();
    }
    return {
      type: "退货退款",
      total: candidates.length,
      processed,
      successCount,
      failedCount,
      cancelled,
      failedReverseIds,
    };
  }

  async function executeRefundOnlyAction(order, button, bulkMode = false) {
    const resultNode = ui.root.querySelector(
      `[data-refund-only-result-for="${order.reverseMainOrderId}"]`,
    );
    const isPartialRefund = order.actionType === "partial_refund";
    const actionNode = isPartialRefund ? "提交 10% 部分退款" : "提交拒绝申请";
    if (button) {
      button.disabled = true;
      button.textContent = isPartialRefund ? "退款中…" : "拒绝中…";
    }
    if (resultNode) resultNode.textContent = "正在调用 Reverse SDK";

    try {
      assertOrderContext(order);
      if (isPartialRefund) {
        const threshold = refundThresholdDecision(order);
        if (!threshold.allowed) throw new Error(`已移入待处理区：${threshold.reason}`);
      }
      const outcome = isPartialRefund
        ? await submitPartialRefund(
            {
              reverseOrderId: order.reverseMainOrderId,
              siteId: order.siteId,
              sellerId: order.sellerId,
              currency: order.currency,
              amount: order.refundAmount,
              comment: DEFAULT_COMMENT,
            },
            CONFIRM_TOKEN,
          )
        : await rejectRefundOnlyRequest(
            order.reverseMainOrderId,
            order.scenarioType,
            REJECT_CONFIRM_TOKEN,
          );
      console.info("[卖家工具箱] 仅退款处理接口结果", outcome.result);

      if (outcome.succeeded) {
        recordSuccessLog({
          type: "仅退款",
          node: actionNode,
          order,
          mainOrderId: order.mainOrderId,
          reverseMainOrderId: order.reverseMainOrderId,
          reason: outcome.message,
        });
        if (button) {
          button.textContent = isPartialRefund ? "退款成功" : "拒绝成功";
        }
        if (resultNode) {
          resultNode.textContent = outcome.message;
          resultNode.className = "row-result ok";
        }
      } else {
        recordFailureLog({
          type: "仅退款",
          node: actionNode,
          order,
          mainOrderId: order.mainOrderId,
          reverseMainOrderId: order.reverseMainOrderId,
          reason: outcome.result || outcome.message,
        });
        if (button) {
          button.disabled = bulkMode;
          button.textContent = getRefundOnlyActionLabel(order, true);
        }
        if (resultNode) {
          resultNode.textContent = outcome.message;
          resultNode.className = "row-result error";
        }
      }
      return outcome;
    } catch (error) {
      console.error("[卖家工具箱] 仅退款处理请求异常", error);
      recordFailureLog({
        type: "仅退款",
        node: isPartialRefund ? "调用部分退款接口" : "调用拒绝接口",
        order,
        mainOrderId: order.mainOrderId,
        reverseMainOrderId: order.reverseMainOrderId,
        reason: error,
      });
      if (button) {
        button.disabled = bulkMode;
        button.textContent = getRefundOnlyActionLabel(order, true);
      }
      if (resultNode) {
        resultNode.textContent = error?.message || String(error);
        resultNode.className = "row-result error";
      }
      return { succeeded: false, error };
    }
  }

  async function processRefundOnlyOrder(order, button) {
    if (!order.supported) return;
    const actionDetails =
      order.actionType === "partial_refund"
        ? `处理方式：${REFUND_PERCENT}% 部分退款\n退款金额：${order.refundDisplay}\n卖家回复：${DEFAULT_COMMENT}`
        : order.actionType === "reject_not_received"
          ? `处理方式：拒绝\n拒绝原因：${REFUND_ONLY_NOT_RECEIVED_REASON_LABEL}\n卖家回复：无`
          : `处理方式：拒绝\n拒绝原因：证据不足\n卖家回复：${REFUND_ONLY_MISSING_ITEMS_COMMENT}`;
    const confirmed = window.confirm(
      `即将处理真实的仅退款申请：\n\n普通订单号：${order.mainOrderId}\n售后退款单号：${order.reverseMainOrderId}\n售后原因：${order.reasonText}\n当前状态：${order.statusText}\n${actionDetails}\n\n是否继续？`,
    );
    if (!confirmed) return;
    return executeRefundOnlyAction(order, button, false);
  }

  async function processAllSupportedRefundOnlyOrders(options = {}) {
    const automated = Boolean(options.automated);
    const shouldContinue =
      typeof options.shouldContinue === "function"
        ? options.shouldContinue
        : () => true;
    if (refundOnlyState.loading || refundOnlyState.bulkSending) {
      return { type: "仅退款", skipped: true, reason: "模块当前正忙" };
    }

    const candidates = refundOnlyState.orders.filter(
      (order) =>
        order.supported &&
        (order.actionType !== "partial_refund" || refundThresholdDecision(order).allowed) &&
        !getRefundOnlyOrderSuccessRecord(order),
    );
    if (!candidates.length) {
      renderRefundOnlyStatus("没有尚未处理的可自动处理订单。", "ok");
      return { type: "仅退款", total: 0, processed: 0, successCount: 0, failedCount: 0 };
    }

    const partialRefundCount = candidates.filter(
      (order) => order.actionType === "partial_refund",
    ).length;
    const missingItemsRejectCount = candidates.filter(
      (order) => order.actionType === "reject_missing_items",
    ).length;
    const notReceivedRejectCount = candidates.filter(
      (order) => order.actionType === "reject_not_received",
    ).length;

    if (!automated) {
      const confirmed = window.confirm(
        `确认批量操作：\n\n即将依次处理 ${candidates.length} 条真实的仅退款申请。\n平台处理 + 部分商品缺失：${partialRefundCount} 条，发送 ${REFUND_PERCENT}% 部分退款。\n其他部分商品缺失：${missingItemsRejectCount} 条，按“证据不足”拒绝。\n未收到包裹：${notReceivedRejectCount} 条，按“包裹已送达”拒绝。\n操作开始后，已经成功的请求无法由脚本撤回。\n\n确定全部处理吗？`,
      );
      if (!confirmed) return { type: "仅退款", cancelled: true };
    }

    refundOnlyState.bulkSending = true;
    renderRefundOnlyOrders();
    let successCount = 0;
    let failedCount = 0;
    let processed = 0;
    let cancelled = false;
    const failedReverseIds = [];

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        if (!shouldContinue()) {
          cancelled = true;
          break;
        }
        const order = candidates[index];
        const button = ui.root.querySelector(
          `button[data-refund-only-reverse-id="${order.reverseMainOrderId}"]`,
        );
        ui.refundOnlySendAll.textContent =
          `正在处理 ${index + 1}/${candidates.length}`;
        renderRefundOnlyStatus(
          `批量处理进度 ${index + 1}/${candidates.length}\n当前售后退款单号：${order.reverseMainOrderId}\n处理方式：${getRefundOnlyActionName(order)}`,
        );

        const outcome = await executeRefundOnlyAction(order, button, true);
        processed += 1;
        if (outcome?.succeeded) successCount += 1;
        else {
          failedCount += 1;
          failedReverseIds.push(order.reverseMainOrderId);
        }
      }

      renderRefundOnlyStatus(
        `${cancelled ? "批量处理已停止" : "批量处理完成"}：成功 ${successCount} 条，失败 ${failedCount} 条，共处理 ${processed}/${candidates.length} 条。${
          failedReverseIds.length
            ? `\n失败售后退款单号：${failedReverseIds.join(", ")}`
            : ""
        }`,
        failedCount ? "error" : "ok",
      );
    } finally {
      refundOnlyState.bulkSending = false;
      renderRefundOnlyOrders();
    }
    return {
      type: "仅退款",
      total: candidates.length,
      processed,
      successCount,
      failedCount,
      cancelled,
      failedReverseIds,
    };
  }

  function getDefaultAutomationSettings() {
    return {
      enabled: false,
      planId: "",
      firstRunAt: "",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      intervalMinutes: AUTOMATION_DEFAULT_INTERVAL_MINUTES,
      maxRuns: 1, startedRuns: 0, completedRuns: 0,
      selected: { delivered: false, refundOnly: false, returnRefund: false },
      lastRunAt: "", nextRunAt: "", missedRunAt: "", lastSummary: "尚未运行",
    };
  }

  function sanitizeAutomationSettings(value) {
    if (!value || typeof value !== "object") return getDefaultAutomationSettings();
    const defaults = getDefaultAutomationSettings();
    const interval = Number(value.intervalMinutes);
    const validDate = (date) => typeof date === "string" && Number.isFinite(Date.parse(date)) ? date : "";
    const count = (number) => Number.isSafeInteger(Number(number)) && Number(number) >= 0 ? Number(number) : 0;
    const rawMaxRuns = Number(value.maxRuns);
    const maxRuns = value.maxRuns == null || rawMaxRuns === 0 || rawMaxRuns === -1
      ? -1 : count(value.maxRuns) || defaults.maxRuns;
    return {
      ...defaults,
      enabled: value.enabled === true,
      planId: typeof value.planId === "string" ? value.planId : "legacy",
      firstRunAt: validDate(value.firstRunAt) || validDate(value.nextRunAt),
      timeZone: typeof value.timeZone === "string" ? value.timeZone : defaults.timeZone,
      intervalMinutes: Number.isInteger(interval) && interval > 0 && interval <= AUTOMATION_MAX_INTERVAL_MINUTES
          ? Math.max(AUTOMATION_MIN_INTERVAL_MINUTES, interval) : defaults.intervalMinutes,
      // -1 means unlimited; migrate legacy missing/zero limits without resetting counters.
      maxRuns: Math.min(maxRuns, AUTOMATION_MAX_RUNS),
      startedRuns: count(value.startedRuns),
      completedRuns: Math.min(count(value.completedRuns), count(value.startedRuns)),
      selected: {
        delivered: Boolean(value.selected?.delivered),
        refundOnly: Boolean(value.selected?.refundOnly),
        returnRefund: Boolean(value.selected?.returnRefund ?? value.selected?.partialRefund),
      },
      lastRunAt: validDate(value.lastRunAt),
      nextRunAt: validDate(value.nextRunAt),
      missedRunAt: validDate(value.missedRunAt),
      lastSummary: typeof value.lastSummary === "string" ? value.lastSummary : defaults.lastSummary,
    };
  }

  function loadAutomationSettings() {
    try {
      const saved = ALLOW_MULTI_TAB_AUTOMATION
        ? sessionStorage.getItem(AUTOMATION_SETTINGS_STORAGE_KEY) ?? localStorage.getItem(AUTOMATION_SETTINGS_STORAGE_KEY)
        : localStorage.getItem(AUTOMATION_SETTINGS_STORAGE_KEY);
      return sanitizeAutomationSettings(JSON.parse(saved || "null"));
    } catch { return getDefaultAutomationSettings(); }
  }

  function saveAutomationSettings() {
    const settings = automationState.settings;
    if (ALLOW_MULTI_TAB_AUTOMATION) {
      sessionStorage.setItem(AUTOMATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      // 跨页只保存下次打开时的默认参数快照，不共享活动计划的启停状态。
      localStorage.setItem(AUTOMATION_SETTINGS_STORAGE_KEY, JSON.stringify({
        ...settings, enabled: false, nextRunAt: "", missedRunAt: "",
      }));
    } else {
      localStorage.setItem(AUTOMATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  }

  function getSelectedAutomationLabels(settings = automationState.settings) {
    if (!settings) return [];
    return [
      settings.selected.delivered ? "按钮1 已送达" : "",
      settings.selected.refundOnly ? "按钮2 仅退款" : "",
      settings.selected.returnRefund ? "按钮3 退货退款" : "",
    ].filter(Boolean);
  }

  function formatAutomationTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "无";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function localDateTimeInput(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function updateAutomationFirstRunMin() {
    const now = Date.now();
    // 输入精确到秒；最小值必须严格晚于当前时间，不能向下截断。
    if (ui?.automationFirstRun) {
      ui.automationFirstRun.min = localDateTimeInput((Math.floor(now / 1000) + 1) * 1000);
    }
    return now;
  }

  function automationLimitReached(settings = automationState.settings) {
    return Boolean(settings && settings.maxRuns > 0 && settings.startedRuns >= settings.maxRuns);
  }

  function nextAutomationSlot(settings, now = Date.now()) {
    const first = Date.parse(settings.firstRunAt);
    const interval = settings.intervalMinutes * 60 * 1000;
    if (!Number.isFinite(first)) return now + interval;
    if (first > now) return first;
    // 固定首次时间为基准；耗时过长或浏览器错过的时间点不并行补跑。
    return first + (Math.floor((now - first) / interval) + 1) * interval;
  }

  function automationDueTime(settings) {
    const time = Date.parse(settings.nextRunAt || settings.firstRunAt);
    return Number.isFinite(time) ? time : Date.now() + settings.intervalMinutes * 60000;
  }

  function automationRecoveryDue(settings) {
    return navigator.onLine !== false && Boolean(settings.missedRunAt);
  }

  function lastAutomationStart(settings) {
    const storage = ALLOW_MULTI_TAB_AUTOMATION ? sessionStorage : localStorage;
    const saved = Number(storage.getItem(AUTOMATION_LAST_START_STORAGE_KEY));
    const fromPlan = Date.parse(settings.lastRunAt);
    return Math.max(Number.isFinite(saved) ? saved : 0, Number.isFinite(fromPlan) ? fromPlan : 0);
  }

  function renderAutomationStatus() {
    if (!ui?.automationStatus || !automationState.settings) return;
    const settings = automationState.settings;
    const labels = getSelectedAutomationLabels(settings);
    const limit = automationLimitReached(settings);
    const running = automationState.running;
    const stateText = running
      ? (automationState.cancelRequested ? "停止中，等待当前请求结束" : `正在运行第 ${settings.startedRuns} 轮`)
      : limit ? "已达到总运行次数" : settings.enabled ? "已启用，等待计划时间" : "已停止";
    ui.automationStatus.textContent = [
      `当前状态：${stateText}`,
      `已选功能：${labels.join("、") || "无"}`,
      `首次运行：${formatAutomationTime(settings.firstRunAt)}`,
      `时间显示按浏览器时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      `运行间隔：${settings.intervalMinutes} 分钟（以首次时间为基准）`,
      `总运行次数：${settings.maxRuns > 0 ? settings.maxRuns : "-1（不限次数，直到手动取消）"}`,
      `累计已启动：${settings.startedRuns} 轮 · 已结束：${settings.completedRuns} 轮`,
      `剩余可启动：${settings.maxRuns > 0 ? Math.max(0, settings.maxRuns - settings.startedRuns) + " 轮" : "不限"}`,
      `上次启动：${formatAutomationTime(settings.lastRunAt)}`,
      `下次运行：${settings.enabled && !limit ? formatAutomationTime(settings.nextRunAt) : "无"}`,
      `网络：${navigator.onLine === false ? "离线" : "在线"} · 待恢复补跑：${settings.missedRunAt ? "有（合并为一轮）" : "无"}`,
      `上次结果：${settings.lastSummary || "尚未运行"}`,
      "一次勾选的所有按钮合计一轮；成功、失败、无订单均计1次。刷新或切换站点后停止计划，保留设置和累计次数。",
      "停止后需要手动重新启用；自动按钮：黑色＝已停止，橙色＝计划已启用（含等待运行）。",
      ...(ALLOW_MULTI_TAB_AUTOMATION ? ["已允许多标签页同时运行；每页独立启停、计数和检查5分钟间隔。同店铺并行可能重复提交订单。"] : []),
      "请保持页面、浏览器和登录状态可用；错过的时间点不会连续补跑。",
      "离线错过的任务恢复联网后合并补跑一次；两轮启动相隔不足5分钟则跳过并记日志，不计次数。",
    ].join("\n");
    ui.automationStatus.className = `show ${settings.enabled ? "ok" : ""}`;
    ui.automationEnable.disabled = running;
    ui.automationDisable.disabled = !settings.enabled && !running;
    const active = settings.enabled && (!limit || running) && !automationState.cancelRequested;
    ui.automationTool?.classList.toggle("active", active);
    ui.automationTool?.setAttribute("aria-pressed", String(active));
    ui.automationTool?.setAttribute("title", `自动运行：${active ? "已启用" : "已停止"}；已启动 ${settings.startedRuns}/${settings.maxRuns > 0 ? settings.maxRuns : "不限"} 轮`);
  }

  function populateAutomationForm() {
    if (!ui?.automationInterval || !automationState.settings) return;
    const settings = automationState.settings;
    ui.automationDelivered.checked = settings.selected.delivered;
    ui.automationRefundOnly.checked = settings.selected.refundOnly;
    ui.automationReturnRefund.checked = settings.selected.returnRefund;
    ui.automationInterval.value = String(settings.intervalMinutes);
    const now = updateAutomationFirstRunMin();
    const savedFirstRunAt = Date.parse(settings.firstRunAt);
    const defaultFirstRunAt = Math.ceil((now + AUTOMATION_FIRST_RUN_DELAY_MINUTES * 60000) / 1000) * 1000;
    // 仅更新新计划表单；旧计划的首次时间、下一次时间和累计次数保持不变。
    ui.automationFirstRun.value = localDateTimeInput(savedFirstRunAt > now ? savedFirstRunAt : defaultFirstRunAt);
    ui.automationMaxRuns.value = String(settings.maxRuns > 0 ? settings.maxRuns : -1);
    ui.automationTimeZone.textContent = `日期时间按当前浏览器时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone} 填写。新计划默认当前时间＋3分钟，只能选择未来时间；已启用计划以状态栏为准。`;
    renderAutomationStatus();
  }

  function readAutomationLock() {
    try {
      const value = JSON.parse(localStorage.getItem(AUTOMATION_LOCK_STORAGE_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch { return null; }
  }

  function acquireAutomationLock() {
    if (ALLOW_MULTI_TAB_AUTOMATION) return true;
    const now = Date.now();
    const existing = readAutomationLock();
    if (existing?.owner && existing.owner !== automationState.instanceId && Number(existing.expiresAt) > now) return false;
    localStorage.setItem(AUTOMATION_LOCK_STORAGE_KEY, JSON.stringify({
      owner: automationState.instanceId, expiresAt: now + AUTOMATION_LOCK_TTL_MS,
    }));
    return readAutomationLock()?.owner === automationState.instanceId;
  }

  function renewAutomationLock() {
    if (ALLOW_MULTI_TAB_AUTOMATION) return true;
    try {
      if (readAutomationLock()?.owner !== automationState.instanceId) return false;
      localStorage.setItem(AUTOMATION_LOCK_STORAGE_KEY, JSON.stringify({
        owner: automationState.instanceId, expiresAt: Date.now() + AUTOMATION_LOCK_TTL_MS,
      }));
      return true;
    } catch { return false; }
  }

  function releaseAutomationLock() {
    if (ALLOW_MULTI_TAB_AUTOMATION) return;
    try {
      if (readAutomationLock()?.owner === automationState.instanceId) localStorage.removeItem(AUTOMATION_LOCK_STORAGE_KEY);
    } catch {}
  }

  function automationShouldContinue() {
    checkPageSiteContext();
    const latest = loadAutomationSettings();
    return Boolean(
      latest.enabled && latest.planId === automationState.runningPlanId &&
      !automationState.cancelRequested && renewAutomationLock(),
    );
  }

  function clearAutomationTimer() {
    if (automationState.timer != null) clearTimeout(automationState.timer);
    automationState.timer = null;
  }

  function handleAutomationError(error) {
    clearAutomationTimer();
    clearInterval(automationState.lockHeartbeat);
    releaseAutomationLock();
    automationState.cancelRequested = true;
    automationState.settings = loadAutomationSettings();
    automationState.settings.enabled = false;
    automationState.settings.nextRunAt = "";
    automationState.settings.lastSummary = `自动调度异常：${error?.message || String(error)}`;
    try { saveAutomationSettings(); } catch {}
    recordFailureLog({ type: "自动运行", node: "调度异常", reason: error });
    renderAutomationStatus();
  }

  function armAutomationTimer(notBefore = 0) {
    clearAutomationTimer();
    const settings = automationState.settings;
    if (!settings?.enabled || automationLimitReached(settings) || automationState.running) {
      renderAutomationStatus(); return;
    }
    const due = Math.max(automationRecoveryDue(settings) ? Date.now() : automationDueTime(settings), notBefore);
    // 首次日期可远于 setTimeout 的最大延迟；提前唤醒时重新检查时间。
    const delay = Math.min(2147483000, Math.max(250, due - Date.now()));
    automationState.timer = setTimeout(() => {
      runAutomationCycle().catch(handleAutomationError);
    }, delay);
    renderAutomationStatus();
  }

  function summarizeAutomationResult(result) {
    if (!result) return "没有返回执行结果";
    if (result.skipped) return `跳过（${result.reason || "模块正忙"}）`;
    if (result.cancelled && result.processed == null) return "用户取消";
    return `${result.cancelled ? "已停止，" : ""}处理 ${result.processed || 0}/${result.total || 0}，成功 ${result.successCount || 0}，失败 ${result.failedCount || 0}`;
  }

  async function runAutomationCycle() {
    if (automationState.running || automationState.acquiringLock) return;
    clearAutomationTimer();
    automationState.acquiringLock = true;
    try {
      // 多页模式不争用跨页锁；上面的 running/acquiringLock 仍阻止本页重入。
      if (!ALLOW_MULTI_TAB_AUTOMATION && navigator.locks?.request) {
        await navigator.locks.request(AUTOMATION_LOCK_STORAGE_KEY, { ifAvailable: true }, async (lock) => {
          if (lock) await runLockedAutomationCycle();
          else { automationState.settings = loadAutomationSettings(); armAutomationTimer(Date.now() + 10000); }
        });
      } else {
        await runLockedAutomationCycle();
      }
    } finally {
      automationState.acquiringLock = false;
    }
  }

  async function runLockedAutomationCycle() {
    checkPageSiteContext();
    automationState.settings = loadAutomationSettings();
    const settings = automationState.settings;
    if (!settings.enabled) { renderAutomationStatus(); return; }
    if (automationLimitReached(settings)) {
      settings.enabled = false;
      settings.nextRunAt = "";
      saveAutomationSettings(); renderAutomationStatus(); return;
    }
    if (automationDueTime(settings) > Date.now() && !automationRecoveryDue(settings)) { armAutomationTimer(); return; }
    // 手动操作正忙时暂缓整轮，不从旧列表提交，也不计入次数。
    if ([state, refundOnlyState, deliveredState].some((item) => item.loading || item.bulkSending)) {
      armAutomationTimer(Date.now() + 10000); return;
    }
    if (!acquireAutomationLock()) { armAutomationTimer(Date.now() + 10000); return; }
    // 取得租约后重新核对，以兼容取消或另一个标签页更新计划。
    const latest = loadAutomationSettings();
    if (!latest.enabled || latest.planId !== settings.planId || automationLimitReached(latest) ||
        (automationDueTime(latest) > Date.now() && !automationRecoveryDue(latest))) {
      releaseAutomationLock();
      automationState.settings = latest; armAutomationTimer(); return;
    }
    automationState.settings = latest;
    const now = Date.now();
    if (navigator.onLine === false) {
      const alreadyMissed = Boolean(latest.missedRunAt);
      latest.missedRunAt ||= new Date(automationDueTime(latest)).toISOString();
      latest.nextRunAt = new Date(nextAutomationSlot(latest, now)).toISOString();
      latest.lastSummary = "离线，已保留漏跑标记；恢复联网后检查并合并补跑一轮。";
      saveAutomationSettings();
      releaseAutomationLock();
      if (!alreadyMissed) recordFailureLog({ type: "自动运行", node: "离线暂停", reason: latest.lastSummary });
      armAutomationTimer();
      return;
    }
    const previousStart = lastAutomationStart(latest);
    if (previousStart && now - previousStart < AUTOMATION_MIN_INTERVAL_MINUTES * 60000) {
      const recovery = automationRecoveryDue(latest);
      latest.missedRunAt = "";
      latest.nextRunAt = new Date(nextAutomationSlot(latest, now)).toISOString();
      latest.lastSummary = `时长过短跳过该次：距上次启动 ${Math.max(0, Math.floor((now - previousStart) / 1000))} 秒，不足5分钟（${recovery ? "联网补跑" : "计划运行"}），不计入运行次数。`;
      saveAutomationSettings();
      releaseAutomationLock();
      recordFailureLog({ type: "自动运行", node: "最短间隔保护", reason: latest.lastSummary });
      armAutomationTimer();
      return;
    }
    const recovering = automationRecoveryDue(latest);
    latest.missedRunAt = "";
    const planId = latest.planId;
    const runNumber = latest.startedRuns + 1;
    // 先持久化已启动次数；即使本轮中途刷新，累计次数也不会归零。
    latest.startedRuns = runNumber;
    latest.lastRunAt = new Date(now).toISOString();
    latest.nextRunAt = new Date(nextAutomationSlot(latest)).toISOString();
    const automationStartStorage = ALLOW_MULTI_TAB_AUTOMATION ? sessionStorage : localStorage;
    automationStartStorage.setItem(AUTOMATION_LAST_START_STORAGE_KEY, String(now));
    saveAutomationSettings();
    automationState.running = true;
    automationState.networkInterrupted = false;
    automationState.runningPlanId = planId;
    automationState.cancelRequested = false;
    if (!ALLOW_MULTI_TAB_AUTOMATION) {
      automationState.lockHeartbeat = setInterval(() => {
        if (!renewAutomationLock()) automationState.cancelRequested = true;
      }, 30000);
    }
    renderAutomationStatus();
    if (recovering) recordSuccessLog({ type: "自动运行", node: "联网恢复补跑", reason: "已将离线漏跑合并为一轮；重新获取列表后处理，不重放旧请求。" });

    const modules = [
      { key: "delivered", label: "按钮1 已送达", refresh: refreshDeliveredList, execute: rejectAllDeliveredOrders },
      { key: "refundOnly", label: "按钮2 仅退款", refresh: refreshRefundOnlyList, execute: processAllSupportedRefundOnlyOrders },
      { key: "returnRefund", label: "按钮3 退货退款", refresh: refreshOrderList, execute: sendAllEligibleOrders },
    ];
    const summaries = [];
    let failed = false;
    try {
      for (const module of modules) {
        if (!latest.selected[module.key]) continue;
        if (!automationShouldContinue()) break;
        try {
          await module.refresh();
          if (!automationShouldContinue()) break;
          const result = await module.execute({ automated: true, shouldContinue: automationShouldContinue });
          const summary = summarizeAutomationResult(result);
          summaries.push(`${module.label}：${summary}`);
          if (result?.failedCount) failed = true;
          (result?.failedCount ? recordFailureLog : recordSuccessLog)({
            type: module.label, node: `自动运行第 ${runNumber} 轮`, reason: summary,
          });
        } catch (error) {
          failed = true;
          summaries.push(`${module.label}：失败（${error?.message || String(error)}）`);
          recordFailureLog({ type: module.label, node: `自动运行第 ${runNumber} 轮异常`, reason: error });
        }
      }
    } finally {
      clearInterval(automationState.lockHeartbeat);
      automationState.lockHeartbeat = null;
      automationState.running = false;
      automationState.runningPlanId = "";
      const current = loadAutomationSettings();
      automationState.settings = current;
      // 新计划拥有自己的计数，旧轮次结束时不能覆盖新计划。
      if (current.planId === planId) {
        current.completedRuns = Math.min(current.startedRuns, current.completedRuns + 1);
        current.lastSummary = `第 ${runNumber} 轮${failed ? "（有失败）" : ""}：` +
          (summaries.join("；") || "已中断，无操作结果");
        const reached = automationLimitReached(current);
        if (!current.enabled || automationState.cancelRequested || reached) {
          current.enabled = false;
          current.nextRunAt = "";
          current.lastSummary += reached ? "；已达到总运行次数，自动停止" : "；自动运行已停止";
        } else {
          current.nextRunAt = new Date(nextAutomationSlot(current)).toISOString();
          if (failed && (automationState.networkInterrupted || navigator.onLine === false)) {
            current.missedRunAt ||= current.lastRunAt;
          }
        }
        saveAutomationSettings();
        if (reached) recordSuccessLog({
          type: "自动运行", node: "达到总次数停止",
          reason: `累计启动 ${current.startedRuns}/${current.maxRuns} 轮，已停止后续调度。`,
        });
      }
      releaseAutomationLock();
      armAutomationTimer();
      renderAutomationStatus();
    }
  }

  function enableAutomationFromForm() {
    if (automationState.running) return;
    checkPageSiteContext();
    const startingSiteRevision = siteContextRevision;
    updateAutomationFirstRunMin();
    const selected = {
      delivered: ui.automationDelivered.checked,
      refundOnly: ui.automationRefundOnly.checked,
      returnRefund: ui.automationReturnRefund.checked,
    };
    if (!Object.values(selected).some(Boolean)) { window.alert("请至少勾选一个功能。"); return; }
    const intervalMinutes = Number(ui.automationInterval.value);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < AUTOMATION_MIN_INTERVAL_MINUTES || intervalMinutes > AUTOMATION_MAX_INTERVAL_MINUTES) {
      window.alert(`运行间隔必须为 ${AUTOMATION_MIN_INTERVAL_MINUTES}–${AUTOMATION_MAX_INTERVAL_MINUTES} 分钟的整数。`); return;
    }
    const maxRuns = Number(ui.automationMaxRuns.value);
    if (!Number.isInteger(maxRuns) || (maxRuns !== -1 && (maxRuns < 1 || maxRuns > AUTOMATION_MAX_RUNS))) {
      window.alert(`总运行次数请填 -1（不限次数），或 1–${AUTOMATION_MAX_RUNS} 的整数。`); return;
    }
    const first = new Date(ui.automationFirstRun.value);
    if (!ui.automationFirstRun.value || !Number.isFinite(first.getTime()) || first.getTime() <= Date.now()) {
      window.alert("请选择将来的首次运行日期时间。"); return;
    }
    const labels = getSelectedAutomationLabels({ selected });
    const runLimitLabel = maxRuns === -1 ? "不限次数，按间隔一直运行，直到手动取消" : `${maxRuns} 轮后停止`;
    if (!window.confirm(
      `确认启用自动运行：\n\n功能：${labels.join("、")}\n首次运行：${formatAutomationTime(first.toISOString())}\n间隔：${intervalMinutes} 分钟\n总共运行：${runLimitLabel}（所选按钮合计一轮）\n\n将发送真实请求。重新启用会建立新计划，累计次数从 0 开始。${ALLOW_MULTI_TAB_AUTOMATION ? "同店铺多个页面同时运行，可能重复提交同一订单。" : ""}是否确认？`
    )) return;
    if (first.getTime() <= updateAutomationFirstRunMin()) {
      window.alert("确认期间首次运行时间已过，请重新选择未来时间。原有计划未改变。"); return;
    }
    checkPageSiteContext();
    if (startingSiteRevision !== siteContextRevision) {
      window.alert("确认期间站点或店铺已切换，原计划已停止。请核对目标站点后重新启用。"); return;
    }
    automationState.cancelRequested = false;
    automationState.settings = {
      ...getDefaultAutomationSettings(),
      enabled: true,
      planId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      firstRunAt: first.toISOString(), nextRunAt: first.toISOString(),
      intervalMinutes, maxRuns, selected, lastSummary: "等待首次计划时间",
    };
    saveAutomationSettings();
    recordSuccessLog({
      type: "自动运行", node: "启用新计划",
      reason: `${labels.join("、")}；首次 ${formatAutomationTime(first.toISOString())}；每 ${intervalMinutes} 分钟；${runLimitLabel}。`,
    });
    armAutomationTimer();
  }

  function stopAutomation({ node = "取消", reason = "已取消自动运行" } = {}) {
    const settings = loadAutomationSettings();
    const hadPlan = settings.enabled || Boolean(settings.nextRunAt || settings.missedRunAt) ||
      (automationState.running && !automationState.cancelRequested);
    automationState.cancelRequested = true;
    clearAutomationTimer();
    settings.enabled = false;
    settings.nextRunAt = "";
    settings.missedRunAt = "";
    if (hadPlan) settings.lastSummary = reason + (automationState.running ? " 已发出的请求可能仍会完成，后续请求不再发送。" : "");
    automationState.settings = settings;
    if (hadPlan) saveAutomationSettings();
    if (!automationState.running) releaseAutomationLock();
    if (hadPlan) recordSuccessLog({
      type: "自动运行", node, reason: `已启动 ${settings.startedRuns} 轮；${settings.lastSummary}`,
    });
    renderAutomationStatus();
  }

  function disableAutomation() {
    stopAutomation();
  }

  function initializeAutomation() {
    automationState.settings = loadAutomationSettings();
    const settings = automationState.settings;
    if (ALLOW_MULTI_TAB_AUTOMATION) {
      // 首次载入锁定本页快照，后续其它页面保存默认参数不会改变本页计划。
      sessionStorage.setItem(AUTOMATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
    clearAutomationTimer();
    if (settings.enabled || settings.nextRunAt || settings.missedRunAt) {
      stopAutomation({ node: "页面重新加载停止", reason: "页面刷新或重新打开，原自动计划已停止，请手动重新启用。" });
    }
    populateAutomationForm();
  }

  function renderSettingsForm() {
    if (!ui?.settingsRows) return;
    siteSettings = loadSiteSettings();
    ui.settingsRows.replaceChildren();
    for (const site of availableSites()) {
      const row = document.createElement("tr");
      const siteCell = document.createElement("td");
      siteCell.textContent = site.label;
      const currencyCell = document.createElement("td");
      currencyCell.textContent = `${site.currency}（${site.decimals ? "2 位小数" : "整数"}）`;
      const limitCell = document.createElement("td");
      const limit = document.createElement("input");
      limit.type = "text"; limit.inputMode = "decimal";
      limit.dataset.siteThreshold = site.id;
      limit.setAttribute("aria-label", `${site.label} ${site.currency} 阈值`);
      limit.placeholder = "留空：不限制";
      limit.value = siteSettings.thresholds[site.id];
      limitCell.append(limit);
      const exportCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.exportSite = site.id;
      checkbox.checked = siteSettings.exportSites.includes(site.id);
      checkbox.setAttribute("aria-label", `导出${site.label}日志`);
      exportCell.append(checkbox);
      row.append(siteCell, currencyCell, limitCell, exportCell);
      ui.settingsRows.append(row);
    }
    syncExportSelectAll();
    setSettingsFeedback();
  }

  function setSettingsFeedback(message = "", error = false) {
    ui.settingsFeedback.textContent = message;
    ui.settingsFeedback.hidden = !message;
    ui.settingsFeedback.className = error ? "error" : "ok";
  }

  function selectedExportSitesFromForm() {
    const selected = [...ui.settingsRows.querySelectorAll("input[data-export-site]:checked")]
      .map((input) => input.dataset.exportSite);
    return selected;
  }

  function exportSiteCheckboxes() {
    return [...ui.settingsRows.querySelectorAll("input[data-export-site]")];
  }

  function syncExportSelectAll() {
    const checkboxes = exportSiteCheckboxes();
    const selected = checkboxes.filter((input) => input.checked).length;
    ui.settingsSelectAll.checked = selected === checkboxes.length;
    ui.settingsSelectAll.indeterminate = selected > 0 && selected < checkboxes.length;
  }

  function saveSiteSettingsFromForm() {
    try {
      const thresholds = { ...siteSettings.thresholds };
      for (const input of ui.settingsRows.querySelectorAll("input[data-site-threshold]")) {
        const site = SITES.find((item) => item.id === input.dataset.siteThreshold);
        const text = input.value.trim();
        const units = text === "" ? null : decimalUnits(text, site.decimals);
        if (text !== "" && units == null) {
          throw new Error(`${site.label}阈值请填非负${site.decimals ? "金额（最多两位小数）" : "整数"}，不带币种和千分位。`);
        }
        thresholds[site.id] = text === "" ? "" : formatUnits(units, site.decimals);
      }
      const updated = {
        thresholds,
        exportSites: selectedExportSitesFromForm(),
      };
      const backupWarning = persistSiteSettings(updated);
      setSettingsFeedback(`设置已保存。${backupWarning}`, Boolean(backupWarning));
    } catch (error) {
      setSettingsFeedback(error.message || String(error), true);
    }
  }

  function persistSiteSettings(updated) {
    const saved = { ...updated, savedAt: new Date().toISOString() };
    const text = JSON.stringify(saved);
    localStorage.setItem(SETTINGS_STORAGE_KEY, text);
    if (localStorage.getItem(SETTINGS_STORAGE_KEY) !== text) throw new Error("设置保存校验失败，请检查浏览器存储权限。");
    siteSettings = saved;
    let backupWarning = "";
    try { localStorage.setItem(SETTINGS_BACKUP_STORAGE_KEY, text); }
    catch { backupWarning = "浏览器内备份写入失败，请检查存储空间。"; }
    renderOrders(); renderRefundOnlyOrders();
    return backupWarning;
  }

  async function exportLogsFromSettings(mode = "full") {
    ui.settingsExport.disabled = true;
    ui.settingsExportNormal.disabled = true;
    try {
      const selected = selectedExportSitesFromForm();
      if (!selected.length) throw new Error("请至少勾选一个需要导出日志的站点。");
      const result = await exportPersistentLogs({ siteIds: selected, mode });
      setSettingsFeedback(`已导出 ${result.entryCount} 条日志，${result.fileCount} 个 CSV${result.archive ? "（ZIP）" : ""}。`);
    } catch (error) {
      setSettingsFeedback(error.message || String(error), true);
    } finally {
      ui.settingsExport.disabled = false;
      ui.settingsExportNormal.disabled = false;
    }
  }

  function createInterface() {
    if (document.getElementById("tts-seller-tools-host")) return;

    const host = document.createElement("div");
    host.id = "tts-seller-tools-host";
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        button { font: inherit; }
        #launcher {
          position: fixed; right: 24px; bottom: 24px; z-index: 2147483646;
          width: 520px; max-width: calc(100vw - 16px); border: 1px solid rgba(255,255,255,.14); border-radius: 13px;
          padding: 8px; color: #fff; background: #111827; touch-action: none;
          box-shadow: 0 8px 24px rgba(0,0,0,.22);
          font: 14px/1.2 system-ui, sans-serif; user-select: none;
          transition: transform .22s ease, box-shadow .22s ease;
        }
        #launcher.dragging { transition: none; cursor: grabbing; box-shadow: 0 12px 30px rgba(0,0,0,.3); }
        #launcher[hidden] { display: none; }
        #launcher.docked {
          left: auto !important; right: 0 !important; bottom: auto !important;
          transform: translateX(calc(100% - 22px));
        }
        #launcher.docked.peek { transform: translateX(0); }
        .tool-buttons { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; }
        .tool-button {
          border: 1px solid #475569; border-radius: 8px; padding: 9px 5px;
          color: #e2e8f0; background: #1e293b; cursor: pointer; white-space: nowrap;
        }
        .tool-button:hover:not([aria-disabled="true"]) { border-color: #94a3b8; background: #334155; }
        .tool-button[aria-disabled="true"] { color: #64748b; cursor: default; opacity: .75; }
        #tool-delivered { border-color: #15803d; color: #fff; background: #15803d; }
        #tool-delivered:hover { border-color: #16a34a; background: #16a34a; }
        #tool-refund-only { border-color: #2563eb; color: #fff; background: #2563eb; }
        #tool-refund-only:hover { border-color: #3b82f6; background: #3b82f6; }
        #tool-return-refund { border-color: #dc2626; color: #fff; background: #dc2626; }
        #tool-return-refund:hover { border-color: #ef4444; background: #ef4444; }
        #tool-log { border-color: #7c3aed; color: #fff; background: #7c3aed; }
        #tool-log:hover { border-color: #8b5cf6; background: #8b5cf6; }
        #tool-settings { border-color: #475569; color: #fff; background: #475569; }
        #tool-settings:hover { background: #64748b; }
        #tool-automation, #tool-automation:hover { border-color: #475569; color: #fff; background: #000000; }
        #tool-automation.active, #tool-automation.active:hover { border-color: #f97316; background: #f97316; }
        #overlay, #delivered-overlay, #refund-only-overlay, #log-overlay, #automation-overlay, #settings-overlay {
          display: none; position: fixed; inset: 0; z-index: 2147483647;
          align-items: center; justify-content: center; padding: 24px;
          color: #111827; background: rgba(15,23,42,.5);
          font: 14px/1.5 system-ui, sans-serif;
        }
        #overlay.open, #delivered-overlay.open, #refund-only-overlay.open, #log-overlay.open, #automation-overlay.open, #settings-overlay.open { display: flex; }
        #panel, #delivered-panel, #refund-only-panel, #log-panel, #automation-panel, #settings-panel {
          width: min(760px, 100%); max-height: calc(100vh - 48px); overflow: auto;
          border-radius: 14px; padding: 22px; background: #f8fafc;
          box-shadow: 0 20px 60px rgba(0,0,0,.28);
        }
        .topbar {
          display: flex; align-items: flex-start; gap: 16px;
        }
        .title-group { flex: 1; }
        h2 { margin: 0 0 4px; font-size: 20px; }
        .hint, #summary, #delivered-summary, #refund-only-summary, #log-summary { margin: 0; color: #64748b; }
        #summary, #delivered-summary, #refund-only-summary, #log-summary { margin-top: 5px; }
        .toolbar { display: flex; gap: 8px; }
        .toolbar button, .send-refund {
          border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px;
          background: #fff; cursor: pointer;
        }
        button:disabled { cursor: not-allowed; opacity: .58; }
        #orders, #delivered-orders, #refund-only-orders, #log-entries { display: grid; gap: 12px; margin-top: 18px; }
        .order-card {
          border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px;
          background: #fff;
        }
        .log-card {
          border: 1px solid #e2e8f0; border-left-width: 4px; border-radius: 10px;
          padding: 15px; background: #fff;
        }
        .log-card.success { border-left-color: #16a34a; }
        .log-card.failure { border-left-color: #dc2626; }
        .log-badge {
          border-radius: 999px; padding: 2px 8px; font-size: 12px; white-space: nowrap;
        }
        .log-badge.success { color: #166534; background: #dcfce7; }
        .log-badge.failure { color: #991b1b; background: #fee2e2; }
        .order-heading { display: flex; justify-content: space-between; gap: 10px; }
        .badge {
          border-radius: 999px; padding: 2px 8px; color: #9a3412; background: #ffedd5;
          font-size: 12px; white-space: nowrap;
        }
        .badge.manual { color: #475569; background: #e2e8f0; }
        .badge.delivered { color: #166534; background: #dcfce7; }
        .details { display: grid; gap: 4px; margin-top: 11px; }
        .info-line { display: flex; justify-content: space-between; gap: 16px; }
        .info-line > :first-child { color: #64748b; }
        .log-details .info-line > :last-child {
          max-width: 72%; text-align: right; overflow-wrap: anywhere; white-space: pre-wrap;
        }
        .action-row {
          display: flex; align-items: center; justify-content: flex-end; gap: 12px;
          margin-top: 13px; padding-top: 12px; border-top: 1px solid #f1f5f9;
        }
        .row-result { flex: 1; color: #64748b; white-space: pre-wrap; }
        .row-result.ok { color: #166534; }
        .row-result.error { color: #991b1b; }
        .send-refund { border-color: #dc2626; color: #fff; background: #dc2626; }
        .delivered-reject { border-color: #15803d; background: #15803d; }
        .refund-only-reject { border-color: #2563eb; background: #2563eb; }
        .empty { padding: 32px 12px; text-align: center; color: #64748b; }
        #status, #delivered-status, #refund-only-status, #log-file-state, #log-action-status, #automation-status {
          display: none; margin: 16px 0 0; border-radius: 8px; padding: 10px 12px;
          white-space: pre-wrap; overflow-wrap: anywhere; background: #f1f5f9;
        }
        #status.show, #delivered-status.show, #refund-only-status.show, #log-file-state.show, #log-action-status.show, #automation-status.show { display: block; }
        #status.ok, #delivered-status.ok, #refund-only-status.ok, #log-file-state.ok, #log-action-status.ok, #automation-status.ok { color: #166534; background: #dcfce7; }
        #status.error, #delivered-status.error, #refund-only-status.error, #log-file-state.error, #log-action-status.error { color: #991b1b; background: #fee2e2; }
        .automation-form { display: grid; gap: 16px; margin-top: 18px; }
        .automation-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .automation-option { display: flex; align-items: center; gap: 8px; border: 1px solid #e2e8f0; border-radius: 9px; padding: 12px; background: #fff; cursor: pointer; }
        .automation-interval { display: flex; align-items: center; gap: 10px; }
        .automation-interval input { width: 130px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; }
        .automation-interval input[type="datetime-local"] { width: 255px; font: inherit; }
        .automation-actions { display: flex; justify-content: flex-end; gap: 8px; }
        #automation-enable { border-color: #ea580c; color: #fff; background: #ea580c; }
        #automation-disable { border-color: #dc2626; color: #fff; background: #dc2626; }
        .shortcut { margin-top: 16px; color: #94a3b8; font-size: 12px; }
        .order-section { display: grid; gap: 12px; }
        .order-section h3 { margin: 4px 0; font-size: 15px; }
        .review-section { margin-top: 18px; padding: 14px; border: 1px solid #fbbf24; border-radius: 10px; background: #fffbeb; }
        .settings-form { display: grid; gap: 16px; margin-top: 18px; }
        .settings-form .toolbar { flex-wrap: wrap; align-items: center; }
        .settings-table { width: 100%; border-collapse: collapse; }
        .settings-table th, .settings-table td { padding: 10px 6px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        .settings-table input[type="text"] { width: 145px; }
        .settings-form select, .settings-form input[type="text"] { font: inherit; padding: 7px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
        #settings-feedback { font-size: 13px; margin-right: auto; }
        #settings-feedback[hidden] { display: none; }
        #settings-feedback.ok { color: #166534; }
        #settings-feedback.error { color: #991b1b; }
      </style>
      <div id="launcher" aria-label="卖家工具箱" title="拖动按钮区域可移动工具箱">
        <div class="tool-buttons">
          <button id="tool-delivered" class="tool-button" type="button" title="打开已送达待核发退款列表">已送达</button>
          <button id="tool-refund-only" class="tool-button" type="button" title="打开仅退款待核发列表">仅退款</button>
          <button id="tool-return-refund" class="tool-button" type="button">退货退款</button>
          <button id="tool-log" class="tool-button" type="button" title="查看操作日志">Log</button>
          <button id="tool-settings" class="tool-button" type="button">设置</button>
          <button id="tool-automation" class="tool-button" type="button" title="设置自动运行">自动</button>
        </div>
      </div>
      <div id="delivered-overlay" role="dialog" aria-labelledby="delivered-title">
        <section id="delivered-panel">
          <div class="topbar">
            <div class="title-group">
              <h2 id="delivered-title">已送达｜待核发退款</h2>
              <p class="hint">仅显示 status_block 含“待核发退款”、fulfillment_block 的退货物流状态为“已送达”，且 button_block 中存在可用“回复”按钮的订单；仅有“接收退货包裹”的订单不处理。</p>
              <p id="delivered-summary"></p>
            </div>
            <div class="toolbar">
              <button id="delivered-refresh" type="button">刷新列表</button>
              <button id="delivered-send-all" type="button">一键拒绝全部（0）</button>
              <button id="delivered-close" type="button">关闭</button>
            </div>
          </div>
          <pre id="delivered-status"></pre>
          <div id="delivered-orders"></div>
        </section>
      </div>
      <div id="overlay" role="dialog" aria-labelledby="title">
        <section id="panel">
          <div class="topbar">
            <div class="title-group">
              <h2 id="title">退货退款｜待客户退货 · 10% 部分退款</h2>
              <p class="hint">状态为“待客户退货”且 status_block 没有 content；按设置中的各站金额阈值分区，待处理区不参与一键及自动发送。</p>
              <p id="summary"></p>
            </div>
            <div class="toolbar">
              <button id="refresh" type="button">刷新列表</button>
              <button id="send-all" type="button">一键发送全部（0）</button>
              <button id="close" type="button">关闭</button>
            </div>
          </div>
          <pre id="status"></pre>
          <div id="orders"></div>
          <div class="shortcut">快捷键：Alt + T 仅显示或隐藏功能条，不切换此窗口</div>
        </section>
      </div>
      <div id="refund-only-overlay" role="dialog" aria-labelledby="refund-only-title">
        <section id="refund-only-panel">
          <div class="topbar">
            <div class="title-group">
              <h2 id="refund-only-title">仅退款｜待核发退款</h2>
              <p class="hint">自动分页读取“仅退款 + 待核发退款”；“平台处理”的缺失商品订单发送 10% 部分退款，其他已配置场景自动拒绝。</p>
              <p id="refund-only-summary"></p>
            </div>
            <div class="toolbar">
              <button id="refund-only-refresh" type="button">刷新列表</button>
              <button id="refund-only-send-all" type="button">一键处理全部（0）</button>
              <button id="refund-only-close" type="button">关闭</button>
            </div>
          </div>
          <pre id="refund-only-status"></pre>
          <div id="refund-only-orders"></div>
        </section>
      </div>
      <div id="log-overlay" role="dialog" aria-labelledby="log-title">
        <section id="log-panel">
          <div class="topbar">
            <div class="title-group">
              <h2 id="log-title">操作日志</h2>
              <p class="hint">记录成功、失败和异常；界面最多显示最近 100 条。清空仅影响前端最近记录；持久副本每卷 1 MiB、最多 2 卷，继续轮转保留。</p>
              <p id="log-summary"></p>
            </div>
            <div class="toolbar">
              <button id="log-export" type="button">选择站点并导出</button>
              <button id="log-clear" type="button">清空日志</button>
              <button id="log-close" type="button">关闭</button>
            </div>
          </div>
          <pre id="log-file-state"></pre>
          <pre id="log-action-status"></pre>
          <div id="log-entries"></div>
        </section>
      </div>
      <div id="settings-overlay" role="dialog" aria-labelledby="settings-title">
        <section id="settings-panel">
          <div class="topbar">
            <div class="title-group">
              <h2 id="settings-title">设置｜站点金额与日志</h2>
              <p class="hint">金额阈值按各站当地币种填写。留空不限制；等于阈值时可处理，超过时移入待处理区。</p>
            </div>
            <div class="toolbar"><button id="settings-close" type="button">关闭</button></div>
          </div>
          <div class="settings-form">
            <p class="hint">阈值比较商品原金额，同时应用于按钮3和按钮2的 10% 部分退款；按钮2的拒绝操作不受金额阈值影响。</p>
            <table class="settings-table"><thead><tr><th>站点</th><th>币种与精度</th><th>金额阈值</th><th>导出日志</th></tr></thead><tbody id="settings-rows"></tbody></table>
            <div class="toolbar automation-actions"><span id="settings-feedback" role="status" aria-live="polite" hidden></span><button id="settings-save" type="button">保存设置</button><button id="settings-export" type="button">导出全量 CSV</button><button id="settings-export-normal" type="button">导出普通 CSV</button><label><input id="settings-select-all" type="checkbox">全选／全不选</label></div>
          </div>
        </section>
      </div>
      <div id="automation-overlay" role="dialog" aria-labelledby="automation-title">
        <section id="automation-panel">
          <div class="topbar">
            <div class="title-group">
              <h2 id="automation-title">自动运行设置</h2>
              <p class="hint">从指定日期时间开始，按间隔运行所选功能；所有按钮合计一轮。总次数填 -1 表示不限次数，填正整数则达到次数后停止。</p>
            </div>
            <div class="toolbar">
              <button id="automation-close" type="button">关闭</button>
            </div>
          </div>
          <div class="automation-form">
            <div class="automation-options">
              <label class="automation-option"><input id="automation-delivered" type="checkbox">按钮1 已送达</label>
              <label class="automation-option"><input id="automation-refund-only" type="checkbox">按钮2 仅退款</label>
              <label class="automation-option"><input id="automation-return-refund" type="checkbox">按钮3 退货退款</label>
            </div>
            <label class="automation-interval">
              <span>首次运行时间</span>
              <input id="automation-first-run" type="datetime-local" step="1">
            </label>
            <p id="automation-time-zone" class="hint"></p>
            <label class="automation-interval">
              <span>每</span>
              <input id="automation-interval" type="number" min="5" max="1440" step="1" value="10">
              <span>分钟自动运行一次</span>
            </label>
            <label class="automation-interval">
              <span>总共运行</span>
              <input id="automation-max-runs" type="number" min="-1" max="100000" step="1" value="1">
              <span>轮（-1：不限次数；正整数：到次数停止）</span>
            </label>
            <p class="hint">如首次 09:00、间隔 30 分钟、总次数 3：依次在 09:00、09:30、10:00 启动，第三轮结束后停止。耗时超过间隔时跳过重叠时间点。</p>
            <pre id="automation-status"></pre>
            <div class="automation-actions toolbar">
              <button id="automation-disable" type="button">取消自动运行</button>
              <button id="automation-enable" type="button">确定并启用</button>
            </div>
          </div>
        </section>
      </div>
    `;

    ui = {
      root,
      launcher: root.getElementById("launcher"),
      deliveredTool: root.getElementById("tool-delivered"),
      refundOnlyTool: root.getElementById("tool-refund-only"),
      returnRefundTool: root.getElementById("tool-return-refund"),
      logTool: root.getElementById("tool-log"),
      settingsTool: root.getElementById("tool-settings"),
      settingsOverlay: root.getElementById("settings-overlay"),
      settingsClose: root.getElementById("settings-close"),
      settingsRows: root.getElementById("settings-rows"),
      settingsFeedback: root.getElementById("settings-feedback"),
      settingsSave: root.getElementById("settings-save"),
      settingsExport: root.getElementById("settings-export"),
      settingsExportNormal: root.getElementById("settings-export-normal"),
      settingsSelectAll: root.getElementById("settings-select-all"),
      automationTool: root.getElementById("tool-automation"),
      deliveredOverlay: root.getElementById("delivered-overlay"),
      deliveredRefresh: root.getElementById("delivered-refresh"),
      deliveredSendAll: root.getElementById("delivered-send-all"),
      deliveredClose: root.getElementById("delivered-close"),
      deliveredSummary: root.getElementById("delivered-summary"),
      deliveredStatus: root.getElementById("delivered-status"),
      deliveredOrders: root.getElementById("delivered-orders"),
      overlay: root.getElementById("overlay"),
      refresh: root.getElementById("refresh"),
      sendAll: root.getElementById("send-all"),
      close: root.getElementById("close"),
      summary: root.getElementById("summary"),
      status: root.getElementById("status"),
      orders: root.getElementById("orders"),
      refundOnlyOverlay: root.getElementById("refund-only-overlay"),
      refundOnlyRefresh: root.getElementById("refund-only-refresh"),
      refundOnlySendAll: root.getElementById("refund-only-send-all"),
      refundOnlyClose: root.getElementById("refund-only-close"),
      refundOnlySummary: root.getElementById("refund-only-summary"),
      refundOnlyStatus: root.getElementById("refund-only-status"),
      refundOnlyOrders: root.getElementById("refund-only-orders"),
      logOverlay: root.getElementById("log-overlay"),
      logClose: root.getElementById("log-close"),
      logExport: root.getElementById("log-export"),
      logSummary: root.getElementById("log-summary"),
      logFileState: root.getElementById("log-file-state"),
      logActionStatus: root.getElementById("log-action-status"),
      logClear: root.getElementById("log-clear"),
      logEntries: root.getElementById("log-entries"),
      automationOverlay: root.getElementById("automation-overlay"),
      automationClose: root.getElementById("automation-close"),
      automationDelivered: root.getElementById("automation-delivered"),
      automationRefundOnly: root.getElementById("automation-refund-only"),
      automationReturnRefund: root.getElementById("automation-return-refund"),
      automationInterval: root.getElementById("automation-interval"),
      automationFirstRun: root.getElementById("automation-first-run"),
      automationMaxRuns: root.getElementById("automation-max-runs"),
      automationTimeZone: root.getElementById("automation-time-zone"),
      automationStatus: root.getElementById("automation-status"),
      automationEnable: root.getElementById("automation-enable"),
      automationDisable: root.getElementById("automation-disable"),
    };

    let launcherDragState = null;
    let dockHideTimer = null;
    let suppressLauncherClick = false;

    function saveLauncherState() {
      const rect = ui.launcher.getBoundingClientRect();
      localStorage.setItem(
        LAUNCHER_STATE_STORAGE_KEY,
        JSON.stringify({
          docked: ui.launcher.classList.contains("docked"),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        }),
      );
    }

    function clampLauncherPosition(left, top) {
      const width = ui.launcher.offsetWidth || 110;
      const height = ui.launcher.offsetHeight || 42;
      return {
        left: Math.min(
          Math.max(8, left),
          Math.max(8, window.innerWidth - width - 8),
        ),
        top: Math.min(
          Math.max(8, top),
          Math.max(8, window.innerHeight - height - 8),
        ),
      };
    }

    function dockLauncherToRight() {
      const top = Math.max(8, ui.launcher.getBoundingClientRect().top);
      ui.launcher.classList.remove("dragging", "peek");
      ui.launcher.classList.add("docked");
      ui.launcher.style.left = "auto";
      ui.launcher.style.right = "0px";
      ui.launcher.style.bottom = "auto";
      ui.launcher.style.top = `${top}px`;
      saveLauncherState();
    }

    function restoreLauncherState() {
      let saved;
      try {
        saved = JSON.parse(localStorage.getItem(LAUNCHER_STATE_STORAGE_KEY));
      } catch {
        saved = null;
      }
      if (!saved) return;

      if (saved.docked) {
        ui.launcher.classList.add("docked");
        ui.launcher.style.left = "auto";
        ui.launcher.style.right = "0px";
        ui.launcher.style.bottom = "auto";
        ui.launcher.style.top = `${Math.max(8, Number(saved.top) || 64)}px`;
      } else {
        const position = clampLauncherPosition(
          Number(saved.left) || 16,
          Number(saved.top) || 64,
        );
        ui.launcher.style.left = `${position.left}px`;
        ui.launcher.style.right = "auto";
        ui.launcher.style.bottom = "auto";
        ui.launcher.style.top = `${position.top}px`;
      }
    }

    ui.launcher.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button")) return;
      clearTimeout(dockHideTimer);

      const rect = ui.launcher.getBoundingClientRect();
      launcherDragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        initialLeft: rect.left,
        initialTop: rect.top,
        moved: false,
      };
      ui.launcher.setPointerCapture?.(event.pointerId);
    });

    ui.launcher.addEventListener("pointermove", (event) => {
      if (
        !launcherDragState ||
        event.pointerId !== launcherDragState.pointerId
      ) {
        return;
      }

      if (!launcherDragState.moved) {
        const distance = Math.hypot(
          event.clientX - launcherDragState.startX,
          event.clientY - launcherDragState.startY,
        );
        if (distance < 4) return;

        launcherDragState.moved = true;
        ui.launcher.classList.remove("docked", "peek");
        ui.launcher.classList.add("dragging");
        ui.launcher.style.left = `${launcherDragState.initialLeft}px`;
        ui.launcher.style.right = "auto";
        ui.launcher.style.bottom = "auto";
        ui.launcher.style.top = `${launcherDragState.initialTop}px`;
      }

      const position = clampLauncherPosition(
        event.clientX - launcherDragState.offsetX,
        event.clientY - launcherDragState.offsetY,
      );
      ui.launcher.style.left = `${position.left}px`;
      ui.launcher.style.top = `${position.top}px`;
      event.preventDefault();
    });

    const finishLauncherDragging = (event) => {
      if (
        !launcherDragState ||
        event.pointerId !== launcherDragState.pointerId
      ) {
        return;
      }
      const moved = launcherDragState.moved;
      launcherDragState = null;
      ui.launcher.classList.remove("dragging");
      ui.launcher.releasePointerCapture?.(event.pointerId);

      if (!moved) return;
      suppressLauncherClick = true;
      setTimeout(() => {
        suppressLauncherClick = false;
      }, 0);
      const rect = ui.launcher.getBoundingClientRect();
      if (window.innerWidth - rect.right <= 48) {
        dockLauncherToRight();
      } else {
        saveLauncherState();
      }
    };
    ui.launcher.addEventListener("pointerup", finishLauncherDragging);
    ui.launcher.addEventListener("pointercancel", finishLauncherDragging);

    ui.launcher.addEventListener("mouseenter", () => {
      if (!ui.launcher.classList.contains("docked")) return;
      clearTimeout(dockHideTimer);
      ui.launcher.classList.add("peek");
    });
    ui.launcher.addEventListener("mouseleave", () => {
      if (!ui.launcher.classList.contains("docked")) return;
      clearTimeout(dockHideTimer);
      dockHideTimer = setTimeout(() => {
        if (!launcherDragState) ui.launcher.classList.remove("peek");
      }, 260);
    });
    window.addEventListener("resize", () => {
      if (ui.launcher.hidden || ui.launcher.classList.contains("docked")) return;
      const rect = ui.launcher.getBoundingClientRect();
      const position = clampLauncherPosition(rect.left, rect.top);
      ui.launcher.style.left = `${position.left}px`;
      ui.launcher.style.right = "auto";
      ui.launcher.style.bottom = "auto";
      ui.launcher.style.top = `${position.top}px`;
    });

    const openReturnRefund = () => {
      ui.settingsOverlay.classList.remove("open");
      ui.deliveredOverlay.classList.remove("open");
      ui.refundOnlyOverlay.classList.remove("open");
      ui.logOverlay.classList.remove("open");
      ui.automationOverlay.classList.remove("open");
      ui.overlay.classList.add("open");
      renderOrders();
      refreshOrderList().catch(() => {});
    };
    const closeReturnRefund = () => ui.overlay.classList.remove("open");
    const toggleLauncher = () => {
      ui.launcher.hidden = !ui.launcher.hidden;
    };
    const openRefundOnly = () => {
      ui.settingsOverlay.classList.remove("open");
      ui.deliveredOverlay.classList.remove("open");
      ui.overlay.classList.remove("open");
      ui.logOverlay.classList.remove("open");
      ui.automationOverlay.classList.remove("open");
      ui.refundOnlyOverlay.classList.add("open");
      renderRefundOnlyOrders();
      refreshRefundOnlyList().catch(() => {});
    };
    const closeRefundOnly = () =>
      ui.refundOnlyOverlay.classList.remove("open");
    const openDelivered = () => {
      ui.settingsOverlay.classList.remove("open");
      ui.overlay.classList.remove("open");
      ui.refundOnlyOverlay.classList.remove("open");
      ui.logOverlay.classList.remove("open");
      ui.automationOverlay.classList.remove("open");
      ui.deliveredOverlay.classList.add("open");
      renderDeliveredOrders();
      refreshDeliveredList().catch(() => {});
    };
    const closeDelivered = () =>
      ui.deliveredOverlay.classList.remove("open");
    const openLog = () => {
      ui.settingsOverlay.classList.remove("open");
      ui.deliveredOverlay.classList.remove("open");
      ui.overlay.classList.remove("open");
      ui.refundOnlyOverlay.classList.remove("open");
      ui.automationOverlay.classList.remove("open");
      ui.logOverlay.classList.add("open");
      ui.logActionStatus.className = "";
      ui.logActionStatus.textContent = "";
      renderActivityLogs();
      refreshPersistentLogStats();
    };
    const closeLog = () => ui.logOverlay.classList.remove("open");
    const openAutomation = () => {
      ui.settingsOverlay.classList.remove("open");
      ui.deliveredOverlay.classList.remove("open");
      ui.overlay.classList.remove("open");
      ui.refundOnlyOverlay.classList.remove("open");
      ui.logOverlay.classList.remove("open");
      populateAutomationForm();
      ui.automationOverlay.classList.add("open");
    };
    const closeAutomation = () =>
      ui.automationOverlay.classList.remove("open");
    const openSettings = () => {
      for (const overlay of [ui.overlay, ui.deliveredOverlay, ui.refundOnlyOverlay, ui.logOverlay, ui.automationOverlay]) overlay.classList.remove("open");
      renderSettingsForm();
      ui.settingsOverlay.classList.add("open");
    };
    const closeSettings = () => ui.settingsOverlay.classList.remove("open");

    ui.launcher.addEventListener(
      "click",
      (event) => {
        if (!suppressLauncherClick) return;
        suppressLauncherClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    function safelyOpenTool(type, openTool) {
      try {
        openTool();
      } catch (error) {
        recordFailureLog({
          type,
          node: "打开功能窗口",
          reason: error,
        });
        console.error(`[卖家工具箱] ${type}窗口打开失败`, error);
        window.alert(
          `[卖家工具箱] ${type}窗口打开失败：${error?.message || String(error)}\n请打开 Log 查看详细记录。`,
        );
      }
    }

    ui.deliveredTool.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      safelyOpenTool("已送达", openDelivered);
    });
    ui.refundOnlyTool.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      safelyOpenTool("仅退款", openRefundOnly);
    });
    ui.returnRefundTool.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      safelyOpenTool("退货退款", openReturnRefund);
    });
    ui.logTool.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      safelyOpenTool("Log", openLog);
    });
    ui.automationTool.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      safelyOpenTool("自动运行", openAutomation);
    });
    ui.close.addEventListener("click", closeReturnRefund);
    ui.deliveredClose.addEventListener("click", closeDelivered);
    ui.refundOnlyClose.addEventListener("click", closeRefundOnly);
    ui.logClose.addEventListener("click", closeLog);
    ui.logClear.addEventListener("click", clearLogsFromInterface);
    ui.settingsSelectAll.addEventListener("change", () => {
      for (const checkbox of exportSiteCheckboxes()) checkbox.checked = ui.settingsSelectAll.checked;
      syncExportSelectAll();
    });
    ui.settingsRows.addEventListener("change", syncExportSelectAll);
    ui.automationClose.addEventListener("click", closeAutomation);
    ui.automationFirstRun.addEventListener("focus", updateAutomationFirstRunMin);
    ui.automationFirstRun.addEventListener("input", updateAutomationFirstRunMin);
    ui.automationEnable.addEventListener("click", enableAutomationFromForm);
    ui.automationDisable.addEventListener("click", disableAutomation);
    ui.refresh.addEventListener("click", () => {
      refreshOrderList().catch(() => {});
    });
    ui.sendAll.addEventListener("click", () => {
      sendAllEligibleOrders();
    });
    ui.deliveredRefresh.addEventListener("click", () => {
      refreshDeliveredList().catch(() => {});
    });
    ui.deliveredSendAll.addEventListener("click", () => {
      rejectAllDeliveredOrders();
    });
    ui.refundOnlyRefresh.addEventListener("click", () => {
      refreshRefundOnlyList().catch(() => {});
    });
    ui.refundOnlySendAll.addEventListener("click", () => {
      processAllSupportedRefundOnlyOrders();
    });
    ui.logExport.addEventListener("click", openSettings);
    ui.settingsTool.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      safelyOpenTool("设置", openSettings);
    });
    ui.settingsClose.addEventListener("click", closeSettings);
    ui.settingsSave.addEventListener("click", saveSiteSettingsFromForm);
    ui.settingsExport.addEventListener("click", () => exportLogsFromSettings("full"));
    ui.settingsExportNormal.addEventListener("click", () => exportLogsFromSettings("normal"));
    ui.settingsOverlay.addEventListener("click", (event) => {
      if (event.target === ui.settingsOverlay) closeSettings();
    });
    ui.overlay.addEventListener("click", (event) => {
      if (event.target === ui.overlay) closeReturnRefund();
    });
    ui.deliveredOverlay.addEventListener("click", (event) => {
      if (event.target === ui.deliveredOverlay) closeDelivered();
    });
    ui.refundOnlyOverlay.addEventListener("click", (event) => {
      if (event.target === ui.refundOnlyOverlay) closeRefundOnly();
    });
    ui.logOverlay.addEventListener("click", (event) => {
      if (event.target === ui.logOverlay) closeLog();
    });
    ui.automationOverlay.addEventListener("click", (event) => {
      if (event.target === ui.automationOverlay) closeAutomation();
    });
    ui.orders.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-reverse-id]");
      if (!button) return;
      const order = state.eligibleOrders.find(
        (item) => item.reverseMainOrderId === button.dataset.reverseId,
      );
      if (order) sendOrderRefund(order, button);
    });
    ui.deliveredOrders.addEventListener("click", (event) => {
      const button = event.target.closest(
        "button[data-delivered-reverse-id]",
      );
      if (!button) return;
      const order = deliveredState.orders.find(
        (item) => item.reverseMainOrderId === button.dataset.deliveredReverseId,
      );
      if (order) rejectDeliveredOrder(order, button);
    });
    ui.refundOnlyOrders.addEventListener("click", (event) => {
      const button = event.target.closest(
        "button[data-refund-only-reverse-id]",
      );
      if (!button) return;
      const order = refundOnlyState.orders.find(
        (item) =>
          item.reverseMainOrderId === button.dataset.refundOnlyReverseId,
      );
      if (order) processRefundOnlyOrder(order, button);
    });
    window.addEventListener("keydown", (event) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "t"
      ) {
        event.preventDefault();
        if (!event.repeat) toggleLauncher();
      }
    });

    restoreLauncherState();
    renderOrders();
    renderDeliveredOrders();
    renderRefundOnlyOrders();
    renderActivityLogs();
    initializeAutomation();

    window.addEventListener("offline", () => {
      if (automationState.running) automationState.networkInterrupted = true;
      renderAutomationStatus();
    });
    window.addEventListener("online", () => {
      runAutomationCycle().catch(handleAutomationError);
    });

    window.addEventListener("storage", (event) => {
      if (event.key === SETTINGS_STORAGE_KEY) {
        siteSettings = loadSiteSettings();
        renderOrders(); renderRefundOnlyOrders();
        return;
      }
      if (event.key !== AUTOMATION_SETTINGS_STORAGE_KEY || ALLOW_MULTI_TAB_AUTOMATION) return;
      const incoming = loadAutomationSettings();
      automationState.settings = incoming;
      if (!incoming.enabled || (automationState.running && incoming.planId !== automationState.runningPlanId)) {
        automationState.cancelRequested = true;
        clearAutomationTimer();
      } else if (!automationState.running) {
        automationState.cancelRequested = false;
        armAutomationTimer();
      }
      populateAutomationForm();
    });
    window.addEventListener(
      "pagehide",
      () => {
        stopAutomation({ node: "页面离开停止", reason: "页面刷新或离开，原自动计划已停止，请手动重新启用。" });
        clearInterval(pageSiteWatchTimer);
        pageSiteWatchTimer = null;
        clearInterval(automationState.lockHeartbeat);
        releaseAutomationLock();
      },
    );
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      stopAutomation({ node: "页面恢复停止", reason: "页面从浏览器历史恢复，原自动计划保持停止，请手动重新启用。" });
      checkPageSiteContext();
      startPageSiteWatcher();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createInterface, { once: true });
  } else {
    createInterface();
  }
})();
