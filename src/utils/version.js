import { httpGet } from '@/utils/request'
import { downloadFile, stopDownload, temporaryDirectoryPath } from '@/utils/fs'
import { getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'

const UPDATE_OWNER = 'Markjinli'
const UPDATE_REPO = 'lx-music-mobile-local'
const APK_PREFIX = 'lx-music-mobile'

const abis = [
  'arm64-v8a',
  'universal',
]

const address = [
  [`https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=20`, 'github'],
  [`https://cdn.jsdelivr.net/gh/${UPDATE_OWNER}/${UPDATE_REPO}@master/publish/version.json`, 'direct'],
  [`https://fastly.jsdelivr.net/gh/${UPDATE_OWNER}/${UPDATE_REPO}@master/publish/version.json`, 'direct'],
  [`https://gcore.jsdelivr.net/gh/${UPDATE_OWNER}/${UPDATE_REPO}@master/publish/version.json`, 'direct'],
  [`https://raw.githubusercontent.com/${UPDATE_OWNER}/${UPDATE_REPO}/master/publish/version.json`, 'direct'],
]

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'lx-music-mobile-local',
}

const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
      headers: url.includes('api.github.com') ? githubHeaders : undefined,
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        ++retryNum >= 3
          ? reject(err || new Error(resp.statusMessage || resp.statusCode))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getDirectInfo = async(url) => {
  return request(url).then(info => {
    if (info.version == null) throw new Error('failed')
    return info
  })
}

const normalizeRelease = (release) => {
  const version = String(release?.tag_name || '').replace(/^v/i, '')
  return {
    version,
    desc: release?.body || '',
  }
}

const getGithubReleaseInfo = async(url) => {
  return request(url).then(body => {
    const releases = Array.isArray(body) ? body : (body?.tag_name ? [body] : [])
    const published = releases.filter(item => item && !item.draft && item.tag_name)
    if (!published.length) throw new Error('failed')
    const latest = normalizeRelease(published[0])
    if (!latest.version) throw new Error('failed')
    return {
      version: latest.version,
      desc: latest.desc,
      history: published.slice(1).map(normalizeRelease).filter(item => item.version),
    }
  })
}

const compareVersion = (a, b) => {
  const pa = String(a).replace(/^v/i, '').split('.')
  const pb = String(b).replace(/^v/i, '').split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = parseInt(pa[i], 10) || 0
    const y = parseInt(pb[i], 10) || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

const fetchVersionInfo = (url, source) => {
  if (source === 'github') return getGithubReleaseInfo(url)
  return getDirectInfo(url)
}

const pickNewest = (infos) => {
  let best = infos[0]
  for (let i = 1; i < infos.length; i++) {
    if (compareVersion(infos[i].version, best.version) === 1) best = infos[i]
  }
  return best
}

export const getVersionInfo = async() => {
  try {
    return await fetchVersionInfo(address[0][0], address[0][1])
  } catch {}

  const results = await Promise.allSettled(
    address.slice(1).map(([url, source]) => fetchVersionInfo(url, source))
  )
  const infos = []
  let lastErr
  for (const result of results) {
    if (result.status === 'fulfilled') infos.push(result.value)
    else lastErr = result.reason
  }
  if (!infos.length) throw lastErr || new Error('failed')
  return pickNewest(infos)
}

const getTargetAbi = async() => {
  const supportedAbis = await getSupportedAbis()
  for (const abi of abis) {
    if (supportedAbis.includes(abi)) return abi
  }
  return abis[abis.length - 1]
}
let downloadJobId = null
const noop = (total, download) => {}
let apkSavePath

export const downloadNewVersion = async(version, onDownload = noop) => {
  const abi = await getTargetAbi()
  const url = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/v${version}/${APK_PREFIX}-v${version}-${abi}.apk`
  let savePath = temporaryDirectoryPath + '/lx-music-mobile.apk'

  if (downloadJobId) stopDownload(downloadJobId)

  const { jobId, promise } = downloadFile(url, savePath, {
    progressInterval: 500,
    connectionTimeout: 20000,
    readTimeout: 30000,
    begin({ statusCode, contentLength }) {
      onDownload(contentLength, 0)
    },
    progress({ contentLength, bytesWritten }) {
      onDownload(contentLength, bytesWritten)
    },
  })
  downloadJobId = jobId
  return promise.then(() => {
    apkSavePath = savePath
    return updateApp()
  })
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
