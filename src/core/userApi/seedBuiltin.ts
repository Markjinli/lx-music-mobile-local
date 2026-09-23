import { Platform } from 'react-native'
import { getData, saveData, saveDataMultiple } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { addUserApi, getUserApiList, getUserApiScript } from '@/utils/data'
import { readAssetFile } from '@/utils/fs'

const MAX_USER_API = 20
const ASSET_DIR = 'lx-builtin-user-api'

const BUILTIN_USER_APIS = [
  { id: 'qdy', file: 'qdy.js', name: '全豆要[聚合音源]' },
  { id: 'ikun', file: 'ikun.js', name: 'ikun音源' },
  { id: 'juhe', file: 'juhe.js', name: '聚合API接口 (CF)' },
  { id: 'sixyin', file: 'sixyin.js', name: '六音音源' },
  { id: 'flower', file: 'flower.js', name: '野花🌷' },
  { id: 'grass', file: 'grass.js', name: '野草🌾' },
  { id: 'lx', file: 'lx.js', name: '[独家音源]' },
  { id: 'huibq', file: 'huibq.js', name: 'Huibq_lxmusic源' },
] as const

/*
 * 下面这段 INFO_NAMES / matchInfo 是 @/utils/data 里同名实现的副本。
 * 之所以复制一份而不是从那边导出：data.ts 是上游文件，本 fork 尽量不动它，
 * 免得以后跟随上游更新时冲突。如果上游改了那边的解析规则，记得同步这里。
 */
const INFO_NAMES = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
} as const
type INFO_NAMES_Type = typeof INFO_NAMES
const matchInfo = (scriptInfo: string) => {
  const infoArr = scriptInfo.split(/\r?\n/)
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/
  const infos: Partial<Record<keyof typeof INFO_NAMES, string>> = {}
  for (const info of infoArr) {
    const result = rxp.exec(info)
    if (!result) continue
    const key = result[1] as keyof typeof INFO_NAMES
    if (INFO_NAMES[key] == null) continue
    infos[key] = result[2].trim()
  }

  for (const [key, len] of Object.entries(INFO_NAMES) as Array<{ [K in keyof INFO_NAMES_Type]: [K, INFO_NAMES_Type[K]] }[keyof INFO_NAMES_Type]>) {
    infos[key] ||= ''
    if (infos[key] == null) infos[key] = ''
    else if (infos[key].length > len) infos[key] = infos[key].substring(0, len) + '...'
  }

  return infos as Record<keyof typeof INFO_NAMES, string>
}

// 内置音源的 key -> 已经注入到用户列表里的那条自定义源的 id。
// 有了这个对应关系，即使脚本内容、名字变了，也能认出「这就是那个内置音源」，
// 从而原地更新内容、保持 id 不变 —— id 一变，用户在设置里选中的音源就会失效。
type BuiltinIdMap = Record<string, string>

export const seedBuiltinUserApis = async(): Promise<LX.UserApi.UserApiInfo[]> => {
  const list = await getUserApiList()
  if (Platform.OS !== 'android') return list

  const idMap = await getData<BuiltinIdMap>(storageDataPrefix.builtinUserApiMap) ?? {}
  const nextIdMap = { ...idMap }
  let idMapChanged = false

  for (const item of BUILTIN_USER_APIS) {
    let script = ''
    try {
      script = await readAssetFile(`${ASSET_DIR}/${item.file}`)
    } catch (err) {
      console.log('seed builtin user api failed', item.id, err)
      continue
    }

    const header = /^\/\*[\S|\s]+?\*\//.exec(script)
    if (!header) {
      console.log('seed builtin user api failed', item.id, 'script header not found')
      continue
    }
    const info = matchInfo(header[0])

    // 匹配用的名字集合：内置音源自己登记的名字，以及脚本头里声明的名字
    const names = new Set<string>([item.name])
    if (info.name !== '') names.add(info.name)

    // 1. 先按记录里的 id 找，找不到再按名字找
    const mappedId = nextIdMap[item.id]
    let index = mappedId == null ? -1 : list.findIndex(api => api.id === mappedId)
    if (index < 0) index = list.findIndex(api => names.has(api.name))

    if (index > -1) {
      const exist = list[index]
      if (nextIdMap[item.id] !== exist.id) {
        nextIdMap[item.id] = exist.id
        idMapChanged = true
      }
      // 2. 脚本没变就什么都不做；变了就原地换掉脚本，id 与选中状态都保持不变
      if (await getUserApiScript(exist.id) === script) continue
      // 注意：这里只能改对象本身。getUserApiList 返回的是内部数组的浅拷贝，
      // 元素是同一个对象；若替换数组元素，就会跟 @/utils/data 里的列表不同步，
      // 之后那边一次 saveData 就会把这次更新覆盖回去。
      Object.assign(exist, info)
      await saveDataMultiple([
        [storageDataPrefix.userApi, list],
        [`${storageDataPrefix.userApi}${exist.id}`, script],
      ])
      continue
    }

    // 3. 列表里没有就注入（用户之前删掉的、或这个版本新加的内置音源）
    if (list.length >= MAX_USER_API) continue
    try {
      const added = await addUserApi(script)
      list.push(added)
      nextIdMap[item.id] = added.id
      idMapChanged = true
    } catch (err) {
      console.log('seed builtin user api failed', item.id, err)
    }
  }

  if (idMapChanged) await saveData(storageDataPrefix.builtinUserApiMap, nextIdMap)
  return list
}
