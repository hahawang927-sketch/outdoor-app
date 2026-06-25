# 户外约伴五边形能力图模块

这是一个无外部依赖的可运行示例，包含前端交互能力图和后端 JSON 持久化。

## 启动

```powershell
cd C:\Users\23661\Documents\Codex\2026-06-25\codex-computer-use-codex-google-chrome\outputs\outdoor-ability-module
node server.js
```

访问：

```text
http://localhost:4173
```

## 标准化流程

1. 页面加载时调用 `GET /api/state` 自动获取成员、评分标准和聚合分数。
2. 浏览器生成本地随机 `raterToken`，页面只展示短匿名标识。
3. 提交评分时调用 `POST /api/ratings`，每项能力必须是 `1-5` 的整数。
4. 后端将评分者标识哈希化为 `raterAnonId`，不保存原始浏览器 token。
5. 后端写入 `data/ratings.json`，刷新或重启服务后数据仍保留。
6. 前端每 10 秒轮询一次 `GET /api/state`，保证多次访问能自动更新。

## API

- `GET /api/state`：返回统一评分标准、成员列表、聚合平均分。
- `POST /api/members`：创建匿名成员。
- `POST /api/ratings`：保存同伴评分。

## 能力维度

- 耐力
- 体力
- 技能
- 安全意识
- 协作
