"use strict";

importScripts("vendor/katex.min.js", "word-mathml.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "chatgpt-latex:render-mathml") {
    return false;
  }

  try {
    const latex = globalThis.WordMathml.validateLatexInput(message.latex);
    const mathml = globalThis.WordMathml.latexToMathml(latex, globalThis.katex);
    sendResponse({ ok: true, mathml });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "MathML conversion failed"
    });
  }

  return false;
});
