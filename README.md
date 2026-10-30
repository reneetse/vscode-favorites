# vscode-favorites

[![vscode version][vs-image]][vs-url]
![][install-url]
![][rate-url]
![][license-url]

An extension that lets the developer mark resources (files or folders) as favorites, so they can be easily accessed.

![](https://raw.githubusercontent.com/leftstick/vscode-favorites/master/images/preview.gif)

## Install

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

### Drag and Drop Support

#### Reordering Favorites

You can reorder favorites within the favorites panel by dragging and dropping them to your desired position. The sort order will automatically switch to "MANUAL" when you start dragging.

#### Adding Files via Drag and Drop

You can also add files to your favorites by dragging them from:

- **Editor tabs**: Drag the tab of an open file directly into the favorites panel
- **Explorer**: Drag files or folders from the Explorer view into the favorites panel

Your favorites are listed in a separate view and can be quickly accessed from there.

### Configuration

```javascript
{
    "favorites.resources": [], // resources path you prefer to mark
    "favorites.sortOrder": "ASC", // DESC, MANUAL
    "favorites.saveSeparated": false // whether to use an extra config file
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

   Run the batch-command checks (including real temporary Git repositories) with:

   ```bash
   npm run test:batch
   ```

2. **Run tests**:

   ```bash
   pnpm run test
   ```

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
