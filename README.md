# PhiTools 素材仓库（模板）

这是一个**独立的新仓库**模板，用来托管 PhiTools 用的 WebP 曲绘素材，
并**自动跟随上游更新**（Phigros 加新曲后无需人工介入）。

## 为什么单独建仓库

- 不污染官网/其他仓库（素材体积会持续增长，且是纯机器生成的产物）；
- GitHub Actions 免费额度足够（首次全量约 5–10 分钟，之后每天增量几乎瞬时）；
- jsDelivr 这类免费 CDN 可以直接服务本仓库的 `main` 分支内容。

## 建仓库步骤

1. 在 GitHub 新建仓库，建议名 **`phitools-assets`**（public，Actions 免费）；
2. 把本目录（`client/assets-repo-template/`）里的所有文件复制进新仓库根目录并 push：
   ```
   phitools-assets/
   ├── .github/workflows/update-webp.yml   # 自动更新工作流
   ├── scripts/update-webp.mjs             # 抓上游 → 转 WebP → 写文件
   ├── package.json                        # 依赖 sharp
   └── README.md（本文件）
   ```
3. 打开新仓库的 **Actions** 页签，允许运行工作流，然后手动点一次
   **Update WebP assets → Run workflow**（首次会全量生成约 **63MB** 的素材，
   分两次提交：ill512 约 8MB、ill2048 约 55MB，都是正常 git 提交，无需 LFS）；
4. 等它跑完（首次约 5–10 分钟），仓库里会出现：
   ```
   ill-webp/ill512/<曲目id>.webp      # B30 卡片 + 模糊背景
   ill-webp/ill2048/<曲目id>.webp     # 单曲详情页
   ill-webp/manifest.json             # 数量与体积统计
   ```
5. 把这个仓库地址告诉 PhiTools（客户端/网页端配置里 `frontend/js/platform.js` 的
   `REPO` 常量，以及 `client/scripts/verify-web.mjs` 的同名常量）。

## 之后怎么更新（Phigros 出新曲）

**全自动**：工作流每天 UTC 03:17（北京时间 11:17）自动跑一次：
读取上游 `Catrong/phi-plugin-ill` 的文件清单 → 找出新增/变化的曲目 →
下载原图 → 转 WebP → 提交。也可以随时在 Actions 页手动 Run（可勾选 `force` 全量重转、
或用 `limit` 只转前 N 首做测试）。

所以你的日常维护量是 **0**；新曲的素材在一天内自动出现在素材仓库，
玩家端的网页/客户端会在首次渲染该曲时按需取到（无需更新客户端）。

> 注意：GitHub Actions 的定时任务在仓库 60 天无活动时会被自动禁用（GitHub 的策略）。
> 由于本工作流每天都会产生提交，实际上会持续活跃；若哪天发现停了，
> 在 Actions 页点一次 Enable 即可。

## 手动兜底（不用 Actions 时）

本地也能跑同样的脚本（需要 Node 18+）：

```bash
npm install
npm run update        # 增量
npm run update:force  # 全量重转
git add ill-webp && git commit -m "update webp" && git push
```

或在 PhiTools 主仓库里：

```bash
npm run fetch:ill     # 增量拉取原图 PNG 到 client/assets/ill-pack
npm run pack:webp     # 增量转 WebP 到 client/assets/ill-webp
# 然后把 client/assets/ill-webp/ill512、ill2048 覆盖进本仓库并 push
```
