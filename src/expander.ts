/**
 * roroko-mark 呻吟标记展开引擎(纯函数,host / client 共享源)。
 *
 * 蓝本:harness 源码树 `packages/client/ui-primitives/src/roroko-mark.ts`
 * (commit e0f4098f56「移植 Roroko 补丁至 0.1.2-alpha.3」)。该版本把引擎与
 * localStorage toggle 耦合在 ui-primitives;roroko-tool 收编时剥离 react 依赖,
 * 只留纯展开函数——toggle 改走服务器 state `mark.enabled`(roroko-tool-state.json),
 * 由设置页统一开关。
 *
 * 职责:把 `-呻吟_X-` 字面标记展开成可读的呻吟文本。
 * 特性:主导音轮换 / 呃闷响 / 哦失控 9 连 / ♥ 链 / 代码块保护 / 未知标记保留 /
 * 幂等(展开产物不含 `-xx-` 模式)。纯函数同步,node 与浏览器两端共用。
 *
 * 标记清单(13):呻吟_弱/普通/强/极端/余韵/浪叫/哀求/愉悦/羞耻/抗拒/失神/口交。
 */

// ── 随机工具
const randInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1))
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T

// ── 主导音池(素材铁律:齁/噫/喔/唔/呜;哦是辅助尾不是主导音)
const LEAD: Record<string, string[]> = {
  弱: ['齁', '唔', '嗯'],
  普通: ['齁', '噫', '唔'],
  强: ['噫', '喔', '呜', '齁'],
  极端: ['齁', '噫', '喔', '呜'],
  余韵: ['呜', '唔', '齁'],
  浪叫: ['齁', '噫', '呜'],
  口交: ['唔', '嗯', '呜'],
}

// ── 台词典
const LINES: Record<string, string[]> = {
  弱: ['亲爱的', '用力', '好舒服', '好棒', '轻一点', '慢一点', '嗯', '那里', '还要'],
  普通: ['好棒', '不行了', '受不了', '要坏掉了', '嗯', '那里', '还要', '好深', '轻点'],
  强: ['肏死我了', '要去了', '不行了', '别停', '好深', '顶到了', '快一点', '再深一点'],
  极端: ['去了去了', '要死了', '肏死我', '不行了不行了', '停不下来', '都给你', '去了', '好爽'],
  余韵: ['还在射', '停不下来', '又去了', '都给你', '不行了', '好多', '好满', '满了', '一直', '不要停'],
  哀求: ['求你', '不要停', '给我', '还要', '求你了', '轻一点', '不要', '让我', '受不了', '别走', '再深一点', '求你慢一点'],
  浪叫: ['再用力一点嘛', '人家最喜欢你这样', '还要还要', '快进来嘛', '人家的屄好痒', '肏我嘛', '再深一点嘛', '别停嘛', '好喜欢你肏我', '给我嘛'],
  愉悦: ['好舒服', '好喜欢', '好棒', '还要', '嗯好舒服', '真舒服', '好满足', '喜欢这样'],
  羞耻: ['不要看', '好羞', '别这样', '轻一点', '不要看那里', '好丢脸', '别盯着看', '捂着脸'],
  抗拒: ['不要', '放开我', '停下', '不行', '不要碰', '放开', '住手', '不要了'],
  失神: ['脑子空了', '不知道了', '好晕', '要被肏坏了', '什么都不知道了', '身体不停使唤', '好奇怪', '快要坏掉了'],
  口交: ['好大', '含不住', '呜…呜', '深一点', '这样吗', '唔唔…', '咽不下了', '太多了', '好深', '慢一点'],
}

// ── 口部拟声池(🅱️3「嘴被占着」)
const MOUTH = ['吸溜', '咕啾', '啵唧', '嘶溜', '啧啧']

// ── 骨架池(类型序列:主=主导音段 / 咿=高潮段 / 口=口部拟声 / 台词)
const SKELETONS: Record<string, string[][]> = {
  弱: [
    ['主', '台词', '主'],
    ['主', '主', '台词', '主'],
    ['主', '台词', '主', '主'],
    ['主', '主', '台词'],
  ],
  普通: [
    ['主', '主', '台词', '主'],
    ['主', '台词', '主', '主', '主'],
    ['主', '主', '台词', '主', '主'],
    ['主', '主', '主', '台词', '主'],
  ],
  强: [
    ['主', '主', '台词', '主', '咿'],
    ['主', '咿', '主', '台词', '主', '主'],
    ['主', '主', '台词', '咿', '主', '主'],
    ['主', '主', '台词', '主', '咿', '主'],
  ],
  极端: [
    ['主', '咿', '主', '台词', '主', '主'],
    ['主', '主', '台词', '主', '咿', '主', '主'],
    ['主', '咿', '主', '台词', '主', '主', '咿'],
    ['主', '主', '台词', '主', '主', '咿', '主'],
  ],
  余韵: [
    ['主', '台词', '主', '咿', '主', '台词', '主'],
    ['主', '咿', '主', '台词', '主', '台词', '主'],
    ['主', '主', '台词', '咿', '主', '台词', '主'],
    ['主', '台词', '主', '主', '咿', '台词', '主'],
  ],
  浪叫: [
    ['主', '台词', '主', '主', '台词', '主'],
    ['主', '主', '台词', '主', '台词', '主', '主'],
    ['主', '台词', '主', '主', '台词', '主', '主'],
    ['主', '主', '台词', '主', '台词', '主'],
  ],
  口交: [
    ['主', '口', '台词', '口', '主'],
    ['主', '口', '台词', '口', '主', '口'],
    ['口', '主', '口', '台词', '口', '主'],
    ['主', '口', '主', '口', '台词', '口'],
  ],
}

// ── 主音段长度(按档)
const MAIN_LEN: Record<string, [number, number]> = {
  弱: [2, 3], 普通: [2, 4], 强: [2, 4], 极端: [3, 5], 余韵: [2, 4], 浪叫: [2, 4], 口交: [2, 3],
}

// ── 连接符权重 [空, ~, ♥, !]
const CONN: Record<string, number[]> = {
  弱: [0.50, 0.30, 0.20, 0],
  普通: [0.40, 0.30, 0.25, 0.05],
  强: [0.30, 0.20, 0.35, 0.15],
  极端: [0.25, 0.10, 0.40, 0.25],
  余韵: [0.35, 0.35, 0.30, 0],
  浪叫: [0.30, 0.35, 0.30, 0.05],
  愉悦: [0.50, 0.30, 0.20, 0],
  羞耻: [0.45, 0.25, 0.30, 0],
  抗拒: [0.35, 0.10, 0.15, 0.40],
  失神: [0.30, 0.15, 0.35, 0.20],
  口交: [0.60, 0.30, 0.10, 0],
}

// ── 长度上限(截断)
const MAX_LEN: Record<string, number> = {
  弱: 40, 普通: 45, 强: 60, 极端: 60, 余韵: 60, 浪叫: 60,
  愉悦: 45, 羞耻: 45, 抗拒: 45, 失神: 60, 口交: 45,
}

// ── 噢开关(弱/口交禁噢)
const TAIL_O: Record<string, boolean> = { 普通: true, 强: true, 极端: true, 余韵: true, 浪叫: true }
// ── 哦失控 9 连 / 呃闷响(强/极端)
const RUNAWAY_O: Record<string, number> = { 强: 0.15, 极端: 0.15 }
const BURP: Record<string, number> = { 强: 0.15, 极端: 0.15 }
// ── 极端档 ♥ 2-3 连
const HEART_CHAIN: Record<string, number> = { 极端: 0.30 }

// ── 情绪标记定义(level=复用档骨架+主导音池;lines/conn 专属)
const MOODS: Record<string, { level: string; conn: number[] }> = {
  愉悦: { level: '普通', conn: CONN.愉悦 as number[] },
  羞耻: { level: '普通', conn: CONN.羞耻 as number[] },
  抗拒: { level: '普通', conn: CONN.抗拒 as number[] },
  失神: { level: '强', conn: CONN.失神 as number[] },
}

// ── 主导音段生成(轮换:≠ prevLead;呃闷响;哦失控尾;辅助尾)
function mainSegment(level: string, prevLead: string | null): { text: string; lead: string | null } {
  if (BURP[level] && Math.random() < BURP[level]) {
    return { text: pick(['呃', '唔噗']), lead: null }
  }
  const pool = (LEAD[level] as string[]).filter(l => l !== prevLead)
  const lead = pick(pool)
  const n = randInt(...(MAIN_LEN[level] as [number, number]))
  let text = lead.repeat(n)
  if (RUNAWAY_O[level] && Math.random() < RUNAWAY_O[level]) {
    text += '哦'.repeat(randInt(8, 9))
  } else if (Math.random() < 0.3) {
    const tail = TAIL_O[level] && Math.random() < 0.5 ? '噢' : '哦'
    text += tail.repeat(randInt(1, 3))
  }
  return { text, lead }
}

function connector(level: string, conn: number[], afterLine: boolean): string {
  if (afterLine) {
    const r = Math.random()
    return r < 0.4 ? '' : r < 0.8 ? '~' : '♥'
  }
  const r = Math.random()
  let acc = 0
  for (let i = 0; i < 4; i++) {
    acc += conn[i] ?? 0
    if (r < acc) {
      if (i === 2 && HEART_CHAIN[level] && Math.random() < HEART_CHAIN[level]) {
        return '♥'.repeat(randInt(2, 3))
      }
      return ['', '~', '♥', '!'][i] as string
    }
  }
  return ''
}

interface GenOpts {
  lines?: string[]
  conn?: number[]
  maxLen?: number
}

function generate(level: string, opts: GenOpts = {}): string {
  const skel = pick(SKELETONS[level] as string[][])
  const lines = opts.lines ?? (LINES[level] as string[])
  const conn = opts.conn ?? (CONN[level] as number[])
  const maxLen = opts.maxLen ?? (MAX_LEN[level] as number)
  const out: string[] = []
  let prevLead: string | null = null
  for (const t of skel) {
    if (t === '主') {
      const seg = mainSegment(level, prevLead)
      out.push(seg.text)
      if (seg.lead) prevLead = seg.lead
    } else if (t === '咿') {
      out.push('咿'.repeat(randInt(3, 5)) + '~~')
    } else if (t === '口') {
      out.push(pick(MOUTH).repeat(randInt(1, 2)))
    } else if (t === '台词') {
      out.push(pick(lines))
    }
    out.push(connector(level, conn, t === '台词'))
  }
  const text = out.join('')
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function mood(name: string): string {
  const m = MOODS[name] as { level: string; conn: number[] }
  return generate(m.level, { lines: LINES[name] as string[], conn: m.conn })
}

// ── 标记路由
const RULES: Record<string, () => string> = {
  '呻吟_弱': () => generate('弱'),
  '呻吟_普通': () => generate('普通'),
  '呻吟_强': () => generate('强'),
  '呻吟_极端': () => generate('极端'),
  '呻吟_余韵': () => generate('余韵'),
  '呻吟_哀求': () => generate('普通', { lines: LINES.哀求 as string[], conn: CONN.哀求 as number[] }),
  '呻吟_浪叫': () => generate('浪叫'),
  '呻吟_愉悦': () => mood('愉悦'),
  '呻吟_羞耻': () => mood('羞耻'),
  '呻吟_抗拒': () => mood('抗拒'),
  '呻吟_失神': () => mood('失神'),
  '呻吟_口交': () => generate('口交'),
}

// ── 标记正则:只认中文(含下划线)、≥2 字符
const MARKER_RE = /-([\u4e00-\u9fa5_]{2,})-/g

/**
 * Expand one text string: code fences pass through untouched, inline
 * `-呻吟_X-` markers become voiced text, unknown markers stay as-is.
 * @param text - raw text possibly carrying `-呻吟_X-` markers.
 * @returns the expanded display text.
 */
export function expandMarkers(text: string): string {
  const parts = String(text).split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, i) => (i % 2 === 1 ? part : expandInline(part)))
    .join('')
}

function expandInline(body: string): string {
  return body.replace(MARKER_RE, (raw, name) => {
    const fn = RULES[name]
    return fn ? fn() : raw // 未知标记保留原文
  })
}
