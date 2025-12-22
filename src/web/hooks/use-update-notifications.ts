import { useEffect } from 'react'
import { toast } from 'sonner'

export function useUpdateNotifications(): void {
  useEffect(() => {
    const cleanupDownloading = window.api.onUpdateDownloading((version) => {
      toast.info('Update available', {
        description: `Downloading version ${version}...`
      })
    })

    const cleanupDownloaded = window.api.onUpdateDownloaded((version) => {
      toast.success('Update ready', {
        description: `Version ${version} will be installed when you restart the app`
      })
    })

    return () => {
      cleanupDownloading()
      cleanupDownloaded()
    }
  }, [])
}
