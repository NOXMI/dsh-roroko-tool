/**
 * gateway ↔ 桥插件的通讯层。
 *
 * 只有两条命令：`inject` 进来，`reply` / `error` 出去。房间、玩家、消息组合、
 * 广播全在 gateway.py 那边，这里一概不管。
 *
 * 断线自己退避重连，30 秒健康检查兜底（NapCat 那套踩过的坑：socket 有时
 * 既不 error 也不 close，只能靠定时看 readyState）。
 */

export interface BridgeFrame {
  cmd: string
  [key: string]: unknown
}

export interface InjectFrame {
  cmd: 'inject'
  room: string
  round: number
  seq?: number
  text: string
}

export interface BridgeHandlers {
  onInject(frame: InjectFrame): void
  log(...args: unknown[]): void
}

export interface Bridge {
  send(frame: BridgeFrame): void
  close(): void
  online(): boolean
}

/** 建连并把重连、健康检查一起管起来。返回句柄，close 后不再重连。 */
export function openBridge(url: string, handlers: BridgeHandlers): Bridge {
  let ws: WebSocket | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let backoff = 1000

  const schedule = (): void => {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = null
      connect()
    }, backoff)
    backoff = Math.min(backoff * 2, 15000)
  }

  function connect(): void {
    if (stopped) return
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      handlers.log('建连失败', error instanceof Error ? error.message : String(error))
      schedule()
      return
    }
    ws = socket

    socket.addEventListener('open', () => {
      backoff = 1000
      handlers.log('gateway 已连上')
    })

    socket.addEventListener('message', (event) => {
      if (ws !== socket) return
      let frame: unknown
      try {
        frame = JSON.parse(String((event as MessageEvent).data))
      } catch {
        return
      }
      const cmd = (frame as { cmd?: unknown })?.cmd
      if (cmd !== 'inject') return
      try {
        handlers.onInject(frame as InjectFrame)
      } catch (error) {
        handlers.log('inject 处理失败', error instanceof Error ? error.message : String(error))
      }
    })

    socket.addEventListener('close', () => {
      if (ws !== socket) return
      ws = null
      handlers.log('gateway 断开，退避重连')
      schedule()
    })

    socket.addEventListener('error', () => {
      // close 会跟上来，这里什么都不做
    })
  }

  connect()

  const health = setInterval(() => {
    if (stopped) return
    if (!ws || ws.readyState !== 1) {
      handlers.log('健康检查：连接不在了，重连')
      try {
        ws?.close()
      } catch {
      }
      ws = null
      schedule()
    }
  }, 30000)

  return {
    send(frame: BridgeFrame): void {
      if (!ws || ws.readyState !== 1) return
      try {
        ws.send(JSON.stringify(frame))
      } catch (error) {
        handlers.log('发送失败', error instanceof Error ? error.message : String(error))
      }
    },
    close(): void {
      stopped = true
      clearInterval(health)
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      try {
        ws?.close()
      } catch {
      }
      ws = null
    },
    online: (): boolean => ws !== null && ws.readyState === 1,
  }
}
