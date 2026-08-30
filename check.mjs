/**
 * 汇报生成器插件自检:宿主同款 new Function('ctx', src) 求值 main.js + DOM 垫片 + 冻钟 + 内存 vault。
 * 覆盖(SPEC「check.mjs 额外必测」全 11 节 + BRIEF 通用八条):
 *   ① 活动日志行文法(8 条逐字真日志行 + 未闭合引号 / 空值键 / 无法解析 / 空行 / CRLF / 白名单三分流)
 *   ② 时间与周(冻钟 + UTC/上海/伦敦/纽约 四时区扫描;ISO 周号 10 向量、weekStart 往返、DST 三周正午锚定)
 *   ③ mergeItems(勾选态保留 / manual 一条不丢 / 过期条移除 / id 跨重扫稳定 / 键序无关)
 *   ④ diffReports(三桶 / 块标记与素材出处段排除 / 空输入 / bullet 符号无关)
 *   ⑤ normalizeReport + fnv1a 覆盖防线   ⑥ 指令段全英文纪律 + 片段封顶
 *   ⑦ parseAgentOutput(围栏 / 嵌套围栏 / 无围栏回退)   ⑧ XSS 渲染
 *   ⑨ 数据契约往返(picked/note/manual/未知顶层键 + 损坏 sidecar 先备份后重建 + 报告路径)
 *   ⑩ 归档路径自枚举(不多探 / 自愈 / 全空)   ⑪ 门禁(贡献点 / disposer / 源码级 / mount 零联网 / 双语 / 就地重渲 / 旧宿主)
 * 跑法:node check.mjs
 */
process.env.TZ = 'Asia/Shanghai'
import { readFileSync } from 'node:fs'
import { strict as A } from 'node:assert'

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ══ ⑪-a 源码级纪律 ═══════════════════════════════════════════════════════════
A.ok(!/innerHTML/.test(src), 'main.js 禁 innerHTML(垫片可直测 + XSS 面归零)')
A.ok(!/querySelector/.test(src), 'main.js 禁 querySelector(全部直引用)')
A.ok(!/setInterval/.test(src), '轮询用 setTimeout 自排程,禁 setInterval')
A.ok(!/new Date\(\)/.test(src), '「现在」一律 Date.now(),禁裸 new Date()')
A.ok(!/color:\s*#fff/i.test(src), '强调色上的字一律 var(--on-accent),CSS 不许写死白字')
A.ok(!/console\.error/.test(src), '禁 console.error(真机台架有「无 console.error」断言)')
// SPEC 点名的禁引来源(候选原文那条链接已死):一个字都不许出现在产物里。
// needle 拆写,免得本文件自己成为「出现过」的那一处。
const BANNED_SOURCE = ['cai', 'bao', 'wang'].join('')
A.ok(!new RegExp(BANNED_SOURCE, 'i').test(src), 'SPEC 禁引的来源不许出现在 main.js')
for (const f of ['README.md', 'CHANGELOG.md', 'manifest.json', 'skills/worklog-report/SKILL.md']) {
  const txt = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
  A.ok(!new RegExp(BANNED_SOURCE, 'i').test(txt), `SPEC 禁引的来源不许出现在 ${f}`)
}
{
  const lines = src.split('\n')
  const asi = [...lines.keys()].filter((i) => {
    if (!/^\s*[([]/.test(lines[i])) return false
    let p = i - 1
    while (p >= 0 && !lines[p].trim()) p--
    return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
  }).map((i) => i + 1)
  A.equal(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)
}

// ══ 冻钟:2026-08-14 12:00 上海(= 04:00Z)→ 本周 = 2026-W33 ═════════════════
const NOW = Date.parse('2026-08-14T04:00:00.000Z')
Date.now = () => NOW

// ══ DOM 垫片 ════════════════════════════════════════════════════════════════
function mkText(t) {
  const n = { tag: '#text', children: [], attrs: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }
  let v = String(t)
  Object.defineProperty(n, 'textContent', { get: () => v, set: (x) => { v = String(x) } })
  return n
}
function mkEl(tag) {
  const el = {
    tag, children: [], attrs: {}, listeners: {}, parentElement: null, isConnected: true,
    className: '', disabled: false, value: '', checked: false, type: '',
    style: { setProperty() {}, removeProperty() {} },
    focus() {}, blur() {},
    setAttribute(k, v) { el.attrs[k] = String(v) },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null },
    addEventListener(t, f) { const a = el.listeners[t] || (el.listeners[t] = []); a.push(f) },
    removeEventListener() {},
    remove() { const p = el.parentElement; if (p) p.children = p.children.filter((x) => x !== el); el.parentElement = null },
  }
  el.classList = {
    add: (...cs) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); el.className = [...s].join(' ') },
    remove: (...cs) => { el.className = el.className.split(/\s+/).filter((c) => c && !cs.includes(c)).join(' ') },
    contains: (c) => el.className.split(/\s+/).includes(c),
  }
  let own = ''
  el.appendChild = (c) => {
    if (c && c.tag === '#frag') { for (const k of c.children.slice()) el.appendChild(k); return c }
    el.children.push(c)
    if (c && typeof c === 'object') c.parentElement = el
    return c
  }
  Object.defineProperty(el, 'textContent', {
    get: () => own + el.children.map((c) => (c && c.textContent) || '').join(''),
    set: (v) => { el.children.length = 0; own = String(v) },
  })
  return el
}
globalThis.document = {
  createElement: mkEl, createTextNode: mkText, createDocumentFragment: () => mkEl('#frag'),
  addEventListener() {}, body: mkEl('body'),
}
const findAll = (node, pred) => {
  const out = []
  const walk = (n) => { for (const c of (n.children || [])) { if (pred(c)) out.push(c); walk(c) } }
  walk(node)
  return out
}
const byTag = (node, tag) => findAll(node, (c) => c.tag === tag)
const anyAttr = (node, key) => findAll(node, (c) => c.attrs && key in c.attrs).length > 0

// ══ localStorage 垫片 ═══════════════════════════════════════════════════════
const _ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
}
const clearPluginLS = () => { for (const k of [..._ls.keys()]) { if (k.indexOf('plugin.worklog-reporter.') === 0) _ls.delete(k) } }

// ══ 插件实例工厂(内存 vault + 可观测的读写轨迹)══════════════════════════
function freshInstance(opts) {
  const o = opts || {}
  const V = o.vault || new Map()
  const reads = []
  const writes = []
  const reg = { views: [], commands: [], slash: [], settings: [], status: [], series: [], tracks: [], activity: [], notes: [], opened: [], loaded: [] }
  const inst = { V, reads, writes, reg, locale: o.locale || 'zh', localeCbs: [], promptReply: o.promptReply == null ? null : o.promptReply }
  const app = {
    notify: (m) => reg.notes.push([m, null]),
    openFile: (p) => reg.opened.push(p),
    loadPage: (p) => reg.loaded.push(p),
    readFile: async (p) => { reads.push(p); return V.has(p) ? V.get(p) : null },
    writeFile: async (p, t) => { V.set(p, String(t)); writes.push(p) },
    prompt: async () => inst.promptReply,
  }
  if (!o.oldHost) app.workFolder = () => (o.workFolder || '工作/汇报')
  const ctx = {
    app,
    registerView: (v) => reg.views.push(v),
    registerCommand: (c) => reg.commands.push(c),
    registerSlashItem: (s) => reg.slash.push(s),
    registerSetting: (s) => reg.settings.push(s),
    openView: (v) => reg.opened.push(`view:${v}`),
  }
  if (!o.oldHost) {
    ctx.registerStatusItem = (s) => { reg.status.push(s); return { update: (patch) => reg.status.push(['update', patch]), dispose() {} } }
    ctx.notify = (m, opt) => reg.notes.push([m, opt])
    ctx.activity = { log: (e, d) => reg.activity.push([e, d]) }
    ctx.achievements = { registerSeries: (s) => reg.series.push(s), track: (e, n) => reg.tracks.push([e, n]) }
    ctx.getLocale = () => inst.locale
    ctx.subscribeLocale = (cb) => { inst.localeCbs.push(cb); return () => { inst.localeCbs = inst.localeCbs.filter((f) => f !== cb) } }
  }
  globalThis.__WORKLOG_TEST__ = {}
  inst.dispose = new Function('ctx', src)(ctx)
  inst.T = globalThis.__WORKLOG_TEST__
  inst.ctx = ctx
  inst.setLocale = (l) => { inst.locale = l; for (const cb of inst.localeCbs.slice()) cb(l) }
  return inst
}

clearPluginLS()
const main = freshInstance({})
const T = main.T
const V = main.V
const reg = main.reg

// ══ ⑪-b 贡献点齐全 ═════════════════════════════════════════════════════════
A.equal(typeof main.dispose, 'function', 'setup 应返回 disposer')
A.equal(reg.views.length, 3, '应注册 3 个视图')
A.equal(reg.views[0].id, 'compose', 'compose 必须第一个注册(真机台架不传 --view 时打开 views[0])')
A.deepEqual(reg.views.map((v) => v.id), ['compose', 'sources', 'archive'], '视图注册顺序即 SPEC 的表')
for (const v of reg.views) {
  A.equal(typeof v.mount, 'function', `${v.id} 应有 mount`)
  A.notEqual(v.singleton, false, `${v.id} 的 singleton 取默认 true`)
}
for (const id of ['worklog-reporter-open', 'worklog-reporter-generate']) {
  A.ok(reg.commands.find((c) => c.id === id && typeof c.run === 'function'), `应注册 ${id} 命令`)
}
A.equal(reg.commands.length, 2, '只注册 SPEC 点名的两个命令(不许双注册别名)')
A.ok(reg.slash.find((s) => s.id === 'worklog-reporter-week' && typeof s.run === 'function'), '应注册斜杠项 worklog-reporter-week')
A.deepEqual(reg.settings.map((s) => s.key).sort(), ['includeSources', 'maxExcerptChars', 'template'], '应声明三个设置')
{
  const mx = reg.settings.find((s) => s.key === 'maxExcerptChars')
  A.equal(mx.type, 'number'); A.equal(mx.default, 1200); A.equal(mx.min, 0); A.equal(mx.max, 4000)
  const inc = reg.settings.find((s) => s.key === 'includeSources')
  A.equal(inc.type, 'boolean'); A.equal(inc.default, true)
}
A.equal(reg.status.length, 1, '应注册 1 个状态栏项')
A.equal(reg.status[0].id, 'status')
{
  const s = reg.series.find((x) => x.id === 'worklog')
  A.ok(s, '应注册成就系列 worklog')
  A.deepEqual(s.achievements.map((a) => a.id), ['first', 'ten', 'grounded'])
  A.deepEqual(s.achievements.map((a) => a.event), ['report', 'report', 'manual'])
  A.deepEqual(s.achievements.map((a) => a.goal), [1, 10, 20])
  A.ok(s.achievements.every((a) => typeof a.points === 'number'), '每条成就必须有 points(types.ts 要求)')
}
// 批次 verify-all.mjs 用**静态正则**从 main.js 抓 registerView 的 id,再据此校验内嵌 Space 的
// requires.views。写成工厂调用(registerView(makeView(...)))它抓不到 → Space 被判引用未注册视图。
// 这条把「视图必须写字面量对象」钉成契约,免得重构时静默失守。
{
  const scraped = [...src.matchAll(/registerView(?:\?\.)?\s*\(\s*\{[^}]*?id\s*:\s*['"]([\w-]+)['"]/gs)].map((m) => m[1])
  A.deepEqual(scraped, ['compose', 'sources', 'archive'], '批次静态扫描器必须抓得到三个视图 id(registerView 一律写字面量对象)')
  const space = JSON.parse(readFileSync(new URL('./spaces/worklog-desk/space.json', import.meta.url), 'utf8'))
  const layout = [...(space.layout.left || []), ...(space.layout.main || []), ...(space.layout.right || [])].map((x) => x.type)
  for (const type of layout.filter((x) => x.indexOf('plugin:') === 0)) {
    A.ok(space.requires.views.includes(type), `Space 布局引用的 ${type} 必须进 requires.views`)
    A.ok(scraped.includes(type.split(':')[2]), `Space 引用的 ${type} 必须是 main.js 真注册的视图`)
  }
  A.equal(space.requires.views.length, 3, '三个插件视图全部进 requires.views')
}
for (const k of ['parseActivityLine', 'parseActivityLog', 'mergeItems', 'isoWeekOf', 'weekStart', 'weekDays', 'prevWeekOf',
  'weekSeq', 'tsToMs', 'fnv1a', 'normalizeReport', 'diffReports', 'buildScanMessage', 'buildComposeMessage',
  'parseAgentOutput', 'renderMarkdown', 'safeHref', 'capExcerpts', 'listArchive', 'saveReport']) {
  A.equal(typeof T[k], 'function', `钩子应暴露 ${k}`)
}

// ══ ⑪-c 双语词表两侧键集合相等 ═════════════════════════════════════════════
{
  const zh = Object.keys(T.MSG.zh).sort()
  const en = Object.keys(T.MSG.en).sort()
  A.deepEqual(zh, en, '双语词表两侧键集合必须完全相等')
  A.ok(zh.length > 40, '词表覆盖面太小?')
  for (const k of zh) {
    A.ok(String(T.MSG.en[k]).trim(), `en.${k} 不许空`)
    A.ok(!/[一-鿿]/.test(String(T.MSG.en[k])), `en.${k} 不许残留中文:${T.MSG.en[k]}`)
  }
  for (const tp of T.TEMPLATES) {
    A.ok(tp.zh && tp.en, `模板 ${tp.id} 两侧齐全`)
    A.equal(tp.zh.sections.length, tp.en.sections.length, `模板 ${tp.id} 小节数一一对应`)
  }
  A.deepEqual(T.TEMPLATES.map((x) => x.id), ['generic3', 'rag'], '首版只做两个模板,id 永不改')
}

// ══ ① 活动日志解析:8 条逐字真日志行 ═══════════════════════════════════════
{
  const L1 = T.parseActivityLine('202608130219 chat.new s=c0e491 "你现在是不是可以自我进化了？"')
  A.equal(L1.ts, '202608130219'); A.equal(L1.event, 'chat.new'); A.equal(L1.kv.s, 'c0e491')
  A.ok(L1.text.includes('自我进化'), '尾部自由文本入 text')
  A.equal(L1.truncated, false)
  const L2 = T.parseActivityLine('202607181756 chat.send s=a9d518 "hi？"')
  A.equal(L2.event, 'chat.send'); A.equal(L2.kv.s, 'a9d518'); A.ok(L2.text.includes('hi'))
  const L3 = T.parseActivityLine('202608130219 run.done agent=xyra s=c0e491 status=done')
  A.equal(L3.kv.agent, 'xyra'); A.equal(L3.kv.s, 'c0e491'); A.equal(L3.kv.status, 'done'); A.equal(L3.text, '')
  const L4 = T.parseActivityLine('202607221621 agent.edit tool=write_file agent=xyra f=Project/deutschland-reiseglueck/src/index.ts')
  A.equal(L4.kv.tool, 'write_file'); A.equal(L4.kv.f, 'Project/deutschland-reiseglueck/src/index.ts')
  const L5 = T.parseActivityLine('202607170356 note.edit f="Forsion is All You Need.md" l=6-29')
  A.equal(L5.kv.f, 'Forsion is All You Need.md', '引号值含空格')
  A.equal(L5.kv.l, '6-29', '带连字符的裸值不被拆')
  const L6 = T.parseActivityLine('202607181756 note.create f=untitled.md')
  A.equal(L6.kv.f, 'untitled.md')
  const L7 = T.parseActivityLine('202607170354 file.save f="export (1).png"')
  A.equal(L7.kv.f, 'export (1).png')
  const L8 = T.parseActivityLine('202607170354 view.open f="Forsion is All You Need.md"')
  A.equal(L8.kv.f, 'Forsion is All You Need.md')
  // 截断出未闭合引号:取到行尾、truncated、**不返回 null**
  const cut = T.parseActivityLine('202608130219 chat.new s=abc "很长的文本在这里被截')
  A.ok(cut, '未闭合引号不许返回 null')
  A.equal(cut.truncated, true)
  A.ok(cut.text.includes('很长的文本在这里被截'), '未闭合引号取到行尾')
  A.equal(cut.kv.s, 'abc')
  // 尾巴是 k=(值被截没了)→ 丢该键,行其余部分照常
  const empty = T.parseActivityLine('202608130219 chat.new s=abc f=')
  A.equal(empty.kv.s, 'abc'); A.equal(empty.kv.f, undefined)
  A.equal(T.parseActivityLine('hello world'), null, '不匹配 TS+event 的行 → null')
  A.equal(T.parseActivityLine(''), null)
  A.equal(T.parseActivityLine('   '), null)
}
// 整批:解析失败 ≠ 缺席
{
  const batch = ['hello world', '202607181756 note.create f=untitled.md', '', '   '].join('\n')
  const r = T.parseActivityLog(batch)
  A.equal(r.stats.unparsed, 1, '一行无法解析')
  A.equal(r.items.length, 1, '同批其余行照常返回')
  A.equal(r.stats.total, 2, '空行 / 纯空白行不计入 total')
  A.deepEqual(T.parseActivityLog(''), { items: [], stats: { total: 0, kept: 0, droppedPlugin: 0, droppedOther: 0, unparsed: 0 } })
  A.deepEqual(T.parseActivityLog('\n\n'), { items: [], stats: { total: 0, kept: 0, droppedPlugin: 0, droppedOther: 0, unparsed: 0 } })
}
// 白名单三分流(插件心跳 / 白名单外 / 采纳),以及 total 恒等
const SAMPLE = [
  '202608130219 chat.new s=c0e491 "你现在是不是可以自我进化了？"',
  '202608130219 run.done agent=xyra s=c0e491 status=done',
  '202608131120 note.edit f="Notes/架构评审.md" l=6-29',
  '202608131121 note.create f=untitled.md',
  '202608131122 file.save f="export (1).png"',
  '202608131123 view.open f="Notes/架构评审.md"',
  '202608131124 agent.edit tool=write_file agent=xyra f=Project/x/src/index.ts',
  '202608131125 chat.send s=a9d518 "hi？"',
  '202607171433 plugin:eye-break:eye-break',
  '202607171434 plugin:stretch-break:stretch-break',
  '202608130216 app.start v=2.7.9',
  '202608130217 market.install id=foo',
  'garbage line here',
].join('\n')
{
  const r = T.parseActivityLog(SAMPLE)
  A.equal(r.stats.droppedPlugin, 2, 'plugin: 前缀事件被显式丢弃')
  A.equal(r.stats.droppedOther, 2, '白名单外事件计入 droppedOther')
  A.equal(r.stats.unparsed, 1)
  A.equal(r.stats.kept, 8, '八类白名单事件全部采纳')
  A.equal(r.stats.total, r.stats.kept + r.stats.droppedPlugin + r.stats.droppedOther + r.stats.unparsed, 'total 恒等')
  A.equal(T.parseActivityLog('202607171433 plugin:eye-break:eye-break').stats.droppedPlugin, 1)
  A.equal(T.parseActivityLog('202607171433 plugin:eye-break:eye-break').stats.kept, 0)
  A.equal(T.parseActivityLog('202608130216 app.start v=2.7.9').stats.droppedOther, 1)
  // CRLF 与 LF 结果全等
  const crlf = T.parseActivityLog(SAMPLE.split('\n').join('\r\n'))
  A.deepEqual(crlf.stats, r.stats, 'CRLF 混排统计与 LF 版全等')
  A.deepEqual(crlf.items.map((i) => i.id), r.items.map((i) => i.id), 'CRLF 混排条目与 LF 版全等')
  // f= 两种语义:vault 相对路径给回链,项目路径不给
  const ne = r.items.find((i) => i.event === 'note.edit')
  A.equal(ne.link, 'Notes/架构评审.md', 'note.edit 的 f= 是 vault 相对路径 → 可回链')
  A.equal(ne.kv.l, '6-29')
  const ae = r.items.find((i) => i.event === 'agent.edit')
  A.equal(ae.link, '', 'agent.edit 的 f= 是项目路径 → 不给回链')
  A.equal(ae.kv.f, 'Project/x/src/index.ts', '项目路径仍作为纯文本保留')
  // 默认勾选策略
  A.equal(r.items.find((i) => i.event === 'note.edit').picked, true)
  A.equal(r.items.find((i) => i.event === 'chat.new').picked, true)
  A.equal(r.items.find((i) => i.event === 'view.open').picked, false)
  A.equal(r.items.find((i) => i.event === 'chat.send').picked, false)
  A.equal(r.items.find((i) => i.event === 'run.done').picked, false)
  // 排序稳定 + id 跨重扫稳定
  const again = T.parseActivityLog(SAMPLE)
  A.deepEqual(again.items.map((i) => i.id), r.items.map((i) => i.id), '同一份日志解析两次 id 全等')
  for (let i = 1; i < r.items.length; i++) A.ok(r.items[i - 1].ms <= r.items[i].ms, '按 ms 升序')
  // 两处家目录合并读回的重复行按稳定 id 去重
  const dup = T.parseActivityLog(`${SAMPLE}\n202608131121 note.create f=untitled.md`)
  A.equal(dup.items.length, r.items.length, '重复行去重')
}
// 键序无关:canonicalRest 按键字典序 → 同一 id
{
  const a = T.parseActivityLog('202608131120 note.edit f=a.md l=1').items[0]
  const b = T.parseActivityLog('202608131120 note.edit l=1 f=a.md').items[0]
  A.equal(a.id, b.id, '键序不同不许产生不同 id')
}

// ══ ② 时间与周:四时区扫描 ═════════════════════════════════════════════════
const ISO_VECTORS = [
  ['2019-12-30', '2020-W01'], ['2021-01-03', '2020-W53'], ['2021-01-04', '2021-W01'],
  ['2018-12-31', '2019-W01'], ['2026-01-01', '2026-W01'], ['2025-12-29', '2026-W01'],
  ['2026-08-14', '2026-W33'], ['2026-12-28', '2026-W53'], ['2027-01-03', '2026-W53'],
  ['2016-01-03', '2015-W53'],
]
const WEEKSTART_VECTORS = [
  ['2026-W33', '2026-08-10'], ['2026-W01', '2025-12-29'], ['2020-W53', '2020-12-28'],
  ['2026-W53', '2026-12-28'], ['2027-W01', '2027-01-04'],
]
for (const tz of ['UTC', 'Asia/Shanghai', 'Europe/London', 'America/New_York']) {
  process.env.TZ = tz
  A.equal(new Date(T.tsToMs('202608131120')).getHours(), 11, `${tz}:TS→ms 必须按本地时间构造(用 Date.UTC 实现的话这条即红)`)
  A.equal(T.tsToMs('bad'), 0, `${tz}:非法 TS 给 0`)
  for (const [day, week] of ISO_VECTORS) A.equal(T.isoWeekOf(day), week, `${tz}:isoWeekOf(${day})`)
  for (const [week, mon] of WEEKSTART_VECTORS) {
    A.equal(T.weekStart(week), mon, `${tz}:weekStart(${week})`)
    A.equal(T.isoWeekOf(T.weekStart(week)), week, `${tz}:weekStart 往返 ${week}`)
  }
  // DST 换日周:正午锚定 → 正好 7 天、无重复日、无跳日
  for (const w of ['2026-W10', '2026-W44', '2026-W13', '2026-W33']) {
    const days = T.weekDays(w)
    A.equal(days.length, 7, `${tz}:${w} 必须正好 7 天`)
    A.equal(new Set(days).size, 7, `${tz}:${w} 无重复日`)
    A.equal(days[0], T.weekStart(w), `${tz}:${w} 首日 = 周一`)
    for (let i = 1; i < 7; i++) {
      const a = Date.UTC(...days[i - 1].split('-').map((x, k) => (k === 1 ? Number(x) - 1 : Number(x))))
      const b = Date.UTC(...days[i].split('-').map((x, k) => (k === 1 ? Number(x) - 1 : Number(x))))
      A.equal(b - a, 86400000, `${tz}:${w} 第 ${i} 天跳日了(凌晨起算的经典 DST 崩法)`)
    }
    A.equal(T.isoWeekOf(days[6]), w, `${tz}:${w} 末日仍属本周`)
  }
  A.equal(T.prevWeekOf('2026-W01'), '2025-W52', `${tz}:prevWeekOf 跨年`)
  A.equal(T.prevWeekOf('2027-W01'), '2026-W53', `${tz}:prevWeekOf 跨 53 周年`)
  A.equal(T.prevWeekOf('2026-W33'), '2026-W32', `${tz}:prevWeekOf`)
  A.deepEqual(T.weekSeq('2025-W51', '2026-W02'), ['2025-W51', '2025-W52', '2026-W01', '2026-W02'], `${tz}:weekSeq 跨年`)
  A.deepEqual(T.weekSeq('2026-W33', '2026-W32'), [], `${tz}:from > to 给空`)
  A.deepEqual(T.weekSeq('bad', '2026-W02'), [], `${tz}:非法输入给空`)
  const long = T.weekSeq('2000-W01', '2026-W33')
  A.equal(long.length, 260, `${tz}:超 260 周被 guard 截断(且没死循环)`)
  // 【P3-9a 回归】截断只许截**老的那头**:正着推的话 firstWeek 超过 5 年时当前周会掉出列表,
  // 归档面板就看不见刚写的那份周报。
  A.equal(long[long.length - 1], '2026-W33', `${tz}:260 周 guard 之后,末项仍必须是 to(当前周)`)
  const long2 = T.weekSeq('2018-W01', '2026-W33')
  A.equal(long2[long2.length - 1], '2026-W33', `${tz}:8 年跨度同样保当前周`)
  A.equal(T.currentWeek(), '2026-W33', `${tz}:冻钟本周 = 2026-W33`)
}
process.env.TZ = 'Asia/Shanghai'

// ══ ③ mergeItems ═══════════════════════════════════════════════════════════
{
  const fresh = T.parseActivityLog(SAMPLE).items
  const old = fresh.map((it) => ({ ...it, picked: false, note: 'n1' }))
  old.push({ id: 'm-1-abc', ts: 0, ms: NOW - 86400000, event: 'manual', kv: {}, text: '和 X 对齐了 Q3 目标', src: 'manual', link: '', picked: true, note: '' })
  old.push({ id: '202601010000-note.edit-deadbeef', ts: 202601010000, ms: 1, event: 'note.edit', kv: {}, text: '', src: 'log', link: '', picked: true, note: '' })
  const merged = T.mergeItems(old, fresh)
  A.ok(merged.every((it) => it.src !== 'log' || it.picked === false), '同 id 的 log 条目沿用旧 picked=false')
  A.ok(merged.every((it) => it.src !== 'log' || it.note === 'n1'), '同 id 的 log 条目沿用旧 note')
  A.ok(merged.find((it) => it.id === 'm-1-abc'), 'manual 一条不丢')
  A.ok(!merged.find((it) => it.id === '202601010000-note.edit-deadbeef'), 'fresh 里没有的 log 条目被移除')
  A.equal(merged.length, fresh.length + 1)
  for (let i = 1; i < merged.length; i++) {
    A.ok(merged[i - 1].ms < merged[i].ms || (merged[i - 1].ms === merged[i].ms && merged[i - 1].id <= merged[i].id), '按 ms 升序、同 ms 按 id 字典序')
  }
  const again = T.mergeItems(merged, fresh)
  A.deepEqual(again.map((x) => x.id), merged.map((x) => x.id), '再合流一次结果稳定')
  // 新出现的 log 条目取默认勾选
  const only = T.mergeItems([], fresh)
  A.equal(only.find((i) => i.event === 'note.edit').picked, true)
  A.equal(only.find((i) => i.event === 'view.open').picked, false)
  A.deepEqual(T.mergeItems(null, null), [], '空输入不抛')
}

// ══ ④ diffReports ══════════════════════════════════════════════════════════
{
  // 出处段照 composeReportFile 的真实形状写(锚点前必有一条 `---`)—— 只有这种形状才是插件写的那段。
  const prev = '## 本周完成\n\n- 做了 A\n- 做了 B\n\n---\n\n## 素材出处\n\n- 202608 note.edit x\n'
  const cur = '## 本周完成\n\n* 做了 B\n- 做了 C\n\n---\n\n## 素材出处\n\n- 别的出处\n'
  const d = T.diffReports(prev, cur)
  A.deepEqual(d.added, ['做了 C'])
  A.deepEqual(d.gone, ['做了 A'])
  A.deepEqual(d.kept, ['做了 B'], '仅 bullet 符号不同判为同一条')
  const marked = cur.split('\n').map((l, i) => (i === 2 ? `<!-- a ${i} -->\n${l}` : l)).join('\n')
  A.deepEqual(T.diffReports(prev, marked), d, '块标记行不改变 diff 结果')
  A.deepEqual(T.diffReports('', cur).gone, [], 'prev 为空:gone 空')
  A.deepEqual(T.diffReports('', cur).added, ['做了 B', '做了 C'], 'prev 为空:全部进 added')
  const same = T.diffReports(cur, cur)
  A.deepEqual(same.added, []); A.deepEqual(same.gone, [])
  A.deepEqual(same.kept, ['做了 B', '做了 C'], 'prev === cur:全部 kept')
  A.deepEqual(T.diffReports('', ''), { added: [], gone: [], kept: [] }, '两份都空不抛')
  A.deepEqual(T.diffReports(null, undefined), { added: [], gone: [], kept: [] })
  // 素材出处段里的条目不进 diff
  A.ok(!d.added.includes('别的出处') && !d.kept.includes('别的出处'), '素材出处段被排除在 diff 之外')
}

// ══ ⑤ normalizeReport / fnv1a / 覆盖防线 ══════════════════════════════════
{
  const base = '## 本周完成\n\n- 做了 A\n- 做了 B\n'
  const opened = '## 本周完成\n\n<!-- a 1 -->\n- 做了 A\n<!-- a 2 -->\n- 做了 B\n'
  A.equal(T.fnv1a(T.normalizeReport(base)), T.fnv1a(T.normalizeReport(opened)), '加了块标记行 = 用户只是在 Amadeus 里打开过,hash 不变')
  const messy = '## 本周完成   \r\n\r\n\r\n- 做了 A  \r\n- 做了 B\r\n\r\n\r\n'
  A.equal(T.fnv1a(T.normalizeReport(base)), T.fnv1a(T.normalizeReport(messy)), '行尾空格 / CRLF / 连续空行折叠后 hash 相同')
  const withSrc = `${base}\n---\n\n## 素材出处\n\n- 出处一条\n`
  A.equal(T.fnv1a(T.normalizeReport(base)), T.fnv1a(T.normalizeReport(withSrc)), '插件写的素材出处段(锚点紧邻 ---)被截断,不进 hash')
  A.equal(T.fnv1a(T.normalizeReport(base)), T.fnv1a(T.normalizeReport(`${base}\n---\n\n## Sources\n\n- x\n`)), '英文锚点 ## Sources 同样截断')
  A.notEqual(T.fnv1a(T.normalizeReport(base)), T.fnv1a(T.normalizeReport(base.replace('做了 A', '做了 Z'))), '正文真改一个字 → hash 不同')
  A.equal(T.fnv1a(''), '811c9dc5', 'fnv1a 空串 = FNV offset basis(定值,不是自比恒真)')
  A.equal(T.fnv1a('abc'), '1a47e90b', 'fnv1a 已知向量')
  A.equal(T.fnv1a('abc').length, 8, 'fnv1a 给 8 位十六进制')
  // 【P2-7 回归】正文里**恰好**出现一行 `## 素材出处`(用户手写 / 模型多给一个)不是插件写的出处段:
  // 见锚点就截 = 其后正文在下次打开草稿时被静默吃掉,再存一次就永久没了。判据 = 锚点前有没有 `---`。
  const userAnchor = '## 本周完成\n\n- 做了 A\n\n## 素材出处\n\n- 我自己写的一行\n\n## 下周计划\n\n- 做了 B\n'
  const nz = T.normalizeReport(userAnchor)
  A.ok(nz.includes('我自己写的一行'), '正文里裸写的 ## 素材出处 不许触发截断(其后内容必须留着)')
  A.ok(nz.includes('## 下周计划') && nz.includes('做了 B'), '裸锚点之后的整段小节都必须活下来')
  A.ok(T.normalizeReport('## 本周完成\n\n- a\n\n## Sources\n\n- mine\n').includes('mine'), '英文裸锚点同样不截断')
  // 两个锚点并存(用户写了一个 + 插件又追加了一个)→ 只截**插件那个**(最后一个合格锚点)
  const both = `${userAnchor}\n---\n\n## 素材出处\n\n- 插件写的出处\n`
  const nb = T.normalizeReport(both)
  A.ok(nb.includes('我自己写的一行') && nb.includes('做了 B'), '两个锚点并存时用户那段完整保留')
  A.ok(nb.indexOf('插件写的出处') < 0, '两个锚点并存时插件那段仍被截掉')
  A.equal(T.fnv1a(T.normalizeReport(userAnchor)), T.fnv1a(nb), '追加插件出处段不改变 hash(覆盖防线不误报)')
  // 块标记落在 --- 与锚点之间(Amadeus 打开过报告)仍要认得出插件的出处段
  const marked = `${base}\n---\n\n<!-- a 7 -->\n## 素材出处\n\n- 出处一条\n`
  A.equal(T.fnv1a(T.normalizeReport(base)), T.fnv1a(T.normalizeReport(marked)), '--- 与锚点之间夹了块标记行也照样截断')
}

// ══ ⑤-b 报告往返定点(「打开草稿 → 再保存」绝不许堆元信息 / 分隔线)═══════
// 回归:reportBodyForInsert 曾保留元信息引用行,normalizeReport 曾保留素材出处段前的 ---,
// 于是每开一次存一次就多一行「生成于」和一条 ---(三轮后 3 份,直接污染用户的报告文件)。
{
  const items = T.parseActivityLog('202608131120 note.edit f="Notes/a.md" l=6-29').items
  const t1 = Date.parse('2026-08-14T13:30:00Z')
  const t2 = Date.parse('2026-08-15T13:30:00Z')
  const t3 = Date.parse('2026-08-16T13:30:00Z')
  const f1 = T.composeReportFile('2026-W33', '## 本周完成\n\n- 干了活', items, 'generic3', t1)
  const d1 = T.reportBodyForInsert(f1)
  A.ok(d1.startsWith('## 本周完成'), '读回的草稿必须从小节标题开始(H1 与元信息行都剥掉)')
  A.ok(d1.indexOf('生成于') < 0, '读回的草稿不许带旧的元信息行')
  A.ok(!/^---$/m.test(d1), '读回的草稿不许带素材出处段前的分隔线')
  const f2 = T.composeReportFile('2026-W33', d1, items, 'generic3', t2)
  const d2 = T.reportBodyForInsert(f2)
  A.equal(d2, d1, '往返定点:开→存→开 的结果必须与第一次全等')
  const f3 = T.composeReportFile('2026-W33', d2, items, 'generic3', t3)
  A.equal((f3.match(/^> /gm) || []).length, 1, '三轮之后仍只有一行元信息')
  A.equal((f3.match(/^---$/gm) || []).length, 1, '三轮之后仍只有一条分隔线')
  A.equal((f3.match(/^# /gm) || []).length, 1, '三轮之后仍只有一个 H1')
  A.equal((f3.match(/## 素材出处/g) || []).length, 1, '三轮之后仍只有一个素材出处段')
  A.equal(T.reportBodyForInsert(f3), d1, '第三轮读回仍是同一份正文')
  // 关掉「素材出处」段时同样定点
  _ls.set('plugin.worklog-reporter.includeSources', 'false')
  const g1 = T.composeReportFile('2026-W33', '## 本周完成\n\n- 干了活', items, 'generic3', t1)
  A.ok(g1.indexOf('素材出处') < 0, 'includeSources=false 不写素材出处段')
  A.equal(T.reportBodyForInsert(T.composeReportFile('2026-W33', T.reportBodyForInsert(g1), items, 'generic3', t2)), T.reportBodyForInsert(g1), '无出处段时同样定点')
  _ls.delete('plugin.worklog-reporter.includeSources')
}

// ══ ⑥ 指令段(英文纪律)═══════════════════════════════════════════════════
{
  const days = T.weekDays('2026-W33')
  const msg = T.buildScanMessage(days)
  A.ok(!/[一-鿿]/.test(msg), 'buildScanMessage 不含任何 CJK 字符')
  A.ok(msg.includes('~/.forsion/activity/'), '含生产家目录')
  A.ok(msg.includes('~/.forsion-dev/activity/'), '含 dev 家目录')
  for (const d of days) A.ok(msg.includes(`${d}.log`), `7 个日期字面量全在:${d}`)
  A.ok(msg.includes('worklog-raw'), '含围栏标签')
  A.ok(msg.includes('verbatim'), '含逐字回抄纪律')
  A.ok(msg.includes('Use only run_bash.'), '含工具死限')
  A.ok(msg.includes('never write, move, delete, or modify any file'), '含只读死限句')
  A.ok(msg.includes('#TRUNCATED'), '含 4000 行上限约定')
}
{
  const items = T.parseActivityLog(SAMPLE).items
  const huge = 'x'.repeat(50000)
  const zh = T.buildComposeMessage(items, { 'Notes/架构评审.md': huge }, 'generic3', 'zh')
  const en = T.buildComposeMessage(items, { 'Notes/架构评审.md': huge }, 'generic3', 'en')
  A.ok(zh.includes('Respond in Chinese.'), 'zh 版给中文输出开关')
  A.ok(en.includes('Respond in English.'), 'en 版给英文输出开关')
  for (const m of [zh, en]) {
    A.ok(m.includes('one fenced block tagged worklog'), '围栏契约句')
    A.ok(m.includes('Every bullet must be grounded in the provided material.'), '反编造纪律')
    A.ok(m.includes('Never invent projects, metrics, dates, or names.'), '反编造纪律 2')
    A.ok(m.includes('You are drafting a weekly work report'), '角色与任务')
  }
  A.ok(zh.includes('"本周完成"'), 'zh 版给中文模板小节清单')
  A.ok(en.includes('"Done this week"'), 'en 版给英文模板小节清单')
  A.ok(zh.includes('x'.repeat(1200)), '单篇截断到 maxExcerptChars=1200')
  A.ok(!zh.includes('x'.repeat(1201)), '单篇绝不超过 maxExcerptChars')
  A.ok(zh.length < 20000, '整条消息不许被 5 万字笔记撑爆')
  // 全周合计 12000 封顶 + 按引用次数降序
  const many = {}
  const refs = {}
  for (let i = 0; i < 20; i++) { many[`n${i}.md`] = 'y'.repeat(1200); refs[`n${i}.md`] = i }
  const cap = T.capExcerpts(many, refs, 1200, 12000)
  A.equal(Object.keys(cap.excerpts).length, 10, '12000 / 1200 = 10 篇封顶')
  A.equal(cap.omitted.length, 10, '其余只列路径')
  A.equal(Object.keys(cap.excerpts)[0], 'n19.md', '按被勾选条目引用次数降序取前几篇')
  A.ok(cap.used <= 12000, '全周合计不超过 12000 字符')
  A.deepEqual(T.capExcerpts({}, {}, 1200, 12000), { excerpts: {}, omitted: [], used: 0 }, '空输入不抛')
}

// ══ ⑦ parseAgentOutput ═════════════════════════════════════════════════════
{
  const ok = T.parseAgentOutput('前面废话\n```worklog\n## 本周完成\n\n- 一条\n```\n后面废话')
  A.equal(ok.fallback, false)
  A.equal(ok.body, '## 本周完成\n\n- 一条')
  const nested = T.parseAgentOutput('```worklog\n## 本周完成\n\n```js\nconst x = 1\n```\n\n- 尾巴\n```')
  A.ok(nested.body.includes('const x = 1'), '内层代码块原样保留')
  A.ok(nested.body.includes('- 尾巴'), '贪婪到最后一个围栏,绝不静默丢半份草稿')
  const fb = T.parseAgentOutput('模型忘了围栏,直接给了正文\n## 本周完成\n- 一条')
  A.equal(fb.fallback, true, '无围栏 → 置 fallback')
  A.ok(fb.body.includes('本周完成'), '无围栏 → 回退为全文(非空)')
  A.equal(T.parseAgentOutput('').fallback, true)
  A.ok(T.extractRawFence('```worklog-raw\n202608131120 note.edit f=a.md\n#TRUNCATED 900\n```').indexOf('#TRUNCATED') < 0, '#TRUNCATED 行不当日志行')
  A.equal(T.extractRawFence('没有围栏'), '', '无围栏给空串(可信度闸据此判不可信)')
}

// ══ ⑧ 安全 / 渲染 ═════════════════════════════════════════════════════════
{
  const box = mkEl('div')
  T.renderMarkdown(box, '**hi** <img src=x onerror=alert(1)> `code`')
  A.ok(box.textContent.includes('hi'))
  A.ok(box.textContent.includes('<img') && box.textContent.includes('onerror'), '恶意 HTML 变字面文字')
  A.equal(byTag(box, 'img').length, 0, '绝不能创建 img 元素')
  A.equal(anyAttr(box, 'onerror'), false, '绝不能设 onerror 属性')
  const box2 = mkEl('div')
  T.renderMarkdown(box2, '# H\n\n- a\n- b\n\n[good](https://x.com) [bad](javascript:evil)')
  A.equal(byTag(box2, 'h1').length, 1)
  A.equal(byTag(byTag(box2, 'ul')[0], 'li').length, 2)
  const as = byTag(box2, 'a')
  A.equal(as[0].attrs.href, 'https://x.com', '安全链接设 href')
  A.equal(as[1].attrs.href, undefined, '危险协议不设 href')
  A.equal(T.safeHref('javascript:alert(1)'), '', 'javascript: 应被拒')
  A.equal(T.safeHref('https://x.com'), 'https://x.com')
  // 真日志里存在尾部文本为空的 chat.new / run.done:出处行不许只剩时间 + 事件名
  const bare = T.parseActivityLog('202608140205 chat.new s=6f21ab').items[0]
  A.ok(T.sourceLine(bare).includes('s=6f21ab'), '无标题无文件的行至少留下会话 id')
  // 日志尾部文本含 <script> / javascript: 走素材列表渲染后同样无注入
  const evil = T.parseActivityLog('202608131120 chat.new s=abc "<script>alert(1)</script> javascript:evil"').items
  const row = mkEl('div')
  T.renderMarkdown(row, T.sourceLine(evil[0]))
  A.equal(byTag(row, 'script').length, 0, '素材行不许造 script 元素')
  A.equal(anyAttr(row, 'onerror'), false)
  A.ok(row.textContent.includes('<script'), '恶意串以字面文字展示')
}

// ══ ⑨ 数据契约往返 ════════════════════════════════════════════════════════
const WEEK = '2026-W33'
const SC_PATH = `工作/汇报/.worklog/${WEEK}.json`
const RP_PATH = `工作/汇报/Reports/${WEEK}.md`
{
  const parsed = T.parseActivityLog(SAMPLE)
  await T.updateSidecar(WEEK, (sc) => {
    sc.items = T.mergeItems(sc.items, parsed.items)
    sc.stats = parsed.stats
    sc.scannedAt = NOW
    sc.x_future = { hello: 'world' } // 未知顶层键(前向兼容)
    return sc
  })
  A.ok(V.has(SC_PATH), `sidecar 落 ${SC_PATH}`)
  const j1 = JSON.parse(V.get(SC_PATH))
  A.equal(j1.v, 1); A.equal(j1.week, WEEK)
  A.equal(j1.range.from, '2026-08-10'); A.equal(j1.range.to, '2026-08-16')
  A.equal(j1.items.length, 8)
  A.deepEqual(j1.stats, parsed.stats)
  // 手工补录 + 勾选态 + 备注,再写一轮:全都不丢
  await T.updateSidecar(WEEK, (sc) => {
    sc.items = sc.items.map((it) => (it.event === 'view.open' ? { ...it, picked: true, note: '这条其实是评审' } : it))
    sc.items.push({ id: 'm-1-zzz', ts: 0, ms: NOW - 3600000, event: 'manual', kv: {}, text: '和 X 对齐了 Q3 目标', src: 'manual', link: '', picked: true, note: '' })
    return sc
  })
  const j2 = JSON.parse(V.get(SC_PATH))
  A.deepEqual(j2.x_future, { hello: 'world' }, '未知顶层键原样保留')
  A.ok(j2.items.find((i) => i.src === 'manual'), 'manual 条目落盘')
  A.ok(j2.items.find((i) => i.event === 'view.open').picked, 'picked 落盘')
  A.equal(j2.items.find((i) => i.event === 'view.open').note, '这条其实是评审', 'note 落盘')
  // 再重扫一遍:manual 与勾选态经 mergeItems 全部幸存
  await T.updateSidecar(WEEK, (sc) => {
    sc.items = T.mergeItems(sc.items, T.parseActivityLog(SAMPLE).items)
    return sc
  })
  const j3 = JSON.parse(V.get(SC_PATH))
  A.ok(j3.items.find((i) => i.src === 'manual'), '重扫后 manual 仍在')
  A.ok(j3.items.find((i) => i.event === 'view.open').picked, '重扫后勾选态仍在')
  A.deepEqual(j3.x_future, { hello: 'world' }, '重扫后未知顶层键仍在')
}
// 报告写盘路径 + 素材出处段
{
  const p = await T.saveReport(WEEK, '## 本周完成\n\n- 收敛了活动日志解析层', 'generic3')
  A.equal(p.path, RP_PATH, '新宿主取 workFolder()')
  const text = V.get(RP_PATH)
  A.ok(text.startsWith('# 2026-W33 周报'), 'H1 = 周号 + 周报')
  A.ok(text.includes('2026-08-10 ~ 2026-08-16'), '元信息行给日期区间')
  A.ok(text.includes('## 素材出处'), '默认附素材出处段')
  A.ok(text.includes('[[Notes/架构评审.md]]'), '出处回链用 vault 相对路径')
  A.ok(text.includes('Project/x/src/index.ts'), 'agent.edit 的项目路径只列文件名')
  A.ok(!text.includes('[[Project/x/src/index.ts]]'), 'agent.edit 的项目路径**不给回链**')
  A.ok(text.includes('和 X 对齐了 Q3 目标'), '手工补录进素材出处')
  const sc = JSON.parse(V.get(SC_PATH))
  A.ok(sc.report && sc.report.hash, 'sidecar.report 记下 hash')
  A.equal(sc.report.hash, T.fnv1a(T.normalizeReport(text)), 'hash = fnv1a(normalizeReport(全文))')
  A.equal(_ls.get('plugin.worklog-reporter.firstWeek'), WEEK, '首次成功写报告记 firstWeek')
  // 只改「素材出处」段(锚点之后)不算改动:normalizeReport 在锚点处截断
  V.set(RP_PATH, `${text}\n- 后补的一条出处\n`)
  A.equal(T.fnv1a(T.normalizeReport(V.get(RP_PATH))), sc.report.hash, '素材出处段之后的改动不进 hash')
  // 覆盖防线:用户改了**正文**后 hash 不符 → 不确认就另存 -v2
  V.set(RP_PATH, text.replace('- 收敛了活动日志解析层', '- 收敛了活动日志解析层\n- 用户手工加的一条'))
  main.promptReply = null
  const p2 = await T.saveReport(WEEK, '## 本周完成\n\n- 第二次生成', 'generic3')
  A.equal(p2.path, '工作/汇报/Reports/2026-W33-v2.md', '未确认 → 改写到 -v2')
  A.equal(p2.renamed, true)
  A.ok(V.get(RP_PATH).includes('用户手工加的一条'), '原报告一字未动')
  // 确认 y → 覆盖
  main.promptReply = 'y'
  const p3 = await T.saveReport(WEEK, '## 本周完成\n\n- 第三次生成', 'generic3')
  A.equal(p3.path, RP_PATH, '输入 y → 覆盖原文件')
  A.ok(V.get(RP_PATH).includes('第三次生成'))
  A.ok(!V.get(RP_PATH).includes('用户手工加的一条'))
  main.promptReply = null
  // 只是被 Amadeus 打开过(落了块标记)不算改动 → 直接覆盖,不问
  const cur = V.get(RP_PATH)
  V.set(RP_PATH, cur.split('\n').map((l, i) => (i === 4 ? `<!-- a ${i} -->\n${l}` : l)).join('\n'))
  const p4 = await T.saveReport(WEEK, '## 本周完成\n\n- 第四次生成', 'generic3')
  A.equal(p4.path, RP_PATH, '块标记 ≠ 用户改动:不许弹确认、不许另存')
}
// 损坏 sidecar:**先备份原字节,备份成功之后**才重建空档案
{
  const badWeek = '2026-W20'
  const badPath = `工作/汇报/.worklog/${badWeek}.json`
  const rawBytes = '{ 这不是合法 JSON'
  V.set(badPath, rawBytes)
  main.writes.length = 0
  const sc = await T.readSidecarRaw(badWeek)
  const bak = main.writes.find((p) => p.indexOf(`工作/汇报/.worklog/${badWeek}.corrupt-`) === 0)
  A.ok(bak, '损坏 sidecar 必须先写备份')
  A.equal(V.get(bak), rawBytes, '备份内容 === 原始字节')
  A.equal(main.writes[0], bak, '备份必须排在重建之前(顺序不能反)')
  A.equal(main.writes[1], badPath, '备份成功之后才重建空档案')
  A.deepEqual(sc.items, [], '重建出空档案')
  A.ok(main.reg.notes.find(([m]) => String(m).includes('备份')), '必须告知用户备份路径,不许静默当缺席')
}

// ══ ⑩ 归档路径自枚举 ══════════════════════════════════════════════════════
{
  // (a) firstWeek 存在 → 只探 firstWeek..current 区间,不多探
  clearPluginLS()
  _ls.set('plugin.worklog-reporter.firstWeek', '2026-W31')
  const va = new Map()
  va.set('工作/汇报/Reports/2026-W31.md', '# 2026-W31 周报\n\n> 2026-07-27 ~ 2026-08-02 ｜ 模板:通用三段式 ｜ 生成于 2026-08-02 18:00\n\n## 本周完成\n\n- 老条目\n')
  va.set('工作/汇报/Reports/2026-W33.md', '# 2026-W33 周报\n\n> 2026-08-10 ~ 2026-08-16 ｜ 模板:通用三段式 ｜ 生成于 2026-08-14 21:30\n\n## 本周完成\n\n- 新条目\n- 老条目\n')
  const ia = freshInstance({ vault: va })
  ia.reads.length = 0
  const rows = await ia.T.listArchive()
  A.deepEqual(ia.reads.slice().sort(), [
    '工作/汇报/Reports/2026-W31.md', '工作/汇报/Reports/2026-W32.md', '工作/汇报/Reports/2026-W33.md',
  ].sort(), 'firstWeek 存在时只探区间内的路径,一次也不许多探')
  A.deepEqual(rows.map((r) => r.week), ['2026-W33', '2026-W31'], '倒序,缺席的周跳过')
  A.equal(rows[0].generatedAt, '2026-08-14 21:30', '生成时间从报告元信息行解析(不读 sidecar)')
  A.ok(rows[0].chars > 0)
  ia.dispose()

  // (b) firstWeek 缺失 + 库里有一份 2026-W30.md → 自愈探测写回 firstWeek,第二次不再全量探测
  clearPluginLS()
  const vb = new Map()
  vb.set('工作/汇报/Reports/2026-W30.md', '# 2026-W30 周报\n\n## 本周完成\n\n- x\n')
  const ib = freshInstance({ vault: vb })
  ib.reads.length = 0
  const r1 = await ib.T.listArchive()
  A.equal(_ls.get('plugin.worklog-reporter.firstWeek'), '2026-W30', '自愈探测把最早一周写回 firstWeek')
  A.deepEqual(r1.map((r) => r.week), ['2026-W30'])
  A.ok(ib.reads.length > 100, '自愈那一次向前探 104 周')
  ib.reads.length = 0
  await ib.T.listArchive()
  A.deepEqual(ib.reads.slice().sort(), [
    '工作/汇报/Reports/2026-W30.md', '工作/汇报/Reports/2026-W31.md',
    '工作/汇报/Reports/2026-W32.md', '工作/汇报/Reports/2026-W33.md',
  ].sort(), '第二次只探 firstWeek..current,不再全量探测')
  ib.dispose()

  // (c) 全空 → 返回空数组,不抛;记 probedAt 后不重复探测
  clearPluginLS()
  const ic = freshInstance({ vault: new Map() })
  A.deepEqual(await ic.T.listArchive(), [], '全空给空数组')
  A.ok(_ls.get('plugin.worklog-reporter.probedAt'), '一无所获记 probedAt')
  ic.reads.length = 0
  A.deepEqual(await ic.T.listArchive(), [], '第二次仍给空数组')
  A.equal(ic.reads.length, 0, '一无所获后不重复探测')
  ic.dispose()
}

// ══ ⑪-d mount 零联网 ══════════════════════════════════════════════════════
{
  clearPluginLS()
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = () => { fetched += 1; throw new Error('mount 期间不许联网') }
  const im = freshInstance({ vault: new Map() })
  const cleanups = []
  // ⚠️`el.textContent` 里**含 shell() 注入的 <style>**(那 4KB CSS 让 length > 0 恒真,白屏也能带绿灯
  // 出厂)。所以既要排除 style 再量长度,也要断言各视图**自己的业务标题**真的出现了。
  const TITLES = { compose: '汇报草稿', sources: '本周素材', archive: '历史归档' }
  const visibleText = (node) => node.children.filter((c) => c.tag !== 'style').map((c) => (c && c.textContent) || '').join('')
  for (const v of im.reg.views) {
    const el = mkEl('div')
    cleanups.push(v.mount(el))
    await sleep(20)
    A.ok(visibleText(el).trim().length > 0, `${v.id} 挂载后必须有可见内容(排除 <style> 之后仍非空)`)
    A.ok(el.textContent.includes(TITLES[v.id]), `${v.id} 挂载后必须出现自己的业务标题「${TITLES[v.id]}」`)
  }
  await sleep(60)
  for (const c of cleanups) {
    A.equal(typeof c, 'function', 'mount 必须返回清理函数')
    c()
    c() // 清理幂等(真机台架会 cleanup→remount)
  }
  A.equal(fetched, 0, 'mount 三个视图 + 清理,一次网络都不许发')
  im.dispose()
  globalThis.fetch = realFetch
}

// ══ ⑪-e 切语言就地重渲(不重挂)══════════════════════════════════════════
{
  clearPluginLS()
  const il = freshInstance({ vault: new Map() })
  const el = mkEl('div')
  const compose = il.reg.views.find((v) => v.id === 'compose')
  const cleanup = compose.mount(el)
  await sleep(30)
  const zhText = el.textContent
  A.ok(zhText.includes('汇报草稿'), '中文界面标题')
  A.ok(zhText.includes('本周'), '中文界面含「本周」')
  A.ok(zhText.includes('通用三段式'), '模板名跟随语言')
  // 【P3-9b 回归】◀ ▶ 是纯符号按钮:没有 title / aria-label 的话,鼠标悬停与读屏都无从知道它是干嘛的
  const arrow = (act) => findAll(el, (c) => c.attrs && c.attrs['data-act'] === act)[0]
  for (const act of ['prev', 'next']) {
    const b = arrow(act)
    A.ok(b, `周选择器应有 ${act} 按钮`)
    A.ok(b.attrs.title && b.attrs['aria-label'], `${act} 是纯符号按钮:必须给 title 与 aria-label`)
  }
  A.equal(arrow('prev').attrs.title, '上一周', '中文界面的箭头说明')
  const mountsBefore = il.T.mounts()
  il.setLocale('en')
  await sleep(20)
  const enText = el.textContent
  A.ok(enText.includes('Draft'), '切 en 后出现英文串')
  A.ok(enText.includes('Three-part standard'), '模板名也跟着变英文')
  A.ok(!enText.includes('本周'), '切 en 后不许残留「本周」')
  A.ok(!/[一-鿿]/.test(enText), '英文界面不许残留任何中文')
  A.equal(arrow('prev').attrs.title, 'Previous week', '箭头的 title 也跟着语言走')
  A.equal(arrow('next').attrs['aria-label'], 'Next week', 'aria-label 同上')
  A.equal(il.T.mounts(), mountsBefore, '就地重渲:期间绝不重新 mount')
  il.setLocale('zh')
  await sleep(10)
  A.ok(el.textContent.includes('汇报草稿'), '切回中文同样就地生效')
  cleanup()
  il.dispose()
}

// ══ ⑪-f 素材视图交互(勾选 / 手工补录 / 出处回链)══════════════════════════
{
  clearPluginLS()
  const vi = new Map()
  const ii = freshInstance({ vault: vi })
  await ii.T.updateSidecar('2026-W33', (sc) => {
    sc.items = ii.T.mergeItems(sc.items, ii.T.parseActivityLog(SAMPLE).items)
    return sc
  })
  await ii.T.loadWeek('2026-W33')
  const el = mkEl('div')
  const sources = ii.reg.views.find((v) => v.id === 'sources')
  const cleanup = sources.mount(el)
  await sleep(30)
  A.ok(findAll(el, (c) => c.attrs && c.attrs['data-item']).length >= 8, '素材列表按条渲染')
  A.ok(el.textContent.includes('note.edit'), '原始事件名以等宽 token 呈现(不翻译)')
  A.ok(el.textContent.includes('编辑笔记'), '旁边才是双语人类标签')
  A.ok(el.textContent.includes('Notes/架构评审.md'), '出处回链显示 vault 相对路径')
  // 勾选态往返
  const box = findAll(el, (c) => c.attrs && c.attrs['data-pick'])[0]
  const targetId = box.attrs['data-pick']
  const before = JSON.parse(vi.get('工作/汇报/.worklog/2026-W33.json')).items.find((i) => i.id === targetId).picked
  box.listeners.change[0]()
  await sleep(30)
  const after = JSON.parse(vi.get('工作/汇报/.worklog/2026-W33.json')).items.find((i) => i.id === targetId).picked
  A.notEqual(before, after, '点勾选框应翻转 picked 并落盘')
  // 手工补录
  const input = findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0]
  input.value = '和 X 对齐了 Q3 目标'
  findAll(el, (c) => c.attrs && c.attrs['data-act'] === 'add')[0].listeners.click[0]()
  await sleep(30)
  const items = JSON.parse(vi.get('工作/汇报/.worklog/2026-W33.json')).items
  A.ok(items.find((i) => i.src === 'manual' && i.text === '和 X 对齐了 Q3 目标'), '手工补录落盘')
  A.ok(ii.reg.activity.find(([e]) => e === 'manual'), '手工补录发活动事件')
  A.ok(ii.reg.tracks.find(([e]) => e === 'manual'), '手工补录埋成就点')
  // 回链可点
  const lnk = findAll(el, (c) => c.className === 'wl-lnk')[0]
  lnk.listeners.click[0]()
  // [回归] 2026-08-21 生态级 P0-A:裸 .md 走 loadPage,不是 openFile。
  //   ⚠️这条断言上一版是**写反方向的**(钉的是 `reg.opened.includes(...)`),把 bug 当成了期望值。
  //   真源 amadeusNav.ts:215-217 —— openFile 对 !matchFileType 的裸 .md 交系统默认程序。
  A.ok(ii.reg.loaded.includes('Notes/架构评审.md'), '点回链应走 ctx.app.loadPage')
  A.ok(!ii.reg.opened.includes('Notes/架构评审.md'), '点回链绝不许走 ctx.app.openFile(会被 TextEdit 抢走)')
  cleanup()
  ii.dispose()
}

// ══ ⑪-g 旧宿主 ctx(07-18 之后的面全删,且没有 getLocale / subscribeLocale)══
{
  clearPluginLS()
  const vo = new Map()
  const io = freshInstance({ vault: vo, oldHost: true })
  A.equal(typeof io.dispose, 'function', '旧宿主:setup 不抛且返回 disposer')
  A.equal(io.T.L(), 'zh', '旧宿主无 getLocale → 回退中文')
  A.equal(io.reg.status.length, 0, '旧宿主无 registerStatusItem → 静默跳过')
  A.equal(io.reg.series.length, 0, '旧宿主无 achievements → 静默跳过')
  A.equal(io.reg.views.length, 3, '旧宿主仍注册三视图')
  A.equal(io.reg.commands.length, 2, '旧宿主仍注册两命令')
  const p = await io.T.saveReport('2026-W33', '## 本周完成\n\n- 旧宿主也能写', 'generic3')
  A.equal(p.path, '汇报生成器/Reports/2026-W33.md', '旧宿主无 workFolder → 回退字面量「汇报生成器」')
  A.ok(vo.get('汇报生成器/.worklog/2026-W33.json'), '旧宿主 sidecar 也落默认夹')
  const el = mkEl('div')
  const cleanup = io.reg.views[0].mount(el)
  await sleep(30)
  A.ok(el.textContent.includes('汇报草稿'), '旧宿主视图照常渲染中文')
  cleanup()
  // 命令在缺 openView 的宿主上跑也不抛(这里 openView 在,只验不抛)
  io.reg.commands.find((c) => c.id === 'worklog-reporter-open').run()
  await sleep(10)
  io.dispose()
}

// ══ 斜杠项:已存在报告 → 回吐正文;不存在 → 模板骨架;**绝不新建文件** ══════
{
  clearPluginLS()
  const vs = new Map()
  const is = freshInstance({ vault: vs })
  const item = is.reg.slash[0]
  const before = vs.size
  const skeleton = await item.run({ pagePath: 'X.md', folder: 'X' })
  A.ok(skeleton.includes('## 本周完成'), '不存在 → 给当前模板的小节骨架')
  A.equal(vs.size, before, '斜杠项绝不为此新建文件(会污染归档枚举)')
  vs.set('工作/汇报/Reports/2026-W33.md', '# 2026-W33 周报\n\n> meta\n\n## 本周完成\n\n- 已有的一条\n\n---\n\n## 素材出处\n\n- 出处\n')
  const body = await item.run({ pagePath: 'X.md', folder: 'X' })
  A.ok(body.includes('已有的一条'), '已存在 → 回吐正文')
  A.ok(body.indexOf('# 2026-W33 周报') < 0, '剥掉 H1')
  A.ok(body.indexOf('素材出处') < 0, '剥掉素材出处段')
  A.equal(vs.size, before + 1, '仍然没有新建任何文件')
  is.dispose()
}

// ══ 未登录:generate 命令提示后安静返回(不抛、不报错)══════════════════════
{
  clearPluginLS()
  const iu = freshInstance({ vault: new Map() })
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = () => { fetched += 1; throw new Error('未登录不许联网') }
  iu.reg.commands.find((c) => c.id === 'worklog-reporter-generate').run()
  await sleep(50)
  A.equal(fetched, 0, '未登录:一次网络都不许发')
  A.ok(iu.reg.notes.find(([m]) => String(m).includes('引擎') || String(m).includes('登录')), '未登录:给用户可见提示')
  globalThis.fetch = realFetch
  iu.dispose()
}

// ══ ⑫ 评审回归(2026-08-14 评审的 P0/P1/P2/P3 逐条留仪器)══════════════════
// 共同手法:直接换掉 inst.ctx.app.readFile / writeFile 注入 per-path 故障 —— 插件每次都是
// `ctx.app.readFile(...)` 现查属性,所以打桩即生效。

// ⑫-a【P0-1】读失败被折叠成「文件不存在」→ 一次瞬时读错抹掉全部手工补录
{
  clearPluginLS()
  const vg = new Map()
  const ig = freshInstance({ vault: vg })
  const SCP = '工作/汇报/.worklog/2026-W33.json'
  const m1 = ig.T.manualItem('和 X 对齐了 Q3 目标', NOW - 7200000)
  const m2 = ig.T.manualItem('周三的架构评审会', NOW - 3600000)
  await ig.T.updateSidecar('2026-W33', (sc) => { sc.items = [m1, m2]; return sc })
  await ig.T.loadWeek('2026-W33')
  A.equal(JSON.parse(vg.get(SCP)).items.length, 2, '前置:两条手工补录已落盘')
  const realRead = ig.ctx.app.readFile
  ig.ctx.app.readFile = async (p) => (p === SCP ? null : realRead(p)) // 一次瞬时读错
  ig.reg.notes.length = 0
  const r = await ig.T.togglePick(m1.id, false)
  A.equal(r, null, '读失败时这次改动必须被放弃(返回 null,不是静默成功)')
  const after = JSON.parse(vg.get(SCP))
  A.equal(after.items.length, 2, '**读失败绝不许由空档案覆盖非空档案**:两条手工补录一条不少')
  A.ok(after.items.every((i) => i.src === 'manual'), '补录内容原样还在')
  A.ok(ig.reg.notes.find(([, o]) => o && o.level === 'error'), '放弃这次写必须告诉用户(error 级)')
  ig.ctx.app.readFile = realRead
  // 恢复之后照常能写(闸只在读失败时合上,不是永久锁死)
  A.ok(await ig.T.togglePick(m1.id, false), '读恢复后照常落盘')
  A.equal(JSON.parse(vg.get(SCP)).items.find((i) => i.id === m1.id).picked, false)
  ig.dispose()
}

// ⑫-b【P0-2】报告覆盖防线在读失败时被整条绕过 → 静默覆盖用户手改的报告
{
  clearPluginLS()
  const vr = new Map()
  const ir = freshInstance({ vault: vr })
  const RP = '工作/汇报/Reports/2026-W33.md'
  await ir.T.saveReport('2026-W33', '## 本周完成\n\n- 第一版', 'generic3')
  vr.set(RP, vr.get(RP).replace('- 第一版', '- 第一版\n- 用户手写的一整段'))
  const realRead = ir.ctx.app.readFile
  ir.ctx.app.readFile = async (p) => (p === RP ? null : realRead(p)) // 报告路径读失败
  ir.promptReply = null
  const p2 = await ir.T.saveReport('2026-W33', '## 本周完成\n\n- 第二版', 'generic3')
  A.equal(p2.renamed, true, 'sidecar 说这个路径我们写过,却读回 null = 只可能是读失败 → 按可疑处理')
  A.equal(p2.reason, 'unreadable')
  A.equal(p2.path, '工作/汇报/Reports/2026-W33-v2.md', '不确认就另存 -v2')
  A.ok(vr.get(RP).includes('用户手写的一整段'), '原报告一字未动')
  // 确认 y 仍可覆盖(防线是问一句,不是禁止)
  ir.promptReply = 'y'
  const p3 = await ir.T.saveReport('2026-W33', '## 本周完成\n\n- 第三版', 'generic3')
  A.equal(p3.path, RP, '输入 y → 照旧覆盖原路径')
  ir.promptReply = null
  ir.ctx.app.readFile = realRead
  ir.dispose()
}

// ⑫-c【P1-3】落盘失败 = 未捕获 promise 拒绝 + 用户输入凭空蒸发 + 零提示
{
  clearPluginLS()
  const vw = new Map()
  const iw = freshInstance({ vault: vw })
  await iw.T.loadWeek('2026-W33')
  const el = mkEl('div')
  const cleanup = iw.reg.views.find((v) => v.id === 'sources').mount(el)
  await sleep(20)
  const realWrite = iw.ctx.app.writeFile
  iw.ctx.app.writeFile = async () => { throw new Error('EACCES') }
  let unhandled = 0
  const onUnh = () => { unhandled += 1 }
  process.on('unhandledRejection', onUnh)
  const input = findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0]
  input.value = '和 X 开了个会'
  input.listeners.input[0]()
  iw.reg.notes.length = 0
  findAll(el, (c) => c.attrs && c.attrs['data-act'] === 'add')[0].listeners.click[0]()
  await sleep(40)
  process.off('unhandledRejection', onUnh)
  A.equal(unhandled, 0, '落盘失败不许留下未捕获的 promise 拒绝')
  A.ok(iw.reg.notes.find(([, o]) => o && o.level === 'error'), '落盘失败必须有 error 级提示')
  const again = findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0]
  A.equal(again.value, '和 X 开了个会', '落盘失败后用户刚敲的那条必须还在输入框里(不许清空即蒸发)')
  iw.ctx.app.writeFile = realWrite
  // BRIEF 点名的洞:切语言整树重渲不许冲掉正在输入的内容
  const typing = findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0]
  typing.value = '正敲了一半的补录'
  typing.listeners.input[0]()
  iw.setLocale('en')
  await sleep(15)
  A.equal(findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0].value, '正敲了一半的补录', '切语言不许丢正在输入的补录')
  iw.setLocale('zh')
  await sleep(10)
  // 写恢复后照常落盘,输入框才清空
  const ok = findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0]
  ok.value = '真的记一条'
  ok.listeners.input[0]()
  findAll(el, (c) => c.attrs && c.attrs['data-act'] === 'add')[0].listeners.click[0]()
  await sleep(40)
  A.ok(JSON.parse(vw.get('工作/汇报/.worklog/2026-W33.json')).items.find((i) => i.text === '真的记一条'), '写恢复后落盘')
  A.equal(findAll(el, (c) => c.attrs && c.attrs['data-manual'])[0].value, '', '落盘成功后输入框才清空')
  cleanup()
  iw.dispose()
}

// ⑫-d【P1-4】保存报告后已打开的归档视图退化成空态
{
  clearPluginLS()
  _ls.set('plugin.worklog-reporter.firstWeek', '2026-W32')
  const va2 = new Map()
  va2.set('工作/汇报/Reports/2026-W32.md', '# 2026-W32 周报\n\n> 2026-08-03 ~ 2026-08-09 ｜ 生成于 2026-08-09 20:00\n\n## 本周完成\n\n- 上周的一条\n')
  const ia2 = freshInstance({ vault: va2 })
  const el = mkEl('div')
  const cleanup = ia2.reg.views.find((v) => v.id === 'archive').mount(el)
  await sleep(60)
  A.ok(el.textContent.includes('2026-W32'), '归档首绘列出已有报告')
  ia2.T.state.draft = '## 本周完成\n\n- 刚写完的一条'
  await ia2.T.saveCurrentDraft('2026-W33')
  await sleep(80)
  A.ok(el.textContent.indexOf('还没有已归档的报告') < 0, '刚存完周报,归档面板不许反过来说一份都没有')
  A.ok(el.textContent.includes('2026-W33'), '刚存的那份自己出现在归档里(不用手点刷新)')
  A.ok(el.textContent.includes('2026-W32'), '老的那份还在')
  // 缓存被任何别的路径置空后,重绘本身必须会自己去加载(不能只靠 saveCurrentDraft 那一处补救)
  ia2.T.state.archive = null
  ia2.T.bus.emit()
  A.ok(el.textContent.indexOf('还没有已归档的报告') < 0, 'archive 缓存为 null 时重绘不许画成空态(那是「一份都没有」的意思)')
  A.ok(el.textContent.includes('加载中'), 'null 缓存 → 走「加载中」分支')
  await sleep(60)
  A.ok(el.textContent.includes('2026-W33'), '「加载中」之后自己把列表补上')
  cleanup()
  ia2.dispose()
}

// ⑫-e【P1-5】渲染异常被静默吞掉 → 白屏
{
  clearPluginLS()
  const ie = freshInstance({ vault: new Map() })
  const el = mkEl('div')
  ie.reg.notes.length = 0
  const cleanup = ie.T.mountView(el, () => { throw new Error('boom') })
  const root = el.children.find((c) => c.className === 'wl-root')
  A.ok(root, 'shell 根仍在')
  A.ok(root.textContent.includes('汇报生成器'), '渲染崩了要画降级文案,不许留一块纯白')
  A.ok(root.textContent.includes('boom'), '降级文案带上错误原因(用户能报给我们)')
  A.ok(ie.reg.notes.find(([, o]) => o && o.level === 'error'), '渲染失败必须提示用户')
  A.equal(typeof cleanup, 'function', '崩了也要返回清理函数')
  cleanup()
  ie.dispose()
}

// ⑫-f【P2-6】切周的状态卫生:错误不跟着人走 / 未保存草稿不丢 / 异步不串台
{
  clearPluginLS()
  const ist = freshInstance({ vault: new Map() })
  await ist.T.loadWeek('2026-W33')
  ist.T.state.scanError = '上一周的扫描错误'
  ist.T.state.genError = '上一周的生成错误'
  ist.T.state.draft = '## 本周完成\n\n- 我手打的半份周报'
  ist.reg.notes.length = 0
  await ist.T.loadWeek('2026-W32')
  A.equal(ist.T.state.scanError, '', '切周清空上一周的扫描错误(否则新周顶上挂着会去扫新周的重试按钮)')
  A.equal(ist.T.state.genError, '', '切周清空上一周的生成错误')
  A.equal(ist.T.state.draft, '', 'W32 没有报告 → 草稿是空的')
  A.ok(ist.reg.notes.find(([m]) => String(m).includes('还没保存')), '带着未保存草稿切走要给一条 warning')
  await ist.T.loadWeek('2026-W33')
  A.ok(String(ist.T.state.draft).includes('我手打的半份周报'), '未保存的草稿切回来仍在(◀ ▶ 来回一次不许归零)')
  ist.dispose()
}
// ⑫-f2【P2-6c】异步收尾必须校验「还在同一周吗」:慢返回的 W33 结果不许灌进正在显示的 W32。
// 这里用可控延迟的写盘卡住 mutateItems;scanWeek / generateDraft 的收尾用的是同一条 `state.week !== week` 纪律。
{
  clearPluginLS()
  const vc = new Map()
  const ic = freshInstance({ vault: vc })
  const mi = ic.T.manualItem('W33 的一条补录', NOW - 3600000)
  await ic.T.updateSidecar('2026-W33', (sc) => { sc.items = [mi]; return sc })
  await ic.T.loadWeek('2026-W33')
  let release = null
  const gate = new Promise((r) => { release = r })
  const realWrite = ic.ctx.app.writeFile
  ic.ctx.app.writeFile = async (p, txt) => { await gate; return realWrite(p, txt) }
  const pending = ic.T.togglePick(mi.id, false) // 悬在半空的 W33 落盘
  await ic.T.loadWeek('2026-W32') // 用户这时切到了上一周
  release()
  await pending
  await sleep(20)
  ic.ctx.app.writeFile = realWrite
  A.equal(ic.T.state.week, '2026-W32')
  A.equal(ic.T.state.sidecar.week, '2026-W32', 'W33 的慢返回不许把 W33 的素材灌进正在显示的 W32')
  A.equal(JSON.parse(vc.get('工作/汇报/.worklog/2026-W33.json')).items[0].picked, false, '写本身仍然落在 W33 自己的档案里')
  ic.dispose()
}

// ⑫-g【P2-8】回读片段不许把画板 / 思维导图的 JSON 当笔记正文喂给模型
{
  clearPluginLS()
  const vx = new Map()
  vx.set('Notes/正经笔记.md', 'A'.repeat(50))
  vx.set('Notes/画板.excalidraw.md', '{"type":"excalidraw","elements":[]}')
  vx.set('Notes/思维导图.mindmap.md', '{"nodes":[]}')
  vx.set('WMOSv11/MOC-Tisy.fd/#杏雨 v11.7.4.md', 'B'.repeat(50)) // 真库里的正经笔记(双扩展名)
  const ix = freshInstance({ vault: vx })
  const links = ['Notes/正经笔记.md', 'Notes/画板.excalidraw.md', 'Notes/思维导图.mindmap.md', 'WMOSv11/MOC-Tisy.fd/#杏雨 v11.7.4.md']
  const ex = await ix.T.collectExcerpts(links.map((p) => ({ link: p })))
  A.deepEqual(Object.keys(ex).sort(), ['Notes/正经笔记.md', 'WMOSv11/MOC-Tisy.fd/#杏雨 v11.7.4.md'].sort(), '画板 / 导图不进片段,真笔记照进')
  A.equal(ix.T.isProseNote('x.excalidraw.md'), false, '.excalidraw.md 排除(与宿主 builtinTypes 同口径)')
  A.equal(ix.T.isProseNote('x.mindmap.md'), false, '.mindmap.md 排除')
  A.equal(ix.T.isProseNote('#杏雨 v11.7.4.md'), true, '⚠️不许用「双扩展名 = 非笔记」的启发式:真库里这就是正经笔记')
  A.equal(ix.T.isProseNote('a.png'), false)
  ix.dispose()
}

// ⑫-h【P3-9c / P3-9e】过保留期的周文案 + 成就计在落盘成功之后
{
  clearPluginLS()
  const iold = freshInstance({ vault: new Map() })
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = () => { fetched += 1; throw new Error('过期周不许联网') }
  await iold.T.scanWeek('2026-W20') // 早已过 30 天保留期
  A.equal(fetched, 0, '过了保留期的周:一次网络都不发')
  A.equal(iold.T.state.scanError, iold.T.t('weekTooOld'), '给的是「已过保留期」,不是「结果不可信,请重试」')
  globalThis.fetch = realFetch
  iold.T.state.draft = '## 本周完成\n\n- 一条'
  await iold.T.saveCurrentDraft('2026-W33')
  A.equal(iold.reg.tracks.filter(([e]) => e === 'report').length, 1, '落盘成功才算一份周报')
  await iold.T.saveCurrentDraft('2026-W33')
  A.equal(iold.reg.tracks.filter(([e]) => e === 'report').length, 1, '同一周反复保存不许把「十份周报」刷满')
  iold.dispose()
}

// ⑫-i【BRIEF 铁律】t() 的占位符必须**单趟**正则替换
{
  // 键序是这条断言的命门:`kept` 在前、`picked` 在后 —— 逐个 split/join 的写法会把刚替进去的
  // 那个「{picked}」当成占位符再吃一次(得到 7),单趟正则则原样留着。用户的数据里只要有个
  // 花括号串,他自己的字就会被当占位符吃掉(BRIEF 2026-08-14 实测)。
  A.ok(T.t('materialCount', { kept: '{picked}', picked: 7 }).includes('{picked}'),
    '单趟替换:先替进去的值不许被后面那轮再扫一遍')
  A.equal(T.t('chars', { n: 3 }), '3 字', '正常占位符照常替')
  A.equal(T.t('chars', {}), '{n} 字', '未知键原样留着,不许替成 undefined')
  A.equal(T.t('chars'), '{n} 字', '不传 vars 时原样返回')
  A.equal(T.t('__nope__'), '__nope__', '词表里没有的键原样返回')
}

// ⑫-j【P2-6a 的异步面】慢返回的失败不许把错误落到已经切走的那一周
{
  clearPluginLS()
  const iz = freshInstance({ vault: new Map() })
  await iz.T.loadWeek('2026-W33')
  const realFetch = globalThis.fetch
  const hadWindow = 'window' in globalThis
  const realWindow = globalThis.window
  globalThis.window = { tangu: { getConfig: async () => ({ backendUrl: 'http://127.0.0.1:0/api', token: 'tk' }) } }
  // (a) scanWeek:W33 的扫描卡在半空 → 用户切到 W32 → 失败才回来
  let release = null
  const gate = new Promise((r) => { release = r })
  globalThis.fetch = async () => { await gate; throw new Error('网络炸了') }
  const pScan = iz.T.scanWeek('2026-W33')
  await sleep(10)
  await iz.T.loadWeek('2026-W32')
  release()
  await pScan
  A.equal(iz.T.state.week, '2026-W32')
  A.equal(iz.T.state.scanError, '', 'W33 的扫描失败不许挂到正在显示的 W32 顶上(那个重试按钮会去扫 W32)')
  // (b) generateDraft 同一条纪律
  let release2 = null
  const gate2 = new Promise((r) => { release2 = r })
  globalThis.fetch = async () => { await gate2; throw new Error('生成也炸了') }
  const pGen = iz.T.generateDraft('2026-W32')
  await sleep(10)
  await iz.T.loadWeek('2026-W33')
  release2()
  await pGen
  A.equal(iz.T.state.week, '2026-W33')
  A.equal(iz.T.state.genError, '', 'W32 的生成失败不许挂到正在显示的 W33 顶上')
  globalThis.fetch = realFetch
  if (hadWindow) globalThis.window = realWindow
  else delete globalThis.window
  iz.dispose()
}

// ══ ⑫ [回归] 2026-08-21 P0-A:openVaultFile 的后缀分流 ══════════════════════
// 裸 `.md` → loadPage(否则被系统默认程序抢走);复合后缀 `.x.md` 与非 md → openFile
// (loadPage 会把插件文件类型当普通笔记导进 v3 = 毁档,方向反了同样是事故)。
// 实证探针:/tmp/fip0821-review/main-openfile/probe-openfile.cjs(真浏览器里跑宿主真身 findFileType)
{
  const iv = freshInstance({ vault: new Map() })
  const O = iv.T.openVaultFile
  O('工作/汇报/Reports/2026-W34.md')
  A.deepEqual(iv.reg.loaded, ['工作/汇报/Reports/2026-W34.md'], '⑫ 周报(裸 .md)走 loadPage')
  A.equal(iv.reg.opened.length, 0, '⑫ 周报绝不走 openFile')
  for (const p of ['画/图.excalidraw.md', '图/脑图.mindmap.md', '卡组/日语.deck.md']) O(p)
  O('资料/论文.pdf'); O('库/日历.db')
  A.deepEqual(iv.reg.opened, ['画/图.excalidraw.md', '图/脑图.mindmap.md', '卡组/日语.deck.md', '资料/论文.pdf', '库/日历.db'],
    '⑫ 复合后缀与非 md 一律走 openFile(走 loadPage 会毁档)')
  A.equal(iv.reg.loaded.length, 1, '⑫ 复合后缀一个都没落进 loadPage')
  O('')
  A.equal(iv.reg.loaded.length + iv.reg.opened.length, 6, '⑫ 空路径两边都不调')
  iv.dispose()
}
{
  // 旧宿主没有 loadPage:退回 openFile,不是干脆不打开
  const iw = freshInstance({ vault: new Map() })
  delete iw.ctx.app.loadPage
  iw.T.openVaultFile('工作/汇报/Reports/2026-W34.md')
  A.deepEqual(iw.reg.opened, ['工作/汇报/Reports/2026-W34.md'], '⑫ 旧宿主退回 openFile')
  iw.dispose()
}

main.dispose()
clearPluginLS()
console.log('check ok — 3 视图 / 2 命令 / 1 斜杠 / 3 设置 / 状态栏 / 成就 契约 + 日志行文法(8 条真日志行 + 截断 / 空值 / 无法解析 / CRLF / 白名单三分流)+ 四时区周历(ISO 10 向量 · weekStart 往返 · DST 三周正午锚定 · weekSeq guard)+ mergeItems 合流五条 + diffReports 三桶 + normalizeReport 覆盖防线 + 英文指令段与片段封顶 + 围栏解析(嵌套 / 回退)+ XSS + 数据契约往返(未知顶层键 / 损坏先备份后重建 / -v2 覆盖防线)+ 归档自枚举(不多探 / 自愈 / 全空)+ mount 零联网 + 双语键集合 + 切语言就地重渲 + 旧宿主降级 + openVaultFile 后缀分流(裸 .md→loadPage / 复合后缀→openFile,P0-A 回归) 全部通过')
