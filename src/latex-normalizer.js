(function initLatexNormalizer(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.WordLatexNormalizer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  "use strict";

  function isEscaped(value, index) {
    let slashCount = 0;

    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }

    return slashCount % 2 === 1;
  }

  function stripComments(value) {
    return value
      .split("\n")
      .map((line) => {
        for (let index = 0; index < line.length; index += 1) {
          if (line[index] === "%" && !isEscaped(line, index)) {
            return line.slice(0, index);
          }
        }

        return line;
      })
      .join("\n");
  }

  function unwrapMathDelimiters(value) {
    const pairs = [
      ["$$", "$$"],
      ["\\[", "\\]"],
      ["\\(", "\\)"],
      ["$", "$"]
    ];

    for (const [start, end] of pairs) {
      if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
        return value.slice(start.length, -end.length).trim();
      }
    }

    return value;
  }

  function normalizeLatexSource(input, options) {
    const settings = {
      stripComments: true,
      stripDelimiters: true,
      ...(options || {})
    };

    if (input === null || input === undefined) {
      return "";
    }

    let value = String(input)
      .replace(/\r\n?/g, "\n")
      .replace(/[\u2028\u2029]/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .trim();

    if (settings.stripDelimiters) {
      value = unwrapMathDelimiters(value);
    }

    if (settings.stripComments) {
      value = stripComments(value);
    }

    return value
      .replace(/[ \t\f\v]*\n+[ \t\f\v]*/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .trim();
  }

  const WORD_UNSUPPORTED_KEYWORDS = ["eqarray", "Middle", "ldiv", "dsmash"];

  function replaceEnvironment(value, environment, formatter) {
    const pattern = new RegExp(
      `\\\\begin\\{${environment}\\}([\\s\\S]*?)\\\\end\\{${environment}\\}`,
      "g"
    );
    let changed = false;
    const output = value.replace(pattern, (match, body) => {
      changed = true;
      return formatter(body.trim());
    });

    return { value: output, changed };
  }

  function convertLatexForWord(input) {
    let latex = normalizeLatexSource(input);
    const changes = [];
    const environments = [
      ["pmatrix", (body) => `\\left(\\matrix{${body}}\\right)`],
      ["bmatrix", (body) => `\\left[\\matrix{${body}}\\right]`],
      ["Bmatrix", (body) => `\\left\\{\\matrix{${body}}\\right\\}`],
      ["vmatrix", (body) => `\\left|\\matrix{${body}}\\right|`],
      ["Vmatrix", (body) => `\\left\\|\\matrix{${body}}\\right\\|`],
      ["cases", (body) => `\\left\\{\\matrix{${body}}\\right.`],
      ["smallmatrix", (body) => `\\matrix{${body}}`],
      ["matrix", (body) => `\\matrix{${body}}`],
      ["aligned", (body) => `\\matrix{${body}}`],
      ["gathered", (body) => `\\matrix{${body}}`],
      ["split", (body) => `\\matrix{${body}}`]
    ];

    for (const [environment, formatter] of environments) {
      const converted = replaceEnvironment(latex, environment, formatter);
      latex = converted.value;
      if (converted.changed) {
        changes.push(`environment:${environment}`);
      }
    }

    const arrayPattern = /\\begin\{array\}\{[^{}]*\}([\s\S]*?)\\end\{array\}/g;
    let convertedArray = false;
    latex = latex.replace(arrayPattern, (match, body) => {
      convertedArray = true;
      return `\\matrix{${body.trim()}}`;
    });
    if (convertedArray) {
      changes.push("environment:array");
    }

    const withoutNegativeThinSpace = latex.replace(/\\!/g, "");
    if (withoutNegativeThinSpace !== latex) {
      latex = withoutNegativeThinSpace;
      changes.push("spacing:negative-thin");
    }

    const audit = auditWordLatex(latex);
    return {
      latex,
      changes,
      issues: audit.issues,
      compatible: audit.compatible
    };
  }

  function auditWordLatex(input) {
    const value = String(input || "");
    const issues = [];
    const unsupported = WORD_UNSUPPORTED_KEYWORDS.filter((keyword) =>
      new RegExp(`\\\\${keyword}(?![A-Za-z])`).test(value)
    );

    if (unsupported.length > 0) {
      issues.push({
        code: "unsupported-keyword",
        detail: unsupported.map((keyword) => `\\${keyword}`).join(", ")
      });
    }

    const remainingEnvironments = Array.from(
      value.matchAll(/\\begin\{([^{}]+)\}/g),
      (match) => match[1]
    );
    if (remainingEnvironments.length > 0) {
      issues.push({
        code: "unsupported-environment",
        detail: Array.from(new Set(remainingEnvironments)).join(", ")
      });
    }

    if (/\r|\n/.test(value)) {
      issues.push({ code: "physical-newline", detail: "CR/LF" });
    }

    return {
      compatible: issues.length === 0,
      issues
    };
  }

  return {
    auditWordLatex,
    convertLatexForWord,
    normalizeLatexSource,
    stripComments,
    unwrapMathDelimiters
  };
});
