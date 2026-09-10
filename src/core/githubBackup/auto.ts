import { debounceBackgroundTimer } from '@/utils/tools'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'
import { backupPlaylistsToGithub, getGithubLoginState } from './index'

let restoring = false
let started = false
let unbind: (() => void) | null = null

const runSilentBackup = debounceBackgroundTimer(() => {
  if (restoring) return
  if (!settingState.setting['githubBackup.auto']) return
  void getGithubLoginState().then(user => {
    if (!user) return
    return backupPlaylistsToGithub()
  }).catch(err => {
    log.error('[githubBackup]', err)
  })
}, 60_000)

export const setGithubBackupRestoring = (value: boolean) => {
  restoring = value
}

export const startGithubBackupAuto = () => {
  if (started) return
  started = true
  const onChange = (...args: any[]) => {
    if (args.length && args[args.length - 1] === true) return
    runSilentBackup()
  }
  global.list_event.on('list_data_overwrite', onChange)
  global.list_event.on('list_create', onChange)
  global.list_event.on('list_remove', onChange)
  global.list_event.on('list_update', onChange)
  global.list_event.on('list_update_position', onChange)
  global.list_event.on('list_music_overwrite', onChange)
  global.list_event.on('list_music_add', onChange)
  global.list_event.on('list_music_move', onChange)
  global.list_event.on('list_music_remove', onChange)
  global.list_event.on('list_music_update', onChange)
  global.list_event.on('list_music_clear', onChange)
  global.list_event.on('list_music_update_position', onChange)
  unbind = () => {
    global.list_event.off('list_data_overwrite', onChange)
    global.list_event.off('list_create', onChange)
    global.list_event.off('list_remove', onChange)
    global.list_event.off('list_update', onChange)
    global.list_event.off('list_update_position', onChange)
    global.list_event.off('list_music_overwrite', onChange)
    global.list_event.off('list_music_add', onChange)
    global.list_event.off('list_music_move', onChange)
    global.list_event.off('list_music_remove', onChange)
    global.list_event.off('list_music_update', onChange)
    global.list_event.off('list_music_clear', onChange)
    global.list_event.off('list_music_update_position', onChange)
  }
}

export const stopGithubBackupAuto = () => {
  unbind?.()
  unbind = null
  started = false
}
