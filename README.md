# 题场 · 课堂竞技场

面向教室触摸大屏的双人课堂 PK 与轻量题库服务。最终形态是一个可在办公室笔记本上长期运行的单文件 Windows 服务端，前端通过同一地址访问，数据写入本机 SQLite。

## 已有能力

- 全班名单按学号排列，左右选手分别从菜单选人
- 一个教师可维护多个班级，主界面可快速切换当天上课班级
- 双人异步答题、独立倒计时，英语听力题同步播放
- 英语、数学、物理选择题；所有公式使用 KaTeX 渲染
- 班级可新增、复制、删除，名单支持 50 人以上并自动重排学号
- 手机端 `/practice` 支持按班级和学生进入单人练习或单元测试
- 练习模式逐题反馈，测试模式交卷后回看答案；公式、图片和英语读音完整保留
- 学生练习成绩自动写入 SQLite，教师可在主界面查看班级练习记录
- 离线成绩进入待补交队列，恢复网络后自动重试；教师记录会合并本机 SQLite 与待同步成绩
- 教师工作台使用密码登录，题库、班级、成绩与写接口受会话保护；学生 `/practice` 保持独立入口
- SQLite 每日自动热备份、完整性校验并轮换旧备份
- 主界面底部“本机服务”入口可打开运维中心，查看数据库大小、运行时长、备份目录和最近快照，并可立即手动备份
- 运维中心支持检查 GitHub 正式版本、下载校验、安装并重启；更新失败会自动恢复旧版本
- 题库支持新增、编辑、删除、批量导入和导出
- 自建题支持 LaTeX、英语朗读、图片、知识点和难度
- 可筛题组包、设置题数与答题秒数并应用到课堂
- 浏览器本地缓存与服务端 SQLite 自动同步
- 1366×768、1080P、4K 和手机尺寸响应式检查

## 技术结构

- `src/`：React + TypeScript + Vite 前端
- `server/`：Go + SQLite 单体服务端
- `server/web/`：构建时注入的嵌入式前端资源
- `data/xyz.db`：默认运行数据文件
- `release/xyz-server.exe`：包含前端和 SQLite 驱动的发布程序
- `classroomDirectory`：服务端保存的多班级工作区与当前班级
- `practice_attempts`：单人练习和测试成绩、答题明细与完成时间
- `GET /api/admin/status`：受教师登录保护的服务器、SQLite 与备份概况
- `GET /api/admin/backups`、`POST /api/admin/backups`：受教师登录保护的备份列表与手动备份
- `GET /api/admin/update`、`GET /api/admin/update/check`：受教师登录保护的版本状态与在线检查
- `POST /api/admin/update/download`、`POST /api/admin/update/install`：下载校验并准备安装在线更新

## 开发

安装依赖：

```powershell
npm install
```

需要同时验证服务端时，开两个终端：

```powershell
npm run server
```

```powershell
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 会把 `/api` 代理到 `127.0.0.1:8787`。

只做课堂端离线调试也可以单独运行 `npm run dev`；此时页面使用浏览器本地缓存。

学生练习端：

```text
http://127.0.0.1:5173/practice
```

手机访问时，把主机换成办公室笔记本的局域网 IP，例如 `http://办公室笔记本IP:8787/practice`。

## 构建发布版

```powershell
npm run server:build
```

产物为 `release/xyz-server.exe`。前端静态资源和 SQLite 驱动已经嵌入程序，不需要另外安装 Node.js、Go 或数据库。

从 `release` 目录运行，数据会写入同目录下的 `data/xyz.db`：

```powershell
cd release
.\xyz-server.exe
```

第一次使用时，在这台服务器笔记本上打开 `http://127.0.0.1:8787`，按页面提示设置至少 8 位的教师密码。设置完成后，从局域网或 Cloudflare 域名访问都需要先登录教师工作台；学生练习入口 `/practice` 不需要教师登录。

默认监听所有网卡的 `8787` 端口：

- 本机访问：`http://127.0.0.1:8787`
- 局域网访问：`http://办公室笔记本IP:8787`
- 健康检查：`http://127.0.0.1:8787/api/health`

可配置环境变量：

```powershell
$env:XYZ_ADDR = ':8787'
$env:XYZ_DATA_DIR = 'D:\XYZData'
$env:XYZ_ADMIN_PASSWORD = '仅用于首次初始化的强密码'
.\xyz-server.exe
```

常用环境变量：

- `XYZ_ADMIN_PASSWORD`：首次启动时初始化教师密码；已有密码时不会覆盖。
- `XYZ_ADMIN_PASSWORD_RESET=1`：配合 `XYZ_ADMIN_PASSWORD` 重置密码，并让全部旧会话失效。
- `XYZ_BACKUP_DIR`：自定义备份目录，默认是数据目录下的 `backups`。
- `XYZ_BACKUP_INTERVAL_HOURS`：备份间隔小时数，默认 `24`。
- `XYZ_BACKUP_KEEP`：保留备份数量，默认 `30`。
- `XYZ_BACKUP_ENABLED=0`：关闭自动备份。
- `XYZ_UPDATE_REPO`：在线更新使用的 GitHub 仓库，默认 `kookoo2024/myUU`。
- `XYZ_UPDATE_ENABLED=0`：关闭在线更新；课堂局域网使用不受影响。
- `XYZ_UPDATE_DOWNLOAD_PROXY`：GitHub 下载受阻时使用的镜像前缀，默认 `https://gh-proxy.com/`；设为 `-` 可关闭镜像回退。

如果局域网无法访问，需要在 Windows 防火墙中允许 `xyz-server.exe` 的专用网络入站连接。

## 数据与备份

- 主数据文件：`data/xyz.db`
- SQLite 使用 WAL 模式，同目录可能出现 `xyz.db-wal` 和 `xyz.db-shm`
- 服务运行时会自动创建一致性快照，默认目录：`data/backups/`
- 每个快照都会执行 SQLite `quick_check`，校验失败的文件不会作为正式备份保留
- 默认每 24 小时备份一次并保留最近 30 份；首次启动会立即建立第一份备份
- 教师登录后点击主界面底部的“本机服务 · SQLite · 运维”，可在运维中心查看状态并点击“立即备份现在”
- 手工迁移或恢复前应先停止服务端，再复制整个数据目录
- 旧版单班级数据会在首次读取时自动包装为多班级工作区，不会丢失原名单

恢复备份时，先停止服务，把现有 `xyz.db`、`xyz.db-wal`、`xyz.db-shm` 移到安全位置，再把选定的 `backups/xyz-日期时间.db` 复制为 `xyz.db`，最后重新启动服务。

## Windows 开机自启

先生成发布版并测试能正常启动，再安装计划任务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\install-autostart.ps1 -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\install-autostart.ps1 -ConfigureFirewall
```

第二条命令会创建入站防火墙规则，请从“以管理员身份运行”的 PowerShell 中执行。只测试计划任务配置时，可以先运行 `-DryRun`。

默认在当前 Windows 教师账号登录后启动，并允许使用电池时继续运行。希望电脑一开机、无需登录桌面就启动时，以管理员身份运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\install-autostart.ps1 -RunAtStartup -ConfigureFirewall
```

运行日志位于数据目录下的 `logs/server-日期.log`，默认保留 14 天。若需要在关机重启后完全无人值守，仍应在 Windows 中配置自动登录或使用 `-RunAtStartup`。

## 一键在线更新

在线更新必须由 `deploy/run-server.ps1` 守护启动。直接双击 EXE 时，运维中心仍可检查 GitHub 和下载更新，但为了避免课堂中途无法恢复，不允许自动替换正在运行的程序。

正确安装计划任务后，教师在“本机服务”运维中心里按以下顺序操作：

1. 点击“检查更新”。
2. 发现新版本后点击“下载 v版本号”，服务会校验文件大小和 SHA256。
3. 点击“安装并重启”，守护脚本会备份旧程序并启动新版本。
4. 新版本通过健康检查并稳定运行 12 秒后才会标记成功；启动失败会自动回滚。

更新相关文件都在数据目录的 `updates/` 下：

- `prepared-update.json`：已下载并通过校验的更新。
- `pending-update.json`：等待服务退出后安装的更新。
- `last-update.json`：最近一次替换、成功或回滚记录。
- `rollback/`：替换前的旧程序备份。

在线更新只接受 `vX.Y.Z` 形式的正式 GitHub Release。客户端读取发布中的 `update.json` 和 `xyz-server-windows-amd64.exe`，发布中同时提供 `SHA256SUMS.txt` 供人工核验。发布标签必须与 `update.json` 中的版本完全一致。

更新程序会先直接连接 GitHub，TLS 或连接失败时再尝试镜像前缀。无论从哪个来源下载，安装前都必须与 GitHub 清单中的 SHA256 完全一致，否则拒绝安装。

发布新版本：

```powershell
git tag v0.3.1
git push origin v0.3.1
```

GitHub Actions 会执行测试、构建 Windows 程序并生成三个 Release 文件。不要手工修改 `update.json` 或文件名，否则客户端会拒绝安装。

当前 SHA256 机制可以防止下载损坏和普通中间篡改，但还不能替代 Windows Authenticode 代码签名。如果 GitHub 账号或发布流水线被完全控制，攻击者仍可能发布恶意程序；正式商用前应配置代码签名和发布账号的多重验证。

## Cloudflare Tunnel

仓库提供示例配置 `deploy/cloudflared.example.yml`。创建命名隧道并完成 DNS 绑定后，把配置中的 UUID、域名和凭据路径替换成实际值，再运行：

```powershell
cloudflared tunnel run 你的隧道名称
```

Tunnel 只需要连接到本机 `http://127.0.0.1:8787`，课堂大屏仍然可以直接通过局域网 IP 使用，不依赖公网。

公开 Tunnel 之前要先用本机地址完成教师密码设置。当前版本已保护教师数据和写接口，但还没有商业授权、题库售卖的许可校验，也没有学生提交成绩的防伪签名；在正式商业发布前仍不应把接口当作完整的付费产品边界。

## 验收命令

```powershell
npm run typecheck
npm run formula:check
npm run smoke
npm run practice:check
npm run visual
npm run server:test
npm run auth:check
npm run server:sync
npm run update:check
npm run server:build
npm run release:check
```
