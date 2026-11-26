# animations/

放 `.vrma`（VRM Animation）待机/动作文件。

- 启动时自动加载本目录**第一个** `.vrma` 作为待机动画（循环播放）
- **在宠物上右键** → `Animation` 区块切换：`(None)` 回到手写待机姿态；已按类别分子菜单（Actions / Dances / Idle & Sit / Emotions & Others）；目录增删文件即刻生效
- 播放机制：VRMA 直接驱动 VRM 标准骨骼，与手写动画互斥——互动（摸头/拖拽/戳/欢呼）期间自动暂停 VRMA，回到待机自动恢复
- VRMA 加载后 hips 水平/前后位移自动清零（`VRMAPlayer._pinHipsToCenter`），任何动作都钉在原地适配桌宠窗口

## 当前内置（126 个）

- `idle_loop.vrma` —— pixiv/ChatVRM 官方待机循环
- 116 个由 BVH 转换（来源 [test157t/VRM-Assets-Pack-For-Silly-Tavern](https://github.com/test157t/VRM-Assets-Pack-For-Silly-Tavern) 的动捕动作集：打招呼/跳舞/走跑/坐下/惊讶/生气/害怕/感恩等）
- 9 个现成 VRMA（同仓库 `animation_nitral-fork` 目录：greeting/hello/peace sign/spin 等）

## 转换工具（BVH → VRMA）

`scripts/bvh-converter/` 复刻自官方 [vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma)（MIT License），支持 Node 离线批量转换（含 BVH 单位自动探测 cm/dm）：

```bash
npx esbuild scripts/convert-bvh-to-vrma.ts --bundle --platform=node --format=cjs --outfile=scripts/convert-bvh-to-vrma.cjs
node scripts/convert-bvh-to-vrma.cjs <BVH目录> <输出目录>
```

- `.vrma` 是二进制资产，不入 git（见根目录 `.gitignore`）
