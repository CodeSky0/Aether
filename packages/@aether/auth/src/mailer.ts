// @aether/auth · 邀请邮件投递适配层

export interface InvitationMail {
  to: string
  realmName: string
  role: string
  acceptUrl: string
}

export interface Mailer {
  sendInvitation(mail: InvitationMail): Promise<void>
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function createConsoleMailer(): Mailer {
  return {
    sendInvitation(mail) {
      // eslint-disable-next-line no-console
      console.log(
        `[auth] Invitation email (console): to=${mail.to} realm=${mail.realmName} role=${mail.role} acceptUrl=${mail.acceptUrl}`,
      )
      return Promise.resolve()
    },
  }
}

function createResendMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.AETHER_MAIL_FROM
  if (!apiKey || !from) {
    throw new Error(
      'AETHER_MAIL_PROVIDER=resend requires RESEND_API_KEY and AETHER_MAIL_FROM',
    )
  }

  return {
    async sendInvitation(mail) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: mail.to,
          subject: `Invitation to ${mail.realmName}`,
          text: `You have been invited to ${mail.realmName} as ${mail.role}. Accept the invitation: ${mail.acceptUrl}`,
          html: `<p>You have been invited to <strong>${escapeHtml(mail.realmName)}</strong> as ${escapeHtml(mail.role)}.</p><p><a href="${escapeHtml(mail.acceptUrl)}">Accept invitation</a></p>`,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `Resend invitation email failed with status ${response.status}`,
        )
      }
    },
  }
}

export function resolveMailer(): Mailer {
  // 空串按未设置处理：托管平台上环境变量常以空值存在，不应让邀请全部失败。
  const provider = process.env.AETHER_MAIL_PROVIDER?.trim() || 'console'
  if (provider === 'console') return createConsoleMailer()
  if (provider === 'resend') return createResendMailer()
  throw new Error(`Unknown AETHER_MAIL_PROVIDER: ${provider}`)
}
