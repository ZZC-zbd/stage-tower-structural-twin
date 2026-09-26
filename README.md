# 舞台塔结构数字孪生

基于 Blender 概念模型导出的静态工程展示页，包含结构模型、施工阶段、专业图层、构件信息、剖面控制和施工动画。

## GitHub Pages

仓库推送到 `main` 后，GitHub Actions 会自动发布当前目录。首次发布时，在仓库的 **Settings → Pages → Build and deployment** 中将 **Source** 设为 **GitHub Actions**。

## 本地预览

在此目录运行：

```powershell
node .\serve.mjs 8765
```

然后打开 `http://127.0.0.1:8765/`。页面需通过 HTTP 服务访问，不能直接双击 HTML 文件。

## 文件

- `stage_tower.glb`：网页三维模型与动画
- `manifest.json`：施工阶段、构件元数据、图层和相机预设
- `stage_tower_preview.png`：WebGL 不可用时显示的静态预览
- `vendor/`、`utils/`：本地 Three.js 运行依赖
- `serve.mjs`：本地静态预览服务器

该模型用于概念工程关系与施工工序展示，不用于结构验算、施工图审查或施工放样。
