# 词向量数据说明

本目录（`data/vectors/`）中的 `vocab.json`、`vectors.bin`、`meta.json` 是由以下作品改编而来的衍生数据。

- 作品：Word vectors for 157 languages 中的中文词向量 `cc.zh.300`（fastText）
- 来源：https://fasttext.cc/docs/en/crawl-vectors
- 作者：E. Grave, P. Bojanowski, P. Gupta, A. Joulin, T. Mikolov
- 许可：Creative Commons Attribution-ShareAlike 3.0（CC BY-SA 3.0），https://creativecommons.org/licenses/by-sa/3.0/

改动：从原始向量中选取 20424 个词（按原文件词频顺序取前 20000 个 1–4 字的纯汉字词，另加 `data/wordlist.txt` 中的 424 个词）；词形按繁转简、全角转半角、去空白、转小写归一，归一后重复的只保留词频最高的一个；每个向量先做 L2 归一化，再减去全体均值、去掉前 3 个主成分，重新 L2 归一化后量化为 int8。

本目录下的衍生数据同样以 CC BY-SA 3.0 发布。
