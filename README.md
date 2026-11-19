# WeTalk · 自建即时通讯

一个类微信的即时通讯应用：账号注册登录、好友申请、通讯录、单聊、群聊、图片消息、实时推送、未读与已读。

- 后端：Node.js（无框架、零编译）+ SQLite（`node:sqlite`）+ WebSocket（`ws`）
- 前端：原生 JS 单页应用，微信风格移动端界面，PWA 可「添加到主屏幕」
- 出包：Capacitor 套壳 + GitHub Actions 云端构建，产出 `.apk` 与 `.ipa`

---

## 先说明：为什么这里不直接给你 ipa / apk

这不是偷懒，是两条硬性门槛：

| 目标 | 门槛 | 本机状况 |
|---|---|---|
| `.ipa` 能装到 iPhone | 必须有 **Apple 认可的代码签名**（开发者证书 + 私钥 + 描述文件），iOS 强制校验 | 没有 Xcode、没有 iOS SDK、没有你的证书私钥；iOS 也不允许运行 clang/swift 编译器 |
| `.apk` 能装到 Android | 必须有 **JDK + Android SDK + Gradle** 才能编译 | 这里是模拟 shell，`java`/`gradle`/编译器都不存在 |

目录里那个 `Demo.ipa` 是 `make_ipa.py` 造的结构合法空壳（脚本注释自己写着 "NOT signed … iOS will refuse to install"），只能用来测解析管线，装不上。

**所以本项目的做法是**：把应用本身做成真能跑的，再配好一条你在别处一键出包的流水线。见下面第 5、6、7 节。

---

## 1. 30 秒跑起来

```bash
cd wetalk
pnpm install          # 只装 ws 一个运行时依赖
pnpm start            # 默认 http://127.0.0.1:8080
```

打开浏览器访问 `http://127.0.0.1:8080`，注册两个账号（比如 `alice` / `bob`），
用两个浏览器窗口或一台电脑 + 一部手机，就能真的互相发消息。

可用环境变量：

```bash
PORT=9000 HOST=0.0.0.0 pnpm start   # 换端口 / 允许局域网访问
```

数据落在 `data/wetalk.db`（SQLite，自动创建）。

## 2. 端到端自测

```bash
pnpm test
```

覆盖：注册、鉴权、错误密码、搜索用户、好友申请与接受、单聊实时推送、历史消息顺序、
会话列表、群聊、群未读、已读归零、越权拦截。当前 21 项全部通过。

## 3. 装到手机桌面（最快「像 App 一样用」）

1. 手机与电脑同一局域网，电脑上 `HOST=0.0.0.0 PORT=8080 pnpm start`
2. 手机浏览器打开 `http://<电脑局域网IP>:8080`
3. **iOS Safari**：分享 → 「添加到主屏幕」
4. **Android Chrome**：右上菜单 → 「安装应用 / 添加到主屏幕」

装好后有独立图标、全屏无地址栏、支持离线打开界面（消息仍需联网）。这是当下**立刻可用**的形态。

## 4. 部署后端（出包前必做）

原生 App 里的 WebView 没有同源后端，必须给它一个公网地址。任选其一：

**A. Docker（推荐，带持久存储）**

```bash
docker build -t wetalk .
docker run -d --name wetalk -p 8080:8080 -v wetalk-data:/app/data wetalk
```

前面套一层 Caddy/Nginx 上 HTTPS 即可（WebSocket 需透传 `Upgrade`）。

**B. 直接跑**

```bash
HOST=0.0.0.0 PORT=8080 node server/index.js
```

**C. 星美 PaaS（Render / Railway / Fly.io）**：把仓库连上去，启动命令 `node server/index.js`，
**务必挂持久卷到 `/app/data`**，否则每次重启用户和消息都会丢。

部署完记下地址，例如 `https://wetalk.example.com`。

## 5. 出 Android APK

### 云端（不用装任何环境）

1. 把 `wetalk/` 目录作为仓库根推到 GitHub（`.github/workflows/build.yml` 已就位）
2. Actions → 「构建 WeTalk 安装包」→ Run workflow，`server_url` 填你的后端地址
3. 跑完在该次运行页面下载 `wetalk-apk` 产物 → 得到 `app-debug.apk`
4. 传到手机点击安装（需允许「安装未知来源应用」）

### 本地

```bash
pnpm install
export WETALK_SERVER_URL=https://wetalk.example.com
pnpm set-server
npx cap add android && npx cap sync android
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

发布到应用商店需要正式签名（`keytool` 生成 keystore + `gradle signingConfigs`）。

## 6. 出 iOS IPA

iOS 的死结是签名，绕不过去。三条路，按可行性排：

### 路 A：GitHub Actions 出「未签名 ipa」，再用你的 Apple ID 自签（免费，7 天有效期）

Workflow 里已包含 iOS job 会产出 `wetalk-ipa-unsigned`。
拿到后在本机用 [Sideloadly](https://sideloadly.io/) 或 AltStore，登录你自己的 Apple ID 重签并安装。
免费账号的限制：7 天需重签一次、最多 3 个 App。

### 路 B：自己的开发者账号 + Xcode（最正规）

有 Mac 和付费开发者账号（$99/年）时：

```bash
pnpm install
export WETALK_SERVER_URL=https://wetalk.example.com
node tools/set-server.mjs
npx cap add ios && npx cap sync ios
npx cap open ios      # 在 Xcode 里选 Team、真机运行或 Archive 导出 ipa
```

### 路 C：云构建服务

Codemagic / EAS Build / Xcode Cloud 都能在云端 Mac 上编译并签名，只需上传证书与描述文件。

> 说明：本项目用的是**远程页面壳**模式（`server.url` 指向你的后端）。这类应用上 App Store 审核大概率被拒（4.2 最低功能要求），但自签安装、企业内部分发完全正常。

## 7. App 里怎么连服务器

两种方式，任选：

1. 构建时注入：`WETALK_SERVER_URL=https://... node tools/set-server.mjs`，App 会直接加载你的站点
2. 运行时配置：登录页底部点「服务器」，填入后端地址，保存在本机

方式 2 让同一个安装包可以连不同后端，也方便调试。

---

## 功能清单

- [x] 注册 / 登录（scrypt 加盐哈希，Bearer token 会话）
- [x] 用户搜索、好友申请、接受 / 拒绝、双向好友
- [x] 单聊：文字、表情（系统输入法）、图片（上传后发送）
- [x] 群聊：创建、群成员、系统提示消息
- [x] WebSocket 实时收发，断线自动重连
- [x] 会话列表：最后一条消息、时间、未读角标
- [x] 已读回执、对方「正在输入」
- [x] 历史消息分页拉取（游标 `before`）
- [x] 微信风格 UI：底部四 Tab、气泡、头像、时间分隔
- [x] PWA：可安装、离线打开外壳
- [x] 越权防护：非会话成员读写均返回 403
- [ ] 朋友圈 / 视频通话 / 语音条 / 消息撤回（未做，属后续扩展）

## 项目结构

```
wetalk/
├── server/
│   ├── index.js      HTTP + 静态文件 + WebSocket 升级
│   ├── api.js        REST 路由与业务逻辑
│   ├── db.js         SQLite schema 与查询
│   └── auth.js       密码哈希、token、校验规则
├── public/
│   ├── index.html    应用外壳
│   ├── app.js        路由、渲染、实时消息、交互
│   ├── style.css     微信风格样式
│   ├── sw.js         Service Worker
│   ├── manifest.webmanifest
│   └── icon-*.png
├── tools/
│   ├── test-e2e.mjs  端到端测试
│   ├── gen_icons.py  生成 PNG 图标（纯标准库）
│   └── set-server.mjs 注入后端地址
├── .github/workflows/build.yml   云端出 apk / ipa
├── capacitor.config.json
└── Dockerfile
```

## API 速查

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册，返回 token |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET / PATCH | `/api/me` | 我的资料 |
| GET | `/api/users/search?q=` | 搜索用户 |
| GET | `/api/contacts` | 好友与申请 |
| POST | `/api/contacts` | 发起好友申请 |
| POST | `/api/contacts/accept` `/reject` | 处理申请 |
| GET / POST | `/api/conversations` | 会话列表 / 新建单聊或群聊 |
| GET | `/api/conversations/:id/messages?before=` | 历史消息 |
| POST | `/api/conversations/:id/messages` | 发消息 |
| POST | `/api/conversations/:id/read` | 标记已读 |
| POST | `/api/upload` | 上传图片（base64，≤6MB） |
| WS | `/ws?token=` | 实时通道 |

## 安全与边界

- 密码用 `scrypt` 加盐存储；token 存 SQLite，退出即失效
- 所有 SQL 走参数化查询；消息渲染用 `textContent`，避免 XSS
- 上传只接受 png/jpeg/webp/gif，限 6MB，文件名由服务端生成
- 明文 HTTP 仅适合内网；公网部署请务必启用 HTTPS（否则 token 会明文传输）
- 单机 SQLite 适合个人/小团队；要横向扩展需换 Postgres 并把在线状态移到 Redis

## 已知限制

- 没有端到端加密（消息在服务器是可读的）
- 没有消息撤回、引用、语音、视频、朋友圈
- 在线状态未做多端同步，`last_seen` 只有秒级精度
- 未做限流：公网暴露前建议加反向代理层限速
