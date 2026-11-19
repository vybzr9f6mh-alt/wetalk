/* WeTalk 演示数据 —— 无需后端即可体验完整界面
   由 app.js 的 initDemo() 装载，数据持久化在 localStorage。 */

(function () {
  const now = Date.now();
  const M = (min) => now - Math.round(min * 60000);

  const users = [
    { id: 1, username: 'linxiaoman', nickname: '林小满', avatarHue: 145, signature: '慢慢来，比较快。' },
    { id: 2, username: 'chenyinuo', nickname: '陈一诺', avatarHue: 205, signature: '今天也要开心' },
    { id: 3, username: 'zhouzhou', nickname: '周舟', avatarHue: 28, signature: '在做一个很酷的东西' },
    { id: 4, username: 'mama', nickname: '妈妈', avatarHue: 342, signature: '记得按时吃饭' },
    { id: 5, username: 'azhe', nickname: '阿哲', avatarHue: 262, signature: '健身第 108 天' },
    { id: 6, username: 'suwan', nickname: '苏晚', avatarHue: 15, signature: '摄影 / 旅行 / 咖啡' },
  ];

  let mid = 1000;
  const msg = (cid, senderId, content, at, type = 'text') => ({
    id: mid++,
    conversationId: cid,
    senderId,
    sender: users.find((u) => u.id === senderId) || null,
    type,
    content,
    createdAt: at,
  });

  const conversations = [
    { id: 101, type: 'direct', name: '妈妈', avatarHue: 342, peerId: 4, members: [1, 4], unread: 2, lastMessageAt: M(12) },
    { id: 102, type: 'direct', name: '陈一诺', avatarHue: 205, peerId: 2, members: [1, 2], unread: 1, lastMessageAt: M(38) },
    { id: 103, type: 'group', name: '产品设计组', avatarHue: 150, members: [1, 2, 3, 6], unread: 5, lastMessageAt: M(70) },
    { id: 104, type: 'direct', name: '阿哲', avatarHue: 262, peerId: 5, members: [1, 5], unread: 0, lastMessageAt: M(60 * 26) },
  ];

  const messages = {
    101: [
      msg(101, 4, '小满，周末回家吃饭吗？', M(185)),
      msg(101, 1, '应该可以，我周六下午回来', M(183)),
      msg(101, 4, '好，我炖了排骨汤', M(182)),
      msg(101, 4, '降温了，记得穿厚点', M(12)),
      msg(101, 4, '别老是熬夜，对身体不好', M(11)),
    ],
    102: [
      msg(102, 2, '新版本的设计稿我放群里了，你看下', M(420)),
      msg(102, 1, '收到，晚点看', M(418)),
      msg(102, 2, '咖啡续命 ☕', M(38)),
    ],
    103: [
      msg(103, 3, '首页那个卡片圆角是不是太大了', M(2100)),
      msg(103, 6, '我也觉得，12 比较合适', M(2098)),
      msg(103, 1, '那我先改 12 看看', M(2095)),
      msg(103, 2, '改完了，大家看下效果', M(71)),
      msg(103, 6, '顺眼多了 👍', M(70)),
    ],
    104: [
      msg(104, 1, '健身房见', M(60 * 27)),
      msg(104, 5, '老地方，七点', M(60 * 26)),
    ],
  };

  const moments = [
    {
      id: 1, authorId: 2, time: M(120),
      text: '周末去了趟海边，风很大，但很舒服。',
      images: [200, 192, 210],
      likes: [3, 6], comments: [
        { userId: 3, text: '这是哪？' },
        { userId: 2, text: '东山岛，推荐' },
      ],
    },
    {
      id: 2, authorId: 6, time: M(300),
      text: '新入手一台胶片机，第一卷洗出来了。',
      images: [18, 35, 8, 50],
      likes: [1, 2], comments: [],
    },
    {
      id: 3, authorId: 3, time: M(60 * 5),
      text: '连续第 30 天早起跑步，记录一下。',
      images: [],
      likes: [1, 2, 6], comments: [
        { userId: 2, text: '自律的人真可怕' },
      ],
    },
    {
      id: 4, authorId: 4, time: M(60 * 22),
      text: '今天包的饺子，卖相不错吧',
      images: [42],
      likes: [1], comments: [],
    },
  ];

  /* 演示模式下对方的自动回复池 */
  const replies = [
    '好呀，没问题',
    '哈哈哈，确实是这样',
    '我看看，等下回你',
    '收到～',
    '这个想法不错，我们再讨论下',
    '嗯嗯，我也这么觉得',
    '好，那就这么定了',
    '在忙，稍后说',
    '可以的 👍',
    '你今天怎么这么闲',
  ];

  window.DemoSeed = { users, conversations, messages, moments, replies };
  window.DemoStore = {
    key: 'wt_demo_v1',
    load() {
      try {
        const raw = localStorage.getItem(this.key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(data) {
      try { localStorage.setItem(this.key, JSON.stringify(data)); } catch { /* 配额满 */ }
    },
  };
})();
