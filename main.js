/**
 * 汇报生成器 worklog-reporter —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 定位:周报难写不是不会写,是想不起来自己这周干了什么 —— 而活动日志 / 会话 / 笔记改动里本来就有答案。
 * 现有 AI 周报工具的公认失败点是「还是免不了要绞尽脑汁地回想你做的事」(它们只有一个空输入框);
 * 本插件的输入不是回忆,是本机既有的事实数据。
 *
 * ── 管线(两段 Agent,不许简化成一段)────────────────────────────────────────
 *
 *  [sources 视图]  用户点「扫描本周素材」
 *        │
 *        ├─▶ Run A(agent_config.execMode:'host'):run_bash 只读 cat 7 个日期的两处 activity 日志
 *        │        ↓ 模型逐字回抄 ```worklog-raw 围栏
 *        │   插件本地 parseActivityLog() → 白名单过滤 → mergeItems() → 写 sidecar
 *        │
 *        ├─  用户勾选 / 取消 / 手工补录(每条带出处回链)
 *        │
 *        └─▶ [compose 视图] 用户点「生成草稿」
 *                 ├─ 对被勾选条目里 vault 相对的 f=,ctx.app.readFile 回读正文 → 截断成 excerpts
 *                 ├─▶ Run B(**无** execMode / **无** agentSlug,纯文本):素材 + 片段 + 模板 → ```worklog 围栏
 *                 └─ 插件解析围栏 → 自己 writeFile 到 Reports/<week>.md → 更新 sidecar.report → openFile
 *
 * **为什么必须两段**:`note.edit` 只有路径 + 行区间,没有内容;把日志原样丢给模型它只能编。
 * 日志的作用是给出本周动过的**文件清单**,内容要插件自己 readFile 回读再一起喂。
 *
 * ── 自噬防线 ──────────────────────────────────────────────────────────────
 * 解析层显式丢弃 `plugin:` 前缀的一切事件(实测两个计时器插件占了样本 4700 行里的 2031 行)。
 * 本插件自己经 ctx.activity.log 发的 `plugin:worklog-reporter:*` 事件因此天然被丢掉 ——
 * 绝不会出现「上周我在写周报」这种自指素材。
 *
 * 数据:报告 = 普通 Markdown 笔记 <工作文件夹>/Reports/YYYY-Www.md(不注册自定义文件类型);
 *       机器态素材档案 = <工作文件夹>/.worklog/YYYY-Www.json(点开头,文件树不显)。
 *       活动日志只读、从不写改删;除已登录的 Forsion 后端外不联系任何第三方。
 * 安全:一切用户/模型产出文本只走 createElement + textContent(全文件零 HTML 字符串注入面)。
 * 时间:「现在」一律 Date.now();逐日推进正午锚定;全文件无周期定时器(check 冻钟可测)。
 * 双语:ctx.getLocale / ctx.subscribeLocale;视图内部就地重渲(不重挂也要变)。
 * 兼容:07-18 之后的 ctx 面一律可选链,旧宿主缺席时优雅降级(回退中文 / 回退 ctx.app.notify)。
 */
const PLUGIN_ID = 'worklog-reporter'
const APP_ID = 'tangu'
const DEFAULT_FOLDER = '汇报生成器'
const REPORTS_DIR = 'Reports'
const SIDECAR_DIR = '.worklog'
const EXCERPT_TOTAL_CAP = 12000
const SCAN_LINE_CAP = 4000
const WEEK_RE = /^(\d{4})-W(\d{2})$/
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
// Amadeus 块标记行(宿主 shared/amadeus/compiler/markers.ts 的 BLOCK_MARKER_RE 同款):
// 用户只是在 Amadeus 里打开过报告,宿主就会落这种行 —— 它不算「用户改过报告」。
const MARKER_LINE = /^<!--\s*a\s+[A-Za-z0-9_-]+\s*-->\s*$/
// 「素材出处」段的两个**永不改**的锚点字面量(normalizeReport / diffReports 靠它切段)。
// 刻意不用 HTML 注释做锚:Amadeus 编译器在文件里落 `<!-- a N -->`,自造注释会混进去。
const SRC_H_ZH = '## 素材出处'
const SRC_H_EN = '## Sources'

// 事件白名单(**必须在解析层过滤**,不许下推到 shell)。扩充白名单需要改 SPEC。
const ALLOW = ['chat.new', 'chat.send', 'run.done', 'agent.edit', 'note.edit', 'note.create', 'file.save', 'view.open']
// 默认勾选:真正「干了活」的默认 ✅;只看/重复的默认 ⬜
const DEFAULT_PICK = {
  'note.edit': true, 'note.create': true, 'agent.edit': true, 'file.save': true, 'chat.new': true,
  'view.open': false, 'chat.send': false, 'run.done': false,
}
// `f=` 是 **vault 相对路径**的事件(可 readFile 回读、可 openFile 回链)。
// `agent.edit` 的 `f=` 是工作区/项目路径 → readFile 必然 null,**这不是错误**:只列文件名、不给回链。
const VAULT_PATH_EVENTS = ['note.edit', 'note.create', 'view.open', 'file.save']

// 模板集(扩展位纪律:加一个模板 = 往这个数组加一条,不许在别处再写 if (templateId === …);
// 已发布的 id 永不改 —— 它进了 sidecar 和设置)。飞书 / 钉钉 / 述职 / 年终模板 = v2。
const TEMPLATES = [
  { id: 'generic3',
    zh: { name: '通用三段式', sections: ['本周完成', '进行中', '下周计划'] },
    en: { name: 'Three-part standard', sections: ['Done this week', 'In progress', 'Next week'] } },
  { id: 'rag',
    zh: { name: '红黄绿灯', sections: ['🟢 顺利推进', '🟡 有风险', '🔴 受阻'] },
    en: { name: 'RAG status', sections: ['🟢 On track', '🟡 At risk', '🔴 Blocked'] } },
]

// ── 双语词表(两侧键集合必须完全相等,check.mjs 断言)──────────────────────
const MSG = {
  zh: {
    appName: '汇报生成器',
    cmdOpen: '汇报生成器:打开',
    cmdGenerate: '汇报生成器:生成本周汇报',
    viewCompose: '汇报草稿',
    viewSources: '本周素材',
    viewArchive: '历史归档',
    slashLabel: '本周汇报',
    setTemplate: '默认模板',
    setTemplateDesc: '模板 id:generic3(通用三段式)/ rag(红黄绿灯)',
    setIncludeSources: '报告附「素材出处」段',
    setIncludeSourcesDesc: '关掉后报告只留正文,素材出处仍留在素材档案里',
    setMaxExcerpt: '每篇笔记回读上限(字符)',
    setMaxExcerptDesc: '被勾选条目指向的笔记,每篇最多回读多少字符喂给模型;0 = 不回读正文',
    prevWeek: '上一周',
    nextWeek: '下一周',
    template: '模板',
    generate: '生成草稿',
    generating: '生成中…',
    cancel: '取消',
    save: '保存到笔记',
    openFile: '打开文件',
    materialCount: '本周素材 {kept} 条(已勾选 {picked} 条)',
    lastGenNever: '尚未生成',
    lastGen: '上次生成 {at}',
    hint1: '素材来自本机活动日志,只读、按需扫,不常驻也不推送。',
    hint2: '先去「本周素材」扫描并勾选,日志看不见的事在那里手工补录一条。',
    hint3: '产物是普通 Markdown 笔记,落在 Reports/ 里,可以直接编辑、双链、导出。',
    draftEmpty: '草稿是空的,先生成或手动写几行。',
    noEngine: '未连接到 Forsion 引擎(手工补录仍然可用)。',
    needLogin: '请先登录 Forsion(手工补录仍然可用)。',
    savedTo: '已保存到 {path}',
    savedAsNew: '报告已被手工改过,已另存为 {path}',
    overwriteAsk: '这份报告已被手工改过。输入 y 覆盖,留空则另存为新版本。',
    genFailed: '生成失败:{err}',
    fenceWarn: '模型没有按约定返回围栏,已按全文回退,请检查草稿格式。',
    scanTitle: '本周素材',
    scan: '扫描本周素材',
    scanning: '扫描中…',
    retry: '重试',
    stats: '总行 {total} ｜ 采纳 {kept} ｜ 插件心跳 {plugin} ｜ 其它 {other} ｜ 无法解析 {unparsed}',
    selectAll: '全选',
    selectNone: '全不选',
    manualTitle: '手工补录',
    manualPlaceholder: '日志看不见的事:和谁对齐了什么、开了什么会…',
    add: '添加',
    remove: '删除',
    emptySources: '还没有扫描本周素材。点上面的按钮扫一遍,或直接手工补录。',
    weekTooOld: '该周日志已过 30 天保留期,只能看已归档的报告。',
    scanUntrusted: '日志读取结果不可信(无法解析的行太多)。请重试,或直接手工补录。',
    scanned: '已扫出 {kept} 条素材',
    manualBadge: '手工补录',
    ev_note_edit: '编辑笔记',
    ev_note_create: '新建笔记',
    ev_view_open: '打开',
    ev_file_save: '保存文件',
    ev_chat_new: '新会话',
    ev_chat_send: '发消息',
    ev_run_done: '运行完成',
    ev_agent_edit: 'Agent 改文件',
    ev_manual: '手工补录',
    archiveTitle: '历史归档',
    refresh: '刷新',
    emptyArchive: '还没有已归档的报告。生成第一份周报后它会出现在这里。',
    chars: '{n} 字',
    genAt: '生成于 {at}',
    genAtUnknown: '生成时间未知',
    diffTitle: '与上周对比',
    diffAdded: '新增',
    diffGone: '消失',
    diffKept: '沿用',
    diffNone: '没有可比的上周报告。',
    srcHeading: '素材出处',
    reportTitle: '{week} 周报',
    reportMeta: '{from} ~ {to} ｜ 模板:{tpl} ｜ 生成于 {at}',
    corrupt: '素材档案损坏,原文件已备份到 {path},已重建空档案。',
    sidecarUnreadable: '素材档案暂时读不到,已放弃本次改动,以免用空档案覆盖掉已有素材。',
    saveFailed: '保存失败:{err}',
    renderFailed: '这个面板没能渲染出来。切换一次周,或关掉重开。',
    loadingText: '加载中…',
    draftKept: '{week} 的草稿还没保存,已留在内存里,切回该周即可继续。',
    overwriteAskUnread: '读不到已存在的那份报告(多半是临时故障)。输入 y 仍然覆盖,留空则另存为新版本。',
    savedAsNewUnread: '读不到原报告,为避免覆盖已另存为 {path}',
    sbNone: '{week} · 未生成',
    sbDone: '{week} · 已生成',
    sbTitle: '汇报生成器:点击打开汇报草稿',
    achSeries: '汇报生成器',
    achFirst: '第一份周报',
    achFirstDesc: '用汇报生成器交出第一份周报',
    achTen: '十份周报',
    achTenDesc: '累计生成 10 份周报',
    achGrounded: '有据可依',
    achGroundedDesc: '手工补录 20 条日志看不见的事',
  },
  en: {
    appName: 'WorklogReporter',
    cmdOpen: 'WorklogReporter: Open',
    cmdGenerate: 'WorklogReporter: Generate this week',
    viewCompose: 'Draft',
    viewSources: 'Material',
    viewArchive: 'Archive',
    slashLabel: 'This week report',
    setTemplate: 'Default template',
    setTemplateDesc: 'Template id: generic3 (three-part standard) or rag (RAG status)',
    setIncludeSources: 'Append a Sources section',
    setIncludeSourcesDesc: 'Turn off to keep the report body only; sources stay in the material sidecar',
    setMaxExcerpt: 'Per-note excerpt cap',
    setMaxExcerptDesc: 'How many characters of each linked note get sent to the model; 0 = no excerpts',
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    template: 'Template',
    generate: 'Generate draft',
    generating: 'Generating…',
    cancel: 'Cancel',
    save: 'Save to notes',
    openFile: 'Open file',
    materialCount: '{kept} items this week ({picked} ticked)',
    lastGenNever: 'Not generated yet',
    lastGen: 'Last generated {at}',
    hint1: 'The material comes from your local activity log: read-only, scanned on demand, no daemon and no push.',
    hint2: 'Scan and tick in Material first; add anything the log cannot see as a manual entry there.',
    hint3: 'Output is a plain Markdown note under Reports/ — editable, linkable, exportable.',
    draftEmpty: 'The draft is empty. Generate one, or type a few lines yourself.',
    noEngine: 'Not connected to the Forsion engine (manual entries still work).',
    needLogin: 'Please sign in to Forsion first (manual entries still work).',
    savedTo: 'Saved to {path}',
    savedAsNew: 'The report was edited by hand, so it was saved as {path}',
    overwriteAsk: 'This report was edited by hand. Type y to overwrite, or leave empty to save a new version.',
    genFailed: 'Generation failed: {err}',
    fenceWarn: 'The model did not return the agreed fence; fell back to the full text — check the draft format.',
    scanTitle: 'Material this week',
    scan: 'Scan this week',
    scanning: 'Scanning…',
    retry: 'Retry',
    stats: 'Lines {total} | kept {kept} | plugin heartbeats {plugin} | other {other} | unparsable {unparsed}',
    selectAll: 'Select all',
    selectNone: 'Select none',
    manualTitle: 'Manual entries',
    manualPlaceholder: 'Something the log cannot see: a meeting, an alignment call…',
    add: 'Add',
    remove: 'Remove',
    emptySources: 'Nothing scanned for this week yet. Hit the button above, or add entries by hand.',
    weekTooOld: 'This week is past the 30-day activity-log retention; only archived reports remain.',
    scanUntrusted: 'The log read looks unreliable (too many unparsable lines). Retry, or add entries by hand.',
    scanned: 'Scanned {kept} items',
    manualBadge: 'manual',
    ev_note_edit: 'Note edited',
    ev_note_create: 'Note created',
    ev_view_open: 'Opened',
    ev_file_save: 'File saved',
    ev_chat_new: 'New chat',
    ev_chat_send: 'Message sent',
    ev_run_done: 'Run finished',
    ev_agent_edit: 'Agent edited a file',
    ev_manual: 'Manual entry',
    archiveTitle: 'Archive',
    refresh: 'Refresh',
    emptyArchive: 'No archived reports yet. Your first weekly report will show up here.',
    chars: '{n} chars',
    genAt: 'Generated {at}',
    genAtUnknown: 'Generation time unknown',
    diffTitle: 'Compared with last week',
    diffAdded: 'Added',
    diffGone: 'Gone',
    diffKept: 'Kept',
    diffNone: 'No previous-week report to compare with.',
    srcHeading: 'Sources',
    reportTitle: '{week} weekly report',
    reportMeta: '{from} ~ {to} | Template: {tpl} | Generated {at}',
    corrupt: 'The material sidecar was corrupt. The original bytes were backed up to {path} and a fresh one created.',
    sidecarUnreadable: 'The material sidecar could not be read, so this change was dropped rather than overwrite what is already in there.',
    saveFailed: 'Save failed: {err}',
    renderFailed: 'This panel failed to render. Switch the week once, or close and reopen it.',
    loadingText: 'Loading…',
    draftKept: 'The draft for {week} is still unsaved; it is kept in memory — switch back to that week to carry on.',
    overwriteAskUnread: 'The existing report could not be read (most likely a transient failure). Type y to overwrite it anyway, or leave empty to save a new version.',
    savedAsNewUnread: 'The existing report could not be read, so it was saved as {path} instead of overwriting it',
    sbNone: '{week} · no report',
    sbDone: '{week} · report ready',
    sbTitle: 'WorklogReporter: open the draft view',
    achSeries: 'WorklogReporter',
    achFirst: 'First report',
    achFirstDesc: 'Hand in your first weekly report built with WorklogReporter',
    achTen: 'Ten reports',
    achTenDesc: 'Generate ten weekly reports in total',
    achGrounded: 'Grounded',
    achGroundedDesc: 'Add twenty manual entries for things the log cannot see',
  },
}
const L = () => {
  try { return ctx.getLocale ? ctx.getLocale() : 'zh' } catch { return 'zh' }
}
/**
 * 占位符替换必须**单趟**正则(BRIEF 铁律)。逐个 split/join 是错的:先替进去的值会被后面那轮
 * 再扫一遍 —— 用户的数据里只要有个 `{tpl}` 之类的串,他自己的字就会被当占位符吃掉。
 * 未知键原样留着(`{n}` 保持 `{n}`),不许替成 undefined。
 */
function t(k, vars) {
  const d = MSG[L()] || MSG.zh
  const s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  return vars ? s.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m)) : s
}

// ── 设置(注册时刻语言;宿主贡献点标题是单字符串,切语言后要重启才跟上 —— 已知缺口)──
ctx.registerSetting({ key: 'template', label: t('setTemplate'), type: 'text', default: 'generic3', description: t('setTemplateDesc') })
ctx.registerSetting({ key: 'includeSources', label: t('setIncludeSources'), type: 'boolean', default: true, description: t('setIncludeSourcesDesc') })
ctx.registerSetting({ key: 'maxExcerptChars', label: t('setMaxExcerpt'), type: 'number', default: 1200, min: 0, max: 4000, description: t('setMaxExcerptDesc') })

// ── 小工具 ───────────────────────────────────────────────────────────────────
const say = (m, o) => {
  try {
    if (ctx.notify) ctx.notify(m, o)
    else if (ctx.app && ctx.app.notify) ctx.app.notify(m)
  } catch { /* 通知失败绝不牵连主流程 */ }
}
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const getLS = (k, d) => {
  try { const v = localStorage.getItem(`plugin.${PLUGIN_ID}.${k}`); return v == null ? d : v } catch { return d }
}
const setLS = (k, v) => {
  try { localStorage.setItem(`plugin.${PLUGIN_ID}.${k}`, String(v)) } catch { /* private mode */ }
}
const pad2 = (n) => String(n).padStart(2, '0')
const wfRoot = () => {
  try { return ctx.app && ctx.app.workFolder ? ctx.app.workFolder() : DEFAULT_FOLDER } catch { return DEFAULT_FOLDER }
}
const reportPath = (week) => `${wfRoot()}/${REPORTS_DIR}/${week}.md`
const sidecarPath = (week) => `${wfRoot()}/${SIDECAR_DIR}/${week}.json`
const corruptPath = (week, ms) => `${wfRoot()}/${SIDECAR_DIR}/${week}.corrupt-${ms}.json`
function safeHref(u) {
  const s = String(u == null ? '' : u).trim()
  return /^(https?:\/\/|#|mailto:)/i.test(s) ? s : ''
}
function templateById(id) {
  for (const tp of TEMPLATES) { if (tp.id === id) return tp }
  return TEMPLATES[0]
}
const currentTemplateId = () => {
  const v = String(getLS('template', 'generic3'))
  return templateById(v).id
}
function includeSourcesSetting() {
  return String(getLS('includeSources', 'true')) !== 'false'
}
function maxExcerptSetting() {
  const n = parseInt(String(getLS('maxExcerptChars', '1200')), 10)
  return Number.isFinite(n) ? Math.max(0, Math.min(4000, n)) : 1200
}

// ── 纯函数:哈希 / 时间 / 周 ─────────────────────────────────────────────────
/** FNV-1a 32bit → 8 位十六进制。稳定 id 与报告覆盖防线都靠它。 */
function fnv1a(s) {
  const str = String(s == null ? '' : s)
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
/** 日志 TS(YYYYMMDDHHmm,**本地时间**)→ 毫秒。用 Date.UTC 解析 = 全表错 8 小时。 */
function tsToMs(ts) {
  const s = String(ts == null ? '' : ts)
  if (!/^\d{12}$/.test(s)) return 0
  const y = Number(s.slice(0, 4)), mo = Number(s.slice(4, 6)), d = Number(s.slice(6, 8))
  const hh = Number(s.slice(8, 10)), mi = Number(s.slice(10, 12))
  return new Date(y, mo - 1, d, hh, mi, 0, 0).getTime()
}
function dayKeyOf(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function hhmmOf(ms) {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const stampOf = (ms) => `${dayKeyOf(ms)} ${hhmmOf(ms)}`
/** ISO 8601 周号(UTC 日序算,无 DST 因素),返回 "YYYY-Www"。 */
function isoWeekOf(dayKey) {
  const m = DAY_RE.exec(String(dayKey == null ? '' : dayKey))
  if (!m) return ''
  const t0 = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  t0.setUTCDate(t0.getUTCDate() + 3 - ((t0.getUTCDay() + 6) % 7)) // 本周的星期四决定 ISO 年
  const isoY = t0.getUTCFullYear()
  const week = Math.ceil(((t0.getTime() - Date.UTC(isoY, 0, 1)) / 86400000 + 1) / 7)
  return `${isoY}-W${pad2(week)}`
}
/** 周号 → 该周周一的日期 key(纯 UTC 日历算术,不受 DST 影响)。 */
function weekStart(week) {
  const m = WEEK_RE.exec(String(week == null ? '' : week))
  if (!m) return ''
  const y = Number(m[1]), w = Number(m[2])
  if (w < 1 || w > 53) return ''
  const jan4 = Date.UTC(y, 0, 4)
  const dow = (new Date(jan4).getUTCDay() + 6) % 7 // 0 = 周一
  const mon = jan4 - dow * 86400000 + (w - 1) * 7 * 86400000
  const d = new Date(mon)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
/** 该周 7 个日期 key。**正午锚定 ±24h**:凌晨起算会在春令日跳日(DST 定式一)。 */
function weekDays(week) {
  const start = weekStart(week)
  if (!start) return []
  const p = start.split('-').map(Number)
  const out = []
  for (let i = 0; i < 7; i++) {
    const ms = new Date(p[0], p[1] - 1, p[2], 12, 0, 0, 0).getTime() + i * 86400000
    out.push(dayKeyOf(ms))
  }
  return out
}
function shiftWeek(week, n) {
  const s = weekStart(week)
  if (!s) return ''
  const p = s.split('-').map(Number)
  const ms = Date.UTC(p[0], p[1] - 1, p[2]) + n * 7 * 86400000
  const d = new Date(ms)
  return isoWeekOf(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`)
}
const prevWeekOf = (week) => shiftWeek(week, -1)
const nextWeekOf = (week) => shiftWeek(week, 1)
const currentWeek = () => isoWeekOf(dayKeyOf(Date.now()))
/**
 * 逐周推出候选周号(归档路径自枚举的地基)。内部上限 260 周,超出直接截断,绝不写无界循环。
 * **从 to 往回推**:正着推的话,firstWeek 一旦超过 5 年,枚举出的是最老的 260 周,
 * 当前周反而不在里面 —— 归档列表会看不见刚写的那份周报。截断只许截老的那头。
 */
function weekSeq(from, to) {
  const a = weekStart(from), b = weekStart(to)
  if (!a || !b || a > b) return []
  const out = []
  let cur = isoWeekOf(b)
  let guard = 0
  while (cur && guard++ < 260) {
    out.push(cur)
    const s = weekStart(cur)
    if (!s || s <= a) break
    const pv = prevWeekOf(cur)
    if (!pv || pv === cur) break
    cur = pv
  }
  out.reverse()
  return out
}
/** 本地化日期呈现(计数不硬拼量词,靠词表分开)。 */
function localeDate(ms) {
  try { return new Date(ms).toLocaleDateString(L() === 'zh' ? 'zh-CN' : 'en-US') } catch { return dayKeyOf(ms) }
}

// ── 纯函数:活动日志解析 ────────────────────────────────────────────────────
/**
 * 行文法(逐字照抄 SPEC 的表,不许自行推断):
 *   line := TS SP EVENT ( SP PAIR )* ( SP FREETEXT )?
 *   TS := [0-9]{12}   EVENT := ^[a-z][a-z0-9:._-]*$
 *   PAIR := KEY '=' ( BARE | '"' QUOTED '"' )   KEY := [a-zA-Z][a-zA-Z0-9_]*
 *   BARE := 不含空白 / '"' / '=' 的串   QUOTED := 不含 '"' 的串(写端已把值内的 " 换成 ',无转义态)
 *   FREETEXT := '"' … '"',只可能在行尾
 * 写端硬上限 VALUE_CAP=80 / LINE_CAP=200 → 截断会产生未闭合引号:取到行尾、truncated:true、**照常入库**。
 */
function parseActivityLine(line) {
  const raw = String(line == null ? '' : line).replace(/\s+$/, '')
  if (!raw.trim()) return null
  const m = /^(\d{12})[ \t]+([a-z][a-z0-9:._-]*)(?:[ \t]+([\s\S]*))?$/.exec(raw)
  if (!m) return null
  const rest = m[3] == null ? '' : m[3]
  const kv = {}
  let text = ''
  let truncated = false
  let i = 0
  while (i < rest.length) {
    while (i < rest.length && rest.charAt(i) === ' ') i++
    if (i >= rest.length) break
    if (rest.charAt(i) === '"') {
      const end = rest.indexOf('"', i + 1)
      if (end < 0) { text = rest.slice(i + 1); truncated = true } else { text = rest.slice(i + 1, end) }
      break // FREETEXT 只可能在行尾
    }
    const pm = /^([a-zA-Z][a-zA-Z0-9_]*)=/.exec(rest.slice(i))
    if (!pm) break // 认不出的残片:丢弃行尾,已解析部分照常入库
    const key = pm[1]
    const j = i + pm[0].length
    if (j >= rest.length) { i = j; continue } // 尾巴是 `k=`,值被截没了 → 丢该键
    if (rest.charAt(j) === '"') {
      const end = rest.indexOf('"', j + 1)
      if (end < 0) { kv[key] = rest.slice(j + 1); truncated = true; i = rest.length; break }
      kv[key] = rest.slice(j + 1, end)
      i = end + 1
      continue
    }
    let k = j
    while (k < rest.length && rest.charAt(k) !== ' ') k++
    const v = rest.slice(j, k)
    if (v) kv[key] = v
    i = k
  }
  return { ts: m[1], event: m[2], kv, text, truncated }
}
/** 稳定 id 的规范化尾巴:键按字典序 `k=v` 拼接 + ' ' + 尾部文本(键序无关)。 */
function canonicalRest(p) {
  const keys = Object.keys(p.kv || {}).sort()
  const kvs = keys.map((k) => `${k}=${p.kv[k]}`).join(' ')
  return `${kvs} ${p.text == null ? '' : p.text}`
}
function linkOf(p) {
  if (VAULT_PATH_EVENTS.indexOf(p.event) < 0) return ''
  const f = p.kv && p.kv.f
  return f ? String(f) : ''
}
function itemFromParsed(p) {
  const ms = tsToMs(p.ts)
  return {
    id: `${p.ts}-${p.event}-${fnv1a(canonicalRest(p))}`,
    ts: Number(p.ts),
    ms,
    event: p.event,
    kv: p.kv,
    text: p.text || '',
    src: 'log',
    link: linkOf(p),
    picked: DEFAULT_PICK[p.event] === true,
    note: '',
    truncated: !!p.truncated,
  }
}
function manualItem(text, ms) {
  const s = String(text == null ? '' : text)
  return { id: `m-${ms}-${fnv1a(s)}`, ts: 0, ms, event: 'manual', kv: {}, text: s, src: 'manual', link: '', picked: true, note: '' }
}
const sortItems = (arr) => arr.sort((a, b) => (a.ms - b.ms) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
/**
 * 整批解析。**解析失败 ≠ 缺席**:同批其余行照常返回,unparsed 计数交给 UI 明示。
 * total = kept + droppedPlugin + droppedOther + unparsed(空行不计入任何一项)。
 * 两处家目录合并读回时的重复行按稳定 id 去重(items 去重,kept 计数保持行口径)。
 */
function parseActivityLog(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n')
  const stats = { total: 0, kept: 0, droppedPlugin: 0, droppedOther: 0, unparsed: 0 }
  const seen = new Set()
  const items = []
  for (const line of lines) {
    if (!line.trim()) continue
    stats.total += 1
    const p = parseActivityLine(line)
    if (!p) { stats.unparsed += 1; continue }
    if (p.event.indexOf('plugin:') === 0) { stats.droppedPlugin += 1; continue }
    if (ALLOW.indexOf(p.event) < 0) { stats.droppedOther += 1; continue }
    stats.kept += 1
    const it = itemFromParsed(p)
    if (seen.has(it.id)) continue
    seen.add(it.id)
    items.push(it)
  }
  sortItems(items)
  return { items, stats }
}
/**
 * 重扫合流:manual 一条不丢(用户数据,不是派生物);id 命中的 log 沿用旧 picked/note;
 * fresh 里没有的 log 移除(日志过期/被 prune 了就是没了);新条取默认勾选;按 ms 升序稳定排序。
 */
function mergeItems(oldItems, freshItems) {
  const prev = new Map()
  for (const it of oldItems || []) { if (it && it.id) prev.set(it.id, it) }
  const out = []
  for (const f of freshItems || []) {
    const o = prev.get(f.id)
    if (o && o.src === 'log') out.push({ ...f, picked: !!o.picked, note: String(o.note == null ? '' : o.note) })
    else out.push({ ...f })
  }
  for (const o of oldItems || []) { if (o && o.src === 'manual') out.push({ ...o }) }
  return sortItems(out)
}

// ── 纯函数:报告归一 / diff ─────────────────────────────────────────────────
const RULE_LINE = /^(-{3,}|\*{3,}|_{3,})$/
/**
 * 去 \r、剔块标记行、去行尾空白、折叠连续空行、在**插件自己写的**素材出处段处截断。
 *
 * ⚠️锚点是永不改的字面量,但正文里**恰好**出现一行 `## 素材出处` 是完全可能的(用户手写、
 * 或模型多给了一个)。若见锚点就截,其后正文会在下次打开草稿时被静默吃掉,再保存一次就永久没了。
 * 判据:composeReportFile 写出处段时必定先写一条 `---`(它是插件的签名),所以只有
 * **紧邻分隔线**的锚点才算插件写的;有多个合格锚点时取**最后一个**(插件那段永远在文件最后)。
 * 分隔线本身也一并剔掉 —— 否则「打开草稿 → 再保存」每轮都会多堆一条 ---(见 reportBodyForInsert)。
 * 块标记行先剔再判:Amadeus 可能把 `<!-- a N -->` 落在分隔线与锚点之间,照原始行判会失守。
 */
function normalizeReport(text) {
  const raw = String(text == null ? '' : text).replace(/\r/g, '')
  const kept = []
  let cutAt = -1
  for (const line of raw.split('\n')) {
    if (MARKER_LINE.test(line)) continue
    const trimmed = line.replace(/\s+$/, '')
    const body = trimmed.trim()
    if (body === SRC_H_ZH || body === SRC_H_EN) {
      let p = kept.length - 1
      while (p >= 0 && !kept[p].trim()) p--
      if (p >= 0 && RULE_LINE.test(kept[p].trim())) cutAt = p
    }
    kept.push(trimmed)
  }
  const lines = cutAt >= 0 ? kept.slice(0, cutAt) : kept
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
}
function reportBullets(text) {
  const out = []
  for (const line of normalizeReport(text).split('\n')) {
    const m = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (!m) continue
    const s = m[1].trim()
    if (s) out.push(s)
  }
  return out
}
/** 上周 → 本周的条目 diff(块标记行与素材出处段已被 normalizeReport 排除)。 */
function diffReports(prev, cur) {
  const a = reportBullets(prev), b = reportBullets(cur)
  const sa = new Set(a), sb = new Set(b)
  const uniq = (arr) => Array.from(new Set(arr))
  return {
    added: uniq(b.filter((x) => !sa.has(x))),
    gone: uniq(a.filter((x) => !sb.has(x))),
    kept: uniq(b.filter((x) => sa.has(x))),
  }
}
/** 报告头部元信息(归档列表用;不读 sidecar → 自枚举断言的 readFile 集合才干净)。 */
function parseReportMeta(text) {
  const raw = String(text == null ? '' : text).replace(/\r/g, '')
  let generatedAt = ''
  for (const line of raw.split('\n')) {
    if (line.charAt(0) !== '>') continue
    const m = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*$/.exec(line.replace(/\s+$/, ''))
    if (m) generatedAt = m[1]
    break
  }
  return { generatedAt, chars: normalizeReport(raw).length }
}

// ── 纯函数:发给模型的指令段(一律英文)────────────────────────────────────
/** Run A:唯一需要 host 工具的地方。只读死限 + 逐字回抄纪律 = 可靠性命门。 */
function buildScanMessage(days) {
  const ds = (days || []).map((d) => String(d))
  const paths = []
  for (const d of ds) {
    paths.push(`~/.forsion/activity/${d}.log`)
    paths.push(`~/.forsion-dev/activity/${d}.log`)
  }
  return [
    'Task: read this week\'s local Forsion activity log files and copy their contents back to me.',
    '',
    'Files to read (both home directories; missing files are normal):',
    paths.map((p) => `- ${p}`).join('\n'),
    '',
    'Use only run_bash. Read-only: never write, move, delete, or modify any file. Do not read anything outside these two activity directories. Do not run any command other than cat/ls on those exact paths.',
    '',
    'Copy the command output verbatim, byte for byte, inside one fenced block tagged worklog-raw. Do not summarize, translate, reorder, deduplicate, reformat, or omit any line. Missing files are normal - skip them silently.',
    `If the output exceeds ${SCAN_LINE_CAP} lines, include the first ${SCAN_LINE_CAP} lines and then a final line "#TRUNCATED <n>".`,
    '',
    'Output nothing except that single fenced block.',
  ].join('\n')
}
/** 片段封顶:单篇 per,全周合计 total;超出按被勾选条目引用次数降序取前几篇,其余只列路径。 */
function capExcerpts(excerpts, refs, per, total) {
  const perCap = Math.max(0, Number(per) || 0)
  const totalCap = Math.max(0, Number(total) || 0)
  const paths = Object.keys(excerpts || {})
  const rank = (p) => ((refs && refs[p]) || 0)
  paths.sort((a, b) => (rank(b) - rank(a)) || (a < b ? -1 : a > b ? 1 : 0))
  const out = {}
  const omitted = []
  let used = 0
  for (const p of paths) {
    const body = String(excerpts[p] == null ? '' : excerpts[p]).slice(0, perCap)
    if (!body || used + body.length > totalCap) { omitted.push(p); continue }
    out[p] = body
    used += body.length
  }
  return { excerpts: out, omitted, used }
}
function itemLineForModel(it) {
  const when = it.ms ? stampOf(it.ms) : ''
  if (it.src === 'manual') return `- ${when} (manual entry) ${it.text}`
  const bits = []
  const keys = Object.keys(it.kv || {}).sort()
  for (const k of keys) bits.push(`${k}=${it.kv[k]}`)
  const tail = it.text ? ` "${it.text}"` : ''
  const note = it.note ? ` (user note: ${it.note})` : ''
  return `- ${when} ${it.event} ${bits.join(' ')}${tail}${note}`
}
/** Run B:纯文本生成,无工具、无 agentSlug。英文指令 + 用户数据原样(中文素材不翻译)。 */
function buildComposeMessage(items, excerpts, templateId, locale, opts) {
  const tp = templateById(templateId)
  const lang = locale === 'en' ? 'en' : 'zh'
  const sections = tp[lang].sections
  const per = opts && opts.per != null ? opts.per : maxExcerptSetting()
  const total = opts && opts.total != null ? opts.total : EXCERPT_TOTAL_CAP
  const picked = (items || []).filter((it) => it && it.picked)
  const refs = {}
  for (const it of picked) { if (it.link) refs[it.link] = (refs[it.link] || 0) + 1 }
  const capped = capExcerpts(excerpts || {}, refs, per, total)
  const out = []
  out.push('You are drafting a weekly work report from the user\'s own local activity data.')
  out.push('')
  out.push(`Use exactly these sections, in this order, as level-2 markdown headings: ${sections.map((s) => `"${s}"`).join(', ')}.`)
  out.push('')
  out.push('Every bullet must be grounded in the provided material. Never invent projects, metrics, dates, or names. If a section has no material, write one short line saying so.')
  out.push('')
  out.push('Return exactly one fenced block tagged worklog containing the report body in Markdown. Start at the "##" section headings - do not include an H1 title, front matter, or any text outside the fence.')
  out.push('')
  out.push(locale === 'en' ? 'Respond in English.' : 'Respond in Chinese.')
  out.push('')
  out.push('--- MATERIAL (raw activity records the user ticked; keep their original language) ---')
  out.push(picked.length ? picked.map(itemLineForModel).join('\n') : '(none)')
  const keys = Object.keys(capped.excerpts)
  if (keys.length) {
    out.push('')
    out.push('--- NOTE EXCERPTS (truncated; do not assume anything beyond them) ---')
    for (const p of keys) {
      out.push(`### ${p}`)
      out.push(capped.excerpts[p])
    }
  }
  if (capped.omitted.length) {
    out.push('')
    out.push(`--- FILES TOUCHED BUT NOT EXCERPTED (paths only) ---\n${capped.omitted.map((p) => `- ${p}`).join('\n')}`)
  }
  return out.join('\n')
}
/** 取 ```worklog 围栏(贪婪到最后一个围栏 → 内嵌代码块原样保留);缺围栏则回退全文并置 fallback。 */
function parseAgentOutput(text) {
  const raw = String(text == null ? '' : text)
  const m = /```worklog[^\S\n]*\n([\s\S]*)```/.exec(raw)
  if (m) return { body: m[1].replace(/\s+$/, ''), fallback: false }
  const stripped = raw.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return { body: stripped || raw.trim(), fallback: true }
}
/** 取 ```worklog-raw 围栏,顺手丢掉模型追加的 #TRUNCATED 行(它不是日志行)。 */
function extractRawFence(text) {
  const raw = String(text == null ? '' : text)
  const m = /```worklog-raw[^\S\n]*\n([\s\S]*)```/.exec(raw)
  const body = m ? m[1] : ''
  return body.split('\n').filter((l) => l.indexOf('#TRUNCATED') !== 0).join('\n')
}

// ── 纯函数:报告文件组装 ────────────────────────────────────────────────────
function sourceLine(it) {
  const when = it.ms ? stampOf(it.ms) : ''
  if (it.src === 'manual') return `- ${when} (${t('manualBadge')}) ${it.text}`
  const bits = []
  if (it.link) bits.push(`[[${it.link}]]`)
  else if (it.kv && it.kv.f) bits.push(String(it.kv.f)) // agent.edit 的项目路径:纯文本,不给回链
  if (it.kv && it.kv.l) bits.push(`L${it.kv.l}`)
  if (it.text) bits.push(L() === 'zh' ? `「${it.text}」` : `"${it.text}"`)
  // 兜底:没标题也没文件的行(如尾部文本为空的 chat.new / run.done)至少留下会话 id,
  // 否则报告里会出现一条只有时间和事件名的空出处(实测真日志里确实有这种行)。
  if (!bits.length && it.kv && it.kv.s) bits.push(`s=${it.kv.s}`)
  return `- ${when} \`${it.event}\` ${bits.join(' ')}`.replace(/\s+$/, '')
}
function composeReportFile(week, body, items, tplId, at) {
  const days = weekDays(week)
  const tp = templateById(tplId)
  const tplName = tp[L() === 'en' ? 'en' : 'zh'].name
  const parts = []
  parts.push(`# ${t('reportTitle', { week })}`)
  parts.push('')
  parts.push(`> ${t('reportMeta', { from: days[0] || '', to: days[6] || '', tpl: tplName, at: stampOf(at) })}`)
  parts.push('')
  parts.push(String(body == null ? '' : body).replace(/\s+$/, ''))
  const picked = (items || []).filter((it) => it && it.picked)
  if (includeSourcesSetting() && picked.length) {
    parts.push('')
    parts.push('---')
    parts.push('')
    parts.push(`## ${t('srcHeading')}`)
    parts.push('')
    for (const it of picked) parts.push(sourceLine(it))
  }
  parts.push('')
  return parts.join('\n')
}
function templateSkeleton(tplId) {
  const tp = templateById(tplId)
  const sections = tp[L() === 'en' ? 'en' : 'zh'].sections
  return sections.map((s) => `## ${s}\n\n- `).join('\n\n')
}
/** 报告文件 → 可编辑正文:剥掉 H1、其后的元信息引用行、以及「素材出处」段。
 *  这三样都由 composeReportFile 每次保存时重新生成 —— 不剥就会「打开 → 保存」一轮堆一份
 *  (元信息行与分隔线会无限累积,直接污染用户的报告)。compose 视图与斜杠项共用它。 */
function reportBodyForInsert(text) {
  const lines = normalizeReport(text).split('\n')
  while (lines.length && (!lines[0].trim() || /^#\s+/.test(lines[0]) || /^>\s/.test(lines[0]))) lines.shift()
  return lines.join('\n').replace(/\s+$/, '')
}

// ── 文件 IO(全走 ctx.app,vault 相对路径)+ 串行写队列 ────────────────────
let writeChain = Promise.resolve()
/** 读-改-写全程排队:并发落库 / 视图变更绝不互相覆盖。**禁止嵌套 enqueueWrite**(会自死锁)。 */
function enqueueWrite(job) {
  const p = writeChain.then(job)
  writeChain = p.then(() => {}, () => {})
  return p
}
async function readFileSafe(path) {
  try {
    const v = await ctx.app.readFile(path)
    return v == null ? null : String(v)
  } catch { return null }
}
/**
 * **「读回 null」= 文件不存在 ∪ 读失败**,插件这一层区分不了 —— 宿主的 readTextFile 自己
 * `catch { return null }`,并且没有活动库时也直接给 null。而 sidecar 里装的是用户手工补录
 * (不是派生缓存),读失败后照常读-改-写 = 读失败 + 写成功 = 用户数据没了。
 * 于是记一条**高水位**:某周的 sidecar 只要被成功读到过 / 被我们写下过非空 items 就记下来。
 * - 非空读 / 任何一次成功写 → 记(写可升可降:那一刻我们确知磁盘状态);
 * - 读回 null → **绝不改这条记录**,并据它判定「这是读失败,不是缺席」。
 */
const seenItems = new Map()
const markSeen = (week, sc) => { seenItems.set(week, sc && Array.isArray(sc.items) ? sc.items.length : 0) }
const wasNonEmpty = (week) => (seenItems.get(week) || 0) > 0
function emptySidecar(week) {
  const days = weekDays(week)
  return {
    v: 1,
    week,
    range: { from: days[0] || '', to: days[6] || '' },
    scannedAt: 0,
    template: currentTemplateId(),
    items: [],
    stats: { total: 0, kept: 0, droppedPlugin: 0, droppedOther: 0, unparsed: 0 },
    excerpts: {},
    report: null,
  }
}
function normalizeSidecar(j, week) {
  const days = weekDays(week)
  const base = {
    ...j, // 未知顶层键原样保留(前向兼容:新版加字段,旧版重写不该抹掉)
    v: 1,
    week,
    range: j.range && j.range.from ? j.range : { from: days[0] || '', to: days[6] || '' },
    scannedAt: Number(j.scannedAt) || 0,
    template: j.template || currentTemplateId(),
    items: Array.isArray(j.items) ? j.items.filter((x) => x && x.id) : [],
    stats: j.stats && typeof j.stats === 'object' ? j.stats : { total: 0, kept: 0, droppedPlugin: 0, droppedOther: 0, unparsed: 0 },
    excerpts: j.excerpts && typeof j.excerpts === 'object' ? j.excerpts : {},
    report: j.report && typeof j.report === 'object' ? j.report : null,
  }
  return base
}
/**
 * 读素材档案,连同**这次读的性质**一起返回(调用方据此决定敢不敢写):
 *   ok      读到了合法 JSON;   absent  读回 null(不存在 ∪ 读失败,分不清);
 *   rebuilt 原字节已备份 + 已重建空档案(可以放心写:旧字节还在备份里)。
 * **JSON 损坏 ≠ 缺席**(这里含用户手工补录,不是纯派生缓存):先把原字节写到
 * <week>.corrupt-<epochms>.json,**备份写成功之后**才重建空档案并告知路径。绝不静默当缺席。
 * 空串也走这条路 —— 本插件从不写 0 字节 sidecar,读到空串多半是写到一半崩了,按损坏备份掉最安全。
 * 不入写队列(调用方在队列里用它,嵌套会死锁)。
 */
async function readSidecarMeta(week) {
  const raw = await readFileSafe(sidecarPath(week))
  if (raw == null) return { sc: emptySidecar(week), status: 'absent' }
  let j = null
  try { j = JSON.parse(raw) } catch { j = null }
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) {
    const bak = corruptPath(week, Date.now())
    await ctx.app.writeFile(bak, raw) // 抛出即中止:没备份成功就绝不重建
    const fresh = emptySidecar(week)
    await ctx.app.writeFile(sidecarPath(week), JSON.stringify(fresh, null, 2))
    markSeen(week, fresh)
    say(t('corrupt', { path: bak }), { level: 'warning' })
    return { sc: fresh, status: 'rebuilt' }
  }
  const sc = normalizeSidecar(j, week)
  if (sc.items.length) markSeen(week, sc)
  return { sc, status: 'ok' }
}
async function readSidecarRaw(week) {
  return (await readSidecarMeta(week)).sc
}
async function readSidecarSafe(week) {
  try { return await readSidecarRaw(week) } catch { return emptySidecar(week) }
}
async function writeSidecarRaw(week, sc) {
  await ctx.app.writeFile(sidecarPath(week), JSON.stringify(sc, null, 2))
  markSeen(week, sc) // 写成功 = 这一刻我们确知磁盘状态,高水位可升可降
}
/** 读失败判定:读回 null,而这周的档案我们**确知**非空过 → 只能是读失败。 */
const sidecarUnreadable = (week, status) => (status === 'absent' || status === 'error') && wasNonEmpty(week)
function unreadableError() {
  const err = new Error(t('sidecarUnreadable'))
  err.wlCode = 'unreadable'
  return err
}
/** 任何一次写都**先重读 sidecar** 再改(读-改-写整段排队)。
 *  **绝不由空覆盖非空**:读失败时放弃这次写并抛出,由调用方提示用户(宁可丢一次勾选,不丢补录)。 */
function updateSidecar(week, mutate) {
  return enqueueWrite(async () => {
    const meta = await readSidecarMeta(week)
    if (sidecarUnreadable(week, meta.status)) throw unreadableError()
    const next = (await mutate(meta.sc)) || meta.sc
    await writeSidecarRaw(week, next)
    return next
  })
}

// ── 归档自枚举(路径自枚举:不用 sidecar 索引、不用 Agent 扫库、不用 listPages)──
async function probeFirstWeek() {
  const cur = currentWeek()
  let earliest = ''
  let cursor = cur
  for (let i = 0; i < 104 && cursor; i++) {
    const txt = await readFileSafe(reportPath(cursor))
    if (txt != null) earliest = cursor
    cursor = prevWeekOf(cursor)
  }
  if (earliest) { setLS('firstWeek', earliest); return earliest }
  setLS('probedAt', String(Date.now()))
  return ''
}
async function listArchive() {
  const cur = currentWeek()
  let first = String(getLS('firstWeek', ''))
  if (!WEEK_RE.test(first)) {
    if (getLS('probedAt', '')) return [] // 一无所获过,不重复全量探测
    first = await probeFirstWeek()
    if (!first) return []
  }
  const out = []
  for (const w of weekSeq(first, cur)) {
    const txt = await readFileSafe(reportPath(w))
    if (txt == null) continue
    const meta = parseReportMeta(txt)
    out.push({ week: w, text: txt, chars: meta.chars, generatedAt: meta.generatedAt })
  }
  out.reverse() // 倒序:最近的在最上
  return out
}

// ── 引擎接入(同 desktop 的 agentRunService:POST /agent/runs + SSE /events)──
async function getCfg() {
  try {
    const w = globalThis.window
    const c = await (w && w.tangu && w.tangu.getConfig ? w.tangu.getConfig() : null)
    if (c && c.backendUrl) return { backendUrl: c.backendUrl, token: c.token || '', cwd: c.defaultWorkspaceDir || c.homeDir || '' }
  } catch { /* web 回退 */ }
  try {
    const loc = globalThis.location
    if (loc && loc.origin) return { backendUrl: `${loc.origin}/api`, token: localStorage.getItem('forsion_token') || '', cwd: '' }
  } catch { /* ignore */ }
  return { backendUrl: '', token: '', cwd: '' }
}
async function runAgent(cfg, sessionId, message, agentConfig, onTick, signal) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` }
  const body = { session_id: sessionId, app_id: APP_ID, message, attachments: [] }
  if (agentConfig) body.agent_config = agentConfig
  const start = await fetch(`${cfg.backendUrl}/agent/runs`, { method: 'POST', headers: h, signal, body: JSON.stringify(body) })
  if (!start.ok) throw new Error((await start.text().catch(() => '')) || `HTTP ${start.status}`)
  const started = await start.json()
  const runId = started && started.runId
  if (!runId) throw new Error('no runId')
  const res = await fetch(`${cfg.backendUrl}/agent/runs/${encodeURIComponent(runId)}/events?fromSeq=0`, { headers: h, signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', lastSeq = 0, content = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buf += dec.decode(chunk.value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() || ''
    for (const line of parts) {
      const s = line.trim()
      if (!s || s.charAt(0) === ':' || s.indexOf('data:') !== 0) continue
      const data = s.slice(5).replace(/^ /, '')
      if (!data) continue
      let ev = null
      try { ev = JSON.parse(data) } catch { continue }
      if (typeof ev.seq === 'number') {
        if (ev.seq <= lastSeq) continue
        lastSeq = ev.seq
      }
      if (ev.type === 'token') {
        const d = ev.payload && ev.payload.delta
        if (d) { content += d; if (onTick) onTick(content) }
        continue
      }
      if (ev.type === 'done') return (ev.payload && ev.payload.content) || content
      if (ev.type === 'error') throw new Error((ev.payload && ev.payload.error) || 'run failed')
    }
  }
  throw new Error('stream ended without done')
}

// ── 运行时状态(模块级:关掉视图状态照在,回来还在)────────────────────────
const state = {
  week: '',
  sidecar: null,
  draft: '',
  draftBase: null, // 本周报告在磁盘上的正文(判「草稿脏了没」的基准;null = 还没读过)
  manualDraft: '', // 手工补录输入框里没提交的那行(整树重渲 / 切语言 / 落盘失败都不许弄丢它)
  scanning: false,
  generating: false,
  scanError: '',
  genError: '',
  ioError: '',
  archive: null,
  archiveSel: '',
  loading: false,
}
const bus = (() => {
  const subs = new Set()
  return {
    on: (f) => { subs.add(f); return () => subs.delete(f) },
    emit: () => { for (const f of Array.from(subs)) { try { f() } catch { /* 单个视图重渲失败不牵连别的 */ } } },
  }
})()
let scanAbort = null
let genAbort = null
let mountSeq = 0
let archiveLoading = false
/** 切周时把**没保存的**草稿留在内存里(草稿只写 state.draft,loadWeek 无条件覆盖它 =
 *  用户手打半份周报点一下 ◀ 就归零)。切回该周即原样接着写;保存成功后这条记录作废。 */
const draftStash = new Map()

function ensureWeek() {
  if (!WEEK_RE.test(state.week)) state.week = currentWeek()
  return state.week
}
function stashDraft() {
  const w = state.week
  if (!WEEK_RE.test(w) || state.draftBase == null) return false
  const cur = String(state.draft || '')
  if (normalizeReport(cur) === normalizeReport(state.draftBase)) { draftStash.delete(w); return false }
  draftStash.set(w, cur)
  return true
}
async function loadWeek(week) {
  const dirty = stashDraft()
  const from = state.week
  state.week = week
  state.loading = true
  // 错误信息**不许跟着人走**:它们是上一周的结果,留在新周的顶上还带一个会去扫新周的重试按钮。
  state.scanError = ''
  state.genError = ''
  state.ioError = ''
  bus.emit()
  let meta = null
  try { meta = await readSidecarMeta(week) } catch { meta = { sc: emptySidecar(week), status: 'error' } }
  const rep = await readFileSafe(reportPath(week))
  if (state.week !== week) return // 期间用户又切了周:这次的结果整份作废,绝不串台
  if (sidecarUnreadable(week, meta.status)) state.ioError = t('sidecarUnreadable')
  state.sidecar = meta.sc
  const disk = rep == null ? '' : reportBodyForInsert(rep)
  state.draftBase = disk
  state.draft = draftStash.has(week) ? String(draftStash.get(week)) : disk
  state.loading = false
  if (dirty && from && from !== week) say(t('draftKept', { week: from }), { level: 'warning' })
  updateStatusItem()
  bus.emit()
}
function pickedItems() {
  const sc = state.sidecar
  return sc && Array.isArray(sc.items) ? sc.items.filter((it) => it && it.picked) : []
}
function allItems() {
  const sc = state.sidecar
  return sc && Array.isArray(sc.items) ? sc.items : []
}

// ── 扫描(Run A)────────────────────────────────────────────────────────────
async function scanWeek(week) {
  if (state.scanning) return
  // 过了 30 天保留期的周,日志文件已经没了 → 拿回空围栏会撞可信度闸,报「读取结果不可信,请重试」,
  // 而重试一万次也不会有。这里直说真相(按钮同时置灰),别让用户对着错误提示白试。
  if (isWeekBeyondRetention(week)) {
    state.scanError = t('weekTooOld')
    bus.emit()
    return
  }
  const cfg = await getCfg()
  if (!cfg.backendUrl || !cfg.token) {
    state.scanError = t(cfg.backendUrl ? 'needLogin' : 'noEngine')
    bus.emit()
    return
  }
  state.scanning = true
  state.scanError = ''
  bus.emit()
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  scanAbort = ctrl
  try {
    const msg = buildScanMessage(weekDays(week))
    const agentCfg = { execMode: 'host' }
    if (cfg.cwd) agentCfg.cwd = cfg.cwd
    const out = await runAgent(cfg, uuid(), msg, agentCfg, null, ctrl ? ctrl.signal : undefined)
    const raw = extractRawFence(out)
    const parsed = parseActivityLog(raw)
    const parsedCount = parsed.stats.kept + parsed.stats.droppedPlugin + parsed.stats.droppedOther
    const denom = parsed.stats.unparsed + parsedCount
    const untrusted = !raw.trim() || (denom > 0 && parsed.stats.unparsed / denom > 0.4)
    if (untrusted) {
      // 可信度闸:**不写 sidecar 的 items**,不许把可疑数据混进素材列表
      // (错误信息同样不许跟着人走:慢返回的 W33 失败落到正在显示的 W32 顶上,
      //  就又是「新周挂着上一周的错误 + 一个会去扫新周的重试按钮」)
      if (state.week === week) state.scanError = t('scanUntrusted')
      return
    }
    const next = await updateSidecar(week, (sc) => {
      sc.items = mergeItems(sc.items, parsed.items)
      sc.stats = parsed.stats
      sc.scannedAt = Date.now()
      return sc
    })
    if (ctx.activity && ctx.activity.log) ctx.activity.log('scan', { week })
    say(t('scanned', { kept: next.items.length }), { level: 'success' })
    if (state.week !== week) return // 慢返回的 W33 素材绝不许灌进正在显示 W32 的视图
    state.sidecar = next
  } catch (e) {
    const aborted = ctrl && ctrl.signal.aborted
    if (state.week === week) state.scanError = aborted ? '' : String((e && e.message) || e)
  } finally {
    state.scanning = false
    scanAbort = null
    bus.emit()
  }
}

// ── 生成(Run B)+ 落盘 ─────────────────────────────────────────────────────
// 复合后缀的画板 / 思维导图:磁盘上也以 .md 结尾,但正文是序列化 JSON。回读它们既白占掉
// 12000 字符的片段预算,又给模型一堆无意义 token(反编造纪律反而让它照抄那些 id)。
// 口径与宿主 shared/amadeus/builtinTypes.ts(.excalidraw.md)+ 外置思维导图捆绑包(.mindmap.md)一致。
// ⚠️**不许**用「双扩展名 = 非笔记」的启发式:真库里 `MOC-Tisy.fd/#杏雨 v11.7.4.md` 是正经笔记,会被误伤。
const NON_PROSE_MD = ['.excalidraw.md', '.mindmap.md']
function isProseNote(p) {
  const s = String(p == null ? '' : p).toLowerCase()
  if (!/\.md$/.test(s)) return false
  for (const ext of NON_PROSE_MD) { if (s.endsWith(ext)) return false }
  return true
}
async function collectExcerpts(items) {
  const per = maxExcerptSetting()
  const out = {}
  if (per <= 0) return out
  const paths = []
  for (const it of items) {
    if (!it.link || !isProseNote(it.link)) continue
    if (paths.indexOf(it.link) < 0) paths.push(it.link)
  }
  for (const p of paths) {
    const txt = await readFileSafe(p)
    if (txt == null) continue // agent.edit 的项目路径必然 null —— 这不是错误
    out[p] = txt.slice(0, per)
  }
  return out
}
async function nextVersionPath(week) {
  for (let n = 2; n < 50; n++) {
    const p = `${wfRoot()}/${REPORTS_DIR}/${week}-v${n}.md`
    if ((await readFileSafe(p)) == null) return p
  }
  return `${wfRoot()}/${REPORTS_DIR}/${week}-v${Date.now()}.md`
}
/**
 * 报告覆盖防线,三分支(**读失败绝不许把防线整条绕过**):
 *   ① 读到了 + hash 相符 → 直接覆盖(用户没改过,或只是被 Amadeus 落了块标记);
 *   ② 读到了 + hash 不符 → 用户手改过:prompt 要 y 才覆盖,否则写 -v2(序号自增);
 *   ③ **读回 null 而 sidecar 明写「这个路径我们写过」** → 自相矛盾,只可能是读失败,
 *      按 ② 同一条路径处理(不确认就另存),否则用户手写的整段周报会被无提示覆盖。
 */
async function saveReport(week, body, tplId) {
  return enqueueWrite(async () => {
    const sc = await readSidecarRaw(week)
    const path = reportPath(week)
    const cur = await readFileSafe(path)
    const known = !!(sc.report && sc.report.hash)
    const unreadable = cur == null && known
    const edited = cur != null && known && fnv1a(normalizeReport(cur)) !== sc.report.hash
    let target = path
    let renamed = false
    let reason = ''
    if (unreadable || edited) {
      reason = unreadable ? 'unreadable' : 'edited'
      let ans = null
      try { ans = ctx.app.prompt ? await ctx.app.prompt(t(unreadable ? 'overwriteAskUnread' : 'overwriteAsk'), '') : null } catch { ans = null }
      if (String(ans == null ? '' : ans).trim().toLowerCase() !== 'y') {
        target = await nextVersionPath(week)
        renamed = true
      }
    }
    const at = Date.now()
    const text = composeReportFile(week, body, sc.items, tplId, at)
    const firstForWeek = !(sc.report && sc.report.generatedAt)
    await ctx.app.writeFile(target, text)
    if (!renamed) {
      sc.report = { generatedAt: at, hash: fnv1a(normalizeReport(text)), chars: normalizeReport(text).length }
      sc.template = tplId
      await writeSidecarRaw(week, sc)
      if (state.week === week) state.sidecar = sc
    }
    if (!WEEK_RE.test(String(getLS('firstWeek', '')))) setLS('firstWeek', week)
    return { path: target, renamed, reason, first: firstForWeek && !renamed }
  })
}
async function generateDraft(week) {
  if (state.generating) return null
  const cfg = await getCfg()
  if (!cfg.backendUrl || !cfg.token) {
    state.genError = t(cfg.backendUrl ? 'needLogin' : 'noEngine')
    bus.emit()
    return null
  }
  state.generating = true
  state.genError = ''
  bus.emit()
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  genAbort = ctrl
  try {
    const items = pickedItems()
    const excerpts = await collectExcerpts(items)
    const tplId = currentTemplateId()
    const msg = buildComposeMessage(allItems(), excerpts, tplId, L())
    const out = await runAgent(cfg, uuid(), msg, null, null, ctrl ? ctrl.signal : undefined)
    const parsed = parseAgentOutput(out)
    if (parsed.fallback) say(t('fenceWarn'), { level: 'warning' })
    // 模型产出是这一趟最贵的东西:先接住它(切周了就只回值不上屏),再去动 sidecar;
    // sidecar 写失败(如读失败闸拦下)只提示,绝不连草稿一起丢。
    if (state.week === week) state.draft = parsed.body
    try {
      await updateSidecar(week, (sc) => {
        sc.excerpts = excerpts
        sc.template = tplId
        return sc
      })
      if (state.week === week) state.sidecar = await readSidecarSafe(week)
    } catch (e2) {
      say(e2 && e2.wlCode ? e2.message : t('saveFailed', { err: String((e2 && e2.message) || e2) }), { level: 'error' })
    }
    if (ctx.activity && ctx.activity.log) ctx.activity.log('generate', { week })
    return parsed.body
  } catch (e) {
    const aborted = ctrl && ctrl.signal.aborted
    // 同上:失败信息只许落在**仍在显示那一周**的视图上
    if (state.week === week) state.genError = aborted ? '' : t('genFailed', { err: String((e && e.message) || e) })
    return null
  } finally {
    state.generating = false
    genAbort = null
    bus.emit()
  }
}
async function saveCurrentDraft(week) {
  if (!String(state.draft || '').trim()) { say(t('draftEmpty'), { level: 'warning' }); return null }
  try {
    const body = String(state.draft || '')
    const r = await saveReport(week, body, currentTemplateId())
    if (!r.renamed) say(t('savedTo', { path: r.path }), { level: 'success' })
    else say(t(r.reason === 'unreadable' ? 'savedAsNewUnread' : 'savedAsNew', { path: r.path }), { level: 'success' })
    // 成就计在**落盘成功**之后,且只认这一周的第一份 —— 计在 generateDraft 里的话,
    // 同一周反复点「生成草稿」就能把「十份周报」刷满,失败落盘也照样计数。
    if (r.first && ctx.achievements && ctx.achievements.track) ctx.achievements.track('report', 1)
    if (state.week === week) { state.draftBase = body; draftStash.delete(week) }
    state.archive = null // 置空即失效;真正的重新加载由 renderArchive 的「加载中」分支自己发起
    updateStatusItem()
    bus.emit()
    return r.path
  } catch (e) {
    say(e && e.wlCode ? e.message : t('saveFailed', { err: String((e && e.message) || e) }), { level: 'error' })
    return null
  }
}

// ── 安全渲染:Markdown → DOM(只 createElement + textContent)─────────────
function inlineMd(text) {
  const frag = document.createDocumentFragment()
  let rest = String(text == null ? '' : text)
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\n]+)\*/
  let m = re.exec(rest)
  while (m) {
    if (m.index > 0) frag.appendChild(document.createTextNode(rest.slice(0, m.index)))
    if (m[1] != null) {
      const b = document.createElement('strong'); b.textContent = m[1]; frag.appendChild(b)
    } else if (m[2] != null) {
      const c = document.createElement('code'); c.textContent = m[2]; frag.appendChild(c)
    } else if (m[3] != null) {
      const w = document.createElement('span'); w.className = 'wl-lnk'; w.textContent = m[3]
      const target = m[3]
      w.addEventListener('click', () => openVaultFile(target))
      frag.appendChild(w)
    } else if (m[4] != null) {
      const a = document.createElement('a'); a.textContent = m[4]
      const href = safeHref(m[5])
      if (href) {
        a.setAttribute('href', href)
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
      }
      frag.appendChild(a)
    } else if (m[6] != null) {
      const e = document.createElement('em'); e.textContent = m[6]; frag.appendChild(e)
    }
    rest = rest.slice(m.index + m[0].length)
    m = re.exec(rest)
  }
  if (rest) frag.appendChild(document.createTextNode(rest))
  return frag
}
function renderMarkdown(container, md) {
  container.textContent = ''
  const lines = String(md == null ? '' : md).replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let para = []
  let list = null
  const flushPara = () => {
    if (!para.length) return
    const p = document.createElement('p')
    p.appendChild(inlineMd(para.join(' ')))
    container.appendChild(p)
    para = []
  }
  const flushList = () => {
    if (!list) return
    container.appendChild(list)
    list = null
  }
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, '').trim()
    if (/^```/.test(line)) {
      flushPara(); flushList()
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++ }
      i++
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = buf.join('\n')
      pre.appendChild(code)
      container.appendChild(pre)
      continue
    }
    if (!line || MARKER_LINE.test(line)) { flushPara(); flushList(); i++; continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara(); flushList()
      const el2 = document.createElement(`h${Math.min(4, h[1].length)}`)
      el2.appendChild(inlineMd(h[2]))
      container.appendChild(el2)
      i++
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara(); flushList()
      container.appendChild(document.createElement('hr'))
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      flushPara(); flushList()
      const bq = document.createElement('blockquote')
      bq.appendChild(inlineMd(line.replace(/^>\s?/, '')))
      container.appendChild(bq)
      i++
      continue
    }
    const li = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      flushPara()
      if (!list) list = document.createElement('ul')
      const item = document.createElement('li')
      item.appendChild(inlineMd(li[1]))
      list.appendChild(item)
      i++
      continue
    }
    flushList()
    para.push(line)
    i++
  }
  flushPara(); flushList()
}
/** 复合后缀 `.x.md` = 插件自定义文件类型的**规定形态**(主进程只收这一形),这类必须走 openFile;
 *  裸 `.md` 是普通笔记。 */
const COMPOUND_MD = /\.[a-z0-9-]+\.md$/i
/** 打开库里的一个文件。
 *  ⚠️ 裸 `.md` 笔记必须走 loadPage —— 宿主的 openFile 对「没有插件文件类型认领的」.md 会回落到
 *     amadeus.openVaultFile() = **交给系统默认程序**(周报会在 TextEdit 里弹出来)。
 *     真源:desktop/frontend/src/amadeusNav.ts:215-217 `if (!matchFileType(path)) openVaultFile(path)`。
 *  ⚠️ 反过来,`.excalidraw.md` / `.mindmap.md` 这类复合后缀**绝不能**走 loadPage —— 那会把插件
 *     文件当普通笔记导进 v3 = 毁档。所以这里按后缀形态分流,而不是一刀切。
 *  ⚠️ loadPage 对不存在的路径会凭空造出一篇空白笔记,调用点必须是「已落盘 / 已在索引里」的路径。
 *  旧宿主没有 loadPage 时才退回 openFile(那种宿主上没有更好的路)。 */
function openVaultFile(path) {
  const p = String(path == null ? '' : path).trim()
  if (!p) return
  try {
    if (/\.md$/i.test(p) && !COMPOUND_MD.test(p) && ctx.app && typeof ctx.app.loadPage === 'function') { ctx.app.loadPage(p); return }
    if (ctx.app && ctx.app.openFile) ctx.app.openFile(p)
  } catch { /* 打不开不算错误 */ }
}

// ── DOM 小helper + 样式 ──────────────────────────────────────────────────────
function h(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = String(text)
  return n
}
function btn(label, cls, onClick, tag) {
  const b = document.createElement('button')
  b.className = `wl-btn${cls ? ' ' + cls : ''}`
  b.textContent = label
  if (tag) b.setAttribute('data-act', tag)
  b.addEventListener('click', onClick)
  return b
}
const STYLE = `
.wl-root{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit;background:var(--bg, #ffffff);font-size:13px;line-height:1.55}
.wl-root *{box-sizing:border-box}
.wl-hd{flex:0 0 auto;display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:11px 16px;border-bottom:1px solid var(--border, #e6e6e6)}
.wl-ttl{font-size:15px;font-weight:600;color:var(--text, #1c1c1c);margin-right:4px}
.wl-body{flex:1;min-height:0;overflow:auto;padding:14px 16px}
.wl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wl-row.sp{margin:10px 0}
.wl-btn{padding:6px 12px;font:inherit;font-size:12.5px;color:var(--text, #1c1c1c);background:var(--bg-card, #ffffff);border:1px solid var(--border, #e6e6e6);border-radius:var(--radius-md, 10px);cursor:pointer;white-space:nowrap}
.wl-btn:hover:not(:disabled){background:var(--accent-light, rgba(0,0,0,.06))}
.wl-btn:disabled{opacity:.55;cursor:default}
.wl-btn.primary{color:var(--on-accent, #fbfbfa);background:var(--accent, #4c2585);border-color:transparent;font-weight:500}
.wl-btn.sm{padding:3px 9px;font-size:11.5px;border-radius:var(--radius-sm, 7px)}
.wl-chip{padding:4px 12px;font:inherit;font-size:12px;border-radius:999px;border:1px solid var(--border, #e6e6e6);background:var(--bg-card, #ffffff);color:var(--text, #1c1c1c);cursor:pointer}
.wl-chip.on{background:var(--accent-light, rgba(0,0,0,.08));border-color:var(--accent, #4c2585);color:var(--accent, #4c2585);font-weight:600}
.wl-week{font-variant-numeric:tabular-nums;font-weight:600;font-size:14px;color:var(--text, #1c1c1c)}
.wl-muted{color:var(--text-muted, #6b6b6b);font-size:12px}
.wl-card{border:1px solid var(--border, #e6e6e6);border-radius:var(--radius-md, 10px);background:var(--bg-card, #ffffff);padding:11px 13px;margin-bottom:11px}
.wl-ta{display:block;width:100%;min-height:260px;padding:11px 13px;font:inherit;font-size:13px;line-height:1.7;color:var(--text, #1c1c1c);background:var(--bg-card, #ffffff);border:1px solid var(--border, #e6e6e6);border-radius:var(--radius-md, 10px);outline:none;resize:vertical}
.wl-in{flex:1;min-width:150px;padding:7px 11px;font:inherit;font-size:12.5px;color:var(--text, #1c1c1c);background:var(--bg-card, #ffffff);border:1px solid var(--border, #e6e6e6);border-radius:var(--radius-md, 10px);outline:none}
.wl-ev{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:1px 6px;border-radius:5px;background:var(--overlay-medium, rgba(0,0,0,.07));color:var(--text-muted, #6b6b6b);white-space:nowrap}
.wl-day{margin:15px 0 5px;font-size:11.5px;font-weight:700;letter-spacing:.05em;color:var(--text-muted, #6b6b6b)}
.wl-item{display:flex;gap:9px;align-items:flex-start;padding:6px 2px;border-bottom:1px solid var(--border, #ededed)}
.wl-item .mid{flex:1;min-width:0}
.wl-t{font-variant-numeric:tabular-nums;color:var(--text-muted, #6b6b6b);font-size:11.5px;flex:0 0 auto;padding-top:2px}
.wl-lnk{color:var(--accent, #4c2585);cursor:pointer;text-decoration:underline;text-underline-offset:2px;word-break:break-all}
.wl-txt{color:var(--text, #1c1c1c);word-break:break-word}
.wl-empty{padding:26px 10px;text-align:center;color:var(--text-muted, #6b6b6b);font-size:12.5px}
.wl-hint{margin:5px 0;color:var(--text-muted, #6b6b6b);font-size:12.5px}
.wl-err{color:var(--danger, #a3503f);font-size:12.5px;margin:7px 0}
.wl-diff{display:flex;gap:14px;flex-wrap:wrap}
.wl-col{flex:1;min-width:170px}
.wl-colh{font-size:11.5px;font-weight:700;color:var(--text-muted, #6b6b6b);margin-bottom:5px}
.wl-arow{display:flex;gap:9px;align-items:baseline;padding:7px 4px;border-bottom:1px solid var(--border, #ededed);cursor:pointer}
.wl-out{line-height:1.7;color:var(--text, #1c1c1c)}
.wl-out h1,.wl-out h2,.wl-out h3,.wl-out h4{margin:.85em 0 .35em;line-height:1.3;color:var(--text, #1c1c1c)}
.wl-out h1{font-size:1.4em}.wl-out h2{font-size:1.2em}.wl-out h3{font-size:1.05em}
.wl-out p{margin:.4em 0}
.wl-out ul{margin:.3em 0;padding-left:1.3em}
.wl-out code{background:var(--overlay-light, rgba(0,0,0,.05));padding:1px 5px;border-radius:5px;font-family:ui-monospace,Menlo,monospace}
.wl-out pre{background:var(--overlay-light, rgba(0,0,0,.05));padding:10px 12px;border-radius:8px;overflow:auto}
.wl-out pre code{background:transparent;padding:0}
.wl-out blockquote{margin:.5em 0;padding:2px 12px;border-left:3px solid var(--border, #ddd);color:var(--text-muted, #6b6b6b)}
.wl-cb{flex:0 0 auto;margin-top:3px;cursor:pointer}
`

// ── 视图公共骨架 ────────────────────────────────────────────────────────────
function shell(el) {
  el.textContent = ''
  const style = document.createElement('style')
  style.textContent = STYLE
  el.appendChild(style)
  const root = h('div', 'wl-root')
  el.appendChild(root)
  return root
}
function weekPicker(onChange) {
  const wrap = h('div', 'wl-row')
  // ◀ ▶ 是纯符号按钮:必须给 title / aria-label,否则鼠标悬停与读屏都无从知道它是干嘛的。
  const back = btn('◀', 'sm', () => onChange(prevWeekOf(ensureWeek())), 'prev')
  back.setAttribute('title', t('prevWeek'))
  back.setAttribute('aria-label', t('prevWeek'))
  wrap.appendChild(back)
  const lbl = h('span', 'wl-week', ensureWeek())
  lbl.setAttribute('title', `${weekStart(ensureWeek())} ~ ${weekDays(ensureWeek())[6] || ''}`)
  wrap.appendChild(lbl)
  const fwd = btn('▶', 'sm', () => onChange(nextWeekOf(ensureWeek())), 'next')
  fwd.setAttribute('title', t('nextWeek'))
  fwd.setAttribute('aria-label', t('nextWeek'))
  wrap.appendChild(fwd)
  const days = weekDays(ensureWeek())
  wrap.appendChild(h('span', 'wl-muted', `${days[0] || ''} ~ ${days[6] || ''}`))
  return wrap
}
function templateChips(onPick) {
  const wrap = h('div', 'wl-row')
  wrap.appendChild(h('span', 'wl-muted', t('template')))
  const curId = currentTemplateId()
  for (const tp of TEMPLATES) {
    const name = tp[L() === 'en' ? 'en' : 'zh'].name
    const c = document.createElement('button')
    c.className = `wl-chip${tp.id === curId ? ' on' : ''}`
    c.textContent = name
    c.setAttribute('data-tpl', tp.id)
    const id = tp.id
    c.addEventListener('click', () => { setLS('template', id); onPick(id) })
    wrap.appendChild(c)
  }
  return wrap
}

// ══ 视图 1:compose(必须第一个注册 —— 真机台架不传 --view 时打开 views[0])══
function renderCompose(root) {
  root.textContent = ''
  const hd = h('div', 'wl-hd')
  hd.appendChild(h('span', 'wl-ttl', t('viewCompose')))
  hd.appendChild(weekPicker((w) => { void loadWeek(w) }))
  root.appendChild(hd)

  const body = h('div', 'wl-body')
  root.appendChild(body)

  body.appendChild(templateChips(() => bus.emit()))

  const acts = h('div', 'wl-row sp')
  const gen = btn(state.generating ? t('generating') : t('generate'), 'primary', () => {
    void (async () => {
      await generateDraft(ensureWeek())
      bus.emit()
    })()
  }, 'generate')
  gen.disabled = !!state.generating
  acts.appendChild(gen)
  if (state.generating && genAbort) {
    acts.appendChild(btn(t('cancel'), '', () => { try { genAbort.abort() } catch { /* ignore */ } }, 'cancel'))
  }
  acts.appendChild(btn(t('save'), '', () => { void saveCurrentDraft(ensureWeek()) }, 'save'))
  acts.appendChild(btn(t('openFile'), '', () => openVaultFile(reportPath(ensureWeek())), 'open'))
  body.appendChild(acts)

  const items = allItems()
  const stat = h('div', 'wl-muted')
  stat.textContent = t('materialCount', { kept: items.length, picked: items.filter((i2) => i2.picked).length })
  body.appendChild(stat)
  const gtime = h('div', 'wl-muted')
  const rep = state.sidecar && state.sidecar.report
  gtime.textContent = rep && rep.generatedAt ? t('lastGen', { at: stampOf(rep.generatedAt) }) : t('lastGenNever')
  body.appendChild(gtime)

  if (state.ioError) body.appendChild(h('div', 'wl-err', state.ioError))
  if (state.genError) body.appendChild(h('div', 'wl-err', state.genError))

  body.appendChild(h('div', 'wl-hint', t('hint1')))
  body.appendChild(h('div', 'wl-hint', t('hint2')))
  body.appendChild(h('div', 'wl-hint', t('hint3')))

  const ta = document.createElement('textarea')
  ta.className = 'wl-ta'
  ta.setAttribute('data-draft', '1')
  ta.value = String(state.draft || '')
  ta.addEventListener('input', () => { state.draft = String(ta.value || '') })
  body.appendChild(ta)
}

// ══ 视图 2:sources ═════════════════════════════════════════════════════════
function itemHumanLabel(ev) {
  const key = `ev_${String(ev).replace(/[.:-]/g, '_')}`
  return t(key)
}
function renderSourceRow(it) {
  const row = h('div', 'wl-item')
  row.setAttribute('data-item', it.id)
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.className = 'wl-cb'
  cb.checked = !!it.picked
  cb.setAttribute('data-pick', it.id)
  cb.addEventListener('change', () => { void togglePick(it.id, !it.picked) })
  row.appendChild(cb)
  row.appendChild(h('span', 'wl-t', it.ms ? hhmmOf(it.ms) : ''))
  const mid = h('div', 'mid')
  const line1 = h('div', 'wl-row')
  if (it.src === 'manual') line1.appendChild(h('span', 'wl-ev', t('manualBadge')))
  else line1.appendChild(h('span', 'wl-ev', it.event))
  line1.appendChild(h('span', 'wl-muted', itemHumanLabel(it.event)))
  mid.appendChild(line1)
  const line2 = h('div', 'wl-txt')
  let wrote = false
  if (it.link) {
    const a = h('span', 'wl-lnk', it.link)
    const target = it.link
    a.addEventListener('click', () => openVaultFile(target))
    line2.appendChild(a)
    if (it.kv && it.kv.l) line2.appendChild(document.createTextNode(` L${it.kv.l}`))
    wrote = true
  } else if (it.kv && it.kv.f) {
    // agent.edit 的 f= 是工作区/项目路径 → 渲染成纯文本,**不给假链接**
    line2.appendChild(document.createTextNode(String(it.kv.f)))
    wrote = true
  }
  if (it.text) {
    if (wrote) line2.appendChild(document.createTextNode(' '))
    line2.appendChild(document.createTextNode(it.text))
    wrote = true
  }
  if (!wrote && it.kv && it.kv.s) line2.appendChild(document.createTextNode(String(it.kv.s)))
  mid.appendChild(line2)
  row.appendChild(mid)
  if (it.src === 'manual') {
    row.appendChild(btn(t('remove'), 'sm', () => { void removeManual(it.id) }, 'rm'))
  }
  return row
}
function renderSources(root) {
  root.textContent = ''
  const hd = h('div', 'wl-hd')
  hd.appendChild(h('span', 'wl-ttl', t('scanTitle')))
  hd.appendChild(weekPicker((w) => { void loadWeek(w) }))
  root.appendChild(hd)

  const body = h('div', 'wl-body')
  root.appendChild(body)

  const acts = h('div', 'wl-row')
  const sc = btn(state.scanning ? t('scanning') : t('scan'), 'primary', () => {
    void (async () => { await scanWeek(ensureWeek()); bus.emit() })()
  }, 'scan')
  sc.disabled = !!state.scanning || isWeekBeyondRetention(ensureWeek()) // 日志都没了,扫也是白扫
  acts.appendChild(sc)
  acts.appendChild(btn(t('selectAll'), '', () => { void setAllPicked(true) }, 'all'))
  acts.appendChild(btn(t('selectNone'), '', () => { void setAllPicked(false) }, 'none'))
  body.appendChild(acts)

  const st = state.sidecar && state.sidecar.stats ? state.sidecar.stats : { total: 0, kept: 0, droppedPlugin: 0, droppedOther: 0, unparsed: 0 }
  const line = h('div', 'wl-muted')
  line.textContent = t('stats', { total: st.total, kept: st.kept, plugin: st.droppedPlugin, other: st.droppedOther, unparsed: st.unparsed })
  body.appendChild(line)

  if (state.ioError) body.appendChild(h('div', 'wl-err', state.ioError))
  if (state.scanError) {
    const e2 = h('div', 'wl-err', state.scanError)
    body.appendChild(e2)
    body.appendChild(btn(t('retry'), '', () => { void (async () => { await scanWeek(ensureWeek()); bus.emit() })() }, 'retry'))
  }
  if (isWeekBeyondRetention(ensureWeek())) body.appendChild(h('div', 'wl-hint', t('weekTooOld')))

  const items = allItems()
  if (!items.length) {
    body.appendChild(h('div', 'wl-empty', t('emptySources')))
  } else {
    let curDay = ''
    for (const it of items) {
      const day = it.ms ? dayKeyOf(it.ms) : ''
      if (day !== curDay) {
        curDay = day
        body.appendChild(h('div', 'wl-day', it.ms ? localeDate(it.ms) : ''))
      }
      body.appendChild(renderSourceRow(it))
    }
  }

  const manual = h('div', 'wl-card')
  manual.appendChild(h('div', 'wl-colh', t('manualTitle')))
  const mrow = h('div', 'wl-row')
  const input = document.createElement('input')
  input.className = 'wl-in'
  input.setAttribute('data-manual', '1')
  input.setAttribute('placeholder', t('manualPlaceholder'))
  // 输入框每次重渲都是新建的:值必须存在模块级 state 里回填,否则切语言 / 勾一下别的条目
  // 就把用户刚敲了一半的补录冲掉(BRIEF 点名的重灾区)。
  input.value = String(state.manualDraft || '')
  input.addEventListener('input', () => { state.manualDraft = String(input.value || '') })
  const submit = () => {
    const v = String(input.value || '').trim()
    if (!v) return
    const prev = String(input.value || '')
    state.manualDraft = '' // 乐观清空;落盘失败时原样还回去,绝不让用户的字凭空蒸发
    void (async () => {
      const ok = await addManual(v)
      if (!ok) { state.manualDraft = prev; bus.emit() }
    })()
  }
  input.addEventListener('keydown', (e2) => {
    if (e2 && e2.key === 'Enter' && !e2.isComposing && e2.keyCode !== 229) {
      if (e2.preventDefault) e2.preventDefault()
      submit()
    }
  })
  mrow.appendChild(input)
  mrow.appendChild(btn(t('add'), '', submit, 'add'))
  manual.appendChild(mrow)
  body.appendChild(manual)
}
/** 活动日志只保留 30 天 → 可从日志生成的周只有近 4 周左右。 */
function isWeekBeyondRetention(week) {
  const s = weekStart(week)
  if (!s) return false
  const p = s.split('-').map(Number)
  const ms = new Date(p[0], p[1] - 1, p[2], 12, 0, 0, 0).getTime()
  return Date.now() - ms > 30 * 86400000
}
/** 勾选 / 全选 / 删除 / 补录四条链路的唯一落盘口。**失败必须有声**:磁盘满 / 无活动库 / 读失败闸
 *  拦下时,这里不接就是一个未捕获的 promise 拒绝 —— 用户刚敲的补录既没落盘也没提示。
 *  成功返回新档案,失败返回 null(调用方据此决定要不要把输入框里的字还回去)。 */
async function mutateItems(fn) {
  const week = ensureWeek()
  try {
    const next = await updateSidecar(week, (sc) => {
      sc.items = fn(Array.isArray(sc.items) ? sc.items : [])
      return sc
    })
    if (state.week === week) state.sidecar = next
    bus.emit()
    return next
  } catch (e) {
    say(e && e.wlCode ? e.message : t('saveFailed', { err: String((e && e.message) || e) }), { level: 'error' })
    bus.emit() // 重渲 = 勾选框回到磁盘上的真值,不留一个骗人的对勾
    return null
  }
}
const togglePick = (id, val) => mutateItems((items) => items.map((it) => (it.id === id ? { ...it, picked: !!val } : it)))
const setAllPicked = (val) => mutateItems((items) => items.map((it) => ({ ...it, picked: !!val })))
const removeManual = (id) => mutateItems((items) => items.filter((it) => !(it.id === id && it.src === 'manual')))
async function addManual(text) {
  const it = manualItem(text, Date.now())
  const ok = await mutateItems((items) => sortItems(items.concat([it])))
  if (!ok) return false
  if (ctx.activity && ctx.activity.log) ctx.activity.log('manual', { week: ensureWeek() })
  if (ctx.achievements && ctx.achievements.track) ctx.achievements.track('manual', 1)
  return true
}

// ══ 视图 3:archive ════════════════════════════════════════════════════════
function renderArchive(root) {
  root.textContent = ''
  const hd = h('div', 'wl-hd')
  hd.appendChild(h('span', 'wl-ttl', t('archiveTitle')))
  hd.appendChild(btn(t('refresh'), 'sm', () => { state.archive = null; void ensureArchive() }, 'refresh'))
  root.appendChild(hd)

  const body = h('div', 'wl-body')
  root.appendChild(body)

  // null = 还没加载过(首绘,或刚存完一份报告把缓存置空了)。这里必须自己去加载,
  // 否则「保存草稿 → 归档面板变空态」—— 用户刚交完周报,归档反而说一份都没有。
  const rows = state.archive
  if (rows == null) {
    body.appendChild(h('div', 'wl-empty', t('loadingText')))
    void ensureArchive()
    return
  }
  if (!rows.length) {
    body.appendChild(h('div', 'wl-empty', t('emptyArchive')))
    return
  }
  for (const r of rows) {
    const row = h('div', 'wl-arow')
    row.setAttribute('data-week', r.week)
    row.appendChild(h('span', 'wl-week', r.week))
    row.appendChild(h('span', 'wl-muted', t('chars', { n: r.chars })))
    row.appendChild(h('span', 'wl-muted', r.generatedAt ? t('genAt', { at: r.generatedAt }) : t('genAtUnknown')))
    const week = r.week
    row.addEventListener('click', () => {
      state.archiveSel = week
      openVaultFile(reportPath(week))
      bus.emit()
    })
    body.appendChild(row)
  }
  const sel = state.archiveSel || rows[0].week
  const cur = rows.find((r) => r.week === sel)
  const prev = rows.find((r) => r.week === prevWeekOf(sel))
  const panel = h('div', 'wl-card')
  panel.appendChild(h('div', 'wl-colh', t('diffTitle')))
  if (!cur || !prev) {
    panel.appendChild(h('div', 'wl-muted', t('diffNone')))
  } else {
    const d = diffReports(prev.text, cur.text)
    const cols = h('div', 'wl-diff')
    const mk = (title, arr, tag) => {
      const col = h('div', 'wl-col')
      col.setAttribute('data-diff', tag)
      col.appendChild(h('div', 'wl-colh', `${title} (${arr.length})`))
      for (const x of arr.slice(0, 12)) col.appendChild(h('div', 'wl-txt', `- ${x}`))
      return col
    }
    cols.appendChild(mk(t('diffAdded'), d.added, 'added'))
    cols.appendChild(mk(t('diffGone'), d.gone, 'gone'))
    cols.appendChild(mk(t('diffKept'), d.kept, 'kept'))
    panel.appendChild(cols)
  }
  body.appendChild(panel)
  if (cur) {
    const out = h('div', 'wl-out')
    renderMarkdown(out, normalizeReport(cur.text))
    body.appendChild(out)
  }
}
/** 幂等 + 防重入(renderArchive 会在「加载中」分支里调它,而它自己 emit 会触发重渲)。 */
async function ensureArchive() {
  if (state.archive) return state.archive
  if (archiveLoading) return null
  archiveLoading = true
  try { state.archive = await listArchive() } catch { state.archive = [] } finally { archiveLoading = false }
  bus.emit()
  return state.archive
}

// ── 视图注册 ────────────────────────────────────────────────────────────────
/** 三视图共享的挂载骨架:建根 → 首绘 → 订阅就地重渲 → 返回**幂等**清理
 *  (真机台架会 cleanup → remount,清理必须能重复调用且不抛)。 */
function mountView(el, render, onMount) {
  mountSeq += 1
  let root = shell(el)
  let alive = true
  let told = false
  const draw = () => {
    if (!alive || !root) return
    try { render(root) } catch (e) {
      // 单次重渲失败不许把宿主拖下水,但**也不许留下一块纯白**:画一行降级文案 + 提示一次。
      // (控制台报错整条链路都被禁掉了 —— 真机台架有对应断言,所以只能走 notify。)
      try {
        root.textContent = ''
        const box = h('div', 'wl-body')
        box.appendChild(h('div', 'wl-err', `${t('appName')} · ${t('renderFailed')}`))
        box.appendChild(h('div', 'wl-muted', String((e && e.message) || e)))
        root.appendChild(box)
      } catch { /* 连兜底都画不出来:到此为止 */ }
      if (!told) { told = true; say(`${t('renderFailed')} ${String((e && e.message) || e)}`, { level: 'error' }) }
    }
  }
  draw()
  const off = bus.on(draw)
  if (onMount) {
    try { onMount() } catch { /* ignore */ }
  }
  return () => {
    if (!alive) return
    alive = false
    try { off() } catch { /* ignore */ }
    root = null
  }
}
// 注册顺序即 SPEC 的表:**compose 必须第一个**(真机台架不传 --view 时打开 contributions.views[0])。
// ⚠️三处一律写**字面量对象**:批次 verify-all.mjs 用静态正则从本文件抓 registerView 的 id 去校验
// 内嵌 Space 的 requires.views,工厂函数(registerView(makeView(...)))它抓不到,Space 会被判引用未注册视图。
if (ctx.registerView) {
  ctx.registerView({
    id: 'compose',
    title: t('viewCompose'),
    singleton: true,
    mount: (el) => mountView(el, renderCompose, () => { void ensureLoaded() }),
  })
  ctx.registerView({
    id: 'sources',
    title: t('viewSources'),
    singleton: true,
    mount: (el) => mountView(el, renderSources, () => { void ensureLoaded() }),
  })
  ctx.registerView({
    id: 'archive',
    title: t('viewArchive'),
    singleton: true,
    mount: (el) => mountView(el, renderArchive, () => { void ensureLoaded(); void ensureArchive() }),
  })
}
let loadedOnce = false
async function ensureLoaded() {
  if (loadedOnce) return
  loadedOnce = true
  await loadWeek(ensureWeek())
}

// ── 命令 / 斜杠项 / 状态栏 / 成就 ──────────────────────────────────────────
ctx.registerCommand({
  id: 'worklog-reporter-open',
  title: t('cmdOpen'),
  keywords: 'worklog report weekly 周报 汇报 zhoubao',
  run: () => {
    void ensureLoaded()
    if (ctx.openView) ctx.openView('compose')
    else say(t('viewCompose'))
  },
})
ctx.registerCommand({
  id: 'worklog-reporter-generate',
  title: t('cmdGenerate'),
  keywords: 'worklog generate weekly 生成 周报 汇报',
  run: () => {
    void (async () => {
      const cfg = await getCfg()
      if (!cfg.backendUrl || !cfg.token) {
        say(t(cfg.backendUrl ? 'needLogin' : 'noEngine'), { level: 'warning' })
        return // 未登录:提示后**安静返回**(不抛、不报错)
      }
      const week = ensureWeek()
      await ensureLoaded()
      await scanWeek(week)
      const body = await generateDraft(week)
      if (body) await saveCurrentDraft(week)
      if (ctx.openView) ctx.openView('compose')
      bus.emit()
    })()
  },
})
if (ctx.registerSlashItem) {
  ctx.registerSlashItem({
    id: 'worklog-reporter-week',
    label: t('slashLabel'),
    icon: 'template',
    group: '插件',
    keywords: 'worklog weekly report 周报 汇报 zhoubao',
    async run() {
      const week = currentWeek()
      const txt = await readFileSafe(reportPath(week))
      if (txt) return reportBodyForInsert(txt) // 已存在 → 回吐正文,**绝不为此新建文件**
      return templateSkeleton(currentTemplateId())
    },
  })
}
const statusHandle = ctx.registerStatusItem
  ? ctx.registerStatusItem({
    id: 'status',
    side: 'right',
    text: t('sbNone', { week: currentWeek() }),
    title: t('sbTitle'),
    onClick: () => { if (ctx.openView) ctx.openView('compose') },
  })
  : null
function updateStatusItem() {
  if (!statusHandle || !statusHandle.update) return
  const week = ensureWeek()
  const done = !!(state.sidecar && state.sidecar.report && state.sidecar.report.generatedAt)
  try { statusHandle.update({ text: t(done ? 'sbDone' : 'sbNone', { week }), title: t('sbTitle') }) } catch { /* ignore */ }
}
if (ctx.achievements && ctx.achievements.registerSeries) {
  ctx.achievements.registerSeries({
    id: 'worklog',
    title: t('achSeries'),
    achievements: [
      { id: 'first', title: t('achFirst'), desc: t('achFirstDesc'), event: 'report', goal: 1, points: 10 },
      { id: 'ten', title: t('achTen'), desc: t('achTenDesc'), event: 'report', goal: 10, points: 30 },
      { id: 'grounded', title: t('achGrounded'), desc: t('achGroundedDesc'), event: 'manual', goal: 20, points: 20 },
    ],
  })
}

// ── 语言订阅:视图内部**不重挂也要变**(宿主贡献点标题是已知缺口,不做重注册)──
const offLocale = ctx.subscribeLocale ? ctx.subscribeLocale(() => { updateStatusItem(); bus.emit() }) : null

// ── 测试钩子(check.mjs 用;不影响运行时行为)────────────────────────────────
if (globalThis.__WORKLOG_TEST__) {
  Object.assign(globalThis.__WORKLOG_TEST__, {
    MSG, TEMPLATES, ALLOW, DEFAULT_PICK, state, t, L,
    fnv1a, tsToMs, dayKeyOf, isoWeekOf, weekStart, weekDays, prevWeekOf, nextWeekOf, weekSeq, currentWeek,
    parseActivityLine, parseActivityLog, canonicalRest, itemFromParsed, manualItem, mergeItems,
    normalizeReport, reportBullets, diffReports, parseReportMeta,
    buildScanMessage, buildComposeMessage, capExcerpts, parseAgentOutput, extractRawFence,
    composeReportFile, templateSkeleton, reportBodyForInsert, sourceLine,
    renderMarkdown, inlineMd, safeHref, readSidecarRaw, readSidecarMeta, updateSidecar, listArchive, saveReport,
    loadWeek, ensureLoaded, addManual, togglePick, removeManual, scanWeek, generateDraft, saveCurrentDraft,
    collectExcerpts, isProseNote, mountView, ensureArchive, bus, draftStash,
    openVaultFile, COMPOUND_MD,
    mounts: () => mountSeq,
  })
}

return () => {
  try { if (offLocale) offLocale() } catch { /* ignore */ }
  try { if (scanAbort) scanAbort.abort() } catch { /* ignore */ }
  try { if (genAbort) genAbort.abort() } catch { /* ignore */ }
  try { if (statusHandle && statusHandle.dispose) statusHandle.dispose() } catch { /* ignore */ }
  scanAbort = null
  genAbort = null
}
