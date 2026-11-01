const adjectives = [
  '活泼', '可爱', '勇敢', '冷静', '聪明', '好奇', '温柔', '快乐',
  '迷人', '狡猾', '慷慨', '优雅', '忠诚', '幽默', '耐心', '谦虚',
  '浪漫', '严肃', '害羞', '坦率', '顽强', '细心', '热情', '神秘',
  '自由', '随和', '坚定', '乐观', '沉稳', '灵巧', '阳光', '安静',
  '潇洒', '纯真', '机敏', '果断', '真诚', '独特'
];

const fruits = [
  '苹果', '香蕉', '橙子', '草莓', '葡萄', '西瓜', '桃子', '梨子', '芒果', '柠檬',
  '樱桃', '菠萝', '椰子', '蓝莓', '猕猴桃', '哈密瓜', '木瓜', '荔枝', '龙眼', '山竹',
  '榴莲', '柚子', '石榴', '无花果', '牛油果', '蘑菇'
];

export function createName(exclude = [], random = Math.random) {
  const used = new Set(exclude);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const adjective = adjectives[Math.floor(random() * adjectives.length)];
    const fruit = fruits[Math.floor(random() * fruits.length)];
    const name = `${adjective}的${fruit}`;
    if (!used.has(name)) return name;
  }
  const name = adjectives.flatMap((adjective) => fruits.map((fruit) => `${adjective}的${fruit}`))
    .find((candidate) => !used.has(candidate));
  if (!name) throw new Error('房间内已没有可用的默认名字');
  return name;
}
