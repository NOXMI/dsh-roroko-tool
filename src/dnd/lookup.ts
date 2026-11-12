/**
 * dnd_lookup：查规则库。
 *
 * 库是 rules.db（5etools 双源构建，见 build_rules_db.py）。跟 dnd.db 放一起，
 * 由阿一维护，进程只读。这里只做两件事：按名字查、把 5etools 的正文标记
 * 翻成人能读的中文句子。
 *
 * 为什么不把 {@tag} 原样丢给 DM：那是给渲染器看的，直接读会满屏 {@damage 8d6}
 * 和 {@condition 倒地}，DM 还得自己脑内替换一遍，白烧 token。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export interface LookupDeps {
  /** rules.db 路径。默认跟 dnd.db 同目录。 */
  rulesPath: () => string
  log: (...args: unknown[]) => void
}

function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 正文最多给这么多字，超了截断 —— DM 要的是能用，不是全文背诵。 */
const MAX_CHARS = 1800

// ── 5etools 标记 → 人话 ─────────────────────────────────────
const ATK: Record<string, string> = {
  mw: '近战武器攻击',
  rw: '远程武器攻击',
  ms: '近战法术攻击',
  rs: '远程法术攻击',
}

/** 取 `名称|来源|显示名` 里的显示名或名称。 */
function headOf(rest: string): string {
  const parts = rest.split('|')
  return (parts[2] || parts[0]).trim()
}

function renderTags(input: string): string {
  return input.replace(/\{@(\w+)\s?([^}]*)\}/g, (_all, tag: string, rest: string) => {
    const body = (rest ?? '').trim()
    switch (tag) {
      case 'hit': return `命中+${body}`
      case 'hitYourSpellAttack': return '命中+你的法术攻击加值'
      case 'h': return `命中：`
      case 'damage': return body
      case 'dice': return body
      case 'scaledamage':
      case 'scaledice': {
        const parts = body.split('|')
        return parts.length >= 2 ? parts[parts.length - 2] : parts[0]
      }
      case 'dc': return `DC ${body}`
      case 'atk': return ATK[body] ?? body
      case 'condition':
      case 'skill':
      case 'spell':
      case 'item':
      case 'creature':
      case 'feat':
      case 'background':
      case 'race':
      case 'class':
      case 'subclass':
      case 'action':
      case 'sense':
      case 'status':
      case 'hazard':
      case 'object':
      case 'deity':
      case 'boon':
        return headOf(body)
      case 'variantrule':
      case 'filter':
      case 'book':
      case 'adventure':
      case 'quickref':
        return headOf(body)
      case 'i': case 'italic': return body
      case 'b': case 'bold': return body
      case 's': case 'strike': return body
      case 'note': return `（${body}）`
      case 'recharge': return body ? `（充能 ${body}）` : '（充能 6）'
      case 'chance': return `（${body}%）`
      case 'coinflip': return `（掷硬币：${body}）`
      case 'unit': return body
      case 'comicH1': case 'comicH2': case 'comicH3': case 'comicH4': return body
      default: return headOf(body) || body
    }
  }).replace(/\{@\w+\}/g, '')
}

type Node = string | number | boolean | null | Node[] | { [key: string]: unknown }

/** 把 entries 那种嵌套结构摊成纯文本。深度够用就行，不追求覆盖全部类型。 */
function flatten(node: Node, depth = 0): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === 'string') {
    const text = renderTags(node).trim()
    return text ? [text] : []
  }
  if (typeof node === 'number' || typeof node === 'boolean') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(item => flatten(item, depth))
  const obj = node as Record<string, unknown>
  const type = String(obj.type ?? '')
  const out: string[] = []
  switch (type) {
    case 'entries':
    case 'section':
    case 'inset':
    case 'insetReadaloud':
    case 'quote': {
      if (typeof obj.name === 'string') out.push(`${depth > 0 ? '' : '## '}${renderTags(obj.name)}`)
      out.push(...flatten(obj.entries as Node, depth + 1))
      break
    }
    case 'list': {
      for (const item of (obj.items as Node[]) ?? []) {
        const lines = flatten(item, depth + 1)
        if (lines.length > 0) out.push(`· ${lines[0]}`, ...lines.slice(1))
      }
      break
    }
    case 'item': {
      const name = typeof obj.name === 'string' ? renderTags(obj.name) : ''
      const body = flatten((obj.entry ?? obj.entries) as Node, depth + 1).join(' ')
      out.push(name ? `· ${name}：${body}` : `· ${body}`)
      break
    }
    case 'table': {
      const cols = (obj.colLabels as string[]) ?? []
      if (cols.length > 0) out.push(cols.map(c => renderTags(String(c))).join(' | '))
      for (const row of (obj.rows as Node[][]) ?? []) {
        out.push(flatten(row as Node, depth + 1).join(' | '))
      }
      break
    }
    case 'abilityDc':
      out.push(`${String(obj.name ?? '')}豁免 DC = 8 + 熟练 + ${(obj.attributes as string[])?.join('/') ?? ''}调整`)
      break
    case 'abilityAttackMod':
      out.push(`${String(obj.name ?? '')}攻击加值 = 熟练 + ${(obj.attributes as string[])?.join('/') ?? ''}调整`)
      break
    case 'options': {
      for (const entry of (obj.entries as Node[]) ?? []) out.push(...flatten(entry, depth + 1))
      break
    }
    default: {
      // 兜底：有 entries/items 就继续往下挖，否则把字符串字段拼一下
      for (const key of ['entries', 'items', 'rows']) {
        if (obj[key]) out.push(...flatten(obj[key] as Node, depth + 1))
      }
      if (typeof obj.entry === 'string') out.push(...flatten(obj.entry, depth + 1))
    }
  }
  return out
}

function bodyOf(raw: unknown): string {
  if (!raw) return ''
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return renderTags(raw).slice(0, MAX_CHARS)
    }
  }
  const text = flatten(parsed as Node).filter(line => line.length > 0).join('\n')
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n…（后面还有，太长不念了）' : text
}

function pick(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.join('、') || '—'
      if (parsed && typeof parsed === 'object') return '—'
      return String(parsed)
    } catch {
      return value
    }
  }
  return String(value)
}

// ── 各表的渲染 ──────────────────────────────────────────────
type Row = Record<string, unknown>

function showSpecies(row: Row): string {
  const lines = [
    `## ${String(row.name)}（${String(row.name_en)}）· ${row.edition === 'one' ? '2024' : '2014'}`,
    `体型 ${pick(row.size)} · 速度 ${pick(row.speed)} 尺`
    + (row.darkvision ? ` · 黑暗视觉 ${pick(row.darkvision)} 尺` : ''),
    row.creature_type && row.creature_type !== '—' ? `生物类型：${pick(row.creature_type)}` : '',
    row.ability ? `属性加值：${pick(row.ability)}` : '属性加值：2024 物种不给，加值来自背景',
    row.skills !== '[]' ? `技能：${pick(row.skills)}` : '',
    '—',
    bodyOf(row.entries),
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

function showBackground(row: Row): string {
  const modes = String(row.ability_modes ?? '')
  const from = String(row.ability_from ?? '')
  const lines = [
    `## ${String(row.name)}（${String(row.name_en)}）· ${row.edition === 'one' ? '2024' : '2014'}`,
    from && from !== 'null'
      ? `属性加值：只能落在 ${from} 三项里，二选一 → +2/+1 或 +1/+1/+1`
      : (row.ability_2014 ? `属性加值：${pick(row.ability_2014)}` : '属性加值：—'),
    modes ? `可选分配：${modes}` : '',
    row.feats !== '[]' ? `送专长：${pick(row.feats)}` : '',
    row.skills !== '[]' ? `技能：${pick(row.skills)}` : '',
    row.tools !== '[]' ? `工具：${pick(row.tools)}` : '',
    '—',
    bodyOf(row.entries),
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

function showClass(row: Row): string {
  const lines = [
    `## ${String(row.name)}（${String(row.name_en)}）· ${row.edition === 'one' ? '2024' : '2014'}`,
    `生命骰 ${String(row.hit_die)} · 豁免熟练 ${pick(row.saves)} · 主属性 ${pick(row.primary_ability)}`,
    `护甲 ${pick(row.armor)} · 武器 ${pick(row.weapons)}`,
    row.skill_choose ? `技能：从 ${pick(row.skill_from)} 里选 ${String(row.skill_choose)} 项` : '',
    row.subclass_title ? `子职叫「${String(row.subclass_title)}」` : '',
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

function showSpell(row: Row): string {
  const lines = [
    `## ${String(row.name)}（${String(row.name_en)}）· ${String(row.level) === '0' ? '戏法' : `${String(row.level)} 环`}`,
    `学派 ${pick(row.school)} · 施法时间 ${pick(row.cast_time)} · 射程 ${pick(row.range)}`,
    `成分 ${pick(row.components)} · 持续时间 ${pick(row.duration)}`
    + (row.concentration ? ' · 需专注' : '') + (row.ritual ? ' · 可仪式' : ''),
    row.damage !== '[]' ? `伤害类型 ${pick(row.damage)}` : '',
    row.save !== '[]' ? `豁免 ${pick(row.save)}` : '',
    '—',
    bodyOf(row.entries),
    row.entries_higher ? `\n【升环】\n${bodyOf(row.entries_higher)}` : '',
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

function showMonster(row: Row): string {
  const abil = ['str', 'dex', 'con', 'int_', 'wis', 'cha']
    .map(k => `${k.replace('_', '')} ${row[k] ?? '—'}`)
    .join(' · ')
  const lines = [
    `## ${String(row.name)}（${String(row.name_en)}）· CR ${pick(row.cr)}`,
    `AC ${pick(row.ac)} · HP ${pick(row.hp)}（${pick(row.hp_formula)}）· ${pick(row.speed)}`,
    `体型 ${pick(row.size)} · 类型 ${pick(row.creature_type)} · 阵营 ${pick(row.alignment)}`,
    abil,
    row.saves !== '[]' ? `豁免 ${pick(row.saves)}` : '',
    row.skills !== '[]' ? `技能 ${pick(row.skills)}` : '',
    row.resist !== '[]' ? `抗性 ${pick(row.resist)}` : '',
    row.immune !== '[]' ? `免疫 ${pick(row.immune)}` : '',
    row.senses !== '[]' ? `感官 ${pick(row.senses)}` : '',
    row.languages !== '[]' ? `语言 ${pick(row.languages)}` : '',
    row.has_copy ? '⚠️ 这条是换皮条目（_copy），字段可能不全' : '',
    row.traits !== '[]' ? `\n【特性】\n${bodyOf(row.traits)}` : '',
    row.actions !== '[]' ? `\n【动作】\n${bodyOf(row.actions)}` : '',
    row.legendary !== '[]' ? `\n【传奇动作】\n${bodyOf(row.legendary)}` : '',
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

function showItem(row: Row): string {
  const lines = [
    `## ${String(row.name)}（${String(row.name_en)}）`,
    `类型 ${pick(row.kind)} · 稀有度 ${pick(row.rarity)}`,
    row.value_cp ? `价格 ${(Number(row.value_cp) / 100).toFixed(2).replace(/\.00$/, '')} GP` : '',
    row.weight ? `重量 ${pick(row.weight)} 磅` : '',
    row.damage1 ? `伤害 ${pick(row.damage1)}${row.damage2 ? `（双手 ${pick(row.damage2)}）` : ''} ${pick(row.damage_type)}` : '',
    row.ac ? `AC ${pick(row.ac)}` : '',
    row.properties !== '[]' ? `属性 ${pick(row.properties)}` : '',
    row.attune && row.attune !== 0 ? '需要同调' : '',
    '—',
    bodyOf(row.entries),
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

function showPlain(row: Row): string {
  return `## ${String(row.name)}（${String(row.name_en)}）\n${bodyOf(row.entries)}`
}

const TABLES: Record<string, { table: string; show: (row: Row) => string }> = {
  species: { table: 'species', show: showSpecies },
  background: { table: 'backgrounds', show: showBackground },
  class: { table: 'classes', show: showClass },
  feat: { table: 'feats', show: showPlain },
  spell: { table: 'spells', show: showSpell },
  monster: { table: 'monsters', show: showMonster },
  item: { table: 'items', show: showItem },
  condition: { table: 'conditions', show: showPlain },
  rule: { table: 'rule_terms', show: showPlain },
}

/** 一次给几条。多了 DM 也读不完。 */
const LIMIT = 3

/**
 * 查规则库：种族 / 背景 / 职业 / 专长 / 法术 / 物品 / 怪物 / 状态 / 术语。
 * @param deps - 运行环境。
 * @returns 工具定义。
 */
export function createLookupTool(deps: LookupDeps) {
  return defineTool({
    name: 'dnd_lookup',
    description:
      '查规则库：给个名字或关键词，返回种族/背景/职业/专长/法术/物品/怪物/状态的'
      + '机制数值和规则原文（已翻成人话）。裁定前拿不准就查，别凭印象编数值。',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: Object.keys(TABLES),
        description: '查哪一类',
      },
      kw: {
        type: 'string',
        required: true,
        description: '名字或关键词，中英文都行。如「火球」「goblin」「侍僧」',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { kind: string; kw: string }) {
      const spec = TABLES[String(args.kind)]
      if (!spec) return `没有「${args.kind}」这一类。可选：${Object.keys(TABLES).join(' / ')}`
      const kw = String(args.kw ?? '').trim()
      if (!kw) return '给个名字或关键词。'
      const path = deps.rulesPath()
      if (!existsSync(path)) return `规则库还没放上来：${path}`
      try {
        const db = new DatabaseSync(path, { readOnly: true })
        try {
          // 精确 > 前缀 > 包含，三档，避免一上来就大海捞针
          const rows = db
            .prepare(
              `SELECT * FROM ${spec.table}
               WHERE name = ? OR name_en = ?
               ORDER BY (name = ?) DESC, (name_en = ?) DESC
               LIMIT ${LIMIT}`,
            )
            .all(kw, kw, kw, kw) as Row[]
          let hits = rows
          if (hits.length === 0) {
            hits = db
              .prepare(
                `SELECT * FROM ${spec.table}
                 WHERE name LIKE ? OR name_en LIKE ?
                 ORDER BY length(name) LIMIT ${LIMIT}`,
              )
              .all(`%${kw}%`, `%${kw}%`) as Row[]
          }
          if (hits.length === 0) {
            return `「${kw}」在 ${args.kind} 里没找到。换个词，或者它可能压根不在 5e 规则里。`
          }
          const blocks = hits.map(spec.show)
          if (hits.length > 1) blocks.unshift(`找到 ${hits.length} 条：`)
          return blocks.join('\n\n')
        } finally {
          db.close()
        }
      } catch (error) {
        deps.log('[dnd_lookup] 查库失败', error)
        return '查库失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args: { kind: string; kw: string }) {
      return { card: 'generic', title: `查 ${args.kind}：${args.kw}`, kind: 'read', rawInput: args.kw }
    },
  })
}
