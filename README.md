# 麻精药品智能柜售后运维工具 v2.0

## 系统概述
针对麻精药品智能柜的全生命周期售后运维工具，覆盖设备绑定、故障工单处理、巡检、维保台账、需求管理、知识库等核心业务场景。

## 角色体系（三级权限）
| 角色 | 权限范围 | 典型用户 |
|------|---------|---------|
| 总部 (headquarters) | 全部数据可见，复核闭环，需求评估，审计日志，数据统计 | 公司总部技术/管理人员 |
| 工程师 (engineer) | 个人工单、设备安装绑定、巡检、维保、需求提交 | 本公司驻场/区域技术员 |
| 经销商 (dealer) | 本省份工单及设备数据，需求提交 | 经销商售后接口人 |

## 系统架构
```
YT-ASMT/
├── start.bat           # 一键启动脚本
├── server/
│   ├── server.js       # Express主服务器
│   ├── db.js           # SQLite数据库初始化 & 种子数据
│   ├── auth.js         # 认证/授权中间件
│   └── package.json    # Node依赖配置
├── data/
│   └── yt_asmt.db      # SQLite数据库（自动创建）
├── tools/              # 工具脚本目录
└── web/
    ├── index.html      # 主页面（SPA）
    ├── css/style.css   # 样式文件
    └── js/app.js       # API客户端 & 工具函数
```

## 部署方式

### 方式一：单机部署（推荐内网环境）
1. 安装 Node.js v16+
2. 将 YT-ASMT 文件夹放置于 E 盘
3. 双击 `start.bat` 启动
4. 浏览器访问 `http://localhost:3000`

### 方式二：局域网部署
```bash
# 设置防火墙规则开放 3000 端口
netsh advfirewall firewall add rule name="YT-ASMT Web" dir=in action=allow protocol=TCP localport=3000

# 启动服务
cd E:\YT-ASMT\server
npm install
node server.js

# 局域网内其他电脑访问: http://[服务器IP]:3000
```

### 方式三：云服务器部署
```bash
# 上传至服务器后
cd /opt/YT-ASMT/server
npm install
# 使用 pm2 管理进程
npm install -g pm2
pm2 start server.js --name yt-asmt
pm2 save
pm2 startup
```

## 默认账号
| 账号 | 密码 | 角色 |
|------|------|------|
| engineer01 | 123456 | 工程师 |
| engineer02 | 123456 | 工程师 |
| engineer03 | 123456 | 工程师 |
| dealer01 | 123456 | 经销商 |
| dealer02 | 123456 | 经销商 |
| admin01 | 123456 | 总部 |

登录后建议立即修改密码。

## 核心功能
- 📊 **工作台** - 故障/设备/巡检概览，快捷入口
- 🔧 **工单管理** - 报修登记→现场排查→故障修复→复核闭环→售后回访
- 📦 **设备管理** - 一机一码绑定，状态变更，关联数据查看
- 🔍 **巡检管理** - 巡检计划、巡检记录
- 🔨 **维保台账** - 配件更换、固件升级、清洁保养等记录
- 💡 **需求管理** - 需求提交→总部评估→采纳/驳回
- 📚 **知识库** - 故障解决方案沉淀，自动入库，全文搜索
- 📈 **数据统计** - 设备在线率、故障趋势、响应时长分析
- 🔔 **消息通知** - 重大故障告警、巡检提醒、流程通知
- 🔐 **审计日志** - 所有操作完整记录（仅总部可见）

## 技术栈
- 前端: Vanilla JS + CSS3（零框架依赖，兼容性好）
- 后端: Node.js + Express
- 数据库: SQLite（开箱即用，零配置）
- 认证: Token-based + bcryptjs

## 注意事项
- SQLite 不支持并发高写入，适合单机/小团队（<50人同时操作）
- 如需外网访问，建议配置 HTTPS + 反向代理
- 数据文件 `data/yt_asmt.db` 请定期备份