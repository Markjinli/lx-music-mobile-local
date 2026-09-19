import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import InputItem from '../../components/InputItem'
import CheckBox from '@/components/common/CheckBox'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Input from '@/components/common/Input'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import Modal, { type ModalType } from '@/components/common/Modal'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { updateSetting } from '@/core/common'
import { HEADER_HEIGHT as _HEADER_HEIGHT } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'
import { BorderWidths } from '@/theme'
import { createStyle, openUrl, toast } from '@/utils/tools'
import { log } from '@/utils/log'
import {
  getGithubBackupPassword,
  getGithubBackupUser,
  setGithubBackupPassword,
  type GithubBackupUser,
} from '@/utils/data'
import {
  createNamedGithubBackup,
  deleteGithubBackup,
  GITHUB_BACKUP_REPO,
  listGithubBackups,
  loginGithub,
  logoutGithub,
  restoreGithubBackup,
  updateGithubBackupHint,
  type GithubBackupItem,
} from '@/core/githubBackup'
import { setGithubBackupRestoring } from '@/core/githubBackup/auto'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=lx-music-playlist-backup'
const HEADER_HEIGHT = scaleSizeH(_HEADER_HEIGHT)

const formatGithubError = (err: unknown, t: (key: any, val?: any) => string) => {
  const message = String((err as Error).message || err)
  if (message == 'unauthorized' || message.includes('Bad credentials')) return t('setting_backup_github_login_failed')
  if (message == 'not login') return t('setting_backup_github_need_login')
  if (message == 'no backup') return t('setting_backup_github_restore_failed')
  if (message == 'decrypt failed') return t('setting_backup_github_decrypt_failed')
  if (message == 'too many backups') return t('setting_backup_github_create_too_many')
  if (message == 'cannot delete auto') return t('setting_backup_github_delete_auto')
  return message
}

export interface GithubPageType {
  show: () => void
}

export interface GithubPageProps {
  onChanged?: () => void
}

export default forwardRef<GithubPageType, GithubPageProps>(({ onChanged }, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const autoBackup = useSettingValue('githubBackup.auto')
  const statusBarHeight = useStatusbarHeight()
  const modalRef = useRef<ModalType>(null)
  const loginAlertRef = useRef<ConfirmAlertType>(null)
  const createAlertRef = useRef<ConfirmAlertType>(null)
  const hintAlertRef = useRef<ConfirmAlertType>(null)
  const restoreAlertRef = useRef<ConfirmAlertType>(null)
  const deleteAlertRef = useRef<ConfirmAlertType>(null)
  const [visible, setVisible] = useState(false)
  const [user, setUser] = useState<GithubBackupUser | null>(null)
  const [password, setPassword] = useState('')
  const [items, setItems] = useState<GithubBackupItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [createName, setCreateName] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState('')
  const [createHint, setCreateHint] = useState('')
  const [hintValue, setHintValue] = useState('')
  const [restorePassword, setRestorePassword] = useState('')

  const selected = useMemo(() => items.find(item => item.id == selectedId) ?? null, [items, selectedId])

  const displayName = useCallback((item: GithubBackupItem) => {
    if (item.auto || item.id == 'auto') return t('setting_backup_github_auto_name')
    return item.name
  }, [t])

  const refreshList = useCallback(async(currentUser?: GithubBackupUser | null) => {
    const nextUser = currentUser === undefined ? user : currentUser
    if (!nextUser) {
      setItems([])
      setSelectedId('')
      return
    }
    const list = await listGithubBackups()
    setItems(list)
    setSelectedId(id => list.some(item => item.id == id) ? id : '')
  }, [user])

  const refreshAll = useCallback(async() => {
    const info = await getGithubBackupUser()
    setUser(info)
    const value = await getGithubBackupPassword()
    setPassword(value)
    try {
      await refreshList(info)
    } catch (err) {
      log.error(err)
      if (info) toast(formatGithubError(err, t), 'long')
      setItems([])
    }
  }, [refreshList, t])

  useImperativeHandle(ref, () => ({
    show() {
      if (visible) modalRef.current?.setVisible(true)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          modalRef.current?.setVisible(true)
        })
      }
      void refreshAll()
    },
  }), [refreshAll, visible])

  const handleHide = useCallback(() => {
    modalRef.current?.setVisible(false)
  }, [])

  const handleModalHide = useCallback(() => {
    onChanged?.()
  }, [onChanged])

  const handleLogin = useCallback(() => {
    setToken('')
    loginAlertRef.current?.setVisible(true)
  }, [])

  const handleConfirmLogin = useCallback(() => {
    const value = token.trim()
    if (!value) {
      toast(t('setting_backup_github_token_empty'))
      return
    }
    setBusy(true)
    void loginGithub(value).then(info => {
      setUser(info)
      loginAlertRef.current?.setVisible(false)
      setToken('')
      toast(t('setting_backup_github_login_success', { name: info.login }))
      return refreshList(info)
    }).catch(err => {
      log.error(err)
      toast(t('setting_backup_github_login_failed') + ': ' + formatGithubError(err, t), 'long')
    }).finally(() => {
      setBusy(false)
    })
  }, [refreshList, t, token])

  const handleLogout = useCallback(() => {
    void logoutGithub().then(() => {
      setUser(null)
      setItems([])
      setSelectedId('')
      toast(t('setting_backup_github_logout_success'))
      onChanged?.()
    })
  }, [onChanged, t])

  const handlePasswordChanged = useCallback((value: string, done: (v: string) => void) => {
    const next = value.trim()
    done(next)
    setPassword(next)
    void setGithubBackupPassword(next)
  }, [])

  const handleOpenCreate = useCallback(() => {
    if (!user) {
      toast(t('setting_backup_github_need_login'))
      return
    }
    setCreateName('')
    setCreatePassword('')
    setCreatePasswordConfirm('')
    setCreateHint('')
    createAlertRef.current?.setVisible(true)
  }, [t, user])

  const handleConfirmCreate = useCallback(() => {
    const name = createName.trim()
    if (!name) {
      toast(t('setting_backup_github_create_need_name'))
      return
    }
    if (!createPassword) {
      toast(t('setting_backup_github_create_need_password'))
      return
    }
    if (createPassword != createPasswordConfirm) {
      toast(t('setting_backup_github_create_password_mismatch'))
      return
    }
    setBusy(true)
    toast(t('setting_backup_github_backup_running'))
    void createNamedGithubBackup({
      name,
      password: createPassword,
      hint: createHint,
    }).then(item => {
      createAlertRef.current?.setVisible(false)
      toast(t('setting_backup_github_backup_success', { repo: item.name }))
      setSelectedId(item.id)
      return refreshList()
    }).catch(err => {
      log.error(err)
      toast(t('setting_backup_github_backup_failed') + ': ' + formatGithubError(err, t), 'long')
    }).finally(() => {
      setBusy(false)
    })
  }, [createHint, createName, createPassword, createPasswordConfirm, refreshList, t])

  const handleOpenHint = useCallback(() => {
    if (!selected) {
      toast(t('setting_backup_github_need_select'))
      return
    }
    setHintValue(selected.hint)
    hintAlertRef.current?.setVisible(true)
  }, [selected, t])

  const handleConfirmHint = useCallback(() => {
    if (!selected) return
    setBusy(true)
    void updateGithubBackupHint(selected.id, hintValue).then(() => {
      hintAlertRef.current?.setVisible(false)
      toast(t('setting_backup_github_hint_success'))
      return refreshList()
    }).catch(err => {
      log.error(err)
      toast(formatGithubError(err, t), 'long')
    }).finally(() => {
      setBusy(false)
    })
  }, [hintValue, refreshList, selected, t])

  const handleOpenRestore = useCallback(() => {
    if (!selected) {
      toast(t('setting_backup_github_need_select'))
      return
    }
    setRestorePassword('')
    restoreAlertRef.current?.setVisible(true)
  }, [selected, t])

  const handleConfirmRestore = useCallback(() => {
    if (!selected) return
    const isAuto = !!(selected.auto || selected.id == 'auto')
    if (!isAuto && !restorePassword) {
      toast(t('setting_backup_github_create_need_password'))
      return
    }
    setBusy(true)
    setGithubBackupRestoring(true)
    toast(t('setting_backup_github_restore_running'))
    void restoreGithubBackup({ id: selected.id, password: restorePassword }).then(() => {
      restoreAlertRef.current?.setVisible(false)
      toast(t('setting_backup_github_restore_success'))
    }).catch(err => {
      log.error(err)
      toast(t('setting_backup_github_restore_failed') + ': ' + formatGithubError(err, t), 'long')
    }).finally(() => {
      setGithubBackupRestoring(false)
      setBusy(false)
    })
  }, [restorePassword, selected, t])

  const handleOpenDelete = useCallback(() => {
    if (!selected) {
      toast(t('setting_backup_github_need_select'))
      return
    }
    if (selected.auto || selected.id == 'auto') {
      toast(t('setting_backup_github_delete_auto'))
      return
    }
    deleteAlertRef.current?.setVisible(true)
  }, [selected, t])

  const handleConfirmDelete = useCallback(() => {
    if (!selected) return
    setBusy(true)
    void deleteGithubBackup(selected.id).then(() => {
      deleteAlertRef.current?.setVisible(false)
      toast(t('setting_backup_github_delete_success'))
      setSelectedId('')
      return refreshList()
    }).catch(err => {
      log.error(err)
      toast(t('setting_backup_github_delete_failed') + ': ' + formatGithubError(err, t), 'long')
    }).finally(() => {
      setBusy(false)
    })
  }, [refreshList, selected, t])

  const inputStyle = { ...styles.dialogInput, backgroundColor: theme['c-primary-input-background'] }

  if (!visible) return null

  return (
    <>
      <Modal ref={modalRef} bgHide={false} statusBarPadding={false} onHide={handleModalHide}>
        <View style={{ ...styles.page, backgroundColor: theme['c-content-background'] }}>
        <View style={{
          ...styles.header,
          height: HEADER_HEIGHT + statusBarHeight,
          paddingTop: statusBarHeight,
          borderBottomColor: theme['c-border-background'],
        }} onStartShouldSetResponder={() => true}>
          <TouchableOpacity onPress={handleHide} style={{ ...styles.backBtn, width: HEADER_HEIGHT }}>
            <Icon name="chevron-left" size={18} />
          </TouchableOpacity>
          <Text numberOfLines={1} size={16} style={styles.headerTitle}>{t('setting_backup_github')}</Text>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          <SubTitle title={t('setting_backup_github_account')}>
            <Text style={styles.status} size={13}>
              {
                user
                  ? t('setting_backup_github_user', { name: user.login, repo: `${user.login}/${user.repo || GITHUB_BACKUP_REPO}` })
                  : t('setting_backup_github_not_login')
              }
            </Text>
            <View style={styles.list}>
              {
                user
                  ? <Button disabled={busy} onPress={handleLogout}>{t('setting_backup_github_logout')}</Button>
                  : <Button disabled={busy} onPress={handleLogin}>{t('setting_backup_github_login')}</Button>
              }
            </View>
          </SubTitle>
          <SubTitle title={t('setting_backup_github_auto_title')}>
            <CheckBox
              disabled={!user}
              check={autoBackup}
              label={t('setting_backup_github_auto')}
              onChange={(enable) => { updateSetting({ 'githubBackup.auto': enable }) }}
            />
            <InputItem
              value={password}
              label={t('setting_backup_github_password')}
              placeholder={t('setting_backup_github_password_tip')}
              onChanged={handlePasswordChanged}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </SubTitle>
          <SubTitle title={t('setting_backup_github_list')}>
            <View style={styles.list}>
              <Button disabled={busy || !user} onPress={handleOpenCreate}>{t('setting_backup_github_create')}</Button>
              <Button disabled={busy || !selected} onPress={handleOpenHint}>{t('setting_backup_github_edit_hint')}</Button>
              <Button disabled={busy || !selected} onPress={handleOpenRestore}>{t('setting_backup_github_restore_selected')}</Button>
              <Button disabled={busy || !selected || !!(selected.auto || selected.id == 'auto')} onPress={handleOpenDelete}>{t('setting_backup_github_delete_selected')}</Button>
            </View>
            {
              !user
                ? <Text style={styles.status} size={13}>{t('setting_backup_github_need_login')}</Text>
                : items.length
                  ? items.map(item => {
                      const active = item.id == selectedId
                      const time = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''
                      return (
                        <TouchableOpacity
                          key={item.id}
                          activeOpacity={0.6}
                          onPress={() => { setSelectedId(item.id) }}
                          style={{
                            ...styles.item,
                            backgroundColor: active ? theme['c-primary-background-active'] : 'transparent',
                            borderBottomColor: theme['c-border-background'],
                          }}
                        >
                          <View style={styles.itemTitleRow}>
                            <Text size={14} style={styles.itemName} numberOfLines={1}>{displayName(item)}</Text>
                            {
                              item.auto || item.id == 'auto'
                                ? <Text size={11} color={theme['c-primary-font']}>{t('setting_backup_github_auto_tag')}</Text>
                                : null
                            }
                          </View>
                          { time ? <Text size={12} color={theme['c-font-label']}>{time}</Text> : null }
                          <Text size={12} color={theme['c-font-label']} numberOfLines={2}>
                            {item.hint || t('setting_backup_github_no_hint')}
                          </Text>
                        </TouchableOpacity>
                      )
                    })
                  : <Text style={styles.status} size={13}>{t('setting_backup_github_list_empty')}</Text>
            }
          </SubTitle>
        </ScrollView>
        </View>
      </Modal>
      <ConfirmAlert
        ref={loginAlertRef}
        title={t('setting_backup_github_login')}
        onConfirm={handleConfirmLogin}
        disabledConfirm={busy}
      >
        <View style={styles.loginBox}>
          <Text size={13} style={styles.loginTip}>{t('setting_backup_github_token_tip')}</Text>
          <Text
            size={13}
            color={theme['c-primary-font']}
            style={styles.link}
            onPress={() => { void openUrl(TOKEN_URL) }}
          >{t('setting_backup_github_token_open')}</Text>
          <Input
            value={token}
            onChangeText={setToken}
            placeholder={t('setting_backup_github_token_placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />
        </View>
      </ConfirmAlert>
      <ConfirmAlert
        ref={createAlertRef}
        title={t('setting_backup_github_create')}
        onConfirm={handleConfirmCreate}
        disabledConfirm={busy}
      >
        <View style={styles.loginBox}>
          <Text size={13} style={styles.fieldLabel}>{t('setting_backup_github_create_name')}</Text>
          <Input
            value={createName}
            onChangeText={setCreateName}
            placeholder={t('setting_backup_github_create_name_placeholder')}
            style={inputStyle}
          />
          <Text size={13} style={styles.fieldLabel}>{t('setting_backup_github_create_password')}</Text>
          <Input
            value={createPassword}
            onChangeText={setCreatePassword}
            placeholder={t('setting_backup_github_create_password_placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
          <Text size={13} style={styles.fieldLabel}>{t('setting_backup_github_create_password_confirm')}</Text>
          <Input
            value={createPasswordConfirm}
            onChangeText={setCreatePasswordConfirm}
            placeholder={t('setting_backup_github_create_password_confirm_placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
          <Text size={13} style={styles.fieldLabel}>{t('setting_backup_github_create_hint')}</Text>
          <Input
            value={createHint}
            onChangeText={setCreateHint}
            placeholder={t('setting_backup_github_create_hint_placeholder')}
            style={inputStyle}
          />
          <Text size={12} color={theme['c-font-label']} style={styles.warn}>{t('setting_backup_github_create_hint_warn')}</Text>
        </View>
      </ConfirmAlert>
      <ConfirmAlert
        ref={hintAlertRef}
        title={t('setting_backup_github_hint_title')}
        onConfirm={handleConfirmHint}
        disabledConfirm={busy}
      >
        <View style={styles.loginBox}>
          <Text size={13} style={styles.fieldLabel}>
            {selected ? displayName(selected) : ''}
          </Text>
          <Input
            value={hintValue}
            onChangeText={setHintValue}
            placeholder={t('setting_backup_github_create_hint_placeholder')}
            style={inputStyle}
          />
          <Text size={12} color={theme['c-font-label']} style={styles.warn}>{t('setting_backup_github_create_hint_warn')}</Text>
        </View>
      </ConfirmAlert>
      <ConfirmAlert
        ref={restoreAlertRef}
        title={t('setting_backup_github_restore_title')}
        onConfirm={handleConfirmRestore}
        disabledConfirm={busy}
      >
        <View style={styles.loginBox}>
          <Text size={13} style={styles.loginTip}>
            {t('setting_backup_github_restore_name', { name: selected ? displayName(selected) : '' })}
          </Text>
          <Text size={13} style={styles.loginTip}>
            {t('setting_backup_github_restore_hint', { hint: selected?.hint || t('setting_backup_github_no_hint') })}
          </Text>
          <Text size={13} style={styles.loginTip}>{t('setting_backup_github_restore_confirm')}</Text>
          <Text size={13} style={styles.fieldLabel}>{t('setting_backup_github_restore_password')}</Text>
          <Input
            value={restorePassword}
            onChangeText={setRestorePassword}
            placeholder={t('setting_backup_github_restore_password_placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
        </View>
      </ConfirmAlert>
      <ConfirmAlert
        ref={deleteAlertRef}
        title={t('setting_backup_github_delete_title')}
        onConfirm={handleConfirmDelete}
        disabledConfirm={busy}
      >
        <Text size={13}>
          {t('setting_backup_github_delete_confirm', { name: selected ? displayName(selected) : '' })}
        </Text>
      </ConfirmAlert>
    </>
  )
})

const styles = createStyle({
  page: {
    flex: 1,
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
  },
  backBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  headerTitle: {
    flex: 1,
    paddingRight: 40,
  },
  body: {
    flex: 1,
    paddingTop: 12,
  },
  bodyContent: {
    paddingBottom: 40,
  },
  status: {
    marginBottom: 8,
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  item: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 8,
    paddingRight: 8,
    borderBottomWidth: BorderWidths.normal,
    marginBottom: 2,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  itemName: {
    flexShrink: 1,
    marginRight: 8,
  },
  loginBox: {
    minWidth: 260,
  },
  loginTip: {
    marginBottom: 8,
  },
  fieldLabel: {
    marginTop: 6,
    marginBottom: 4,
  },
  warn: {
    marginTop: 8,
  },
  link: {
    marginBottom: 10,
    textDecorationLine: 'underline',
  },
  dialogInput: {
    borderRadius: 4,
    minWidth: 260,
  },
})
