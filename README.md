# 智慧社区治理平台 · V2.6（第三轮深度代码审计加固版）

依据《智慧社区治理平台开发需求说明书（详细版）V1.1》开发。九大业务模块 + 运营中心全部可点击、可查询、可流转；四级权限、状态机、事务留痕、字段加密、Excel 导入导出、ECharts 自绘地图均为真实实现。

> **V2.0 变更**：完成 P0 安全红线整改与 P1 生产化改造 —— 移除明文账号下发、密码加盐哈希、密钥外置、令牌吊销、字段级加密、居民端三要素查询、CORS/CSP/限流、统一 SQL 数据权限、multipart 流式导入、表驱动权限菜单、HttpOnly 会话、生产部署件。
> **V2.1 变更（本次深度代码审计）**：新增服务端资源级模块鉴权（修复网格员越权读全局审计/合同/流转记录）、禁止 PUT 篡改组织编码与主键、服务端必填与格式校验、真正生效的乐观锁、查询码防暴破锁定、审计日志来源 IP、修复前端编辑/删除主键错位（`PUT .../undefined`）、生产空库初始化（不再灌演示数据）、镜像剔除明文种子、非 root 运行、Nginx 全路径安全头与 CSP。详见第 3.1 节与第 5 节。
> **V2.2 变更（使用者视角 P0 改造）**：首页改为可点击的真待办工作台、顶栏接通全局 FTS 检索、列表支持多选/批量流转/批量删除/表头排序、写操作防重复提交、加载失败可重试空态、筛选条件会话级持久化并可分享、房屋明细补齐表单与必填、流转留痕通用 CRUD 收归区级、批量与待办接口事务化。详见第 3.2 节与第 5 节。
> **V2.3 变更（使用者视角 P1 改造）**：一份 CSS 建立全站 design token 与 5 档响应式断点（侧栏折叠/抽屉、弹窗不超屏、键盘 focus、打印样式）；示意件集中登记并接入 `VITE_DEMO_MODE`，生产构建强制关闭；补齐图表空态/加载态、数据截止时间与统计口径标注；居民端凭条可复制/保存图片/刷新恢复，表单字段级校验与按错误码分层的提示；新增不依赖外部自动化通道的 Chrome CDP 前端回归。详见第 3.3 节与第 5 节。
> **V2.4 变更（使用者视角 P2 批次 A）**：真·实时推送（SSE 事件总线按组织范围 + 模块授权投递最小变化信号，前端退避重连与降级轮询）；待办 SLA 超期口径与「仅看超期」按超期时长排序；状态机撤回 / 退回（30 分钟窗口、本人、管理层角色、原因留痕、进度消息联动、不删历史）；资源元数据由服务端单一来源按角色下发；统一本地时间戳，修复流转留痕「回到 8 小时前」导致时限误判；新增 P2 专项回归与测试限流窗口守卫。详见第 3.4 节与第 5 节。
> **V2.5 变更（第二轮深度代码审计）**：修复「通用 CRUD 可直写 `status` 一步终结业务且零流转留痕」「免鉴权居民端提交无服务端字段校验」「居民端进度查询外泄内部办理字段与留痕全字段」「批量写操作 SSE 广播漏推给下级订阅者」等 5 个实测可复现的业务/安全缺陷；同时加固导出行数上限、只读留痕授权判断顺序、ECharts tooltip 存储型 HTML 注入、实时通道重连竞态与 refresh 失效无限重连、明文令牌全请求注入、登出未清理居民凭条、开放重定向、列表/二维码请求竞态、Nginx 静态路径与 compose 拓扑不一致、伪造 XFF 绕过限流、Excel 解析无规模限制。新增 `tests/v25-audit.js` 46 项专项回归，把每个缺陷固化为断言。详见第 3.5 节与第 5 节。
> **V2.6 变更（第三轮深度代码审计）**：以「真实请求复现 → 修复 → 固化为断言」闭环，再修复 8 类实测可复现缺陷：① 自然主键资源（组织 / 网格）手工新增后变成无法编辑删除的「幽灵记录」、网格业务编码可改导致关联断裂；② 人口 Excel 导入写成党员字段结构、归属编码按组织表而非网格表校验，污染业务数据；③ 状态机办理意见 / 回退原因无长度与内容校验（脏数据 + 存储型注入面）；④ 居民端进度留痕泄露内部办理意见、消息接口不校验网格且返回后台字段（隐私）；⑤ 全局检索 `limit` 可绕过（`LIMIT -1` 拖库）；⑥ 二次验密无限流（在线密码暴破通道）；⑦ 组织 / 网格编码可填不存在的孤儿值、空间查询参数不校验且全表扫描；⑧ 前端演示编码兜底、字段级校验口径、加载错误 UI 缺失。新增 `tests/v26-audit.js`（68 项）专项回归，版本号、schema、compose 镜像与文档同步升 V2.6。详见第 3.6 节与第 5 节。
> **技术栈**：Vue 3 + Vite + Element Plus + Pinia + ECharts + Axios / Node.js 22 + Express 4 / SQLite 3.51（WAL + FTS5 trigram）。不使用 JDK / MySQL / ES。

---

## 1. 快速启动（开发 / 演示）

```bash
npm install
npm run reset       # 生成种子数据并重建加密数据库（约 7 秒）
npm run build       # 构建前端到 dist/
npm start           # 单进程托管前端 + REST API，端口 8081
```

访问 **http://localhost:8081**，`admin / admin123` 登录。

**四级账号**（仅用于本地演示，生产部署后必须立即改密 / 由初始化脚本注入真实账号）：

| 账号 | 密码 | 角色 | 数据范围 |
|---|---|---|---|
| admin | admin123 | 区级管理员 | 118 网格 |
| street | 123456 | 街道管理员 | 36 网格 |
| community | 123456 | 社区管理员 | 9 网格 |
| grid | 123456 | 网格员 | 1 网格 |

居民端：`/resident?grid=450102010101`，免登录；提交后返回**业务编号 + 一次性 6 位查询码**，进度查询需三要素齐全。

---

## 2. 生产部署

### 2.1 必须注入的环境变量

| 变量 | 说明 |
|---|---|
| `NODE_ENV=production` | 开启 HSTS、Secure Cookie、错误详情脱敏；**缺少密钥时启动直接退出** |
| `ZHSQ_JWT_SECRET` | JWT 签名密钥 |
| `ZHSQ_DATA_KEY` | AES-256-GCM 字段加密密钥 |
| `ZHSQ_INDEX_KEY` | 敏感字段 HMAC 索引密钥 |
| `ZHSQ_CORS_ORIGINS` | 允许的来源，逗号分隔（默认本机 8081/5182） |
| `ZHSQ_ADMIN_PASSWORD` | **生产首次初始化必填**（≥12 位）：创建空业务库时唯一管理员的密码，库里不含任何演示账号 |
| `ZHSQ_DB_FILE` | 可选，库文件路径（放独立数据卷） |
| `ZHSQ_TRUST_PROXY` | 仅在确认前面有可信 Nginx 反代时设为 `1`，使 `req.ip` / `req.protocol` 取真实来源；直连部署保持关闭 |
| `ZHSQ_BACKUP_DIR` / `ZHSQ_BACKUP_KEEP` | 可选，备份目录与保留份数（默认 `server/data/backups` / 30 份） |
| `ZHSQ_TLS_CERT` / `ZHSQ_TLS_KEY` | 可选，直启 HTTPS；不设则由 Nginx 终止 TLS |
| `ZHSQ_RATE_GLOBAL` / `ZHSQ_RATE_LOGIN` / `ZHSQ_RATE_RESIDENT` | 可选，每分钟限流阈值（默认 1200 / 10 / 120） |
| `VITE_API_BASE_URL` | 构建期变量，前后端分离部署时指向 API 域名（默认 `/api`） |
| `VITE_DEMO_MODE` | 构建期变量：开发环境默认开启示意件，设为 `0` 关闭；**生产构建默认强制关闭** |
| `VITE_DEMO_IN_PROD` | 危险开关：仅当与 `VITE_DEMO_MODE=1` 同时设置时，才允许生产构建展示示意件（验收演示环境用） |

> ⚠️ **密钥与数据库必须同源**。`DATA_KEY` 换掉后旧密文不可解；`INDEX_KEY` 换掉后 HMAC 索引失效。务必先备份，再按第 2.4 节做密钥轮换。开发模式会把随机密钥写入 `server/data/keys/*.key`，生产模式**忽略该文件、强制读环境变量**。

示例见 `.env.example`。

### 2.2 容器部署（推荐）

```bash
# 1) 在项目根目录创建 .env，写入三个密钥、ZHSQ_ADMIN_PASSWORD 与 ZHSQ_CORS_ORIGINS
docker compose build
docker compose up -d
docker compose ps          # healthcheck 应显示 healthy
```

- `Dockerfile` 两阶段构建：第一阶段产出前端 `dist/`，第二阶段**只复制 `server/*.js`**，明文种子 JSON（`db.json` / `bulk.json`，含演示账号与身份证）与开发密钥文件都不进入运行镜像。
- 以非 root 用户 `node` 运行，并 `cap_drop: ALL`；应用端口只绑定 `127.0.0.1:8081`，外部必须经 Nginx（TLS + 安全头）访问。
- 首次启动创建的是**空业务库 + 一个管理员**（密码取自 `ZHSQ_ADMIN_PASSWORD`）+ 最小字典 + 菜单权限，**不含任何演示业务数据**；已有库一律原样复用，绝不自动重建。
- `deploy/nginx.conf` 在 `location /` 与 `/assets/` 各自声明完整安全头与 CSP（规避 Nginx `add_header` 继承陷阱），`/api/` 由后端设置，避免响应头重复。
- 数据卷 `zhsq-data` 存库文件，`zhsq-backups` 存在线备份快照。
- **单实例部署**：SQLite 是单机单写方案，`upstream` 不能配多个后端（详见第 6 节）。

### 2.3 裸机 / 虚拟机部署

```bash
npm ci && npm run build
export NODE_ENV=production ZHSQ_JWT_SECRET=... ZHSQ_DATA_KEY=... ZHSQ_INDEX_KEY=...
export ZHSQ_ADMIN_PASSWORD=<至少12位初始管理员密码>
export ZHSQ_CORS_ORIGINS=https://your-domain.example.com
export ZHSQ_TRUST_PROXY=1        # 经 Nginx 反代时开启
node server/index.js
```

前面挂 `deploy/nginx.conf`（TLS 终止、静态资源长缓存、`/api` 反代、`client_max_body_size 25m` 以支持 20MB Excel 导入）。也可用内置 TLS：设置 `ZHSQ_TLS_CERT` / `ZHSQ_TLS_KEY` 后直接以 HTTPS 启动。

### 2.4 备份、恢复与上线前清理

```bash
npm run backup       # checkpoint + VACUUM INTO 在线快照，自动 integrity_check / SHA256 / 保留 30 份
npm run reset        # 重建演示库（会清空业务写入，仅用于演示/测试；生产模式禁止 --force）
npm run purge:seed   # 裸机部署时删除明文种子 JSON，只保留已加密的库文件
```

上线前 checklist：

- ✅ 确认生产库是**空库初始化**（`ZHSQ_ADMIN_PASSWORD`），而非演示库；演示账号 `admin/admin123` 在生产不存在
- ✅ 导入真实人口/房屋/组织/企业数据
- ✅ 注入三个长期保存的密钥 + 初始管理员密码，纳入密钥管理并离线备份
- ✅ 配置 HTTPS、域名白名单、Nginx 安全头、日志采集与磁盘/备份监控
- ✅ 执行 `npm run test:all`（七套回归，257 项）、`npm run test:ui`（Chrome CDP 前端回归，26 项）、`npm run test:v25`（审计专项，46 项）与 `npm run test:deploy`（生产空库初始化 + 二次重启）
- ✅ 确认生产构建不出现示意抓拍 / 跳步演示按钮（生产构建强制关闭示意件，无开启后门）
- ✅ 按甲方要求补充等保测评、日志留存周期、国密算法适配

---

## 3. V2.0 安全机制（对照上一轮 P0 / P1 清单）

| # | 整改项 | 落地实现 | 文件 |
|---|---|---|---|
| 1 | 明文账号下发 | `/api/meta/accounts` 显式 404；登录页移除一键登录卡片与默认密码 | `index.js` / `Login.vue` |
| 2 | 密码与密钥 | scrypt 加盐哈希 + `timingSafeEqual`；密钥环境变量注入、生产缺密钥拒绝启动；JWT 带 `jti/typ/iat/exp`，access 2h + refresh 7d(HttpOnly Cookie) + SQLite 吊销名单 | `crypto.js` / `keys.js` / `auth.js` |
| 3 | 居民端越权 | 进度查询改「手机号 + 业务编号 + 一次性查询码」三要素，库里只存 HMAC 哈希；限流 + 失败审计 | `index.js` / `resident_query` 表 |
| 4 | 敏感数据 | `secure` 列 AES-256-GCM 加密、`data` 只留脱敏副本、`sec_idx`/`sec_phone` HMAC 索引支持完整值检索；明文查看需二次验密换 5 分钟 `sensitive` 令牌，全程留审计 | `crypto.js` / `sqlite.js` |
| 5 | 数据权限 | `AsyncLocalStorage` 请求上下文 + SQL 层统一注入 `org_code LIKE '前缀%'`；`readOne` / 列表 / 导出 / CRUD 全覆盖，散点 `assertScope` 保留为第二道防线；`version` 乐观锁 | `scope.js` / `sqlite.js` / `store.js` |
| 6 | 传输边界 | CORS 域名白名单、CSP / HSTS / X-Frame-Options / nosniff / Referrer-Policy、全局与登录限流、可选 TLS | `index.js` |
| 7 | 前端会话 | access 令牌只在 JS 内存；refresh 走 HttpOnly Cookie；401 自动续期重试一次，失败才跳登录（修复 history 路由下 `location.hash` 跳不回去的 bug） | `token.js` / `request.js` / `main.js` |
| 8 | Excel 导入 | 改 `multipart/form-data` 上传，服务端解析、20MB / 5 万行上限、错误行明细、批量预编译 SQL 单次事务入库 | `index.js` / `CrudTable.vue` |
| 9 | 权限驱动 | `sys_menu` / `sys_role_menu` 表驱动菜单；后端下发 `permissions`；路由守卫校验模块 + 路径；`v-permission` 按钮级指令 | `migrate.js` / `store.js` / `router` / `directives` |
| 10 | API 基址 | `VITE_API_BASE_URL` 外置，支持前后端分离部署 | `request.js` / `.env.example` |

### 3.1 V2.1 深度审计修复清单

| 级别 | 问题（实测确认） | 修复 |
|---|---|---|
| P1 | 前端隐藏菜单不是边界：网格员可直接读 `opLogs`/`contracts`/`flowLogs` 等全局资源（实测 200，含全平台 275 条流转记录） | `RESOURCES` 增加 `module`/`roles`，新增 `assertResource()`，通用 CRUD / 导出 / 导入 / 检索 / 流转统一鉴权；`/api/flows` 按 bizId 反查业务主体做数据范围过滤 |
| P1 | `PUT` 可把记录 `orgCode` 改到权限范围外（实测改成 `45010299` 成功） | 服务端校验新旧组织编码、禁止改主键（`orgs.orgCode`）、剔除 `password`/`role`/`orgLevel` 等受保护字段 |
| P1 | 空表单与非法身份证可直接写库（实测 `POST {}` 返回新增成功） | `RESOURCES.required` + `validateBody()`：必填、身份证、手机号、日期格式；前端 `el-form :rules` 双重校验 |
| P0 | 前端编辑/删除主键错位：`formFields` 不含 `id`，实际发出 `PUT /api/partyMembers/undefined` | `CrudTable` 统一 `rowKey()` + `editingId`，并按资源主键兜底（`id/orgCode/gridCode/code`） |
| P1 | 乐观锁形同虚设（服务端现读版本再比对） | 列表/详情下发 `version`，前端编辑回传，服务端用于 `expectedVersion`；冲突返回 409/40903 |
| P1 | `store.update()` 用合并后对象重推主键，`orgs`/`grids` 改主键会 UPDATE 0 行却污染缓存与 FTS | 固定使用调用方 `id`，检查 `changes`，`version` 不写入 JSON 文档 |
| P1 | 状态机 `operator` 可由客户端伪造，污染流转留痕 | 强制取会话身份 `req.user.name` |
| P2 | 6 位查询码可枚举 | `resident_attempt` 表按「业务编号 + IP」计数，连续 5 次失败锁定 10 分钟（429） |
| P1 | 已有库但 grids 为空时启动会静默清空重建为演示数据；`--force` 无生产守卫 | 以 `kv.meta` 初始化标记为准，已初始化库绝不重建；生产禁止 `--force`（除非 `ZHSQ_ALLOW_FORCE=1`） |
| P1 | 明文种子 JSON 被打进生产镜像；容器 root 运行；8081 直曝可绕过 Nginx | 镜像只复制 `server/*.js`；`USER node` + `cap_drop`；端口只绑回环；Nginx 全路径安全头+CSP |
| P2 | 浏览器侧：登录/退出/下拉选项失败产生未捕获异常；blob 错误被当 xlsx 下载；打印页 HTML 注入；`workerIds` 缺失导致页面崩溃；URL 未编码 | 逐项修复（见 `request.js` / `CrudTable.vue` / `QrDialog.vue` / `api/index.js` / 微站与网格台账） |
| P2 | 审计日志无来源 IP；`uncaughtException` 只打日志继续跑 | ALS 记录 IP/UA 并落日志；未捕获异常记录后退出，由容器重启策略拉起 |

### 3.2 V2.2 P0 使用体验改造清单

| # | 使用者痛点（实测/代码确认） | 改造 |
|---|---|---|
| 1 | 上轮修复只覆盖 `/api/flows`，通用 CRUD `/api/flowLogs` 仍让网格员读到全平台 275 条留痕 | `flowLogs` 收归 `ops + roles:[district]`；单条留痕改按业务模块授权，业务角色仍可看本辖区留痕 |
| 2 | 首页「待办」实为任意状态前 6 条（实测混有「已派发/已办结」），真实 85 条待办散落 3 个模块 | 新增 `GET /api/meta/todo` 聚合三类待办（按角色模块授权 + 四级数据范围 + 状态口径）；Portal 改为可点击三页签工作台、KPI 可下钻、行可直达业务模块并带状态筛选 |
| 3 | 后端 FTS5 已可用（16ms），前端零入口 | 顶栏 `el-autocomplete` 全局检索，结果按资源分组、点击跳转对应模块并带关键字 |
| 4 | 46 条待办要逐条点 3~4 次；后端 `sortField` 已支持但表头没接 | `CrudTable` 加多选 + 批量流转（支持各记录「下一合法状态」）+ 批量删除 + 表头排序，批量结果逐条列出失败原因 |
| 5 | 连点「保存」会生成重复记录 | 所有写操作统一请求锁 + 按钮 loading/禁用；导入失败在弹窗内明确提示 |
| 6 | 房屋明细漏配 `form-fields`，新增会弹出 0 字段表单并写入空记录 | 补齐 7 个房屋字段，后端 `houses.required` 兜底；未配置表单的资源点新增直接提示而非写脏数据 |
| 7 | 接口 500/超时被静默显示成「共 0 条」，误判为没数据 | 列表区分「无数据 / 加载失败 + 重试按钮」，错误原因来自响应体 |
| 8 | 刷新/切页后筛选条件全丢，筛好的结果无法分享 | 下拉/分页/排序/关键字按资源存 `sessionStorage`（退出登录清除，关键字不写 URL），结构化条件同步 URL query，「分享筛选」一键复制链接 |
| 9 | 编辑态可改主键，填完整张表才收到 403 | `orgs.orgCode` / `grids.gridCode` 编辑时置灰并提示 |
| 10 | 导入模板对未配置资源静默返回党员模板（实测字节完全相同） | 未配置模板显式返回 `40401`；`houses` 空表单返回 `40002` |

新增接口：`GET /api/meta/todo`、`POST /api/transition/batch`、`POST /api/bulk-delete/:resource`；`GET /api/search` 已在前端接线。批量接口均逐条复用单条的状态机、模块授权与组织范围校验，单条失败不影响其它条目，单次上限 100 条。

### 3.3 V2.3 P1 视觉与使用体验加固清单

| # | 使用者痛点 | 改造 |
|---|---|---|
| 1 | 颜色/圆角/字号散落在 15 个 `.vue`，`:root` 只有 9 个变量；全站 **0 个 `@media`** | `styles/main.css` 建立完整 design token（品牌色/语义色/间距/圆角/字号/阴影/深色/Element Plus 主题覆盖），新增 1440/1200/1024/768/480 五档断点、`:focus-visible`、`@media print` |
| 2 | 15 处内联 `grid-template-columns` 无法响应式；1366×768 双滚动条；640px 弹窗在小屏被裁 | 收敛为 `.grid-side-*` / `.grid-cols-*` / `.grid-sensing*` 等复用类；≤1200px 折叠侧栏、≤768px 改抽屉 + 汉堡按钮、弹窗 `92vw`；`.dark-view` 改内容区高度，独立大屏用 `.dark-view-full` |
| 3 | CSS 模拟抓拍 `CAM-01 LIVE`、示意 GeoJSON、写死 `:active="2"` 步骤条、跳步演示按钮混在真实数据里 | 新增 `utils/app.js` 的 `VITE_DEMO_MODE`：**生产构建强制关闭**示意件，开发环境默认开且明确标注；抓拍位在生产显示「暂无抓拍图像 / 通道未接入」；示意地图常驻标注「示意边界（由组织 bounds 生成，非测绘成果）」；步骤条改为不表示进度的标准流程示意 |
| 4 | 登录页写死「118 网格 / 20,860 人口」、V2.0；Panorama 自述 Demo、多个页面写「实时」但只加载一次 | 登录统计改从公开 `/api/health` 动态取真实库计数，版本号统一 `APP_VERSION`；文案改为 FTS5 / 按权限自动收窄 / 页面加载时取数；Screen / Sensing / GeoPlatform 增加「数据截至 HH:mm:ss（页面刷新时更新，非实时推送）」、统计口径与手动刷新按钮 |
| 5 | 图表无空态 / loading，空数据和加载失败都显示空白画布 | `EChart.vue` 增加覆盖层（不隐藏容器，避免实例尺寸为 0），支持 `loading` / `emptyText`，继续保留 `ResizeObserver` 与 `dispose` |
| 6 | 居民端查询码「仅显示一次，请截图保存」，刷新即永久丢失；空表单只弹一句 toast；网络错误被伪装成「三要素不匹配」 | 新增 `ReceiptCard.vue`：一键复制（含非安全上下文降级）、生成 PNG 凭条、会话内保存且刷新自动恢复、可主动清除；三个表单加 `el-form :rules` 字段级校验、请求锁与 44px 触控区；请求层透传 `code` 并支持 `silentError`，`utils/errors.js` 把校验/不匹配/限流/网络/冲突映射成不同提示与下一步动作 |
| 7 | 门户卡片与居民端 tabbar 是 `div @click`，键盘/读屏不可用 | 改 `button` + `role="tab"` / `aria-selected`，登录表单补可见 `label`，全站统一 `:focus-visible` |
| 8 | 浏览器自动化通道（CDP 派发）不稳定，前端改动无法稳定复验 | 新增 `npm run test:ui`：Node 22 内置 `fetch`/`WebSocket` + 本机 Chrome CDP，零第三方依赖，自包含 22 项断言（登录、27 页渲染、4 档分辨率、弹窗、示意件开关、图表样式、居民端凭条与错误分层） |

> `DEMO_MODE` 只控制示意控件显隐，**不参与任何鉴权或数据权限判断**；生产构建即使强制开启也需同时设置 `VITE_DEMO_MODE=1` 与 `VITE_DEMO_IN_PROD=1`。

### 3.4 V2.4 P2 批次 A · 业务闭环与实时联动清单

| # | 遗留问题（V2.3） | 本轮落地 |
|---|---|---|
| 1 | 大屏 / 感知 / 地理平台只在页面加载时取数，值守期间写操作看不到；文案只能写「非实时推送」 | 新增 `server/events.js` 进程内 SSE 总线：`GET /api/events` 走统一 JWT 鉴权（`fetch` 流可带 Authorization，不用 EventSource 把令牌暴露在 URL）；25s 心跳、2h 最大生命周期、全局 200 / 每账号 3 连接上限、登出按 `jti` 精确关闭、断线双保险清理。所有写操作事务成功后广播**最小信号**（资源 / 主题 / 编号 / 时间），不含姓名手机身份证；按组织前缀与模块授权逐连接过滤，Nginx 对 `/api/events` 关闭缓冲。前端 `utils/live.js` 用退避重连 + 节流刷新，SSE 不可用时自动降级为轮询并如实展示连接状态，工作台、大屏、感知、地理平台、列表全部联动 |
| 2 | 待办只有数量，没有时限；值守人员无法一眼看出哪条快超期 / 已超期 | `config.js` 定义 SLA（办事 48h / 治理万家 24h / 告警 4h，起算字段显式配置）；`GET /api/meta/todo` 返回 `overdue` 分组计数、逐条 `_sla`（起算时间 / 已用 / 剩余 / 是否超期）；支持 `overdue=1` 仅看超期且按超期时长降序（最紧急优先），总量口径不变，仍按四级数据范围收窄。工作台新增超期 KPI、开关、行级标签与口径说明；超期只提醒，不自动改变状态 |
| 3 | 状态机只能单向推进，误操作无法纠正 | 新增 `POST /api/transition/revoke`（30 分钟内、仅本人上一步、初始/终态不可撤回、原留痕打 `revokedAt` 不删历史、业务状态与办理人/意见同步回退、追加独立撤回留痕）与 `POST /api/transition/return`（仅区/街/社区管理层、原因不少于 5 字写入留痕、联动生成给申请人的进度消息、已归档不可回退）。正向跳步校验保持不变；`FlowTimeline.vue` 展示撤回 / 退回 / 已撤回标记 |
| 4 | 列 / 表单 / 必填 / 状态机元数据散落在各页面，前后端各写一份 | 新增 `GET /api/meta/schema`：由服务端 `RESOURCES` 派生，按角色裁剪资源，下发 `required` / `states` / `slaHours` / `readonly` / `protectedFields`；前端 `utils/schema.js` 消费，`CrudTable` 的必填校验与状态下拉改为服务端口径（本地常量仅作断网兜底） |
| 5 | 全站用 `toISOString()` 生成 UTC 字符串，种子数据与解析按本地时间，新增流转留痕「回到 8 小时前」，撤回时限与 SLA 全部算错 | 新增 `server/time.js` 统一 `localStamp()` / `stampEpoch()`，替换 `index.js` / `store.js` / `auth.js` / `events.js` 全部时间戳写入；流转留痕补 `atMs` 解决同一秒内多条留痕的排序与「最后一步」判定 |
| 6 | 登出会关掉同账号所有页签的实时连接，其它页签令牌仍有效又会立刻自动重连，反复抖动 | SSE 连接绑定 access token 的 `jti`，登出只关闭本会话连接；改密等强制下线场景仍可关闭该账号全部连接 |
| 7 | 连续跑两轮回归会累计触发 60s 登录 / 全局限流，测试误报甚至崩溃 | 新增 `tests/helpers.js`（跨用例复用有效令牌、429 按 `Retry-After` 等待重试，不绕过限流）与 `tests/rate-guard.js`（`test:all` 首尾对齐限流窗口）；新增 `tests/p2-regression.js` 51 项专项断言 |

> SSE 为**单进程**事件总线，与 SQLite 单机单写的部署拓扑一致；若将来水平扩展为多实例，需替换为 Redis Pub/Sub 或消息队列，否则跨实例的写操作不会互相推送。


### 3.5 V2.5 第二轮深度代码审计 · 整改清单

本轮按「后端权限/状态机/数据层 → 前端逻辑 → 部署配置 → HTTP 异常注入实测 → 修复 → 回归」执行，所有结论均有真实请求或代码路径佐证；审计中「网格台账打开居民端字段写错」一条经核对为误报（`grids` 记录确实含 `qrUrl`），未做无谓改动。

| 级别 | 实测问题（触发条件） | 修复 |
|---|---|---|
| 严重 | `POST/PUT /api/:resource` 只过滤 `PROTECTED_FIELDS`（不含 `status`）：实测 `POST serviceRequests` 带 `status:'已办结'` 直接成功且 `flowLogs` 为 0 条；`PUT` 可把待派发事件改成「已归档」，甚至写入状态机外的任意字符串使记录永久卡死 | `config.js` 新增 `FLOW_PROTECTED_FIELDS` / `FLOW_INITIAL_STATUS`；状态机资源新建强制初始状态并自动补 SLA 起算时间，编辑态字段值有变化即 `40002` 明确拒绝；`/api/meta/schema` 下发 `immutableFields`，`CrudTable` 自动剔除不可直写字段，两张业务表单移除状态下拉 |
| 严重 | `/api/resident/events`、`/requests` 免鉴权且除 `gridCode` 外无服务端校验：实测可写入 3000 字标题、`<img onerror>` 类型、非法手机号、1 万字描述 | 新增 `validateResidentBody`：白名单字段、字符串类型、`<`/`>` 拒绝、手机号格式、逐字段长度上限、事件类型/办理事项按字典枚举校验 |
| 中 | 居民端三要素查询返回业务记录全字段（`handler`/`opinion`/`content`/`orgCode`/`version`）与流转留痕全字段（内部操作人、组织编码、`atMs`） | 进度查询改白名单字段；留痕只返回展示所需字段，操作人统一脱敏为「工作人员」 |
| 中 | 批量流转 / 批量删除 / Excel 导入的 SSE 广播用 `req.user.orgCode`：实测区级用户批量处理社区记录时，网格员订阅者 **0 帧**（单条流转能收到 1 帧） | `emitChange` 与 `events.js publish` 支持组织编码数组，批量路径逐条收集实际记录编码；任一编码落在订阅者范围内即投递 |
| 中 | `/api/export/:resource` 忽略分页全量导出，实测 `population` 单次返回 9.36MB；并发导出可打满进程内存 | 先用同一套 SQL 条件 COUNT，超过 `ZHSQ_EXPORT_MAX_ROWS`（默认 50000）返回 `40002` 提示筛选后分批导出；前端校验 `blob.size` 非空 |
| 中 | `assertResource` 中「只读留痕禁止写入」判断位于 `cfg.roles` 早返回之后，对 `flowLogs`/`opLogs` 成为死代码 | 判断前移；并把 `READONLY` 检查提到 `guardResource` 之前，统一返回语义明确的 `40302` |
| 中 | 4 处 ECharts `tooltip.formatter` 把组织名/设备名/部件名直接拼进 HTML（生产 CSP 挡脚本但挡不住 UI 伪造；开发环境无 CSP 可直接执行），`PartManage` 还会因 `p.data.raw` 缺失抛错 | 新增 `utils/esc.js` 转义全部动态文本；`raw` 改可选链兜底 |
| 中 | `live.js` 中 `stopLive()→startLive()` 同一 tick 时旧连接 `finally` 的 `active=false` 尚未执行，新 `connect()` 被挡住且旧连接不再重连 → 通道永久 offline；401 时 refresh 失败仍无限重连；服务端 `closed` 帧被丢弃 | 引入 `epoch`/`activeEpoch` 代际判断；refresh 连续失败两次后停止通道并引导登录；显式处理 `closed` 帧 |
| 中 | 5 分钟明文授权令牌注入**每一个**请求；登出只清 `zhsq:view:` 前缀，居民端凭条（含手机号 + 一次性查询码）与 401 跳转后的筛选缓存均残留 | 令牌仅在 `reveal=1` / `/export/` 请求注入；登出与 `goLogin()` 统一清理全部 `zhsq:` 前缀 |
| 中 | 页面刷新 `restore()` 用独立 `api.refresh()`，与 401 自动刷新并发时后端 `rotate` 会吊销旧 refresh 令牌，偶发被踢回登录 | `restore()` 复用 `request.js` 的 `refreshSession()` 单例，再取 `profile()` 重建会话 |
| 轻 | `Login.vue` 开放重定向只挡 `//`；`CrudTable.load()` 无请求序号，SSE 刷新与翻页并发会旧响应覆盖新结果；`QrDialog` 快速切网格错配二维码；`GeoPlatform` 把 ECharts 实例放进 `ref` 被深度代理 | 分别补 origin 白名单、`loadSeq` 丢弃过期响应、`qrSeq`、`shallowRef` |
| 轻 | `deploy/nginx.conf` 用 `root/alias /app/dist` 指向容器内路径，但 compose 无该卷 → 宿主机 Nginx 部署时静态资源全 404；XFF 保留客户端伪造值 | 改为纯反代（Express 自托管 `dist`、SPA fallback 由 `app.get('*')` 完成）；XFF 统一覆盖为 `$remote_addr`；Dockerfile 补 `COPY sql/`，compose 镜像版本对齐并下发导出上限 |
| 轻 | `XLSX.read` 解析用户上传文件无规模限制；`buildWhere` 的组织前缀未转义 LIKE 通配符；`applyRollback` 仅按姓名判断「本人」，同名工作人员可互撤 | 限制 `sheetRows=50001` 与工作表数 ≤5；前缀转义并用 `ESCAPE`；流转留痕写 `operatorId`，撤回优先按用户 ID 判定（旧留痕回退按姓名） |

> 审计同时复核并**排除**以下疑点：编辑弹窗回传脱敏值不会覆盖库内真实明文（实测 reveal 仍为完整身份证号）；统计接口传入范围外 `orgCode` 返回空集而非越权数据；`grids` 记录确实含 `qrUrl` 字段。

**V2.5 接口契约**：`GET /api/meta/schema` 增加 `immutableFields`（不可直写字段），`version` 升 `V2.5`；状态机资源 `POST /api/:resource` 只接受初始状态、`PUT` 拒绝改动状态机字段（`40002`）；居民端提交非法输入返回 `40003`；`/api/resident/progress` 返回字段收窄。其余契约不变。

### 3.6 V2.6 第三轮深度代码审计 · 整改清单

本轮以「真实 HTTP 请求复现 → 修复 → 固化为断言」闭环，所有结论均有可复现证据；审计同时复核并排除了若干误报。核心修复如下：

| 级别 | 实测问题（触发条件） | 修复 |
|---|---|---|
| 严重 | 自然主键资源（组织 `orgCode` / 网格 `gridCode`）手工新增时仍合成 `id` 写入业务对象，导致 `GET/PUT/DELETE /api/orgs/:orgCode` 全部 404，新记录列表可见却无法编辑 / 删除（幽灵记录）；`grids` 前端的业务编码 (`gridCode`) 可在编辑时随意改写，断掉与人口 / 房屋 / 部件 / 企业等子表的关联 | `store.insert/update/remove` 统一以 `RESOURCES.primary` 为读写删唯一依据，自然键资源不再把合成 `id` 写进业务对象；`PUT` 禁止改动主键字段（`40305`）；`CrudTable` 用 `idKey` 同源取键 |
| 严重 | 人口 Excel 导入把每一行硬写成**党员**字段结构（`orgId`/`joinDate`/`status:'正式党员'`/`type`/`excellent`），且归属编码按**组织表**而非**网格表**校验 → 导入到网格的人口落入党员表结构、被网格表校验拒绝或归属错误 | 导入按目标资源 `population` 的业务结构落地，字段白名单与人口一致；归属编码按 `gridCode` 走网格表校验，与组织表隔离 |
| 严重 | 状态机办理意见 (`remark`) 与回退原因 (`reason`) 无长度 / 内容校验：可写入空串、超长文本或 `<img onerror>` 类内容（脏数据 + 存储型注入面） | 办理意见非空、回退原因 ≥5 字且 `<`/`>` 拒绝，写入流转留痕前统一清洗 |
| 严重 | 居民端 `/api/resident/progress` 返回内部办理意见 (`opinion`)；`/api/resident/messages` 不校验 `gridCode` 且返回后台字段（`orgCode`/`readCount`/`status`） | 进度留痕改为白名单字段；消息接口校验网格归属，返回字段收窄为公开字段 |
| 中 | 全局检索 `limit` 参数可传负数 / 超大值绕过夹取（`LIMIT -1` 拖库） | `buildWhere` 与 `ftsSearch` 双重夹取为正向正整数上限，白名单 `sortField` |
| 中 | 二次验密（明文查看授权入口）无限流，已登录会话可被用作在线密码暴破通道 | 按「会话用户 + IP」限流（默认 8 次 / 分钟），连续失败计数、成功即清零 |
| 中 | 组织 / 网格编码可填不存在的孤儿值（`45010299` 之类）；空间查询 `bounds`/`center`/`radius` 不校验，全表扫描 | 新增 `validateOrgRefs`：格式、存在性、数据范围三重校验；空间查询参数范围与类型校验，结果截断 |
| 轻 | 前端顶栏「居民端预览」、办事 / 治理「打开居民端」、大屏 / 地理页组织编码仍有演示编码 (`450102010101`) 兜底，生产空库下打开必然 404；手工表单仅「非空」校验，与后端口径不一致；部分首屏只有 `finally` 无 `catch` 缺错误 UI | 改为从 `api.gridOptions()` 动态取值，无网格时明确提示；表单同步身份证 / 手机号 / 日期 pattern；补齐加载错误 UI |
| 严重 | **党组织「党员人数」一律显示 0**：`partyOrgs.memberCount` 是永不更新的冗余字段（新建组织恒为 0，增删党员不回写）；「该组织党员」列表按 `orgCode` 过滤，但党员按唯一 `orgId`（党组织主键）归属，且党总支与下属支部**共用社区 `orgCode`**，父级党委 / 党工委按自身 `orgCode` 查不到下级支部党员；手工新增党员只传 `orgCode`、后端不补 `orgId`，导致这些党员 `orgId` 为空、既不被任何计数也查不到 | 后端 `GET /api/partyOrgs` 列表实时聚合「本组织 + 全部下级」党员数（按 `orgId` 向上累加）；新增 `GET /api/party/members?orgId=` 按唯一 `orgId` 返回本组织 + 下级党员；`applyPartyOrgRef` 改为**优先用 orgId 反查** `orgCode/orgName`（唯一无歧义）；前端党员录入 / 筛选改为「选具体党组织（按 id）」下拉（`CrudTable` 新增 `partyOrg` 类型） |

> 审计同时复核并**排除**的疑点：① `grids` 主键实为 `id`（种子 `G0001`），`RESOURCES.grids` 不声明 `primary` 即正确回落 `'id'`，新增网格走 `GR####` 自增主键且可正常编辑删除（此前失败的根因在合成 `id` 写对象，已修）；② 居民端不再用演示编码兜底，缺编码时给出明确引导而非静默 404；③ 字段级校验在前端与 Excel 导入、服务端三重一致。

**V2.6 接口契约**：`GET /api/meta/schema` 的 `version` 升 `V2.6`；新增组织 / 网格主键保护（`PUT` 改主键 `40305`）；人口导入落地为人口结构并按网格校验；状态机 `remark`/`reason` 长度与内容校验；居民端消息校验网格并收窄字段。其余契约不变。

### 接口契约变更（前端已同步）

| 变更 | V1.2 | V2.0 |
|---|---|---|
| 登录响应 | `{token,user,menus}` | 增加 `permissions`、`expiresIn`；同时下发 `Set-Cookie: zhsq_refresh`(HttpOnly) |
| 新增 | — | `POST /api/auth/refresh`、`POST /api/auth/sensitive-grant` |
| 删除 | `GET /api/meta/accounts` | 404 |
| 明文查看 | `?reveal=1` 直接返回 | `?reveal=1` + `X-Sensitive-Token`，未授权 403 |
| Excel 导入 | `POST {rows:[...]}` | `POST multipart/form-data`（字段名 `file`） |
| 进度查询 | `?phone=` | `?phone=&bizCode=&queryCode=` |
| 提交响应 | 业务对象 | 业务对象 + `queryCode`（仅此一次返回） |
| 越权详情 | HTTP 200 + `code:40400` | HTTP 404 + `code:40400` |

**V2.4 新增 / 扩展接口**：`GET /api/events`（SSE 实时通道）、`GET /api/meta/live`（通道诊断，仅计数）、`GET /api/meta/schema`（按角色裁剪的资源元数据）、`POST /api/transition/revoke`、`POST /api/transition/return`；`GET /api/meta/todo` 增加 `overdue=1` 筛选、`overdue` 分组计数、逐条 `_sla` 与 `filter.sort`。Nginx 对 `/api/events` 关闭代理缓冲并放宽长连接读超时。

---

## 4. 数据库与数据规模

`sql/schema.sqlite.sql` 为完整建表基线。除 31 张业务表外，新增：

| 表 | 用途 |
|---|---|
| `auth_revoked` | 令牌吊销名单（logout / refresh 轮换） |
| `sys_menu` / `sys_role_menu` | 菜单与角色权限（29 菜单 / 100 授权） |
| `resident_query` | 居民端查询凭条（只存哈希） |
| `resident_attempt` | 查询码失败计数与锁定（防暴破） |
| `fts_search` | FTS5 trigram 中文全文检索 |

每张业务表含 `secure` / `sec_idx` / `sec_phone` 加密列、`version` 乐观锁、`created_at` / `updated_at` 审计字段，以及 `org_code` / `grid_code` / `status` 索引。旧版本库文件打开时由 `ensureSchema()` 自动补列与索引，不删文件、不丢数据。

演示数据：**137 组织 / 118 网格 / 20,860 人口 / 50,120 房屋 / 720 建筑 / 1,180 部件 / 860 党员**，均为固定随机种子生成的**虚构数据**。

---

## 5. 回归验证结果（V2.6）

| 套件 | 命令 | 结果 |
|---|---|---|
| 功能与接口契约 | `npm run test:api` | ✅ **53 项通过 / 0 失败**：状态机验证改为每轮自建专用待受理申请、验证后删除，不再消耗种子数据 |
| 安全专项（P0 红线） | `npm run test:security` | ✅ **28 项通过 / 0 失败** |
| SQLite 与并发 | `npm run test:sqlite` | ✅ **15 项通过 / 0 失败**：引擎/WAL、FTS5 中文检索、SQL 下推、200 并发读、50 并发写、留痕落库 |
| 审计专项 | `npm run test:audit` | ✅ **34 项通过 / 0 失败** |
| P0 体验专项 | `npm run test:p0` | ✅ **31 项通过 / 0 失败**：待办口径与范围、留痕越权收窄、模板兜底、房屋必填、排序、批量流转（成功/跳步/越权/上限/逐条隔离）、批量删除 |
| P2 业务闭环专项（V2.4 新增） | `npm run test:p2` | ✅ **51 项通过 / 0 失败**：SSE 鉴权/连接/最小负载/范围与模块过滤/登出精确关闭、SLA 超期口径与排序、撤回退回全拒绝路径与留痕、schema 按角色裁剪 |
| V2.5 深度审计专项 | `npm run test:v25` | ✅ **46 项通过 / 0 失败**：状态机直写全拒绝路径与初始状态/SLA 起算、居民端 6 类脏数据拒绝 + 进度字段白名单、SSE 批量广播范围、导出体积与只读留痕、脱敏回写不损坏明文、前端与部署静态断言 |
| V2.6 深度审计专项（新增） | `npm run test:v26` | ✅ **68 项通过 / 0 失败**：自然主键资源读写删闭环、人口导入结构与网格校验、状态机 remark/reason 校验、居民端隐私收窄、检索 limit 夹取、二次验密限流、组织/网格编码存在性与范围校验、空间查询参数校验、前端兜底与校验口径 |
| 党组织党员人数统计 | `npm run test:party` | ✅ **18 项通过 / 0 失败**：列表 memberCount 实时聚合（含下级）、`/api/party/members` 按唯一 orgId 聚合、新增党员以 orgId 精确归属无歧义、增删改计数联动回退 |
| 历史学习正文 | `npm run test:history` | ✅ **7 项通过 / 0 失败**：40 条记录均有非空正文、5 时期 × 8 栏目组合齐全、各时期内容互不相同 |
| 学习教育富文本 / 上传 | `npm run test:richtext` | ✅ **12 项通过 / 0 失败**：上传鉴权与类型白名单、图片 inline 访问、HTML 净化保留排版标签 |
| 离线矢量底图 | `npm run test:geo` | ✅ **24 项通过 / 0 失败**：合规来源守护（含 Geofabrik / ODbL 关键词与内容特征防绕过）、权限边界、GeoJSON 严格校验、文件类型守卫、导入与回落 |
| 底图多格式导入 | `npm run test:geoimport` | ✅ **22 项通过 / 0 失败**：`.zip`(Shapefile 中文 DBF) / `.zip`(GeoPackage deflate) / `.gpkg` 直接导入成功、属性剥离与名称匹配；压缩包 README / 文件名 / GPKG 图层名 / 元数据的 OSM 特征换壳被拒、投影坐标 / 缺 dbf / 损坏 zip / zip 路径穿越 / 超限要素 / 未鉴权全部拦截 |
| 前端导入静态防线 | `npm run test:imports` | ✅ **4 项通过 / 0 失败**：扫描 37 个 `.vue`，检出「使用 Vue / Element Plus 具名 API 却漏写 import」——这类缺陷构建 0 error，浏览器执行 setup 时才抛 ReferenceError |
| 网格人员录入与一致性 | `npm run test:gridperson` | ✅ **17 项通过 / 0 失败**：人员主数据 role 可写、非法岗位被拒、网格长 / 网格员绑定可改并回读、无效 / 重复 / 兼任 / 超限引用被拒、网格组织 / 网格微站 / 居民端三方按同一主数据显示（含改名联动）、测试数据自动清理 |
| 一键全跑 | `npm run test:all` | ✅ 合计 **464 项 / 0 失败**（十六套串行，含静态导入防线、底图多格式导入与 Chrome CDP 真机回归）；限流窗口守卫自动错开 60s，安全阈值不变 |
| 前端真机回归 | `npm run test:ui` | ✅ **34 项 / 0 失败**（连续两轮）：Chrome CDP 自包含；登录页 V2.6 动态统计、27 页渲染 0 运行时错误、四档分辨率、弹窗不超屏、示意件全关、实时通道状态（含独立全屏大屏）、超期工作台、撤回/退回入口、**离线底图弹窗 / 富文本编辑器交互态断言**、**网格台账人员列 / 人员主数据页签 / 录入弹窗下拉 / 微站维护入口**、居民端凭条与错误分层 |
| 演示开关双向验证 | 开发 `vite` + 生产 `dist` 各自真机 | ✅ 开发模式：跳步演示按钮 1 个、示意抓拍 3 个且标注「示意画面 · 非真实抓拍」；生产构建：两者均为 0，改显示「暂无抓拍图像」占位 |
| 部署验收 | `npm run test:deploy` | ✅ 生产模式全新数据卷：首次初始化 + 二次重启均正常，`grids=0 / population=0`（无演示数据）、密钥全部来自 env、健康接口不泄露库路径、演示密码被拒 |
| 前端构建 | `npm run build` | ✅ 0 error，产物约 3.0MB，无 sourcemap、dist 无明文账号或身份证 |
| 在线备份 | `npm run backup` | ✅ `wal_checkpoint` + `VACUUM INTO`，`integrity_check=ok` + SHA256 + 保留策略 |

> `test:ui` 需要本机 Chrome / Edge（可用 `CHROME_PATH` 指定）且服务已启动；会提交一条居民端测试申请并自动删除业务主记录。无浏览器时会打印警告并跳过（不阻断 `test:all`），安装后建议单独重跑 `npm run test:ui`。`test:all` 内的 `tests/helpers.js` 复用有效令牌并对 429 按 `Retry-After` 等待重试，**不绕过任何限流**；`tests/rate-guard.js` 负责连续运行时的窗口对齐。彻底恢复干净数据用 `npm run reset`。
>
> 前端改动后请务必跑真机回归：Vite/Rollup 构建不校验未导入的自由变量，`npm run build` 0 error 不等于页面可运行；`tests/vue-imports.js` 提供零依赖静态兜底，`test:ui` 捕获 setup 与事件处理中的运行时异常。

最终数据已 `npm run reset` 恢复干净初始态（118 网格 / 20,860 人口 / 31 张表 / FTS 23,429），临时备份与生产冒烟库已清理。

---

## 6. 架构边界与后续待办（如实说明）

**已具备生产部署能力，但以下仍是演示态 / 需按甲方环境补齐，不宣称 100% 生产就绪：**

| 类别 | 现状 | 上线前需补 |
|---|---|---|
| 业务数据 | **生产首次启动已改为空业务库初始化**（无演示账号、无虚构人口）；仅开发/演示库使用虚构种子数据 | 导入真实人口/房屋/组织/企业数据；如需按甲方库表结构对接，另做数据迁移 |
| 统计指标 | `stats.js` 部分趋势/访问量仍由公式生成（`Math.sin`、固定基数） | 接埋点表按日 `GROUP BY` 聚合 |
| 地图 | 默认仍为组织 `bounds` 生成示意多边形（常驻标注「示意边界，非测绘成果」）；**已支持导入合规来源的真实行政区边界**（`.geojson` / `.json` / `.zip` 内 Shapefile / `.gpkg` 自动转换，无需 GDAL），落本地磁盘 `server/data/geo/basemap.json`，ECharts 自绘渲染、断网可用、无外部地图请求；导入需登记来源 / 审图号 / 坐标系并在页眉公示 | 甲方从自然资源部标准地图服务、天地图或属地自然资源主管部门获取带审图号的行政区划数据后导入 |
| 感知平台 | 抓拍图生产构建已关闭，显示「暂无抓拍图像 / 通道未接入」占位；开发演示模式才显示明确标注的示意画面 | IoT 网关（MQTT/HTTP）+ 对象存储 + 真实抓拍 |
| 通知 | 进度消息写库表，未真发短信 | 短信 / 微信服务号通道 |
| 运维 | 内置限流/审计/健康检查/在线备份 | 集中日志归档、Prometheus 告警、日志留存周期、等保测评、国密算法适配 |
| 部署拓扑 | 单机单实例 | SQLite **不支持水平扩展**；V2.4 SSE 为进程内总线，多实例需接 Redis Pub/Sub 才能跨实例推送；多机需迁 MySQL/PG（业务 Service 层与前端不受影响） |

### 6.1 离线地图：真实行政区边界导入（合规）

平台**不内置、不下载、不缓存任何在线地图瓦片**，也不使用 OpenStreetMap / Google Maps / Mapbox / Bing 等境外或无资质来源。真实底图由区级管理员在「地理信息平台 → 离线底图」导入：

1. 从合规渠道获取该地区行政区划边界数据（要素为 `Polygon` / `MultiPolygon`，属性含区域名称）：
   - 自然资源部标准地图服务 `bzdt.ch.mnr.gov.cn`（带审图号的标准地图）
   - 国家地理信息公共服务平台「天地图」`www.tianditu.gov.cn`（政务版 / 离线部署需授权）
   - 属地自然资源主管部门依法提供的行政区划数据（通常交付 `.shp` 压缩包或 `.gpkg`）
   - 具备甲级测绘资质单位提供、经审核的政务用图数据
   - **支持的容器**：`.geojson` / `.json`、`.zip`（内含 `.shp`+`.dbf`，或内含 `.gpkg`）、`.gpkg`；平台内置零依赖转换（`server/geo-import.js`），**无需安装 GDAL / QGIS**。单文件 ≤60MB，转换后仍需满足 ≤300 区域 / ≤60000 坐标点 / 经纬度坐标。
2. 导入时填写底图名称、数据来源、审图号、坐标系（GCJ-02 / CGCS2000 / WGS84）与名称字段（默认 `name`，Shapefile 常见 `NAME` / `XZQMC`）。服务端自动解析 DBF 中文编码（`.cpg` / UTF-8 / GBK 自适应）、将 ESRI 环方向转为 GeoJSON 规范、校验结构与坐标范围，仅保留 `name`/`code` 属性并写入操作日志（含原始文件名）。
3. 数据落 `server/data/geo/basemap.json`，前端 ECharts 自绘渲染，**完全离线、无外部地图请求**；页眉公示来源与审图号。要素名称与业务网格同名时参与归一化着色，散点图层始终按经纬度叠加（框选 / 缓冲区查询无需坐标转换）。
4. 「恢复示意底图」可随时回退；`test:geo`（24 项）固化合规守护、权限边界与回落逻辑，`test:geoimport`（22 项）固化多格式转换与容器级合规扫描。

**常见不合规文件示例**：从 `download.geofabrik.de` 下载的 `guangxi-*-free.gpkg.zip` 等 Geofabrik 数据包，其 README 明确标注「created from OpenStreetMap data, licensed under ODbL 1.0」。这类文件**不得导入平台**：① 属境外 / 无资质地图数据源，无审图号，OSM 的国界与行政区划表达不符合国家标准；② ODbL 开源授权不等于测绘成果使用许可；③ 文件是 GeoPackage（SQLite 容器，内含 `gis_osm_*_free` 等 20 个全要素图层、体积 200MB+，超过 60MB 上传上限），并非经审核的行政区划边界，且图层名 / 版权声明 / 属性字段都带 OSM 特征。即便只抽取其中的 `gis_osm_adminareas_a_free` 行政界图层、转换格式、改文件名、或把「数据来源」改写成合规渠道，同样不允许。

平台对此设四重守护，`test:geo` + `test:geoimport` 已固化断言：

| 层级 | 校验 |
|---|---|
| 文件类型 | 仅接受 `.geojson` / `.json` / `.zip` / `.gpkg` 且 ≤60MB；其它扩展名 40010；ZIP 限 64 条目 / 解压 ≤120MB，防 zip bomb 与路径穿越 |
| 来源文本 | 黑名单含 OpenStreetMap / OSM / Geofabrik / ODbL / Google / Mapbox / Bing 等 |
| **容器 / 元数据** | 扫描 ZIP 内文件名、README / 版权文本、`.prj`、GeoPackage 图层名、`gpkg_contents` 描述、字段名与属性值；`gis_osm_*` 表名、Geofabrik 声明均被拦 |
| 文件内容 | 扫描顶层版权 / 生成器与要素属性中的 `osm_id` / `osm_type` / ODbL 声明等特征；转格式、换容器、改写来源均无法绕过 |

**格式转换已内置**：`.zip`(Shapefile) 与 `.gpkg` 由 `server/geo-import.js` 在服务端直接解析（ZIP32 store/deflate、DBF、ESRI Polygon、GPKG 头 + WKB），运行时不依赖 GDAL / QGIS。仅在需要**投影坐标转经纬度**或**简化过密边界**时才需离线预处理：

```bash
# 可选：GDAL 预处理（投影坐标 / 点数过多时使用）
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco COORDINATE_PRECISION=6 \
  -simplify 0.0001 boundary.geojson 兴宁区行政区划.shp
```

Web Mercator（EPSG:3857 / 米）等投影坐标会被平台明确拒绝并提示；QGIS 亦可导出 EPSG:4326 GeoJSON。导入前确认区域名称所在属性字段名（常见 `NAME` / `XZQMC`），在「名称字段」填入；要素名称与业务网格同名才会参与归一化着色。

> 行政区划边界属测绘成果，须按《地图管理条例》使用带审图号的标准地图；批量抓取 / 缓存在线地图瓦片违反地图服务条款，平台明确禁止。

### 6.2 网格长 / 网格员的录入口径（单一数据源）

平台只有一份人员数据：`persons`（人员主数据表）存姓名、岗位、手机号、所属组织与网格；`grids.leaderId` / `grids.workerIds` 存「谁是这个网格的网格长 / 网格员」的绑定关系。网格台账、网格微站、居民端 H5 都按 ID 反查 `persons.name` 显示，因此**同一网格三处必然一致**。此前两页看起来不一致，原因是两页各自独立选中的网格不同，以及网格组织多显示了一个「（主数据）」后缀（已去掉）。

| 想做的事 | 操作路径 |
|---|---|
| 新增 / 编辑一个网格员（姓名、岗位、手机号） | 「网格组织 / 便民码」→「人员主数据」页签 → 新增 / 编辑 |
| 给某个网格配网格长、网格员 | 同页「网格台账」页签 → 目标网格「编辑」→「网格长」单选 /「网格员」多选下拉 → 保存 |
| 只改姓名 | 改人员主数据的姓名即可，网格组织 / 网格微站 / 居民端同步；「修改网格长姓名」是快捷入口 |
| 在微站页面跳转到维护 | 「网格微站」→ 微站信息卡片「维护人员」按钮 |

两页共享当前选中网格（`sessionStorage`），人员 / 网格数据变更后微站页面通过实时通道自动刷新。服务端对 `leaderId` / `workerIds` 做引用校验：ID 必须存在于人员主数据、不可重复、同一人不能兼任本网格网格长与网格员、单网格网格员 ≤20 人；`persons.role` 已按资源豁免 `PROTECTED_FIELDS`（该集合里的 `role` 是防止改写账号权限角色，不是业务岗位标签）。`test:gridperson`（17 项）已固化以上链路。

**已完成（V2.4 P2 批次 A + V2.5 审计加固 + V2.6 第三轮审计）**：真·实时推送、SLA 超期提醒、状态机撤回 / 退回、服务端资源元数据单一来源；V2.5 修复状态机绕过、居民端校验与字段泄露、SSE 批量广播、tooltip 注入、实时通道竞态、会话缓存清理与部署拓扑不一致；V2.6 修复自然主键资源「幽灵记录」与网格业务编码可改、人口导入结构与归属校验污染、状态机 remark/reason 校验、居民端隐私收窄、检索 limit 拖库、二次验密暴破、组织/网格孤儿编码与空间查询全表扫描、前端演示编码兜底与字段校验口径与错误 UI，已纳入 46 + 68 项专项回归。**仍未完成（P2 批次 B / 上线前）**：深浅色两套框架视觉统一（深色页仍是独立视觉体系）、完整 WCAG 合规审计、各页面列 / 表单定义全面改为消费 `/api/meta/schema`（目前 `CrudTable` 与状态机已接，其余页面仍是本地定义）、Excel 导入错误行定位后的部分成功回滚策略细化、超期自动升级督办与撤回后的通知联动、SSE 多实例广播（需 Redis Pub/Sub）、真实视频 / 短信通道（真实地图已具备合规导入能力，待甲方提供带审图号的数据）、集中日志监控、等保测评与国密适配、SQLite 单机单写拓扑限制；`xlsx@0.18.5`（npm 停更版本，存在 CVE-2023-30533 原型污染）建议改为从 `cdn.sheetjs.com` 安装官方 0.20.x，当前已通过解析规模限制与字段白名单缓解上传路径风险。这些不宣称完成。

**技术栈偏离**：说明书 3.1 原本要求 Java 21 + Spring Boot + MySQL 5.7 + ES。本项目按已确认的决定采用 Node.js + Python 路线中的 **Node 生产化 + SQLite**；MySQL 5.7 已于 2023-10 EOL，ES 一期用 SQLite FTS5 替代。按用户要求，不再考虑 Java 语言合规风险。

---

## 7. 目录结构

```
server/
  index.js       Express 路由、鉴权、状态机、导入导出、传输安全
  sqlite.js      连接/DDL/平滑升级、SQL 下推、密封与解密、readOne
  store.js       内存镜像 + SQL 写路径、批量导入、权限菜单、居民凭条
  crypto.js      scrypt / AES-256-GCM / HMAC / 脱敏
  keys.js        密钥来源（环境变量 > 开发文件 > 生产拒绝）
  auth.js        JWT 签发校验、吊销名单、限流
  scope.js       AsyncLocalStorage 请求上下文（统一数据权限 + 来源 IP）
  config.js      资源定义 + 模块/角色授权 + 必填规则 + SLA/撤回窗口
  events.js      V2.4 SSE 事件总线（范围/模块过滤、心跳、连接上限、按会话关闭）
  time.js        统一本地时间戳（localStamp / stampEpoch），消除 UTC 混用
  seed.js        固定种子演示数据   migrate.js  种子→SQLite 加密迁移
  backup.js      在线备份（含完整性校验）   purge-seed.js 明文种子清理
web/src/         35 个页面 + api/ + stores/ + router/ + directives/
  styles/main.css  全站 design token + 响应式断点 + focus/打印样式
  utils/live.js    V2.4 SSE 流式订阅、退避重连、降级轮询、节流刷新
  utils/schema.js  V2.4 服务端资源元数据缓存与按角色消费
  utils/app.js     版本号 / DEMO_MODE 示意件开关 / 示意地图口径
  utils/errors.js  后端错误码 → 用户可操作提示
  utils/esc.js     HTML 转义（ECharts tooltip 防存储型注入）
  components/      CrudTable · EChart（空态/loading）· ReceiptCard（凭条）· StatCards 等
tests/           helpers.js（会话复用 + 429 等待） · rate-guard.js（限流窗口对齐）
                 api-smoke.js · security-check.js · sqlite-check.js
                 audit-regression.js（审计专项） · p0-regression.js（P0 体验专项）
                 p2-regression.js（V2.4 实时/SLA/回退/schema 专项）
                 v25-audit.js（V2.5 深度审计：状态机/居民端/广播/XSS/部署）
                 prod-smoke.js（生产空库验收） · ui-smoke.js（Chrome CDP 前端真机回归）
sql/schema.sqlite.sql   完整建表基线
deploy/          nginx.conf · docker-entrypoint.sh
Dockerfile · docker-compose.yml · .env.example
```

---

## 8. 密钥轮换步骤

1. 停服 → `npm run backup` 备份当前库；
2. 用旧 `DATA_KEY` 解密 `secure` 列，用新密钥重新加密并重建 `sec_idx` / `sec_phone`（需一次性迁移脚本）；
3. 用新密钥启动，`npm run test:security` 验证解密与精确检索；
4. 确认无误后删除旧密钥备份。

`ZHSQ_JWT_SECRET` 可单独轮换：旧令牌在 2 小时内自然失效，或清空 `auth_revoked` 之外的会话强制全员重登。

---

依据说明书第 7 章验收项整理；功能完整性、四级权限、流程闭环、数据一致性、可视化、脱敏、并发性能均已通过第 5 节的自动化回归。
