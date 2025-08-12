# 🎮 Neural Tetris AI - 头部控制俄罗斯方块游戏

一个创新的俄罗斯方块游戏，通过摄像头识别头部动作来控制游戏，带有精美的视觉效果和音效。

## 🚀 快速体验

| 在线游戏 (PWA) | Android APK |
| :--- | :--- |
| [**🎮 点击立即体验**](https://jasonydg.github.io/Brain_Tetris/) | [**📥 前往 Releases 下载**](https://github.com/JasonYDG/Brain_Tetris/releases) |
| *支持所有现代浏览器，无需下载* | *下载最新版本APK，支持离线游戏* |

---

## 🎬 游戏演示

[![游戏演示视频](https://github.com/JasonYDG/Brain_Tetris/raw/main/www/icon-192.png)](https://github.com/JasonYDG/Brain_Tetris/raw/main/www/Demo.mp4 "点击播放演示视频")

*点击上方图片即可播放或下载 `Demo.mp4` 演示视频*

**视频演示内容:**
- ✅ **头部左右倾斜** → 控制方块左右移动
- ✅ **张嘴动作** → 触发方块旋转
- ✅ **抬头动作** → 加速方块下降
- ✅ **游戏界面** → 现代化的UI设计和流畅的动画效果
- ✅ **音效系统** → 完整的游戏音效和BGM反馈

---

## ✨ 功能特点

- 👨‍💻 **头部动作控制**: 通过摄像头实时识别头部姿态，实现真正的“意念”操控。
- 🎨 **精美画面**: 现代化的UI设计和流畅的动画效果。
- 🔊 **音效系统**: 完整的游戏音效和经典背景音乐，使用Web Audio API实时生成。
- 🏆 **智能积分系统**: 多行消除奖励更高分数，等级越高，得分越多。
- 🧱 **方块分布优化**: 智能生成长条方块，确保游戏体验和平衡。
- 📱 **响应式设计**: 完美适配桌面和移动设备。
- ⌨️ **多种控制方式**: 支持头部控制、键盘控制和触摸控制，满足不同场景需求。

## 🕹️ 控制方式

### 头部控制 (主要)
| 动作 | 效果 | 说明 |
| :--- | :--- | :--- |
| **向左/右倾斜头部** | 方块左/右移 | 轻微倾斜即可，支持连续移动 |
| **张嘴** | 方块旋转 | 快速张合嘴巴，精准识别 |
| **抬头** | 加速下降 | 明显抬头动作触发加速 |

### 键盘控制 (备用)
- **←** / **→** : 左/右移
- **↓** : 加速下降
- **↑** / **空格** : 旋转
- **P** : 暂停/继续

### 触摸控制 (移动设备)
- **左右滑动**: 左右移动
- **向下滑动**: 加速下降
- **点击屏幕**: 旋转

## 🛠️ 技术实现

- **核心框架**: 原生 HTML5 + CSS3 + JavaScript (无依赖)
- **面部识别**: Google MediaPipe Face Mesh
- **游戏引擎**: Canvas 2D API
- **音效系统**: Web Audio API
- **摄像头**: WebRTC `getUserMedia` API

## 📂 文件结构

```
.
├── www/                    # Web应用资源目录
│   ├── index.html          # 主页面
│   ├── style.css           # 样式文件
│   ├── tetris.js           # 核心游戏逻辑
│   ├── head-control-simple.js # 头部动作识别与控制
│   ├── game-fixed.js       # 游戏主控制器
│   ├── sw.js               # Service Worker
│   ├── manifest.json       # PWA 配置文件
│   ├── Demo.mp4            # 游戏演示视频
│   └── sounds/             # 音效资源目录
├── config.xml              # Cordova 配置文件
├── capacitor.config.json   # Capacitor 配置文件
├── package.json            # 项目依赖与脚本
├── README.md               # 说明文档
└── .github/                # GitHub Actions 工作流
```

## 📝 开发说明

如果需要修改控制灵敏度，可以在 `www/head-control-simple.js` 中调整以下参数：

```javascript
this.headTiltThreshold = 0.15;  // 头部倾斜阈值
this.nodThreshold = 0.04;       // 仰头阈值
this.mouthOpenThreshold = 0.02; // 张嘴检测阈值
this.actionCooldown = 300;      // 动作冷却时间(毫秒)
```

## 📄 许可证

本项目采用 [MIT](https://opensource.org/licenses/MIT) 许可证。