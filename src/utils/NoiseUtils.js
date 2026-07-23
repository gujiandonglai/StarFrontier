/**
 * NoiseUtils.js
 * ------------------------------------------------------------------
 * 功能：自实现的 2D 值噪声（Value Noise）+ 分形叠加（FBM），不依赖任何
 *       第三方库（浏览器直接用 import map 加载 Three.js，额外引入噪声库
 *       会增加一个不受控的外部 CDN 依赖点）。行星地表高度图、未来的星云
 *       纹理、地形细节都可以复用同一套噪声函数。种子化保证「同一颗行星
 *       同一个位置，任何时候落地看到的地形都完全一致」。
 *       没有实现 Simplex/Perlin 噪声，是因为值噪声实现更短、更容易保证
 *       正确性；在「行星表面一块地」这种量级的地形上，值噪声的方形网格
 *       感并不明显，多倍频叠加（FBM）已经足以获得可信的起伏效果。
 * 输入：new ValueNoise2D(seed, gridSize?)；sample(x, y)；fbm(x, y, octaves, persistence)
 * 输出：sample()/fbm() 返回大致落在 [-1, 1] 范围的浮点数
 * 调用关系：被 planet/PlanetSurfaceGenerator.js 使用
 * 复杂度：sample() 为 O(1)；fbm(octaves) 为 O(octaves)
 * ------------------------------------------------------------------
 */
import { SeededRandom } from './SeededRandom.js';

export class ValueNoise2D {
  /**
   * @param {number} seed
   * @param {number} [gridSize] 预生成的随机梯度网格边长，越大重复周期越长
   */
  constructor(seed, gridSize = 256) {
    this.gridSize = gridSize;
    const rng = new SeededRandom(seed);
    this._grid = new Float32Array(gridSize * gridSize);
    for (let i = 0; i < this._grid.length; i++) {
      this._grid[i] = rng.next() * 2 - 1;
    }
  }

  _hashLookup(xi, yi) {
    const size = this.gridSize;
    const x = ((xi % size) + size) % size;
    const y = ((yi % size) + size) % size;
    return this._grid[y * size + x];
  }

  /** 五次平滑曲线（Perlin 改进版），避免二阶导数不连续导致的可见接缝 */
  static _smooth(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** 双线性插值 + 平滑曲线的值噪声采样，x/y 可以是任意浮点坐标 */
  sample(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = ValueNoise2D._smooth(x - x0);
    const ty = ValueNoise2D._smooth(y - y0);

    const v00 = this._hashLookup(x0, y0);
    const v10 = this._hashLookup(x0 + 1, y0);
    const v01 = this._hashLookup(x0, y0 + 1);
    const v11 = this._hashLookup(x0 + 1, y0 + 1);

    const vx0 = v00 + (v10 - v00) * tx;
    const vx1 = v01 + (v11 - v01) * tx;
    return vx0 + (vx1 - vx0) * ty;
  }

  /**
   * 分形布朗运动（多倍频叠加），获得比单层值噪声更自然的地形起伏
   * @param {number} x
   * @param {number} y
   * @param {number} [octaves]
   * @param {number} [persistence] 每提高一个倍频程，振幅衰减比例
   * @returns {number} 归一化到大致 [-1, 1] 的高度值
   */
  fbm(x, y, octaves = 4, persistence = 0.5) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.sample(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / maxAmplitude;
  }
}
