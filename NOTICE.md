# 许可与第三方说明

## 版权

Copyright (C) 2026 Lu-Mine <https://github.com/Lu-Mine>

## 代码许可

本仓库中除下方「例外」一节列明的内容外，全部源代码以 **GNU Affero General
Public License version 3（AGPL-3.0-only）** 发布，许可全文见 [LICENSE](LICENSE)。

这意味着你可以自由运行、修改和再分发本程序；但如果你修改了它，并让他人通过
网络与你的版本交互，你必须向他们提供修改后的完整对应源代码（AGPL-3.0 §13）。

本站页脚的 GitHub 链接指向本仓库，这就是 §13 要求的源码获取方式。自建部署时
请保留该链接或提供等效的源码获取入口。

## 例外：词向量数据

`data/vectors/` 下的 `vocab.json`、`vectors.bin`、`meta.json` **不在**上述代码
许可的覆盖范围内，而是以 **CC BY-SA 3.0** 发布（由 fastText `cc.zh.300` 中文词
向量裁剪而来）。署名、改动说明与条款链接见
[data/vectors/NOTICE.md](data/vectors/NOTICE.md)。

AGPL-3.0 不覆盖、也无法覆盖这部分数据：CC BY-SA 3.0 的 ShareAlike 条件要求其
衍生数据继续以 CC BY-SA 3.0 提供。

## 第三方依赖

| 组件 | 许可 |
|---|---|
| better-sqlite3 | MIT |
| ws | MIT |
| opencc-js | MIT AND Apache-2.0 |
| lucide-static | ISC |

以上均为宽松许可，与 AGPL-3.0 兼容。`public/icons.svg` 由
`scripts/build-icons.js` 从 lucide-static 生成，属其衍生作品，继续保留 ISC 许可。
