---
name: live3d-pet
description: 控制 AI Live3D 桌面宠物（项目 D:\cc\codex\ai-live3d）：启动/显示/隐藏/退出、切换 VRM 模型、切换待机动画、单次播放动作（打招呼/跳舞/惊讶/坐下等 126 个 VRMA）、转身朝向、局域网手机访问与扫码。当用户说"让桌宠跳个舞/打个招呼/被戳一下"、"打开/隐藏/关掉桌宠"、"给桌宠换个模型/换个动作"、"让桌宠上手机/弹扫码窗口"或要演示桌宠时使用。
---

# AI Live3D 桌宠遥控

项目位于 `D:\cc\codex\ai-live3d`（Git Bash 路径 `/d/cc/codex/ai-live3d`）。
桌宠是单实例 Electron 应用：再次带参数启动会把命令转交给已在运行的实例，
因此**所有命令都通过 `start-pet.bat` 下发**（bat 内部用 `start` 异步拉起
electron，命令总是立即返回，不阻塞）。

## 发命令

在 Git Bash（Claude Code 的 shell）中直接执行 bat：

```bash
cd /d/cc/codex/ai-live3d && ./start-pet.bat --play hello
```

> 注意：不要用 `cmd //c "start-pet.bat ..."` 形式——实测 Git Bash 下该形式
> 会报「不是内部或外部命令」且参数无法送达。

多个命令可以组合：`./start-pet.bat --play hello --facing 90`。

## 命令一览

| 参数 | 作用 |
|---|---|
| （无参数） | 启动桌宠；已在运行则唤醒显示（首次运行 bat 自动 npm install + 构建，耗时数分钟） |
| `--play <名称>` | **单次播放** `animations/` 里的任意动作，播完自动回到待机（跳舞/打招呼首选） |
| `--animation <名称\|none>` | 切换**常驻待机动画**；`none` = 手写待机（呼吸/眨眼/视线跟随） |
| `--model <名称或绝对路径>` | 切换 `models/` 里的 VRM 模型 |
| `--facing <角度>` | 转身：0 正面 / 45 / 90 侧面 / 135 / 180 背面 |
| `--lan <on\|off\|toggle>` | 局域网手机访问服务开关（默认随桌宠自动开启，端口 31790） |
| `--qr` | 弹出手机扫码窗口（服务未开时自动启动） |
| `--hide` / `--show` | 隐藏 / 显示窗口 |
| `--devtools` | 切换 DevTools |
| `--quit` | 退出桌宠 |

别名映射（`--play` 可直接用）：`poke/poked/surprise/startled → surprise`，
`hello/hi/wave/happy/cheer/greet/greeting → hello`。

## 名称匹配规则

模型/动画名按**去扩展名、忽略大小写**匹配：先精确匹配，再子串包含
（126 个动画里子串命中第一个）。查可用清单：

```bash
ls /d/cc/codex/ai-live3d/animations/   # 前缀分组：action_ / dance_ / sit_ / idle_ / 其他
ls /d/cc/codex/ai-live3d/models/
```

## 验证与排错

命令执行后查日志确认效果（主进程与渲染层共用的落盘日志）：

```bash
tail -n 15 /d/cc/codex/ai-live3d/ai-live3d.log
```

- 命令已收到：`[cmd] second-instance: {...}`（或 `launch`）
- 播放成功：`[ai-live3d] play-once: <路径>`；换动画成功：`animation loaded`；换模型成功：`model loaded`
- 局域网服务：`[lan] listening on 0.0.0.0:31790` + `[lan] phone url: http://<ip>:31790`（手机浏览器/扫码入口）；`[lan] qr window shown` = 扫码窗口已弹出
- 名称没匹配上：`[cmd] play: animation not found: <名称>` → 用 `ls` 查准确文件名重试
- 桌宠不可见：多半是模型出画或渲染错误，翻日志找 `[error]` / `render-process-gone`
- `--quit` 之后再用 `--play` 会重新完整启动（等模型加载完才播，属正常）
