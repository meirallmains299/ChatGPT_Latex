(function initializePopup() {
  "use strict";

  const DEFAULTS = {
    closeAfterCopy: true
  };
  const closeInput = document.getElementById("close-after-copy");
  const status = document.getElementById("status");
  let statusTimer = null;

  function translate(key, fallback) {
    return chrome.i18n?.getMessage(key) || fallback;
  }

  function localizePopup() {
    document.documentElement.lang = chrome.i18n?.getUILanguage?.() || "en";
    document.title = translate("extensionName", "ChatGPT_Latex");
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = translate(element.dataset.i18n, element.textContent);
    });
  }

  function showSaved() {
    window.clearTimeout(statusTimer);
    status.classList.add("is-visible");
    statusTimer = window.setTimeout(() => status.classList.remove("is-visible"), 1200);
  }

  function save() {
    chrome.storage.local.set(
      {
        closeAfterCopy: closeInput.checked
      },
      showSaved
    );
  }

  localizePopup();

  chrome.storage.local.get(DEFAULTS, (settings) => {
    closeInput.checked = settings.closeAfterCopy;
  });

  closeInput.addEventListener("change", save);
})();
