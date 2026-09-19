import { getListMusics, overwriteListFull } from '@/core/list'
import {
  getGithubBackupDeviceKey,
  getGithubBackupLast,
  getGithubBackupPassword,
  getGithubBackupToken,
  getGithubBackupUser,
  setGithubBackupDeviceKey,
  setGithubBackupLast,
  setGithubBackupToken,
  setGithubBackupUser,
  type GithubBackupUser,
} from '@/utils/data'
import { filterMusicList, fixNewMusicInfoQuality } from '@/utils'
import { log } from '@/utils/log'
import listState from '@/store/list/state'
import { decryptBackupPayload, encryptBackupPayload, createDeviceKey } from './crypto'
import {
  GITHUB_BACKUP_AUTO_PATH,
  GITHUB_BACKUP_INDEX_PATH,
  GITHUB_BACKUP_PATH,
  GITHUB_BACKUP_REPO,
  deleteFile,
  ensurePrivateRepo,
  fetchGithubUser,
  getFileSha,
  putFile,
} from './githubApi'

const AUTO_ID = 'auto'
const MAX_NAMED_BACKUPS = 10

export interface GithubBackupItem {
  id: string
  name: string
  path: string
  hint: string
  updatedAt: string
  auto?: boolean
}

interface GithubBackupIndex {
  v: 1
  backups: GithubBackupItem[]
}

const getAllLists = async() => {
  const lists = []
  lists.push(await getListMusics(listState.defaultList.id).then(musics => ({ ...listState.defaultList, list: musics })))
  lists.push(await getListMusics(listState.loveList.id).then(musics => ({ ...listState.loveList, list: musics })))
  for await (const list of listState.userList) {
    lists.push(await getListMusics(list.id).then(musics => ({ ...list, list: musics })))
  }
  return lists
}

const getSecret = async() => {
  const password = await getGithubBackupPassword()
  if (password) return password
  let deviceKey = await getGithubBackupDeviceKey()
  if (!deviceKey) {
    deviceKey = createDeviceKey()
    await setGithubBackupDeviceKey(deviceKey)
  }
  return deviceKey
}

const getAuth = async() => {
  const token = await getGithubBackupToken()
  const user = await getGithubBackupUser()
  if (!token || !user?.login) throw new Error('not login')
  return { token, user }
}

const ensureUserRepo = async(token: string, user: GithubBackupUser) => {
  const repo = await ensurePrivateRepo(token, user.login, user.repo || GITHUB_BACKUP_REPO)
  if (repo != user.repo) await setGithubBackupUser({ ...user, repo })
  return repo
}

const makeAutoItem = (path: string, updatedAt = '', hint = ''): GithubBackupItem => ({
  id: AUTO_ID,
  name: AUTO_ID,
  path,
  hint,
  updatedAt,
  auto: true,
})

const normalizeItem = (raw: any): GithubBackupItem | null => {
  if (!raw || typeof raw.id != 'string' || typeof raw.path != 'string' || !raw.path) return null
  const auto = raw.id == AUTO_ID || raw.auto == true
  return {
    id: raw.id,
    name: typeof raw.name == 'string' && raw.name ? raw.name : raw.id,
    path: raw.path,
    hint: typeof raw.hint == 'string' ? raw.hint : '',
    updatedAt: typeof raw.updatedAt == 'string' ? raw.updatedAt : '',
    ...(auto ? { auto: true } : {}),
  }
}

const sortBackups = (backups: GithubBackupItem[]) => {
  backups.sort((a, b) => {
    if (a.auto && !b.auto) return -1
    if (!a.auto && b.auto) return 1
    return (b.updatedAt || '').localeCompare(a.updatedAt || '')
  })
  return backups
}

const parseIndex = (content: string): GithubBackupIndex | null => {
  try {
    const data = JSON.parse(content) as { v?: number, backups?: any[] }
    if (data?.v != 1 || !Array.isArray(data.backups)) return null
    const backups = data.backups.map(normalizeItem).filter(Boolean) as GithubBackupItem[]
    return { v: 1, backups: sortBackups(backups) }
  } catch {
    return null
  }
}

const serializeIndex = (index: GithubBackupIndex) => JSON.stringify({
  v: 1,
  backups: index.backups.map(item => ({
    id: item.id,
    name: item.name,
    path: item.path,
    hint: item.hint,
    updatedAt: item.updatedAt,
    ...(item.auto ? { auto: true } : {}),
  })),
}, null, 2)

const legacyUpdatedAt = async() => {
  const last = await getGithubBackupLast()
  if (!last?.time) return ''
  return new Date(last.time).toISOString()
}

const loadIndex = async(token: string, login: string, repo: string): Promise<{
  index: GithubBackupIndex
  sha: string
}> => {
  const indexFile = await getFileSha(token, login, repo, GITHUB_BACKUP_INDEX_PATH)
  if (indexFile.content) {
    const parsed = parseIndex(indexFile.content)
    if (!parsed) throw new Error('invalid backup')
    const hasAuto = parsed.backups.some(item => item.auto || item.id == AUTO_ID)
    if (!hasAuto) {
      const autoFile = await getFileSha(token, login, repo, GITHUB_BACKUP_AUTO_PATH)
      if (autoFile.content) {
        parsed.backups.unshift(makeAutoItem(GITHUB_BACKUP_AUTO_PATH, await legacyUpdatedAt()))
      } else {
        const legacy = await getFileSha(token, login, repo, GITHUB_BACKUP_PATH)
        if (legacy.content) parsed.backups.unshift(makeAutoItem(GITHUB_BACKUP_PATH, await legacyUpdatedAt()))
      }
      sortBackups(parsed.backups)
    }
    return { index: parsed, sha: indexFile.sha }
  }

  const backups: GithubBackupItem[] = []
  const autoFile = await getFileSha(token, login, repo, GITHUB_BACKUP_AUTO_PATH)
  if (autoFile.content) {
    backups.push(makeAutoItem(GITHUB_BACKUP_AUTO_PATH, await legacyUpdatedAt()))
  } else {
    const legacy = await getFileSha(token, login, repo, GITHUB_BACKUP_PATH)
    if (legacy.content) backups.push(makeAutoItem(GITHUB_BACKUP_PATH, await legacyUpdatedAt()))
  }
  return { index: { v: 1, backups }, sha: '' }
}

const mergeBackupLists = (remote: GithubBackupItem[], local: GithubBackupItem[], removedIds: string[] = []) => {
  const map = new Map<string, GithubBackupItem>()
  for (const item of remote) map.set(item.id, item)
  for (const item of local) {
    const prev = map.get(item.id)
    if (!prev || (item.updatedAt || '') >= (prev.updatedAt || '')) map.set(item.id, item)
  }
  for (const id of removedIds) map.delete(id)
  return sortBackups([...map.values()])
}

const saveIndex = async(token: string, login: string, repo: string, index: GithubBackupIndex, sha?: string, removedIds: string[] = []) => {
  sortBackups(index.backups)
  try {
    await putFile(token, login, repo, GITHUB_BACKUP_INDEX_PATH, serializeIndex(index), sha || undefined, false)
  } catch (err) {
    if (String((err as Error).message || err) != 'conflict') throw err
    const latest = await loadIndex(token, login, repo)
    index.backups = mergeBackupLists(latest.index.backups, index.backups, removedIds)
    await putFile(token, login, repo, GITHUB_BACKUP_INDEX_PATH, serializeIndex(index), latest.sha || undefined)
  }
}

const buildPlaylistPayload = async() => JSON.stringify({
  type: 'playList_v2',
  data: await getAllLists(),
})

const applyPlaylistData = async(plain: string) => {
  let configData: { type?: string, data?: any[] }
  try {
    configData = JSON.parse(plain) as { type?: string, data?: any[] }
  } catch {
    throw new Error('decrypt failed')
  }
  if (configData.type != 'playList_v2' || !Array.isArray(configData.data)) throw new Error('invalid backup')

  const allLists = await getAllLists()
  for (const list of configData.data as Array<LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull>) {
    try {
      const targetList = allLists.find(l => l.id == list.id)
      const nextList = filterMusicList(list.list).map(m => fixNewMusicInfoQuality(m))
      if (targetList) {
        targetList.list = nextList
      } else {
        allLists.push({
          name: list.name,
          id: list.id,
          list: nextList,
          source: (list as LX.List.UserListInfoFull).source,
          sourceListId: (list as LX.List.UserListInfoFull).sourceListId,
          locationUpdateTime: (list as LX.List.UserListInfoFull).locationUpdateTime ?? null,
        } as LX.List.UserListInfoFull)
      }
    } catch (err) {
      log.error(err)
    }
  }
  const defaultList = allLists.shift()!.list
  const loveList = allLists.shift()!.list
  await overwriteListFull({ defaultList, loveList, userList: allLists as LX.List.UserListInfoFull[] })
}

const decryptPlain = async(encoded: string, secret: string) => {
  try {
    return await decryptBackupPayload(encoded, secret)
  } catch (err) {
    const message = String((err as Error).message || err)
    if (message == 'invalid backup') throw err
    throw new Error('decrypt failed')
  }
}

const createBackupId = (backups: GithubBackupItem[]) => {
  let id = ''
  do {
    id = `n${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`
  } while (id == AUTO_ID || backups.some(item => item.id == id))
  return id
}

const findItem = (index: GithubBackupIndex, id: string) => {
  return index.backups.find(item => item.id == id) ?? null
}

const isAutoItem = (item: GithubBackupItem) => item.id == AUTO_ID || !!item.auto

export const loginGithub = async(token: string) => {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('empty token')
  const user = await fetchGithubUser(trimmed)
  const repo = await ensurePrivateRepo(trimmed, user.login, GITHUB_BACKUP_REPO)
  const info: GithubBackupUser = {
    login: user.login,
    name: user.name,
    repo,
  }
  await setGithubBackupToken(trimmed)
  await setGithubBackupUser(info)
  return info
}

export const logoutGithub = async() => {
  await setGithubBackupToken('')
  await setGithubBackupUser(null)
}

export const getGithubLoginState = async() => {
  const [token, user] = await Promise.all([getGithubBackupToken(), getGithubBackupUser()])
  if (!token || !user?.login) return null
  return user
}

export const backupPlaylistsToGithub = async() => {
  const { token, user } = await getAuth()
  const repo = await ensureUserRepo(token, user)

  const payload = await buildPlaylistPayload()
  const encoded = await encryptBackupPayload(payload, await getSecret())
  const autoFile = await getFileSha(token, user.login, repo, GITHUB_BACKUP_AUTO_PATH)
  await putFile(token, user.login, repo, GITHUB_BACKUP_AUTO_PATH, encoded, autoFile.sha || undefined)

  const { index, sha } = await loadIndex(token, user.login, repo)
  const updatedAt = new Date().toISOString()
  const existing = index.backups.find(item => isAutoItem(item))
  const autoItem = makeAutoItem(GITHUB_BACKUP_AUTO_PATH, updatedAt, existing?.hint ?? '')
  index.backups = [autoItem, ...index.backups.filter(item => !isAutoItem(item))]
  await saveIndex(token, user.login, repo, index, sha)
  await setGithubBackupLast({
    time: Date.now(),
    repo: `${user.login}/${repo}`,
    path: GITHUB_BACKUP_AUTO_PATH,
  })
  return `${user.login}/${repo}`
}

export const restorePlaylistsFromGithub = async() => {
  await restoreGithubBackup({ id: AUTO_ID, password: '' })
}

export const listGithubBackups = async() => {
  const { token, user } = await getAuth()
  const repo = user.repo || GITHUB_BACKUP_REPO
  const { index } = await loadIndex(token, user.login, repo)
  return index.backups
}

export const createNamedGithubBackup = async({ name, password, hint }: {
  name: string
  password: string
  hint?: string
}) => {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('empty name')
  if (!password) throw new Error('empty password')

  const { token, user } = await getAuth()
  const repo = await ensureUserRepo(token, user)
  const { index, sha } = await loadIndex(token, user.login, repo)
  const namedCount = index.backups.filter(item => !isAutoItem(item)).length
  if (namedCount >= MAX_NAMED_BACKUPS) throw new Error('too many backups')

  const id = createBackupId(index.backups)
  const path = `backups/${id}.enc.json`
  const encoded = await encryptBackupPayload(await buildPlaylistPayload(), password)
  await putFile(token, user.login, repo, path, encoded)

  const item: GithubBackupItem = {
    id,
    name: trimmedName,
    path,
    hint: (hint ?? '').trim(),
    updatedAt: new Date().toISOString(),
  }
  index.backups.push(item)
  await saveIndex(token, user.login, repo, index, sha)
  await setGithubBackupLast({
    time: Date.now(),
    repo: `${user.login}/${repo}`,
    path,
  })
  return item
}

export const restoreGithubBackup = async({ id, password }: {
  id: string
  password: string
}) => {
  const { token, user } = await getAuth()
  const repo = user.repo || GITHUB_BACKUP_REPO
  const { index } = await loadIndex(token, user.login, repo)
  const item = findItem(index, id)
  if (!item) throw new Error('no backup')

  let file = await getFileSha(token, user.login, repo, item.path)
  if (!file.content && isAutoItem(item) && item.path != GITHUB_BACKUP_PATH) {
    file = await getFileSha(token, user.login, repo, GITHUB_BACKUP_PATH)
  }
  if (!file.content) throw new Error('no backup')

  const secret = (isAutoItem(item) && !password) ? await getSecret() : password
  const plain = await decryptPlain(file.content, secret)
  await applyPlaylistData(plain)
}

export const updateGithubBackupHint = async(id: string, hint: string) => {
  const { token, user } = await getAuth()
  const repo = user.repo || GITHUB_BACKUP_REPO
  const { index, sha } = await loadIndex(token, user.login, repo)
  const item = findItem(index, id)
  if (!item) throw new Error('no backup')
  item.hint = hint.trim()
  await saveIndex(token, user.login, repo, index, sha)
}

export const deleteGithubBackup = async(id: string) => {
  const { token, user } = await getAuth()
  const repo = user.repo || GITHUB_BACKUP_REPO
  const { index, sha } = await loadIndex(token, user.login, repo)
  const item = findItem(index, id)
  if (!item) throw new Error('no backup')
  if (isAutoItem(item)) throw new Error('cannot delete auto')

  await deleteFile(token, user.login, repo, item.path)
  index.backups = index.backups.filter(backup => backup.id != id)
  await saveIndex(token, user.login, repo, index, sha, [id])
}

export { GITHUB_BACKUP_REPO, GITHUB_BACKUP_PATH }
