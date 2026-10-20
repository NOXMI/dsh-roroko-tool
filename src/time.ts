/**
 * 时间口径：**一律 CST(+0800)，用固定偏移算，不读运行环境时区**。
 *
 * 为什么单独一份：datas 与 memory 两个子模块都要写库里的 `YYYY-MM-DD HH:mm:ss`
 * 时间戳，谁也不该依赖谁（它们是兄弟目录）。所以把口径提到包根，两边共用同一把尺。
 *
 * 三条硬规矩（2026-09-24 拿生产库歪 8 小时换的，别再犯）：
 *   1. 写库一律 `fmtCst` —— **禁用 `toISOString()`**，那是 UTC 串且不带时区标记，
 *      读侧按本机时区解释就会整整齐齐差 8 小时
 *   2. 读库一律 `parseCstStamp` —— 显式补 +08:00，服务器被设成 UTC 也照对
 *   3. 日期比较只取前 10 位做字符串比较，不拼 '23:59:59' 落边界
 */

/** 东八区固定偏移（毫秒）。 */
const CST_OFFSET_MS = 8 * 60 * 60 * 1000

/** 两位补零。 */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把绝对时刻搬到东八区那面钟上，再用 UTC getter 读（于是与运行环境时区无关）。 */
function cstParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const shifted = new Date(date.getTime() + CST_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    ss: shifted.getUTCSeconds(),
  }
}

/** CST 时间戳 'YYYY-MM-DD HH:mm:ss'（库里的标准形态）。 */
export function fmtCst(date: Date): string {
  const p = cstParts(date)
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`
}

/** CST 日期 'YYYY-MM-DD'（今日清零、日期区间用）。 */
export function cstDate(date: Date): string {
  return fmtCst(date).slice(0, 10)
}

/** 库里的时间串形态：`YYYY-MM-DD HH:mm[:ss]`，允许 T 分隔。 */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/

/** 带时区标记的串（ISO 带 Z 或 ±hh:mm）—— 这种按原样解析。 */
const ZONED_RE = /([zZ]|[+-]\d{2}:?\d{2})$/

/**
 * 解析库里的时间戳：**无时区标记的一律当 CST**，显式补 +08:00。
 *
 * 为什么不能直接 `new Date(str.replace(' ','T'))`：那会按**宿主时区**解释，
 * 服务器时区一变（或进程被设成 UTC）读出来的相对时间就整体偏 8 小时。
 * @param value - 库里的时间串（任何类型都吃，坏值返回 Invalid Date）
 */
export function parseCstStamp(value: unknown): Date {
  if (typeof value !== 'string') return new Date(Number.NaN)
  const text = value.trim()
  if (text.length === 0) return new Date(Number.NaN)
  if (ZONED_RE.test(text)) return new Date(text)
  const matched = STAMP_RE.exec(text)
  if (matched === null) return new Date(Number.NaN)
  const [, y, mo, d, hh, mm, ss] = matched
  return new Date(Date.UTC(
    Number(y), Number(mo) - 1, Number(d),
    Number(hh) - 8, Number(mm), Number(ss ?? '0'),
  ))
}
