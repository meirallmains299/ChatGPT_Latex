# Release process / 发布流程

1. Confirm `manifest.json`, `package.json`, changelog, tag, release title, and archive name use the same version.
2. Run `npm ci`, `npm run validate`, `npm run check`, and `npm test`.
3. Load the unpacked extension in current Chrome and Edge, then verify hover recognition, both copy actions, double-click editing, and light/dark pages.
4. Verify **Copy to Word** with representative fractions, matrices, delimiters, accents, and spacing in current Word desktop for Windows.
5. Audit for credentials, personal paths, remote code, generated files, and unnecessary permissions.
6. Build a clean source archive that excludes `.git`, tests, development metadata, and caches; generate SHA-256.
7. Commit to `main`, create an annotated `vX.Y.Z` tag, push, and wait for CI.
8. Publish bilingual release notes and immutable archive/checksum assets.
9. Verify public visibility, branch/tag commit equality, workflow result, release asset digest, and clean local status.

中文要求：版本号必须在 Manifest、package、更新日志、Git 标签、Release 标题和压缩包名中完全一致；发布前必须完成 Chrome/Edge、Word、隐私权限、依赖安全和压缩包哈希验证。发现问题后发布新补丁版本，不替换已发布资产来隐藏变更。
