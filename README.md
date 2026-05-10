# DL Voice Search

本地 Web 应用：输入声优名或马甲，从 Bangumi 人物资料中解析别名，再按别名搜索 DLsite 公开搜索结果。结果按作品形式和年龄分级筛选，搜索采用渐进式加载：前面抓到的内容先显示，剩余页数继续在后台自动加载。

## 使用

```bash
npm install
npm start
```

打开 `http://localhost:5178`。

监测仪表盘位于 `http://localhost:5178/dashboard.html`。默认每日检查一次 DLsite 总榜、ASMR、游戏和漫画排行榜，也可以在页面中手动点击“同步”。

## 工作流程

1. 输入声优名或马甲，例如 `青山ゆかり`。
2. 点击“解析人物”，从 Bangumi API 获取候选人物和 infobox 别名。
3. 选择正确候选人物，勾选要搜索的别名。
4. 选择年龄范围、排序、每个别名最多页数和每页数量。
5. 如果搜索范围包含 R18，确认合法年龄与地区后再搜索。
6. 点击“搜索 DLsite”，程序会一次性启动完整搜索任务。
7. 首批结果会先显示，后续页数在后台自动补入列表，直到当前配置范围加载完成。

## 说明

- 后端对 Bangumi 和 DLsite 请求做了缓存和保守限速。
- DLsite Monitor 使用本地 SQLite 数据库保存排行榜快照、价格历史、关注列表和站内提醒；数据库默认写入 `data/dlsite-monitor.sqlite`。
- 排行榜同步覆盖 `home` 与 `maniax` 的总榜、ASMR、游戏和漫画范围，并按较慢节奏请求 DLsite 公开页面与站内 JSON 端点。
- 同步会先保存排行榜快照并逐步显示；只有排行榜页缺少关键信息时才请求详情接口补充。默认请求间隔为 1.5 秒，可用 `DLSITE_MONITOR_DELAY_MS` 调整。
- 价格提醒只对关注作品生成；默认规则是降价至少 20% 或 500 円，或达到用户设置的目标价。
- “每个别名最多页数”默认是 50，可按需要调低以减少请求量。
- “详情验证”默认关闭；开启后会在作品页加载完成后逐个请求详情页确认声优/作者/制作人员相关字段。
- 搜索任务保存在当前本地后端进程内，任务结果会保留一段时间；重启后端会清空任务状态。
- 项目不提供下载、购买、绕过访问限制或绕过年龄确认的能力。

## Chrome 插件

`extension/` 目录提供 Manifest V3 插件入口。插件只访问本地后端，不直接请求 Bangumi 或 DLsite。

1. 先运行本地后端：

```bash
npm install
npm start
```

2. 打开 Chrome 的 `chrome://extensions`，启用“开发者模式”。
3. 选择“加载已解压的扩展程序”，加载项目里的 `extension/` 目录。
4. 点击插件图标，或在网页中选中文本后右键搜索。

插件支持：

- 配置本地后端地址并检查连接状态。
- 保存最近搜索词。
- 快捷选择马甲、全选或清空别名。
- 设置年龄范围、排序、页数、每页数量和详情验证。
- 按作品形式与年龄分级筛选渐进加载中的结果。
- 将当前搜索词带入完整本地页面。

## 接口

- `GET /api/health`：健康检查。
- `POST /api/persons`：解析 Bangumi 候选人物。
- `POST /api/search/progressive`：创建渐进式 DLsite 搜索任务。
- `GET /api/search/progressive/:id`：轮询搜索任务进度和当前结果。
- `POST /api/sync/dlsite-rankings`：启动 DLsite 总榜与分类排行榜同步。
- `GET /api/sync/status`：查看当前同步状态、最近一次运行和下次计划时间。
- `GET /api/dashboard/summary`：获取仪表盘 KPI、未读提醒和明显降价作品。
- `GET /api/rankings?floor=home|maniax&period=day|week|month&category=all|voice|game|manga`：读取最近总榜或分类排行榜快照。
- `GET /api/works/:id/history`：读取单个作品的价格和排名历史。
- `GET /api/watchlist` / `POST /api/watchlist` / `DELETE /api/watchlist/:id`：读取、添加或移除关注作品。
- `GET /api/alerts?status=unread|all` / `POST /api/alerts/:id/read`：读取提醒并标记已读。
