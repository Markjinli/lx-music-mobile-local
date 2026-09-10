import { getListMusics, overwriteListFull } from '@/core/list'
import {
  getGithubBackupDeviceKey,
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
  GITHUB_BACKUP_PATH,
  GITHUB_BACKUP_REPO,
  ensurePrivateRepo,
  fetchGithubUser,
  getFileSha,
  putFile,
} from './githubApi'

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
  const token = await getGithubBackupToken()
  const user = await getGithubBackupUser()
  if (!token || !user?.login) throw new Error('not login')

  const repo = await ensurePrivateRepo(token, user.login, user.repo || GITHUB_BACKUP_REPO)
  if (repo != user.repo) await setGithubBackupUser({ ...user, repo })

  const payload = JSON.stringify({
    type: 'playList_v2',
    data: await getAllLists(),
  })
  const encoded = await encryptBackupPayload(payload, await getSecret())
  const file = await getFileSha(token, user.login, repo, GITHUB_BACKUP_PATH)
  await putFile(token, user.login, repo, GITHUB_BACKUP_PATH, encoded, file.sha || undefined)
  await setGithubBackupLast({
    time: Date.now(),
    repo: `${user.login}/${repo}`,
    path: GITHUB_BACKUP_PATH,
  })
  return `${user.login}/${repo}`
}

export const restorePlaylistsFromGithub = async() => {
  const token = await getGithubBackupToken()
  const user = await getGithubBackupUser()
  if (!token || !user?.login) throw new Error('not login')

  const repo = user.repo || GITHUB_BACKUP_REPO
  const file = await getFileSha(token, user.login, repo, GITHUB_BACKUP_PATH)
  if (!file.content) throw new Error('no backup')
  const plain = await decryptBackupPayload(file.content, await getSecret())
  const configData = JSON.parse(plain) as { type?: string, data?: any[] }
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

export { GITHUB_BACKUP_REPO, GITHUB_BACKUP_PATH }
