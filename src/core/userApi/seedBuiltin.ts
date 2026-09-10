import { Platform } from 'react-native'
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { addUserApi, getUserApiList } from '@/utils/data'
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

export const seedBuiltinUserApis = async(): Promise<LX.UserApi.UserApiInfo[]> => {
  let list = await getUserApiList()
  if (Platform.OS !== 'android') return list

  const seeded = await getData<string[]>(storageDataPrefix.builtinUserApiSeed) ?? []
  const seededSet = new Set(seeded)
  const nextSeeded = [...seeded]
  let seededChanged = false

  for (const item of BUILTIN_USER_APIS) {
    if (seededSet.has(item.id)) continue
    if (list.some(api => api.name === item.name)) {
      nextSeeded.push(item.id)
      seededChanged = true
      continue
    }
    if (list.length >= MAX_USER_API) continue
    try {
      const script = await readAssetFile(`${ASSET_DIR}/${item.file}`)
      const info = await addUserApi(script)
      list.push(info)
      nextSeeded.push(item.id)
      seededChanged = true
    } catch (err) {
      console.log('seed builtin user api failed', item.id, err)
    }
  }

  if (seededChanged) await saveData(storageDataPrefix.builtinUserApiSeed, nextSeeded)
  return list
}
