import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMailer, type InvitationMail } from '../src/mailer.js'

const invitation: InvitationMail = {
  to: 'member@example.com',
  realmName: 'Aether',
  role: 'member',
  acceptUrl: 'https://aether.example/invitations/invite-1',
}

describe('resolveMailer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses the console provider by default without logging secrets', async () => {
    vi.stubEnv('AETHER_MAIL_PROVIDER', 'console')
    vi.stubEnv('RESEND_API_KEY', 'resend-secret')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await resolveMailer().sendInvitation(invitation)

    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls.flat().join(' ')).toContain(invitation.to)
    expect(log.mock.calls.flat().join(' ')).not.toContain('resend-secret')
  })

  it('treats blank and whitespace-only providers as console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    for (const value of ['', '   ']) {
      vi.stubEnv('AETHER_MAIL_PROVIDER', value)
      await resolveMailer().sendInvitation(invitation)
    }

    expect(log).toHaveBeenCalledTimes(2)
  })

  it('posts invitation details to Resend', async () => {
    vi.stubEnv('AETHER_MAIL_PROVIDER', 'resend')
    vi.stubEnv('RESEND_API_KEY', 'resend-secret')
    vi.stubEnv('AETHER_MAIL_FROM', 'noreply@aether.example')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await resolveMailer().sendInvitation(invitation)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer resend-secret',
          'Content-Type': 'application/json',
        },
      }),
    )
    const request = fetchMock.mock.calls[0]?.[1] as unknown as
      | { body?: unknown }
      | undefined
    const bodyValue = request?.body
    if (typeof bodyValue !== 'string') {
      throw new Error('Resend request body was not a string')
    }
    const body = JSON.parse(bodyValue) as Record<string, unknown>
    expect(body).toMatchObject({
      from: 'noreply@aether.example',
      to: invitation.to,
      subject: 'Invitation to Aether',
    })
    expect(body.text).toContain(invitation.acceptUrl)
    expect(body.html).toContain(invitation.role)
  })

  it('rejects Resend when configuration is incomplete', () => {
    vi.stubEnv('AETHER_MAIL_PROVIDER', 'resend')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('AETHER_MAIL_FROM', '')

    expect(() => resolveMailer()).toThrow(
      'requires RESEND_API_KEY and AETHER_MAIL_FROM',
    )
  })

  it('rejects unknown providers', () => {
    vi.stubEnv('AETHER_MAIL_PROVIDER', 'smtp')

    expect(() => resolveMailer()).toThrow(
      'Unknown AETHER_MAIL_PROVIDER: smtp',
    )
  })

  it('reports the Resend status without exposing the API key', async () => {
    vi.stubEnv('AETHER_MAIL_PROVIDER', 'resend')
    vi.stubEnv('RESEND_API_KEY', 'resend-secret')
    vi.stubEnv('AETHER_MAIL_FROM', 'noreply@aether.example')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422 }),
    )

    await expect(resolveMailer().sendInvitation(invitation)).rejects.toThrow(
      'status 422',
    )
    await expect(resolveMailer().sendInvitation(invitation)).rejects.not.toThrow(
      'resend-secret',
    )
  })
})
