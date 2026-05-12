# KoeScope

## React / Next.js frontend update

KoeScope now includes a React + Next.js frontend in `web/`. The backend is still the existing Express 5 + SQLite service; the new frontend is a static-exported Next App Router app served by Express from `web/out` when present.

What changed:
- `web/` adds Next.js, React, TypeScript, HeroUI and the shared frontend utilities used by the search, person, dashboard and activities pages.
- Express serves the Next static export before the legacy `public/` HTML files, while preserving the old entry URLs: `/`, `/person.html`, `/dashboard.html`, `/activities.html`, plus extension-friendly dashboard links.
- The UI now uses an enterprise-style HeroUI layer with dark mode, polished cards, larger ranking artwork, clearer filter chips, staggered card entrance animations and a two-template switcher for Search / Monitor.
- The Search / Monitor template switcher uses Next client routing with prefetching instead of full document reloads, so switching between the two main templates feels like a smooth horizontal page transition.
- Existing `/api/*`, SQLite storage, scheduler behavior and Chrome companion extension contracts remain unchanged.

Frontend commands:
```bash
npm run web:dev      # run the Next frontend dev server
npm run web:build    # build the static export into web/out
npm run web:test     # run frontend mapper/client tests
npm test             # run backend tests, then web:test
```

When changing frontend code, run `npm run web:build` before starting the Express app if you want `http://localhost:5178` to serve the latest static UI. Generated folders such as `web/.next/`, `web/out/` and `web/next-env.d.ts` are intentionally ignored by git.

本地 DLsite 辅助应用。输入声优名或马甲后，应用会从 Bangumi 人物资料中解析别名，再按别名渐进式搜索 DLsite 公开结果；同时提供本地 Monitor，用 SQLite 保存排行榜、价格快照、关注列表、账号同步摘要、活动提醒和可能相关的优惠活动。

## 功能

- 声优 / 马甲解析：通过 Bangumi API 获取候选人物和 infobox 别名。
- 渐进式 DLsite 搜索：首批结果先显示，后续页数在后台继续补入。
- 年龄与作品类型筛选：支持全年龄、R18、混合范围和作品形态分类。
- 声优详情页：汇总人物头像、Bangumi ID、别名、本地搜索记录、热门作品和最新作品。
- Monitor 仪表盘：查看排行榜快照、价格变化、关注作品、提醒和点数推荐。
- DLsite 账号同步：通过 Chrome companion extension 导入已登录页面，读取点数、愿望单、收藏和已购作品的本地缓存。
- 活动中心：查看 DLsite 公开活动，按福利类型、状态、搜索词和“与我相关”过滤，并标记活动提醒已读。
- 活动匹配：基于公开活动信息、本地关注和账号愿望单做保守匹配；优惠券领取、适用条件和最终价格仍以 DLsite 页面为准。
- 明亮工具界面：使用青蓝主色、白底、编号分区、轻量表格和克制 hover 动效，桌面与手机端都保持可操作。

## 快速开始

```bash
npm install
npm start
```

打开：

- 搜索页：`http://localhost:5178`
- 声优详情页：`http://localhost:5178/person.html`
- Monitor：`http://localhost:5178/dashboard.html`
- 活动中心：`http://localhost:5178/activities.html`

Windows 快捷启动：

- 双击项目根目录的 `Start-KoeScope.cmd`
- 或双击 `E:\DL Manager\Start-KoeScope.cmd`

快捷启动会自动检查 `5178` 端口；如果 KoeScope 尚未运行，会在后台启动 `npm start`，等待 `/api/health` 可用后打开首页。日志写入 `dev-logs/koescope-launch.out.log` 和 `dev-logs/koescope-launch.err.log`。

运行测试：

```bash
npm test
```

## 界面导览

首页第一屏就是搜索工作区，不做营销落地页。顶部提供搜索、声优详情和 Monitor 的清爽导航；主工作区负责人物解析、别名选择、年龄范围、详情验证和渐进式 DLsite 搜索。

结果列表按作品类型和年龄分级筛选，封面、排序标签、年龄标记、验证状态、价格、销量和“监测”入口会在同一行内保持高密度展示。搜索会先显示首批结果，再继续在后台加载完整页数。

声优详情页位于 `person.html`。从首页候选人物点击“详情”进入后，可以查看人物主信息、别名摘要、横向统计指标、最近搜索时间线，以及按热门 / 最新切换的本地作品库。

Monitor 与活动中心保持工具型布局：指标带、活动摘要、排行榜、账号状态、点数推荐、提醒、关注作品和明显降价列表都以浅色分区、细分割线和蓝色状态强调呈现。移动端会自动收敛为单列或双列信息带，避免横向溢出。

## 搜索工作流

1. 输入声优名或马甲，例如 `青山ゆかり`。
2. 点击“解析人物”，从 Bangumi 获取候选人物和别名。
3. 选择正确人物，勾选要搜索的别名。
4. 设置年龄范围、排序、每个别名最多页数和每页数量。
5. 如果范围包含 R18，确认合法年龄与地区后再搜索。
6. 点击“搜索 DLsite”，应用会创建渐进式搜索任务。
7. 首批结果先展示，后续页面继续在后台加载，直到当前配置范围完成。

## Monitor

Monitor 使用本地 SQLite 数据库保存数据，默认路径为 `data/dlsite-monitor.sqlite`。

排行榜同步覆盖：

- 楼层：`home`、`maniax`
- 周期：日榜、周榜、月榜
- 分类：总榜、ASMR / 音声、游戏、漫画

默认每日自动检查一次排行榜，也可以在 Monitor 中手动点击“同步”。同步会先保存排行榜快照并逐步显示；只有排行榜页缺少关键信息时才请求详情接口补充。默认请求间隔为 1.5 秒，可用 `DLSITE_MONITOR_DELAY_MS` 调整。

价格提醒只对关注作品生成。默认规则是降价至少 20% 或 500 円，或达到用户设置的目标价。已购作品会从自动关注和提醒中排除。

## 活动中心

活动中心位于 `http://localhost:5178/activities.html`，用于集中查看 DLsite 公开活动。

支持过滤：

- 福利类型：全部、点数、优惠券、折扣、免费、福利、专题
- 状态：进行中、全部、即将结束、未读提醒
- 搜索：活动标题、摘要、详情摘要和活动链接
- 只看与我相关：基于本地关注、DLsite 愿望单和收藏做保守匹配

Dashboard 中保留简洁活动摘要和“活动中心”入口。相关作品如果暂时只有 RJ 号，会显示社团名、缩略图、价格、折扣和来源，避免只展示裸编号。

活动同步默认每 6 小时检查一次，可用以下环境变量调整：

- `DLSITE_ACTIVITY_AUTO_SYNC=0`：关闭活动自动同步
- `DLSITE_ACTIVITY_SYNC_INTERVAL_MS=21600000`：调整活动同步间隔

活动数据来自 DLsite 公开活动 banner JSON，并谨慎解析公开详情页。不会绕过登录、访问私有账号页或声明优惠券归属。

## Chrome 插件

`extension/` 目录提供 Manifest V3 KoeScope Companion。插件主要负责把浏览器中已登录的 DLsite 账号页面导入本地后端，不直接替代后端抓取逻辑。

安装方式：

1. 先运行本地后端：`npm start`
2. 打开 Chrome 的 `chrome://extensions`
3. 启用“开发者模式”
4. 选择“加载已解压的扩展程序”，加载项目中的 `extension/` 目录
5. 打开插件面板，配置本地后端地址并同步账号

插件支持：

- 检查本地后端连接状态
- 保存最近搜索词和搜索配置
- 从网页选中文本快速带入本地搜索
- 捕获已登录 DLsite 页面并导入点数、愿望单、收藏和已购列表
- 显示 DLsite 活动未读提醒摘要

## API

基础：

- `GET /api/health`：健康检查
- `POST /api/persons`：解析 Bangumi 候选人物
- `POST /api/search/progressive`：创建渐进式 DLsite 搜索任务
- `GET /api/search/progressive/:id`：读取搜索任务进度和当前结果

Monitor：

- `POST /api/sync/dlsite-rankings`：启动排行榜同步
- `GET /api/sync/status`：读取排行榜同步状态
- `GET /api/dashboard/summary`：读取仪表盘 KPI、提醒和明显降价作品
- `GET /api/rankings?floor=home|maniax&period=day|week|month&category=all|voice|game|manga`：读取排行榜快照
- `GET /api/works/:id/history`：读取单个作品的价格和排名历史
- `GET /api/watchlist` / `POST /api/watchlist` / `DELETE /api/watchlist/:id`：管理关注作品
- `GET /api/alerts?status=unread|all` / `POST /api/alerts/:id/read`：读取价格提醒并标记已读

账号：

- `GET /api/account/dlsite`：读取本地账号摘要
- `GET /api/account/dlsite/sync-state`：读取账号列表同步状态
- `POST /api/account/dlsite/import-pages`：导入插件捕获的账号页面
- `DELETE /api/account/dlsite/session`：清除本地账号会话缓存
- `GET /api/recommendations/affordable?limit=8`：基于点数读取可负担作品推荐

活动：

- `POST /api/sync/dlsite-activities`：启动 DLsite 公开活动同步
- `GET /api/activities/status`：读取活动同步状态
- `GET /api/activities?status=active|all|endingSoon|unread&benefit=all|point|coupon|discount|free|bonus|info&search=...&related=1`：读取活动列表
- `GET /api/activity-alerts/summary?limit=3`：读取活动未读提醒摘要
- `POST /api/activity-alerts/:id/read`：标记活动提醒已读

## 环境变量

- `PORT`：本地服务端口，默认 `5178`
- `DLSITE_MONITOR_DB`：SQLite 数据库路径
- `DLSITE_MONITOR_AUTO_SYNC=0`：关闭排行榜自动同步
- `DLSITE_MONITOR_DELAY_MS`：排行榜请求间隔，默认 1500ms
- `DLSITE_ACTIVITY_AUTO_SYNC=0`：关闭活动自动同步
- `DLSITE_ACTIVITY_SYNC_INTERVAL_MS`：活动自动同步间隔

## 边界

- 本项目只读取公开页面和用户主动导入的本地账号页面缓存。
- 不提供下载、购买、绕过访问限制或绕过年龄确认的能力。
- 活动匹配只表示“可能相关”，不声明用户已拥有优惠券、资格或最终折扣。
