# Electron Desktop 与 Web 图标

Omnixa 图形的几何源是 `packages/ui/src/components/logo.tsx` 中的 `WING_STANDARD` 和生产 `Splash` 的中心核 rect。生成脚本读取这些字面参数，交给 librsvg 按 SVG 的曲线、弧线与旋转语义栅格化；不读取对话目录的候选 PNG，也不另写一套采样曲线。

## 生成与核查

从仓库根执行：

```sh
python3 packages/desktop/scripts/generate-brand-icons.py
python3 packages/desktop/scripts/generate-brand-icons.py --check
```

生成是显式的开发动作；打包仍复制已检入的产物。`--check` 只读核对生产几何、生成脚本与产物哈希、PNG/ICO/ICNS 尺寸、实底透明度和 Dock payload。生产几何或脚本改变后重新生成；平台外观仍由对应系统上的视觉验收确认。

生成环境使用 Python、启用原生 `librsvg` decoder 的 FFmpeg 与 Pillow；这些是图标制作工具，不加入应用运行依赖。当前 Python 为 3.12.3、Pillow 为 10.2.0；完整 FFmpeg 版本和构建配置记录在生成 manifest。Ubuntu 对应开发工具包为 `ffmpeg`、`python3-pil`。脚本明确选择 `librsvg`，不依赖 ImageMagick 的其它 SVG 实现或 Python Cairo 适配模块。

`scripts/brand-icons.manifest.json` 记录生产图形/字标源及哈希、脚本哈希、执行命令、实际工具版本和每个产物的哈希/尺寸/平台角色。`source-macos.svg`、`source-web.svg` 与 `scripts/social-share-source.svg` 是同一次生成保留的完整渲染输入，可用于重建和审查。记录不含时间戳，便于同工具版本下重复生成比较。

## 平台与通道

三通道保留暗色 Prod、浅色带工程网格的 Beta、蓝色带工程网格和暖色核的 Dev。材质仅改变背景、翼面与中心核颜色，共用生产标准几何。

- macOS：`source-macos.svg` 保留本身的圆角主体、阴影与留白；`icon.icns` 包含 16/32/64/128/256/512/1024px 普通槽位及对应 2× 槽位。`dock.png` 和 `128x128@2x.png` 是 `ic13` 的同一份 256px PNG 字节。
- Windows：`icon.ico` 的 PNG payload 由 Web 实底 SVG 分别渲染为 16/32/48/64/128/256px，目录尺寸与实际 payload 一致。
- Linux：`32x32.png`、`64x64.png`、`128x128.png`、`256x256.png`、`512x512.png` 使用实底图形，避免套用 macOS 透明留白。当前 electron-builder 的 `set` 目录解析仅收数字 PNG 文件名；存在这些文件时 `icon.png` 不进入结果，所以显式保留 256/512px 数字文件。`Square*`、`StoreLogo.png`、`dock.png` 与 `128x128@2x.png` 不属于该扫描集。
- Web/PWA：`ios/AppIcon-60x60@3x.png` 是 180px apple-touch 输入；`android/mipmap-xxxhdpi/ic_launcher.png` 是 192px PWA 输入；512px PWA 输入复用 `icon.png`。画布全部不透明，生产几何在 192px 上另外核对 maskable 中心 40% 半径安全区。系统负责最终遮罩。
- 公共 favicon：`packages/ui/src/assets/favicon` 的当前 SVG、96px PNG、ICO（16/32/48px）、180px apple-touch 和 192/512px PWA 文件由同一 Prod Web SVG 输出；`-v3` 文件保持对应字节一致。Desktop 与 App 的既有消费者继续读取这些文件。
- 社交预览：App 与 Desktop 的 OG/Twitter 实际消费 `packages/ui/src/assets/images/social-share.png`。脚本保留其 1280×721 尺寸、工程网格、背景和既有 tagline 像素，仅替换中央品牌区；新字形来自生产 Wordmark 的 `LETTER_PATH`/`CORE_PATH`，没有字体依赖。去除品牌后的背景嵌入源 SVG 并记录哈希，重复生成不会把旧字形当背景保留。`social-share-black.png`/`social-share-zen.png` 无本次消费者，不重制。

只重建上述当前消费者及生成源，不批量改写无消费方的历史 iOS/Android/Windows 目录。

在 `packages/desktop` 使用现有命令复制指定通道到打包资源：

```sh
bun scripts/copy-icons.ts dev
```

Beta/Prod 使用相应参数。`resources/icons` 是复制输出；修改源通道并重新复制，不能只修改资源副本。
