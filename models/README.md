# models/

把 `.vrm` 模型文件放进这个文件夹。

- 启动时应用按文件名顺序加载**第一个** `.vrm`（或 `.glb`）模型
- 想换模型：右下角托盘图标 → `Change model...`，或直接增删本目录文件后重启
- 免费模型来源：
  - [VRoid Studio](https://vroid.com/studio)（免费捏人，直接导出 VRM）
  - [BOOTH](https://booth.pm/) 搜索 "VRM"（注意选择允许使用的模型）
  - pixiv 官方示例仓库 [pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- 模型是二进制资产，不入 git（见根目录 `.gitignore`）
