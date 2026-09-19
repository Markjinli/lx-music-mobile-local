# 构建与签名（本 fork）

## 现状

推送到 `master` 后，`.github/workflows/build-release-apk.yml` 自动构建 **release 正式版** APK，并发布到 GitHub Releases，tag 为 `v{package.json 的 version}`。

- 输出：`android/app/build/outputs/apk/release/*.apk`
- 架构：`arm64-v8a` + `universal`（由 `android/gradle.properties` 的 `reactNativeArchitectures=arm64-v8a` 与 `universalApk true` 决定）
- 混淆：`enableProguardInReleaseBuilds = true`，即 release 默认开启 minify。上游发布的也是同样配置的 release 版，规则沿用 `android/app/proguard-rules.pro`。
- 构建完成后会清掉工作区里的 keystore，并清理 jsDelivr 的 `version.json` 缓存。

## 为什么以前是 debug 版

在 1.9.0.260919.1 及更早，CI 走的是 `./gradlew assembleDebug`，发布的也是 debug APK。

原因是没有签名密钥：

- release 构建需要 `signingConfigs.release`，它读取 `-PMYAPP_UPLOAD_*` 参数，读不到就回退到 `android/keystore.properties`
- 这个 fork 的仓库里没有 `keystore.properties`，GitHub Secrets 里也没有任何 `KEYSTORE_*`
- `signingConfigs.release` 在 Gradle **配置阶段**就会被求值，缺密钥直接报错，所以当时只能退回 debug

`android/app/debug.keystore` 是提交在仓库里的，签名稳定，所以那些 debug 版之间可以互相覆盖安装；但它是公开密钥，任何人都能签出可覆盖安装的假包，不适合继续用。

## 签名密钥

**密钥库位置（本机，不在仓库里）：**

```
C:\Users\M\lx-music-release-keystore\lx-music-release.jks
C:\Users\M\lx-music-release-keystore\README-请备份并保密.txt   ← 密码和指纹在这里
```

- 别名：`lx-music`
- 算法：RSA 2048，有效期 10000 天
- SHA256 指纹：`9A:04:D1:35:B0:94:BF:E5:26:42:2E:73:3B:B7:C7:63:9A:8F:0F:D4:26:3A:B7:14:FA:51:0C:AF:01:18:A8:BF`

**仓库 Secrets（CI 打包时读取）：**

| Secret | 内容 |
| --- | --- |
| `KEYSTORE_STORE_FILE` | `lx-music-release.jks` |
| `KEYSTORE_STORE_FILE_BASE64` | 上面 .jks 的 base64 |
| `KEYSTORE_KEY_ALIAS` | `lx-music` |
| `KEYSTORE_PASSWORD` | 密钥库密码 |
| `KEYSTORE_KEY_PASSWORD` | 密钥密码（PKCS12 下与库密码相同） |

**这份密钥库丢了会怎样：** 包名 `cn.toside.music.mobile` 将无法再发布可覆盖安装的更新，已安装用户只能卸载重装。请把 `.jks` 和那份 README 一起备份到别处（网盘 / U 盘 / 密码管理器），并且不要提交到任何仓库。

## 换签名的影响

debug 版（≤ 1.9.0.260919.1）与 release 版签名不同：

- 从 debug 版升级到 1.9.0.260919.2 需要**先卸载旧版**
- 卸载会清掉应用设置；**歌单可以在应用内「GitHub 备份」里恢复**
- 从 1.9.0.260919.2 起的后续版本之间签名一致，可以在应用内直接覆盖更新

## 发布新版本时要做的事

`version` / `versionCode` 要同步改的地方：

1. `package.json` → `version`（形如 `1.9.0.260919.2`，**不要加前导 `v`**，否则 `compareVer` 会判定比 1.8.6 还旧）和 `versionCode`（递增）
2. `publish/version.json` → `version`、`desc`，并把上一版推进 `history` 数组开头
3. `CHANGELOG.md` → 新增版本小节
4. `publish/changeLog.md` → 手动发布（`release.yml`，仅 workflow_dispatch）时用作 Release 正文

然后提交并推送 `master`，CI 会自动打包发布。

`publish/version.json` 的更新会顺带被 CI 清掉 jsDelivr 缓存，应用内「检测最新版本」才能看到新版本。

## 与上游共用的文件

| 文件 | 说明 |
| --- | --- |
| `.github/workflows/build-release-apk.yml` | fork 自己的自动构建，上游没有 |
| `android/app/build.gradle` | **未改动**，它本来就支持 `-PMYAPP_UPLOAD_*` 参数 |
| `android/gradle.properties` | CI 里用 `sed` 临时改内存参数，**不提交改动** |

CI 不改 `build.gradle`：release 构建本来就会打包 JS bundle，不需要再动 `debuggableVariants`（那是 debug 构建才有的问题）。
