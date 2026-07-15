(function initializeChatGptLatex() {
  "use strict";

  const normalizer = globalThis.WordLatexNormalizer;
  const wordMathml = globalThis.WordMathml;
  const ROOT_ID = "chatgpt-latex-root";
  const QUICK_ACTIONS_ID = "chatgpt-latex-quick-actions";
  const TOAST_ID = "chatgpt-latex-toast";
  const FORMULA_SELECTOR = [
    ".katex-display",
    ".katex",
    ".math-block[data-math]",
    ".math-inline[data-math]",
    "mjx-container",
    "math"
  ].join(",");
  const DEFAULT_SETTINGS = {
    closeAfterCopy: true
  };
  const SCAN_IDLE_TIMEOUT_MS = 350;
  const SCAN_SLICE_BUDGET_MS = 8;
  const QUICK_ACTIONS_HIDE_DELAY_MS = 140;
  const COMPATIBILITY_DEBOUNCE_MS = 120;

  let currentDialog = null;
  let activeFormula = null;
  let quickActions = null;
  let quickActionsHideTimer = null;
  let quickActionsPositionFrame = null;
  let scanScheduled = false;
  const pendingScanRoots = new Set();
  const recognizedFormulas = new WeakSet();

  function translate(key, fallback, substitutions) {
    try {
      return chrome.i18n?.getMessage(key, substitutions) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function canonicalFormula(formula) {
    if (!(formula instanceof Element) || formula.closest(`#${ROOT_ID}`)) {
      return null;
    }

    const display = formula.closest(".katex-display");
    if (display) {
      return display;
    }

    const container = formula.closest(
      ".katex, .math-block[data-math], .math-inline[data-math], mjx-container"
    );
    return container || formula;
  }

  function findFormula(target) {
    if (
      !(target instanceof Element) ||
      target.closest(`#${ROOT_ID}, #${QUICK_ACTIONS_ID}, #${TOAST_ID}`)
    ) {
      return null;
    }

    const display = target.closest(".katex-display");
    if (display) {
      return display;
    }

    return target.closest(FORMULA_SELECTOR);
  }

  function findFormulaFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (const target of path) {
      const formula = findFormula(target);
      if (formula) {
        return formula;
      }
    }

    return null;
  }

  function findTexAnnotation(formula) {
    const selectors = [
      'annotation[encoding="application/x-tex"]',
      'annotation[encoding="application/x-latex"]',
      'script[type^="math/tex"]'
    ].join(",");

    const ownAnnotation = formula.querySelector(selectors);
    if (ownAnnotation) {
      return ownAnnotation;
    }

    const siblingCandidates = [formula.previousElementSibling, formula.nextElementSibling];
    return siblingCandidates.find((sibling) => sibling?.matches?.(selectors)) || null;
  }

  function extractLatex(formula) {
    const dataMath = formula.getAttribute("data-math") || formula.closest("[data-math]")?.getAttribute("data-math");
    if (dataMath) {
      return dataMath;
    }

    const annotation = findTexAnnotation(formula);
    if (annotation?.textContent) {
      return annotation.textContent;
    }

    const math = formula.matches("math") ? formula : formula.querySelector("math");
    const altText = math?.getAttribute("alttext") || math?.getAttribute("aria-label");
    if (altText) {
      return altText;
    }

    return "";
  }

  function markRecognizedFormula(candidate) {
    const formula = canonicalFormula(candidate);
    if (!formula) {
      return null;
    }

    if (recognizedFormulas.has(formula)) {
      return formula;
    }

    if (!formula.hasAttribute("data-wlc-recognized")) {
      if (!extractLatex(formula).trim()) {
        return null;
      }

      const display =
        formula.classList.contains("katex-display") ||
        formula.classList.contains("math-block") ||
        formula.matches('math[display="block"]');
      formula.setAttribute("data-wlc-recognized", display ? "display" : "inline");
    }

    recognizedFormulas.add(formula);
    return formula;
  }

  function scanFormulas(root) {
    if (!(root instanceof Element || root instanceof Document)) {
      return;
    }

    const formulas = new Set();
    const addFormula = (candidate) => {
      const formula = canonicalFormula(candidate);
      if (formula) {
        formulas.add(formula);
      }
    };

    if (root instanceof Element && root.matches(FORMULA_SELECTOR)) {
      addFormula(root);
    }

    root.querySelectorAll(FORMULA_SELECTOR).forEach(addFormula);
    formulas.forEach(markRecognizedFormula);
  }

  function requestScanFlush() {
    if (scanScheduled) {
      return;
    }

    scanScheduled = true;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(flushPendingScans, { timeout: SCAN_IDLE_TIMEOUT_MS });
    } else {
      window.setTimeout(() => flushPendingScans(null), 48);
    }
  }

  function flushPendingScans(deadline) {
    scanScheduled = false;
    const startedAt = performance.now();

    while (pendingScanRoots.size > 0) {
      const root = pendingScanRoots.values().next().value;
      pendingScanRoots.delete(root);

      if (root instanceof Document || root.isConnected) {
        scanFormulas(root);
      }

      const elapsed = performance.now() - startedAt;
      const idleBudgetExhausted = deadline && !deadline.didTimeout && deadline.timeRemaining() < 1;
      if (elapsed >= SCAN_SLICE_BUDGET_MS || idleBudgetExhausted) {
        break;
      }
    }

    if (pendingScanRoots.size > 0) {
      requestScanFlush();
    }
  }

  function scheduleScan(root) {
    if (!(root instanceof Element || root instanceof Document)) {
      return;
    }

    if (
      root instanceof Element &&
      root.closest(`#${ROOT_ID}, #${QUICK_ACTIONS_ID}, #${TOAST_ID}`)
    ) {
      return;
    }

    pendingScanRoots.add(root);
    requestScanFlush();
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(DEFAULT_SETTINGS, (value) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_SETTINGS);
          return;
        }

        resolve({ ...DEFAULT_SETTINGS, ...value });
      });
    });
  }

  function copyText(value) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(value);
    }

    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();

    return copied ? Promise.resolve() : Promise.reject(new Error("Clipboard write failed"));
  }

  async function copyFormulaToWord(latex, plainTextFallback) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Rich clipboard writing is unavailable");
    }

    const mathml = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "chatgpt-latex:render-mathml", latex },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok || !response.mathml) {
            reject(new Error(response?.error || "MathML conversion failed"));
            return;
          }
          resolve(response.mathml);
        }
      );
    });
    const html = wordMathml.buildWordHtml(mathml);
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainTextFallback], { type: "text/plain" })
      })
    ]);
  }

  async function copyLatexValue(input, forWord) {
    const sourceLatex = normalizer.normalizeLatexSource(input);
    if (!sourceLatex) {
      throw new Error("No LaTeX source found");
    }

    if (forWord) {
      const wordResult = normalizer.convertLatexForWord(sourceLatex);
      await copyFormulaToWord(sourceLatex, wordResult.latex);
      return { message: translate("copiedWord", "Copied to Word"), value: wordResult.latex };
    }

    await copyText(sourceLatex);
    return { message: translate("copiedLatex", "LaTeX copied"), value: sourceLatex };
  }

  function createButton(label, className, type) {
    const button = document.createElement("button");
    button.type = type || "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function showPageToast(message, error) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.className = "wlc-page-toast";
      toast.setAttribute("role", "status");
      document.documentElement.appendChild(toast);
    }

    window.clearTimeout(toast._hideTimer);
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(error));
    toast.classList.add("is-visible");
    toast._hideTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1500);
  }

  function cancelQuickActionsHide() {
    window.clearTimeout(quickActionsHideTimer);
    quickActionsHideTimer = null;
  }

  function hideQuickActions() {
    cancelQuickActionsHide();
    if (quickActionsPositionFrame !== null) {
      window.cancelAnimationFrame(quickActionsPositionFrame);
      quickActionsPositionFrame = null;
    }

    activeFormula?.removeAttribute("data-wlc-active");
    activeFormula = null;
    quickActions?.classList.remove("is-visible");
  }

  function scheduleQuickActionsHide() {
    cancelQuickActionsHide();
    quickActionsHideTimer = window.setTimeout(hideQuickActions, QUICK_ACTIONS_HIDE_DELAY_MS);
  }

  function positionQuickActions() {
    quickActionsPositionFrame = null;
    if (!activeFormula?.isConnected || !quickActions) {
      hideQuickActions();
      return;
    }

    const formulaRect = activeFormula.getBoundingClientRect();
    const outsideViewport =
      formulaRect.bottom < 0 ||
      formulaRect.top > window.innerHeight ||
      formulaRect.right < 0 ||
      formulaRect.left > window.innerWidth;
    if ((formulaRect.width <= 0 && formulaRect.height <= 0) || outsideViewport) {
      hideQuickActions();
      return;
    }

    const toolbarWidth = quickActions.offsetWidth;
    const toolbarHeight = quickActions.offsetHeight;
    const viewportPadding = 8;
    const isDisplay = activeFormula.getAttribute("data-wlc-recognized") === "display";
    let left = isDisplay
      ? formulaRect.right - toolbarWidth
      : formulaRect.left + (formulaRect.width - toolbarWidth) / 2;
    let top = isDisplay
      ? formulaRect.top - toolbarHeight / 2
      : formulaRect.bottom + viewportPadding;

    if (!isDisplay && top + toolbarHeight > window.innerHeight - viewportPadding) {
      top = formulaRect.top - toolbarHeight - viewportPadding;
    }

    left = Math.min(
      Math.max(viewportPadding, left),
      Math.max(viewportPadding, window.innerWidth - toolbarWidth - viewportPadding)
    );
    top = Math.min(
      Math.max(viewportPadding, top),
      Math.max(viewportPadding, window.innerHeight - toolbarHeight - viewportPadding)
    );

    quickActions.style.left = `${Math.round(left)}px`;
    quickActions.style.top = `${Math.round(top)}px`;
  }

  function scheduleQuickActionsPosition() {
    if (!activeFormula || quickActionsPositionFrame !== null) {
      return;
    }

    quickActionsPositionFrame = window.requestAnimationFrame(positionQuickActions);
  }

  function ensureQuickActions() {
    if (quickActions?.isConnected) {
      return quickActions;
    }

    const actions = document.createElement("div");
    actions.id = QUICK_ACTIONS_ID;
    actions.className = "wlc-quick-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", translate("quickActions", "Formula quick actions"));

    const copyLatex = createButton(translate("copyLatex", "Copy LaTeX"), "wlc-quick-button");
    copyLatex.dataset.copyMode = "latex";
    const copyWord = createButton(translate("copyWord", "Copy to Word"), "wlc-quick-button");
    copyWord.dataset.copyMode = "word";
    actions.append(copyLatex, copyWord);

    actions.addEventListener("pointerenter", cancelQuickActionsHide);
    actions.addEventListener("pointerleave", scheduleQuickActionsHide);
    actions.addEventListener("focusin", cancelQuickActionsHide);
    actions.addEventListener("focusout", (event) => {
      if (!actions.contains(event.relatedTarget)) {
        scheduleQuickActionsHide();
      }
    });
    actions.addEventListener("click", async (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("button[data-copy-mode]")
        : null;
      if (!button || !activeFormula) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const forWord = button.dataset.copyMode === "word";
      try {
        const result = await copyLatexValue(extractLatex(activeFormula), forWord);
        showPageToast(result.message, false);
      } catch (error) {
        showPageToast(
          forWord
            ? translate("copyWordFailed", "Word conversion or copy failed")
            : translate("copyLatexFailed", "LaTeX copy failed"),
          true
        );
      }
    });

    document.documentElement.appendChild(actions);
    quickActions = actions;
    return actions;
  }

  function showQuickActions(candidate) {
    const formula = markRecognizedFormula(candidate);
    if (!formula) {
      return;
    }

    cancelQuickActionsHide();
    if (activeFormula !== formula) {
      activeFormula?.removeAttribute("data-wlc-active");
      activeFormula = formula;
      activeFormula.setAttribute("data-wlc-active", "");
    }

    const actions = ensureQuickActions();
    actions.dataset.layout = formula.getAttribute("data-wlc-recognized") || "inline";
    positionQuickActions();
    actions.classList.add("is-visible");
  }

  function createPreview(formula) {
    const preview = document.createElement("div");
    preview.className = "wlc-preview";
    preview.setAttribute("aria-label", translate("formulaPreview", "Formula preview"));

    const math = formula.matches("math") ? formula : formula.querySelector("math");
    const visual = formula.querySelector(".katex-html");
    const source = math || visual;

    if (source) {
      const clone = source.cloneNode(true);
      clone.removeAttribute?.("aria-hidden");
      preview.appendChild(clone);
    } else {
      preview.textContent = "LaTeX";
      preview.classList.add("wlc-preview-empty");
    }

    return preview;
  }

  function closeDialog() {
    if (!currentDialog) {
      return;
    }

    currentDialog._wlcCleanup?.();
    currentDialog.remove();
    currentDialog = null;
  }

  function setStatus(status, text, error) {
    status.textContent = text;
    status.classList.toggle("is-error", Boolean(error));
    status.classList.add("is-visible");
  }

  async function openDialog(formula) {
    hideQuickActions();
    closeDialog();

    const rawLatex = extractLatex(formula);
    if (!rawLatex.trim()) {
      return;
    }

    const previouslyFocused = document.activeElement;
    const settings = await getSettings();
    const initialLatex = normalizer.normalizeLatexSource(rawLatex);

    const root = document.createElement("div");
    root.id = ROOT_ID;

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "wlc-backdrop";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", translate("closeEditor", "Close formula editor"));

    const dialog = document.createElement("section");
    dialog.className = "wlc-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "wlc-title");

    const header = document.createElement("header");
    header.className = "wlc-header";

    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "wlc-title";
    title.textContent = "ChatGPT_Latex";
    const subtitle = document.createElement("p");
    subtitle.textContent = translate("editorSubtitle", "Normalized LaTeX with Word-ready copy");
    heading.append(title, subtitle);

    const close = createButton(translate("close", "Close"), "wlc-close");
    header.append(heading, close);

    const body = document.createElement("div");
    body.className = "wlc-body";
    body.appendChild(createPreview(formula));

    const field = document.createElement("div");
    field.className = "wlc-field";
    const label = document.createElement("label");
    label.htmlFor = "wlc-source";
    label.textContent = translate("latexSource", "LaTeX source");
    const textarea = document.createElement("textarea");
    textarea.id = "wlc-source";
    textarea.value = initialLatex;
    textarea.spellcheck = false;
    textarea.autocomplete = "off";
    textarea.rows = 5;

    const fieldMeta = document.createElement("div");
    fieldMeta.className = "wlc-field-meta";
    const status = document.createElement("span");
    status.className = "wlc-status";
    status.setAttribute("role", "status");
    const count = document.createElement("span");
    count.textContent = translate("characterCount", `${textarea.value.length} characters`, String(textarea.value.length));
    fieldMeta.append(status, count);
    const compatibility = document.createElement("p");
    compatibility.className = "wlc-compatibility";
    let compatibilityTimer = null;

    const updateCompatibility = () => {
      compatibilityTimer = null;
      const result = normalizer.convertLatexForWord(textarea.value);
      if (result.compatible) {
        compatibility.textContent = result.changes.length > 0
          ? translate("wordCompatibleConverted", "Word compatibility passed; unsupported environments will be converted")
          : translate("wordCompatible", "Word compatibility check passed");
        compatibility.classList.remove("has-warning");
      } else {
        compatibility.textContent = `${translate("wordCompatibilityWarning", "Word compatibility warning")}: ${result.issues.map((issue) => issue.detail).join("; ")}`;
        compatibility.classList.add("has-warning");
      }
    };
    const scheduleCompatibilityUpdate = () => {
      window.clearTimeout(compatibilityTimer);
      compatibilityTimer = window.setTimeout(updateCompatibility, COMPATIBILITY_DEBOUNCE_MS);
    };

    updateCompatibility();
    field.append(label, textarea, fieldMeta, compatibility);
    body.appendChild(field);

    const footer = document.createElement("footer");
    footer.className = "wlc-footer";
    const copySource = createButton(translate("copyLatex", "Copy LaTeX"), "wlc-button wlc-button-secondary");
    const copyWord = createButton(translate("copyWord", "Copy to Word"), "wlc-button wlc-button-secondary");
    footer.append(copySource, copyWord);

    dialog.append(header, body, footer);
    root.append(backdrop, dialog);
    document.documentElement.appendChild(root);
    root._wlcCleanup = () => {
      window.clearTimeout(compatibilityTimer);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
    currentDialog = root;

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    textarea.addEventListener("input", () => {
      count.textContent = translate("characterCount", `${textarea.value.length} characters`, String(textarea.value.length));
      status.classList.remove("is-visible");
      scheduleCompatibilityUpdate();
    });

    const handleCopy = async (forWord) => {
      if (!normalizer.normalizeLatexSource(textarea.value)) {
        setStatus(status, translate("noFormula", "No formula to copy"), true);
        return;
      }

      try {
        const result = await copyLatexValue(textarea.value, forWord);
        setStatus(status, result.message, false);
        if (settings.closeAfterCopy) {
          window.setTimeout(closeDialog, 280);
        }
      } catch (error) {
        setStatus(
          status,
          forWord
            ? translate("copyWordFailed", "Word conversion or copy failed")
            : translate("clipboardFailed", "Clipboard write failed"),
          true
        );
      }
    };

    copySource.addEventListener("click", () => handleCopy(false));
    copyWord.addEventListener("click", () => handleCopy(true));
    close.addEventListener("click", closeDialog);
    backdrop.addEventListener("click", closeDialog);

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }

      if (event.key === "Tab") {
        const focusable = Array.from(
          root.querySelectorAll('button:not([tabindex="-1"]), textarea, [tabindex]:not([tabindex="-1"])')
        ).filter((element) => !element.disabled && element.getAttribute("aria-hidden") !== "true");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
  }

  document.addEventListener("pointerover", (event) => {
    if (quickActions?.contains(event.target)) {
      cancelQuickActionsHide();
      return;
    }

    const formula = findFormulaFromEvent(event);
    if (formula) {
      showQuickActions(formula);
    }
  }, true);

  document.addEventListener("pointerout", (event) => {
    if (!activeFormula) {
      return;
    }

    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node &&
      (activeFormula.contains(relatedTarget) || quickActions?.contains(relatedTarget))
    ) {
      return;
    }

    const formula = canonicalFormula(findFormulaFromEvent(event));
    if (formula === activeFormula) {
      scheduleQuickActionsHide();
    }
  }, true);

  document.addEventListener("focusin", (event) => {
    if (quickActions?.contains(event.target)) {
      cancelQuickActionsHide();
      return;
    }

    const formula = findFormulaFromEvent(event);
    if (formula) {
      showQuickActions(formula);
    }
  }, true);

  document.addEventListener("focusout", (event) => {
    if (!activeFormula) {
      return;
    }

    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node &&
      (activeFormula.contains(relatedTarget) || quickActions?.contains(relatedTarget))
    ) {
      return;
    }

    scheduleQuickActionsHide();
  }, true);

  document.addEventListener("dblclick", (event) => {
    const formula = markRecognizedFormula(findFormulaFromEvent(event));
    if (!formula) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openDialog(formula);
  }, true);

  window.addEventListener("scroll", scheduleQuickActionsPosition, { capture: true, passive: true });
  window.addEventListener("resize", scheduleQuickActionsPosition, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hideQuickActions();
    }
  });

  scheduleScan(document);

  const formulaObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const containsPageElement = Array.from(mutation.addedNodes).some((node) =>
        node instanceof Element &&
        !node.closest(`#${ROOT_ID}, #${QUICK_ACTIONS_ID}, #${TOAST_ID}`)
      );
      if (containsPageElement) {
        scheduleScan(mutation.target instanceof Element ? mutation.target : document);
      }
    }

    if (activeFormula && !activeFormula.isConnected) {
      hideQuickActions();
    }
  });

  formulaObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
