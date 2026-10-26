# 财务管理系统变更申请与变更方案

基于《财务管理系统变更申请表.docx》实现的本地单页 Web 应用，支持在线填写申请表、导出还原表格式的 Word 文档、保存导出留痕，以及基于历史记录重新编辑并再次导出。同时支持从申请表生成《代销管理系统变更方案》，保存方案留痕并按命名模板复用。

- 前端：Vue 3 + Element Plus + Vite
- 后端：Node.js + Express + SQLite
- Word 导出：docxtemplater + PizZip
- 部署：Docker / Docker Compose
- 无需登录，数据全部保存在本机

## 功能

### 填写申请表

- 覆盖原表全部业务字段与控件规则。
- 申请部门、变更系统、变更类别为可下拉、可手工录入的组合框；选项持久化在 SQLite 中。
- 申请日期由服务端生成并锁定，前端不可修改；导出时服务端会再次读取当前日期。
- 「是否需要报备」「是否涉及关联变更」使用 ● / ○ 单选，数据库对象与网络资源使用 ● / ○ 多选。
- 变更功能点支持新增行、删除行，编号自动生成。
- 关联系统、网络变更时间、资源变更时间按选择条件显示。
- 带 * 的必填项在导出前校验，并自动定位到校验失败的字段。
- 页面内置原 DOCX 的示例数据，用户可任意修改或删除，也可一键恢复示例。

### 导出 Word

- 文件名为：`{变更系统}+{期望变更日期}+变更申请表.docx`。
- 基于原始 DOCX 的表格版式渲染，保留字段对齐、单元格结构、多行功能点表格。
- 复选框在 Word 中以 `●` / `○` 体现。
- 多行文本自动转换为 Word 换行。

### 导出留痕与复用编辑

- 每次导出都会保存：导出时间、文件名、完整表单 JSON、关联系统摘要，以及生成的 Word 文件。
- 导出记录页支持关键词搜索、分页、查看详情、下载原 Word、重新编辑。
- 「重新编辑」会完整回填历史表单；申请日期按业务规则更新为服务端当前日期。修改后再次导出会生成新记录，旧记录不会被覆盖。

### 编辑变更方案

- 在申请表页面点击「编辑变更方案」进入方案编辑页，变更需求、变更系统、期望变更日期自动取自申请表。
- 按彩色 Word 模板生成方案：红色文字为手工填写项（仅作为输入提示），橙黄色文字为变更需求多选（导出时以顿号连接）。
- 服务器表中，资产名称、资产类型为下拉单选，选项按当前变更系统联动；IP 地址为下拉复选，选项按行内选择的资产名称联动。选项在「资产选项维护」页面维护。
- 数据库变更、修改配置文件、手工变更、应用回退、数据库回退的步骤统一为可增删行的表格，序号自动生成；导出 Word 时按「1. 步骤内容」自动编号。
- 关联变更需求三个多选允许为空；为空时 Word 标题不输出空括号。
- 变更验证方案自动取自变更申请表的“变更验证方案”内容。
- 服务器表支持增加、删除行；资产名称、IP、用户名、资产类型必须完整填写后才能导出。
- 文件名为：`{变更系统}+{期望变更日期}+变更方案.docx`。
- 方案记录页支持查看、下载、重新编辑和设为模板；重新编辑会生成新记录，旧记录保留。
- 支持多套命名模板。新建方案时可选择模板，模板回填手工项、步骤表格与服务器表，不覆盖自动字段和下拉选项。
- 旧版方案记录与模板在读取时会自动迁移：原多行步骤文本拆分为步骤行，原 IP 字符串拆分为 IP 数组。

### 下拉选项维护

- 三个分组：申请部门、变更系统、变更类别。
- 支持新增、删除选项。
- 支持 CSV 批量导入：
  - 每行一个选项（可带 `value` 表头）；
  - 或使用 `group,value` 两列表格。
- 重复选项自动跳过，导入后立即作用于申请表。

### 资产选项维护

- 资产名称、资产类型按**变更系统**维度维护：先选择变更系统，再维护该系统的资产名称与资产类型。
- IP 地址按**资产名称**维度维护：选择资产名称后维护其 IP 列表。
- 变更方案编辑页的服务器表按「变更系统 → 资产名称/资产类型」「资产名称 → IP 地址」联动展示。
- 支持新增、删除；选项变更后立即作用于变更方案编辑页，已导出的历史记录不受影响。

## Docker 启动（推荐）

环境要求：Docker 20+、Docker Compose v2。

```bash
cd finance-change-app
docker compose up --build -d
```

浏览器访问：<http://localhost:3000>

如果 Docker Hub 无法访问，可以通过环境变量指定可用的 Node 镜像源，例如：

```bash
NODE_BUILD_IMAGE=docker.m.daocloud.io/library/node:20-bookworm \
NODE_RUNTIME_IMAGE=docker.m.daocloud.io/library/node:20-bookworm-slim \
docker compose up --build -d
```

也可以将这两个变量写入项目根目录的 `.env` 文件（可参考 `.env.example`），后续直接使用 `docker compose up --build -d`。

常用命令：

```bash
# 查看日志
docker compose logs -f

# 停止服务（保留数据）
docker compose down

# 停止并删除持久化数据卷（会清空留痕与选项）
docker compose down -v
```

### 数据持久化

Docker Compose 使用命名卷 `finance-change-data` 保存 SQLite 数据库和导出的 Word 文件，容器重建不会丢失。

查看数据卷信息：

```bash
docker volume inspect finance-change-data
```

备份数据：

```bash
docker run --rm \
  -v finance-change-data:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/finance-change-data-backup.tar.gz -C /data .
```

默认只绑定 `127.0.0.1:3000`，不会暴露到局域网。如确需局域网访问，可将 `docker-compose.yml` 中的端口改为 `"3000:3000"`，并自行评估无登录场景的安全风险。

## 本地开发

环境要求：Node.js >= 20.19。

```bash
cd finance-change-app

# 安装前后端依赖
npm run setup

# 终端 1：后端（http://localhost:3000）
npm run dev:server

# 终端 2：前端（http://localhost:5173，/api 自动代理到 3000）
npm run dev:client
```

生产模式本地运行：

```bash
npm run setup
npm run build
npm start
```

访问 <http://localhost:3000>。

默认数据目录为 `server/data/`，可通过环境变量 `DATA_DIR` 修改。时区默认 `Asia/Shanghai`，可通过 `APP_TIMEZONE` 修改。

## 目录结构

```text
finance-change-app/
├── client/                         # Vue 3 前端
│   ├── src/
│   │   ├── components/             # 页头、字段标签、●/○ 选择组、步骤表格、记录详情
│   │   ├── views/                  # 申请表 / 导出记录 / 变更方案 / 方案记录 / 下拉选项 / 资产选项
│   │   ├── api.js                  # Axios 与下载工具
│   │   └── styles.css              # 全局视觉主题
│   └── vite.config.js
├── server/
│   ├── index.js                    # Express 入口、静态资源托管
│   ├── db.js                       # SQLite 初始化、选项与留痕数据访问
│   ├── routes/                     # form / options / plan-options / exports / plans API
│   ├── services/                   # 日期、校验、docx 渲染、方案模板
│   └── templates/
│       ├── change-application-template.docx
│       ├── change-plan-template.docx
│       └── change-plan-schema.json
├── scripts/
│   ├── build-template.py           # 重新生成申请表模板（可选）
│   ├── build-plan-template.py      # 从彩色方案模板生成 docx 模板与字段 Schema
│   └── change-plan-template-source.docx
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## CSV 导入格式

方式一：单列值（在页面选择对应分组后导入）

```csv
value
研发二中心
财务部
```

方式二：两列表格

```csv
group,value
department,研发二中心
system,财务管理系统
changeCategory,需求
```

`group` 可使用内部键：`department`、`system`、`changeCategory`，也支持中文分组名称。单文件最大 2MB。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查、服务端日期 |
| GET | `/api/form/init` | 服务端日期、示例默认值、下拉选项 |
| GET | `/api/form/date` | 服务端当前日期 |
| GET | `/api/options` | 获取三组下拉选项 |
| POST | `/api/options` | 新增选项 `{ group, value }` |
| DELETE | `/api/options/:id` | 删除选项 |
| POST | `/api/options/import` | 上传 CSV，字段 `file`、`group` |
| GET | `/api/plan-options` | 获取资产名称/资产类型/IP 选项 |
| POST | `/api/plan-options/assets` | 新增资产选项 `{ systemName, kind, value }`，kind 为 `assetName`/`assetType` |
| DELETE | `/api/plan-options/assets/:id` | 删除资产选项 |
| POST | `/api/plan-options/ips` | 新增 IP 选项 `{ assetName, value }` |
| DELETE | `/api/plan-options/ips/:id` | 删除 IP 选项 |
| POST | `/api/exports` | 校验、生成 Word、保存留痕并返回文件 |
| GET | `/api/exports` | 导出记录列表 |
| GET | `/api/exports/:id` | 单条导出记录详情 |
| GET | `/api/exports/:id/file` | 下载历史 Word 文件 |
| GET | `/api/plans/init` | 方案字段 Schema、变更方式选项、模板列表、资产/IP 选项 |
| POST | `/api/plans/session` | 保存申请表带入的方案上下文 |
| GET | `/api/plans/session/:id` | 读取方案上下文 |
| POST | `/api/plans` | 校验、生成方案 Word、保存留痕并返回文件 |
| GET | `/api/plans` | 方案记录列表 |
| GET | `/api/plans/:id` | 单条方案详情 |
| GET | `/api/plans/:id/file` | 下载历史方案 Word |
| POST | `/api/plans/:id/template` | 以方案记录保存为模板 |
| GET | `/api/plans/templates` | 模板列表 |
| GET | `/api/plans/templates/:id` | 模板详情 |
| DELETE | `/api/plans/templates/:id` | 删除模板 |

`POST /api/exports` 与 `POST /api/plans` 均返回 Word 二进制文件，响应头 `X-Record-Id` 为新生成的留痕记录编号。

## 说明

- 申请日期始终以服务端当前日期为准，客户端提交的 `applicationDate` 会被忽略。
- 表单数据是导出时的快照；后续修改下拉选项不会影响历史记录。
- 应用无登录与权限控制，建议仅在本机或受信任内网使用。
- 重新生成申请表模板：将原始 `财务管理系统变更申请表.docx` 放在项目上一级目录后运行
  `python3 scripts/build-template.py`，或通过参数指定原始文件路径。
- 重新生成变更方案模板：编辑 `scripts/change-plan-template-source.docx` 中的红色/橙黄色字段后运行
  `python3 scripts/build-plan-template.py`。脚本会校验模板结构并重新生成
  `server/templates/change-plan-template.docx` 与 `change-plan-schema.json`。
- 变更方案模板只把红色文字视为手工输入项、橙黄色文字视为多选项；固定黑色文字原样带入导出文档。
