import { prisma } from '../prisma.js'

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send'

export interface PushNotificationPayload {
  to: string
  sound?: string
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
}

/**
 * Register a device token for push notifications
 */
export async function registerDeviceToken(
  userId: string,
  token: string,
  platform: string
) {
  // Check if token already exists
  const existing = await prisma.deviceToken.findUnique({
    where: { token },
  })

  if (existing) {
    // Update existing token
    return await prisma.deviceToken.update({
      where: { token },
      data: {
        userId,
        platform,
        updatedAt: new Date(),
      },
    })
  }

  // Create new token
  return await prisma.deviceToken.create({
    data: {
      userId,
      token,
      platform,
    },
  })
}

/**
 * Unregister a device token
 */
export async function unregisterDeviceToken(token: string) {
  return await prisma.deviceToken.deleteMany({
    where: { token },
  })
}

/**
 * Get device tokens for a user
 */
export async function getUserDeviceTokens(userId: string) {
  return await prisma.deviceToken.findMany({
    where: { userId },
  })
}

/**
 * Send push notification via Expo
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const tokens = await getUserDeviceTokens(userId)

  if (tokens.length === 0) {
    return { sent: 0, failed: 0 }
  }

  const messages: PushNotificationPayload[] = tokens.map((token) => ({
    to: token.token,
    sound: 'default',
    title,
    body,
    data,
    badge: 1, // You might want to calculate actual badge count
  }))

  try {
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })

    const result = await response.json()

    // Expo returns an array of results
    const results = Array.isArray(result) ? result : [result]
    const sent = results.filter((r: any) => r.status === 'ok').length
    const failed = results.filter((r: any) => r.status === 'error').length

    return { sent, failed, results }
  } catch (error) {
    console.error('Failed to send push notification:', error)
    return { sent: 0, failed: tokens.length, error }
  }
}

/**
 * Send push notifications to multiple users
 */
export async function sendPushNotificationsToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const results = await Promise.allSettled(
    userIds.map((userId) => sendPushNotification(userId, title, body, data))
  )

  const sent = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length

  return { sent, failed }
}

