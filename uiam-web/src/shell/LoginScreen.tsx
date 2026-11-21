/**
 * 仿 macOS 锁屏的登录页。
 *
 * 视觉沿用桌面的壁纸渐变（--wall-gradient）：上方是时间，中间毛玻璃卡片里先选
 * 用户、再输密码。登录成功过的账户由 login-accounts 记在本机，下次锁屏以头像
 * 列表呈现，点一下就回填账号；「其他账户」仍可输入新账号。密码在浏览器里先做
 * SM3 再提交（auth-core 负责），明文不上网。登录态与其余六端共用 adm.auth.session。
 *
 * 站点名 / 图标读同一份站点配置，避免在登录页写死品牌字样。
 *
 * 视觉规范：Apple HIG / Liquid Glass（design-system-expert 定稿令牌）。
 * 所有颜色、字阶、间距由 index.css 登录区块的 --login-* 局部变量提供，
 * 本文件只负责结构与状态，不在 JSX 里散落视觉值。
 */
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useAuth } from '../lib/auth-context'
import { forgetLoginAccount, useLoginAccounts, type LoginAccount } from '../lib/login-accounts'
import { siteIconPath, useSiteConfig } from '../lib/site'
import { cx } from '../components/ui'
import { IconEye, IconArrowUp, IconAlert, IconPlus, IconClose } from '../components/icons'

const AVATAR_GRADIENTS = [
  'linear-gradient(145deg, #5ac8fa, #007aff)',
  'linear-gradient(145deg, #ff9f0a, #ff375f)',
  'linear-gradient(145deg, #a78bfa, #5b5bd6)',
  'linear-gradient(145deg, #5eead4, #0f9b8e)',
  'linear-gradient(145deg, #ffd60a, #f5a623)',
  'linear-gradient(145deg, #c7c7cc, #8e8e93)',
]

/** 用账号生成稳定的头像底色，同一个人每次锁屏颜色一致 */
function avatarGradient(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]
}

function avatarInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || '?'
}

function lockClock() {
  const d = new Date()
  const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return { day: `${d.getMonth() + 1}月${d.getDate()}日 ${wd}`, time: `${hh}:${mm}` }
}

export function LoginScreen() {
  const { login } = useAuth()
  const site = useSiteConfig()
  const iconPath = siteIconPath(site.icon)
  const accounts = useLoginAccounts()
  const [selected, setSelected] = useState<string | null>(() => accounts[0]?.account ?? null)
  const [account, setAccount] = useState(() => accounts[0]?.account ?? '')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(lockClock)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(lockClock()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // 账户被别的标签页移除时，别停在一个已经不存在的用户上
  useEffect(() => {
    if (selected && !accounts.some((a) => a.account === selected)) {
      setSelected(null)
      setAccount('')
    }
  }, [accounts, selected])

  const current = accounts.find((a) => a.account === selected)

  const pick = (item: LoginAccount) => {
    setSelected(item.account)
    setAccount(item.account)
    setPassword('')
    setError('')
  }

  const pickOther = () => {
    setSelected(null)
    setAccount('')
    setPassword('')
    setError('')
  }

  const remove = (event: MouseEvent<HTMLButtonElement>, item: LoginAccount) => {
    event.stopPropagation()
    forgetLoginAccount(item.account)
    if (selected === item.account) pickOther()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const loginName = account.trim()
    if (!loginName || !password) {
      setError('请输入账号和密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      await login(loginName, password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-wall" aria-hidden="true" />

      <div className="login-stage">
        <div className="login-top">
          <div className="login-top-time">{clock.time}</div>
          <div className="login-top-day">{clock.day}</div>
        </div>

        <form className="login-card" onSubmit={(e) => void submit(e)}>
          <div className="login-avatar">
            {iconPath ? (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={iconPath} />
              </svg>
            ) : (
              <img src={site.icon} alt="" />
            )}
          </div>
          <div className="login-greeting">{current ? `欢迎回来，${current.name}` : '欢迎回来'}</div>
          <h1 className="login-site">{site.name}</h1>

          {accounts.length > 0 && (
            <div
              className="login-users"
              role="group"
              aria-label="选择已登录过的账户"
              tabIndex={0}
            >
              {accounts.map((item) => (
                <div className="login-user-slot" key={item.account}>
                  <button
                    type="button"
                    className={cx('login-user', selected === item.account && 'on')}
                    onClick={() => pick(item)}
                    aria-pressed={selected === item.account}
                    title={item.account}
                  >
                    <span
                      className="login-user-avatar"
                      style={{ background: avatarGradient(item.account) }}
                    >
                      {avatarInitial(item.name)}
                    </span>
                    <span className="login-user-name">{item.name}</span>
                  </button>
                  <button
                    type="button"
                    className="login-user-remove"
                    onClick={(e) => remove(e, item)}
                    aria-label={`忘记账户 ${item.name}`}
                    title="忘记此账户"
                  >
                    <IconClose size={11} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={cx('login-user', 'login-user-more', selected === null && 'on')}
                onClick={pickOther}
                aria-pressed={selected === null}
              >
                <span className="login-user-avatar">
                  <IconPlus size={18} />
                </span>
                <span className="login-user-name">其他账户</span>
              </button>
            </div>
          )}

          {!selected && (
            <label className="login-field">
              <span className="login-field-label">账号</span>
              <input
                className="login-input"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="登录名 / 手机号 / 邮箱"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                disabled={busy}
              />
            </label>
          )}

          <label className="login-field">
            <span className="login-field-label login-pwd-label">
              <span>密码</span>
              {current && (
                <button type="button" className="login-switch" onClick={pickOther}>
                  切换用户
                </button>
              )}
            </span>
            <span className="login-pwd-wrap">
              <input
                key={selected ?? '__other__'}
                className="login-input"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={current ? `${current.name} 的密码` : '密码'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoFocus={Boolean(current)}
              />
              <button
                className="login-eye"
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
              >
                <IconEye size={16} />
              </button>
            </span>
          </label>

          <button className="login-submit" type="submit" disabled={busy} aria-busy={busy}>
            <span className="login-submit-slot" aria-hidden="true">
              {busy && <span className="login-spinner" />}
            </span>
            <span>{busy ? '登录中…' : '登录'}</span>
            <span className="login-submit-slot" aria-hidden="true">
              {!busy && <IconArrowUp size={16} />}
            </span>
          </button>

          <div className={cx('login-error', error && 'show')} role="alert">
            <IconAlert size={14} />
            <span>{error}</span>
          </div>

          <div className="login-hint">密码在浏览器内做 SM3 摘要后提交，不传明文</div>
        </form>
      </div>

      <div className="login-foot">{site.name} · 登录后可在桌面打开全部控制台</div>
    </div>
  )
}
