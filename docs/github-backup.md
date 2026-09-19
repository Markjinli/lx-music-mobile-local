# GitHub 备份（本 fork）

登录 GitHub 后，把歌单加密上传到用户的私密仓库 `lx-music-playlist-backup`。设置里「备份与恢复」仍保留导入/导出列表；GitHub 备份收成一行摘要，点开进入独立全屏页。

全屏页分三块：

- **账号**：登录 / 退出（Personal Access Token，`repo` 权限）
- **自动备份**：歌单变更后写入自动槽；可选本机备份密码（留空则用本机密钥，仅本机可解密）
- **备份列表**：自动槽 + 最多 10 个命名快照。每份命名备份有自己的名称、密码、明文提示

提示只存在仓库的 `backups/index.json` 里，用来换机时想起「这是哪份备份」。密码从不上传。不要把真实密码写进提示。

## 为什么做成二级页面、为什么每份备份单独提示

原来的 GitHub 备份整段铺在「备份与恢复」里，加上多份备份、每份密码/提示之后会很长。二级全屏页（`Modal`，不是设置路由、也没有新的 `SETTING_SCREENS` id）把复杂度收进去，设置首页只留一行。

每份备份独立密码和明文提示，是为了：

- 自动备份可以继续用本机密码/设备密钥（`auto.ts` 不用改）
- 命名快照可以各用各的密码
- 换机恢复时先看到提示，再输入密码；解密失败显示「密码不对」，提示仍留在对话框里

## 仓库文件布局

私密仓库：`{login}/lx-music-playlist-backup`

```
backups/index.json          明文索引（v:1 + backups[]）
backups/auto.enc.json       自动槽（覆盖写）
backups/{id}.enc.json       命名快照
lx_list.enc.json            旧版单文件备份（只读兼容，不删除）
```

`backups/index.json` 示例：

```json
{
  "v": 1,
  "backups": [
    {
      "id": "auto",
      "name": "auto",
      "path": "backups/auto.enc.json",
      "hint": "",
      "updatedAt": "2026-09-18T00:00:00.000Z",
      "auto": true
    },
    {
      "id": "nxxxx",
      "name": "换机前",
      "path": "backups/nxxxx.enc.json",
      "hint": "家里那台的歌单",
      "updatedAt": "2026-09-18T00:00:00.000Z"
    }
  ]
}
```

规则：

- `id == "auto"` 的项不能删
- 命名备份最多 10 个（自动槽不计入）
- 提示只写在 index 里；加密文件里没有密码、也没有提示
- 自动槽加密密钥仍走原来的 `getSecret()`：本机密码 → 否则设备密钥
- 命名备份用创建时输入的密码加密
- 同时更新 `index.json` 若遇到 GitHub 409，会把远程条目与本地条目按 id 合并后再写，避免自动备份和新建备份互相覆盖

## 与 `lx_list.enc.json` 的兼容

旧版只写仓库根目录的 `lx_list.enc.json`。若还没有 `backups/index.json`，列表接口会把这份旧文件合成一条自动备份，无需用户重新备份。

下一次成功的自动备份会：

1. 写入 `backups/auto.enc.json`
2. 写入/更新 `backups/index.json`
3. **不删除** `lx_list.enc.json`

恢复自动槽时，若新路径没有内容，会再尝试旧路径。

## 文件清单（fork-only vs 与上游共用）

合并上游时：优先看「与上游共用」的冲突；`src/core/githubBackup/` 和 `Backup/Github*.tsx` 是 fork 自己的。

### 本 fork 新增

| 文件 | 说明 |
| --- | --- |
| `src/screens/Home/Views/Setting/settings/Backup/GithubPage.tsx` | 全屏二级页 + 登录/新建/提示/恢复/删除对话框 |
| `docs/github-backup.md` | 本文 |

`src/core/githubBackup/` 整个目录本来就是 fork 的（上游没有 GitHub 备份）。

### 本 fork 修改（上游没有对应逻辑，或仅 fork 在用）

| 文件 | 说明 |
| --- | --- |
| `src/core/githubBackup/index.ts` | 自动槽改走新布局；新增 list/create/restore/hint/delete |
| `src/core/githubBackup/githubApi.ts` | 新路径常量 + `deleteFile`；`putFile` 可关闭 409 用旧内容重试 |
| `src/screens/Home/Views/Setting/settings/Backup/Github.tsx` | 设置页一行摘要，托管全屏 `Modal` |

### 与上游共用（合并时可能冲突）

| 文件 | 说明 |
| --- | --- |
| `src/lang/zh-cn.json` | 新增 `setting_backup_github_*` 键 |
| `src/lang/zh-tw.json` | 同上（繁体） |
| `src/lang/en-us.json` | 同上 |
| `CHANGELOG.md` | Unreleased 的「本 fork」下加了一条 |

`src/config/constant.ts`、`src/utils/data.ts`、`src/types/app_setting.d.ts`、`src/config/defaultSetting.ts`、`src/core/init/index.ts` 里已有 GitHub 备份的存储键、登录态和 `githubBackup.auto`，这次**没有改**。

### 有意不改

- `src/core/githubBackup/auto.ts`：仍调用 `getGithubLoginState()` / `backupPlaylistsToGithub()`；`backupPlaylistsToGithub()` 现在写自动槽
- `src/core/githubBackup/crypto.ts`：加解密算法不变
- 不新增 `SETTING_SCREENS` id，不改 `Main.tsx`、`Vertical/*`、`Horizontal/*`
- `Backup/Part.tsx`、`Backup/index.tsx`、`Backup/actions.ts` 不动；`Part.tsx` 继续 `<Github />`
- 全屏页用 `@/components/common/Modal`（与 `ChoosePath/List.tsx` 相同），不是 `Dialog`，也不是新的设置路由

## 核心 API（`src/core/githubBackup/index.ts`）

保持：

- `loginGithub` / `logoutGithub` / `getGithubLoginState`
- `backupPlaylistsToGithub()` → 自动槽
- `GITHUB_BACKUP_REPO` / `GITHUB_BACKUP_PATH`（旧路径常量仍导出）

新增：

- `listGithubBackups()`
- `createNamedGithubBackup({ name, password, hint })`
- `restoreGithubBackup({ id, password })`（自动槽且密码为空时回退 `getSecret()`）
- `updateGithubBackupHint(id, hint)`（只改 index）
- `deleteGithubBackup(id)`（拒绝删除 auto）

解密失败抛出 `Error('decrypt failed')`，界面显示「密码不对」。
