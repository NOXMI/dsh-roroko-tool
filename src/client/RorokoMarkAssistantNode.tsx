/**
 * RorokoMarkAssistantNode — web GUI 的 roroko-mark shadow 渲染节点。
 *
 * 注册到 `conversation.chat.node` key='assistant-step' priority -1,顶替官方
 * AssistantNodeView,在显示层把 assistant 文本块里的 -呻吟_X- 标记展开为呻吟
 * 文本(session 存储仍存原文,模型上下文零污染)。开关读服务器 state mark.enabled
 * (roroko-mark.ts),渲染时按开关决定展开与否。
 *
 * 复刻基线:官方 ui-chat AssistantNodeView + AssistantMarkdown(0.1.1-rc.2 与
 * 0.1.2-alpha.3 同构)。跨包不能 import ui-chat 内部组件/css module,故:
 * - text 块:useRorokoMarkEnabled() + expandMarkers() 后交公共 MarkdownText
 * - reasoning 块:简化 DisclosureRow(公共件),折叠交互保留;hidden 直接不渲染
 * - image 块:连续图组照抄官方分组,委托 owner 的 renderMessageImages
 * - tool-call:由 ChatView 分组渲染,此处跳过(与官方一致)
 * - 布局:内联 style(与官方 AssistantMarkdown.module.css 视觉一致)
 * - 文案:t 不依赖 chat locale(避免跨 namespace 词典问题),固定中文
 */

import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DisclosureRow, IconThinkOutline14, JsonBlock, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { expandMarkers } from '../expander.js'
import { useRorokoMarkEnabled } from './roroko-mark.ts'

// ── 结构类型自声明(与官方 contract 对齐,不引 ui-chat 内部类型) ──────────────

interface AssistantBlockLike {
  kind: string
  text?: string
  attachment?: unknown
  block?: unknown
  callId?: string
  name?: string
  argsRaw?: string
}

interface AssistantNodeDataLike {
  blocks?: readonly AssistantBlockLike[]
  status?: string
  step?: number
  finalNode?: { seq?: number } | undefined
}

interface TurnLike {
  status?: string
  turn?: number
}

interface TailClosingLike {
  finalNode?: { seq?: number }
}

interface TurnProcessOwnerLike {
  foldable?: boolean
  open?: boolean
  setOpen?: (open: boolean) => void
  spec?: {
    answerStep?: number | null
    inlineReasoning?: boolean
  }
}

/** 展开开关默认 labels(不依赖 chat locale 词典)。 */
const ZH_LABELS: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

// ── 布局(对齐官方 AssistantMarkdown.module.css 视觉) ───────────────────────

const rootStyle: Record<string, string> = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 'var(--dsh-content-font-size, 14px)',
  lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
  color: 'var(--dsw-alias-label-primary)',
}

const bodyStyle: Record<string, string> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
}

const stoppedStyle: Record<string, string> = {
  alignSelf: 'flex-start',
  padding: '0 6px',
  borderRadius: '6px',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: '11px',
  lineHeight: '18px',
}

const thinkBodyStyle: Record<string, string> = {
  // 对齐官方 ReasoningRow.module.css .thinkBody:缩进到 title 行下、次级字号、
  // tertiary 颜色,与正文(primary 级)区分开。
  padding: '4px 0 4px calc(22px + var(--dsh-content-font-delta, 0px))',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const summaryStyle: Record<string, string> = {
  // 对齐官方 .summary:次级字号 + tertiary 颜色 + 单行省略。
  minWidth: '0',
  overflow: 'hidden',
  flex: '1 1 auto',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const sepStyle: Record<string, string> = {
  flex: 'none',
  width: '2px',
  height: '2px',
  margin: '0 8px',
  borderRadius: '1px',
  background: 'var(--dsw-alias-label-caption)',
}

// ── text 块:按开关展开后渲染(展开 memo 化,流式重渲染不重掷随机) ───────────

function RorokoText({ text, streaming, fileMentions }: {
  text: string
  streaming: boolean
  fileMentions?: MarkdownFileMentions | undefined
}): ReactNode {
  const enabled = useRorokoMarkEnabled()
  const rendered = useMemo(
    () => (enabled ? expandMarkers(text) : text),
    [enabled, text],
  )
  return (
    <MarkdownText
      text={rendered}
      streaming={streaming}
      labels={ZH_LABELS}
      fileMentions={fileMentions}
    />
  )
}

// ── reasoning 块:Think 折叠行(公共 DisclosureRow),hidden 时不渲染 ──────────

function ThinkRow({ text, running }: { text: string; running: boolean }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const newline = text.indexOf('\n')
  const summary = running
    ? text.slice(text.trimEnd().lastIndexOf('\n') + 1)
    : (newline === -1 ? text : text.slice(0, newline))
  return (
    <div style={{ margin: 0 }} data-variant="think" data-state={running ? 'running' : 'ok'}>
      <DisclosureRow
        icon={<IconThinkOutline14 size={14} />}
        title="思考"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span style={sepStyle} aria-hidden />
            <span style={summaryStyle}>{summary}</span>
          </>
        )}
      >
        <div style={thinkBodyStyle}>{text}</div>
      </DisclosureRow>
    </div>
  )
}

function ProcessReasoning({ hidden, reveal, children }: {
  hidden: boolean
  reveal?: (() => void) | undefined
  children: ReactNode
}): ReactNode {
  if (hidden) return null
  return <div data-turn-process-inline>{children}</div>
}

// ── assistant 消息渲染(blocks 遍历,与官方 AssistantMarkdown 同构) ──────────

export interface RorokoMarkAssistantNodeProps {
  node?: {
    data?: AssistantNodeDataLike
    location?: {
      kind?: string
      turn?: TurnLike
    }
    key?: string
  }
  useTurnData?: (slot: string) => { closing?: TailClosingLike } | undefined
  openFile?: (seq: number) => void
  renderMessageImages?: (props: {
    images: Array<{ attachment: unknown }>
    align: string
  }) => ReactNode
  fileMentions?: (owner: unknown) => MarkdownFileMentions | undefined
  turnProcess?: TurnProcessOwnerLike | undefined
}

/**
 * Shadow 节点入口:照抄官方 AssistantNodeView 的计算(mentions/reasoningHidden),
 * 把官方 AssistantMarkdown 换成展开版。
 */
export function RorokoMarkAssistantNode(props: RorokoMarkAssistantNodeProps): ReactNode {
  const { node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions } = props
  const data = node?.data
  const location = node?.location
  const turn = location?.kind === 'turn' || location?.kind === 'step'
    ? location.turn
    : undefined
  const tail = useTurnData?.('turn-tail')
  const owner = useMemo(() => {
    if (turn?.status !== 'closed' || data?.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode?.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions?.(owner),
    [fileMentions, owner],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable === true
    && turnProcess.spec?.answerStep === data?.step
    && turnProcess.spec?.inlineReasoning === true
    && turnProcess.open !== true
  const revealProcess = useCallback(() => { turnProcess?.setOpen?.(true) }, [turnProcess])

  const blocks = data?.blocks ?? []
  const streaming = data?.status === 'running'
  const interrupted = data?.status === 'interrupted'
  const last = blocks.length - 1

  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null

  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <RorokoText key={i} text={block.text ?? ''} streaming={streaming} fileMentions={mentions} />,
        )
        break
      case 'reasoning':
        rendered.push(
          <ProcessReasoning key={i} hidden={reasoningHidden} reveal={revealProcess}>
            <ThinkRow text={block.text ?? ''} running={streaming && i === last} />
          </ProcessReasoning>,
        )
        break
      case 'image': {
        // 连续图块共用一组画廊(照抄官方分组:按首块 index 做 key)。
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages?.({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label="未知内容块"
            payload={block.block}
            truncatedLabel={(total: number) => `共 ${total} 项`}
          />,
        )
    }
  }

  return (
    <div style={rootStyle} data-streaming={streaming || undefined}>
      <div style={bodyStyle}>
        {rendered}
        {interrupted === true
          && <span style={stoppedStyle}>已停止</span>}
      </div>
    </div>
  )
}
