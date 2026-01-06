<div align="center">

**English** | [中文](README_ZH.md)

### Fast · Modern · Efficient JSON Desktop Tool

A modern JSON desktop app built with Tauri 2.0 and Rust

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/sundegan/JsonStudio/releases) [![Tauri](https://img.shields.io/badge/Tauri-2.0-orange.svg)](https://tauri.app/) [![Rust](https://img.shields.io/badge/Rust-1.70+-orange.svg)](https://www.rust-lang.org/)

</div>

- [Core Highlights](#core-highlights)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation & Usage](#installation--usage)

<br>

## ✨ Core Highlights

- **Clipboard Quick Launch**
  Copy JSON and press a global hotkey to launch the app instantly. Skip the "copy → open app → paste" dance. Deep clipboard integration makes JSON processing **copy-and-use, one-click access**.

- **Keyboard-First Workflow**
  Format, compress, compare, convert—all via hotkeys. No mouse needed. Customize global and in-app hotkeys to build your perfect workflow. **Keep your hands on the keyboard**.

- **Clean, Modern Interface**
  Icon-only toolbar, auto-format on paste, real-time error detection. Hotkeys, drag-and-drop, undo/redo, state restore, line numbers, dark/light themes. **Focus on your data**.

- **Blazing Fast Performance**
  Rust-powered backend handles MB-sized JSON files instantly. Tauri 2.0 keeps the app small, fast to launch, and memory-efficient.

- **True Native Desktop App**
  Built with Tauri 2.0—not Electron, not web-based. **Works completely offline**. Your data stays local and secure. Real desktop experience.

- **Modern Tech Stack**
  **Rust + Svelte + Tauri 2.0**—the perfect balance of performance, size, and developer experience. 90% smaller, 70% less memory, 10x faster than Electron.

## 🎯 Features

#### Formatting & Beautification

- **JSON Formatting** - Pretty-print JSON with syntax highlighting
- **Collapsible Nodes** - Fold large JSON structures for easy navigation

#### Search & Comparison

- **Quick Search** - Find keys and values instantly
- **File Diff** - Compare two JSON files side-by-side
- **Visual Diffs** - Highlight additions, deletions, and changes
- **Tree Navigation** - Browse hierarchical structures with ease

#### Conversion & Processing

- **Compress & Escape** - Minify JSON, escape/unescape strings
- **Format Conversion** - Convert to/from XML, YAML, TOML, and more
- **Code Generation** - Generate Go structs, Rust structs, TypeScript interfaces, etc.

#### File Operations

- **Open & Save** - Read and write local JSON files
- **Drag & Drop** - Drop files into the window to open

#### Efficiency Tools

- **Global Hotkeys** - Every action has a hotkey
- **Clipboard Magic** - Auto-read clipboard, one-click processing
- **Smart Paste** - Auto-detect and process JSON on paste
- **Quick Copy** - Copy results to clipboard instantly

#### Data Management

- **History** - Auto-save your work history
- **Local Storage** - All data stays on your machine
- **State Restore** - Pick up where you left off after restart

### 🛠️ Tech Stack

- **Frontend**: Svelte + TailwindCSS + Monaco Editor
- **Desktop**: Tauri 2.0
- **Backend**: Rust

| Tech | Why It's Great | Performance |
|:----:|------|---------|
| **Tauri 2.0** | Uses native WebView | 90% smaller · 70% less RAM |
| **Rust** | System-level speed + memory safety | 10-100x faster than Node.js |
| **Svelte** | Compile-time magic, no virtual DOM | Faster runtime · smaller bundle |

## 📦 Installation & Usage

#### Download & Install

Head to [Releases](https://github.com/sundegan/JsonStudio/releases) and grab the installer for your platform.

### Demo

Coming soon

---

<div align="center">

If this project helps you, please give it a ⭐️ Star!

</div>
