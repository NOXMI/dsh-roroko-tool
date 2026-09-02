/**
 * roroko-mark 引擎冒烟测试(结构断言,随机生成测属性不测全文)。
 * 直接 import host 编译产物 lib/expander.js,保证测的是真实发布代码。
 * 运行:node test/expander-smoke.mjs
 */
import { expandMarkers } from '../lib/expander.js'

let failed = 0
const assert = (cond, msg) => {
  if (!cond) { failed++; console.error(`FAIL: ${msg}`) } else { console.log(`PASS: ${msg}`) }
}

const LEVELS = ['弱', '普通', '强', '极端', '余韵', '浪叫', '哀求', '愉悦', '羞耻', '抗拒', '失神', '口交']
const LINE_CHECK = {
  弱: ['亲爱的', '用力', '好舒服', '好棒', '轻一点', '慢一点', '嗯', '那里', '还要'],
  普通: ['好棒', '不行了', '受不了', '要坏掉了', '嗯', '那里', '还要', '好深', '轻点'],
  强: ['肏死我了', '要去了', '不行了', '别停', '好深', '顶到了', '快一点', '再深一点'],
  极端: ['去了去了', '要死了', '肏死我', '不行了不行了', '停不下来', '都给你', '去了', '好爽'],
  余韵: ['还在射', '停不下来', '又去了', '都给你', '不行了', '好多', '好满', '满了', '一直', '不要停'],
  浪叫: ['再用力一点嘛', '人家最喜欢你这样', '还要还要', '快进来嘛', '人家的屄好痒', '肏我嘛', '再深一点嘛', '别停嘛', '好喜欢你肏我', '给我嘛'],
  哀求: ['求你', '不要停', '给我', '还要', '求你了', '轻一点', '不要', '让我', '受不了', '别走', '再深一点', '求你慢一点'],
  愉悦: ['好舒服', '好喜欢', '好棒', '还要', '嗯好舒服', '真舒服', '好满足', '喜欢这样'],
  羞耻: ['不要看', '好羞', '别这样', '轻一点', '不要看那里', '好丢脸', '别盯着看', '捂着脸'],
  抗拒: ['不要', '放开我', '停下', '不行', '不要碰', '放开', '住手', '不要了'],
  失神: ['脑子空了', '不知道了', '好晕', '要被肏坏了', '什么都不知道了', '身体不停使唤', '好奇怪', '快要坏掉了'],
  口交: ['好大', '含不住', '呜…呜', '深一点', '这样吗', '唔唔…', '咽不下了', '太多了', '好深', '慢一点'],
}
const MAX = { 弱: 40, 普通: 45, 强: 60, 极端: 60, 余韵: 60, 浪叫: 60, 哀求: 60, 愉悦: 45, 羞耻: 45, 抗拒: 45, 失神: 60, 口交: 45 }

for (const lv of LEVELS) {
  for (let i = 0; i < 50; i++) {
    const r = expandMarkers(`-呻吟_${lv}-`)
    assert(!r.includes('-'), `[${lv}]#${i} 无残留标记`)
    assert(r.length <= MAX[lv] && r.length >= 3, `[${lv}]#${i} 长度∈[3,${MAX[lv]}]`)
    assert(LINE_CHECK[lv].some(w => r.includes(w)), `[${lv}]#${i} 台词命中`)
  }
}

// 确定性禁项 / 特性
for (let i = 0; i < 50; i++) {
  const weak = expandMarkers('-呻吟_弱-')
  assert(!weak.includes('咿') && !weak.includes('噢'), `弱#${i} 禁咿禁噢`)
  assert(!weak.includes('!') && !weak.includes('！'), `弱#${i} 禁!`)
  assert(!expandMarkers('-呻吟_口交-').includes('咿'), `口交#${i} 禁咿`)
  assert(/(吸溜|咕啾|啵唧|嘶溜|啧啧)/.test(expandMarkers('-呻吟_口交-')), `口交#${i} 含口部拟声`)
  const yy = expandMarkers('-呻吟_余韵-')
  assert(yy.includes('咿'), `余韵#${i} 含咿`)
  assert(!yy.includes('!') && !yy.includes('！'), `余韵#${i} 禁!`)
}

// 句子内联 / 代码块 / 幂等 / 未知标记 / 不误伤
assert(expandMarkers('妈妈嘴都-呻吟_普通-装不下了') !== '妈妈嘴都-呻吟_普通-装不下了', '句子内联展开')
assert(!expandMarkers('妈妈嘴都-呻吟_普通-装不下了').includes('-呻吟_普通-'), '内联后无残留')
assert(expandMarkers('```\n-呻吟_弱-\n```').includes('-呻吟_弱-'), '代码块内不展开')
const once = expandMarkers('-呻吟_普通-')
assert(expandMarkers(once) === once, '展开结果幂等')
assert(expandMarkers('x-不存在_标记-y') === 'x-不存在_标记-y', '未知标记保留原文')
assert(expandMarkers('2026-08-22 更新') === '2026-08-22 更新', '日期不误伤')
assert(expandMarkers('state-of-the-art 架构') === 'state-of-the-art 架构', '英文连字符不误伤')

console.log(failed === 0 ? '\n✅ 引擎冒烟全通过' : `\n❌ ${failed} 个失败`)
process.exit(failed === 0 ? 0 : 1)
