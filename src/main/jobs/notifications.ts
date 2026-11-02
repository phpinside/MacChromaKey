import { Notification, shell } from 'electron'
import { basename } from 'node:path'
import type { Job } from '../../shared/types'
import { PRODUCT } from '../../shared/product'

const notifications = new Set<Notification>()

export function notifyJobDone(job: Job): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: `${PRODUCT.name} · 导出完成`,
    body: basename(job.outputPath)
  })
  notifications.add(notification)
  notification.once('click', () => shell.showItemInFolder(job.outputPath))
  notification.once('close', () => notifications.delete(notification))
  notification.once('failed', () => {
    notifications.delete(notification)
    console.warn('系统未显示导出通知，请检查通知权限和应用签名')
  })
  notification.show()
}
