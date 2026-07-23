/**
 * Market.js
 * ------------------------------------------------------------------
 * 功能：单个空间站的资源市场。每种资源都有一个「当前价格」，围绕
 *       ResourceDefs 里的 baseCreditValue 上下浮动。浮动来自两个来源：
 *         1. 站点固有的随机报价偏移（同一颗种子下，某个站点天生就比
 *            别的站点更缺钛矿，因此价格长期偏高）——这正是需求文档
 *            「十一、经济系统」里「玩家可以低买高卖，建立贸易路线」
 *            的基础：不同站点的固有偏移不同，跑一趟运输就有利可图。
 *         2. 每次交易造成的短期供需冲击——卖出会压低这个站点的价格
 *            （卖多了不值钱），买入会推高价格（买多了物以稀为贵），
 *            并随时间缓慢回归基准价，模拟「战争影响/运输影响/事件
 *            影响」这类需求文档提到的动态因素的最小可行版本。
 *       Phase5 起，buy()/sell() 额外接受一个可选的 priceMultiplier——
 *       声望越高的阵营，main.js 传入的折扣力度越大。Market 本身不知道
 *       「声望」是什么（经济系统不应该依赖阵营系统），只负责按调用方
 *       给的倍率结算，折扣的计算逻辑留在 main.js。
 * 输入：
 *   - 构造：{ seed }（同一颗种子的市场，固有偏移永远一致）
 *   - getPrice(resourceId)
 *   - sell(resourceId, amount, cargoHold, wallet, priceMultiplier?)
 *   - buy(resourceId, amount, cargoHold, wallet, priceMultiplier?)
 *   - update(dt) 价格向基准缓慢回归
 * 输出：交易方法返回 {success, amount, credits, reason?}
 * 调用关系：每个 station/StationInstance 持有一个 Market；
 *           被 main.js 在玩家买卖时调用
 * 复杂度：所有操作均为 O(1)（资源种类数固定为个位数）
 * ------------------------------------------------------------------
 */
import { SeededRandom } from '../utils/SeededRandom.js';
import { RESOURCE_TYPES, getResourceDef } from './ResourceDefs.js';

const PRICE_IMPACT_PER_UNIT = 0.006; // 每交易 1 单位对价格造成的冲击比例
const PRICE_FLOOR_RATIO = 0.35; // 价格相对基准价的下限（防止被砸到接近 0）
const PRICE_CEILING_RATIO = 2.6; // 价格相对基准价的上限（防止无限炒高）
const PRICE_REVERT_RATE = 0.02; // 每秒向基准价回归的比例

export class Market {
  /** @param {number} seed 通常取自该空间站所在扇区的派生种子 */
  constructor(seed) {
    const rng = new SeededRandom(seed);
    /** @type {Map<string, {basePrice:number, modifier:number}>} */
    this._entries = new Map();

    for (const def of RESOURCE_TYPES) {
      // 固有偏移：0.6~1.6 倍基准价，让不同站点天生有价格差异
      const inherentBias = rng.range(0.6, 1.6);
      this._entries.set(def.id, {
        basePrice: def.baseCreditValue * inherentBias,
        modifier: 1, // 短期供需冲击系数，围绕 1 上下浮动，随时间回归 1
      });
    }
  }

  /**
   * @param {string} resourceId
   * @returns {number} 当前单价（信用点/单位），已四舍五入到整数信用点
   */
  getPrice(resourceId) {
    const entry = this._entries.get(resourceId);
    if (!entry) return 0;
    return Math.round(entry.basePrice * entry.modifier);
  }

  /** 每帧调用：价格冲击系数缓慢向 1（基准价）回归 */
  update(dt) {
    for (const entry of this._entries.values()) {
      entry.modifier += (1 - entry.modifier) * Math.min(1, PRICE_REVERT_RATE * dt);
    }
  }

  /**
   * 玩家把货舱里的资源卖给这个站点
   * @param {string} resourceId
   * @param {number} amount
   * @param {import('../ship/CargoHold.js').CargoHold} cargoHold
   * @param {import('../ship/Wallet.js').Wallet} wallet
   * @param {number} [priceMultiplier] 声望折扣/加成倍率，默认 1（不调整）
   * @returns {{success:boolean, amount:number, credits:number, reason?:string}}
   */
  sell(resourceId, amount, cargoHold, wallet, priceMultiplier = 1) {
    const held = cargoHold.contents.get(resourceId) || 0;
    const sellAmount = Math.min(held, amount);
    if (sellAmount <= 0) {
      return { success: false, amount: 0, credits: 0, reason: 'empty' };
    }

    const unitPrice = this.getPrice(resourceId) * priceMultiplier;
    const credits = Math.round(unitPrice * sellAmount);

    cargoHold.removeResource(resourceId, sellAmount);
    wallet.addCredits(credits);
    this._applyImpact(resourceId, -sellAmount);

    return { success: true, amount: sellAmount, credits };
  }

  /**
   * 玩家从这个站点购买资源（受货舱剩余容量与钱包余额双重限制）
   * @param {string} resourceId
   * @param {number} amount
   * @param {import('../ship/CargoHold.js').CargoHold} cargoHold
   * @param {import('../ship/Wallet.js').Wallet} wallet
   * @param {number} [priceMultiplier] 声望折扣/加成倍率，默认 1（不调整）
   * @returns {{success:boolean, amount:number, credits:number, reason?:string}}
   */
  buy(resourceId, amount, cargoHold, wallet, priceMultiplier = 1) {
    getResourceDef(resourceId); // 校验 id 合法，非法 id 会在这里抛错，属于程序性错误而非玩家可触发的路径

    const unitPrice = this.getPrice(resourceId) * priceMultiplier;
    const spaceLeft = Math.max(0, cargoHold.capacity - cargoHold.totalStored);
    const affordableByCredits = unitPrice > 0 ? Math.floor(wallet.credits / unitPrice) : amount;
    const buyAmount = Math.min(amount, spaceLeft, affordableByCredits);

    if (buyAmount <= 0) {
      const reason = spaceLeft <= 0 ? 'cargo_full' : 'insufficient_credits';
      return { success: false, amount: 0, credits: 0, reason };
    }

    const credits = Math.round(unitPrice * buyAmount);
    wallet.spendCredits(credits);
    const result = cargoHold.addResource(resourceId, buyAmount);
    this._applyImpact(resourceId, result.accepted);

    return { success: true, amount: result.accepted, credits };
  }

  /**
   * 交易对价格的短期冲击：正数（买入）推高价格，负数（卖出）压低价格
   * @param {string} resourceId
   * @param {number} signedAmount
   */
  _applyImpact(resourceId, signedAmount) {
    const entry = this._entries.get(resourceId);
    if (!entry) return;
    entry.modifier += signedAmount * PRICE_IMPACT_PER_UNIT;
    entry.modifier = Math.min(
      PRICE_CEILING_RATIO,
      Math.max(PRICE_FLOOR_RATIO, entry.modifier)
    );
  }
}
