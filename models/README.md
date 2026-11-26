# models/

把 `.vrm` 模型文件放进这个文件夹。

- 启动时应用按文件名顺序加载**第一个** `.vrm`（或 `.glb`）模型
- 想换模型：**在宠物上右键**弹出菜单选择（会打勾标记当前模型），或托盘图标 → `Change model...`；本目录增删文件即刻在右键菜单生效，无需重启
- 当前已内置（镜像下载自官方仓库，可自行删换）：
  - `AvatarSample_A.vrm` / `AvatarSample_B.vrm` / `AvatarSample_C.vrm` —— VRoid 官方示例形象（动漫风上色，默认加载 A）
  - `Seed-san.vrm` —— VRM 1.0 官方示例
  - `VRM1_Constraint_Twist_Sample.vrm` —— pixiv 官方约束测试素模（灰白色）
- 免费模型来源：
  - [VRoid Studio](https://vroid.com/studio)（免费捏人，直接导出 VRM）
  - [BOOTH](https://booth.pm/) 搜索 "VRM"（注意选择允许使用的模型）
  - pixiv 官方示例仓库 [pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- 模型是二进制资产，不入 git（见根目录 `.gitignore`）
