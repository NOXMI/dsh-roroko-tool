/**
 * roroko-memory — 洛洛可经历记忆工具集(roroko-tool 电箱子功能)。
 *
 * 设计来源:`refs/notes/roroko-memory-design-v1.md`(2026-09-17 定稿)。用 DSH 姿势
 * 重写:agent preset 层注册两把 agent 工具,直连独立库 `roroko_memory.db`
 * (`node:sqlite`),不外包 python、不引入向量、不新增注入。
 *
 *   roroko_mem_edit  写记忆:op=add 落一条(初摘要 content + 二次摘要 summary),
 *                    created_at 由服务端按 CST 生成。反思(op=reflect)留 M4 刀。
 *   roroko_mem_date  按日期回查:默认今天 + 昨天(会话开始必读),带未反思统计。
 *
 * 电箱闸门(2026-09-18 阿一拍板 · A 案):**preset 声明即开关** ——
 * 需要在哪个工作区用记忆,就在那个 preset 里写 `roroko-memory` 行;不写即不存在。
 * 不做运行级开关:工具集属会话装配面,动态启停会打爆 request-cache(见 `fac49eb`)。
 *
 * 参数两层:preset 接线 config.dbPath / config.owner 优先,其次内置默认
 * (库路径服务器默认 /var/www/api/database/roroko_memory.db,owner 默认 dev)。
 * 参数只影响连哪个库、写哪个桶,不改工具 schema。
 *
 * 数据层限制(安全):只认 memory 一张表,表名列名全来自编译期常量;所有值走
 * 参数化绑定,不做字符串拼接;owner 走白名单式收窄(小写字母数字与 . _ -)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { DatabaseSync } from 'node:sqlite'
import { RorokoMemoryDefaultDbPath, RorokoMemoryDefaultOwner } from './settings.js'
import {
  MEMORY_OWNERS, MEMORY_ROUGH_DEFAULT_LIMIT, MEMORY_ROUGH_MAX_LIMIT, normalizeAdd, normalizeOwner,
  normalizeReflect,
} from './memory-form.js'
import { openMemoryDb, runAdd, runDate, runId, runReflect, runRough } from './memory-store.js'

export const name = 'roroko-memory'

/** 注入 tools 服务(注册 agent 工具必需)。 */
export const inject = ['tools']

/** roroko-memory 接线 config:preset agent.cordis.yml 里 roroko-memory 行可传。 */
export interface RorokoMemoryConfig {
  /** 记忆库绝对路径;缺省回落服务器默认路径。 */
  dbPath?: string
  /** 缺省 owner 桶(工具不传 owner 时用它);缺省回落 dev。 */
  owner?: string
}

/** "看全部桶"的显式取值。 */
const OWNER_ALL = 'all'

/** 工具输出统一渲染:text content block。 */
function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 解析生效库路径:preset config 优先 → 内置默认。 */
function resolveDbPath(config: RorokoMemoryConfig): string {
  if (config.dbPath !== undefined && config.dbPath.trim().length > 0) return config.dbPath.trim()
  return RorokoMemoryDefaultDbPath
}

/** 解析生效 owner 桶:preset config 优先 → 内置默认。 */
function resolveOwner(config: RorokoMemoryConfig): string {
  return normalizeOwner(config.owner) ?? RorokoMemoryDefaultOwner
}

/**
 * 解析工具入参里的 owner:'all' → undefined(全桶)、空 → preset 缺省桶、
 * 其他走 normalizeOwner 收窄。非法时给 error 字符串(工具返回人话,不抛)。
 */
function resolveOwnerArg(raw: unknown, fallback: string): { owner?: string; error?: string } {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === OWNER_ALL) return {}
  if (value.length === 0) return { owner: fallback }
  const owner = normalizeOwner(value)
  if (owner === undefined) return { error: `owner 非法: ${String(raw)}` }
  return { owner }
}

/** 注册两把记忆工具;preset 声明本插件即注册。 */
export function apply(ctx: Context, config: RorokoMemoryConfig = {}): void {
  const dbPath = resolveDbPath(config)
  const defaultOwner = resolveOwner(config)

  // 挂载即建表(幂等):库不可写时**不抛** —— 别让一个坏路径把 preset 挂载拖垮。
  try {
    openMemoryDb(dbPath).close()
  } catch {
    // 真正取用时会报明确错误
  }

  /** 每次调用独立开关连接。 */
  const withDb = (fn: (db: DatabaseSync) => string): string => {
    const db = openMemoryDb(dbPath)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  }

  const editTool = defineTool({
    name: 'roroko_mem_edit',
    description:
      '洛洛可记忆的写入与反思。'
      + 'op=add 记一条新记忆:content 是初摘要,summary 是粗筛/回查时看到的那句。'
      + '**写入前先过三问**:①人设或画像层已经有了?→ 不记 ②永久有效且每轮都该生效?→ 去改人设文件,不进这张表 '
      + '③它能改变我未来某个场景的行为?→ 记,并写成「触发条件 → 应做」。'
      + '必记四类:边界与安全词的演变 / 有效或无效的挑逗 / 未完成的钩子 / 我自己的失手记录。'
      + '不记素材与此刻状态(那是 roroko_datas_* 的地盘);不记人设里已有的偏好。'
      + 'op=reflect 反思已有那条(id):**整条覆盖 content**、刷新反思时间,summary 不传就保留原样;'
      + '适用 = 记错了 / 记得太啰嗦 / 有了更准的结论。'
      + '**观点变了或出现矛盾时别覆盖,用 op=add 另记一条**(保留矛盾,不消解)。'
      + `owner 缺省 = 当前 preset 配的桶(常用:${MEMORY_OWNERS.join(' / ')});reflect 不看 owner。`,
    parameters: {
      op: {
        type: 'string',
        required: true,
        enum: ['add', 'reflect'],
        description: 'add=写一条新记忆;reflect=反思并覆盖已有的那条。',
      },
      id: {
        type: 'number',
        description: 'op=reflect 必需:要反思的记忆 id(来自 roroko_mem_rough / roroko_mem_date 的结果)。',
      },
      content: {
        type: 'string',
        required: true,
        description: 'add=初摘要(发生了什么 + 结论);reflect=新的 content 正文,整条覆盖而非追加。',
      },
      summary: {
        type: 'string',
        description: 'add 必需;reflect 不传则保留原 summary。二次摘要:粗筛与按日期回查时看到的就是它(≤300 字)。',
      },
      owner: {
        type: 'string',
        description: `桶名,缺省 = preset 配的桶(${MEMORY_OWNERS.join(' / ')})。`,
      },
      kind: {
        type: 'string',
        description: '可选类别:event|fact|boundary|preference|thread|reflection(add 才用)。',
      },
      source: {
        type: 'string',
        description: '可选出处:会话 id 或 会话 id#事件序号(回原文的唯一凭据;add 才用)。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      if (args.op === 'reflect') {
        const reflected = normalizeReflect({ id: args.id, content: args.content, summary: args.summary })
        if (reflected.input === undefined) return `反思失败: ${reflected.error}`
        return withDb(db => runReflect(db, reflected.input!, new Date()))
      }
      const normalized = normalizeAdd({
        owner: args.owner !== undefined && args.owner.trim().length > 0 ? args.owner : defaultOwner,
        content: args.content,
        summary: args.summary,
        kind: args.kind,
        source: args.source,
      })
      if (normalized.input === undefined) return `写入失败: ${normalized.error}`
      return withDb(db => runAdd(db, normalized.input!, new Date()).text)
    },
    presentCall(args) {
      if (args.op === 'reflect') {
        return {
          card: 'generic',
          title: `反思 #${args.id}`,
          kind: 'other',
          rawInput: String(args.content ?? '').slice(0, 40),
        }
      }
      return {
        card: 'generic',
        title: '记一条记忆',
        kind: 'other',
        rawInput: String(args.summary ?? args.content ?? '').slice(0, 40),
      }
    },
  })

  const dateTool = defineTool({
    name: 'roroko_mem_date',
    description:
      '洛洛可记忆按日期回查:返回 id / 时间 / 类别 / 摘要 / 未反思标记。'
      + '默认区间 = 今天 + 昨天 —— **会话开始时先调它**(它取代了旧的 memory/*.md 必读);'
      + '他问"某天干了什么"时也用它。'
      + `owner 缺省 = 当前 preset 配的桶(${MEMORY_OWNERS.join(' / ')});要看所有桶传 owner=all。`
      + '要看某条的完整内容用 roroko_mem_id;想不起某事的细节用 roroko_mem_rough。',
    parameters: {
      from: {
        type: 'string',
        description: '起始日期 YYYY-MM-DD;不给 = 昨天(配 to 不给即今天+昨天)。',
      },
      to: {
        type: 'string',
        description: '结束日期 YYYY-MM-DD;只给 to = 查那一天。',
      },
      owner: {
        type: 'string',
        description: `桶名,缺省 = preset 配的桶;传 ${OWNER_ALL} 看所有桶。`,
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const resolved = resolveOwnerArg(args.owner, defaultOwner)
      if (resolved.error !== undefined) return resolved.error
      return withDb(db => runDate(db, { from: args.from, to: args.to, owner: resolved.owner }, new Date()))
    },
    presentCall(args) {
      const span = args.from !== undefined && args.from.length > 0 ? args.from : '今天+昨天'
      return { card: 'generic', title: `回查记忆 · ${span}`, kind: 'read', rawInput: span }
    },
  })

  const roughTool = defineTool({
    name: 'roroko_mem_rough',
    description:
      '洛洛可记忆关键词检索:按字符 bigram 算命中与覆盖度(零向量),返回 id / 时间 / 命中数 / 覆盖度 / 摘要。'
      + '**想不起某事时先调它**,别硬编。keywords 用空格或逗号分隔(≤8 个词,单字词也认)。'
      + '查不到会明说"没有匹配上" —— 那是关键词没对上,**不许据此编造记忆**。'
      + '返回的每条 recalled 自动 +1;摘要不够判断时再用 roroko_mem_id 取全文。'
      + `owner 缺省 = 当前 preset 配的桶(${MEMORY_OWNERS.join(' / ')});传 ${OWNER_ALL} 看所有桶。`,
    parameters: {
      keywords: {
        type: 'string',
        required: true,
        description: '检索词,空格/逗号分隔,如 "记忆 召回 bigram"。',
      },
      owner: {
        type: 'string',
        description: `桶名,缺省 = preset 配的桶(${MEMORY_OWNERS.join(' / ')});传 ${OWNER_ALL} 看所有桶。`,
      },
      limit: {
        type: 'number',
        description: `返回条数,缺省 ${MEMORY_ROUGH_DEFAULT_LIMIT},上限 ${MEMORY_ROUGH_MAX_LIMIT}。`,
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const resolved = resolveOwnerArg(args.owner, defaultOwner)
      if (resolved.error !== undefined) return resolved.error
      return withDb(db => runRough(db, { keywords: args.keywords, owner: resolved.owner, limit: args.limit }))
    },
    presentCall(args) {
      const words = String(args.keywords ?? '').slice(0, 40)
      return { card: 'generic', title: `检索记忆 · ${words}`, kind: 'read', rawInput: words }
    },
  })

  const idTool = defineTool({
    name: 'roroko_mem_id',
    description:
      '洛洛可记忆按 id 取完整内容(初摘要 content + 出处 source)。'
      + 'id 从 roroko_mem_rough / roroko_mem_date 的结果里拿 —— **只在摘要不足以判断时才取,别一次捞一堆**。'
      + '取用会把该条 recalled +1。owner 不给就跨桶(id 全局唯一),带了就只认该桶。',
    parameters: {
      id: {
        type: 'number',
        required: true,
        description: '记忆 id(正整数,来自检索或按日期回查的结果)。',
      },
      owner: {
        type: 'string',
        description: '可选:限定桶名,防跨桶误取。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const raw = typeof args.owner === 'string' ? args.owner.trim() : ''
      const owner = raw.length > 0 ? normalizeOwner(raw) : undefined
      if (raw.length > 0 && owner === undefined) return `owner 非法: ${raw}`
      return withDb(db => runId(db, { id: args.id, owner }))
    },
    presentCall(args) {
      return { card: 'generic', title: `读记忆 #${args.id}`, kind: 'read', rawInput: String(args.id) }
    },
  })

  ctx.tools.register(editTool)
  ctx.tools.register(dateTool)
  ctx.tools.register(roughTool)
  ctx.tools.register(idTool)
}
