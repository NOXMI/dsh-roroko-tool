/**
 * dnd 的四把「看世界」工具：单人卡、世界状态、NPC、剧情。
 *
 * 与投篮那几把分开是因为它们只用读、或者只改自己那张表，
 * 拆出去免得 index.ts 涨到一千行。
 *
 * 依赖由 mount 递进来（dbPath / 当前房间 / 记录 / 共用小工具）。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export interface ToolDeps {
  /** 当前房间（桥塞进来的那个）。 */
  room: () => string | undefined
  /** dnd.db 路径。 */
  dbPath: () => string
  /** 打开库执行一段，自动关。 */
  withDb: <T>(path: string, fn: (db: DatabaseSync) => T) => T
  log: (...args: unknown[]) => void
}

function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** json 列取值（坏数据当空）。 */
function jsonOf<T>(value: unknown, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(String(value ?? ''))
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

/**
 * 单人完整卡：法术、熟练、背景故事都在。**只在真要细节时调它。**
 * @param deps - 运行环境。
 * @returns 工具定义。
 */
export function createSheetTool(deps: ToolDeps) {
  return defineTool({
    name: 'dnd_sheet',
    description:
      '读某人的完整角色卡：属性与调整值、熟练、法术、装备、状态、背景故事。'
      + '每轮的队伍快照只有档位，要细节才调这个。',
    parameters: {
      who: { type: 'string', required: true, description: '角色名' },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { who: string }) {
      const room = deps.room()
      if (!room) return '当前没有活跃房间。'
      const path = deps.dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      try {
        return deps.withDb(path, (db) => {
          const row = db
            .prepare(
              'SELECT v.* FROM v_characters v JOIN room_members m ON m.character_id = v.id'
              + ' WHERE m.room_id = ? AND v.name = ? LIMIT 1',
            )
            .get(room, String(args.who)) as Record<string, unknown> | undefined
          if (!row) return `房间里找不到「${args.who}」。`
          const attrs = [
            ['力', row.str, row.str_mod], ['敏', row.dex, row.dex_mod], ['体', row.con, row.con_mod],
            ['智', row.int_, row.int_mod], ['感', row.wis, row.wis_mod], ['魅', row.cha, row.cha_mod],
          ]
            .map(([name, score, mod]) => `${name}${score}(${Number(mod) >= 0 ? '+' : ''}${mod})`)
            .join(' ')
          const skills = jsonOf<Record<string, string>>(row.skills, {})
          const skillText = Object.entries(skills)
            .map(([name, level]) => `${name}${level === 'exp' ? '（专精）' : ''}`)
            .join('、')
          const spells = jsonOf<string[]>(row.spells, [])
          const cantrips = jsonOf<string[]>(row.cantrips, [])
          const lines = [
            `## ${String(row.name)}`,
            `${String(row.race ?? '')} ${String(row.class ?? '')} ${String(row.level ?? 1)} 级`,
            `HP ${row.hp}/${row.hp_max}${Number(row.hp_temp) > 0 ? `+${row.hp_temp}` : ''} · AC ${row.ac} · 速度 ${row.speed} 尺 · 熟练 +${row.prof_bonus}`,
            `属性：${attrs}`,
            skillText ? `熟练技能：${skillText}` : '',
            row.spell_ability ? `施法：${row.spell_ability} 系，DC ${row.spell_dc ?? '—'}` : '',
            cantrips.length ? `戏法：${cantrips.join('、')}` : '',
            spells.length ? `法术：${spells.join('、')}` : '',
            `装备：${JSON.stringify(jsonOf(row.inventory, [])) === '[]' ? '—' : JSON.stringify(jsonOf(row.inventory, []))}`,
            `状态：${jsonOf<string[]>(row.conditions, []).join('、') || '—'}${row.concentration ? ` · 专注 ${row.concentration}` : ''}`,
            row.backstory ? `背景：${String(row.backstory)}` : '',
          ]
          return lines.filter(line => line.length > 0).join('\n')
        })
      } catch (error) {
        return '读卡失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args: { who: string }) {
      return { card: 'generic', title: `看 ${args.who} 的卡`, kind: 'read', rawInput: args.who }
    },
  })
}

/**
 * 世界状态：时间地点、钟、任务。一个 action 管四件事。
 * @param deps - 运行环境。
 * @returns 工具定义。
 */
export function createWorldTool(deps: ToolDeps) {
  return defineTool({
    name: 'dnd_world',
    description:
      '世界状态。action=get 看全览（时间/地点/钟/任务）；'
      + 'set 改时间地点；clock 推进或新建进度钟；quest 增改任务。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['get', 'set', 'clock', 'quest'],
        description: 'get 看 / set 改时间地点 / clock 推钟 / quest 改任务',
      },
      patch: {
        type: 'json',
        description: 'set: {time?, location?, weather?}；clock: {name, by?, max?, on_fire?}；quest: {title, status?, desc?}',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { action: string; patch?: unknown }) {
      const room = deps.room()
      if (!room) return '当前没有活跃房间。'
      const path = deps.dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      const patch = (args.patch ?? {}) as Record<string, unknown>
      try {
        return deps.withDb(path, (db) => {
          if (args.action === 'set') {
            const sets: string[] = []
            const values: Array<string | number | null> = []
            if (typeof patch.location === 'string') {
              sets.push('location = ?')
              values.push(patch.location)
            }
            if (typeof patch.time === 'string') {
              sets.push('game_time = ?')
              values.push(patch.time)
            }
            if (sets.length === 0) return 'set 要给它 {time} 或 {location}。'
            db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).run(...values, room)
            const row = db.prepare('SELECT location, game_time FROM rooms WHERE id = ?').get(room) as Record<string, unknown>
            return `已更新 → ${row.location || '—'} · ${row.game_time || '—'}`
          }

          if (args.action === 'clock') {
            const name = String(patch.name ?? '').trim()
            if (!name) return 'clock 要给 {name}。'
            const existing = db
              .prepare('SELECT id, cur, max, on_fire FROM clocks WHERE room_id = ? AND name = ? LIMIT 1')
              .get(room, name) as Record<string, unknown> | undefined
            if (existing) {
              const cur = Math.max(0, Number(existing.cur ?? 0) + Number(patch.by ?? 1))
              const max = Number(patch.max ?? existing.max ?? 4)
              db.prepare('UPDATE clocks SET cur = ?, max = ?, status = ? WHERE id = ?')
                .run(Math.min(cur, max), max, cur >= max ? 'fired' : 'active', String(existing.id))
              return cur >= max
                ? `钟「${name}」满了：${String(existing.on_fire ?? '') || '后果发生'}`
                : `钟「${name}」→ ${Math.min(cur, max)}/${max}`
            }
            const max = Number(patch.max ?? 4)
            db.prepare('INSERT INTO clocks(id, room_id, name, cur, max, on_fire) VALUES(?, ?, ?, ?, ?, ?)')
              .run(`c_${Math.random().toString(36).slice(2, 8)}`, room, name, Number(patch.by ?? 1), max,
                String(patch.on_fire ?? ''))
            return `新钟「${name}」0 → ${Number(patch.by ?? 1)}/${max}`
          }

          if (args.action === 'quest') {
            const title = String(patch.title ?? '').trim()
            if (!title) return 'quest 要给 {title}。'
            const existing = db
              .prepare('SELECT id, status FROM quests WHERE room_id = ? AND title = ? LIMIT 1')
              .get(room, title) as Record<string, unknown> | undefined
            if (existing) {
              const status = String(patch.status ?? existing.status ?? 'open')
              db.prepare('UPDATE quests SET status = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?')
                .run(status, String(existing.id))
              return `任务「${title}」→ ${status}`
            }
            db.prepare('INSERT INTO quests(id, room_id, title, desc, status, is_main) VALUES(?, ?, ?, ?, ?, ?)')
              .run(`q_${Math.random().toString(36).slice(2, 8)}`, room, title, String(patch.desc ?? ''),
                String(patch.status ?? 'open'), patch.is_main === true ? 1 : 0)
            return `新任务「${title}」`
          }

          // get：全览
          const roomRow = db.prepare('SELECT location, game_time, chapter, round FROM rooms WHERE id = ?')
            .get(room) as Record<string, unknown>
          const clocks = db.prepare('SELECT name, cur, max, on_fire, status FROM clocks WHERE room_id = ?')
            .all(room) as Array<Record<string, unknown>>
          const quests = db.prepare('SELECT title, status, is_main FROM quests WHERE room_id = ? ORDER BY is_main DESC')
            .all(room) as Array<Record<string, unknown>>
          const lines = [
            `时间：${String(roomRow.game_time ?? '—')} · 地点：${String(roomRow.location ?? '—')}`,
            `第 ${String(roomRow.chapter ?? 1)} 章 · 第 ${String(roomRow.round ?? 0)} 轮`,
          ]
          if (clocks.length > 0) {
            lines.push('钟：' + clocks
              .map(c => `${String(c.name)} ${c.cur}/${c.max}${c.status === 'fired' ? '（已满）' : ''}`)
              .join(' · '))
          }
          if (quests.length > 0) {
            lines.push('任务：' + quests
              .map(q => `${q.is_main ? '[主线]' : '[支线]'}${String(q.title)}（${String(q.status)}）`)
              .join(' · '))
          }
          return lines.join('\n')
        })
      } catch (error) {
        return '世界状态操作失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args: { action: string }) {
      return { card: 'generic', title: `世界 ${args.action}`, kind: 'read' }
    },
  })
}

/**
 * NPC：名单、详情、建、改。
 * @param deps - 运行环境。
 * @returns 工具定义。
 */
export function createNpcTool(deps: ToolDeps) {
  return defineTool({
    name: 'dnd_npc',
    description:
      'NPC。action=list 看名单；get 看详情（含他知道什么、隐藏笔记）；'
      + 'upsert 建或改（给 name 再加字段）。NPC 不是全知的，knows 只写他真该知道的。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'upsert'], description: 'list / get / upsert' },
      name: { type: 'string', description: 'NPC 名（get / upsert 必给）' },
      patch: {
        type: 'json',
        description: 'upsert 字段：title / attitude(-2..2) / hp / hp_max / ac / knows[] / voice / notes_public / notes_hidden / location_id',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { action: string; name?: string; patch?: unknown }) {
      const room = deps.room()
      if (!room) return '当前没有活跃房间。'
      const path = deps.dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      const patch = (args.patch ?? {}) as Record<string, unknown>
      const name = String(args.name ?? '').trim()
      try {
        return deps.withDb(path, (db) => {
          if (args.action === 'list') {
            const rows = db
              .prepare('SELECT name, title, attitude, hp, hp_max FROM npcs WHERE room_id = ? ORDER BY name')
              .all(room) as Array<Record<string, unknown>>
            if (rows.length === 0) return '这一局还没有 NPC。'
            const tone = ['敌对', '冷淡', '中立', '友善', '亲近']
            return ['## NPC', ...rows.map(r =>
              `- ${String(r.name)}${r.title ? `（${String(r.title)}）` : ''}`
              + ` · ${tone[Math.max(0, Math.min(4, Number(r.attitude ?? 0) + 2))]}`
              + ` · HP ${r.hp}/${r.hp_max}`)].join('\n')
          }

          if (args.action === 'get') {
            if (!name) return 'get 要给 name。'
            const row = db.prepare('SELECT * FROM npcs WHERE room_id = ? AND name = ? LIMIT 1')
              .get(room, name) as Record<string, unknown> | undefined
            if (!row) return `没有叫「${name}」的 NPC。`
            const knows = jsonOf<string[]>(row.knows, [])
            return [
              `## ${String(row.name)}${row.title ? `（${String(row.title)}）` : ''}`,
              `态度：${String(row.attitude ?? 0)}（-2 敌对 … +2 亲近）· HP ${row.hp}/${row.hp_max} · AC ${row.ac}`,
              row.voice ? `说话方式：${String(row.voice)}` : '',
              knows.length ? `他知道：${knows.join('、')}` : '他知道：—',
              row.notes_hidden ? `（暗线）${String(row.notes_hidden)}` : '',
              row.notes_public ? `（可知）${String(row.notes_public)}` : '',
            ].filter(line => line.length > 0).join('\n')
          }

          // upsert
          if (!name) return 'upsert 要给 name。'
          const existing = db.prepare('SELECT id FROM npcs WHERE room_id = ? AND name = ? LIMIT 1')
            .get(room, name) as { id?: string } | undefined
          const fields: Record<string, unknown> = {}
          for (const key of ['title', 'attitude', 'hp', 'hp_max', 'ac', 'voice', 'notes_public', 'notes_hidden', 'location_id']) {
            if (key in patch) fields[key] = patch[key]
          }
          if ('knows' in patch) fields.knows = JSON.stringify(patch.knows ?? [])
          if (existing?.id) {
            const keys = Object.keys(fields)
            if (keys.length === 0) return `「${name}」没有要改的字段。`
            const sets = keys.map(k => `${k} = ?`).join(', ')
            db.prepare(`UPDATE npcs SET ${sets}, updated_at = datetime('now', '+8 hours') WHERE id = ?`)
              .run(...keys.map(k => fields[k] as string | number | null), existing.id)
            return `已更新 NPC「${name}」`
          }
          const id = `n_${Math.random().toString(36).slice(2, 8)}`
          const cols = ['id', 'room_id', 'name', ...Object.keys(fields)]
          const marks = cols.map(() => '?').join(', ')
          db.prepare(`INSERT INTO npcs(${cols.join(', ')}) VALUES(${marks})`)
            .run(id, room, name, ...Object.keys(fields).map(k => fields[k] as string | number | null))
          return `新 NPC「${name}」`
        })
      } catch (error) {
        return 'NPC 操作失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args: { action: string; name?: string }) {
      return { card: 'generic', title: `NPC ${args.action} ${args.name ?? ''}`, kind: 'other' }
    },
  })
}

/**
 * 剧情：当前场景、揭示、写检查点。
 * @param deps - 运行环境。
 * @returns 工具定义。
 */
export function createPlotTool(deps: ToolDeps) {
  return defineTool({
    name: 'dnd_plot',
    description:
      '剧情推进。action=current 看当前场景（含只有你能看的 dm_notes）；'
      + 'reveal 揭示一条线索给玩家；note 记一条暗线笔记。',
    parameters: {
      action: { type: 'string', required: true, enum: ['current', 'reveal', 'note'], description: 'current / reveal / note' },
      id: { type: 'number', description: 'reveal 时给剧情 id' },
      note: { type: 'string', description: 'note 时给内容（只有你看）' },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { action: string; id?: number; note?: string }) {
      const room = deps.room()
      if (!room) return '当前没有活跃房间。'
      const path = deps.dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      try {
        return deps.withDb(path, (db) => {
          if (args.action === 'current') {
            const row = db
              .prepare('SELECT id, kind, title, body, dm_notes FROM plots WHERE world_id ='
                + ' (SELECT world_id FROM rooms WHERE id = ?) AND revealed = 0'
                + ' ORDER BY ord LIMIT 1')
              .get(room) as Record<string, unknown> | undefined
            if (!row) return '没有未揭示的剧情块了。'
            return [
              `## #${String(row.id)} ${String(row.title ?? '')}（${String(row.kind)}）`,
              String(row.body ?? ''),
              row.dm_notes ? `\n（暗线）${String(row.dm_notes)}` : '',
            ].join('\n')
          }

          if (args.action === 'reveal') {
            const id = Number(args.id ?? 0)
            if (!id) return 'reveal 要给 id。'
            const row = db.prepare('SELECT id, title FROM plots WHERE id = ?').get(id) as Record<string, unknown> | undefined
            if (!row) return `没有 id=${id} 的剧情块。`
            db.prepare('UPDATE plots SET revealed = 1 WHERE id = ?').run(id)
            return `已揭示「${String(row.title ?? id)}」`
          }

          // note
          const text = String(args.note ?? '').trim()
          if (!text) return 'note 要给内容。'
          db.prepare("INSERT INTO notes(room_id, visibility, note) VALUES(?, 'hidden', ?)").run(room, text)
          return '记下了（只有你看）'
        })
      } catch (error) {
        return '剧情操作失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args: { action: string }) {
      return { card: 'generic', title: `剧情 ${args.action}`, kind: 'other' }
    },
  })
}

/**
 * 发道具：DM 手里的那点东西。
 *
 * give 按剧情给，temp=true 就是一次性的（用完没、离团没）；
 * list 看这间房现在摊着什么；take 收回去（搜身、没收、被抢）。
 */
export function createItemTool(deps: ToolDeps) {
  return defineTool({
    name: 'dnd_item',
    description:
      '给玩家发道具 / 查房间里有什么 / 查某个人身上有什么 / 收回一件。'
      + '发的是「能干什么」的东西（钥匙、地图、信、药），不是数值加成。'
      + 'temp=true 是临时道具：用完就消失、离团也消失。',
    parameters: {
      action: { type: 'string', required: true, description: 'give | list | take' },
      to: { type: 'string', description: '角色名（give / take 用；list 带上也查这个人身上）' },
      name: { type: 'string', description: '道具名（give / take 必填）' },
      kind: { type: 'string', description: 'map | key | consumable | misc，默认 misc' },
      temp: { type: 'boolean', description: 'true = 一次性' },
      note: { type: 'string', description: '一句话说明，玩家在个人界面能看到' },
      image: { type: 'string', description: 'map 类型的图片地址' },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { action: string; to?: string; name?: string; kind?: string; temp?: boolean; note?: string; image?: string }) {
      const room = deps.room()
      if (!room) return '当前没有活跃房间。'
      const path = deps.dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      const action = String(args.action ?? '').trim()

      try {
        return deps.withDb(path, (db) => {
          if (action === 'list') {
            const who0 = String(args.to ?? '').trim()

            // 点了名：这个角色身上的 = 卡里自带的 + 你发给他的
            if (who0) {
              const card = db
                .prepare(
                  'SELECT c.id, c.name, c.inventory, c.coin FROM characters c'
                  + ' JOIN room_members m ON m.character_id = c.id'
                  + ' WHERE m.room_id = ? AND c.name = ? LIMIT 1',
                )
                .get(room, who0) as { id?: number; name?: string; inventory?: unknown; coin?: unknown } | undefined
              if (!card) return `房间里没有「${who0}」。`
              const inv = jsonOf<Array<Record<string, unknown>>>(card.inventory, [])
              const given = db
                .prepare(
                  'SELECT name, kind, temp, note FROM room_items'
                  + ' WHERE room_id = ? AND owner_id = ? AND used = 0 ORDER BY created_at',
                )
                .all(room, Number(card.id)) as Array<Record<string, unknown>>
              const lines = [`${String(card.name)} 身上：`]
              if (inv.length > 0) {
                lines.push('随身（卡里带的）：')
                for (const o of inv) {
                  lines.push(`- ${String(o.name ?? '?')}${Number(o.qty ?? 1) > 1 ? ` ${String(o.qty)}` : ''}`)
                }
              }
              if (given.length > 0) {
                lines.push('这边发的：')
                for (const r of given) {
                  const temp = Number(r.temp) === 1 ? '  临时' : ''
                  const note = r.note ? `  ${String(r.note)}` : ''
                  lines.push(`- ${String(r.name)}  ${String(r.kind ?? 'misc')}${temp}${note}`)
                }
              }
              if (inv.length === 0 && given.length === 0) lines.push('- 两手空空。')
              const coin = jsonOf<Record<string, unknown>>(card.coin, {})
              const money = ['gp', 'sp', 'cp']
                .filter((k) => Number(coin[k] ?? 0) !== 0)
                .map((k) => `${String(coin[k])}${k}`)
                .join(' ')
              if (money) lines.push(`钱袋：${money}`)
              return lines.join('\n')
            }

            const rows = db
              .prepare(
                'SELECT i.name, i.kind, i.temp, i.note, c.name AS owner FROM room_items i'
                + ' LEFT JOIN characters c ON c.id = i.owner_id'
                + ' WHERE i.room_id = ? AND i.used = 0 ORDER BY i.created_at',
              )
              .all(room) as Array<Record<string, unknown>>
            if (rows.length === 0) return '这间房里没有道具。'
            return ['房里的道具（点名某个人可以看到他身上带的东西）：', ...rows.map((r) => {
              const owner = r.owner ? `（${String(r.owner)}）` : '（无主，谁都能拿）'
              const temp = Number(r.temp) === 1 ? '  临时' : ''
              const note = r.note ? `  ${String(r.note)}` : ''
              return `- ${String(r.name)}${owner}  ${String(r.kind ?? 'misc')}${temp}${note}`
            })].join('\n')
          }

          const name = String(args.name ?? '').trim()
          if (!name) return '给 / 收什么？说个名字。'

          const who = String(args.to ?? '').trim()
          let cid: number | null = null
          if (who) {
            const row = db
              .prepare(
                'SELECT c.id FROM characters c JOIN room_members m ON m.character_id = c.id'
                + ' WHERE m.room_id = ? AND c.name = ? LIMIT 1',
              )
              .get(room, who) as { id?: number } | undefined
            if (!row) return `房间里没有「${who}」。`
            cid = Number(row.id)
          }

          if (action === 'give') {
            const id = 'i_' + Math.random().toString(36).slice(2, 10)
            const payload = JSON.stringify(args.image ? { image: args.image } : {})
            db.prepare(
              'INSERT INTO room_items(id, room_id, owner_id, name, kind, payload, temp, note)'
              + ' VALUES(?,?,?,?,?,?,?,?)',
            ).run(id, room, cid, name, String(args.kind ?? 'misc'), payload,
                  args.temp ? 1 : 0, String(args.note ?? ''))
            const bits = [who ? `给了「${who}」` : '放在房间里（谁都能拿）', name]
            if (args.temp) bits.push('（临时，用完就没了）')
            return bits.join('：').replace('：', '：') + '。'
          }

          if (action === 'take') {
            const info = cid
              ? db.prepare('DELETE FROM room_items WHERE room_id = ? AND owner_id = ? AND name = ?')
                .run(room, cid, name)
              : db.prepare('DELETE FROM room_items WHERE room_id = ? AND name = ?').run(room, name)
            const changed = Number((info as { changes?: number }).changes ?? 0)
            return changed > 0 ? `收回了 ${name}。` : `房间里没有「${name}」。`
          }

          return 'action 只能是 give / list / take。'
        })
      } catch (err) {
        deps.log('[dnd_item] 出错', err)
        return `道具操作失败：${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
