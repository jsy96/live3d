# animations/

放 `.vrma`（VRM Animation）待机动作文件。

- 启动时自动加载本目录**第一个** `.vrma` 作为待机动画（循环播放）
- **在宠物上右键** → `Animation` 区块可切换：`(None)` 回到手写待机姿态，或选任一 `.vrma`；目录增删文件即刻生效
- 播放机制：VRMA 直接驱动 VRM 标准骨骼，与手写待机互斥——任何互动（摸头/拖拽/戳/欢呼）期间自动暂停 VRMA，回到待机自动恢复
- 已内置：`idle_loop.vrma`（下载自 pixiv/ChatVRM 官方仓库）
- 更多来源：VRoid Hub / BOOTH 搜索 "VRMA"、[pixiv/three-vrm-animation](https://github.com/pixiv/three-vrm) 官方示例
- `.vrma` 是二进制资产，不入 git（见根目录 `.gitignore`）
