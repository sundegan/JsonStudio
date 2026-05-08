# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added
- **Mixed log-like text and JSON formatting**: detect JSON, JSON5-like, escaped JSON, and repairable JSON fragments inside log-like text, keep the original editor content unchanged, and display the extracted JSON data as formatted structured results.
- **Auto-numbered untitled tabs**: new documents are named `Untitled-1`, `Untitled-2`, and so on for easier tab identification.
- **Unit tests for log JSON extraction**: cover mixed logs, multiple fragments, JSON5-like input, escaped JSON, invalid content, and braces inside strings.

### Improved
- **Paste normalization**: auto-format pasted JSON in diff mode and standalone JSON/JSON5/escaped JSON in normal editor mode where appropriate.
- **File tab workflow**: prompt before closing unsaved changes, reuse an already opened file tab instead of opening duplicates, and keep destructive editor operations undoable.
- **Desktop titlebar theming**: align the macOS window titlebar background with the active light/dark theme.
- **Shortcut registration robustness**: prevent application startup failure when shortcut registration fails.

### Fixed
- **JSON formatting order**: preserve object key order instead of sorting keys alphabetically by default.
- **Async paste race**: avoid overwriting newer user edits when asynchronous paste formatting finishes after additional input.

## [1.1.0] - 2025-03-10

### Added
- **JSONPath query mode in Tree View**: add a query mode switcher so users can choose between `JMESPath` and `JSONPath` directly in the Tree View toolbar.
- **JSON5 syntax**: The editor and Tree View support parsing and matching of JSON5 data.
- **JSON tool landing pages**: add dedicated website pages for JSON Formatter, Converter, Schema, and Diff.
- **Search engine site verification**: add site verification metadata for Google, Baidu, 360 Search, and Sogou.

### Improved
- **Editor highlighting**: optimize JSON/JSON5 highlight feedback to improve readability during querying and navigation.
- **Project website SEO**:
  - optimize page titles, descriptions, feature wording, and favicon display
  - improve canonical/alternate links and domain switching
  - refine sitemap and search indexing metadata
- **Documentation updates**:
  - update website links and badge formatting in README
  - add dark-mode screenshots for code generation docs
- **Schema view details**: simplify the static divider icon styling for a cleaner and more consistent appearance.

### Fixed
- **Desktop Monaco initialization**: initialize Monaco using the bundled instance to improve desktop build reliability.
- **Error icon styling**: adjust the circular details of the error icon.

## [1.0.0] - 2025-03-05

🎉 **First Stable Release!**

### Added
- **File watching system**: Automatically detect and reload files when modified externally by other programs.
  - Auto-reload if no unsaved changes exist.
  - Show notification if file has unsaved changes to prevent data loss.
  - 500ms debounce mechanism to avoid frequent triggers.
- **Multi-file drag & drop**: Support opening multiple files at once by dragging them into the application.
- **Intelligent tab reuse**: When opening a file, reuse empty untitled tabs instead of always creating new ones.
- **Horizontal scrollbar for toolbar**: Toolbar now supports horizontal scrolling when window is too narrow.
- **Reusable ConfirmDialog component**: Modern, customizable confirmation dialog replacing native browser confirm.
- **Reset all shortcuts**: New button in settings to reset all keyboard shortcuts to defaults.
- **GitHub Pages landing page**: Comprehensive project website with bilingual support (English/Chinese).
  - SEO optimization with Open Graph, Twitter Card, and JSON-LD structured data.
  - Feature showcase with comparison table.
  - Interactive screenshot lightbox.

### Improved
- **Increased localStorage limit**: Raised content size limit from 100KB to 1MB per tab for better support of large JSON files.
- **Improved window size constraints**:
  - Minimum width increased from 800px to 1000px.
  - Minimum height increased from 600px to 650px.
  - Ensures all toolbar buttons remain visible.
- **Enhanced tab management**:
  - Fixed tab name inconsistency (now always shows "Untitled" for new tabs).
  - Improved tab switching logic with better content synchronization.
  - Fixed activeTabId initialization issue.
  - Optimized tab closing logic to correctly calculate next active tab.
  - Tab limit (10 tabs) now shows user-friendly toast notification instead of console warning.
- **Redesigned color system**: 
  - Improved dark/light theme variables with better contrast.
  - Unified UI elements with glassmorphism effects.
  - Standardized hover states and semantic border colors across all components.
- **Modernized UI components**:
  - Settings Panel: Enhanced aesthetics with deep glassmorphism and improved layout responsiveness.
  - Convert View: Standardized pane headers, back buttons, and format selectors.
  - CodeGen View: Unified styling with premium look consistent with main editor.
  - Schema View: Aligned with overall design language.
  - Status Bar: Improved visual consistency.
  - Toast notifications: Better icon rendering and feedback messages.
  - Tab Bar: Refined styling and interaction states.
- **Enhanced toolbar functionality**:
  - Added content validation checks before performing actions (export, format, minify, etc.).
  - Improved toast messages for better user feedback when no content is available.
  - Refined toolbar aesthetics with unique color palette for icons.
  - Resolved empty state handling issues.
- **Performance optimizations**:
  - Removed redundant `isModified` update calls.
  - Reduced unnecessary state saves.
  - Improved content sync efficiency when switching tabs.
- **Documentation improvements**:
  - Updated README files with new screenshots for both themes.
  - Added lightbox modal for image viewing.
  - Improved feature descriptions and localization.
  - Enhanced SEO with better metadata.

### Fixed
- **Tab management bugs**:
  - Fixed issue where tab names sometimes showed "Default" instead of "Untitled".
  - Fixed bug where opening a file into an empty tab didn't display content.
  - Fixed activeTabId pointing to wrong tab after closing tabs.
  - Fixed initial state having null activeTabId.
- **File operations**:
  - Fixed stats not updating after opening files.
  - Fixed file content not syncing when reusing empty tabs.
- **UI issues**:
  - Fixed toolbar buttons being hidden when window is resized to minimum width.
  - Fixed typing and reactivity warnings on `activeTab` bindings.
  - Fixed info toast SVG icon rendering issues.

## [0.5.0] - 2026-03-04

### Added
- Image export powered by Rust-native rendering, with watermark and clipboard support.
- JSON Schema generation and validation.
- Generate class/struct code in multiple programming languages from JSON data, and reverse conversion.
- Bidirectional conversion between JSON and YAML, XML, TOML, CSV, with rainbow column highlighting for CSV.
- One-click JSON data repair.
- Full Chinese/English internationalization, with language selector in settings.
- Customizable editor shortcuts in settings panel.
- New Rose Ivy light theme.

### Improved
- Toolbar layout reorganized with clearer group dividers and icon refinements.
- Tree View layout and responsiveness.
- Diff editor styles, removed standalone DiffTabBar component.

### Fixed
- Fixed file association opening blank on cold start due to race condition.
- Fixed image export blank/blurry for large content.

### Removed
- Diff mode keyboard shortcut.
- Quiet Light theme (replaced by Rose Ivy).

## [0.4.0] - 2026-02-28

### Added
- **JMESPath query support**: replace the simple text filter in Tree View with full JMESPath expressions, enabling powerful JSON querying with real-time match highlighting and automatic ancestor expansion.
- **New color themes**: add Dracula, Nord, Solarized Light, Quiet Light, and Catppuccin Latte themes for the editor.
- **JSON file associations**: register `.json` file type in system so the OS can open JSON files directly with Json Studio.
- **Tree View close button**: add a close button to quickly hide the Tree View panel.
- **JMESPath help popover**: built-in quick reference with example data and common query patterns.

### Improved
- **Copy path + value**: Tree View copy button now copies both the JMESPath path and value (e.g. `users[0].name: "Alice"`) instead of just the JSON Pointer path.
- **Expand/Collapse toggle**: merge expand-all and collapse-all into a single toggle button with dynamic icon.
- **JSON error display**: show a clearer warning icon and "Invalid JSON Format" message instead of a text-only error.
- **Settings panel**: refactor layout structure and styling for better readability and maintainability.
- **Tree View layout**: improve toolbar spacing, alignment, and responsiveness across different panel widths.
- **CSS architecture**: introduce CSS variables for JSON data type colors (object, array, string, number, boolean, null) for consistent theming.

### Fixed
- Fixed find widget hover event propagation causing unintended behavior in the Monaco editor.
- Fixed editor content changes not being saved correctly when switching tabs.

### Removed
- Removed the standalone `JsonQueryPanel` component (functionality replaced by JMESPath query in Tree View).

## [0.3.0] - 2026-01-13

### Added
- **Multi-tab support**: implement tab management with drag-and-drop reordering.
- **Tab context menu**: right-click menu with Pin Tab, Close Other Tabs, Close All Tabs options.
- **Pinned tabs**: ability to pin important tabs to prevent accidental closure.
- **JSON Tree View**: visualize JSON structure in a tree panel beside the editor with expand/collapse, search filtering, and click-to-locate functionality.
- **JSON Query Panel**: query JSON data using JSONPath or JSON Pointer expressions.
- **Diff mode support multi-tab**: independent tab management for left and right sides in diff mode.
- **Line Height setting**: allows users to manually adjust editor line height.

### Fixed
- Fixed diff mode tab switching not updating editor content.
- Fixed pinned tab becoming larger by moving pin icon to the left spacer area.

### Improved
- Tree View sidebar now spans the full height below toolbar (alongside both tab bar and editor area).
- Status bar now highlights diff line count in diff mode.
- Adjusted status bar font size (13px) and reduced height for a more compact look.
- Compressed Tree View header section for better space utilization.
- Unified tab bar height (24px) and styling between normal mode and diff mode.
- Updated toolbar icons for new file and tab pin.
- Disabled browser context menu in editor for cleaner experience.
- Modularized JsonEditor components (toolbar, query panel, status bar, toast) for better maintainability.

## [0.2.0] - 2026-01-11

### Added
- File operations: new/open/save/save-as, plus drag-and-drop.
- Diff mode for in-editor JSON comparison.
- Auto-format on paste.
- Changelog documentation for release notes.
- Makefile for streamlined development and build workflows.

### Improved
- Clipboard handling and shortcut behavior.
- JSON formatting experience and Monaco editor integration.
- Window management behavior for shortcut commands.

## [0.1.0] - 2026-01-07

### Added
- Initial release.
- JSON formatting and minification.
- Escape/unescape utilities.
- JSON statistics (keys, depth, size) and validation.
- Monaco-based JSON editor with syntax highlighting, folding, and line numbers.
- Clipboard integration and global shortcuts.
- Theme switching (light/dark) and editor settings (font size, indent), plus shortcut settings.
