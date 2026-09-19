import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { log } from '@/utils/log'
import {
  getGithubBackupLast,
  getGithubBackupUser,
  type GithubBackupUser,
} from '@/utils/data'
import { listGithubBackups } from '@/core/githubBackup'
import GithubPage, { type GithubPageType } from './GithubPage'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const pageRef = useRef<GithubPageType>(null)
  const [user, setUser] = useState<GithubBackupUser | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [lastTime, setLastTime] = useState('')

  const refreshSummary = useCallback(async() => {
    const info = await getGithubBackupUser()
    setUser(info)
    const last = await getGithubBackupLast()
    setLastTime(last?.time ? new Date(last.time).toLocaleString() : '')
    if (!info) {
      setCount(null)
      return
    }
    try {
      const items = await listGithubBackups()
      setCount(items.length)
    } catch (err) {
      log.error(err)
      setCount(null)
    }
  }, [])

  useEffect(() => {
    void refreshSummary()
  }, [refreshSummary])

  const summary = !user
    ? t('setting_backup_github_not_login')
    : count == null
      ? (
          lastTime
            ? t('setting_backup_github_entry_user_last', { name: user.login, time: lastTime })
            : t('setting_backup_github_entry_user', { name: user.login })
        )
      : (
          lastTime
            ? t('setting_backup_github_entry_last', { name: user.login, count, time: lastTime })
            : t('setting_backup_github_entry', { name: user.login, count })
        )

  return (
    <>
      <SubTitle title={t('setting_backup_github')}>
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={() => { pageRef.current?.show() }}
          style={styles.row}
        >
          <View style={styles.summary}>
            <Text size={13}>{summary}</Text>
          </View>
          <Icon name="chevron-right" color={theme['c-font-label']} size={14} />
        </TouchableOpacity>
      </SubTitle>
      <GithubPage ref={pageRef} onChanged={refreshSummary} />
    </>
  )
})

const styles = createStyle({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
    paddingRight: 8,
  },
  summary: {
    flex: 1,
    marginRight: 8,
  },
})
