"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  auditWordLatex,
  convertLatexForWord,
  normalizeLatexSource
} = require("../src/latex-normalizer.js");

test("collapses physical newlines and indentation", () => {
  const source = `
    C_{i,f,s}(t;R)
      =
    \\mathbf 1\\!\\left[d_{i,f,s}(t)\\leq R\\right]
      =1,
  `;

  assert.equal(
    normalizeLatexSource(source),
    "C_{i,f,s}(t;R) = \\mathbf 1\\!\\left[d_{i,f,s}(t)\\leq R\\right] =1,"
  );
});

test("preserves LaTeX matrix row commands", () => {
  const source = String.raw`\begin{matrix}
    a & b \\
    c & d
  \end{matrix}`;

  assert.equal(
    normalizeLatexSource(source),
    String.raw`\begin{matrix} a & b \\ c & d \end{matrix}`
  );
});

test("removes surrounding math delimiters", () => {
  assert.equal(normalizeLatexSource("\\[\n  x^2 + y^2\n\\]"), "x^2 + y^2");
  assert.equal(normalizeLatexSource("$$ a+b $$"), "a+b");
  assert.equal(normalizeLatexSource("$x_1$"), "x_1");
});

test("removes comments without treating escaped percent signs as comments", () => {
  const source = "x + y % layout note\n+ z + 50\\%";
  assert.equal(normalizeLatexSource(source), "x + y + z + 50\\%");
});

test("normalizes the reported multiline indicator formula", () => {
  const source = `C_{i,f,s}(t;R)

    =

  \\mathbf 1\\!\\left[d_{i,f,s}(t)\\leq R\\right]

    =1,`;

  assert.equal(
    normalizeLatexSource(source),
    "C_{i,f,s}(t;R) = \\mathbf 1\\!\\left[d_{i,f,s}(t)\\leq R\\right] =1,"
  );
});

test("removes physical line breaks after an equals sign in solvent selectivity", () => {
  const source = "S=\r\n\\frac{\\overline{N}_{\\mathrm{DMC}}/N_{\\mathrm{DMC}}^{\\mathrm{bulk}}}\u2028{\\overline{N}_{\\mathrm{H_2O}}/N_{\\mathrm{H_2O}}^{\\mathrm{bulk}}}";
  assert.equal(
    convertLatexForWord(source).latex,
    "S= \\frac{\\overline{N}_{\\mathrm{DMC}}/N_{\\mathrm{DMC}}^{\\mathrm{bulk}}} {\\overline{N}_{\\mathrm{H_2O}}/N_{\\mathrm{H_2O}}^{\\mathrm{bulk}}}"
  );
});

test("removes zero-width characters and normalizes non-breaking spaces", () => {
  assert.equal(normalizeLatexSource("a\u200b\u00a0 +\u00a0b"), "a + b");
});

test("handles empty values", () => {
  assert.equal(normalizeLatexSource(null), "");
  assert.equal(normalizeLatexSource(" \r\n\t "), "");
});

test("converts standard LaTeX matrix environments to Word matrix syntax", () => {
  assert.equal(
    convertLatexForWord(String.raw`\begin{matrix}a & b \\ c & d\end{matrix}`).latex,
    String.raw`\matrix{a & b \\ c & d}`
  );
  assert.equal(
    convertLatexForWord(String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`).latex,
    String.raw`\left(\matrix{a & b \\ c & d}\right)`
  );
});

test("converts cases and aligned environments conservatively", () => {
  assert.equal(
    convertLatexForWord(String.raw`\begin{cases}x & x>0 \\ -x & x\leq0\end{cases}`).latex,
    String.raw`\left\{\matrix{x & x>0 \\ -x & x\leq0}\right.`
  );
  assert.equal(
    convertLatexForWord(String.raw`\begin{aligned}a&=b \\ c&=d\end{aligned}`).latex,
    String.raw`\matrix{a&=b \\ c&=d}`
  );
});

test("removes negative thin-space commands from the Word text fallback", () => {
  const result = convertLatexForWord(String.raw`\mathbf 1\!\left[x\right]`);
  assert.equal(result.latex, String.raw`\mathbf 1\left[x\right]`);
  assert.deepEqual(result.changes, ["spacing:negative-thin"]);
});

test("reports Microsoft-documented unsupported Word LaTeX keywords", () => {
  const result = auditWordLatex(String.raw`x \eqarray y + \Middle z`);
  assert.equal(result.compatible, false);
  assert.equal(result.issues[0].code, "unsupported-keyword");
  assert.equal(result.issues[0].detail, String.raw`\eqarray, \Middle`);
});

test("reports unconverted begin/end environments", () => {
  const result = convertLatexForWord(String.raw`\begin{custom}x\end{custom}`);
  assert.equal(result.compatible, false);
  assert.equal(result.issues[0].code, "unsupported-environment");
  assert.equal(result.issues[0].detail, "custom");
});
