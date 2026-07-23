/**
 * ReputationSystem.js
 * ------------------------------------------------------------------
 * 功能：玩家对每个阵营的声望分值（-100~100，默认 0/中立）与对应的
 *       「标准」等级（敌对/不友善/中立/友好/盟友）。声望变化通过
 *       EventBus 广播 'reputation:changed'，faction/TechTreeSystem.js
 *       监听它来判断是否解锁新的科技节点，商店 UI 也监听它来实时刷新
 *       "当前声望"显示。
 *       声望目前只影响：任务奖励结算、科技树解锁、（main.js 里）市场
 *       交易的声望折扣。它不会实时改变战斗 AI 的敌对判定——让巡逻舰
 *       因为声望下降而主动开火，属于需求文档「二十五、Phase8：动态
 *       战争」的范畴，Phase5 只把"声望"这个数值本身做扎实，不提前
 *       嫁接尚未存在的舰队 AI 行为。
 * 输入：
 *   - 构造：eventBus
 *   - adjust(factionId, delta)
 *   - getScore(factionId) / getStanding(factionId) / getStandingLabel(factionId)
 * 输出：'reputation:changed' 事件 { factionId, score, delta }
 * 调用关系：被 main.js 创建单例，传给 mission/MissionManager.js 与
 *           faction/TechTreeSystem.js；main.js 的市场交易逻辑读取
 *           getStanding() 计算价格折扣
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */

export const Standing = Object.freeze({
  HOSTILE: 'hostile',
  UNFRIENDLY: 'unfriendly',
  NEUTRAL: 'neutral',
  FRIENDLY: 'friendly',
  ALLIED: 'allied',
});

const STANDING_LABELS = Object.freeze({
  hostile: '敌对',
  unfriendly: '不友善',
  neutral: '中立',
  friendly: '友好',
  allied: '盟友',
});

/**
 * 把一个 Standing 枚举值翻译成中文标签，不依赖任何具体阵营的当前分值
 * （用于科技树 UI 展示"需要达到 XX 标准"这类与当前声望无关的静态文案）
 * @param {string} standing
 * @returns {string}
 */
export function getStandingLabelFor(standing) {
  return STANDING_LABELS[standing] ?? standing;
}

// 从低到高的顺序，供 standingAtLeast() 做等级比较
const STANDING_ORDER = [
  Standing.HOSTILE,
  Standing.UNFRIENDLY,
  Standing.NEUTRAL,
  Standing.FRIENDLY,
  Standing.ALLIED,
];

/**
 * 比较两个标准等级，current 是否达到或超过 required
 * @param {string} currentStanding
 * @param {string} requiredStanding
 * @returns {boolean}
 */
export function standingAtLeast(currentStanding, requiredStanding) {
  return STANDING_ORDER.indexOf(currentStanding) >= STANDING_ORDER.indexOf(requiredStanding);
}

// 声望对市场价格的影响：标准越高，买入越便宜、卖出越值钱。
// Market 本身不知道"声望"是什么（economy/ 不依赖 faction/），main.js 在
// 调用 Market.buy()/sell() 前用这张表算出倍率再传进去。
const TRADE_MULTIPLIER_TABLE = Object.freeze({
  [Standing.HOSTILE]: { buy: 1.3, sell: 0.7 },
  [Standing.UNFRIENDLY]: { buy: 1.15, sell: 0.85 },
  [Standing.NEUTRAL]: { buy: 1.0, sell: 1.0 },
  [Standing.FRIENDLY]: { buy: 0.92, sell: 1.08 },
  [Standing.ALLIED]: { buy: 0.85, sell: 1.15 },
});

/**
 * @param {string} standing Standing 枚举之一
 * @param {'buy'|'sell'} mode
 * @returns {number}
 */
export function getTradeMultiplier(standing, mode) {
  return TRADE_MULTIPLIER_TABLE[standing]?.[mode] ?? 1.0;
}

export class ReputationSystem {
  /** @param {import('../core/EventBus.js').EventBus} [eventBus] */
  constructor(eventBus) {
    this.eventBus = eventBus ?? null;
    /** @type {Map<string, number>} */
    this._scores = new Map();
  }

  /** @param {string} factionId */
  getScore(factionId) {
    return this._scores.get(factionId) ?? 0;
  }

  /** @param {string} factionId */
  getStanding(factionId) {
    const score = this.getScore(factionId);
    if (score < -50) return Standing.HOSTILE;
    if (score < 0) return Standing.UNFRIENDLY;
    if (score < 30) return Standing.NEUTRAL;
    if (score < 70) return Standing.FRIENDLY;
    return Standing.ALLIED;
  }

  /** @param {string} factionId */
  getStandingLabel(factionId) {
    return STANDING_LABELS[this.getStanding(factionId)];
  }

  /**
   * 调整某阵营的声望分值，限制在 [-100, 100] 区间内
   * @param {string} factionId
   * @param {number} delta 正数提升、负数降低
   * @returns {number} 调整后的最终分值
   */
  adjust(factionId, delta) {
    const current = this.getScore(factionId);
    const next = Math.max(-100, Math.min(100, current + delta));
    this._scores.set(factionId, next);
    this.eventBus?.emit('reputation:changed', { factionId, score: next, delta });
    return next;
  }

  /**
   * 直接设置某阵营的声望分值（不触发 'reputation:changed' 事件）。
   * 仅供 save/SaveSerializer.js 在读档时恢复状态使用——正常游戏过程中
   * 声望变化应该始终走 adjust()，这样任务奖励/被动声望增益才能在数值
   * 变化的同时正确广播事件（驱动 TechTreeSystem 与 UI 刷新）。读档是
   * 特殊路径：调用方会在设置完所有分值后手动调用一次
   * TechTreeSystem.checkUnlocks() 来统一重新核算解锁状态，不需要每设置
   * 一个分值就广播一次事件。
   * @param {string} factionId
   * @param {number} score
   */
  setScore(factionId, score) {
    this._scores.set(factionId, Math.max(-100, Math.min(100, score)));
  }
}
