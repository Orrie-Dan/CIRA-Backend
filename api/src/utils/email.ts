/**
 * Email sending utility
 * In production, integrate with SendGrid, AWS SES, or similar service
 */

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Send email (mock implementation - replace with actual email service)
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  // In production, use SendGrid or similar:
  // const sgMail = require('@sendgrid/mail')
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY)
  // await sgMail.send({
  //   to: options.to,
  //   from: process.env.FROM_EMAIL,
  //   subject: options.subject,
  //   html: options.html,
  //   text: options.text,
  // })

  // For development, just log the email
  console.log(`[EMAIL] To: ${options.to}`)
  console.log(`[EMAIL] Subject: ${options.subject}`)
  console.log(`[EMAIL] Body: ${options.text || options.html}`)
  
  // In production, throw error if email service is not configured
  if (process.env.NODE_ENV === 'production' && !process.env.SENDGRID_API_KEY) {
    throw new Error('Email service not configured')
  }
}

/**
 * Send OTP via email
 */
export async function sendOTPViaEmail(email: string, otp: string): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #00b8d4; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .otp-code { font-size: 32px; font-weight: bold; text-align: center; color: #00b8d4; padding: 20px; background-color: white; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>CIRA Verification</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your verification code for CIRA is:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in 15 minutes.</p>
            <p>If you didn't request this code, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© CIRA - Citizens Infrastructure Reporting Application</p>
          </div>
        </div>
      </body>
    </html>
  `

  const text = `Your CIRA verification code is: ${otp}. This code will expire in 15 minutes.`

  await sendEmail({
    to: email,
    subject: 'CIRA Verification Code',
    html,
    text,
  })
}





