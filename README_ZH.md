<div align="center">

[English](README.md) | **中文**

# JsonStudio

### 面向日常开发的本地 JSON 工作台

美化、查看、对比、转换、校验，也能从真实日志里提取 JSON - 全部在本地桌面应用中完成。

如果喜欢 JsonStudio，欢迎点个 Star [⭐](https://github.com/sundegan/JsonStudio)。

<p align="center">
  <a href="https://github.com/sundegan/JsonStudio/releases">
    <img src="https://img.shields.io/github/v/release/sundegan/JsonStudio?style=flat-square&color=10b981&label=最新版本&logo=github&logoColor=white" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-334155?style=flat-square&logo=apple&logoColor=white" alt="Platform">
  <a href="https://jsonstudio.js.org/">
    <img src="https://img.shields.io/badge/官方网站-f5c542?style=flat-square&logo=googlechrome&logoColor=white" alt="Website">
  </a>
</p>

</div>

## 预览

<p align="center">
  <a href="https://jsonstudio.js.org/zh/#screenshots">
    <img src="docs/media/jsonstudio-demo.gif" width="900" alt="JsonStudio 演示：剪贴板格式化、树视图编辑与拖拽、Grid 网格视图编辑和日志 JSON 提取">
  </a>
</p>

<p align="center"><sub>格式化剪贴板 JSON，在树视图中编辑和拖拽数据，在 Grid 网格视图中编辑数组，并从日志中提取 JSON。</sub></p>

## JsonStudio 的特点

JsonStudio 面向真实开发场景里的 JSON —— 接口请求/响应、复杂嵌套数据、转义字符串、类 JSON/JSON5 片段，以及普通日志文本和 JSON 混在一起的内容。

- **本地优先**：离线可用，敏感 JSON 不离开本机。
- **输入更灵活**：支持标准 JSON、类 JSON/JSON5、转义 JSON、可修复片段，以及日志混合文本。
- **可视化编辑**：在树视图中编辑和调整结构，也可以用 Grid 网格视图查看数组。
- **常用工具集中**：查询、对比、格式转换、Schema 校验、类型代码生成一站完成。
- **桌面文件体验**：多标签、拖拽打开、格式化剪贴板、快捷键、未保存提示和可选自动保存。

## 为什么选择 JsonStudio（对比在线工具）

| 能力 | 在线工具 | JsonStudio |
|---|---:|---:|
| 离线使用 / 无需联网 | ❌ | ✅ |
| 大 JSON 数据性能 | ❌ | ✅ |
| 多标签页编辑 | ❌ | ✅ |
| 可编辑、可拖拽的树视图与可编辑 Grid 网格视图 | ❌ | ✅ |
| 日志混合文本 JSON 提取 | ❌ | ✅ |
| JSON5 解析与格式化 | ❌ | ✅ |
| 文件自动保存与标签页复用 | ❌ | ✅ |
| 全局快捷键与自定义键绑定 | ❌ | ✅ |
| 本地文件操作 | ❌ | ✅ |
| 自定义设置（主题、字号、间距、快捷键等） | ❌ | ✅ |

## 下载

前往 [GitHub Releases](https://github.com/sundegan/JsonStudio/releases) 下载对应平台安装包。

### Homebrew（macOS）

```sh
brew install --cask sundegan/tap/json-studio
```

### macOS

1. 下载适合你设备架构的 DMG（Apple Silicon 选 `aarch64`，Intel Mac 选 `x64`）。
2. 打开 DMG，将 `Json Studio.app` 拖入“应用程序”文件夹。
3. 首次打开时，如果 macOS 提示来自未识别开发者，请右键 `Json Studio.app` 选择“打开”，或到“系统设置 > 隐私与安全性”中允许打开。

当前 macOS 安装包未经过 Apple Developer ID 公证，因此首次打开可能需要手动确认。

---

<div align="center">

如果 JsonStudio 对你的日常 JSON 工作有帮助，欢迎点个 Star ⭐ 支持一下。

</div>
