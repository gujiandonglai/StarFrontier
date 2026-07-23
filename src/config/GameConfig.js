/**
 * GameConfig.js
 * ------------------------------------------------------------------
 * 功能：集中管理游戏的全局可调参数（渲染、飞船物理、摄像机、星场等）。
 *       后续所有 Phase（经济/阵营/任务/AI）新增的配置也应在此文件追加，
 *       禁止在业务代码中写死魔法数字。
 * 输入：无（静态配置对象）
 * 输出：具名导出的常量对象，供其他模块 import 使用
 * 调用关系：被 engine/、renderer/、scene/、ship/、player/ 下几乎所有模块引用
 * 复杂度：O(1)，纯数据定义
 * ------------------------------------------------------------------
 */

// 渲染相关配置
export const RenderConfig = {
  // 目标分辨率仅作为性能预算参考，实际画布始终铺满窗口
  TARGET_WIDTH: 1920,
  TARGET_HEIGHT: 1080,
  TARGET_FPS: 60,
  ANTIALIAS: true,
  // 使用电影级色调映射，配合后续 Bloom 后处理，模拟 HDR 视觉风格
  TONE_MAPPING_EXPOSURE: 1.1,
  MAX_PIXEL_RATIO: 2, // 高分屏限制，避免性能爆炸
  FOG_ENABLED: false, // 太空场景默认不使用雾效
  CAMERA_FOV: 62,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 200000,
};

// 星场（背景星空）配置——分层视差
export const StarfieldConfig = {
  LAYERS: [
    { count: 6000, radius: 8000, size: 1.4, color: 0xffffff },
    { count: 4000, radius: 5000, size: 2.2, color: 0x9fd8ff },
    { count: 1500, radius: 3000, size: 3.0, color: 0xffe3b3 },
  ],
  ROTATION_SPEED: 0.0006, // 极缓慢旋转，营造深空静止错觉中的生命感
};

// 玩家飞船物理配置（Phase1：占位几何体 + 基础飞行模型）
export const ShipPhysicsConfig = {
  MAX_LINEAR_SPEED: 420, // 单位/秒
  BOOST_MULTIPLIER: 2.2,
  THRUST_ACCEL: 140, // 加速度
  LINEAR_DAMPING: 0.6, // 每秒速度保留比例的对数衰减基数（用于模拟太空中依然存在的操控阻尼，而非真实牛顿惯性，方便手感调节）
  BRAKE_DAMPING: 2.4,
  PITCH_RATE: 1.6, // 弧度/秒
  YAW_RATE: 1.2,
  ROLL_RATE: 2.4,
  ANGULAR_DAMPING: 4.0,
};

// 第三人称追踪摄像机配置
export const CameraRigConfig = {
  OFFSET: { x: 0, y: 4.2, z: 12 }, // 相对飞船局部坐标的理想偏移（追在飞船后上方；飞船前进方向为局部 -Z，故"后方"取正 Z）
  LOOK_AHEAD: 20,
  POSITION_LERP: 4.5, // 越大跟随越紧
  ROTATION_SLERP: 6.0,
  FOV_BOOST_KICK: 6, // 加速时的 FOV 微增，增强速度感
};

// 输入按键映射（Phase1：键盘飞行；Phase2 追加开火按键）
export const InputConfig = {
  KEY_PITCH_UP: 'KeyS',
  KEY_PITCH_DOWN: 'KeyW',
  KEY_YAW_LEFT: 'KeyA',
  KEY_YAW_RIGHT: 'KeyD',
  KEY_ROLL_LEFT: 'KeyQ',
  KEY_ROLL_RIGHT: 'KeyE',
  KEY_BOOST: 'ShiftLeft',
  KEY_BRAKE: 'Space',
  KEY_THROTTLE_UP: 'ArrowUp',
  KEY_THROTTLE_DOWN: 'ArrowDown',
  // 主武器沿用鼠标左键（符合射击游戏的肌肉记忆），副武器（导弹）用键盘，
  // 避免右键触发浏览器上下文菜单带来的额外处理成本
  MOUSE_BUTTON_PRIMARY_FIRE: 0,
  KEY_SECONDARY_FIRE: 'KeyF',
  // Phase3：降落/起飞与采矿是「按一下触发一次」的动作键，
  // 由 InputController 做边沿检测（justPressed），而非像飞行控制那样持续读取按住状态
  KEY_LAND_TOGGLE: 'KeyL',
  KEY_MINE: 'KeyG',
  KEY_DOCK_TOGGLE: 'KeyK',
};

// 碰撞检测配置（空间哈希网格）
export const CollisionConfig = {
  CELL_SIZE: 40, // 网格单元边长，应略大于「典型交战距离下弹丸飞行一帧的位移」
};

// 敌人 AI 行为参数
export const EnemyAIConfig = {
  DETECTION_RANGE: 260, // 超过此距离敌人处于「巡逻」，不会主动索敌
  ATTACK_RANGE: 140, // 进入此距离切换到「攻击」状态并开火
  DISENGAGE_RANGE: 340, // 超过此距离放弃追击，回到「巡逻」
  FLEE_HULL_RATIO: 0.25, // 船体低于此比例触发「逃跑」状态
  CALL_FOR_HELP_RADIUS: 400, // 请求支援的广播半径，范围内的友军会切换到「攻击」
  PATROL_RADIUS: 120, // 巡逻状态下绕出生点游走的半径
  AIM_TOLERANCE_RAD: 0.12, // 机头与目标方向夹角小于此值才允许开火，避免"指哪打不哪"
  THROTTLE_PATROL: 0.3,
  THROTTLE_CHASE: 0.85,
  THROTTLE_ATTACK: 0.6,
  THROTTLE_FLEE: 1.0,
};

// 玩家/敌人飞船的初始生命值与武器配置（Phase6 改装系统上线前的默认出厂配置）
export const PlayerShipDefaults = {
  MAX_HULL: 100,
  MAX_SHIELD: 60,
  SHIELD_REGEN_PER_SECOND: 8,
  SHIELD_REGEN_DELAY: 4,
  PRIMARY_WEAPON_ID: 'machine_gun_mk1',
  SECONDARY_WEAPON_ID: 'homing_missile_mk1',
  MAX_ENERGY: 100, // Phase6：武器开火消耗的能量电容上限
  ENERGY_REGEN_PER_SECOND: 10,
};

export const EnemyShipDefaults = {
  MAX_HULL: 60,
  MAX_SHIELD: 20,
  SHIELD_REGEN_PER_SECOND: 4,
  SHIELD_REGEN_DELAY: 5,
  PRIMARY_WEAPON_ID: 'pulse_laser_mk1',
  MAX_SPEED_MULTIPLIER: 0.85, // 敌人基础速度略低于玩家，保证 Phase2 初期难度可控
};

// 银河程序生成配置（Phase3）。SEED 固定后，同一坐标的扇区永远生成相同内容，
// 为 Phase7 存档系统（只需存种子+玩家状态，不用存整个银河）打基础。
export const GalaxyConfig = {
  SEED: 20260707, // 全局种子
  SECTOR_SIZE: 4000, // 每个扇区的边长（世界单位）
  LOAD_RADIUS_SECTORS: 1, // 以玩家所在扇区为中心额外加载的环数（1 => 3x3=9 个扇区）
  STAR_SPAWN_CHANCE: 0.85, // 扇区生成恒星系的概率，其余为「无主空域」
  PLANETS_PER_SYSTEM: [2, 6],
  ASTEROID_BELT_CHANCE: 0.5,
  ASTEROID_COUNT: [40, 90],
  STATION_SPAWN_CHANCE: 0.55, // 有恒星系的扇区里，出现空间站的概率
  // 阵营领地标签：Phase5 外交/科技树上线前，仅作为扇区展示信息使用
  TERRITORIES: ['联邦区域', '帝国区域', '商盟区域', '海盗区', '无主星域'],
};

// 行星表面（登陆）配置（Phase3）
export const PlanetConfig = {
  LANDING_MAX_DISTANCE: 60, // 距行星表面网格生成点多近才允许触发降落
  LANDING_MAX_SPEED: 40, // 降落时飞船速度上限，防止高速砸向地表
  SURFACE_RADIUS: 260, // 地表可探索方形地块的半宽
  SURFACE_RESOLUTION: 64, // 地形网格分辨率（每边顶点数）
  HEIGHT_SCALE: 14,
  NOISE_FREQUENCY: 0.006,
  RESOURCE_NODE_COUNT: [6, 14],
  RESOURCE_PICKUP_RANGE: 12,
  HAZARD_ZONE_COUNT: [1, 3],
  HAZARD_RADIUS: [30, 70],
  HAZARD_DPS: [4, 10],
  CARGO_CAPACITY: 100,
};

// 空间站对接与站内服务配置（Phase4）
export const StationConfig = {
  DOCKING_MAX_SPEED: 30, // 对接时飞船速度上限
  REPAIR_COST_PER_HULL_POINT: 3, // 每点装甲维修花费的信用点
};

// 银河环境 NPC（非战斗，纯氛围交通）配置（Phase4）
export const NPCConfig = {
  PER_STATION_COUNT: [1, 3], // 每个有空间站的扇区生成的 NPC 数量
  MAX_SPEED_MULTIPLIER: 0.55, // 传给 ShipPhysics 的速度上限系数，明显比战斗单位慢
  CRUISE_THROTTLE: 0.7, // AI 每帧设定的油门值（是"已经调低的上限"里的 70%，不是全局速度的 70%）
  WAYPOINT_COUNT: [3, 5], // 每艘 NPC 在自己扇区内巡回的航点数量
  WAYPOINT_RADIUS: 900, // 航点相对扇区中心（恒星）的分布半径
  WAYPOINT_ARRIVAL_DISTANCE: 30, // 判定"到达"航点的距离阈值
  STEER_MAX_ANGLE: Math.PI / 4, // 比例自动驾驶的满舵角度阈值（转弯比战斗 AI 更柔和）
};
