# wxwork-screenshot — 企业微信风格截图工具

仿企业微信截图工具的桌面应用，基于 **Electron + React + TypeScript**（electron-vite）。
所有界面与图标均为自绘实现，不包含企业微信的任何原始资源。

GitHub：https://github.com/sunwebgo/wxwork-screenshot

## 功能

- **全局热键 `Alt+A`** 唤起截图（托盘常驻，双击托盘图标也可截图）
- **屏幕冻结 + 变暗遮罩**，多显示器各屏独立遮罩，可在任意屏上框选
- **放大镜**：8× 放大 + 网格 + 中心十字，实时显示坐标 / RGB / HEX / 色块
- **选区**：拖拽框选、8 个控制点调整大小、整体拖动、实时 `宽 × 高` 角标、选区外重新框选
- **标注工具栏**（选区下方，空间不足自动移到上方）：
  - 矩形 / 椭圆 / 箭头 / 画笔 / 马赛克 / 文字 / 序号（自动递增）
  - 文字输入框带「完成 / 取消」按钮和快捷键提示：Enter 完成、Shift+Enter 换行、Esc 取消、点击输入框外自动完成
  - 8 色调色板 + 3 档粗细（文字字号随之变化）
  - 撤销 / 重做（Ctrl+Z / Ctrl+Y）
  - 贴图（钉在桌面）、提取文字（OCR）、下载（另存 PNG/JPG）
  - 取消（Esc / 右键 / ×）、确定（√ / 双击选区 / Enter）
- **贴图**：截图可钉在桌面置顶显示，拖动移动、滚轮等比缩放、双击关闭、右上角轻量关闭按钮、右键菜单（置顶 / 复制 / 保存 / 关闭）
- **OCR 提取文字**：调用 Windows 自带 OCR（Windows.Media.Ocr，离线），识别结果面板一键复制
- **完成即复制**：确认后自动写入剪贴板并弹系统通知
- **保存**：另存 PNG/JPG；保存对话框点取消不会关闭截图界面，可继续编辑
- **开机自启**：默认开启，托盘菜单可随时勾选/取消；便携版会注册用户双击的那个 exe，而不是临时解压进程

## 性能

- 启动后常驻一个轻量 GDI 抓屏助手进程；按 `Alt+A` 时直接 BitBlt 当前屏幕（**不包含鼠标指针**），实测从热键到遮罩完全可交互约 **240–350ms**（125% 缩放，首次约 560ms）。
- 冻结帧通过内存 + 自定义协议 `wxshot://` 传给渲染层，不再每次截图写盘/读盘；空闲时 CPU 接近 0。
- 遮罩窗口创建后会再次 `setBounds`，修复 Windows 把无边框窗口高度限制在工作区、导致截图底部缺少任务栏的问题。

## 开发

```bash
git clone https://github.com/sunwebgo/wxwork-screenshot.git
cd wxwork-screenshot
npm install      # 安装依赖
npm run dev      # 开发模式（托盘启动后按 Alt+A 截图）
npm run build    # 生产构建（out/）
npm run typecheck # 类型检查
npm run dist     # 打包 Windows 便携 exe（dist/wxwork-screenshot.exe）
```

### 自动化测试（CDP）

```bash
# 终端 A
WXSHOT_DEBUG_PORT=9222 WXSHOT_SELFTEST=1 npm run dev
# 终端 B
node scripts/smoke-test.mjs          # 截图全流程（冻结帧/放大镜/选区/工具栏/撤销/确认复制）
node scripts/toolbar-click-test.mjs  # 真实鼠标点击工具栏
node scripts/pin-ocr-test.mjs        # 贴图 + OCR
```

说明：`WXSHOT_SELFTEST=1` 会在启动 2.5 秒后自动触发一次截图，供脚本驱动测试。

## 环境要求

- Node.js ≥ 18（开发环境验证于 Node 22）
- Windows 10/11（OCR 依赖系统 OCR 语言包：设置 → 时间和语言 → 语言中需包含中文或英文）

## 目录结构

```
src/main       主进程：GDI 抓屏助手、遮罩/贴图窗口、热键、托盘、剪贴板/保存、OCR
src/preload    contextBridge API（渲染层与主进程唯一通道）
src/shared     IPC 通道与类型定义
src/renderer   overlay（截图遮罩）、pin（贴图）、capture（回退用的隐藏抓屏页）
scripts        图标生成与 CDP 自动化测试脚本
resources      OCR / GDI 抓屏 PowerShell 脚本、托盘图标（打包时复制到 resources 根）
```

## 实现要点

- **GDI 抓屏助手**：启动后常驻一个 PowerShell/GDI 进程，按热键时用 `Graphics.CopyFromScreen`（BitBlt）抓取每个显示器的物理像素矩形，约 90ms，且不会把鼠标指针烧进画面；比每次初始化 `desktopCapturer` 快一个数量级。助手不可用时自动回退到 `getDisplayMedia` 视频流，再回退到 `desktopCapturer`。
- **冻结帧**：PNG 只驻留内存，通过 `wxshot://` 协议直接提供给渲染层（带 CORS 头，供 Canvas 取色），截图结束即释放。
- **遮罩**：双层 Canvas（遮罩层按选区分四块填充半透明黑；标注层裁剪到选区内绘制）；窗口创建后强制覆盖整个显示器，包括任务栏。
- **贴图**：移动时按固定目标尺寸并做物理像素对齐，避免 Windows 高 DPI 下每次 `SetWindowPos` 取整导致“越拖越大”；尺寸只由滚轮控制。
- **马赛克**：预生成 10px 块状像素化底图，笔迹作为蒙版合成
- **导出**：离屏 Canvas 按物理分辨率合成冻结帧选区 + 标注 → PNG dataURL → 主进程写剪贴板 / 另存
