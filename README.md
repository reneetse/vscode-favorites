# vscode-favorites

[![vscode version][vs-image]][vs-url]
![][install-url]
![][rate-url]
![][license-url]

An extension that lets the developer mark resources (files or folders) as favorites, so they can be easily accessed.

![](https://raw.githubusercontent.com/leftstick/vscode-favorites/master/images/preview.gif)

## Install

For this repository's customized **1.17.1** build, install `releases/vscode-favorites-1.17.1.vsix` using **Extensions: Install from VSIX...**, then run **Developer: Reload Window**. See [the Chinese usage guide](docs/jack/指南_Favorites文件管理与排序.md). The Marketplace installation below uses the original distribution.

Launch VS Code Quick Open (`cmd`/`ctrl` + `p`), paste the following command, and press Enter.

```
ext install howardzuo.vscode-favorites
```

## Usage

### Add to Favorites

An **Add to Favorites** command in Explorer's context menu saves links to your favorite files or folders into your _*`XYZ`*_`.code-workspace` file if you are using one, else into the `.vscode/settings.json` file of your root folder.

### Multiple Selection and Git Staging

Both Favorites views support **Shift+click** for a range and **Ctrl+click** (**Cmd+click** on macOS) for individual selections.
Right-click the selection to remove favorites or open all selected files to the side. Explorer's **Add to Favorites** and group commands also accept multiple files or folders.
Removing favorites only removes their shortcuts; folder contents are not individual favorites and cannot be removed this way.

For files in an open Git repository, the Favorites context menu offers:

- **Stage Changes**: stage the selected files while respecting Git ignore rules.
- **Force Stage Changes (Include Ignored Files)**: stage the selected files even if Git ignores them.

Staging uses the saved file contents, reports per-file failures, and does not commit or push. Only selected files are processed; folders and virtual resources are rejected before staging starts.
Once an ignored file is staged and committed, Git tracks it and ignore rules no longer hide its changes.

**Move Up**, **Move Down**, **Move to Top**, and **Move to Bottom** require a single selection. Multiple selections show a message without changing the order.

### Copy File Name and Path

Right-click files or folders in either Favorites view and choose **Copy File Name** (including the extension) or **Copy File Path** (absolute path).
Both commands also work on folder children and multiple selections, copying one entry per line. Remote files use their filesystem paths; other URI resources keep the full URI when copying paths.

**Copy Relative Path** copies the path relative to the resource's workspace folder, without a workspace folder prefix even in multi-root workspaces. Files outside the workspace (or when no folder is open) use their absolute paths; other URI resources keep the full URI. Folder children and multiple selections are supported.

### Toggle Favorite for Active File

Use the **Toggle Favorite** command from the Command Palette (`cmd`/`ctrl` + `shift` + `p`) to quickly add or remove the currently active file from your favorites.

### Toggle Folder Favorite for Active File

Use the **Toggle Folder of Active File** command from the Command Palette (`cmd`/`ctrl` + `shift` + `p`) to quickly add or remove the folder containing the currently active file from your favorites.

### Sorting and Language

Click **选择排序方式 / Choose a sort order** in either Favorites view to select name ascending/descending, recently/oldest modified first, file type, or manual order. Names use natural numeric ordering (for example, `note2.md` before `note10.md`). Folders are listed first except in manual order. The default is recently modified first. The selected mode also applies to expanded folders; periodic refresh (30 seconds by default), saving a file, or manual refresh updates the view.

The interface defaults to Chinese. Set `favorites.language` to `zh-CN`, `en`, or `auto` (follow VS Code). Menus, prompts, view titles, and group messages update without reloading.

### Refresh, New Files and Active Editor

Set `favorites.refreshInterval` to the refresh interval in seconds (default `30`; `0` disables the timer). Refresh scans favorite folders without filesystem watchers. The first scan establishes a baseline; later new files show a blue **NEW** icon until displayed in an editor. This state is kept per workspace and follows plugin file moves.

`favorites.autoReveal` defaults to `true`: active files inside the current favorite group are selected and their parents expanded in visible Favorites views, retaining editor keyboard focus. Hidden views follow the active file when shown. Only reachable nodes are revealed; independently bookmarked excluded files retain their own root entries.

### Creating Folders and Moving Files

Reachable nested bookmarks are displayed under their actual favorite directories, without deleting the stored bookmark. Files excluded from folder contents keep an independent root entry. An independently bookmarked nested item can still be removed from favorites.

Right-click a folder and choose **新建子文件夹 / New Folder**. Right-clicking a file creates the folder beside that file.
Select files or folders, then use **移动到文件夹… / Move to Folder...** to choose an existing destination. Dragging resources from within a Favorites view onto a folder also moves the actual files. External Explorer/editor drops only add favorite shortcuts; select those entries in Favorites to move them. Same-name conflicts (including case-only differences among selected items) are rejected before the batch starts, and favorite paths in all groups follow moved files and folder descendants. Selecting a folder and its child moves the folder once. **移到上一级目录 / Move to Parent Folder** moves items out of their current container, and files moved outside favorite folders retain a standalone bookmark. The destination picker displays full paths.

File moves use VS Code workspace edits and participate in Undo. Runtime I/O errors can interrupt a batch: the error reports completed items when they can be verified. Inspect the source and destination before retrying; an interrupted batch is not guaranteed an Undo entry. Favorites are updated for moves that completed. Operations support filesystems on the VS Code host, including Remote SSH; different filesystem providers cannot be mixed in one move.

### Deleting Files and Diagnostics

**删除文件／文件夹… / Delete Files / Folders...** deletes actual disk contents, with a confirmation listing full paths. It first requests trash; when trash is unsupported it asks separately before permanently deleting. Roots, workspace/home directories and their ancestors are protected; symbolic links and direct virtual/remote-provider URIs are rejected. Normal files on a Remote SSH extension host use host file URIs and are supported. **Remove from Favorites** only changes bookmarks.

Run **收藏：查看操作日志 / Favorites: Show Diagnostics** to inspect source paths, selected destinations, skipped moves, completed operations and errors in the Favorites output channel.

### Drag and Drop Support

#### Reordering Favorites

Drop onto a file or empty space to reorder/add favorite shortcuts. This switches the sort order to "MANUAL". Dragging within Favorites onto a folder moves the actual files into it and preserves the selected sort mode. External drops add shortcuts.

#### Adding Files via Drag and Drop

You can also add files to your favorites by dragging them from:

- **Editor tabs**: Drag the tab of an open file directly into the favorites panel
- **Explorer**: Drag files or folders from the Explorer view into the favorites panel

Your favorites are listed in a separate view and can be quickly accessed from there.

### Configuration

```javascript
{
    "favorites.resources": [], // resources path you prefer to mark
    "favorites.sortOrder": "MTIME_DESC", // ASC, DESC, MTIME_ASC, FILETYPE, MANUAL
    "favorites.language": "zh-CN", // en, auto
    "favorites.refreshInterval": 30, // seconds; 0 disables periodic refresh
    "favorites.autoReveal": true, // follow the active editor in visible Favorites views
    "favorites.saveSeparated": false, // whether to use an extra config file
    "favorites.groups": ["Default"], // the groups you have created
    "favorites.currentGroup": "Default" // determine the current using group
}
```

> You normally don't need to modify this config manually. Use context menus instead.

## Changelog

[Changelog on Marketplace](https://marketplace.visualstudio.com/items/howardzuo.vscode-favorites/changelog)

## LICENSE

[GPL v3 License](https://raw.githubusercontent.com/leftstick/vscode-favorites/master/LICENSE)

## Development

### Environment Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/leftstick/vscode-favorites.git
   cd vscode-favorites
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Run development server**:

   ```bash
   pnpm run watch
   ```

4. **Launch extension**:
   - Press `F5` in VS Code
   - This will open a new VS Code window with the extension loaded

### Build and Test

1. **Build the extension**:

   ```bash
   pnpm run build
   ```

   This checks TypeScript, builds the production bundle, and packages `releases/vscode-favorites-<version>.vsix` in one command. `npm run build` and `npm run package` are equivalent. Install dependencies before the first build; the output VSIX is committed for direct installation via **Extensions: Install from VSIX...**.

   Run the command, filesystem, sorting, and language checks (including real temporary files and Git repositories) with:

   ```bash
   npm test
   ```

2. **Run tests**:

   ```bash
   pnpm run test
   ```

   These tests run without a VS Code window, using a VS Code API adapter and real temporary files. They do not perform live desktop/Remote SSH UI acceptance. The legacy host test files in `src/test/` are not executed by this command.

   Menu contributions and command aliases are generated from `src/i18n/titles.en.json` and `src/i18n/zh-CN.json` by `npm run sync:menus`; compilation and packaging run this step automatically. Run it after changing command declarations or translations.

3. **Package the extension**:
   ```bash
   pnpm run package
   ```

### Contribution Guidelines

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Run tests** to ensure your changes don't break existing functionality
5. **Commit your changes** with a descriptive commit message
6. **Push to your fork**
7. **Create a pull request**

### Code Style

- Follow TypeScript best practices
- Use `async/await` for asynchronous operations
- Add appropriate error handling
- Write clear and concise comments
- Maintain consistent code formatting

### Development Tools

- **TypeScript**: For type-safe code
- **esbuild**: For fast builds
- **Mocha**: For unit tests
- **VS Code Test**: For extension integration tests

[vs-url]: https://marketplace.visualstudio.com/items?itemName=howardzuo.vscode-favorites
[vs-image]: https://img.shields.io/visual-studio-marketplace/v/howardzuo.vscode-favorites
[install-url]: https://img.shields.io/visual-studio-marketplace/i/howardzuo.vscode-favorites
[rate-url]: https://img.shields.io/visual-studio-marketplace/r/howardzuo.vscode-favorites
[license-url]: https://img.shields.io/github/license/leftstick/vscode-favorites
