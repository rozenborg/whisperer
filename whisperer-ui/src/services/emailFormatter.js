export function formatEmailHtml(config, briefing) {
  if (!briefing) return ''

  const generatedAt = new Date(briefing.generatedAt || Date.now())
  const formattedDate = generatedAt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const pointsHtml = (briefing.points || [])
    .map(
      (point) => `
      <tr>
        <td style="padding: 12px 0;">
          <strong>${escapeHtml(point.title)}</strong>
          <div style="margin-top: 4px; font-size: 14px; color: #111827;">
            <em>${escapeHtml(point.type)}</em>
          </div>
          <div style="margin-top: 8px; font-size: 14px;">
            ${escapeHtml(point.insight)}
          </div>
          <div style="margin-top: 8px; font-size: 14px;">
            ${escapeHtml(point.implication)}
          </div>
          <div style="margin-top: 8px;">
            <a href="${point.url}" style="color: #2563eb;">Read more</a>
          </div>
        </td>
      </tr>
    `,
    )
    .join('\n')

  const promptHtml =
    config?.prompt && typeof config.prompt === 'string'
      ? escapeHtml(config.prompt).replace(/\n/g, '<br />')
      : ''

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Whisperer Briefing</title>
  </head>
  <body style="font-family: Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; background-color: #ffffff; padding: 32px; border-radius: 12px;">
      <tr>
        <td>
          <h1 style="margin: 0; font-size: 24px; color: #111827;">AI Executive Briefing</h1>
          <p style="margin: 4px 0 16px; color: #6b7280; font-size: 14px;">${formattedDate}</p>
          <p style="font-size: 16px; line-height: 1.6; color: #111827;">
            ${escapeHtml(briefing.summary)}
          </p>
        </td>
      </tr>
      <tr>
        <td>
          <h2 style="font-size: 18px; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px;">
            Key Points
          </h2>
        </td>
      </tr>
      ${
        promptHtml
          ? `
      <tr>
        <td style="padding: 12px 0; font-size: 14px; color: #374151;">
          Prompt: ${promptHtml}
        </td>
      </tr>
      `
          : ''
      }
      ${pointsHtml}
      ${
        briefing.reasoning
          ? `
      <tr>
        <td style="padding-top: 24px;">
          <h3 style="font-size: 16px; color: #111827;">AI Rationale</h3>
          <p style="font-size: 14px; color: #374151; line-height: 1.6;">
            ${escapeHtml(briefing.reasoning)}
          </p>
        </td>
      </tr>
      `
          : ''
      }
    </table>
  </body>
</html>
`.trim()
}

function escapeHtml(value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
