/**
 * CollisionGroups.js
 * ------------------------------------------------------------------
 * 功能：定义碰撞分组标签与「谁能命中谁」的过滤矩阵。避免出现玩家子弹
 *       打到玩家自己、敌人子弹打到敌人自己这类问题，也为后续阵营系统
 *       （Phase5：中立/友方/敌方关系随阵营声望动态变化）预留扩展点——
 *       届时只需替换 canCollide() 的判定逻辑，不需要改动
 *       CollisionSystem 或任何调用方。
 * 输入：无（静态常量 + 纯函数）
 * 输出：CollisionGroup 枚举、canCollide(groupA, groupB) 布尔判定
 * 调用关系：被 physics/Collider.js、physics/CollisionSystem.js、
 *           weapon/Projectile.js 引用
 * 复杂度：canCollide() 为 O(1)
 * ------------------------------------------------------------------
 */
export const CollisionGroup = Object.freeze({
  PLAYER_SHIP: 'PLAYER_SHIP',
  ENEMY_SHIP: 'ENEMY_SHIP',
  PLAYER_PROJECTILE: 'PLAYER_PROJECTILE',
  ENEMY_PROJECTILE: 'ENEMY_PROJECTILE',
});

// 显式列出允许互相碰撞的组合（无向对，判定时两个方向都会查一次）
const _ALLOWED_PAIRS = new Set([
  `${CollisionGroup.PLAYER_PROJECTILE}|${CollisionGroup.ENEMY_SHIP}`,
  `${CollisionGroup.ENEMY_PROJECTILE}|${CollisionGroup.PLAYER_SHIP}`,
]);

/**
 * 判断两个碰撞组是否应该发生碰撞判定
 * @param {string} groupA
 * @param {string} groupB
 * @returns {boolean}
 */
export function canCollide(groupA, groupB) {
  if (groupA === groupB) return false; // 同组默认不互撞（同阵营子弹/同阵营船体）
  return (
    _ALLOWED_PAIRS.has(`${groupA}|${groupB}`) || _ALLOWED_PAIRS.has(`${groupB}|${groupA}`)
  );
}
