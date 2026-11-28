# AI Live3D 桌宠

AI 驱动的 3D 桌面宠物：VRM 模型 + Electron 透明窗口 + Three.js 渲染，支持摸头 / 拖拽 / 戳 / 双击等手势互动，可点击穿透不挡桌面。架构上渲染层与 Electron 壳完全解耦，同一套代码桌面与手机浏览器共用——桌面端起局域网服务，手机扫码即让桌宠「跑进」手机屏幕（触摸手势全兼容），WebSocket 双向同步支持手机端换模型/换动作，还能一键把桌宠在电脑和手机之间「赶来赶去」。

- Gitee 仓库：<https://gitee.com/jsy96/live3d>
- 当前版本：**v1.0.261128-1**（版本号唯一来源：`main/version.js`，显示于托盘菜单/tooltip 与 `?debug=1` 角标）

## 更新记录

- **v1.0.261128-5**（2026-11-28）
  - **多手机定向漫游（老金需求：多台 iPhone 之间转来转去）**：每台手机获得身份（`hello` 携带 localStorage 持久化的 `Phone·xxxx` 名，电脑端选择器可区分）；「留在这里」**只发给点的那台**（`petLocation` = 手机 client id），其余手机瞬时收起副本——多台同屏不再分身；持有桌宠的手机断线 → 桌宠自动回家（按 id 精确判定）；托盘 `Send pet to phone` 在多台在线时弹**原生选择器**选目标；手机间可直接对转（A 的桌宠被 B 要走，无需先回电脑）
  - **修复：后台/被遮挡页面的跑出动画冻结**——浏览器对不可见页面暂停 rAF，桌宠永远跑不走；现在 `document.hidden` 时收到 exit 直接收起（跳过动画），真机上锁屏/切走的手机同样正确
  - 跨网络（不限同一局域网）方案：**Tailscale**（PC 与各 iPhone 各装一份、同一账号登录即组网，手机访问 `http://100.x.y.z:31790`，全部功能原样可用；Tailscale 网卡 IP 会自动出现在扫码窗口的候选地址里）；或自建公网中继（工程量大，未实现）
  - 实测：`test-lan-sync.mjs step4` 双客户端协议回归（B 要→A exit/B enter，A 要回→B exit/A enter）；双 Edge 真窗口双开——B 点📱后 B 页面有桌宠、A 页面只剩背景（CDP 合成截图视觉确认）、日志 `[roam] pet handed off to Phone·2vjm` 精确到设备名
- **v1.0.261128-4**（2026-11-28）
  - **手机端菜单交互修复（老金实测反馈）**：
    - **点外面自动关菜单**：控制台打开时全屏半透明遮罩（`.web-backdrop`，z-index 位于 dock 与面板之间），点遮罩/空白处/桌宠即收起；✕ 保留、Esc 兼容；选完模型也自动关（选动画保留方便连试）
    - **删除顶部「点此召回」胶囊条**：dock 常驻 📱 按钮已覆盖召回功能，胶囊条冗余——`web-recall` 元素/CSS/`setPetAway` API 整链路移除；桌宠在电脑上时手机端召回一律走 📱 按钮
  - 实测（CDP 真页面）：遮罩开/关、✕ 关、选模型自动关全通过；`.web-recall` 元素数 0；dock 三钮（📱/🖥/☰）就位
- **v1.0.261128-3**（2026-11-28）
  - **手机端 UI 精简（老金实测反馈四条）**：
    - **漫游按钮独立常驻**：「📱 留在这里」「🖥 送到电脑」从控制台移到右下角悬浮 dock（竖排三圆钮：📱 / 🖥 / ☰），随时可点不用开菜单
    - **任意角度旋转**：手机上**空白处横向拖动** = 连续旋转桌宠（0.45°/px，拖身体仍是移动位置），朝向实时同步到电脑和其它手机（`facing:report` 现在对称回传桌面渲染层）；控制台的固定角度五档按钮删除
    - **控制台大幅缩短**：漫游/朝向区块移出后，模型改**横向滑动药丸**（5 个不再占五行），126 个动画改**折叠分组**（默认收起只显示组名+数量，点按展开，筛选时自动展开匹配组）——菜单默认高度从约 2500px 缩到约 300px
    - **背景去盒子感**：深色渐变改柔和纵向过渡 + 脚下加淡舞台光晕（`body.web::after` 径向渐变），桌宠更像站在环境里而非窗口中；注意网页应用**无法悬浮在手机壁纸/桌面上**（iOS 沙箱限制，仅原生 App 可做系统级 overlay）；**今天更新前添加的主屏幕图标会以浏览器模式打开，删掉重新添加才全屏**
    - 修复：初始模型/动画的勾选高亮在控制台创建前错过 select 调用（picker 创建后补一次初始 select）
  - **排错记录（工具坑，非产品 bug）**：桌面端"看不见桌宠"为假象——① PowerShell `[ref]` 静态字段不回写导致窗口矩形读成 0×0；② GDI `CopyFromScreen` 抓不到 Electron 透明窗口的像素（抓到窗口后面的内容）。用 **CDP `Page.captureScreenshot`**（渲染器自合成）验证桌宠渲染正常；新增 `scripts/cdp-shot.mjs`（CDP 页面合成截图）、`scripts/check-pet-rect.ps1`（窗口矩形检查）
- **v1.0.261128-2**（2026-11-28）
  - **PWA 化（手机端去浏览器壳）**：`assets/manifest.webmanifest`（standalone/主题色/192+512 图标，含 maskable）+ `assets/sw.js`（网络直通的最小 service worker，桌宠天然依赖局域网 PC 无离线可缓存，SW 仅为满足安装条件）+ `index.html` iOS 元标签（`apple-mobile-web-app-capable`/status-bar/title/touch-icon）+ 渲染层 web 模式注册 SW；LAN 服务新增 `/manifest.webmanifest`、`/sw.js`、`/icon-{192,512}.png` 路由，图标由 `assets/icon.png` (256) LANCZOS 放缩生成
  - **效果分平台**：**iPhone**（Safari 分享 → 添加到主屏幕）＝真·独立全屏应用，无任何浏览器 UI（iOS 不要求 HTTPS）；**Android**（Chrome/Edge「安装」需 HTTPS，局域网 http 不满足）＝「添加到主屏幕」得到快捷方式，打开仍带地址栏——彻底去壳需打包真 APK（Capacitor 包同一套网页代码，需另装 Android SDK），按需再做
  - 实测：CDP 真浏览器确认 `swRegistered: true, swState: activated`、manifest 关联正确、四个新路由 200（MIME `application/manifest+json`/`image/png`）；桌面端 file:// 加载不受影响（缺 manifest 仅控制台警告）；iOS 真机表现待老金验收（元标签为 Apple 官方标准机制）
- **v1.0.261128-1**（2026-11-28）
  - **WebSocket 实时同步（四期第二片）**：LAN 服务新增 `/ws` 端点（`ws` 包，零传递依赖）——桌面端换模型/换待机动画/转身/`--play` 单次动作**实时广播到所有连接的手机**；滚轮转向经 `facing:report` 上行同步。协议见 `src/sync/roaming.js` 头注（`state`/`play`/`pick`/`roam` 四类消息，字段缺省=不变）
  - **手机端控制台**：网页右下角 ☰ 悬浮按钮打开「桌宠控制台」（`src/web-picker.js`）——漫游按钮 / 朝向五档 / 模型列表 / 126 个待机动画分组+实时筛选，**选择经 WS 上行到桌面应用后广播回传**，所有设备收敛到同一选择（勾选高亮跟随）；模型按 basename 去重防止回声重载
  - **真·漫游交接（PET_TRANSFER）**：托盘 `Send pet to phone` / 手机「留在这里」/「送到电脑」/ CLI `--show` 召回——源设备播**跑出动画**（0.9s ease-in 加速跑出左缘 + 前倾），目标设备播**跑入动画**（右缘 ease-out 跑入），桌面窗口随之隐藏/恢复。实现于 `viewer.petRoot` 中间层（animator 每帧写 `scene.position`，漫游位移独立走 `petRoot.position.x` 互不打架）；桌面跑完经 `roam:exited` IPC 回报（2.5s 超时兜底）；**最后一只手机断开时桌宠自动跑回电脑**；手机端收起时顶部出现「点此召回」胶囊条
  - 实测（CDP 驱动真 Edge 窗口当手机）：初始 state 推送→页面自动跟随桌面切到 AvatarSample_B；控制台点 Seed-san→桌面换模→广播回传→勾选移动；「留在这里」→桌面窗口隐藏+手机渲染桌宠；`--show` →手机收起+召回条出现+电脑恢复；WS 协议回归脚本 `scripts/test-lan-sync.mjs` 三步全过（含断线自动回家）；无头 Edge 的 virtual-time 与持续 rAF 互斥导致页面假死是**测试工具伪影**，真窗口全链路正常（此坑已在脚本注释记录）
  - 新增开发工具：`scripts/test-lan-sync.mjs`（假手机 WS 协议测试）、`scripts/cdp-eval.mjs`（往真页面注入 JS）、`scripts/shot-window.ps1`（按标题+进程名截窗口）

- **v1.0.261127-6**（2026-11-27）
  - **手机网页端（四期第一片）：桌宠跑进手机屏幕**——主进程内置局域网 HTTP 服务（`main/lan.js`，纯 `node:http` 零新框架依赖），把桌面端**同一份** `dist/bundle.js` 渲染层原样供给手机浏览器：`http://<电脑IP>:31790` 打开即见同款桌宠（默认模型自动加载 + 待机/反应动画全量可用），触摸交互原生兼容 Pointer Events（摸头滑动 / 拖动模型 / 戳 / 双击欢呼），网页模式自动切深色渐变背景（桌面透明窗口不受影响）
  - **API 与安全**：`/api/models`、`/api/animations`、`/api/version` 三个 JSON 接口（`src/platform.js` 浏览器分支自动 fetch，纯本地打开则降级文件选择）；静态文件仅白名单路由（index/styles/bundle），模型/动画目录按扩展名白名单 + basename 解析（实测路径穿越 `..%2F` 404、POST 405、白名单外 404）
  - **扫码配对**：托盘菜单新增 `LAN server (phone access)` 开关 + `Show QR code`；CLI `--lan <on|off|toggle>` / `--qr`（`--qr` 自动拉起服务）。QR 窗口由 `qrcode` 包生成 SVG（新增运行时依赖，缺包时降级为纯 URL 文本）；多网卡机器用 **UDP connect 路由探测**（不发包）把「能出网的网卡」IP 排首位——本机 3 个 IPv4 中实测选中 `192.168.3.27`（另两个是 VMware 虚拟网卡），其余 IP 列在二维码下方
  - **手机端适配**：viewport meta（禁缩放）、`touch-action: none` + `overscroll-behavior: none`（手势不被浏览器滚动劫持）、自研双击判定（`dblclick` 在移动浏览器不可靠，350ms/35px 内两次快速 tap = 欢呼，桌面行为不变）
  - 实测：无头 Edge 充当「假手机」加载 `http://127.0.0.1:31790`——`body.web` 生效、three.js r170 WebGL 建立、**15MB VRM 经 HTTP 下载加载成功**（设置面板隐藏即模型就绪）；CLI 全命令（`--lan off` 连接拒断 → `--qr` 自动重启服务 → `--lan toggle` 循环）、chromium argv 重排后 `--lan ... off` 仍正确配对；QR 页面渲染视觉验证（二维码/URL/深色卡片）；桌面端冷启动/`--play` 无回归
  - 遗留（四期下一片）：WebSocket 状态同步（`src/sync/roaming.js` 的 `PET_TRANSFER` 跑出/跑进迁移动画）、手机端换模型/换动画的页面内选择器

- **v1.0.261127-5**（2026-11-27）
  - **移除摄像头动捕功能**（用户决策）：v19 引入的「MediaPipe Pose 摄像头动捕」经两轮实测调优（VRM0 朝向系修复后）手臂姿态仍不自然，按老金要求整体下架——删除 `src/core/mocap.js`、`src/preview{.html,.js}`（骨骼预览窗）、`scripts/test-mocap-solver.mjs`、`assets/mediapipe/`（wasm+模型 24MB）、`@mediapipe/tasks-vision` 依赖；右键菜单 Camera Mocap/Mirror/Skeleton View/Camera 区块、CLI `--mocap`/`--camera`、全部 `mocap:*` IPC、`$app/` 协议前缀、media 权限放行、CSP wasm/media 项、动捕徽标一并还原。`VRMAPlayer.play()` 保留 fadeIn 起播改进（通用体验优化，与摄像头无关）。代码完整保留在 git 历史（v1.0.261126-19 ~ v1.0.261127-4），日后想恢复 `git revert` 即可
  - 实测：重建后冷启动正常（模型/待机/反应动画加载、单窗口、无摄像头占用、无 mocap 日志）
- **v1.0.261127-4**（2026-11-27）
  - 修复：**VRM 0.x 模型动捕前后/左右全反**（用户实测「双手在身前，桌宠总放身后」）——根因：`VRMUtils.rotateVRM0` 的 180° 校正写在 `vrm.scene.rotation` 上，**永远到不了骨骼局部空间**；VRM 0.x 模型（AvatarSample 系默认模型）的 normalized 骨骼静息帧实为「面朝 $-Z$、左手 $-X$」，而解算器按 VRM1 惯例（面朝 $+Z$、左手 $+X$）映射追踪方向 → 一切含前后/左右分量的目标全部镜像：手臂前伸变背后、左右手互换。修复：`attach()` 按 `vrm.meta.metaVersion === '0'`（与 rotateVRM0 同款判定）设朝向符号 `orient`，地标映射改为 `scene.x = ±orient·mp.x`（随镜像）、`scene.z = -orient·mp.z`；换模型自动重映射；attach 落日志 `model frame: VRM0/VRM1`；躯干/蹲起不受影响（纯 y 分量，此前也正因此只有四肢前后错）
  - **预览窗口改纯骨骼视图**：不再显示摄像头画面（用户要求）——预览页彻底移除 `<video>` 与第二路 `getUserMedia`（预览零摄像头占用，`media` 权限、选摄像头同步、`pagehide` 释放逻辑一并删除；`setMocapCamera` 不再向预览窗广播），深色底（#15171c）+ 4:3 letterbox 骨骼绘制（镜像 X 与桌宠镜像模式一致），线宽/关节点半径随窗口尺寸自适应
  - 验证：解算器回归测试全过（mock 无 meta 走 VRM1 分支不变）；重启实例日志确认 `model frame: VRM0 (-Z front, mirrored mapping)` 生效；预览窗口截图视觉确认纯深色背景无摄像头画面、状态条「未检测到人体」正常；**前后方向修复需真人上镜验收**（当前默认模型 AvatarSample_A 即 VRM0）
- **v1.0.261127-3**（2026-11-27）
  - **摄像头选择器**：此前动捕写死系统默认摄像头（本机 3 个视频设备时会开错）。右键菜单 mocap 区块新增 `Camera` 子菜单——`Default (auto)` + 枚举出的 videoinput 设备列表（勾选单选；设备标签需 Chromium 授予过媒体权限后才可见，故首次动捕启动后列表才填充，未启动时显示提示项）；热插拔监听 `devicechange` 自动刷新菜单
  - **切换即生效 + 持久化**：菜单或 CLI `--camera <名称子串>` 选择后——追踪流实时重开（landmarker 不重建，`deviceId: {exact}` 打开，选定设备失效自动回退默认并同步状态）、预览窗口显示流同步重开（预览永远与追踪同一摄像头）、选择写入 `%APPDATA%/ai-live3d/mocap-camera.json` 跨重启生效（渲染层启动时 `getMocapCamera` 恢复）；CLI 匹配规则 = 设备标签忽略大小写子串（如 `--camera integrated`、`--camera 4k`、`--camera obs`），`default/auto/none` 恢复默认，未匹配落 `[cmd]` 日志并列出已知设备
  - 实测：枚举上报 `4K AutoFocus Webcam | Integrated Camera | OBS Virtual Camera` 三设备；`--camera integrated` 切换 → 渲染层流重开 + 持久化文件落盘；`--camera default` 恢复；解算器回归测试全过。注：验证时重启了正在运行的旧构建实例（新构建需重启生效）
- **v1.0.261127-2**（2026-11-27）
  - **动捕骨骼预览窗口**：动捕开启时自动弹出置顶小窗「动捕预览 · Mocap Skeleton」（400×330，可缩放），显示摄像头画面 + 半透明暗色遮罩 + 叠加绘制的 33 关键点骨骼（MediaPipe 经典样式：青色骨连线、白色关节点、可见度 <0.55 关节转红、<0.25 不画），镜像显示与桌宠镜像模式一致；左下角状态条显示「● 跟踪中 · N/s」/「未检测到人体」（1.5s 无数据判定丢失）；关闭动捕窗口自动收起
  - **数据通路零侵入**：追踪渲染层把**归一化图像坐标**关键点（与摄像头画面几何一致，区别于解算器用的世界坐标）按检测帧率经 `mocap:landmarks` IPC → 主进程转发 → 预览窗口（Float32Array(99) 结构化克隆，~1KB×30/s，无像素传输）；预览窗口自开一路**仅显示用**摄像头流（不参与推理，视频帧不走 IPC，追踪管线完全不受影响），第二路流打开失败时退化为纯黑底骨骼显示
  - **交互**：右键菜单 mocap 区块新增 `Skeleton View` 勾选项（仅动捕运行时可用，勾选=窗口开着）；直接点窗口 X 关闭只收窗口不停动捕，下次动捕启动仍会自动弹出；`pagehide` 时释放预览流摄像头
  - 构建：`npm run build` 现产出双 bundle（`dist/bundle.js` + `dist/preview-bundle.js`，后者复用 `@mediapipe/tasks-vision` 的 `POSE_CONNECTIONS` 骨架拓扑免硬编码）；`make-portable.bat` 同步补拷 preview-bundle.js
  - 实测：`--mocap on` 冷启动 → 预览窗口自动弹出（Win32 枚举确认 + 截图视觉验证：摄像头画面/暗色遮罩/「未检测到人体」状态条均在，摄像头前无人故无骨骼线——骨骼渲染待真人上镜验收）；`--mocap off` → 窗口自动关闭；`--quit` 干净退出
- **v1.0.261127-1**（2026-11-27）
  - 修复：**默认启动背对用户**——v14 把 `updateFacing` 的旋转目标改到 `vrm.scene.rotation.y` 后，每帧把 `VRMUtils.rotateVRM0` 写在那里的 π 校正（VRM 0.x 模型朝 -Z，需 +180° 才面向摄像头；默认启动模型 AvatarSample_A 即 VRM 0.x）直接覆盖成 `facing.current`（默认 0），校正失效 → 背对。VRM 1.0 模型（如 Seed-san）本就无校正不受影响，此前混测未暴露
  - 修复方式：`viewer.setBaseYaw()` 在 `loadVRM` 的 `rotateVRM0` 之后记录基准朝向，`updateFacing` 改为 `baseYaw + facing.current` 叠加合成（转台语义不变：0 = 正面、180 = 背面，滚轮/`--facing` 均在其上叠加）；换模型时 `baseYaw` 随新模型重取
  - 验证：Win32 `GetWindowRect` 定位窗口物理矩形截图（首跑用工作区 DIP 坐标换算被 DPI 缩放带偏截到了背景编辑器，改按句柄取物理矩形），视觉模型确认**正脸朝向观察者**（可见眼睛/微笑/领结）
- **v1.0.261126-19**（2026-11-26）
  - **摄像头身体动捕（Camera Mocap）**：桌宠实时模仿摄像头前你的身体动作——躯干倾斜、头颈转动、双臂/手肘、双腿/膝盖（可见时）逐段跟随， hips 高度经站立基准校准后整体下沉/上移（蹲下/起跳）。新增 `src/core/mocap.js`（~450 行）：MediaPipe `PoseLandmarker`（`@mediapipe/tasks-vision` 1.2.3，GPU delegate 失败自动回退 CPU）跑 VIDEO 模式，取 `worldLandmarks`（米制 3D 关节点）→ EMA 平滑 → 映射进 VRM 场景空间（**镜像模式**默认开：桌宠 = 你的镜面影像；右键菜单 `Mirror Mode` 可切同侧模仿）
  - **重定向解算器（aim solver）**：不依赖 Kalidokit，方向约定全部从实际骨架测量——attach 时按 normalized 骨架的 T-pose 静息位置计算每根骨骼的静息指向，每帧用「父级当前坐标系下 setFromUnitVectors(静息方向 → 追踪方向)」逐骨骼解算（按层级顺序累积父级旋转，与 A_POSE 手臂正负号等经验约定无关）；躯干倾角按同一场景轴拆 35/35/30 分配到 hips/spine/chest（同轴分角精确合成，总倾角钳制 0.5 rad）；头部用完整正交基（Y=颈向、Z=鼻-耳中点面朝向）捕捉偏航/俯仰/侧倾；四肢逐段独立 cap（臂 2.7 / 腿 1.35 / 颈 0.55 rad）；关键点可见度 <0.55 的肢体按置信度淡出到自然下垂，不冻结
  - **资源与加载路径**：`assets/mediapipe/`（`wasm/vision_wasm_internal.{js,wasm}` + `pose_landmarker_full.task` 9.4MB，从 storage.googleapis.com 断点续传下载，入 git）；wasm loader 走相对 file:// URL（`<script>` 同源加载），.task 模型走 `live3d-model://` 协议（新增 `$app/` 前缀按应用根解析相对路径，renderer 不必知道绝对路径）；CSP `script-src` 增 `'wasm-unsafe-eval'`、新增 `media-src`；主进程 `setPermissionRequestHandler/CheckHandler` 自动放行 `media` 权限（透明窗口没有 Chromium 原生提示 UI）
  - **与动画系统互斥整合**：`Animator` 新增动捕独占分支（眨眼层保留叠加），`beginMocap()/endMocap()` 干净进出（打断反应动画、VRMA 停止/淡入恢复——`VRMAPlayer.play()` 改为 fadeIn 起播消除姿态跳变）；动捕期间 poke/双击欢呼/摸头/`--play`/换待机动画全部让位不抢骨骼，拖拽移动窗口仍可用（动捕跟随不受影响）；换模型自动重建动捕 rig（`mocap.attach(vrm)`）持续跟踪
  - **控制入口三合一**：右键菜单新增 `Camera Mocap`（勾选 = 实际运行态）+ `Mirror Mode`；CLI `--mocap <on|off|toggle>`（复用 second-instance 通道）；窗口右上角红色「🎥 动捕中」徽标（点击关闭，已并入点击穿透交互区域）。摄像头启动失败（无摄像头/权限拒绝）弹面板提示 6 秒自动隐藏并回报关闭态
  - **解算器数学自测**：`scripts/test-mocap-solver.mjs`（`npm run test:mocap`，esbuild 转 ESM 后 node 运行）——合成 T-pose 骨架 + 注入合成关节点，断言每根驱动骨骼的**世界指向**收敛到追踪向量：T-pose/举臂 45°/手臂前伸/躯干倾斜合成/头部偏航 10 项全部通过（误差 ≤0.1°，躯干首跑失败为测试数据构造错误，修正后 0.0°）
  - 实测：`electron . --mocap on` 冷启动全链路通过（argv 抗重排解析 → 摄像头 640×480 → wasm+模型加载 → GPU delegate → `tracking started`），`--quit` 干净退出无渲染层报错；动作跟随质量需真人上镜验收（1.5m 画幅、上半身入镜即可，腿不可见时自动下垂）
- **v1.0.261126-18**（2026-11-26）
  - **便携包分发**：新增 `scripts\make-portable.bat`——构建 renderer → 暂存精简运行时（主进程只依赖 electron 自带 Node，`three`/`@pixiv/*` 已打进 `dist/bundle.js`，运行时仅需 `node_modules\electron\dist` 二进制）→ Compress-Archive 压缩，产出 `dist\ai-live3d-portable-<版本>.zip`（实测 174MB）。**收件人无需安装 Node.js，解压双击 `start-pet.bat` 即用**，CLI 遥控命令同样可用；已按「清空 PATH 模拟无 Node 机器」实测：冷启动、`--play`、`--quit` 全通过。注意：便携包与本仓库实例同名 `ai-live3d`，同机同时只能跑一个（单实例锁互抢）；zip 含第三方模型/动画素材，公开分发前需确认素材许可（VRoid/pixiv 示例模型、SillyTavern 生态动捕转换件）
  - 默认待机动画改为 `dance_2.vrma`（`DEFAULT_ANIMATION` 常量，文件缺失时回退 `animations/` 排序第一个）
  - 右键菜单移除 `Facing` 区块（滚轮悬停转向已覆盖该功能，五档菜单冗余）；CLI `--facing` 命令保留
  - 打包脚本坑位记录：`findstr "APP_VERSION"` 会同时命中 `module.exports = { APP_VERSION }` 行，`for /f` 第二次迭代把版本号覆盖成 `{ APP_VERSION }` 字面量——改 `findstr /b /c:"const APP_VERSION"` 行首锚定修复
- **v1.0.261126-17**（2026-11-26）
  - **命令行遥控通道（CLI remote control）**：利用单实例机制把「再次启动的 argv」变成遥控命令——`second-instance` 事件携带的 argv 经 `parseCliArgs` 解析后转发（首启参数排队到渲染层 `app:ready` 再投递，消除竞态）。命令集：`--show` / `--hide` / `--quit` / `--devtools` / `--model <名称或绝对路径>` / `--animation <名称|none>` / `--play <名称>`（单次播放任意 VRMA，播完回待机）/ `--facing <角度>`；名称匹配规则 = 去扩展名忽略大小写，先精确后子串；`--play` 别名 poke/surprise→surprise.vrma、hello/happy→hello.vrma；所有命令（含原始 argv）与匹配失败均落日志 `[cmd]`
  - **argv 抗重排解析**：实测 second-instance 的 argv 会被 chromium 重排（`registerSchemesAsPrivileged` 触发进程重拉，`--play surprise` 被拆成无值开关 + 插入 `--allow-file-access-from-files`/`--secure-scheme=...` 等噪声 + `surprise` 降级为位置参数）。解析器按「跳过噪声开关与 exe/app 路径 + 孤儿位置参数 FIFO 配给等待取值的开关」还原（chromium 两侧各自保序，FIFO 配对精确重建），多开关组合（`--play x --facing 90`）实测正确
  - `VRMAPlayer` 支持无待机动画的反应专用模式：`loadReaction` 无 mixer 时自动 `rebind`，`rebind` 不再因无 idle 提前返回（mixer 始终建立）——`(None)` 手写待机下 `--play` 也能用；`app.js` 换模型时对 reaction-only 播放器同样重绑
  - renderer 新增 `animations:playOnce` IPC（`playOnce`：以 `skill` kind 装载单次 clip、`setVRMA` 重联动画状态机、模型未就绪时排队）与 `app:ready` 信号；`start-pet.bat` 透传 `%*` 参数
  - 新增 Claude Code skill：`.claude/skills/live3d-pet/SKILL.md`——会话里说「让桌宠跳个舞/打个招呼/换个模型」即可通过本通道遥控桌宠（含命令表、匹配规则、日志验证与排错）
  - 实测：冷启动多开关（`--play surprise --facing 90`）、second-instance 全命令集（scrambled argv 还原）、换模型后 `--play`（animator 重联）、`--quit` 干净退出，全部通过
- **v1.0.261126-16**（2026-11-26）
  - ** hips 高度机制重构（治本）**：读 three-vrm-animation 源码确认 VRMA hips 轨道语义为「绝对高度 × (目标restY/动画restY) 直接写入 hips 骨骼」，但 mixer 的属性绑定与 normalized 机制组合下行为混乱（实测待机时 hips 被压到 0.296m、反应动画恢复 0.896m——点击瞬间上移 0.6m 即「突然站立+上移」的真相）。重构：`VRMAPlayer._extractHipsHeight` 把 hips 位移轨道从 clip 中摘除（mixer 不再写 hips 骨骼），高度数据经「首帧归零 + 漂移钳制」后由 Animator 每帧采样、以 **`vrm.scene.position.y` 整体平移**跟随（阻尼 6/s）——坐下整体下沉、跳起整体上移、脚与地面相对关系保持，所有状态同一阻尼通道零跳变
  - 待机循环不参与高度跟随（实测 ChatVRM idle_loop 的 hips 轨道含深度下蹲段且语义不一致，恒定贴钳制下界）；只有反应动画采样高度
  - 诊断基建：`scripts/test-bvh-tracks.mjs`（BVHLoader 行为打印）、渲染层 uncaught/unhandledrejection 捕获带堆栈、一次性 [diag] 日志
- **v1.0.261126-15**（2026-11-26）
  - 修复：**反应动画播放时整个桌宠上移一段距离**——BVH 骨架 rest 定义高度与动捕 MOTION 实际站姿高度不匹配，转换出的 hips 位移轨道带恒定偏移，播放全程整体悬空。`_pinHipsToCenter` 新增「首帧归零」基准（对所有来源 VRMA 通用）：反应动画起始姿势与待机对齐，后续跳起/蹲下的相对起伏完整保留，恒定偏移消除
- **v1.0.261126-14**（2026-11-26）
  - **反应动画平滑过渡**：mixer 注册 `finished` 事件（此前 LoopOnce 播完无人接管，状态机卡在 REACTION 定格在站姿——「点击突然站立」的主因）；待机↔反应全部切换改为 0.2s 交叉淡入淡出，待机动画时间线连续不重置；被互动中断时反应停止、待机渐入恢复
  - **新增朝向控制**：鼠标滚轮悬停在桌宠上滚动 ±45° 步进转向（正面/斜侧/侧面/斜背面/背面循环），右键菜单 `Facing` 区块五档直达；角度经阻尼平滑插值，头发弹簧骨骼随转身自然摆动
  - 修复：`updateFacing` 误把旋转写在 VRM 实例上（正确目标是 `vrm.scene`），导致每帧异常触发帧循环保护清空动画、桌宠定格站姿
  - 说明：当前动作库主要来源为 SillyTavern 生态的 BVH 动捕转换件（非 VRoid Hub 原生），漂移/接地质量参差；VRoid Hub 原生 VRMA 需登录手动下载后放入 `animations/`
- **v1.0.261126-13**（2026-11-26）
  - 修复：**hips 高度被钉死导致接地感丢失**（v12 的 ±0.15m 钳制把臀部钉在静息高度，坐下/躺下时腿在动而脚悬空）——动捕数据本身物理一致（地板不动、臀部随腿部姿势下沉），垂直位移应完整保留。垂直钳制放宽为 [-0.6, +0.25] m：坐下（约 -0.25m）、躺下（约 -0.5m）的合法位移完整保留，只拦截动捕漂移（部分 BVH 轨道随时间漂移数米）造成的出画。轨道级与帧级两层同步放宽
  - 权衡：漂移严重的动作仍会被钳在边界（脚插进地面、上半身可见），属数据质量问题；建议优先使用 VRoid Hub 等原生 VRM 动作
- **v1.0.261126-12**（2026-11-26）
  - 修复：**换部分动作后桌宠出画消失**（日志证实动画加载成功无报错，是模型被移出画面）——BVH 源动作的 hips 垂直位移经 VRMA 播放适配会被放大（源模型与目标 VRM 体型比例差），坐下/大幅起伏类动作把模型沉出窗口。双层钳制：轨道级 `_pinHipsToCenter` 对 Y 位移 clamp ±0.15m + 帧级 `_clampHipsHeight()` 以模型实际 hips 静息高度为锚每帧夹紧。副作用：坐下类动作的臀部高度会被压到 ±0.15m，呈现为半蹲悬空而非落座
  - 此前诊断结论：换动作加载从未失败、双击 bat 从未失效——「消失/打不开」均为模型出画导致窗口全透明产生的错觉
- **v1.0.261126-11**（2026-11-26）
  - `second-instance` 唤醒行为落日志（`appendLog` 上移主模块共用），确认「双击 bat = 唤醒已有实例」链路一直正常
- **v1.0.261126-10**（2026-11-26）
  - 修复：**换动画后桌宠"消失"**——某动作 VRMA 数据在播放时抛异常，帧循环无保护导致 rAF 死亡（透明窗口内容空白 = 看不见桌宠），冻结实例又占着单实例锁使再次双击 bat 只唤醒不可见窗口。帧循环每一步加 try/catch：animator 出错自动丢弃 VRMA、`forceIdle()` 回手写待机（桌宠永不消失），rAF 无条件继续
  - 修复：换动画前先 `setState('idle')` 中断正在播的反应动画，避免 mixer 替换后 animator 卡死在 REACTION 状态
  - 新增日志落盘：renderer console / `render-process-gone` / `unresponsive` 写入 `ai-live3d.log`（项目根，不入 git）——bat 分离启动看不到 stdout，此后所有启动方式都可排查
- **v1.0.261126-9**（2026-11-26）
  - **互动反应迁入 VRMA**：新增 `STATE.REACTION`，`VRMAPlayer` 支持单次反应 clip（`LoopOnce`，`loadReaction` 预加载 / `startReaction` 播放 / finished 事件自动回待机循环）。映射：**戳 → `surprise.vrma`（惊讶）、双击 → `hello.vrma`（挥手问好）**；素材缺失自动降级手写动画；反应播放期间手写层只叠加对应表情（surprised/happy）；摸头是持续状态，保持手写反馈
  - 新增 `start-pet.bat`：双击即启动桌宠（首次自动 npm install + 构建，之后直接启动）；`scripts/install-shortcut.ps1` 一键创建桌面快捷方式（已创建「AI Live3D Pet.lnk」）
- **v1.0.261126-8**（2026-11-26）
  - **动作库扩容至 126 个 VRMA**：镜像下载 [test157t/VRM-Assets-Pack-For-Silly-Tavern](https://github.com/test157t/VRM-Assets-Pack-For-Silly-Tavern) 的 116 个 BVH 动捕动作（打招呼/跳舞/走跑/坐下/惊讶/生气/害怕/感恩等）本地批量转换为 VRMA（116/116 成功），加 9 个现成 VRMA（greeting/hello/peace sign/spin 等）+ 原有 idle_loop
  - 新增离线转换器：`scripts/bvh-converter/` 复刻官方 [vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma) 转换核心（MIT），`scripts/convert-bvh-to-vrma.ts` 支持批量转换 + BVH 单位自动探测（cm/dm），Node 下运行需 FileReader polyfill（已内置）
  - 右键菜单 `Animation` 区块改为分组子菜单：Actions / Dances / Idle & Sit / Emotions & Others，126 项不再撑爆菜单
- **v1.0.261126-7**（2026-11-26）
  - 修复：**VRMA 待机角色左右乱窜**——`idle_loop.vrma` 为直播场景制作，自带 hips 水平位移轨道；`VRMAPlayer._pinHipsToCenter()` 加载后把 hips 位移的 X/Z 分量清零（保留 Y 起伏），任何 VRMA 强制「原地站桩」适配桌宠窗口
  - 修复：**欢呼时双手臂在背后交叉**——normalized 骨骼中左臂沿 $-X$，`rotation.z` 正向转过 90° 垂直线后手臂越过身体中线甩向对侧；上举改为反向旋转（从下垂 63° 转回水平再转负角度至斜上外侧），幅度从 +0.95 改为 -2.0 方向
- **v1.0.261126-6**（2026-11-26）
  - **接入 VRMA 动画路线**：新增 `@pixiv/three-vrm-animation` 依赖与 `src/core/vrma.js`（`VRMAPlayer`：GLTFLoader + `VRMAnimationLoaderPlugin` 解析 `.vrma`，`createVRMAnimationClip` 生成 AnimationClip，`rebind()` 换模型时免下载重绑）
  - **与手写动画互斥**：待机时 VRMA 驱动标准骨骼（`Animator.update` 让位），任何互动（摸头/拖拽/戳/欢呼）期间自动暂停 VRMA、由手写姿势接管，回待机自动恢复播放；VRMA 自带表情轨道时不写入手写表情避免覆盖
  - 右键菜单新增 `Animation` 区块：`(None)`（手写待机）/ 各 `.vrma` 勾选切换；`animations/` 目录增删文件即刻生效
  - 内置动画：`idle_loop.vrma`（pixiv/ChatVRM 官方待机循环，157,664 字节镜像下载校验一致）；API 用法经 `node_modules/@pixiv/three-vrm-animation` 类型定义核对（`gltf.userData.vrmAnimations`、独立函数 `createVRMAnimationClip(vrmAnimation, vrm)`）
- **v1.0.261126-5**（2026-11-26）
  - 重做欢呼跳跃动画：原来是 `|sin|` 乘衰减系数（周期边界速度突变、手臂节奏与跳跃脱节），改为符合物理的四段式——**预备下蹲 → 重力抛物线腾空（同步举臂）→ 落地压低缓冲 → 小回弹站直**，全部相位在同一时间轴上，手臂摆动只在腾空段叠加小幅波
  - 被戳（poke）动画同步改为「先受惊微蹲 18% 时长 → 抛物线弹起」，不再是对称正弦浮动
- **v1.0.261126-4**（2026-11-26）
  - 修复：**手臂始终 T-pose 平举**（A-pose 在基础姿态捕获之后才设置，每帧重置又把手臂还原成 T-pose，伸开的手被窗口裁掉）→ 姿势应用抽成共享模块 `src/core/pose.js`，Animator 与取景都在捕获/计算**之前**应用 A-pose
  - 修复：**取景只按高度算、手部出窗**（窗口竖长宽高比 0.63，T-pose 臂展超出横向视野；Seed-san 姿势特殊裁切更多）→ 取景改为**按骨骼关节位置**计算包围盒（`Box3.setFromObject` 对蒙皮网格只会返回 T-pose bind-pose 包围盒，不反映实际姿势），并让宽、高两轴都参与相机距离计算
- **v1.0.261126-3**（2026-11-26）
  - 新增：**右键随时更换模型**——在宠物或面板上右键弹出原生菜单，列出 `models/` 全部模型（当前模型打勾）+「打开文件...」；菜单每次弹出时实时扫描目录，往 `models/` 里增删文件即刻生效
  - 新增模型 4 个（镜像下载，glTF 校验通过）：VRoid 官方示例 AvatarSample_A/B/C（动漫风上色）、VRM 官方示例 Seed-san；连同原有素模共 5 个，启动默认加载文件名排序第一个（AvatarSample_A）
  - 主进程新增 `models:current`（renderer 回报实际加载的模型路径，供菜单勾选）与 `menu:modelPicker`（右键弹菜单）IPC
- **v1.0.261126-2**（2026-11-26）
  - 修复：设置面板无法隐藏（`#panel` 的 ID 选择器特异性压过 `.hidden`，白色面板一直盖住模型）→ `.hidden` 加 `!important`
  - 修复：点击/手势无反应 → 点击穿透判定从「renderer 依赖 `forward:true` 转发的 mousemove 切换」重构为「主进程 40ms 轮询 `screen.getCursorScreenPoint()` 对照模型包围矩形」（渲染层每帧经 `hit:updateRegion` 上报模型/面板的窗口相对矩形）
  - 调整：环境光 0.55π → 0.35π、平行光 π → 0.9π，模型颜色不再泛白
- **v1.0.261126-1**（2026-11-26）
  - 首个可运行版本：Electron 透明置顶无边框窗口 + 系统托盘
  - VRM 模型加载（`@pixiv/three-vrm` v3 + three r170+，自定义 `live3d-model://` 协议解决 renderer 无法 fetch `file://` 的问题）
  - 一期手势互动全部实现：摸头（头部滑动触发开心表情+蹭手）、拖拽身体（窗口跟随+惯性倾斜+手臂挥动）、快速点击（受惊弹跳）、双击（欢呼跳跃）
  - 待机动画：呼吸、随机眨眼、头部/视线跟随鼠标、随机歪头
  - 点击穿透：模型区域外鼠标事件完全穿透到桌面，模型区域自动恢复交互
  - 预留接口：AI 对话（`src/ai/chat-provider.js`）、摄像头手势（`src/hand-tracking.js`）、电脑↔手机漫游（`src/sync/roaming.js`）
  - esbuild 打包 renderer 为单文件 bundle；pillow 生成托盘/窗口图标

## 功能现状

| 阶段 | 功能 | 状态 |
|---|---|---|
| 一期 | 鼠标/触摸手势互动（摸头、拖拽、戳、双击） | ✅ 已实现 |
| 一期 | 待机动画（呼吸/眨眼/视线跟随/歪头） | ✅ 已实现 |
| 一期 | 透明置顶 + 点击穿透 + 托盘控制 | ✅ 已实现 |
| 一期 | VRMA 待机动画（VRM Animation 标准格式，互斥混合） | ✅ 已实现 |
| 二期 | 摄像头手势识别（MediaPipe Hands：挥手/比心/隔空摸头） | 预留接口 |
| 三期 | AI 对话（LLM 回复 + 情绪驱动表情 + 口型同步） | 预留接口 |
| 四期 | 手机网页端（局域网扫码，同一 renderer bundle，触摸交互） | ✅ 已实现 |
| 四期 | 双向同步 + 手机端控制台（换模型/换动画/朝向，WS 实时跟随） | ✅ 已实现 |
| 四期 | 漫游交接（跑出/跑入动画，断线自动回家，`--show` 召回） | ✅ 已实现 |

## 技术栈

- **壳**：Electron 33（透明无边框置顶窗口、托盘、单实例锁、点击穿透 `setIgnoreMouseEvents`）
- **渲染**：Three.js + `@pixiv/three-vrm` v3（VRM 表情/口型/视线/弹簧骨骼），桌面与手机浏览器共用同一 bundle
- **手机端**：主进程局域网 HTTP + WebSocket 服务（`node:http` + `ws`）+ `qrcode`（扫码窗口 SVG）
- **打包**：esbuild（renderer 打成单文件 `dist/bundle.js`，避开 `file://` ESM 限制）
- **模型**：VRM 1.0/0.x（示例模型来自 pixiv/three-vrm 官方仓库；推荐用 [VRoid Studio](https://vroid.com/studio) 自己捏）
- **图标**：`scripts/gen_icon.py`（uv + pillow 生成）

## 目录结构

```
ai-live3d/
├── main/                    # Electron 主进程
│   ├── main.js              # 窗口/托盘/IPC/自定义协议 live3d-model:///漫游编排
│   ├── lan.js               # 局域网 HTTP+WS 服务 + 手机扫码 QR 窗口（四期）
│   ├── preload.js           # contextBridge 暴露 window.live3d
│   ├── tray.js              # 托盘菜单（换模型/显示隐藏/退出）
│   └── version.js           # APP_VERSION 唯一来源
├── src/                     # 渲染进程（平台无关，桌面/手机网页共用）
│   ├── app.js               # 入口：加载模型 → 交互 → 帧循环
│   ├── index.html           # UI（无模型时的设置面板、对话气泡位、debug 角标）
│   ├── styles.css
│   ├── platform.js          # 平台适配层：Electron 桥 vs 浏览器降级（WS 同步）
│   ├── web-picker.js        # 手机端控制台（漫游/朝向/模型/动画选择，web only）
│   ├── core/
│   │   ├── viewer.js        # Three.js 场景/相机自动取景/VRM 加载
│   │   ├── animator.js      # 动画状态机（idle/petting/grabbed/poked/happy）
│   │   ├── vrma.js          # VRMA 待机动画播放器（three-vrm-animation）
│   │   ├── pose.js          # 共享 A-pose 常量与应用
│   │   └── expression.js    # 表情缓动混合器（含口型接口）
│   ├── interaction/
│   │   ├── hit-test.js      # 屏幕空间命中判定（头/身体包围球，非网格 raycast）
│   │   └── mouse.js         # Pointer Events 手势（鼠标+触摸通用）
│   ├── ai/chat-provider.js  # 三期接口：LLM 对话 + 情绪映射 + 口型
│   ├── hand-tracking.js     # 二期接口：MediaPipe 手势
│   └── sync/roaming.js      # 四期接口：设备间漫游协议
├── models/                  # 放 .vrm 模型（见 models/README.md，不入 git）
├── animations/              # 放 .vrma 待机动画（见 animations/README.md，不入 git）
├── assets/                  # icon.png / tray.png + PWA（manifest.webmanifest / sw.js / icon-{192,512}.png）
├── .claude/skills/live3d-pet/SKILL.md  # Claude Code 遥控 skill（命令行通道）
├── scripts/gen_icon.py      # 图标生成脚本
├── scripts/make-portable.bat # 便携 zip 打包（无需 Node 的分发包）
├── dist/bundle.js           # esbuild 产物（不入 git，npm start 自动构建）
└── package.json
```

## 使用方式

**双击 `start-pet.bat`**（或桌面快捷方式「AI Live3D Pet」）即可启动；首次运行会自动安装依赖并构建。

命令行方式：

```bash
npm install   # 首次；Electron 二进制走 npmmirror（见 .npmrc）
npm start     # 构建 renderer + 启动桌宠
```

1. 首次启动若无模型，会弹出设置面板：把 `.vrm` 放进 `models/` 文件夹，或点「打开文件...」选择
2. **换模型 / 换待机动作**：在宠物上**右键**弹出菜单——模型列表勾选切换 + `Animation` 区块切换 `.vrma` 待机动画（`(None)` 为手写待机）；往 `models/`、`animations/` 文件夹增删文件即刻生效
3. 交互：
   - **摸头**：在头部来回滑动（累计约 90px 路径触发）→ 开心眯眼、头部蹭手
   - **拖拽**：按住身体拖动 → 窗口跟随、身体反向倾斜、手臂挥动
   - **戳**：快速点击（<300ms 且移动 <6px）→ 受惊弹跳
   - **双击**：欢呼跳跃 + 挥手
   - 模型以外区域鼠标完全穿透，不影响正常使用电脑
3. 托盘图标：换模型 / 显示隐藏 / DevTools / 退出
4. 调试：`electron . --args --` 后在 URL 加 `?debug=1`（或托盘菜单 Open DevTools）显示版本/FPS/状态角标

> 注意：拖拽用屏幕坐标计算窗口位移，快速点击判定 300ms/6px 阈值；点击穿透切换由 renderer 命中判定驱动（`hit:updateRegion` IPC 上报区域 + 主进程轮询光标）。

### 命令行遥控（CLI / Claude Code skill）

桌宠运行中，再次带参数启动即向已有实例下发命令（首启参数同样生效）。CMD 里直接 `start-pet.bat --play hello`；Git Bash（Claude Code）里：

```bash
cd /d/cc/codex/ai-live3d && ./start-pet.bat --play hello        # 单次播放动作，播完回待机
./start-pet.bat --animation none    # 切换常驻待机动画（none=手写待机）
./start-pet.bat --model AvatarSample_B
./start-pet.bat --facing 90         # 转身（0/45/90/135/180）
./start-pet.bat --lan off           # 关局域网服务（on 开 / toggle 切换）
./start-pet.bat --qr                # 弹出手机扫码窗口（服务未开会自动启动）
./start-pet.bat --hide              # 隐藏（--show 显示/从手机召回桌宠，--quit 退出）
```

名称匹配：去扩展名忽略大小写，先精确后子串；`--play` 支持 `poke/surprise`、`hello/happy` 等别名；多命令可组合（`--play hello --facing 90`）。命令回执（含原始 argv）与匹配失败都写入 `ai-live3d.log` 的 `[cmd]` 行。配套 **Claude Code skill** `.claude/skills/live3d-pet/SKILL.md`：装了 Claude Code 的会话里直接说「让桌宠跳个舞」即可遥控。

### 让桌宠跑进手机屏幕（局域网）

桌宠启动时**自动**在 `0.0.0.0:31790` 起局域网服务（端口被占自动顺延到 31794）。手机和电脑连**同一个 Wi-Fi** 后：

1. 托盘图标右键 → **Show QR code**（或 `start-pet.bat --qr`），弹出扫码窗口
2. 手机扫码（或浏览器直接输入 `http://<电脑IP>:31790`，窗口里列了全部候选地址）
3. 手机上出现同款桌宠：自动加载默认模型与待机/反应动画，**摸头滑动 / 拖动 / 戳 / 双击欢呼**全部触摸手势可用
4. **装成 App（去浏览器壳）**：
   - **iPhone**：Safari 分享 →「添加到主屏幕」→ 得到独立图标，点开**全屏无浏览器 UI**（PWA standalone）
   - **Android**：浏览器菜单 →「添加到主屏幕」→ 得到快捷方式（打开带地址栏；Chrome 规定免地址栏的「安装」仅限 HTTPS，局域网 http 不满足——要彻底去壳需另打 APK）
5. 手机右下角**悬浮 dock**（📱 / 🖥 / ☰ 竖排三圆钮）：**📱 留在这里**、**🖥 送到电脑**随时可点；**☰ 桌宠控制台**——模型横向药丸 + 待机动画折叠分组（默认收起，点组名展开，筛选框自动展开匹配），选择实时同步到电脑和其它已连接手机；**空白处横向拖动**连续旋转桌宠（任意角度，拖身体仍是移动位置），旋转同步全端
6. **漫游**：dock 的「📱 留在这里」或托盘 `Send pet to phone`——桌宠跑出电脑屏幕边缘、从手机右缘跑进来（电脑窗口隐藏）；「🖥 送到电脑」或 CLI `--show` 送回；**多台手机在线时定向移交**（谁点 📱 桌宠去谁那，其余台自动收起，托盘发送时弹选择器；手机之间可直接对转）；持有桌宠的手机断线/关页 → 桌宠自动回电脑，不会走丢
7. **跨网络（手机走流量/不在同一 Wi-Fi）**：装 **Tailscale**（PC + 各 iPhone 登录同一账号，免费），手机访问 `http://<电脑的 100.x 地址>:31790`——该地址会自动出现在扫码窗口候选列表里，全部功能（同步/漫游）原样可用

注意：

- 首次开启 Windows 防火墙会弹一次「允许访问」，需勾选**专用网络**放行（局域网服务只暴露 `models/`、`animations/` 白名单文件，WS 仅 JSON 消息）
- 深色渐变背景只在网页模式生效，桌面透明窗口不受影响
- 经「打开文件...」加载的 `models/` 目录外模型不会同步到手机（手机无法访问该文件），动画同理
- 服务开关：托盘 `LAN server (phone access)` 或 CLI `--lan <on|off|toggle>`

### 打包发给别人（便携 zip）

```bash
scripts/make-portable.bat    # 产出 dist/ai-live3d-portable-<版本>.zip（约 174MB）
```

对方**无需安装 Node.js**：解压后双击 `start-pet.bat` 即用（运行时只带 electron 二进制 + `qrcode`/`dijkstrajs`/`pngjs`/`ws` 四个纯 JS 包供扫码窗口与 WS 同步用，renderer 已是预构建单文件 bundle），CLI 遥控命令与手机扫码/同步/漫游功能同样可用。注意：公开分发前请确认 `models/`、`animations/` 内第三方素材的再分发许可。

## 开发

- 改 `src/` 后 `npm start` 会自动重新 esbuild；只调主进程可用 `npm run start:fast` 跳过构建
- 光照强度按 three r155+ 物理光照单位设置（DirectionalLight ≈ π），MToon 材质下显示正常
- A-pose 手臂角度常量 `A_POSE_ANGLE`（`src/core/animator.js`）：normalized 骨骼下左手取正、右手取负

## 路线图

1. **二期**：MediaPipe Hands 摄像头手势（`src/hand-tracking.js` 已定 GESTURE 契约：挥手→开心、隔空摸头→petting、比心→开心+气泡、指点→视线跟随）
2. **三期**：AI 对话（`src/ai/chat-provider.js` 已定契约：`send(text) → { reply, emotion }`，情绪映射到 VRM 表情，`speak()` 驱动口型；API Key 走环境变量）
3. **四期**：✅ 手机网页端 + WS 双向同步 + 漫游交接均已完成（HTTP/WS 服务 `main/lan.js`，手机控制台 `src/web-picker.js`，漫游客户端 `src/sync/roaming.js`，跑出/跑入动画 `viewer.petRoot`）
4. **四期·可选增强**：多手机同时在线时的目标选择（当前广播到全部）、漫游时携带 mood/位置等更丰富的宠物状态
