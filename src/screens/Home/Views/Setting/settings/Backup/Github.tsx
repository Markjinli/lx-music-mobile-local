import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import InputItem from '../../components/InputItem'
import CheckBox from '@/components/common/CheckBox'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Input from '@/components/common/Input'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle, openUrl, confirmDialog, toast } from '@/utils/tools'
import { log } from '@/utils/log'
import {
  getGithubBackupLast,
  getGithubBackupPassword,
  getGithubBackupUser,
  setGithubBackupPassword,
  type GithubBackupUser,
} from '@/utils/data'
import {
  backupPlaylistsToGithub,
  GITHUB_BACKUP_REPO,
  loginGithub,
  logoutGithub,
  restorePlaylistsFromGithub,
} from '@/core/githubBackup'
import { setGithubBackupRestoring } from '@/core/githubBackup/auto'

const formatGithubError = (err: unknown, t: (key: any, val?: any) => string) => {
  const message = String((err as Error).message || err)
  if (message == 'unauthorized' || message.includes('Bad credentials')) return t('setting_backup_github_login_failed')
  if (message == 'not login') return t('setting_backup_github_need_login')
  if (message == 'no backup') return t('setting_backup_github_restore_failed')
  return message
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const autoBackup = useSettingValue('githubBackup.auto')
  const [user, setUser] = useState<GithubBackupUser | null>(null)
  const [password, setPassword] = useState('')
  const [lastText, setLastText] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const loginAlertRef = useRef<ConfirmAlertType>(null)

  const refreshLast = useCallback(async() => {
    const last = await getGithubBackupLast()
    if (!last?.time) {
      setLastText('')
      return
    }
    setLastText(t('setting_backup_github_last', {
      time: new Date(last.time).toLocaleString(),
      repo: last.repo,
    }))
  }, [t])

  useEffect(() => {
    void getGithubBackupUser().then(info => { setUser(info) })
    void getGithubBackupPassword().then(value => { setPassword(value) })
    void refreshLast()
  }, [refreshLast])

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
    }).catch(err => {
      log.error(err)
      toast(t('setting_backup_github_login_failed') + ': ' + formatGithubError(err, t), 'long')
    }).finally(() => {
      setBusy(false)
    })
  }, [t, token])

  const handleLogout = useCallback(() => {
    void logoutGithub().then(() => {
      setUser(null)
      setLastText('')
      toast(t('setting_backup_github_logout_success'))
    })
  }, [t])

  const handleBackup = useCallback(() => {
    if (!user) {
      toast(t('setting_backup_github_need_login'))
      return
    }
    setBusy(true)
    toast(t('setting_backup_github_backup_running'))
    void backupPlaylistsToGithub().then(repo => {
      toast(t('setting_backup_github_backup_success', { repo }))
      void refreshLast()
    }).catch(err => {
      log.error(err)
      toast(t('setting_backup_github_backup_failed') + ': ' + formatGithubError(err, t), 'long')
    }).finally(() => {
      setBusy(false)
    })
  }, [refreshLast, t, user])

  const handleRestore = useCallback(() => {
    if (!user) {
      toast(t('setting_backup_github_need_login'))
      return
    }
    void confirmDialog({
      message: t('setting_backup_github_restore_confirm'),
      bgClose: false,
    }).then(ok => {
      if (!ok) return
      setBusy(true)
      setGithubBackupRestoring(true)
      toast(t('setting_backup_github_restore_running'))
      void restorePlaylistsFromGithub().then(() => {
        toast(t('setting_backup_github_restore_success'))
      }).catch(err => {
        log.error(err)
        toast(t('setting_backup_github_restore_failed') + ': ' + formatGithubError(err, t), 'long')
      }).finally(() => {
        setGithubBackupRestoring(false)
        setBusy(false)
      })
    })
  }, [t, user])

  const handlePasswordChanged = useCallback((value: string, done: (v: string) => void) => {
    const next = value.trim()
    done(next)
    setPassword(next)
    void setGithubBackupPassword(next)
  }, [])

  return (
    <>
      <SubTitle title={t('setting_backup_github')}>
        <Text style={styles.status} size={13}>
          {
            user
              ? t('setting_backup_github_user', { name: user.login, repo: `${user.login}/${user.repo || GITHUB_BACKUP_REPO}` })
              : t('setting_backup_github_not_login')
          }
        </Text>
        { lastText ? <Text style={styles.status} size={12}>{lastText}</Text> : null }
        <View style={styles.list}>
          {
            user
              ? <Button disabled={busy} onPress={handleLogout}>{t('setting_backup_github_logout')}</Button>
              : <Button disabled={busy} onPress={handleLogin}>{t('setting_backup_github_login')}</Button>
          }
          <Button disabled={busy || !user} onPress={handleBackup}>{t('setting_backup_github_backup')}</Button>
          <Button disabled={busy || !user} onPress={handleRestore}>{t('setting_backup_github_restore')}</Button>
        </View>
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
        />
      </SubTitle>
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
            style={{ ...styles.tokenInput, backgroundColor: theme['c-primary-input-background'] }}
          />
        </View>
      </ConfirmAlert>
    </>
  )
})

const styles = createStyle({
  status: {
    marginBottom: 8,
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  loginBox: {
    minWidth: 260,
  },
  loginTip: {
    marginBottom: 8,
  },
  link: {
    marginBottom: 10,
    textDecorationLine: 'underline',
  },
  tokenInput: {
    borderRadius: 4,
    minWidth: 260,
  },
})
