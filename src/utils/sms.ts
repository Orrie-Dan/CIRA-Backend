/**
 * SMS sending utility
 * In production, integrate with Twilio, AWS SNS, or similar service
 */

export interface SMSOptions {
  to: string
  message: string
}

/**
 * Send SMS (mock implementation - replace with actual SMS service)
 */
export async function sendSMS(options: SMSOptions): Promise<void> {
  // In production, use Twilio or similar:
  // const client = require('twilio')(accountSid, authToken)
  // await client.messages.create({
  //   body: options.message,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: options.to,
  // })

  // For development, just log the message
  console.log(`[SMS] To: ${options.to}`)
  console.log(`[SMS] Message: ${options.message}`)
  
  // In production, throw error if SMS service is not configured
  if (process.env.NODE_ENV === 'production' && !process.env.TWILIO_ACCOUNT_SID) {
    throw new Error('SMS service not configured')
  }
}

/**
 * Send OTP via SMS
 */
export async function sendOTPViaSMS(phone: string, otp: string): Promise<void> {
  const message = `Your CIRA verification code is: ${otp}. This code will expire in 15 minutes.`
  await sendSMS({ to: phone, message })
}





