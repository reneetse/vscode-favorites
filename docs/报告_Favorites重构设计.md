# Favorites 重构设计

以 `1.17.1`（`e1dc706ee8febd6b27910bdbb6c28a6556ffc61e`）为基线，在原仓库 `/root/gitee/vscode-favorites` 的 `refactor/favorites-core` 分支实施。基线的 84 项自动化测试及 TypeScript 检查通过。

## 目标

拖放和右键移动共用一条链路。一批文件移动结束后，更新一次收藏，通知一次受影响的树分支，再按当前编辑器定位。优先复用 1.17.1 的 `WorkspaceEdit`、树节点 ID 和分支比较。备选方案是重写 Provider，能重新划分模块，但需要重做现有路径解析、排序和两个原生视图的接入。本稿选择在现有模块内删减重复的读写和事件。

~~~text
拖放到目录 / 右键移动 → WorkspaceEdit → 确认移动结果 → 更新收藏与 NEW → 刷新树
打开文件 / 树更新完成  → 查找当前编辑器对应的树节点 → 选中，保留编辑器焦点
~~~

## 1. 移动只收尾一次

- `fileOperations.ts` 继续处理路径校验和实际移动。拖放和菜单沿用同一个 `moveItems` 入口。保留先查同名、禁止覆盖、同目录跳过、父子多选去重。用同一批已确认的源和目标处理成功与部分失败，沿用现有磁盘检查。配置写入失败时，按实际磁盘状态刷新并明确提示收藏保存失败。
- `favoriteRenames.ts` 将改写旧路径和补录新收藏合为一次读改写，使用现有写入队列。原有显式收藏及目录内的子收藏跟随路径更新，组、顺序与附加字段随记录保留。移动产生的新路径按现有规则补入发起组，由树决定显示为目录子项还是独立入口。删掉 `organizeFavoriteTargets` 为计算 `organized` 所做的目录 `stat`、计数和第二次写入。同目录操作可以更新显示，收藏记录原样保留。
- VS Code 的 `applyEdit` 也会触发 `onDidRenameFiles`。只在已有移动生命周期内暂存本批源和目标，命中配对的通知由移动入口统一收尾，其他重命名继续由事件入口处理，两边复用路径改写规则，互相独立完成。迟到通知复用同一规则，收藏或 NEW 的路径确实变化时才写入各自的数据。宿主验收覆盖撤销、连续移动和仅大小写变更。 [VS Code 文件重命名事件](https://code.visualstudio.com/api/references/vscode-api#workspace.onDidRenameFiles)

代码落点：[磁盘移动与失败收尾](../src/helper/fileOperations.ts#L36)、[路径更新与补录](../src/helper/favoriteRenames.ts#L26)、[移动入口](../src/provider/FavoritesProvider.ts#L56)、[重命名监听](../src/index.ts#L152)。

## 2. 一个入口更新树

- 在 `index.ts` 复用一段配置变更处理。写工作区设置由 VS Code 通知，写 `.vscfavoriterc` 由现有内部事件通知。语言、刷新间隔、自动定位、`files.exclude` 等仍走 VS Code 的配置事件，动态分组命令也要接收对应后端的分组变化。删掉排序命令、拖放重排等在保存配置后额外发起的树刷新。磁盘移动、创建、删除和定时扫描继续把磁盘变化交给同一个 `refresh` 入口，移动期间的请求在移动结束时合并。
- 保留 Provider 已有的分支缓存和行比较。顶层行或顺序有变化时更新根，否则只通知确实变化的已加载分支，无变化就不通知。首轮继续比较已加载分支，减少重复刷新操作本身。验收时对照 1.17.1 的磁盘读取次数和拖放耗时，再决定是否需要限制读取范围。
- `FileActivity` 保留定时扫描和 NEW 状态。首次扫描建立基线，后续扫描发现的新文件显示 NEW，打开后清除。只要已有行显示或排序发生变化，定时扫描仍应让树看到变化。

代码落点：[配置保存通知](../src/helper/configMgr.ts#L22)、[配置监听](../src/index.ts#L122)、[动态分组](../src/provider/GroupCommandProvider.ts#L15)、[分支比较](../src/provider/FavoritesProvider.ts#L96)、[定时扫描](../src/helper/fileActivity.ts#L35)。

## 3. 定位复用树的读取方式

- `findResource` 复用 Provider 返回根和子项的同一套读取逻辑，只沿目标文件的祖先目录查找。删掉 `descend` 中重复的列目录、路径判断和节点构造。文件动作用文件 URI，树节点 ID 继续由父链和 URI 组成，收藏中的同文件可以有不同的树节点身份。仍按 `files.exclude` 和可达性决定是否保留显式收藏的独立入口。
- `AutoReveal` 继续由活动编辑器变化、当前分组变化和视图变为可见触发。移动影响当前文件时，等树更新提交后定位新路径。调用前检查当前编辑器、分组和视图是否仍有效。用现有父链调用 `reveal`，选中目标并保留编辑器焦点。现有的一次宿主重试先保留，实际 VS Code 和 Remote SSH 都确认可删时再移除。 [VS Code 树视图定位](https://code.visualstudio.com/api/references/vscode-api#TreeView)

代码落点：[查找与树读取](../src/provider/FavoritesProvider.ts#L155)、[节点 ID](../src/provider/FavoritesProvider.ts#L664)、[自动定位](../src/helper/autoReveal.ts#L17)。

## 兼容与验收

沿用当前命令 ID、设置项和数据格式。覆盖旧的字符串收藏、对象收藏、单根相对路径、多根路径、分组和手动排序。中文默认、最近修改优先、复制路径、创建子目录和删除继续走原入口。独立配置写回时，仅在确认 `.vscfavoriterc` 缺失时初始化，读取或解析失败则原样保留并报错。 [独立配置写入](../src/helper/configMgr.ts#L47)

按**移动收尾 → 配置与树刷新 → 自动定位**的顺序改。每步复用现有回归，最终用打包的 VSIX 在真实 VS Code 和 Remote SSH 的临时工作区验收。

| 场景 | 通过标准 |
| --- | --- |
| 将 `docs/jack/1231/木桩训练场伤害统计时间对齐改造设计.md` 拖回 `docs/jack`，同时收藏 `jack`、`待办_零碎代码治理.md` 和 `battledoc` | 旧路径消失，新文件内容一致，收藏指向新路径。顶层顺序不变时只通知 `jack` 一次，`battledoc` 的展开状态保留，无重复 ID。分别用手动和最近修改排序重放。 |
| 多选移入子目录、原地归位、同名冲突、部分失败和撤销 | 多选只处理选中项，原地归位保留收藏，同名不覆盖。收藏只跟随已确认移动的文件。配置无法保存时显示磁盘与收藏各自的结果。 |
| 从 Quick Open 打开收藏内的文件，移动期间快速切换编辑器 | 当前可见的收藏视图选中最新文件，编辑器保留焦点。树更新后能定位已移动文件的新路径。 |
| 定时扫描有新增和无新增的情况 | 新文件自动出现，打开后清除 NEW。无变化时树更新事件为零。 |

## 自动化回归覆盖

在仓库根目录运行 `npm test`。命令测试通过 VS Code API 适配器调用插件，文件与 Git 验证使用临时真实目录。

| 使用场景 | 自动化用例 |
| --- | --- |
| 收藏与分组 | 添加、批量添加、取消收藏、切换当前文件和目录的收藏状态、创建与切换分组、外部配置更新。[收藏命令](../test/batch.test.cjs) · [分组](../test/sort-language.test.cjs) |
| 菜单与打开文件 | 三种路径复制、多根和外部路径、预览和双击固定、在侧边打开、交给系统文件管理器或 VS Code 资源管理器定位、诊断命令和英文菜单别名。[命令](../test/batch.test.cjs) |
| 排序与语言 | 名称、时间正反序、文件类型、四种手动调整、中文默认、英文与跟随 VS Code。[排序与语言](../test/sort-language.test.cjs) |
| 文件操作 | 创建子目录、批量移动、拖入和拖出、冲突与部分失败、外部重命名和撤销、删除及确认保护。[移动](../test/file-management.test.cjs) · [拖放](../test/panel-moves.test.cjs) · [删除](../test/delete-files.test.cjs) |
| 刷新和定位 | 手动与定时刷新、NEW 的出现及移除、移动与刷新并发、快速切换编辑器、两个视图定位及排除规则。[定时刷新](../test/refresh-new-files.test.cjs) · [定位](../test/auto-reveal.test.cjs) |
| 持久化、环境与 Git | 工作区设置、独立配置、配置损坏保护、多根工作区、远程 URI、Windows 路径及普通和强制暂存。SSH 目录收藏复用父目录 URI 并保留主机标识。[文件操作](../test/file-management.test.cjs) · [路径与 Git](../test/batch.test.cjs) |

## 首轮重构验证

- `npm test` 共 103 项通过，比基线多 19 项。TypeScript、生产构建和 VSIX 打包通过。
- 最终 VSIX 在 VS Code 1.107.0 的临时桌面工作区完成真实拖放和 Quick Open。手动排序、时间排序根顺序不变、时间排序根顺序改变三种场景均核对文件内容、收藏路径和两个视图的选中。另用原生 Undo 还原了文件与收藏路径。Remote SSH URI 已有自动化用例，真实 Remote SSH 窗口待验收。
- 在同一批两文件移动的 API 适配器对照中，收藏写入由 2 次降为 1 次，文件 `stat` 由 18 次降为 15 次，目录读取为 5 次。真实桌面手动排序单轮拖放记录为基线约 1.23 秒、重构约 1.13 秒，包含测试驱动和界面等待，供复验定位使用。

## 后续修复验证

- 加入删除后立即通知树、连续移动与慢刷新并发、目录列表复用三项回归，`npm test` 共 106 项通过，TypeScript 检查通过。
- 在 VS Code 1.107.0 的临时桌面工作区，用打包的 VSIX 验证了同一文件拖入 `1231` 再拖出，以及确认删除文件和目录后树节点消失。SafeDepot 的 SSH 日志缺少对应的移出请求记录，已补充拖放入口、目标行和阶段耗时日志供复测。
