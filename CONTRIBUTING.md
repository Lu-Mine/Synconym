# 参与贡献

近意词欢迎外部贡献。请先读完这一页——它说明的署名与许可条件，对每一个提交都生效。

## 先讨论，再动手

- 修 bug、改文档、补测试：直接发 Pull Request。
- 新增玩法、改动房间规则、修改 WebSocket 协议或数据结构：请先开 issue 说明动机，避免白做。

实现细节以 [Agents/DESIGN.md](Agents/DESIGN.md) 为准，产品与设计取向见 [Agents/PRODUCT.md](Agents/PRODUCT.md)。

## 本地开发

需要 Node 20 或更新版本。

```bash
npm install
npm run dev     # 改动自动重启，此时可访问 /__mock 预览各阶段界面
npm test        # 全量测试，提交前必须全绿
```

几个容易踩的约束：

- `better-sqlite3` 固定在 `^12`，不要升到 13.x——它要求 Node 22+，在 Node 20 上会直接崩溃。
- 前端是未经打包的原生 ES 模块，直接改 `public/` 下的文件即可，没有构建步骤。`public/icons.svg` 是 `npm run build:icons` 从 `lucide-static` 生成的，不要手改。
- `npm start` 不开放 `/__mock`，新增调试入口不要绕过这个开关。
- 脚本类文件必须保持 LF 换行（`.gitattributes` 已约束 `*.sh` 与 `.github/workflows/*.yml`）。

## 提交必须签名

本项目要求所有提交带 `Signed-off-by` 尾注，依据是 [Developer Certificate of Origin 1.1](DCO)：

```bash
git commit -s -m "fix(ui): 修正结算页在窄屏下的留白"
```

`-s` 会在提交信息末尾追加一行 `Signed-off-by: 你的名字 <你的邮箱>`，取自 `git config user.name` / `user.email`。请确认这两项是你本人的，因为这个邮箱会随提交公开。

DCO 表示：这条提交是你自己写的、或你有权按本项目的许可提交它、并且你同意它以该许可公开、永久保留署名记录。CI 会检查 PR 里每个提交是否带这个尾注，缺失会直接失败。

## 许可：你保留版权，项目获得 AGPL 授权

提交即表示你同意自己的贡献按 **AGPL-3.0-only** 授权给本项目及其他使用者（inbound = outbound，与 DCO 的 (a)(b) 一致）。**你保留自己贡献部分的版权**，不存在向项目所有者转让版权。

由此产生两条硬性要求：

1. **不要提交来源不明或许可不兼容的代码。** 只能提交你原创的，或来自与 AGPL-3.0 兼容许可的代码——MIT、Apache-2.0、BSD、ISC 这类宽松许可可以并入，GPL-2.0-only 之类不兼容的不能。涉及第三方代码时，请在提交信息里注明来源与许可，并同步更新 [NOTICE.md](NOTICE.md) 的依赖表。
2. **`data/vectors/` 不受 AGPL 支配。** 该目录是 CC BY-SA 3.0 数据，ShareAlike 要求其衍生数据继续以同一许可提供，项目方无权把它单独再许可为 AGPL。改动该目录（重新裁剪向量、替换词表）前请先开 issue。

## 提交信息

沿用仓库现有的中文风格，用前缀说明改动范围：

```
fix(ui): 移动端留白
feat(room): 支持 5 人房间
docs: 补充部署说明
test: 覆盖重连退避
chore(license): 改用 AGPL-3.0-only
```

一次提交只做一件事，便于回滚。
