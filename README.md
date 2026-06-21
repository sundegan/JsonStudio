<div align="center">

**English** | [中文](README_ZH.md)

# JsonStudio

### A fast, local-first JSON workspace for everyday development

Prettify, inspect, compare, convert, validate, and extract JSON from real-world logs - all locally in a native desktop app.

**[jsonstudio.js.org](https://jsonstudio.js.org/)** · **[Download](https://github.com/sundegan/JsonStudio/releases)**

<p align="center">
  <a href="https://jsonstudio.js.org/#screenshots">
    <img src="https://img.shields.io/badge/Website-f5c542?style=flat-square&logo=googlechrome&logoColor=white" alt="Website">
  </a>
  <a href="https://github.com/sundegan/JsonStudio/releases">
    <img src="https://img.shields.io/github/v/release/sundegan/JsonStudio?style=flat-square&color=10b981&label=Release&logo=github&logoColor=white" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-334155?style=flat-square&logo=apple&logoColor=white" alt="Platform">
  <img src="https://img.shields.io/badge/Privacy-100%25%20Local-166534?style=flat-square&logo=docsdotrs&logoColor=white" alt="Privacy">
</p>

<sub>all-in-one JSON workspace · local-first desktop app</sub>

</div>

## Preview

<p align="center">
  <a href="https://jsonstudio.js.org/">
    <img src="docs/media/jsonstudio-demo.gif" width="900" alt="JsonStudio demo showing clipboard formatting, Tree View editing and drag-and-drop, Grid View editing, and log JSON extraction">
  </a>
</p>

<p align="center"><sub>Format clipboard JSON, edit and reorganize data in Tree View, edit arrays in Grid View, and extract JSON from logs.</sub></p>

## What Makes It Different

JsonStudio is built for JSON in real development work: API requests and responses, deeply nested data, escaped strings, JSON5-like snippets, and log lines where plain text and JSON are mixed together.

- **Local-first**: works offline and keeps sensitive JSON on your machine.
- **Flexible input**: handles standard JSON, JSON5-like snippets, escaped JSON strings, repairable fragments, and mixed log text.
- **Visual editing**: edit and reorganize data in Tree View, or inspect arrays in Grid View.
- **Daily tools in one place**: query, diff, convert, validate with schema, and generate typed code.
- **Desktop workflow**: multi-tabs, file drag-and-drop, format clipboard, shortcuts, unsaved-change prompts, and optional auto-save.

## Why JsonStudio? (vs Online Tools)

| Capability | Online Tools | JsonStudio |
|---|---:|---:|
| Offline / no internet required | ❌ | ✅ |
| Large JSON data performance | ❌ | ✅ |
| Multi-tab editing | ❌ | ✅ |
| Editable Tree View & Grid View, with drag-and-drop | ❌ | ✅ |
| Log-like text JSON extraction | ❌ | ✅ |
| JSON5 parsing and formatting | ❌ | ✅ |
| Auto-save and reusable file tabs | ❌ | ✅ |
| Global shortcuts & custom keybindings | ❌ | ✅ |
| Local file operations | ❌ | ✅ |
| Custom settings for theme, font, spacing, and shortcuts | ❌ | ✅ |

## Download

Download the latest installer from [GitHub Releases](https://github.com/sundegan/JsonStudio/releases).

### Homebrew (macOS)

```sh
brew install --cask sundegan/tap/json-studio
```

### macOS

1. Download the DMG for your Mac architecture (`aarch64` for Apple Silicon, `x64` for Intel).
2. Open the DMG and drag `Json Studio.app` into Applications.
3. On first launch, if macOS blocks the app because it is from an unidentified developer, right-click `Json Studio.app` and choose **Open**, or allow it in **System Settings > Privacy & Security**.

Current macOS builds are not Apple Developer ID notarized, so the first launch may require manual confirmation.

---

<div align="center">

If JsonStudio helps your daily JSON work, a star would mean a lot.

</div>
