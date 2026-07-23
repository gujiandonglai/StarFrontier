/**
 * MissionDefs.js
 * ------------------------------------------------------------------
 * 功能：任务模板表。需求文档要求「不少于100种模板」，这里先给出 4 种
 *       有代表性、且都能用现有事件系统稳健追踪进度的类型（剿灭/采矿/
 *       贸易/探索），验证「模板 -> 实例化 -> 事件驱动进度追踪 -> 结算 ->
 *       声望联动」这条架构管线能不能走通。这和 Phase2 的 WeaponDefs.js
 *       是同一个思路：先证明架构正确，后续阶段只需要往表里加条目。
 *       没有实现的类型（护航/暗杀/搜救/调查/占领/护送/科研/考古……）
 *       全部需要「多个移动目标」「战斗结果影响非玩家实体」「站点身份
 *       在跨扇区场景下持续存在」这类目前架构还没有的能力，勉强拼凑出
 *       表面能用但底层不可靠的实现，不如老实先把四种类型做扎实。
 * 输入：无（静态数据）
 * 输出：MissionType 枚举、MISSION_TEMPLATES 数组
 * 调用关系：被 mission/MissionManager.js 引用
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */

export const MissionType = Object.freeze({
  BOUNTY: 'bounty', // 剿灭：消灭 N 艘海盗
  MINING: 'mining', // 采矿：采集 N 单位指定资源
  TRADE: 'trade', // 贸易：卖出 N 单位指定资源
  EXPLORATION: 'exploration', // 探索：降落 N 颗不同类型的行星
});

/**
 * @typedef {Object} MissionTemplate
 * @property {string} id
 * @property {string} type MissionType 枚举之一
 * @property {string} titleTemplate
 * @property {(params:{targetCount:number, resourceName:string, factionName:string})=>string} descriptionTemplate
 * @property {[number,number]} targetCountRange
 * @property {number} rewardCreditsPerUnit 奖励信用点 = targetCount * 这个值（四舍五入）
 * @property {number} rewardReputation 完成后获得的声望值
 */

export const MISSION_TEMPLATES = Object.freeze([
  {
    id: 'bounty_pirates_small',
    type: MissionType.BOUNTY,
    titleTemplate: '清剿海盗小队',
    descriptionTemplate: (p) =>
      `消灭 ${p.targetCount} 艘海盗船。${p.factionName}将支付赏金并提升你的声望。`,
    targetCountRange: [3, 6],
    rewardCreditsPerUnit: 60,
    rewardReputation: 12,
  },
  {
    id: 'mining_quota',
    type: MissionType.MINING,
    titleTemplate: '资源采集合同',
    descriptionTemplate: (p) => `采集 ${p.targetCount} 单位${p.resourceName}并带回站点。`,
    targetCountRange: [15, 40],
    rewardCreditsPerUnit: 6,
    rewardReputation: 8,
  },
  {
    id: 'trade_quota',
    type: MissionType.TRADE,
    titleTemplate: '贸易配额',
    descriptionTemplate: (p) => `在任意市场卖出 ${p.targetCount} 单位${p.resourceName}。`,
    targetCountRange: [10, 30],
    rewardCreditsPerUnit: 4,
    rewardReputation: 6,
  },
  {
    id: 'exploration_survey',
    type: MissionType.EXPLORATION,
    titleTemplate: '星域勘测',
    descriptionTemplate: (p) => `降落至 ${p.targetCount} 颗不同类型的行星并完成初步勘测。`,
    targetCountRange: [2, 4],
    rewardCreditsPerUnit: 90,
    rewardReputation: 10,
  },
]);
