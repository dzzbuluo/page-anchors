# Page Anchors

在任意网页上放置锚点，一键跳转。适用于长文档、AI 对话、无限滚动页面等需要频繁上下翻阅的场景。

Place anchor points on any webpage and jump between them with one click. Perfect for long docs, AI chat threads, infinite-scroll pages, and more.

## 功能 / Features

- **添加锚点** — 按 `Alt` 键再点击页面任意位置，或按 `Alt+Shift+A`，或点击右侧竖条顶部的 `+`
- **一键跳转** — 点击右侧竖条上的蓝色圆点，页面平滑滚动到锚点位置
- **删除锚点** — 右键或双击圆点即可删除（带缩小淡出动画）
- **查看标签** — 悬停圆点显示 "Anchor N" 标签
- **零数据收集** — 所有锚点仅存在于当前会话，刷新页面自动消失
- **适配所有页面** — 支持原生滚动和自定义滚动容器（SPA 框架）

| Action | Shortcut |
|--------|----------|
| Add anchor | `Alt+Click` or `Alt+Shift+A` or click `+` |
| Jump to anchor | Click the blue dot |
| Delete anchor | Right-click or double-click the dot |

## 安装方法 / Installation

### Chrome

1. 下载本仓库的 ZIP 文件并解压（Code → Download ZIP）
2. 打开 `chrome://extensions`
3. 开启右上角的 **"开发者模式"**（Developer mode）
4. 点击 **"加载已解压的扩展程序"**（Load unpacked）
5. 选择解压后的文件夹

### Edge

1. 下载本仓库的 ZIP 文件并解压
2. 打开 `edge://extensions`
3. 开启左下角的 **"开发人员模式"**
4. 点击 **"加载解压缩的扩展"**
5. 选择解压后的文件夹

## 文件结构 / File Structure

```
page-anchors/
├── manifest.json          # Manifest V3
├── content-script.js      # 全部运行逻辑
├── styles.css             # 样式
└── icons/                 # 扩展图标
```

零依赖，无需构建工具。Three files, zero dependencies, no build step.

## 兼容性 / Compatibility

| Browser | Status |
|---------|--------|
| Chrome | ✓ |
| Edge | ✓ |
| Firefox (MV3) | ✓ |

## 隐私 / Privacy

本扩展**不收集、不存储、不上传任何用户数据**。所有锚点仅存在于当前页面的内存中，刷新即消失。

This extension **does not collect, store, or transmit any user data**. All anchors exist only in the current page's memory and disappear on refresh.
