<div align="center">

**English** | [中文](README_ZH.md)

# JsonStudio

### A fast, private JSON workspace for everyday development

Prettify, inspect, compare, convert, validate, and extract JSON from real-world logs - all locally in a native desktop app.

**[jsonstudio.js.org](https://jsonstudio.js.org/)** · **[Download](https://github.com/sundegan/JsonStudio/releases)**

<p align="center">
  <a href="https://jsonstudio.js.org/">
    <img src="https://img.shields.io/badge/Website-f5c542?style=flat-square&logo=googlechrome&logoColor=white" alt="Website">
  </a>
  <a href="https://github.com/sundegan/JsonStudio/releases">
    <img src="https://img.shields.io/github/v/release/sundegan/JsonStudio?style=flat-square&color=10b981&label=Release&logo=github&logoColor=white" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-334155?style=flat-square&logo=apple&logoColor=white" alt="Platform">
  <img src="https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/Rust-2024-DEA584?style=flat-square&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/Privacy-100%25%20Local-166534?style=flat-square&logo=docsdotrs&logoColor=white" alt="Privacy">
</p>

<sub>all-in-one JSON workspace · professional developer experience · native-speed performance</sub>

</div>

## Preview

![Dark Theme](docs/images_en/app_home_page_dark_mode.png)

![Light Theme](docs/images_en/app_home_page_light_mode.png)

## What Makes It Different

JsonStudio is built for JSON in real development work: API requests and responses, deeply nested data, escaped strings, JSON5-like snippets, and log lines where plain text and JSON are mixed together.

- **Local-first desktop app**: no network required, no browser required, no ads, a polished UI, shortcut support, and no more jumping between a pile of web tabs.
- **Smarter formatting**: supports standard JSON, JSON-like/JSON5 input, escaped JSON strings, JSON with trailing commas, JSON with unquoted keys, automatic repair attempts for problematic JSON data, and paste auto-formatting.
- **Log-like text and JSON mixed content formatting**: keeps the original log unchanged, extracts JSON fragments automatically, and displays structured results separately for easier log data inspection.
- **Better reading and review**: tree view, JMESPath/JSONPath query, real-time statistics, and JSON diff make complex JSON data easier to understand.
- **Details that fit daily use**: preserves original object key order by default, keeps JSON editing operations undoable, and reuses existing tabs when reopening files.
- **Developer tools**: prettify, minify, escape, unescape, minify + escape, fold, unfold, JSON Schema generation/validation, JSON <-> YAML/XML/TOML/CSV conversion, and typed code generation.
- **Smooth file workflow**: multi-tabs, auto-numbered Untitled tabs, reused tabs for reopened files, unsaved-change prompts, optional auto-save, drag-and-drop JSON opening, and direct opening by double-clicking JSON files.

## Features

### Edit & Inspect

![Editor](docs/images_en/editor.png)

Built on Monaco Editor, JsonStudio provides a top-tier JSON prettify and viewing experience with syntax highlighting, code folding, find/replace, bracket coloring, light/dark mode, and 10+ themes.

### Tree View & Search

![Tree View](docs/images_en/tree_view.png)

Use the tree view to navigate nested data, copy paths or values, and query with JMESPath or JSONPath when a payload is too large to scan manually.

### Compare, Convert, Generate

![JSON Diff](docs/images_en/json_diff.png)

![Converter](docs/images_en/convert.png)

![Code Gen](docs/images_en/code_gen.png)

Compare JSON side by side, convert between common data formats, generate typed models, or extract JSON back from supported code snippets.

### Validate With Schema

![JSON Schema](docs/images_en/json_schema.png)

Generate JSON Schema from data, validate JSON against a schema, and inspect detailed validation errors in a dedicated workspace.

## Why JsonStudio? (vs Online Tools)

| Capability | Online Tools | JsonStudio |
|---|---:|---:|
| Works fully offline with local files | Limited | Yes |
| Keeps sensitive JSON on your machine | Risky | 100% local |
| Handles JSON, JSON5-like input, escaped JSON, and repairable fragments | Partial | Built in |
| Extracts JSON from log-like mixed text | Rare | Yes |
| Tree view with JMESPath/JSONPath query | Partial | Yes |
| Multi-tab workflow with unsaved prompts and optional auto-save | No | Yes |
| Native shortcuts, format clipboard, always-on-top window | No | Yes |
| Diff, convert, schema validation, and code generation in one app | Fragmented | Unified |

## Download

Download the latest installer from [GitHub Releases](https://github.com/sundegan/JsonStudio/releases).

### macOS

1. Download the DMG for your Mac architecture (`aarch64` for Apple Silicon, `x64` for Intel).
2. Open the DMG and drag `Json Studio.app` into Applications.
3. On first launch, if macOS blocks the app because it is from an unidentified developer, right-click `Json Studio.app` and choose **Open**, or allow it in **System Settings > Privacy & Security**.

Current macOS builds are not Apple Developer ID notarized, so the first launch may require manual confirmation.

## Tech Stack

- **Desktop**: Tauri 2.0 + Svelte 5 + Monaco Editor
- **Core**: Rust + Javascript

---

<div align="center">

If JsonStudio helps your daily JSON work, a star would mean a lot.

</div>
