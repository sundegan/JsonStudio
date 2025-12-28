<div align="center">

### 快速 · 现代 · 高效的 JSON 桌面工具

一个基于 Tauri 2.0 和 Rust 构建的现代化 JSON 桌面应用

提供格式化、压缩、转义、对比等常用功能

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/sundegan/JsonStudio/releases) [![Tauri](https://img.shields.io/badge/Tauri-2.0-orange.svg)](https://tauri.app/) [![Rust](https://img.shields.io/badge/Rust-1.70+-orange.svg)](https://www.rust-lang.org/)

</div>

- [核心亮点](#核心亮点)
- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [安装与使用](#安装与使用)

<br>

## ✨ 核心亮点

- **剪贴板快速启动**
  复制 JSON 内容后，按下全局快捷键即可唤起应用并自动加载，告别"复制→打开应用→粘贴"的繁琐流程。配合系统剪贴板深度集成，让 JSON 处理如丝般顺滑，真正做到**即复即用，一键直达**。

- **快捷键驱动工作流**
  从格式化、压缩到对比、转换，所有操作均可通过快捷键完成，无需鼠标点击。支持全局快捷键和应用内快捷键自定义，打造属于你的高效工作流，**让双手始终停留在键盘上**。

- **极致性能体验**
  基于 Rust 高性能后端，轻松处理 MB 级大型 JSON 文件，即时响应无卡顿。Tauri 2.0 加持下，应用体积小巧、启动迅速、内存占用低。

- **跨平台原生应用**: 
  采用 Tauri 2.0 构建的原生桌面应用，而非 Electron 或网页版。**完全离线可用，无需联网**，数据本地处理更安全，给你真正的桌面级体验。

- **先进技术选型**
  **Rust + Svelte + Tauri 2.0** 黄金组合，在性能、体积和开发效率之间达到完美平衡。相比传统 Electron 方案，应用体积减少 90%，内存占用降低 70%，性能提升 10 倍以上。

## 🎯 功能特性

#### 格式化与美化

- **JSON 格式化** - 美化显示 JSON 数据，支持语法高亮
- **节点折叠展开** - 大型 JSON 结构可折叠，方便查看和导航

#### 搜索与对比

- **快速搜索定位** - 支持键值搜索，快速定位目标内容
- **JSON 文件对比** - 对比两个 JSON 文件的差异
- **差异高亮显示** - 清晰标注新增、删除、修改的内容
- **结构化导航** - 树形结构展示，层级关系一目了然

#### 转换与处理

- **压缩与转义** - 一键压缩 JSON，支持字符串转义/反转义操作
- **格式互转** - JSON 与其他格式互转，支持 XML、YAML、TOML 等格式转换
- **代码结构生成** - 生成 Go Struct、Rust Struct、TypeScript Interface等

#### 文件操作

- **打开/保存文件** - 支持本地 JSON 文件的读取和保存
- **拖拽导入** - 直接拖拽文件到应用窗口即可打开

#### 效率工具

- **全局快捷键** - 所有常用操作均支持快捷键，无需鼠标点击
- **剪贴板集成** - 自动读取系统剪贴板内容，一键处理
- **自动处理** - 粘贴后自动识别并处理 JSON 内容
- **一键复制** - 处理结果可一键复制到剪贴板

#### 数据管理

- **历史记录** - 自动保存处理历史，随时回溯查看
- **本地存储** - 所有数据本地存储，隐私安全有保障
- **状态恢复** - 重启应用后自动恢复上次的工作内容

### 🛠️ 技术选型

- **前端框架**: Svelte + TailwindCss + Vite
- **桌面框架**: Tauri 2.0
- **后端语言**: Rust

| 技术 | 优势 | 性能对比 |
|:----:|------|---------|
| **Tauri 2.0** | 系统原生 WebView | 体积小 90% · 内存低 70% |
| **Rust** | 系统级性能 + 内存安全 | 比 Node.js 快 10-100 倍 |
| **Svelte** | 编译时优化 · 无虚拟 DOM | 运行时性能更优 · 体积更小 |
| **TailwindCSS** | 原子化 CSS · 现代化设计 | 快速构建美观 UI |

<div align="center">



</div>

## 📦 安装与使用

#### 下载安装

前往 [Releases](https://github.com/sundegan/JsonStudio/releases) 页面下载适合你系统的安装包：

- **Windows**: `JsonStudio_x64_setup.exe`
- **macOS**: `JsonStudio_universal.dmg`
- **Linux**: `JsonStudio_amd64.deb`

### 使用演示

TODO

---

<div align="center">

如果这个项目对你有帮助，请给一个 ⭐️ Star 支持一下！

</div>