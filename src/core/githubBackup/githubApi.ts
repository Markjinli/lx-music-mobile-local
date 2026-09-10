import { httpFetch } from '@/utils/request'

const API = 'https://api.github.com'
const UA = 'lx-music-mobile-local'

export const GITHUB_BACKUP_REPO = 'lx-music-playlist-backup'
export const GITHUB_BACKUP_PATH = 'lx_list.enc.json'

interface GithubResponse<T> {
  ok: boolean
  status: number
  body: T
  message?: string
}

const request = async<T = any>(token: string, path: string, options: {
  method?: string
  body?: Record<string, unknown>
} = {}): Promise<GithubResponse<T>> => {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (options.body) headers['Content-Type'] = 'application/json'
  const fetchOptions: Record<string, unknown> = {
    method,
    headers,
    timeout: 20000,
  }
  if (options.body) fetchOptions.body = options.body

  const { promise } = httpFetch(`${API}${path}`, fetchOptions)
  const resp = await promise as { statusCode: number, body: any }
  const body = resp.body
  const message = typeof body == 'object' && body != null ? String(body.message ?? '') : ''
  return {
    ok: resp.statusCode >= 200 && resp.statusCode < 300,
    status: resp.statusCode,
    body,
    message,
  }
}

export interface GithubUserInfo {
  login: string
  name: string
}

export const fetchGithubUser = async(token: string): Promise<GithubUserInfo> => {
  const res = await request<{ login?: string, name?: string }>(token, '/user')
  if (!res.ok || !res.body?.login) {
    if (res.status == 401) throw new Error('unauthorized')
    throw new Error(res.message || 'github user failed')
  }
  return {
    login: res.body.login,
    name: res.body.name || res.body.login,
  }
}

export const ensurePrivateRepo = async(token: string, login: string, repo = GITHUB_BACKUP_REPO) => {
  const existing = await request(token, `/repos/${login}/${repo}`)
  if (existing.ok) return repo
  if (existing.status != 404) throw new Error(existing.message || 'check repo failed')

  const created = await request(token, '/user/repos', {
    method: 'POST',
    body: {
      name: repo,
      private: true,
      description: 'LX Music encrypted playlist backup',
      auto_init: true,
    },
  })
  if (created.ok || created.status == 422) return repo
  throw new Error(created.message || 'create repo failed')
}

export const getFileSha = async(token: string, login: string, repo: string, path: string) => {
  const res = await request<{ sha?: string, content?: string, encoding?: string }>(token, `/repos/${login}/${repo}/contents/${path}`)
  if (res.status == 404) return { sha: '', content: '' }
  if (!res.ok) throw new Error(res.message || 'read file failed')
  let content = ''
  if (res.body.encoding == 'base64' && typeof res.body.content == 'string') {
    content = Buffer.from(res.body.content.replace(/\n/g, ''), 'base64').toString('utf8')
  }
  return { sha: res.body.sha ?? '', content }
}

export const putFile = async(token: string, login: string, repo: string, path: string, text: string, sha?: string) => {
  const send = async(currentSha?: string) => {
    const body: Record<string, unknown> = {
      message: `backup playlists ${new Date().toISOString()}`,
      content: Buffer.from(text, 'utf8').toString('base64'),
    }
    if (currentSha) body.sha = currentSha
    return request(token, `/repos/${login}/${repo}/contents/${path}`, {
      method: 'PUT',
      body,
    })
  }

  let res = await send(sha)
  if (res.status == 409) {
    const latest = await getFileSha(token, login, repo, path)
    res = await send(latest.sha || undefined)
  }
  if (!res.ok) throw new Error(res.message || 'upload failed')
}
