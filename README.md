# AI Live3D 桌宠

AI 驱动的 3D 桌面宠物：VRM 模型 + Electron 透明窗口 + Three.js 渲染，支持摸头 / 拖拽 / 戳 / 双击等手势互动，可点击穿透不挡桌面。架构上渲染层与 Electron 壳完全解耦，同一套代码未来可直接跑在手机网页端，实现桌宠在电脑与手机之间漫游。

- Gitee 仓库：<https://gitee.com/jsy96/live3d>
- 当前版本：**v1.0.261126-1**（版本号唯一来源：`main/version.js`，显示于托盘菜单/tooltip 与 `?debug=1` 角标）

## 更新记录

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
| 二期 | 摄像头手势识别（MediaPipe Hands：挥手/比心/隔空摸头） | 预留接口 |
| 三期 | AI 对话（LLM 回复 + 情绪驱动表情 + 口型同步） | 预留接口 |
| 四期 | 电脑 ↔ 手机漫游（局域网网页端 + 宠物迁移动画） | 预留接口 |

## 技术栈

- **壳**：Electron 33（透明无边框置顶窗口、托盘、单实例锁、点击穿透 `setIgnoreMouseEvents`）
- **渲染**：Three.js + `@pixiv/three-vrm` v3（VRM 表情/口型/视线/弹簧骨骼）
- **打包**：esbuild（renderer 打成单文件 `dist/bundle.js`，避开 `file://` ESM 限制）
- **模型**：VRM 1.0/0.x（示例模型来自 pixiv/three-vrm 官方仓库；推荐用 [VRoid Studio](https://vroid.com/studio) 自己捏）
- **图标**：`scripts/gen_icon.py`（uv + pillow 生成）

## 目录结构

```
ai-live3d/
├── main/                    # Electron 主进程
│   ├── main.js              # 窗口/托盘/IPC/自定义协议 live3d-model://
│   ├── preload.js           # contextBridge 暴露 window.live3d
│   ├── tray.js              # 托盘菜单（换模型/显示隐藏/退出）
│   └── version.js           # APP_VERSION 唯一来源
├── src/                     # 渲染进程（平台无关，桌面/手机网页共用）
│   ├── app.js               # 入口：加载模型 → 交互 → 帧循环
│   ├── index.html           # UI（无模型时的设置面板、对话气泡位、debug 角标）
│   ├── styles.css
│   ├── platform.js          # 平台适配层：Electron 桥 vs 浏览器降级
│   ├── core/
│   │   ├── viewer.js        # Three.js 场景/相机自动取景/VRM 加载
│   │   ├── animator.js      # 动画状态机（idle/petting/grabbed/poked/happy）
│   │   └── expression.js    # 表情缓动混合器（含口型接口）
│   ├── interaction/
│   │   ├── hit-test.js      # 屏幕空间命中判定（头/身体包围球，非网格 raycast）
│   │   └── mouse.js         # Pointer Events 手势（鼠标+触摸通用）
│   ├── ai/chat-provider.js  # 三期接口：LLM 对话 + 情绪映射 + 口型
│   ├── hand-tracking.js     # 二期接口：MediaPipe 手势
│   └── sync/roaming.js      # 四期接口：设备间漫游协议
├── models/                  # 放 .vrm 模型（见 models/README.md，不入 git）
├── assets/                  # icon.png / tray.png（脚本生成）
├── scripts/gen_icon.py      # 图标生成脚本
├── dist/bundle.js           # esbuild 产物（不入 git，npm start 自动构建）
└── package.json
```

## 使用方式

```bash
npm install   # 首次；Electron 二进制走 npmmirror（见 .npmrc）
npm start     # 构建 renderer + 启动桌宠
```

1. 首次启动若无模型，会弹出设置面板：把 `.vrm` 放进 `models/` 文件夹，或点「打开文件...」选择
2. 交互：
   - **摸头**：在头部来回滑动（累计约 90px 路径触发）→ 开心眯眼、头部蹭手
   - **拖拽**：按住身体拖动 → 窗口跟随、身体反向倾斜、手臂挥动
   - **戳**：快速点击（<300ms 且移动 <6px）→ 受惊弹跳
   - **双击**：欢呼跳跃 + 挥手
   - 模型以外区域鼠标完全穿透，不影响正常使用电脑
3. 托盘图标：换模型 / 显示隐藏 / DevTools / 退出
4. 调试：`electron . --args --` 后在 URL 加 `?debug=1`（或托盘菜单 Open DevTools）显示版本/FPS/状态角标

> 注意：拖拽用屏幕坐标计算窗口位移，快速点击判定 300ms/6px 阈值；点击穿透切换由 renderer 命中判定驱动（`hit:setInteractive` IPC）。

## 开发

- 改 `src/` 后 `npm start` 会自动重新 esbuild；只调主进程可用 `npm run start:fast` 跳过构建
- 光照强度按 three r155+ 物理光照单位设置（DirectionalLight ≈ π），MToon 材质下显示正常
- A-pose 手臂角度常量 `A_POSE_ANGLE`（`src/core/animator.js`）：normalized 骨骼下左手取正、右手取负

## 路线图

1. **二期**：MediaPipe Hands 摄像头手势（`src/hand-tracking.js` 已定 GESTURE 契约：挥手→开心、隔空摸头→petting、比心→开心+气泡、指点→视线跟随）
2. **三期**：AI 对话（`src/ai/chat-provider.js` 已定契约：`send(text) → { reply, emotion }`，情绪映射到 VRM 表情，`speak()` 驱动口型；API Key 走环境变量）
3. **四期**：电脑 ↔ 手机漫游（`src/sync/roaming.js` 已定协议：桌面端起局域网 HTTP+WebSocket 服务，手机浏览器打开同一 renderer bundle，`PET_TRANSFER` 事件做宠物状态迁移 + 跑出/跑进动画）
