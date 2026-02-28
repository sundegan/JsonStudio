# Changelog

All notable changes to this project are documented here.

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
