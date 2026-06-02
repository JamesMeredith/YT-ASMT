# 麻精药品智能柜售后运维工具 v2.0

---

## 📋 项目简介

针对麻精药品智能柜的全生命周期售后运维工具，覆盖设备绑定、故障工单处理、巡检、维保台账、需求管理、知识库等核心业务场景。

**核心价值**：
- 📋 **流程标准化**：工单五阶闭环管理（报修→排查→修复→复核→回访）
- 📊 **数据可视化**：设备状态、故障趋势、响应时长实时监控
- 🧠 **知识沉淀**：故障解决方案自动入库，形成可检索知识库
- 🔐 **权限管控**：三级角色体系，数据隔离，审计留痕
- 📱 **轻量部署**：零配置开箱即用，支持单机/局域网/云部署

---

## 🏗️ 技术栈

| 层次 | 技术 | 版本要求 |
|------|------|---------|
| 前端 | Vanilla JS + CSS3 | 零框架依赖 |
| 后端 | Node.js + Express | ≥ 16.x |
| 数据库 | SQLite | 开箱即用 |
| 认证 | Token-based + bcryptjs | - |

---

## 📁 项目结构

```
YT-ASMT/
├── start.bat                     # Windows 一键启动脚本
├── start_portable.bat            # 便携版启动脚本（无需安装 Node）
├── README.md                     # 项目说明（本文件）
├── DOCUMENTATION.md              # 完整技术文档
├── ecosystem.config.js           # PM2 生产环境配置
├── server/
│   ├── server.js                 # Express 主服务器入口
│   ├── db.js                     # SQLite 数据库初始化与种子数据
│   ├── auth.js                   # 认证/授权中间件
│   ├── package.json              # Node 依赖配置
│   └── node_modules/             # 依赖包目录
├── web/
│   ├── index.html                # 主页面（SPA 架构）
│   ├── css/style.css             # 全局样式
│   └── js/
│       ├── app.js                # API 客户端与工具函数
│       └── pages.js              # 页面渲染逻辑
├── data/
│   └── yt_asmt.db                # SQLite 数据库文件（自动创建）
└── scripts/                      # 辅助脚本目录
    ├── check_users.js            # 用户数据检查工具
    ├── check_db.js               # 数据库完整性检查
    └── test_api.js               # API 测试脚本
```

---

## 👥 角色与权限

| 角色 | 权限范围 | 典型用户 | 默认账号 |
|------|---------|---------|---------|
| **总部** | 全部数据可见，复核闭环，审计日志，数据统计 | 公司总部技术/管理人员 | `admin01` |
| **经销商** | 本省份工单及设备数据，需求提交 | 经销商售后接口人 | `dealer01`, `dealer02` |
| **工程师** | 个人工单、设备安装绑定、巡检、维保、需求提交 | 驻场/区域技术员 | `engineer01`, `engineer02`, `engineer03` |

> ⚠️ **安全提示**：默认密码均为 `123456`，登录后请立即修改！

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
# 克隆到本地
git clone https://github.com/JamesMeredith/YT-ASMT.git

# 进入项目目录
cd YT-ASMT
```

### 2. 设置开发环境

**方式一：使用系统 Node.js**

```bash
# 安装依赖
cd server
npm install

# 返回项目根目录
cd ..
```

**方式二：使用便携版（推荐，无需安装 Node）**

```bash
# 直接使用项目自带的 Node.js
# 运行 start_portable.bat 即可
```

### 3. 启动服务

**开发环境（Windows）**

```bash
# 方式一：双击启动
start.bat

# 方式二：命令行启动
cd server
node server.js
```

**生产环境（Linux）**

```bash
# 使用 PM2 管理进程
cd /opt/YT-ASMT/server
npm install -g pm2
pm2 start server.js --name yt-asmt
pm2 save
pm2 startup
```

### 4. 访问应用

打开浏览器访问：
- **本地访问**：`http://localhost:3000`
- **局域网访问**：`http://[服务器IP]:3000`

---

## 🔧 功能模块

| 模块 | 说明 | 图标 |
|------|------|------|
| **工作台** | 故障/设备/巡检概览，快捷入口 | 📊 |
| **工单管理** | 报修登记→现场排查→故障修复→复核闭环→售后回访 | 🔧 |
| **设备管理** | 一机一码绑定，状态变更，关联数据查看 | 📦 |
| **巡检管理** | 巡检计划创建、巡检记录执行与提交 | 🔍 |
| **维保台账** | 配件更换、固件升级、清洁保养等记录 | 🔨 |
| **需求管理** | 需求提交→总部评估→采纳/驳回 | 💡 |
| **知识库** | 故障解决方案沉淀，自动入库，全文搜索 | 📚 |
| **数据统计** | 设备在线率、故障趋势、响应时长分析（仅总部） | 📈 |
| **消息通知** | 重大故障告警、巡检提醒、流程通知 | 🔔 |
| **审计日志** | 所有操作完整记录（仅总部可见） | 🔐 |

---

## 🌐 部署指南

### 单机部署（开发/测试）

```bash
# 1. 安装 Node.js v16+
# 2. 克隆仓库到本地
# 3. 安装依赖：npm install
# 4. 启动：node server.js
# 5. 访问：http://localhost:3000
```

### 局域网部署

```bash
# 开放防火墙端口
netsh advfirewall firewall add rule name="YT-ASMT Web" dir=in action=allow protocol=TCP localport=3000

# 启动服务
cd E:\YT-ASMT\server
npm install
node server.js

# 局域网其他电脑访问
# http://[服务器IP]:3000
```

### 云服务器部署（生产环境）

**环境准备**：
```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js（使用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20.17.0
nvm alias default 20.17.0

# 安装 PM2
npm install -g pm2
```

**部署项目**：
```bash
# 创建项目目录
mkdir -p /opt/YT-ASMT
cd /opt/YT-ASMT

# 克隆代码
git clone https://github.com/JamesMeredith/YT-ASMT.git .

# 安装依赖
cd server
npm install --production

# 启动服务
pm2 start server.js --name yt-asmt
pm2 save
pm2 startup
```

**Nginx 反向代理配置**：
```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 🐛 故障排除

### 常见问题

| 问题 | 现象 | 解决方案 |
|------|------|---------|
| 端口被占用 | `EADDRINUSE: address already in use` | `netstat -ano | findstr ":3000"` 找到进程并终止，或换端口启动 |
| 登录无反应 | `doLogin is not defined` | 按 F12 检查 Console 错误，强制刷新页面 |
| 数据库只读 | `SQLITE_READONLY` | 检查 data 目录权限，确保可写 |
| 中文乱码 | 日志或页面显示乱码 | 确保文件编码为 UTF-8 |
| 局域网无法访问 | 本机可访问，其他电脑无法访问 | 检查防火墙规则，确认端口开放 |

### 日志查看

```bash
# Windows
# 启动窗口直接查看实时日志

# Linux（PM2）
pm2 logs yt-asmt
pm2 logs yt-asmt --lines 50
```

---

## 📝 贡献指南

### 提交代码

```bash
# 1. 创建功能分支
git checkout -b feature/your-feature-name

# 2. 编写代码并提交
git add .
git commit -m "feat: 添加新功能描述"

# 3. 推送到远程
git push origin feature/your-feature-name

# 4. 创建 Pull Request
```

### 代码规范

- 使用 4 空格缩进
- JavaScript 文件使用 `.js` 扩展名
- 函数名使用 camelCase
- 变量名使用 camelCase
- 常量使用 UPPER_CASE

---

## 📧 问题反馈

| 渠道 | 适用场景 | 联系方式 |
|------|---------|---------|
| **GitHub Issues** | Bug报告、功能请求 | [仓库 Issues 页面](https://github.com/JamesMeredith/YT-ASMT/issues) |
| **企业微信** | 紧急问题、即时沟通 | @技术支持组 |
| **邮件** | 详细问题描述 | support@company.com |

---

## 📄 许可证

MIT License

---

## 📅 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v2.0 | 2024-01-01 | 正式发布 |
| v2.1 | 2024-03-15 | 新增售中管理模块 |
| v2.2 | 2024-06-01 | 优化登录体验，修复已知问题 |

---

**项目维护**：技术部运维组  
**最后更新**：2024-06-01